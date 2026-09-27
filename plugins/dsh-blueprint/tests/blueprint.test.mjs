import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { decode, encode, parseJson, MAX_JSON } from '../codec.mjs';
import { validate, publicFields, schemaAllows, identity } from '../blueprint.mjs';
import { BlueprintEngine } from '../engine.mjs';
const bp = (packages = [], bundles = packages.map(p => p.name)) => ({ kind: 'dsh-blueprint', formatVersion: 2,
  metadata: { name: '中文测试', version: '1.0.0' }, packages, bundles });
const pkg = name => ({ name, version: '1.2.3', source: 'npm' });
const schema = { type: 'object', dict: { title: { type: 'string', meta: { volatile: true } },
  enabled: { type: 'boolean', meta: { volatile: true } }, count: { type: 'number', meta: { volatile: true } },
  apiKey: { type: 'string', meta: { volatile: true, role: 'secret' } },
  baseURL: { type: 'string', meta: { volatile: true } },
  staticField: { type: 'string' } } };
const form = () => ({ package: 'example-a', row: 'a', module: 'example-a', revision: 1, builtin: false,
  value: { title: 'old', enabled: true, count: 5, baseURL: 'https://local.invalid' }, secrets: [{ path: ['apiKey'], set: true }], schema });
function fixture(initial = ['example-a']) {
  let revision = 1;
  const state = { packages: initial.map(n => ({ ...pkg(n), enabled: true, readonly: false, reason: null })), order: [...initial], rows: [], forms: initial.includes('example-a') ? [form()] : [], warnings: [] };
  const calls = [];
  const port = {
    snapshot: async () => ({ ...structuredClone(state), stamp: String(revision) }),
    inspect: async spec => ({ status: 'accepted', kind: 'registry', bundle: true, name: spec.split('@')[0], version: spec.split('@')[1] }),
    allows: (f, at, v) => schemaAllows(f.schema, at, v),
    async execute(op) {
      calls.push(structuredClone(op)); revision++;
      if (op.type === 'install') state.packages.push({ ...pkg(op.name), enabled: false, readonly: false, reason: null });
      if (op.type === 'bundle') {
        state.packages.find(p => p.name === op.name).enabled = op.enabled;
        state.order = state.order.filter(n => n !== op.name);
        if (op.enabled) { state.order.push(op.name); if (op.name === 'example-a' && !state.forms.length) state.forms.push(form()); }
      }
      if (op.type === 'settings') {
        const f = state.forms.find(f => f.row === op.row); assert.equal(op.revision, f.revision);
        for (const edit of op.edits) f.value[edit.path[0]] = edit.value;
        f.revision++;
      }
      return { application: 'applied' };
    },
    verify: () => true,
  };
  return { engine: new BlueprintEngine(port), port, state, calls, touch: () => revision++ };
}
const preview = (f, value) => f.engine.preview({ text: JSON.stringify(value) });
for (const encoding of ['J', 'Z', 'shortest']) test(`codec ${encoding} round trip`, () => {
  const v = bp(); v.settings = [{ package: 'x', row: 'x', module: 'x', fields: [{ path: ['x'], value: [false, 0, '', null, '😀中文'] }] }];
  assert.deepEqual(decode(encode(v, encoding)), v);
});
for (const [name, value] of [
  ['duplicate keys', '{"a":1,"a":2}'], ['escaped duplicate keys', '{"a":1,"\\u0061":2}'],
  ['prototype member', '{"__proto__":{}}'], ['BOM', '\ufeff{}'], ['trailing comma', '{"a":1,}'],
  ['trailing bytes', '{}x'], ['unsafe integer', '9007199254740992'], ['infinity', '1e999'],
  ['lone surrogate', '"\\ud800"'], ['literal control', '"\n"'], ['too deep', '['.repeat(70) + '0' + ']'.repeat(70)],
  ['non-JSON whitespace', '\u00a0{}'], ['bad number', '01'], ['YAML', 'a: 1'], ['comment', '{/*x*/}'],
]) test(`strict parser rejects ${name}`, () => assert.throws(() => parseJson(value)));
test('negative zero is normalized', () => assert.equal(Object.is(parseJson('-0'), -0), false));
test('literal and escaped Unicode survive', () => assert.equal(parseJson('"中文\\ud83d\\ude00"'), '中文😀'));
test('empty, padded and noncanonical base64 reject', () => { for (const code of ['DSHBP2:J:', 'DSHBP2:J:e30=', 'DSHBP2:J:e31', 'DSHBP2:J:A']) assert.throws(() => decode(code)); });
test('v1 and future code versions reject', () => { for (const code of ['DSHBP1:J:e30', 'DSHBP3:J:e30']) assert.throws(() => decode(code)); });
test('invalid UTF8 rejects', () => assert.throws(() => decode(`DSHBP2:J:${Buffer.from([0xff]).toString('base64url')}`)));
test('trailing compressed stream rejects', () => assert.throws(() => decode(`DSHBP2:Z:${Buffer.concat([deflateRawSync(Buffer.from('{}')), Buffer.from('x')]).toString('base64url')}`)));
test('decompression bound is enforced', () => assert.throws(() => decode(`DSHBP2:Z:${deflateRawSync(Buffer.alloc(MAX_JSON + 1, 32)).toString('base64url')}`)));
test('unknown execution fields and unspecific versions reject', () => {
  assert.throws(() => validate({ ...bp(), postInstall: 'run something' }));
  assert.throws(() => validate(bp([{ ...pkg('x'), version: 'latest' }])));
  assert.throws(() => validate(bp([{ ...pkg('x'), version: '1.2.3-01' }])));
  assert.throws(() => validate(bp([pkg('@klarkxy/dsh-blueprint')])));
});
test('overlapping edits and root replacement reject', () => {
  for (const fields of [[{ path: [], value: {} }], [{ path: ['x'], value: {} }, { path: ['x', 'y'], value: 2 }]]) {
    assert.throws(() => validate({ ...bp(), settings: [{ package: 'x', row: 'x', module: 'x', fields }] }));
  }
});
test('default sharing includes ordinary false/zero/empty values', () => {
  assert.deepEqual(publicFields({ value: { a: false, b: 0, c: '' }, secrets: [] }).fields.map(f => f.value), [false, 0, '']);
});
test('author exclusions override default inclusion', () => {
  const result = publicFields({ value: { a: 1, b: { private: 2, public: 3 } }, secrets: [] }, { exclude: [['b', 'private']] });
  assert.deepEqual(result.fields.map(f => f.path), [['a'], ['b', 'public']]);
});
test('secret-bearing arrays are never copied or reindexed', () => {
  const result = publicFields({ value: { accounts: [{ label: 'a' }] }, secrets: [{ path: ['accounts', '0', 'key'], set: true }] });
  assert.equal(result.fields.length, 0); assert.match(result.omitted[0].reason, /array/);
});
test('policy share false opts out entire form', () => assert.deepEqual(publicFields(form(), { share: false }).fields, []));
test('unknown policy keys do not enable unsafe sharing', () => assert.throws(() => publicFields(form(), { exportEverything: true })));
test('schema guard denies ordinary config, secret fields and secret union branches', () => {
  assert.equal(schemaAllows(schema, ['title'], 'new'), true);
  assert.equal(schemaAllows(schema, ['staticField'], 'new'), false);
  assert.equal(schemaAllows(schema, ['apiKey'], 'secret'), false);
  const union = { type: 'union', list: [{ type: 'string', meta: { volatile: true } }, { type: 'string', meta: { volatile: true, role: 'secret' } }] };
  assert.equal(schemaAllows(union, [], 'secret'), false);
});
test('schema guard detects secrets in previously empty dictionaries', () => {
  const s = { type: 'dict', meta: { volatile: true }, inner: { type: 'object', dict: { token: { type: 'string', meta: { role: 'secret' } } } } };
  assert.equal(schemaAllows(s, [], { new: { token: 'secret' } }), false);
});
test('export uses native order and never puts settings in list-only mode', async () => {
  const f = fixture(['example-b', 'example-a']);
  const result = await f.engine.generate({ name: 'test', packages: ['example-a', 'example-b'], mode: 'plugins' });
  assert.deepEqual(result.blueprint.bundles, ['example-b', 'example-a']); assert.equal(result.blueprint.settings, undefined);
});
test('selected form and field removals are effective', async () => {
  const f = fixture(), id = identity(form());
  const result = await f.engine.generate({ name: 'test', packages: ['example-a'], forms: [id], omit: [{ form: id, path: ['title'] }], mode: 'settings' });
  assert.ok(result.blueprint.settings[0].fields.every(x => x.path[0] !== 'title' && x.path[0] !== 'apiKey'));
});
test('local sources are not silently rewritten as npm', async () => {
  const f = fixture(); f.state.packages[0].source = null;
  await assert.rejects(() => f.engine.generate({ name: 'test', packages: ['example-a'], mode: 'plugins' }));
});
test('preview is read-only and blocks different installed versions', async () => {
  const f = fixture(); const v = bp([{ ...pkg('example-a'), version: '2.0.0' }]);
  const result = await preview(f, v); assert.equal(result.planId, null); assert.equal(f.calls.length, 0);
});
test('package order is applied through explicit disable then enable operations', async () => {
  const f = fixture(['unrelated', 'example-b', 'example-a']);
  const p = await preview(f, bp([pkg('example-a'), pkg('example-b')]));
  const report = await f.engine.apply(p.planId);
  assert.equal(report.status, 'applied'); assert.deepEqual(f.state.order, ['unrelated', 'example-a', 'example-b']);
  assert.equal(f.state.packages.length, 3);
});
test('a consumed plan returns its result without replay', async () => {
  const f = fixture([]), p = await preview(f, bp([pkg('example-a')]));
  const first = await f.engine.apply(p.planId), count = f.calls.length;
  assert.deepEqual(await f.engine.apply(p.planId), first); assert.equal(f.calls.length, count);
});
test('stale plans never begin writes', async () => {
  const f = fixture([]), p = await preview(f, bp([pkg('example-a')])); f.touch();
  await assert.rejects(() => f.engine.apply(p.planId), /changed/); assert.equal(f.calls.length, 0);
});
test('expired plans never begin writes', async () => {
  const f = fixture([]); let now = 0; f.engine.now = () => now;
  const p = await preview(f, bp([pkg('example-a')])); now = 300001;
  await assert.rejects(() => f.engine.apply(p.planId), /expired/); assert.equal(f.calls.length, 0);
});
test('new installations need a second real-form preview', async () => {
  const f = fixture([]), v = bp([pkg('example-a')]);
  v.settings = [{ package: 'example-a', row: 'a', module: 'example-a', fields: [{ path: ['title'], value: 'new' }] }];
  const p = await preview(f, v); assert.equal(p.next, 'preview-settings');
  const first = await f.engine.apply(p.planId); assert.equal(first.status, 'applied'); assert.equal(f.state.forms[0].value.title, 'old');
  const p2 = await preview(f, v); assert.equal(p2.stage, 'settings');
  await f.engine.apply(p2.planId); assert.equal(f.state.forms[0].value.title, 'new');
});
test('settings use revisioned path edits and retain unexported values', async () => {
  const f = fixture(), v = bp([pkg('example-a')]);
  v.settings = [{ package: 'example-a', row: 'a', module: 'example-a', fields: [{ path: ['enabled'], value: false }, { path: ['count'], value: 0 }, { path: ['title'], value: '' }] }];
  const p = await preview(f, v); await f.engine.apply(p.planId);
  assert.equal(f.state.forms[0].value.title, ''); assert.equal(f.state.forms[0].value.count, 0); assert.equal(f.state.forms[0].value.enabled, false);
  assert.equal(f.state.forms[0].value.baseURL, 'https://local.invalid'); assert.ok(f.calls[0].revision);
});
test('incoming secret, author-excluded and connection-changing edits block before writing', async () => {
  for (const field of ['apiKey', 'title', 'baseURL']) {
    const f = fixture(), v = bp([pkg('example-a')]); f.state.forms[0].policy = { exclude: [['title']] };
    v.settings = [{ package: 'example-a', row: 'a', module: 'example-a', fields: [{ path: [field], value: 'private' }] }];
    const p = await preview(f, v); assert.equal(p.planId, null); assert.equal(f.calls.length, 0);
  }
});
test('first native failure stops subsequent actions and does not leak error values', async () => {
  const f = fixture([]); f.port.execute = async () => { throw new Error('API_KEY=private'); };
  const p = await preview(f, bp([pkg('example-a'), pkg('example-b')]));
  const r = await f.engine.apply(p.planId); assert.equal(r.status, 'failed'); assert.equal(r.steps.length, 1); assert.ok(r.remaining > 0);
  assert.ok(!JSON.stringify(r).includes('private'));
});
test('restart-required is not reported as applied', async () => {
  const f = fixture([]); f.port.execute = async () => ({ application: 'restart-required' });
  const p = await preview(f, bp([pkg('example-a')])), r = await f.engine.apply(p.planId);
  assert.equal(r.status, 'restart-required'); assert.equal(r.steps.length, 1);
});
test('failed readback is not reported as success', async () => {
  const f = fixture([]); f.port.verify = () => false;
  const p = await preview(f, bp([pkg('example-a')])), r = await f.engine.apply(p.planId);
  assert.equal(r.status, 'verification-failed');
});
test('concurrent apply requests are rejected', async () => {
  const f = fixture([]); let release; f.port.execute = () => new Promise(resolve => { release = resolve; });
  const p = await preview(f, bp([pkg('example-a')]));
  const running = f.engine.apply(p.planId); while (!release) await new Promise(r => setImmediate(r));
  await assert.rejects(() => f.engine.apply(p.planId), /already running/);
  release({ application: 'failed' }); await running;
});
test('pre-aborted apply has no side effects', async () => {
  const f = fixture([]), p = await preview(f, bp([pkg('example-a')]));
  const signal = AbortSignal.abort(); const r = await f.engine.apply(p.planId, signal);
  assert.equal(r.status, 'interrupted'); assert.equal(f.calls.length, 0);
});
test('numeric package names and sparse arrays reject without coercion', () => {
  assert.throws(() => validate(bp([{ ...pkg('x'), name: 123 }])));
  const v = bp(); v.bundles = new Array(1); assert.throws(() => validate(v));
});
test('intersection schemas permit fields owned by separate branches', () => {
  const s = { type: 'intersect', list: [schema, { type: 'object', dict: { other: { type: 'string', meta: { volatile: true } } } }] };
  assert.equal(schemaAllows(s, ['title'], 'new'), true);
  assert.equal(schemaAllows(s, ['other'], 'new'), true);
  assert.equal(schemaAllows(s, ['apiKey'], 'secret'), false);
});
test('native public values have no inferred custom-page subset', () => {
  assert.deepEqual(publicFields({ value: { shown: 1, alsoEditable: 2 } }).fields, [{ path: ['shown'], value: 1 }, { path: ['alsoEditable'], value: 2 }]);
});
test('separate credential stores cannot make connection target changes safe', async () => {
  const f = fixture(); f.state.forms[0].secrets = [];
  const v = bp([pkg('example-a')]); v.settings = [{ package: 'example-a', row: 'a', module: 'example-a', fields: [{ path: ['baseURL'], value: 'https://other.invalid' }] }];
  assert.equal((await preview(f, v)).planId, null); assert.equal(f.calls.length, 0);
});
test('adding a disabled package does not reorder already-correct existing layers', async () => {
  const f = fixture(['example-a', 'unrelated']);
  const p = await preview(f, bp([pkg('example-a'), pkg('example-b')], ['example-a']));
  assert.equal((await f.engine.apply(p.planId)).status, 'applied');
  assert.deepEqual(f.state.order, ['example-a', 'unrelated']);
});
test('readback failure preserves the completed step and makes consumption non-replayable', async () => {
  const f = fixture([]), p = await preview(f, bp([pkg('example-a')]));
  const original = f.port.snapshot; f.port.snapshot = async (...args) => { if (f.calls.length) throw new Error('private'); return original(...args); };
  const r = await f.engine.apply(p.planId);
  assert.equal(r.status, 'failed'); assert.equal(r.steps.length, 1);
  assert.equal(r.remaining, 1); assert.equal(JSON.stringify(r).includes('private'), false);
  await f.engine.apply(p.planId); assert.equal(f.calls.length, 1);
});
test('incorrect native order cannot report success', async () => {
  const f = fixture(['example-b', 'example-a']), p = await preview(f, bp([pkg('example-a'), pkg('example-b')]));
  const exec = f.port.execute; f.port.execute = async op => { const r = await exec(op); f.state.order.sort().reverse(); return r; };
  assert.equal((await f.engine.apply(p.planId)).status, 'verification-failed');
});
test('exactly 64 container levels are accepted', () => {
  assert.doesNotThrow(() => parseJson('['.repeat(64) + '0' + ']'.repeat(64)));
  assert.throws(() => parseJson('['.repeat(65) + '0' + ']'.repeat(65)));
});
