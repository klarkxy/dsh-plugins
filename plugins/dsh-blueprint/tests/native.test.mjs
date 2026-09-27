import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { officialPort } from '../official.mjs';
import { BlueprintEngine } from '../engine.mjs';
import { apply, inject } from '../index.mjs';
import { identity, PACKAGE } from '../blueprint.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-blueprint-contract-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const profile = join(root, 'profile'); mkdirSync(profile);
  const manifest = { dependencies: { 'example-a': '1.2.3', [PACKAGE]: '0.1.0' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'example-a', PACKAGE] } } };
  const save = () => writeFileSync(join(profile, 'package.json'), JSON.stringify(manifest)); save();
  const bundles = [
    { name: '@deepseek-ai/dsh-base', version: '0.1.7-rc.2', installed: false, optional: false, enabled: true, readOnlyReason: 'management-required', rows: [{ rowId: 'web-search-deepseek', moduleName: '@deepseek-ai/dsh-web-search-deepseek', entryId: 'web-search-deepseek' }, { rowId: 'bash-sandbox', moduleName: '@deepseek-ai/dsh-bash-sandbox', entryId: 'bash-sandbox' }] },
    { name: 'example-a', version: '1.2.3', installed: true, optional: false, enabled: true, rows: [{ rowId: 'a', moduleName: 'example-a', entryId: 'a' }] },
    { name: PACKAGE, version: '0.1.0', installed: true, optional: false, enabled: true, rows: [{ rowId: 'dsh-blueprint', moduleName: PACKAGE, entryId: 'dsh-blueprint' }] },
  ];
  const dirs = new Map();
  for (const [i, b] of bundles.entries()) { const dir = join(root, `package-${i}`); mkdirSync(dir); dirs.set(b.name, dir); writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: b.name, version: b.version })); }
  const rows = bundles.flatMap(b => b.rows.map(r => ({ entryId: r.entryId, patchId: r.rowId, moduleName: r.moduleName, enabled: true })));
  const descriptors = [
    { ns: 'a', value: { title: 'hello', count: 0 }, secrets: [{ path: ['apiKey'], set: true }], revision: 1, applies: 'live' },
    { ns: 'web-search-deepseek', value: { baseURL: 'https://api.example.invalid', maxUses: 4, apiKeyEnv: 'LOCAL_ONLY', internalModel: 'not-a-page-field' }, secrets: [], revision: 1, applies: 'live' },
    { ns: 'bash-sandbox', value: { timeoutMs: 1000, maxOutputBytes: 100, unrelated: 42 }, secrets: [], revision: 1, applies: 'live' },
  ];
  const schemas = {
    a: { type: 'object', dict: { title: { type: 'string', meta: { volatile: true } }, count: { type: 'number', meta: { volatile: true } }, apiKey: { type: 'string', meta: { volatile: true, role: 'secret' } } } },
    'web-search-deepseek': { type: 'object', meta: { volatile: true }, dict: { baseURL: { type: 'string' }, maxUses: { type: 'number' }, apiKeyEnv: { type: 'string' } } },
    'bash-sandbox': { type: 'object', meta: { volatile: true }, dict: { timeoutMs: { type: 'number' }, maxOutputBytes: { type: 'number' } } },
  };
  const entries = bundles.flatMap(b => b.rows.map(r => ({ id: r.entryId, options: { id: r.rowId, name: r.moduleName }, fiber: { runtime: { Config: schemas[r.rowId] } } })));
  const calls = [], disposers = [];
  let handler;
  const ctx = {
    profileContext: { dir: profile },
    pluginPackages: { packageOf: name => dirs.has(name) ? { dir: dirs.get(name) } : undefined },
    loader: { entries: () => entries },
    pluginManager: {
      listBundles: async () => bundles, listPlugins: async () => rows,
      inspect: async spec => ({ status: 'accepted', kind: 'registry', bundle: true, name: spec.slice(0, spec.lastIndexOf('@')), version: spec.slice(spec.lastIndexOf('@') + 1) }),
      installBundle: async (...args) => { calls.push(['install', ...args]); return { application: 'applied', changed: true, packageResult: { output: 'PRIVATE LOG', logPath: '/PRIVATE' } }; },
      cancelInstall: async (...args) => { calls.push(['cancel', ...args]); return { status: 'cancelled' }; },
      setBundleEnabled: async (...args) => { calls.push(['bundle', ...args]); return { application: 'applied', changed: true }; },
      setPluginEnabled: async (...args) => { calls.push(['row', ...args]); return { application: 'applied', changed: true }; },
    },
    settings: {
      describe: options => { assert.deepEqual(options, { redactSecrets: true }); return structuredClone(descriptors); },
      mutate: async (ns, edits, revision) => { calls.push(['settings', ns, edits, revision]); const d = descriptors.find(d => d.ns === ns); assert.equal(revision, d.revision); for (const edit of edits) d.value[edit.path[0]] = edit.value; d.revision++; },
    },
    effect: factory => { const off = factory(); disposers.push(off); return off; },
    connection: { rpc: { handle: (channel, fn) => { assert.equal(channel, '/dsh-blueprint'); handler = fn; } } },
  };
  return { ctx, calls, manifest, save, dirs, bundles, descriptors, entries, disposers, port: officialPort(ctx), rpc: (...args) => handler(...args, new AbortController().signal) };
}

test('native adapter reads only redacted live forms and preserves manifest order', async t => {
  const f = fixture(t), snapshot = await f.port.snapshot();
  assert.deepEqual(snapshot.order, f.manifest.dsh.profile.bundles);
  assert.equal(snapshot.packages.find(p => p.name === PACKAGE).readonly, true);
  assert.equal(snapshot.forms.find(x => x.row === 'a').value.apiKey, undefined);
  assert.equal(snapshot.forms.length, 3);
});
test('native schema defines fields without hand-maintained official page mappings', async t => {
  const f = fixture(t), catalog = await new BlueprintEngine(f.port).catalog();
  assert.deepEqual(catalog.forms.find(x => x.row === 'web-search-deepseek').fields.map(x => x.path[0]), ['baseURL', 'maxUses', 'apiKeyEnv']);
  assert.deepEqual(catalog.forms.find(x => x.row === 'bash-sandbox').fields.map(x => x.path[0]), ['timeoutMs', 'maxOutputBytes']);
});
test('native forms do not require a page-slot registration', async t => {
  const f = fixture(t);
  Object.defineProperty(f.ctx, 'slots', { get() { throw new Error('UI inspection is outside scope'); } });
  const s = await f.port.snapshot();
  assert.deepEqual(s.forms.map(x => x.row), ['a', 'web-search-deepseek', 'bash-sandbox']);
});
test('custom presentation policy does not remove native Settings support', async t => {
  const f = fixture(t); f.descriptors[0].autoGenerate = false;
  const catalog = await new BlueprintEngine(f.port).catalog();
  assert.deepEqual(catalog.forms.find(x => x.row === 'a').fields.map(x => x.path[0]), ['title', 'count']);
});
test('plugin-owned exclusion metadata needs no adapter code', async t => {
  const f = fixture(t); writeFileSync(join(f.dirs.get('example-a'), 'package.json'), JSON.stringify({ name: 'example-a', version: '1.2.3', dshBlueprint: { version: 1, entries: { a: { exclude: [['title']] } } } }));
  const c = await new BlueprintEngine(f.port).catalog();
  assert.deepEqual(c.forms.find(x => x.row === 'a').fields.map(x => x.path[0]), ['count']);
});
test('invalid author policy removes config eligibility without inventing a default', async t => {
  const f = fixture(t); writeFileSync(join(f.dirs.get('example-a'), 'package.json'), JSON.stringify({ name: 'example-a', version: '1.2.3', dshBlueprint: { version: 7, entries: {} } }));
  const c = await new BlueprintEngine(f.port).catalog();
  assert.ok(c.packages.some(p => p.name === 'example-a')); assert.ok(!c.forms.some(x => x.row === 'a')); assert.ok(c.warnings.length);
});
test('metadata from a mismatched package cannot control another plugin', async t => {
  const f = fixture(t); writeFileSync(join(f.dirs.get('example-a'), 'package.json'), '{"name":"other","version":"1.2.3"}');
  assert.ok(!(await f.port.snapshot()).forms.some(x => x.row === 'a'));
});
test('ambiguous row ownership is not guessed', async t => {
  const f = fixture(t); f.bundles[0].rows.push(f.bundles[1].rows[0]);
  assert.ok(!(await f.port.snapshot()).forms.some(x => x.row === 'a'));
});
test('local installation sources are not recast as npm', async t => {
  const f = fixture(t); f.manifest.dependencies['example-a'] = 'link:/private/plugin'; f.save();
  assert.equal((await f.port.snapshot()).packages.find(p => p.name === 'example-a').source, null);
});
test('older settings contracts fail instead of reading arbitrary files', async t => {
  const f = fixture(t); f.descriptors[0].secrets = undefined;
  await assert.rejects(() => f.port.snapshot(), /contract/);
});
test('native mutation uses field operations and exact read revision', async t => {
  const f = fixture(t), engine = new BlueprintEngine(f.port), catalog = await engine.catalog();
  const form = catalog.forms.find(x => x.row === 'a');
  const generated = await engine.generate({ packages: ['example-a'], forms: [identity(form)], mode: 'settings', name: 'demo' });
  generated.blueprint.settings[0].fields.find(x => x.path[0] === 'title').value = 'updated';
  const plan = await engine.preview({ text: JSON.stringify(generated.blueprint) });
  const result = await engine.apply(plan.planId);
  assert.equal(result.status, 'applied'); assert.equal(f.descriptors[0].value.title, 'updated');
  assert.equal(f.calls[0][0], 'settings'); assert.equal(f.calls[0][3], 1);
  assert.ok(f.calls[0][2].every(x => x.path.length > 0 && x.path[0] !== 'apiKey'));
});
test('native install never grants scripts and returns no raw diagnostics', async t => {
  const f = fixture(t), result = await f.port.execute({ type: 'install', name: 'example-b', version: '1.0.0' }, new AbortController().signal);
  assert.equal(f.calls[0][1], 'example-b@1.0.0'); assert.equal(f.calls[0][2].enabled, false);
  assert.equal(f.calls[0][2].approvedBuilds, undefined); assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});
test('abort requests one native installation cancellation without retry', async t => {
  const f = fixture(t), abort = new AbortController(); let finish;
  f.ctx.pluginManager.installBundle = async () => new Promise(resolve => { finish = resolve; });
  const pending = f.port.execute({ type: 'install', name: 'example-b', version: '1.0.0' }, abort.signal);
  abort.abort(); finish({ application: 'cancelled', changed: false }); await pending;
  assert.equal(f.calls.filter(c => c[0] === 'cancel').length, 1);
});
test('host RPC requires explicit confirmation and rejects unknown commands', async t => {
  const f = fixture(t); apply(f.ctx);
  assert.equal((await f.rpc('apply', { planId: 'fake', confirmed: false })).error.code, 'confirmation');
  assert.equal((await f.rpc('run-shell', {})).error.code, 'endpoint'); assert.equal(f.calls.length, 0);
  assert.equal((await f.rpc('catalog', {})).ok, true);
  assert.equal((await f.rpc('result', { planId: 'none' })).value, null);
  f.disposers.forEach(off => off?.());
  assert.equal((await f.rpc('catalog', {})).ok, false);
});
test('host declares only native runtime dependencies, no Spaces', () => {
  assert.deepEqual(inject, ['connection', 'pluginManager', 'profileContext', 'pluginPackages', 'settings', 'loader']);
});
test('client registers a manager page and a contextual action without replacing the manager', () => {
  let plugin; const registrations = [], navigations = [];
  vm.runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), { window: { __ModuleLoader__: { load: x => { plugin = x; } } } });
  assert.equal(plugin.id, PACKAGE);
  const client = plugin.factory(name => { assert.equal(name, 'react'); return { createElement: (...args) => ({ args }) }; });
  const ctx = { locale: { getSnapshot: () => ({ active: 'zh' }) }, pluginNavigation: { openBundle: x => navigations.push(x) },
    slots: { inject: (_slot, cb) => cb(), register: (options, render) => registrations.push({ options, render }) } };
  client.apply(ctx);
  assert.ok(registrations.some(x => x.options.name === 'plugins.bundle.config' && x.options.key === PACKAGE));
  const action = registrations.find(x => x.options.name === 'plugins.detail.actions');
  assert.equal(action.render({ subject: { kind: 'bundle', pkg: { name: PACKAGE } } }), null);
  const button = action.render({ subject: { kind: 'bundle', pkg: { name: 'example-a' } } });
  button.args[1].onClick(); assert.deepEqual(navigations, [PACKAGE]);
});

test('custom-only configuration is not discovered through storage or another service', async t => {
  const f = fixture(t); f.descriptors.splice(0, 1);
  for (const service of ['customSettings', 'storage', 'credentials', 'slots']) {
    Object.defineProperty(f.ctx, service, { get() { throw new Error(`must not read ${service}`); } });
  }
  Object.defineProperty(f.entries.find(e => e.options.id === 'a').options, 'config', {
    get() { throw new Error('raw Config values are not an export source'); },
  });
  writeFileSync(join(f.dirs.get('example-a'), 'settings.json'), '{"private":"do-not-read"}');
  const c = await new BlueprintEngine(f.port).catalog();
  assert.ok(c.packages.some(p => p.name === 'example-a'));
  assert.ok(!c.forms.some(form => form.row === 'a'));
  assert.ok(c.warnings.some(w => w.includes('example-a') && w.includes('outside blueprint scope')));
  assert.equal(JSON.stringify(c).includes('do-not-read'), false);
});
test('plugin-list export works when the plugin has no native settings', async t => {
  const f = fixture(t); f.descriptors.splice(0, 1);
  const output = await new BlueprintEngine(f.port).generate({ packages: ['example-a'], mode: 'plugins', name: 'list' });
  assert.equal(output.blueprint.packages[0].name, 'example-a');
  assert.deepEqual(output.blueprint.bundles, ['example-a']);
  assert.equal(output.blueprint.settings, undefined);
});
test('custom-only incoming configuration blocks preview before any write', async t => {
  const f = fixture(t), engine = new BlueprintEngine(f.port);
  const generated = await engine.generate({ packages: ['example-a'], mode: 'plugins', name: 'list' });
  f.descriptors.splice(0, 1);
  generated.blueprint.settings = [{ package: 'example-a', row: 'a', module: 'example-a', fields: [{ path: ['title'], value: 'new' }] }];
  const preview = await engine.preview({ text: JSON.stringify(generated.blueprint) });
  assert.equal(preview.planId, null);
  assert.ok(preview.blockers.some(b => b.includes('native editable Settings')));
  assert.equal(f.calls.length, 0);
});
test('stale selected native form does not silently vanish from export', async t => {
  const f = fixture(t), engine = new BlueprintEngine(f.port), c = await engine.catalog();
  const id = identity(c.forms.find(x => x.row === 'a')); f.descriptors.splice(0, 1);
  await assert.rejects(() => engine.generate({ packages: ['example-a'], mode: 'settings', forms: [id], name: 'settings' }), /not available/);
});
test('author policy cannot grant access to nonvolatile or private values', async t => {
  const f = fixture(t); f.descriptors[0].value.staticField = 'ordinary-config-not-shareable';
  f.entries.find(e => e.options.id === 'a').fiber.runtime.Config.dict.staticField = { type: 'string' };
  writeFileSync(join(f.dirs.get('example-a'), 'package.json'), JSON.stringify({ name: 'example-a', version: '1.2.3', dshBlueprint: { version: 1, entries: { a: { include: [['staticField']] } } } }));
  const c = await new BlueprintEngine(f.port).catalog(), form = c.forms.find(x => x.row === 'a');
  assert.deepEqual(form.fields, []);
  assert.ok(form.omitted.some(x => x.reason === 'not-native-editable'));
  assert.equal(JSON.stringify(c).includes('ordinary-config-not-shareable'), false);
});
test('inactive native entry is not replaced by a raw config fallback', async t => {
  const f = fixture(t); (await f.ctx.pluginManager.listPlugins()).find(r => r.entryId === 'a').enabled = false;
  assert.ok(!(await f.port.snapshot()).forms.some(form => form.row === 'a'));
});
test('mismatched live native module cannot borrow another row configuration', async t => {
  const f = fixture(t); (await f.ctx.pluginManager.listPlugins()).find(r => r.entryId === 'a').moduleName = 'different-plugin';
  assert.ok(!(await f.port.snapshot()).forms.some(form => form.row === 'a'));
});
test('client page metadata cannot expand catalog, export or import scope', async t => {
  const f = fixture(t); apply(f.ctx);
  for (const endpoint of ['catalog', 'generate', 'preview']) {
    const reply = await f.rpc(endpoint, { pages: { bundles: ['example-a'], rows: [], items: [] } });
    assert.equal(reply.ok, false); assert.equal(reply.error.code, 'shape');
  }
  assert.equal(f.calls.length, 0);
});
test('native form defaults are included even without author sharing metadata', async t => {
  const f = fixture(t); f.descriptors[0].user = {}; f.descriptors[0].base = { title: 'hello', count: 0 };
  const engine = new BlueprintEngine(f.port), c = await engine.catalog();
  const output = await engine.generate({ packages: ['example-a'], mode: 'settings', forms: [identity(c.forms.find(x => x.row === 'a'))], name: 'defaults' });
  assert.deepEqual(output.blueprint.settings[0].fields, [{ path: ['title'], value: 'hello' }, { path: ['count'], value: 0 }]);
});
test('client never enumerates configuration slots as a data source', () => {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  assert.equal(source.includes('slots.entries('), false);
  assert.equal(source.includes('pages(ctx)'), false);
  assert.ok(source.includes("rpc('catalog', {})"));
});
