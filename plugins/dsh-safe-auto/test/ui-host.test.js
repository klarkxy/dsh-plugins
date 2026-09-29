import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../src/ui-host.js';
import { parseConfig } from '../src/config.js';

test('UI host declares validated storage, authenticated RPC and disposes control without model calls', async () => {
  const disposers = []; const rows = new Map();
  let registered, attached = false, closed = false, removed = false;
  const ctx = {
    safeAutoRuntime: { base: parseConfig(), attach(control) { attached = true; assert.equal(control.settingsView().revision, 0); return () => { attached = false; }; } },
    storageDomain: { async open(spec) {
      assert.equal(spec.name, 'dsh_safe_auto');
      assert.equal(spec.tables.settings.valueSchema.safeParse({ revision: 0, values: { mode: 'unattended' } }).success, false);
      return { table: () => ({ get: k => rows.get(k), put: async (k, v) => rows.set(k, v) }), close: async () => { closed = true; } };
    } },
    connection: { rpc: { handle(channel, handler) { assert.equal(channel, '/dsh-safe-auto'); registered = handler; return async () => { removed = true; }; } } },
    permissionPresets: {}, sandboxPolicy: {}, sessions: {},
    effect(fn) { disposers.push(fn()); },
  };
  await apply(ctx);
  assert.equal(attached, true);
  assert.equal((await registered('settings.get', {}, new AbortController().signal)).ok, true);
  assert.equal((await registered('settings.save', { expectedRevision: 0, values: { mode: 'smart' } }, new AbortController().signal)).ok, false);
  for (const dispose of disposers.reverse()) await dispose();
  assert.equal(attached, false); assert.equal(closed, true); assert.equal(removed, true);
});
