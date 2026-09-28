import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import { decode, encode, parseJson, MAX_JSON, MAX_SHARE } from '../codec.mjs';
import { validate } from '../blueprint.mjs';
import { BlueprintEngine } from '../engine.mjs';
const bp = (packages = [], bundles = packages.map(p => p.name)) => ({ kind: 'dsh-blueprint', formatVersion: 2,
  metadata: { name: '中文测试' }, packages, bundles });
const pkg = name => ({ name, version: '1.2.3', source: 'npm' });
function fixture(initial = ['example-a']) {
  let revision = 1;
  const state = { packages: initial.map(n => ({ ...pkg(n), enabled: true, readonly: false, reason: null })), order: [...initial] };
  const calls = [];
  const port = {
    snapshot: async () => ({ ...structuredClone(state), stamp: String(revision) }),
    inspect: async spec => ({ status: 'accepted', bundle: true, name: spec.split('@')[0], version: spec.split('@')[1] }),
    async execute(op) {
      calls.push(structuredClone(op)); revision++;
      if (op.type === 'install') state.packages.push({ ...pkg(op.name), enabled: false, readonly: false, reason: null });
      if (op.type === 'bundle') {
        state.packages.find(p => p.name === op.name).enabled = op.enabled;
        state.order = state.order.filter(n => n !== op.name);
        if (op.enabled) state.order.push(op.name);
      }
      return { application: 'applied' };
    },
    verify: () => true,
  };
  return { engine: new BlueprintEngine(port), port, state, calls, touch: () => revision++ };
}
const preview = (f, value) => f.engine.preview({ text: encode(value) });
test('compressed code round trip', () => {
  const v = bp(); v.metadata.description = '😀中文';
  assert.deepEqual(decode(encode(v)), v);
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
test('empty and padded payloads reject', () => { for (const code of ['DSHBP2:', encode(bp())+'=']) assert.throws(() => decode(code), {code:'encoding'}); });
test('noncanonical base64 rejects before inflation', () => { for (const payload of ['e31','A']) assert.throws(() => decode('DSHBP2:'+payload), {code:'base64'}); });
test('raw JSON and alternate encoding tags reject', () => { for (const code of [JSON.stringify(bp()),'DSHBP2:J:e30','DSHBP2:Z:e30']) assert.throws(() => decode(code), {code:'encoding'}); });
test('only outer ASCII whitespace is ignored', () => { const code=encode(bp()); assert.deepEqual(decode(' \t\r\n'+code+'\n'),bp()); for(const value of [code.slice(0,10)+' '+code.slice(10),'\u00a0'+code]) assert.throws(()=>decode(value),{code:'encoding'}); });
test('large malformed whitespace is rejected promptly and raw input bounds remain intact', () => {
  // Isolate a future regression so a quadratic regexp cannot hang the test runner.
  const script = `import assert from 'node:assert/strict';
    import {decode,encode,MAX_SHARE} from ${JSON.stringify(new URL('../codec.mjs', import.meta.url).href)};
    for (const whitespace of [' '.repeat(1024*1024), '\\t\\r\\n'.repeat(300000)]) {
      assert.throws(()=>decode('DSHBP2:a'+whitespace+'a'), {code:'encoding'});
    }
    const code=encode({ok:true});
    assert.deepEqual(decode(' '.repeat(400000)+code+'\\t'.repeat(400000)), {ok:true});
    assert.throws(()=>decode(' '.repeat(MAX_SHARE)+code), {code:'size'});`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { timeout: 5000, encoding: 'utf8' });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.throws(() => decode('中'.repeat(Math.ceil(MAX_SHARE / 3))), {code:'size'});
});
test('v1 and future code versions reject', () => { for (const code of ['DSHBP1:e30', 'DSHBP3:e30']) assert.throws(() => decode(code)); });
test('invalid UTF8 rejects', () => assert.throws(() => decode(`DSHBP2:${deflateRawSync(Buffer.from([0xff])).toString('base64url')}`), {code:'utf8'}));
test('trailing compressed stream rejects', () => assert.throws(() => decode(`DSHBP2:${Buffer.concat([deflateRawSync(Buffer.from('{}')), Buffer.from('x')]).toString('base64url')}`), {code:'deflate'}));
test('decompression bound is enforced', () => assert.throws(() => decode(`DSHBP2:${deflateRawSync(Buffer.alloc(MAX_JSON + 1, 32)).toString('base64url')}`), {code:'deflate'}));
test('unknown execution fields and unspecific versions reject', () => {
  assert.throws(() => validate({ ...bp(), postInstall: 'run something' }));
  assert.throws(() => validate(bp([{ ...pkg('x'), version: 'latest' }])));
  assert.throws(() => validate(bp([{ ...pkg('x'), version: '1.2.3-01' }])));
  assert.throws(() => validate(bp([pkg('@klarkxy/dsh-blueprint')])));
});
test('export preserves explicitly selected order and never puts settings in list-only mode', async () => {
  const f = fixture(['example-b', 'example-a']);
  const result = await f.engine.generate({ name: 'test', packages: ['example-a', 'example-b'] });
  assert.deepEqual(Object.keys(result), ['code']);
  const document = validate(decode(result.code));
  assert.deepEqual(document.bundles, ['example-a', 'example-b']); assert.equal(document.settings, undefined);
  assert.deepEqual(document.metadata, {name:'test'});
});
test('local sources are not silently rewritten as npm', async () => {
  const f = fixture(); f.state.packages[0].source = null;
  await assert.rejects(() => f.engine.generate({ name: 'test', packages: ['example-a'] }));
});
test('preview is read-only and blocks different installed versions', async () => {
  const f = fixture(); const v = bp([{ ...pkg('example-a'), version: '2.0.0' }]);
  const result = await preview(f, v); assert.equal(result.planId, null); assert.equal(f.calls.length, 0);
});
test('a different incoming order reuses existing bundles without moves or conflicts', async () => {
  const f = fixture(['unrelated', 'example-b', 'example-a']);
  const p = await preview(f, bp([pkg('example-a'), pkg('example-b')]));
  assert.deepEqual(p.blockers, []); assert.deepEqual(p.operations, []); assert.equal(p.planId, null);
  assert.deepEqual(p.order, ['unrelated', 'example-b', 'example-a']);
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
  const f = fixture(['example-b', 'example-a']), p = await preview(f, bp([pkg('example-a'), pkg('example-c')]));
  const exec = f.port.execute; f.port.execute = async op => { const r = await exec(op); f.state.order.sort().reverse(); return r; };
  assert.equal((await f.engine.apply(p.planId)).status, 'verification-failed');
});

for (const [change, mutate] of [
  ['version', s => { s.packages.find(p => p.name === 'pending').version = '2.0.0'; }],
  ['source', s => { s.packages.find(p => p.name === 'pending').source = 'builtin'; }],
  ['protection', s => { s.packages.find(p => p.name === 'pending').readonly = true; }],
  ['native error', s => { s.packages.find(p => p.name === 'pending').reason = 'native-bundle-error'; }],
  ['removal', s => { s.packages = s.packages.filter(p => p.name !== 'pending'); }],
  ['unrelated identity', s => { s.packages.find(p => p.name === 'local-a').version = '2.0.0'; }],
  ['unexpected package', s => { s.packages.push({...pkg('unexpected'),enabled:false,readonly:false,reason:null}); }],
  ['existing order', s => { s.order.reverse(); }],
  ['premature activation', s => { s.packages.find(p => p.name === 'pending').enabled = true; s.order.push('pending'); }],
]) test(`concurrent ${change} during installation stops before enabling a pending package`, async () => {
  const f = fixture(['local-a', 'local-b']);
  f.state.packages.push({...pkg('pending'),enabled:false,readonly:false,reason:null});
  const p = await preview(f, bp([pkg('missing'), pkg('pending')], ['pending']));
  const execute = f.port.execute;
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  f.port.execute = async op => {
    const result = await execute(op);
    started(); await new Promise(resolve => { release = resolve; });
    return result;
  };
  const running = f.engine.apply(p.planId);
  await ready; mutate(f.state); f.touch(); release();
  const result = await running;
  assert.equal(result.status, 'verification-failed');
  assert.equal(result.steps.length, 1); assert.equal(result.remaining, 1);
  assert.deepEqual(f.calls.map(op => [op.type,op.name]), [['install','missing']]);
  assert.deepEqual(await f.engine.apply(p.planId), result);
  assert.equal(f.calls.length, 1);
});

test('identity drift during activation fails even when the native enable verifies', async () => {
  const f = fixture(['local']);
  f.state.packages.push({...pkg('pending'),enabled:false,readonly:false,reason:null});
  const p = await preview(f, bp([pkg('pending')])), execute = f.port.execute;
  f.port.execute = async op => {
    const result = await execute(op);
    f.state.packages.find(p => p.name === 'pending').version = '2.0.0';
    return result;
  };
  assert.equal((await f.engine.apply(p.planId)).status, 'verification-failed');
  assert.equal(f.calls.length, 1);
});

test('a later installation cannot replace an already verified package', async () => {
  const f = fixture([]), p = await preview(f, bp([pkg('first'),pkg('second')])), execute = f.port.execute;
  f.port.execute = async op => {
    const result = await execute(op);
    if(op.name === 'second') f.state.packages.find(p => p.name === 'first').version = '2.0.0';
    return result;
  };
  assert.equal((await f.engine.apply(p.planId)).status, 'verification-failed');
  assert.deepEqual(f.calls.map(op => op.type), ['install','install']);
});

test('final readback checks identities as well as bundle order', async () => {
  const f = fixture(['local']), p = await preview(f, bp([pkg('missing')], []));
  const snapshot = f.port.snapshot; let completedReads = 0;
  f.port.snapshot = async () => {
    if(f.calls.length && ++completedReads === 2) {
      f.state.packages.find(p => p.name === 'missing').version = '2.0.0'; f.touch();
    }
    return snapshot();
  };
  assert.equal((await f.engine.apply(p.planId)).status, 'verification-failed');
});

test('catalog enumeration changes do not invalidate legitimate install and enable effects', async () => {
  const f = fixture(['local-a','local-b']), execute = f.port.execute;
  f.port.execute = async op => { const result = await execute(op); f.state.packages.reverse(); return result; };
  const p = await preview(f, bp([pkg('missing')]));
  assert.equal((await f.engine.apply(p.planId)).status, 'applied');
  assert.deepEqual(f.state.order, ['local-a','local-b','missing']);
});

test('embedding appends missing activations and preserves all local layers', async () => {
  const f = fixture(['a', 'x', 'b', 'c']), p = await preview(f, bp([pkg('a'), pkg('d'), pkg('b')]));
  assert.deepEqual(p.order, ['a', 'x', 'b', 'c', 'd']);
  assert.deepEqual(p.operations, [{type:'install',name:'d',version:'1.2.3'}, {type:'bundle',name:'d',enabled:true}]);
  assert.equal((await f.engine.apply(p.planId)).status, 'applied');
  assert.deepEqual(f.state.order, p.order);
  assert.equal((await preview(f, bp([pkg('a'), pkg('d'), pkg('b')]))).planId, null);
});

test('incoming install-only packages never disable active local bundles', async () => {
  const f = fixture(['a', 'b', 'c']), p = await preview(f, bp([pkg('a'), pkg('b')], ['a']));
  assert.deepEqual(p.operations, []); assert.equal(p.planId, null);
  assert.deepEqual(p.order, ['a', 'b', 'c']);
});

test('a requested disabled bundle is enabled at the end without reinstalling', async () => {
  const f = fixture(['a', 'c']); f.state.packages.push({...pkg('b'),enabled:false,readonly:false,reason:null});
  const p = await preview(f, bp([pkg('b'), pkg('a')]));
  assert.deepEqual(p.operations, [{type:'bundle',name:'b',enabled:true}]);
  assert.equal((await f.engine.apply(p.planId)).status, 'applied');
  assert.deepEqual(f.state.order, ['a', 'c', 'b']);
});

test('top-level install request order and activation preference are distinct', async () => {
  const f = fixture(['a']), p = await preview(f, bp([pkg('d'),pkg('e')], ['e','d']));
  assert.deepEqual(p.operations.map(op=>[op.type,op.name]), [['install','d'],['install','e'],['bundle','e'],['bundle','d']]);
  assert.equal((await f.engine.apply(p.planId)).status, 'applied');
  assert.deepEqual(f.state.order, ['a','e','d']);
});

test('all small import permutations preserve the local prefix and are idempotent', async () => {
  const lists = values => [[], ...values.flatMap((name,i)=>lists(values.filter((_,j)=>i!==j)).map(tail=>[name,...tail]))];
  const inputs = lists(['a','b','c']);
  for (const local of inputs) for (const incoming of inputs) {
    const f = fixture(local), document = bp(incoming.map(pkg));
    const p = await preview(f, document), expected = [...local, ...incoming.filter(name=>!local.includes(name))];
    assert.deepEqual(p.blockers, []); assert.deepEqual(p.order, expected);
    assert.ok(p.operations.every(op=>op.type==='install'||op.enabled===true));
    if (p.planId) assert.equal((await f.engine.apply(p.planId)).status, 'applied');
    assert.deepEqual(f.state.order, expected);
    assert.equal((await preview(f, document)).planId, null);
  }
});
test('exactly 64 container levels are accepted', () => {
  assert.doesNotThrow(() => parseJson('['.repeat(64) + '0' + ']'.repeat(64)));
  assert.throws(() => parseJson('['.repeat(65) + '0' + ']'.repeat(65)));
});
test('unchanged imports do not consume plan capacity', async () => {
  const f = fixture();
  for (let i = 0; i < 12; i++) assert.equal((await preview(f, bp([pkg('example-a')]))).planId, null);
  assert.equal(f.engine.plans.size, 0);
});
test('non-blueprint documents fail before any host read or write', async () => {
  const f = fixture(); f.port.snapshot = () => { throw new Error('Host must not be read'); };
  for (const value of [{kind:'dsh-settings',formatVersion:1,metadata:{name:'old',version:'1.0.0'},settings:[]},
    {...bp(),settings:[]}, {...bp(),rows:[]}]) {
    await assert.rejects(() => preview(f,value), error => ['shape','version'].includes(error.code));
  }
  assert.deepEqual(f.calls, []);
});
test('removed export parameters cannot reactivate a settings path', async () => {
  const f = fixture();
  for (const extra of [{mode:'settings'}, {forms:[]}, {omit:[]}]) {
    await assert.rejects(() => f.engine.generate({name:'x',packages:[],...extra}), /Invalid export request/);
  }
  await assert.rejects(() => f.engine.preview({text:encode(bp()),mode:'settings'}), /Invalid preview request/);
  assert.deepEqual(f.calls, []);
});
test('invalid document roots fail with a bounded validation error', () => {
  for (const value of [null,false,1,'x',[]]) assert.throws(()=>validate(value),error=>error.code==='shape');
});

test('blueprint revision is rejected while exact package versions remain required', () => {
  const document = bp([pkg('a')]);
  assert.deepEqual(validate(document).metadata, {name:'中文测试'});
  assert.throws(()=>validate({...document,metadata:{...document.metadata,version:'1.0.0'}}), {code:'shape'});
  assert.throws(()=>validate(bp([{...pkg('a'),version:'latest'}])), {code:'package'});
});

for (const stop of ['abort','dispose']) for (const stage of ['initial snapshot','inspect','final snapshot']) {
  test(`${stop} during ${stage} stops preview and cannot save a late plan`, async () => {
    const f=fixture([]), caller=new AbortController();
    let release, started, reads=0, inspections=0, nativeSignal;
    const ready=new Promise(resolve=>{started=resolve;});
    const pause=()=>{started();return new Promise(resolve=>{release=resolve;});};
    const snapshot=f.port.snapshot;
    f.port.snapshot=async()=>{
      reads++;
      if ((stage==='initial snapshot'&&reads===1)||(stage==='final snapshot'&&reads===2)) await pause();
      return snapshot();
    };
    f.port.inspect=async(spec,signal)=>{
      inspections++; nativeSignal=signal;
      if (stage==='inspect'&&inspections===1) await pause(); // Intentionally ignores abort until it resolves.
      return {status:'accepted',bundle:true,name:spec.split('@')[0],version:'1.2.3'};
    };
    const running=f.engine.preview({text:encode(bp([pkg('a'),pkg('b')]))},caller.signal);
    const rejected=assert.rejects(running,{name:'AbortError'});
    await ready;
    if(stop==='abort')caller.abort();else f.engine.dispose();
    if(nativeSignal)assert.equal(nativeSignal.aborted,true);
    release();await rejected;
    assert.equal(inspections,stage==='initial snapshot'?0:stage==='inspect'?1:2);
    assert.equal(f.engine.plans.size,0);assert.equal(f.engine.results.size,0);assert.deepEqual(f.calls,[]);
    if(stop==='dispose')await assert.rejects(()=>preview(f,bp()),{name:'AbortError'});
  });
}

test('already cancelled preview performs no host reads', async () => {
  const f=fixture();f.port.snapshot=()=>{assert.fail('no host access');};
  await assert.rejects(()=>f.engine.preview({text:encode(bp())},AbortSignal.abort()),{name:'AbortError'});
});

test('disposing an in-flight apply cancels native work and never repopulates results', async () => {
  const f=fixture([]),p=await preview(f,bp([pkg('a')]));
  let release,started,signal;const ready=new Promise(resolve=>{started=resolve;});
  f.port.execute=async(_op,s)=>{signal=s;started();await new Promise(resolve=>{release=resolve;});return {application:'cancelled'};};
  const running=f.engine.apply(p.planId);await ready;f.engine.dispose();
  assert.equal(signal.aborted,true);release();assert.equal((await running).status,'cancelled');
  assert.equal(f.engine.plans.size,0);assert.equal(f.engine.results.size,0);
});
