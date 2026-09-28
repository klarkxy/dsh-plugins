/** Official DSH adapter. No private Spaces APIs, filesystem writes, shell commands or credential reads. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { PACKAGE, exactVersion } from './blueprint.mjs';
import { parseJson, fail } from './codec.mjs';
function cleanResult(r) {
  if (!r || !['applied', 'restart-required', 'overridden', 'failed', 'cancelled'].includes(r.application)) fail('native-contract', 'Unsupported native management result.');
  return { application: r.application, changed: r.changed,
    ...(r.error ? { code: r.error.code } : {}),
    ...(r.pendingBuilds?.length ? { pendingBuilds: r.pendingBuilds } : {}) };
}
export function officialPort(ctx) {
  const manager = ctx.pluginManager;
  for (const name of ['listBundles', 'inspect', 'installBundle', 'setBundleEnabled']) {
    if (typeof manager?.[name] !== 'function') fail('capability', `Official pluginManager.${name} is required.`);
  }
  if (!ctx.profileContext?.dir) fail('capability', 'An official profile directory is required.');
  const manifestPath = join(ctx.profileContext.dir, 'package.json');
  async function snapshot() {
    const before = readFileSync(manifestPath, 'utf8');
    const manifest = parseJson(before);
    const nativeBundles = await manager.listBundles();
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
    if (readFileSync(manifestPath, 'utf8') !== before) fail('stale', 'Profile changed while reading the catalog.');
    const stamp = createHash('sha256').update(JSON.stringify({ manifest: before, packages })).digest('hex');
    return { packages, order, stamp };
  }
  return {
    snapshot,
    inspect: (spec, signal) => manager.inspect(spec, undefined, signal),
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
      if (op.type === 'bundle' && op.enabled === true) return cleanResult(await manager.setBundleEnabled(op.name, true));
      fail('operation', 'Unsupported operation.');
    },
    verify(op, s) {
      if (op.type === 'install') return s.packages.some(p => p.name === op.name && p.version === op.version && p.source === 'npm' && !p.reason);
      if (op.type === 'bundle') return s.packages.some(p => p.name === op.name && p.enabled === op.enabled);
      return false;
    },
  };
}
