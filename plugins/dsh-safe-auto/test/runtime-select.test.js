import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../src/index.js';
import { parseConfig } from '../src/config.js';
import { createControl } from '../src/control.js';

function fixture() {
  let runtime;
  const disposers = [];
  const ctx = {
    provide(key, value) { assert.equal(key, 'safeAutoRuntime'); runtime = value; },
    inject() {},
    effect(fn) { disposers.push(fn()); },
    storageDomain: { async open() {
      return {
        table: () => ({
          get: () => undefined,
          entries: () => [][Symbol.iterator](),
          put: async () => {},
          update: async () => {},
        }),
        close: async () => {},
      };
    } },
    on() {},
    workingDirectory: { get: () => '/w' },
    sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: '/w' }) },
    logger: { info() {} },
  };
  apply(ctx, { provider: 'p', model: 'm' });
  return { runtime, disposers };
}

function controlFixture() {
  const events = [];
  const session = { id: 's', header: { id: 's' }, get seq() { return events.length; }, snapshotEvents: () => events };
  let current = 'workspace-write';
  const specs = {
    'read-only': { sandbox: 'read-only', approval: 'ask' },
    'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
  };
  const remembered = new Map();
  const live = new Map([['s', session]]);
  const control = createControl(parseConfig({ provider: 'p', model: 'm' }), {
    table: { get: () => undefined, put: async () => {} },
    recentTable: { get: key => remembered.get(key), put: async (key, value) => remembered.set(key, structuredClone(value)) },
    presets: {
      catalog: () => ({ options: Object.keys(specs).map(value => ({ value, name: value })) }),
      resolve: value => specs[value],
      current: () => current,
      set(_session, value) { current = value; },
    },
    sandboxPolicy: { resolve: () => ({ mode: specs[current].sandbox }) },
    sessions: { get: id => live.get(id), list: () => [...live.values()] },
  });
  const fresh = id => {
    const next = { id, header: { id }, get seq() { return events.length; }, snapshotEvents: () => events };
    live.set(id, next);
    return next;
  };
  return { control, remembered, fresh };
}

test('public runtime selection API fails closed before attach and after detach', async () => {
  const f = fixture();
  const unavailable = async () => {
    assert.equal(f.runtime.available(), false);
    assert.equal(f.runtime.sessionActive('s'), false);
    await assert.rejects(f.runtime.selectSession('s'), /controls are not loaded/);
  };
  await unavailable();
  const owner = {
    config: () => parseConfig({ provider: 'p', model: 'm', enabled: true }),
    state: () => ({ active: true, revision: '0:0' }),
    available: () => true,
    select: async id => { assert.equal(id, 's'); return true; },
    sessionActive: id => id === 's',
  };
  const detach = f.runtime.attach(owner);
  assert.equal(f.runtime.available(), true);
  assert.equal(await f.runtime.selectSession('s'), true);
  assert.equal(f.runtime.sessionActive('s'), true);
  detach();
  await unavailable();
  await Promise.all(f.disposers.map(dispose => dispose()));
});

test('opening a runtime-selected task does not change new-chat inheritance', async () => {
  const f = controlFixture();
  await f.control.select('s');
  await f.control.call('session.open', { sessionId: 's' });
  assert.equal(f.remembered.has('lastSelection'), false);
  const next = f.fresh('next');
  assert.equal(await f.control.seedSession({ session: next }, 'startup'), false);
  assert.equal(f.control.config(next).enabled, false);
});

test('an explicit Safe Auto choice still replaces runtime-only selection and is remembered', async () => {
  const f = controlFixture();
  await f.control.select('s');
  await f.control.call('session.select', {
    sessionId: 's',
    expectedRevision: (await f.control.call('session.get', { sessionId: 's' })).revision,
    value: 'safe-auto',
  });
  await f.control.call('session.open', { sessionId: 's' });
  assert.equal(f.remembered.get('lastSelection').value, 'safe-auto');
  const next = f.fresh('next');
  assert.equal(await f.control.seedSession({ session: next }, 'startup'), true);
  assert.equal(f.control.config(next).enabled, true);
});
