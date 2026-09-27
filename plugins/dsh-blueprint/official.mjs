/** Official DSH adapter. No private Spaces APIs, filesystem writes, shell commands or credential reads. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { PACKAGE, closed, exactVersion, identity, equal, get, policy, schemaAllows } from './blueprint.mjs';
import { parseJson, plain, fail } from './codec.mjs';
// Native Settings descriptors are the data contract. UI slots and custom
// pages are presentation only: never inspect them to infer a storage schema.
function cleanResult(r) {
  if (!r || !['applied', 'restart-required', 'overridden', 'failed', 'cancelled'].includes(r.application)) fail('native-contract', 'Unsupported native management result.');
  return { application: r.application, changed: r.changed,
    ...(r.error ? { code: r.error.code } : {}),
    ...(r.pendingBuilds?.length ? { pendingBuilds: r.pendingBuilds } : {}) };
}
export function officialPort(ctx) {
  const manager = ctx.pluginManager;
  for (const name of ['listBundles', 'listPlugins', 'inspect', 'installBundle', 'setBundleEnabled', 'setPluginEnabled']) {
    if (typeof manager?.[name] !== 'function') fail('capability', `Official pluginManager.${name} is required.`);
  }
  if (typeof ctx.settings?.describe !== 'function' || typeof ctx.settings?.mutate !== 'function'
    || typeof ctx.loader?.entries !== 'function' || !ctx.profileContext?.dir) fail('capability', 'Official profile-backed Settings and Loader services are required.');
  const manifestPath = join(ctx.profileContext.dir, 'package.json');
  async function snapshot() {
    const before = readFileSync(manifestPath, 'utf8');
    const manifest = parseJson(before);
    const [nativeBundles, nativeRows] = await Promise.all([manager.listBundles(), manager.listPlugins()]);
    const descriptors = ctx.settings.describe({ redactSecrets: true });
    if (!Array.isArray(descriptors) || descriptors.some(d => d.applies !== 'live' || !Array.isArray(d.secrets))) fail('capability', 'This host lacks the redacted, profile-backed Settings form contract.');
    const packages = nativeBundles.map(b => {
      const readonly = Boolean(b.readOnlyReason || b.name === PACKAGE || b.rows.some(r => r.moduleName === PACKAGE)
        || !b.installed && !b.optional);
      const spec = manifest.dependencies?.[b.name];
      // Only registry dependencies can honestly be exported as npm identities. Local/git/tarball sources stay unsupported.
      const registry = typeof spec === 'string' && /^[0-9A-Za-z*~^<>=|.+ -]+$/.test(spec);
      const source = b.installed ? registry ? 'npm' : null : 'builtin';
      const reason = b.error ? 'native-bundle-error' : !exactVersion(b.version) ? 'unknown-exact-version' : !source ? 'non-registry-source' : null;
      return { name: b.name, version: b.version ?? null, source, enabled: b.enabled, readonly, reason };
    });
    const order = manifest.dsh?.profile?.bundles;
    if (!Array.isArray(order) || order.some(n => typeof n !== 'string')) fail('profile', 'No native ordered bundle manifest.');
    const rows = [], forms = [], warnings = [];
    const entries = [...ctx.loader.entries()];
    const policies = new Map();
    for (const b of nativeBundles) {
      let declarations = {};
      try {
        const dir = ctx.pluginPackages?.packageOf(b.name, pathToFileURL(manifestPath).href)?.dir;
        if (!dir) throw new Error('unresolved');
        const meta = parseJson(readFileSync(join(dir, 'package.json'), 'utf8'));
        if (meta.name !== b.name || meta.version !== b.version) throw new Error('identity');
        if (meta.dshBlueprint !== undefined) {
          closed(meta.dshBlueprint, ['version', 'entries'], 'blueprint contribution');
          if (meta.dshBlueprint.version !== 1 || !plain(meta.dshBlueprint.entries)) throw new Error('policy');
          declarations = meta.dshBlueprint.entries;
          for (const v of Object.values(declarations)) policy(v);
        }
        policies.set(b.name, declarations);
      } catch { warnings.push(`${b.name}: configuration policy could not be read safely; only the package list is available.`); }
      for (const row of b.rows) {
        const native = nativeRows.find(r => r.entryId === row.entryId);
        if (native) rows.push({ package: b.name, row: row.rowId, module: row.moduleName, entryId: native.entryId,
          enabled: native.enabled, readonly: Boolean(native.readOnlyReason || b.name === PACKAGE) });
      }
    }
    for (const d of descriptors) {
      const owners = nativeBundles.flatMap(b => b.rows.filter(r => r.rowId === d.ns).map(r => ({ b, r })));
      if (owners.length !== 1) { warnings.push(`${d.ns}: native configuration ownership is ambiguous or unavailable.`); continue; }
      const { b, r } = owners[0];
      if (b.name === PACKAGE || !policies.has(b.name)) continue;
      const native = nativeRows.find(n => n.entryId === r.entryId);
      const entry = entries.find(e => e.id === r.entryId && e.options.id === d.ns && e.options.name === r.moduleName);
      const schema = entry?.fiber?.runtime?.Config;
      if (!native || !native.enabled || native.moduleName !== r.moduleName || native.readOnlyReason || !schema || !plain(d.value)) { warnings.push(`${d.ns}: native configuration is not safely addressable.`); continue; }
      forms.push({ package: b.name, row: d.ns, module: r.moduleName, builtin: !b.installed,
        value: d.value, secrets: d.secrets, revision: d.revision, schema, policy: policies.get(b.name)[d.ns] });
    }
    for (const p of packages) {
      if (!p.readonly && !forms.some(f => f.package === p.name)) warnings.push(`${p.name}: no supported native editable Settings form; custom pages and storage are outside blueprint scope.`);
    }
    if (readFileSync(manifestPath, 'utf8') !== before) fail('stale', 'Profile changed while reading the catalog.');
    const stamp = createHash('sha256').update(JSON.stringify({ manifest: before, packages, rows,
      forms: forms.map(f => [identity(f), f.revision, f.policy ?? null]) })).digest('hex');
    return { packages, order, rows, forms, warnings, stamp };
  }
  return {
    snapshot,
    inspect: spec => manager.inspect(spec),
    allows: (form, at, proposed) => schemaAllows(form.schema, at, proposed),
    async execute(op, signal) {
      if (signal.aborted) fail('interrupted', 'Operation interrupted.');
      if (op.type === 'install') {
        const requestId = randomUUID();
        // Script grants are never supplied by a blueprint. Native policy remains the authority.
        const stop = () => { if (typeof manager.cancelInstall === 'function') void manager.cancelInstall(requestId).catch(() => {}); };
        signal.addEventListener('abort', stop, { once: true });
        try { return cleanResult(await manager.installBundle(`${op.name}@${op.version}`, { enabled: false, requestId })); }
        finally { signal.removeEventListener('abort', stop); }
      }
      if (op.type === 'bundle') return cleanResult(await manager.setBundleEnabled(op.name, op.enabled));
      if (op.type === 'row') return cleanResult(await manager.setPluginEnabled(op.entryId, op.enabled));
      if (op.type === 'settings') { await ctx.settings.mutate(op.row, op.edits, op.revision); return { application: 'applied' }; }
      fail('operation', 'Unsupported operation.');
    },
    verify(op, s) {
      if (op.type === 'install') return s.packages.some(p => p.name === op.name && p.version === op.version && p.source === 'npm' && !p.reason);
      if (op.type === 'bundle') return s.packages.some(p => p.name === op.name && p.enabled === op.enabled);
      if (op.type === 'row') return s.rows.some(r => r.entryId === op.entryId && r.enabled === op.enabled);
      const form = s.forms.find(f => identity(f) === identity(op));
      return Boolean(form && op.edits.every(edit => equal(get(form.value, edit.path), edit.value)));
    },
  };
}
