import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createControl } from '../src/control.js';
import { parseConfig } from '../src/config.js';
import { apply } from '../src/index.js';

function fixture(extra = {}) {
  const root = resolve('workspace');
  const events = [];
  const session = { header: { cwd: root }, get seq() { return events.length; }, snapshotEvents: () => events };
  let current = 'workspace-write';
  const specs = { 'read-only': { sandbox: 'read-only', approval: 'ask' }, 'workspace-write': { sandbox: 'workspace-write', approval: 'ask' }, 'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' } };
  const saved = new Map();
  const table = { get: key => saved.get(key), put: async (key, value) => saved.set(key, structuredClone(value)) };
  const presets = { catalog: () => ({ options: Object.keys(specs).map(value => ({ value, name: value })) }),
    resolve: value => specs[value], current: () => current,
    set(_session, value) { if (current === value) return; current = value; events.push({ type: 'permission/preset', data: { preset: value } }); } };
  const sandboxPolicy = { resolve: () => ({ mode: specs[current].sandbox, workspaceRoot: root }) };
  const base = parseConfig({ workspaceRoots: [root], shellCandidates: ['git status'], fastProvider: 'p', fastModel: 'm', ...extra });
  const options = { table, presets, sandboxPolicy, sessions: { get: id => id === 's' ? session : undefined } };
  const control = createControl(base, options);
  const select = async value => control.call('session.select', { sessionId: 's', expectedRevision: (await control.call('session.get', { sessionId: 's' })).revision, value });
  return { base, control, select, session, events, root, options };
}

test('reads never enable Auto or persist; selection keeps workspace-write and ask', async () => {
  const f = fixture();
  const before = await f.control.call('session.get', { sessionId: 's' });
  assert.equal(before.safeAuto, false); assert.equal(f.events.length, 0);
  const after = await f.select('safe-auto');
  assert.equal(after.current, 'safe-auto'); assert.equal(f.options.presets.current(), 'workspace-write');
  assert.equal(f.options.presets.resolve('workspace-write').approval, 'ask');
  assert.equal(f.control.config(f.session).mode, 'smart');
});
test('native exit disables review even with legacy smart profile', async () => {
  const f = fixture({ mode: 'smart' });
  await f.select('safe-auto'); await f.select('read-only');
  assert.equal(f.control.state(f.session).active, false);
  assert.equal(f.control.config(f.session).mode, 'off');
});
test('external permission changes revoke selection; reselect has a new generation', async () => {
  const f = fixture(); await f.select('safe-auto'); const old = f.control.state(f.session);
  f.events.push({ type: 'approval/policy', data: { policy: 'never' } });
  assert.equal(f.control.state(f.session).active, false);
  await f.select('safe-auto'); assert.notEqual(f.control.state(f.session).revision, old.revision);
});
test('restored controls and other sessions never inherit UI activation', async () => {
  const f = fixture(); await f.select('safe-auto');
  assert.equal(createControl(f.base, f.options).state(f.session).active, false);
  assert.equal(f.control.state({ ...f.session }).active, false);
});
test('stale selections and children reject without changing native mode', async () => {
  const f = fixture(); f.events.push({ type: 'user/message' });
  await assert.rejects(f.control.call('session.select', { sessionId: 's', expectedRevision: 0, value: 'safe-auto' }), /changed/);
  f.session.header.origin = 'subagent'; await assert.rejects(f.select('safe-auto'), /Child/);
  assert.equal(f.events.length, 1);
});
test('settings save is revision checked, persisted, and cannot expand envelope', async () => {
  const f = fixture();
  await assert.rejects(f.control.call('settings.save', { expectedRevision: 0, values: { mode: 'unattended' } }), /Only reviewer/);
  const saved = await f.control.call('settings.save', { expectedRevision: 0, values: { fastProvider: 'new', fastModel: 'small', fastReasoningEffort: 'low', reviewerPrompt: 'Require reversible effects.' } });
  assert.equal(saved.revision, 1);
  assert.equal(f.control.config(f.session).fastReasoningEffort, 'low');
  assert.deepEqual(f.control.config(f.session).workspaceRoots, [f.root]);
  assert.deepEqual(createControl(f.base, f.options).settingsView(), saved);
  await assert.rejects(f.control.call('settings.save', { expectedRevision: 0, values: {} }), /changed/);
});
test('explicit off profile cannot be enabled from menu', async () => {
  const f = fixture({ mode: 'off' }); await assert.rejects(f.select('safe-auto'), /disabled/);
});
test('native no-op switches still reject stale concurrent activation', async () => {
  const f = fixture(); const enabled = await f.select('safe-auto');
  const results = await Promise.allSettled(['workspace-write', 'safe-auto'].map(value => f.control.call('session.select', { sessionId: 's', expectedRevision: enabled.revision, value })));
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
  assert.equal(f.control.state(f.session).active, false);
  assert.equal(f.session.seq, 0);
});
test('legacy global modes stay inactive until explicit UI selection', () => {
  for (const mode of ['smart', 'unattended']) {
    const f = fixture({ mode }); assert.equal(f.control.config(f.session).mode, 'off');
  }
});
test('settings changes invalidate pending grants without refilling reviewer budget', async t => {
  const f = fixture({ fastCallsPerTask: 1 });
  f.events.push({ type: 'user/message', seq: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Inspect status' }] } });
  const handlers = {}, disposers = []; let runtime, guard, calls = 0;
  const ctx = { provide(_key, value) { runtime = value; }, tools: { guard(fn) { guard = fn; } },
    sandboxPolicy: f.options.sandboxPolicy, logger: { info() {} }, on(event, fn) { handlers[event] = fn; }, effect(fn) { disposers.push(fn()); },
    inject(_deps, fn) { fn({ effect: ctx.effect, llm: { async *stream() { calls++; yield { type: 'block-end', index: 0, block: { type: 'text', text: '{"decision":"allow"}' } }; yield { type: 'finish', reason: { kind: 'stop' } }; } } }); } };
  apply(ctx, f.base); const detach = runtime.attach(f.control);
  t.after(() => { detach(); disposers.reverse().forEach(fn => fn()); });
  await f.select('safe-auto');
  const exec = () => ({ token: Symbol(), name: 'bash', arguments: { command: 'git status' }, agent: { session: f.session }, callId: 'one', signal: new AbortController().signal });
  const first = exec(); assert.equal((await handlers['tools/pre-execute'](first, async () => ({ kind: 'allow' }))).kind, 'allow');
  await f.control.call('settings.save', { expectedRevision: 0, values: { reviewerPrompt: 'Be cautious.' } });
  assert.match(guard(first), /SETTINGS_CHANGED/);
  assert.equal((await handlers['tools/pre-execute'](exec(), async () => ({ kind: 'allow' }))).kind, 'ask');
  assert.equal(calls, 1);
  detach();
  const afterDetach = exec();
  assert.equal((await handlers['tools/pre-execute'](afterDetach, async () => ({ kind: 'allow' }))).kind, 'allow');
  assert.equal(guard(afterDetach), undefined);
  assert.equal(calls, 1, 'detaching controls never restores legacy automatic review');
});
