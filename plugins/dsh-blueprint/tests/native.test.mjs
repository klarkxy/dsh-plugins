import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { officialPort } from '../official.mjs';
import { BlueprintEngine } from '../engine.mjs';
import { apply, inject } from '../index.mjs';
import { PACKAGE } from '../blueprint.mjs';
import { decode, encode } from '../codec.mjs';
function fixture(t) {
  const profile = mkdtempSync(join(tmpdir(), 'dsh-blueprint-contract-'));
  t.after(() => rmSync(profile, { recursive: true, force: true }));
  const manifest = { dependencies: { 'example-a': '1.2.3', [PACKAGE]: '0.1.0' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'example-a', PACKAGE] } } };
  const save = () => writeFileSync(join(profile, 'package.json'), JSON.stringify(manifest)); save();
  const bundles = [
    { name: '@deepseek-ai/dsh-base', version: '0.1.7-rc.2', installed: false, optional: false, enabled: true, readOnlyReason: 'management-required', rows: [] },
    { name: 'example-a', version: '1.2.3', installed: true, optional: false, enabled: true, rows: [{ moduleName: 'example-a' }] },
    { name: PACKAGE, version: '0.1.0', installed: true, optional: false, enabled: true, rows: [{ moduleName: PACKAGE }] },
  ];
  const calls = [], disposers = [];
  let route, server, baseUrl;
  const ctx = {
    inject: () => {}, // Optional Creator and tool services are absent in this fixture.
    profileContext: { dir: profile },
    pluginManager: {
      listBundles: async () => bundles,
      inspect: async spec => ({ status: 'accepted', bundle: true, name: spec.slice(0, spec.lastIndexOf('@')), version: spec.slice(spec.lastIndexOf('@') + 1) }),
      installBundle: async (...args) => { calls.push(['install', ...args]); return { application: 'applied', changed: true, packageResult: { output: 'PRIVATE LOG', logPath: '/PRIVATE' } }; },
      cancelInstall: async (...args) => { calls.push(['cancel', ...args]); return { status: 'cancelled' }; },
      setBundleEnabled: async (...args) => { calls.push(['bundle', ...args]); return { application: 'applied', changed: true }; },
    },
    effect: factory => { const off = factory(); disposers.push(off); return off; },
    connection: { requestRejection: () => undefined },
    webServer: { register: value => { assert.equal(value.path, '/dsh-blueprint'); route = value; return () => { route = undefined; }; } },
  };
  for (const service of ['settings','loader','pluginPackages','credentials','storage']) {
    Object.defineProperty(ctx, service, { get() { throw new Error(service + ' must not be accessed'); } });
  }
  t.after(async () => { if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  const request = async (endpoint, payload, options = {}) => {
    if (!server) {
      server = createServer((req, res) => route ? void route.handler(req, res) : (res.writeHead(404), res.end()));
      server.listen(0, '127.0.0.1'); await once(server, 'listening');
      baseUrl = 'http://127.0.0.1:' + server.address().port;
    }
    return fetch(baseUrl + '/dsh-blueprint/' + endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'fixture', method: endpoint, payload }), ...options });
  };
  const rpc = async (...args) => (await (await request(...args)).json()).result;
  return { ctx, calls, manifest, save, bundles, disposers, port: officialPort(ctx), rpc, request };
}
test('local installation sources are not recast as npm', async t => {
  const f = fixture(t); f.manifest.dependencies['example-a'] = 'link:/private/plugin'; f.save();
  assert.equal((await f.port.snapshot()).packages.find(p => p.name === 'example-a').source, null);
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
  assert.equal((await f.request('catalog', {})).status, 404);
});
test('host declares only native runtime dependencies, no Spaces', () => {
  assert.deepEqual(inject, ['connection', 'webServer', 'pluginManager', 'profileContext']);
});
test('client registers list actions and a bundle-page fallback without a detail action', () => {
  let plugin; const registrations = [];
  vm.runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), { window: { __ModuleLoader__: { load: x => { plugin = x; } } } });
  assert.equal(plugin.id, PACKAGE);
  const client = plugin.factory(name => { assert.equal(name, 'react'); return { createElement: (...args) => ({ args }) }; });
  client.apply({ slots: { inject: (_slot, cb) => cb(), register: (options, render) => registrations.push({ options, render }) } });
  assert.ok(registrations.some(x => x.options.name === 'plugins.bundle.config' && x.options.key === PACKAGE));
  assert.ok(registrations.some(x => x.options.name === 'plugins.list.actions'));
  assert.equal(registrations.some(x => x.options.name === 'plugins.detail.actions'), false);
});
test('client page metadata cannot expand catalog, export or import scope', async t => {
  const f = fixture(t); apply(f.ctx);
  for (const endpoint of ['catalog', 'generate', 'preview']) {
    const reply = await f.rpc(endpoint, { pages: { bundles: ['example-a'], rows: [], items: [] } });
    assert.equal(reply.ok, false); assert.equal(reply.error.code, 'shape');
  }
  assert.equal(f.calls.length, 0);
});
test('native blueprint flow does not depend on settings, loader, storage or package policies', async t => {
  const f = fixture(t), engine = new BlueprintEngine(f.port), catalog = await engine.catalog();
  assert.deepEqual(Object.keys(catalog).sort(), ['order','packages']);
  assert.deepEqual(catalog.order, f.manifest.dsh.profile.bundles);
  assert.equal(catalog.packages.find(p=>p.name===PACKAGE).readonly,true);
  const out = await engine.generate({name:'demo',packages:['example-a']});
  assert.deepEqual(Object.keys(out),['code']); assert.equal(decode(out.code).settings,undefined);
  assert.equal((await engine.preview({text:out.code})).planId,null);
  await assert.rejects(()=>f.port.execute({type:'settings',row:'a',edits:[]},new AbortController().signal),/Unsupported operation/);
  await assert.rejects(()=>f.port.execute({type:'bundle',name:'example-a',enabled:false},new AbortController().signal),/Unsupported operation/);
  assert.deepEqual(f.calls, []);
});
test('removed settings requests are rejected over the actual HTTP handler', async t => {
  const f=fixture(t); apply(f.ctx);
  for (const [endpoint,payload] of [['catalog',{mode:'settings'}],['generate',{mode:'settings',name:'old',packages:[],forms:[]}],
    ['preview',{text:encode({kind:'dsh-settings',formatVersion:1,settings:[]})}]]) {
    const result=await f.rpc(endpoint,payload);assert.equal(result.ok,false);
    assert.ok(['shape','version'].includes(result.error.code));
  }
  assert.deepEqual(f.calls,[]);
});
test('native snapshot rejects a manifest changed while reading packages', async t=>{
  const f=fixture(t);f.ctx.pluginManager.listBundles=async()=>{f.manifest.dsh.profile.bundles.reverse();f.save();return f.bundles};
  await assert.rejects(()=>f.port.snapshot(),/Profile changed/);
});

for (const drift of ['none','version','source','order']) test(`native apply checks pending bundle identity and order after install: ${drift}`, async t => {
  const f = fixture(t), engine = new BlueprintEngine(f.port);
  f.bundles.push({name:'pending',version:'1.0.0',installed:true,optional:false,enabled:false,rows:[]});
  f.manifest.dependencies.pending = '1.0.0'; f.save();
  f.ctx.pluginManager.installBundle = async (spec, options) => {
    f.calls.push(['install',spec,options]);
    f.manifest.dependencies.missing = '1.0.0';
    f.bundles.push({name:'missing',version:'1.0.0',installed:true,optional:false,enabled:false,rows:[]});
    if(drift === 'version') f.bundles.find(p => p.name === 'pending').version = '2.0.0';
    if(drift === 'source') f.manifest.dependencies.pending = 'file:/replacement';
    if(drift === 'order') f.manifest.dsh.profile.bundles.reverse();
    f.save();
    return {application:'applied',changed:true};
  };
  f.ctx.pluginManager.setBundleEnabled = async (name, enabled) => {
    f.calls.push(['bundle',name,enabled]);
    f.bundles.find(p => p.name === name).enabled = enabled;
    f.manifest.dsh.profile.bundles.push(name); f.save();
    return {application:'applied',changed:true};
  };
  const plan = await engine.preview({text:encode({kind:'dsh-blueprint',formatVersion:2,metadata:{name:'pinned'},
    packages:['missing','pending'].map(name => ({name,version:'1.0.0',source:'npm'})),bundles:['pending']})});
  const result = await engine.apply(plan.planId);
  assert.equal(result.status, drift === 'none' ? 'applied' : 'verification-failed');
  assert.deepEqual(f.calls.map(c => c[0]), drift === 'none' ? ['install','bundle'] : ['install']);
  assert.equal(result.remaining, drift === 'none' ? 0 : 1);
});

for (const stop of ['disconnect','unload']) test(`${stop} cancels preview through HTTP and the native inspect signal`, {timeout:5000}, async t=>{
  const f=fixture(t);apply(f.ctx);
  let start,aborted,seen=0;
  const ready=new Promise(resolve=>{start=resolve;}),cancelled=new Promise(resolve=>{aborted=resolve;});
  f.ctx.pluginManager.inspect=async(_spec,options,signal)=>{
    seen++;assert.equal(options,undefined);assert.ok(signal instanceof AbortSignal);start();
    await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted();reject(signal.reason);},{once:true}));
    assert.fail('cancelled inspect must not complete');
  };
  const caller=new AbortController();
  const code=encode({kind:'dsh-blueprint',formatVersion:2,metadata:{name:'cancel'},
    packages:['missing-a','missing-b'].map(name=>({name,version:'1.0.0',source:'npm'})),bundles:[]});
  const pending=f.request('preview',{text:code},{signal:caller.signal}).catch(error=>error);
  await ready;
  if(stop==='disconnect')caller.abort();else f.disposers.forEach(off=>off?.());
  await cancelled;await pending;
  assert.equal(seen,1);assert.deepEqual(f.calls,[]);
});
