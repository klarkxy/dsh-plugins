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
