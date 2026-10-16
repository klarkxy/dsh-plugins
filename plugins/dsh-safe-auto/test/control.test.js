import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createControl } from '../src/control.js';
import { parseConfig } from '../src/config.js';

function fixture(extra = {}) {
  const root = resolve('workspace');
  const events = [];
  const session = { id: 's', header: { id: 's', cwd: root, createdAt: 1, isSeeded: false }, get seq() { return events.length; }, snapshotEvents: () => events };
  let current = 'workspace-write';
  const specs = { 'read-only': { sandbox: 'read-only', approval: 'ask' }, 'workspace-write': { sandbox: 'workspace-write', approval: 'ask' }, 'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' } };
  const saved = new Map();
  const table = { get: key => saved.get(key), put: async (key, value) => saved.set(key, structuredClone(value)) };
  const presets = { catalog: () => ({ options: Object.keys(specs).map(value => ({ value, name: value })) }),
    resolve: value => specs[value], current: () => current,
    set(_session, value) { if (current === value) return; current = value; events.push({ type: 'permission/preset', data: { preset: value } }); } };
  const sandboxPolicy = { resolve: () => ({ mode: specs[current].sandbox, workspaceRoot: root }) };
  const base = parseConfig({ provider: 'p', model: 'm', ...extra });
  const live = new Map([['s', session]]);
  const options = { table, presets, sandboxPolicy, sessions: { get: id => live.get(id), list: () => [...live.values()] } };
  const control = createControl(base, options);
  const select = async value => control.call('session.select', { sessionId: 's', expectedRevision: (await control.call('session.get', { sessionId: 's' })).revision, value });
  return { base, control, select, session, events, root, options, live, specs };
}

test('durable cancelled settings writes notify the adopted revision despite failing observers', async () => {
  const f = fixture(); const revisions = [];
  const abort = new AbortController();
  const put = f.options.table.put;
  const control = createControl(f.base, { ...f.options,
    table: { ...f.options.table, put: async (...args) => { await put(...args); abort.abort(); } },
    onSettingsChanged: revision => { revisions.push(revision); throw new Error('observer failed'); } });
  await assert.rejects(control.call('settings.save', { expectedRevision: 0, values: { provider: 'ocg', model: 'mimo-v2.6-flash' } }, abort.signal));
  assert.deepEqual(revisions, [1]);
  assert.equal(control.settingsView().values.model, 'mimo-v2.6-flash');
  await control.dispose(); await f.control.dispose();
});

test('reads never enable Auto or persist; selection keeps workspace-write and ask', async () => {
  const f = fixture();
  const before = await f.control.call('session.get', { sessionId: 's' });
  assert.equal(before.safeAuto, false); assert.equal(f.events.length, 0);
  assert.equal(f.control.config(f.session).enabled, false);
  const after = await f.select('safe-auto');
  assert.equal(after.current, 'safe-auto'); assert.equal(f.options.presets.current(), 'workspace-write');
  assert.equal(f.options.presets.resolve('workspace-write').approval, 'ask');
  assert.equal(f.control.config(f.session).enabled, true);
});
test('native exit disables review', async () => {
  const f = fixture();
  await f.select('safe-auto'); await f.select('read-only');
  assert.equal(f.control.state(f.session).active, false);
  assert.equal(f.control.config(f.session).enabled, false);
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
test('turn activity does not invalidate the selection revision; switching applies mid-turn', async () => {
  const f = fixture();
  const before = await f.control.call('session.get', { sessionId: 's' });
  // A running turn appends conversation events; the optimistic lock must ignore them.
  f.events.push({ type: 'turn/start', data: { turn: 1 } });
  f.events.push({ type: 'user/message' });
  f.events.push({ type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'pwsh', arguments: '{}' } });
  const after = await f.control.call('session.get', { sessionId: 's' });
  assert.equal(after.revision, before.revision);
  const selected = await f.control.call('session.select', { sessionId: 's', expectedRevision: before.revision, value: 'safe-auto' });
  assert.equal(selected.safeAuto, true);
  assert.equal(f.control.config(f.session).enabled, true);
});
test('permission events still invalidate the selection revision', async () => {
  const f = fixture();
  const before = await f.control.call('session.get', { sessionId: 's' });
  f.events.push({ type: 'sandbox/mode', data: { mode: 'read-only' } });
  f.options.sandboxPolicy = { resolve: () => ({ mode: 'read-only', workspaceRoot: f.root }) };
  const after = await f.control.call('session.get', { sessionId: 's' });
  assert.notEqual(after.revision, before.revision);
  await assert.rejects(f.control.call('session.select', { sessionId: 's', expectedRevision: before.revision, value: 'safe-auto' }), /changed/);
});
test('settings save is revision checked, persisted, and limited to reviewer fields', async () => {
  const f = fixture();
  await assert.rejects(f.control.call('settings.save', { expectedRevision: 0, values: { enabled: false } }), /Only reviewer/);
  await assert.rejects(f.control.call('settings.save', { expectedRevision: 0, values: { maxReviewsPerTask: 1 } }), /Only reviewer/);
  const saved = await f.control.call('settings.save', { expectedRevision: 0, values: { provider: 'new', model: 'small', reasoningEffort: 'low', reviewerPrompt: 'Require reversible effects.' } });
  assert.equal(saved.revision, 1);
  assert.equal(f.control.config(f.session).reasoningEffort, 'low');
  assert.equal(f.control.config(f.session).provider, 'new');
  assert.deepEqual(createControl(f.base, f.options).settingsView(), saved);
  await assert.rejects(f.control.call('settings.save', { expectedRevision: 0, values: {} }), /changed/);
});
test('explicit disabled profile cannot be enabled from the panel', async () => {
  const f = fixture({ enabled: false }); await assert.rejects(f.select('safe-auto'), /disabled/);
});

test('disposing control revokes activation and rejects later work; fresh control stays independent', async () => {
  const f = fixture();
  await f.select('safe-auto');
  await f.control.dispose();
  await f.control.dispose();
  assert.equal(f.control.state(f.session).active, false);
  assert.equal(f.control.config(f.session).enabled, false);
  await assert.rejects(f.control.call('session.get', { sessionId: 's' }), /unloaded/);
  const fresh = createControl(f.base, f.options);
  assert.equal((await fresh.call('session.get', { sessionId: 's' })).safeAuto, false);
  await fresh.dispose();
});

test('request cancellation rejects queued permissions without cancelling another settings save', async () => {
  const f = fixture();
  const write = Promise.withResolvers();
  const started = Promise.withResolvers();
  const originalPut = f.options.table.put;
  f.options.table.put = async (...args) => { started.resolve(); await write.promise; await originalPut(...args); };
  const saving = f.control.call('settings.save', { expectedRevision: 0, values: { model: 'new' } });
  await started.promise;
  const request = new AbortController();
  const selecting = assert.rejects(f.control.call('session.select', {
    sessionId: 's', expectedRevision: '0:0', value: 'danger-full-access',
  }, request.signal), { name: 'AbortError' });
  request.abort();
  write.resolve();
  assert.equal((await saving).revision, 1);
  await selecting;
  assert.equal(f.options.presets.current(), 'workspace-write');
  await f.control.dispose();
});
test('native no-op switches still reject stale concurrent activation', async () => {
  const f = fixture(); const enabled = await f.select('safe-auto');
  const results = await Promise.allSettled(['workspace-write', 'safe-auto'].map(value => f.control.call('session.select', { sessionId: 's', expectedRevision: enabled.revision, value })));
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
  assert.equal(f.control.state(f.session).active, false);
  assert.equal(f.session.seq, 0);
});
test('session list is read-only and includes only live roots without inherited activation', async () => {
  const f = fixture(); await f.select('safe-auto');
  const other = { ...f.session, id: 'other', header: { ...f.session.header, id: 'other' } };
  const child = { ...f.session, id: 'child', header: { ...f.session.header, id: 'child', parentSession: 's' } };
  const origin = { ...f.session, id: 'origin', header: { ...f.session.header, id: 'origin', origin: 'subagent' } };
  f.live.set(other.id, other); f.live.set(child.id, child); f.live.set(origin.id, origin);
  const seq = f.session.seq;
  const result = await f.control.call('session.list', {});
  assert.deepEqual(result.sessions.map(s => s.sessionId), ['s', 'other']);
  assert.equal(result.sessions[0].safeAuto, true); assert.equal(result.sessions[1].safeAuto, false);
  assert.deepEqual(result.sessions[0].header, f.session.header);
  assert.equal(f.control.state(child).active, false); assert.equal(f.session.seq, seq);
  f.live.delete('s'); assert.deepEqual((await f.control.call('session.list', {})).sessions.map(s => s.sessionId), ['other']);
  await assert.rejects(f.control.call('session.get', { sessionId: 's' }), /not active/);
});
test('independent disable changes only activation and rejects stale revisions', async () => {
  const f = fixture(); const enabled = await f.select('safe-auto');
  const before = f.session.seq;
  f.options.presets.set = () => assert.fail('disable must not change native permissions');
  const disabled = await f.control.call('session.disable', { sessionId: 's', expectedRevision: enabled.revision });
  assert.equal(disabled.safeAuto, false); assert.equal(disabled.current, 'workspace-write');
  assert.equal(f.session.seq, before); assert.equal(f.options.presets.resolve(disabled.current).approval, 'ask');
  await assert.rejects(f.control.call('session.disable', { sessionId: 's', expectedRevision: enabled.revision }), /changed/);
});
test('availability and policy limits are explicit read-only metadata', async () => {
  const f = fixture(); const view = f.control.settingsView();
  assert.equal(view.available, true); assert.equal(view.platform, process.platform);
  assert.deepEqual(view.values, { provider: 'p', model: 'm', reasoningEffort: '', reviewerPrompt: '' });
  assert.equal(view.policyLimits.readonly, true); assert.equal(view.policyLimits.sandbox, 'workspace-write');
  assert.equal(view.policyLimits.approval, 'ask'); assert.equal(view.policyLimits.escalationScope, 'this-call-only');
  assert.equal(view.policyLimits.timeoutMs, 90000); assert.equal(view.policyLimits.outputTokens, 4096);
  assert.equal(view.policyLimits.maxTranscriptBytes, 48000);
  assert.equal(Object.hasOwn(view.policyLimits, 'maxReviewsPerTask'), false);
  assert.equal(fixture({ enabled: false }).control.settingsView().available, false);
});
test('activation excludes official Auto even when it appears first in catalog', async () => {
  const f = fixture(); f.specs.auto = { sandbox: 'danger-full-access', approval: 'ask' };
  f.options.presets.catalog = () => ({ options: ['auto', 'workspace-write', 'danger-full-access'].map(value => ({ value, name: value })) });
  const set = f.options.presets.set;
  f.options.presets.set = (session, value) => { assert.equal(value, 'workspace-write'); set(session, value); };
  await f.select('safe-auto'); assert.equal(f.options.presets.current(), 'workspace-write');
});
