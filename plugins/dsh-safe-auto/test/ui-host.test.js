import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, inject, registerControlRoute } from '../src/ui-host.js';
import { parseConfig } from '../src/config.js';

function request(method, url, body, headers = {}) {
  return { method, url, headers, destroyed: false, destroy() { this.destroyed = true; },
    async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(body); } };
}

function response() {
  const listeners = [];
  return { status: 0, headers: {}, body: '', destroyed: false, writableEnded: false,
    writeHead(status, headers = {}) { this.status = status; this.headers = headers; },
    end(body = '') { this.body = String(body); this.writableEnded = true; listeners.forEach(fn => fn()); },
    on(_event, fn) { listeners.push(fn); },
  };
}

async function roundTrip(handler, req) {
  const res = response();
  await handler(req, res);
  return res;
}

function envelope(method, payload) {
  return JSON.stringify({ type: 'client-request', rpcId: 'r', method, payload });
}

test('UI host mounts an authenticated route and disposes control without model calls', async () => {
  const disposers = []; const rows = new Map();
  let route, attached = false, closed = false, removed = false, rejections = 0;
  const ctx = {
    safeAutoRuntime: { base: parseConfig(), attach(control) { attached = true; assert.equal(control.settingsView().revision, 0); return () => { attached = false; }; } },
    storageDomain: { async open(spec) {
      assert.equal(spec.name, 'dsh_safe_auto');
      // Rows saved by 0.1.x carry retired keys; they strip on load instead of breaking the panel.
      const legacy = spec.tables.settings.valueSchema.safeParse({ revision: 0, values: { mode: 'unattended', fastModel: 'm' } });
      assert.equal(legacy.success, true);
      assert.deepEqual(legacy.data.values, {});
      assert.equal(spec.tables.settings.valueSchema.safeParse({ revision: 0, values: { provider: 'p', model: 'm' } }).success, true);
      assert.equal(spec.tables.settings.valueSchema.safeParse({ revision: 0, values: { provider: 1 } }).success, false);
      return { table: () => ({ get: k => rows.get(k), put: async (k, v) => rows.set(k, v) }), close: async () => { closed = true; } };
    } },
    connection: { requestRejection() { rejections++; return undefined; } },
    webServer: { register(value) { route = value; return () => { removed = true; }; } },
    permissionPresets: { catalog: () => ({ options: [] }) }, sandboxPolicy: {}, sessions: {},
    effect(fn) { disposers.push(fn()); },
  };
  await apply(ctx);
  assert.ok(inject.includes('webServer'));
  assert.equal(route.kind, 'prefix');
  assert.equal(route.path, '/dsh-safe-auto');
  assert.equal(attached, true);
  const ok = await roundTrip(route.handler, request('POST', '/dsh-safe-auto/settings.get', envelope('settings.get', {}), { 'content-type': 'application/json' }));
  assert.equal(ok.status, 200);
  assert.equal(JSON.parse(ok.body).result.ok, true);
  const rejected = await roundTrip(route.handler, request('POST', '/dsh-safe-auto/settings.save', envelope('settings.save', { expectedRevision: 0, values: { mode: 'smart' } }), { 'content-type': 'application/json' }));
  assert.equal(JSON.parse(rejected.body).result.ok, false);
  assert.equal(rejections, 2);
  for (const dispose of disposers.reverse()) await dispose();
  assert.equal(attached, false); assert.equal(closed, true); assert.equal(removed, true);
});

test('control route fails closed and rejects malformed requests before the handler', async () => {
  const calls = [];
  const mount = rejection => {
    let route;
    registerControlRoute({
      connection: { requestRejection: () => rejection },
      webServer: { register(value) { route = value; return () => {}; } },
    }, async (endpoint, payload) => { calls.push([endpoint, payload]); return { ok: true, value: {} }; });
    return route;
  };
  const admitted = mount(undefined);
  assert.equal((await roundTrip(admitted.handler, request('POST', '/dsh-safe-auto/settings.get', envelope('settings.get', {}), { 'content-type': 'application/json' }))).status, 200);
  const forbidden = mount(403);
  assert.equal((await roundTrip(forbidden.handler, request('POST', '/dsh-safe-auto/settings.get', envelope('settings.get', {}), { 'content-type': 'application/json' }))).status, 403);
  const unauthenticated = mount(401);
  assert.equal((await roundTrip(unauthenticated.handler, request('POST', '/dsh-safe-auto/settings.get', '{}', { 'content-type': 'application/json' }))).status, 401);
  let unavailable;
  registerControlRoute({ connection: {}, webServer: { register(value) { unavailable = value; return () => {}; } } }, async () => ({ ok: true, value: {} }));
  assert.equal((await roundTrip(unavailable.handler, request('POST', '/dsh-safe-auto/settings.get', envelope('settings.get', {}), { 'content-type': 'application/json' }))).status, 503);
  assert.equal((await roundTrip(admitted.handler, request('GET', '/dsh-safe-auto/settings.get', envelope('settings.get', {}), { 'content-type': 'application/json' }))).status, 404);
  assert.equal((await roundTrip(admitted.handler, request('POST', '/dsh-safe-auto/settings.get/extra', envelope('settings.get', {}), { 'content-type': 'application/json' }))).status, 404);
  assert.equal((await roundTrip(admitted.handler, request('POST', '/dsh-safe-auto/settings.get', envelope('settings.get', {}), { 'content-type': 'text/plain' }))).status, 415);
  assert.equal((await roundTrip(admitted.handler, request('POST', '/dsh-safe-auto/settings.get', '{', { 'content-type': 'application/json' }))).status, 400);
  assert.equal((await roundTrip(admitted.handler, request('POST', '/dsh-safe-auto/settings.get', envelope('other', {}), { 'content-type': 'application/json' }))).status, 400);
  assert.deepEqual(calls, [['settings.get', {}]]);
});

for (const saveOutcome of ['saved', 'failed']) {
  test(`UI unload drains an in-flight ${saveOutcome} write and rejects queued native permission changes`, async () => {
    const write = Promise.withResolvers();
    const started = Promise.withResolvers();
    const disposers = [], changes = [], rows = new Map();
    let route, attached = false, closed = false, removed = false, invalidations = 0;
    let current = 'workspace-write';
    const session = { id: 's', seq: 0, header: { id: 's' }, snapshotEvents: () => [] };
    const specs = { 'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
      'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' } };
    const ctx = {
      safeAutoRuntime: {
        base: parseConfig({ provider: 'p', model: 'm' }),
        attach() { attached = true; return () => { attached = false; }; },
        invalidateApprovals() { invalidations++; },
      },
      storageDomain: { async open() { return {
        table: () => ({ get: key => rows.get(key), async put(key, value) {
          started.resolve(); await write.promise; rows.set(key, value);
        } }),
        async close() { closed = true; },
      }; } },
      permissionPresets: {
        catalog: () => ({ options: Object.keys(specs).map(value => ({ value })) }),
        resolve: value => specs[value], current: () => current,
        set(_session, value) { current = value; changes.push({ value, attached }); },
      },
      sandboxPolicy: { resolve: () => ({ mode: specs[current].sandbox }) },
      sessions: { get: () => session, list: () => [session] },
      connection: { requestRejection: () => undefined },
      webServer: { register(value) { route = value; return () => { removed = true; }; } },
      effect(fn) { disposers.push(fn()); },
    };
    await apply(ctx);
    const call = (endpoint, payload) => roundTrip(route.handler, request('POST', `/dsh-safe-auto/${endpoint}`,
      envelope(endpoint, payload), { 'content-type': 'application/json', 'sec-fetch-mode': 'cors' }));
    const saving = call('settings.save', { expectedRevision: 0, values: { model: 'new' } });
    await started.promise;
    const selecting = call('session.select', { sessionId: 's', expectedRevision: '0:0', value: 'danger-full-access' });
    await new Promise(setImmediate);
    const unloading = (async () => { for (const dispose of disposers.reverse()) await dispose(); })();
    await new Promise(setImmediate);
    assert.equal(attached, false); assert.equal(removed, true); assert.equal(closed, false);
    assert.deepEqual(changes, []);
    if (saveOutcome === 'saved') write.resolve();
    else write.reject(new Error('storage write failed'));
    const [saveResponse, selectResponse] = await Promise.all([saving, selecting, unloading]);
    assert.equal(JSON.parse(saveResponse.body).result.ok, false);
    assert.match(JSON.parse(selectResponse.body).result.error.message, /unloaded/);
    assert.equal(closed, true); assert.equal(invalidations, 0);
    assert.equal(current, 'workspace-write'); assert.deepEqual(changes, []);
    assert.equal(rows.has('reviewer'), saveOutcome === 'saved');
    // A previously admitted request whose body arrives late must also be rejected.
    const late = await call('approval.answer', { sessionId: 's' });
    assert.equal(JSON.parse(late.body).result.ok, false);
  });
}

test('approval endpoints admit browser and authenticated desktop fetches, rejecting incomplete or hostile metadata', async () => {
  const calls = []; let route;
  registerControlRoute({ connection: { requestRejection: () => undefined }, webServer: { register(value) { route = value; } } },
    async (endpoint, payload, _signal, source) => { calls.push({ endpoint, payload, source }); return { ok: true, value: { accepted: true } }; });
  const browserHeaders = { 'content-type': 'application/json', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'empty' };
  const body = envelope('approval.answer', { sessionId: 's', requestId: 'one', outcome: 'allow' });
  for (const headers of [{ 'content-type': 'application/json' }, { ...browserHeaders, 'sec-fetch-site': 'cross-site' },
    { ...browserHeaders, 'sec-fetch-site': 'none' }, { ...browserHeaders, 'sec-fetch-site': '' },
    { ...browserHeaders, 'sec-fetch-site': undefined, origin: 'http://localhost' },
    { ...browserHeaders, 'sec-fetch-mode': undefined }, { ...browserHeaders, 'sec-fetch-dest': undefined },
    { ...browserHeaders, 'sec-fetch-mode': 'navigate' }, { ...browserHeaders, 'sec-fetch-dest': 'document' },
    { 'content-type': 'application/json', 'sec-fetch-mode': 'navigate' },
    { 'content-type': 'application/json', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'document' },
    { 'content-type': 'application/json', 'sec-fetch-mode': 'cors', origin: 'http://localhost' }]) {
    assert.equal((await roundTrip(route.handler, request('POST', '/dsh-safe-auto/approval.answer', body, headers))).status, 403);
  }
  assert.equal(calls.length, 0);
  assert.equal((await roundTrip(route.handler, request('POST', '/dsh-safe-auto/approval.answer', body, browserHeaders))).status, 200);
  assert.deepEqual(calls[0].source, { interaction: true });
  assert.equal(calls[0].payload.outcome, 'allow');
  const desktopHeaders = { ...browserHeaders };
  delete desktopHeaders['sec-fetch-site'];
  // Electron protocol Request omits Fetch Metadata; the desktop Node fetch
  // adds only mode=cors. Older carriers may also retain dest=empty.
  for (const headers of [desktopHeaders, { 'content-type': 'application/json', 'sec-fetch-mode': 'cors' }]) {
    for (const endpoint of ['approval.list', 'approval.answer']) {
      assert.equal((await roundTrip(route.handler, request('POST', `/dsh-safe-auto/${endpoint}`,
        envelope(endpoint, { sessionId: 's', requestId: 'one', outcome: 'allow' }), headers))).status, 200);
    }
  }
  assert.deepEqual(calls.slice(1).map(call => [call.endpoint, call.source]),
    [['approval.list', { interaction: true }], ['approval.answer', { interaction: true }],
      ['approval.list', { interaction: true }], ['approval.answer', { interaction: true }]]);
});

test('desktop approval requests cannot bypass Host authentication or origin rejection', async () => {
  const headers = { 'content-type': 'application/json', 'sec-fetch-mode': 'cors' };
  for (const rejection of [401, 403]) {
    let route;
    registerControlRoute({ connection: { requestRejection: () => rejection }, webServer: { register(value) { route = value; } } },
      async () => { assert.fail('Host-rejected approvals must never reach the runtime'); });
    for (const endpoint of ['approval.list', 'approval.answer']) {
      assert.equal((await roundTrip(route.handler, request('POST', `/dsh-safe-auto/${endpoint}`,
        envelope(endpoint, { sessionId: 's' }), headers))).status, rejection);
    }
  }
});
