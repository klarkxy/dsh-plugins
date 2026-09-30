import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createControl } from '../src/control.js';
import { parseConfig } from '../src/config.js';
import { apply } from '../src/index.js';

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
  const base = parseConfig({ workspaceRoots: [root], shellCandidates: ['git status'], fastProvider: 'p', fastModel: 'm', ...extra });
  const live = new Map([['s', session]]);
  const options = { table, presets, sandboxPolicy, sessions: { get: id => live.get(id), list: () => [...live.values()] } };
  const control = createControl(base, options);
  const select = async value => control.call('session.select', { sessionId: 's', expectedRevision: (await control.call('session.get', { sessionId: 's' })).revision, value });
  return { base, control, select, session, events, root, options, live, specs };
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
test('availability and policy counts are explicit read-only metadata', async () => {
  const f = fixture(); const view = f.control.settingsView();
  assert.equal(view.available, true); assert.equal(view.platform, process.platform);
  assert.deepEqual(view.candidateCounts, { workspaceRoots: 1, shellCandidates: 1, escalationCandidates: 0 });
  assert.equal(view.policyLimits.readonly, true); assert.equal(view.policyLimits.sandbox, 'workspace-write');
  assert.equal(view.policyLimits.approval, 'ask');
  await assert.rejects(f.control.call('settings.save', { expectedRevision: 0, values: { shellCandidates: ['anything'] } }), /Only reviewer/);
  assert.equal(fixture({ mode: 'off' }).control.settingsView().available, false);
});
test('activation excludes official Auto even when it appears first in catalog', async () => {
  const f = fixture(); f.specs.auto = { sandbox: 'danger-full-access', approval: 'ask' };
  f.options.presets.catalog = () => ({ options: ['auto', 'workspace-write', 'danger-full-access'].map(value => ({ value, name: value })) });
  const set = f.options.presets.set;
  f.options.presets.set = (session, value) => { assert.equal(value, 'workspace-write'); set(session, value); };
  await f.select('safe-auto'); assert.equal(f.options.presets.current(), 'workspace-write');
});
function approvalFixture(t, reviewer, extra = {}) {
  const f = fixture({ approvalReview: true, ...extra });
  f.events.push({ type: 'user/message', seq: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Run git status to inspect the repository.' }] } });
  const handlers = {}, disposers = []; let runtime, guard, calls = 0;
  const ctx = { provide(_key, value) { runtime = value; }, tools: { guard(fn) { guard = fn; } },
    get(key) { if (key === 'permissionPresets') return { ...f.options.presets, names: Object.keys(f.specs), registerAuto() { assert.fail('official Auto forbidden'); } };
      if (key === 'fs') return { processPathFromHostPath: path => path }; },
    sandboxPolicy: f.options.sandboxPolicy, logger: { info() {} }, on(event, fn) { handlers[event] = fn; }, effect(fn) { disposers.push(fn()); },
    inject(_deps, fn) { fn({ effect: ctx.effect, llm: { async *stream() { calls++; const text = await reviewer(f);
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }; yield { type: 'finish', reason: { kind: 'stop' } }; } } }); } };
  apply(ctx, f.base); const detach = runtime.attach(f.control);
  t.after(() => { detach(); disposers.reverse().forEach(fn => fn()); });
  const exec = { token: Symbol(), name: 'pwsh', arguments: { command: 'git status', description: 'Inspect repository status',
    sandbox_permissions: 'danger-full-access', justification: 'Inspect repository status', timeoutMs: 1000 }, agent: { session: f.session }, callId: 'approval-one', signal: new AbortController().signal };
  const req = () => ({ agent: exec.agent, toolName: exec.name, callId: exec.callId, signal: exec.signal,
    reason: `escalate sandbox to ${exec.arguments.sandbox_permissions}: ${exec.arguments.justification}` });
  return { ...f, handlers, exec, req, guard: () => guard(exec), calls: () => calls };
}
test('approval opt-in is persisted as a boolean and cannot edit policy', async () => {
  const f = fixture(); assert.equal(f.control.settingsView().values.approvalReview, false);
  const saved = await f.control.call('settings.save', { expectedRevision: 0, values: { approvalReview: true } });
  assert.equal(saved.values.approvalReview, true); assert.equal(createControl(f.base, f.options).settingsView().values.approvalReview, true);
  await assert.rejects(f.control.call('settings.save', { expectedRevision: 1, values: { approvalReview: 'true' } }), /approvalReview/);
});
test('approval opt-in preserves native preflight but rejects unbound and mismatched asks without downstream', async t => {
  const f = approvalFixture(t, async () => { assert.fail('unbound requests must not review'); });
  await f.select('safe-auto');
  assert.equal((await f.handlers['tools/pre-execute'](f.exec, async () => ({ kind: 'allow' }))).kind, 'allow');
  assert.equal(f.guard(), undefined);
  let downstream = 0;
  const malicious = async () => { downstream++; return 'allowed-once'; };
  assert.equal(await f.handlers['approval/request'](f.req(), malicious), 'rejected');
  await f.handlers['tools/execute'](f.exec, async () => {
    for (const mismatch of [{ reason: 'unrelated native prompt' }, { callId: 'other' },
      { toolName: 'other' }, { agent: { session: f.session } }, { signal: new AbortController().signal }]) {
      assert.equal(await f.handlers['approval/request']({ ...f.req(), ...mismatch }, malicious), 'rejected');
    }
  });
  assert.equal(downstream, 0); assert.equal(f.calls(), 0);
});
const approvalVerdict = decision => JSON.stringify({ decision, risk: 'low', authorization: 'high', bounded: true, reason: 'User requested bounded repository inspection.' });
test('Windows approval review grants once only inside the exact native execution', async t => {
  const f = approvalFixture(t, async () => approvalVerdict('allow')); await f.select('safe-auto');
  assert.equal((await f.handlers['tools/pre-execute'](f.exec, async () => ({ kind: 'allow' }))).kind, 'allow');
  await f.handlers['tools/execute'](f.exec, async () => {
    assert.equal(await f.handlers['approval/request'](f.req(), async () => { assert.fail('approved call must not ask human'); }), 'allowed-once');
    assert.equal(await f.handlers['approval/request'](f.req(), async () => 'allowed-once'), 'rejected');
  });
  assert.equal(f.calls(), 1); assert.equal(f.options.presets.current(), 'workspace-write');
  assert.equal(await f.handlers['approval/request'](f.req(), async () => { assert.fail('ended execution must not delegate'); }), 'rejected');
});
test('approval mutation or disabling during review rejects a late grant', async t => {
  for (const change of ['arguments', 'disable']) {
    const f = approvalFixture(t, async f => {
      if (change === 'arguments') fixtureExec.arguments.command = 'git diff';
      else await f.control.call('session.disable', { sessionId: 's', expectedRevision: (await f.control.call('session.get', { sessionId: 's' })).revision });
      return approvalVerdict('allow');
    });
    const fixtureExec = f.exec; await f.select('safe-auto');
    await f.handlers['tools/execute'](f.exec, async () => {
      assert.equal(await f.handlers['approval/request'](f.req(), async () => 'allowed-once'), 'rejected');
    });
  }
});
test('review uncertainty, explicit deny and malformed output reject without downstream', async t => {
  for (const output of [approvalVerdict('ask'), approvalVerdict('deny'), '{"decision":"allow"}']) {
    const f = approvalFixture(t, async () => output); await f.select('safe-auto'); let downstream = 0;
    await f.handlers['tools/execute'](f.exec, async () => {
      assert.equal(await f.handlers['approval/request'](f.req(), async () => { downstream++; return 'allowed-once'; }), 'rejected');
    });
    assert.equal(downstream, 0); assert.equal(f.calls(), 1);
  }
});
test('review errors, timeout and lease expiry reject without downstream', async t => {
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  for (const scenario of [
    { reviewer: async () => { throw new Error('adapter failure'); }, config: {} },
    { reviewer: async () => { await delay(150); return approvalVerdict('allow'); }, config: { timeoutMs: 100 } },
    { reviewer: async () => { await delay(150); return approvalVerdict('allow'); }, config: { escalationApprovalTtlMs: 100 } },
  ]) {
    const f = approvalFixture(t, scenario.reviewer, scenario.config); await f.select('safe-auto');
    let downstream = 0;
    await f.handlers['tools/execute'](f.exec, async () => {
      assert.equal(await f.handlers['approval/request'](f.req(), async () => { downstream++; return 'allowed-once'; }), 'rejected');
    });
    assert.equal(downstream, 0); assert.equal(f.calls(), 1);
  }
});
test('exhausted approval budget rejects rather than using downstream approvals', async t => {
  const f = approvalFixture(t, async () => approvalVerdict('allow'), { fastCallsPerTask: 1 }); await f.select('safe-auto');
  const malicious = async () => { assert.fail('exhausted budget must not delegate'); };
  await f.handlers['tools/execute'](f.exec, async () => {
    assert.equal(await f.handlers['approval/request'](f.req(), malicious), 'allowed-once');
  });
  f.handlers['tools/result'](f.exec, {});
  f.exec.token = Symbol(); f.exec.callId = 'approval-two';
  await f.handlers['tools/execute'](f.exec, async () => {
    assert.equal(await f.handlers['approval/request'](f.req(), malicious), 'rejected');
  });
  assert.equal(f.calls(), 1);
});
test('cancelled active approval requests stay cancelled without downstream', async t => {
  const f = approvalFixture(t, async () => { assert.fail('cancelled request must not review'); }); await f.select('safe-auto');
  const abort = new AbortController(); abort.abort(); f.exec.signal = abort.signal;
  const malicious = async () => { assert.fail('cancelled request must not delegate'); };
  assert.equal(await f.handlers['approval/request'](f.req(), malicious), 'cancelled');
  await f.handlers['tools/execute'](f.exec, async () => {
    assert.equal(await f.handlers['approval/request'](f.req(), malicious), 'cancelled');
  });
});
test('inactive opt-in and shadow mode preserve downstream behavior', async t => {
  for (const mode of ['off', 'shadow']) {
    const f = approvalFixture(t, async () => { assert.fail('inactive or shadow must not review'); });
    if (mode === 'shadow') f.control.config = () => parseConfig({ ...f.base, mode });
    let downstream = 0;
    assert.equal(await f.handlers['approval/request'](f.req(), async () => { downstream++; return 'allowed-once'; }), 'allowed-once');
    assert.equal(downstream, 1); assert.equal(f.calls(), 0);
  }
});
test('child and nested native requests never receive automatic grants', async t => {
  for (const kind of ['child', 'nested']) {
    const f = approvalFixture(t, async () => { assert.fail('delegations must not review'); }); await f.select('safe-auto');
    if (kind === 'child') f.session.header.parentSession = 'parent'; else f.exec.parent = Symbol();
    await f.handlers['tools/execute'](f.exec, async () => {
      assert.equal(await f.handlers['approval/request'](f.req(), async () => 'rejected'), 'rejected');
    });
    assert.equal(f.calls(), 0);
  }
});
test('relative workdir cannot obtain automatic native approval', async t => {
  const f = approvalFixture(t, async () => { assert.fail('relative locality is unverified'); }); await f.select('safe-auto');
  f.exec.arguments.workdir = 'relative';
  await f.handlers['tools/execute'](f.exec, async () => {
    assert.equal(await f.handlers['approval/request'](f.req(), async () => 'rejected'), 'rejected');
  });
  assert.equal(f.calls(), 0);
});
test('disabling after native preflight prevents review during execute', async t => {
  const f = approvalFixture(t, async () => { assert.fail('inactive controls cannot review'); }); const enabled = await f.select('safe-auto');
  assert.equal((await f.handlers['tools/pre-execute'](f.exec, async () => ({ kind: 'allow' }))).kind, 'allow');
  await f.control.call('session.disable', { sessionId: 's', expectedRevision: enabled.revision });
  await f.handlers['tools/execute'](f.exec, async () => {
    assert.equal(await f.handlers['approval/request'](f.req(), async () => 'unavailable'), 'unavailable');
  });
  assert.equal(f.calls(), 0);
});
test('settings changes invalidate pending grants without refilling reviewer budget', async t => {
  const f = fixture({ fastCallsPerTask: 1 });
  f.events.push({ type: 'user/message', seq: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Inspect status' }] } });
  const handlers = {}, disposers = []; let runtime, guard, calls = 0;
  const ctx = { provide(_key, value) { runtime = value; }, tools: { guard(fn) { guard = fn; } },
    get(key) { return key === 'permissionPresets' ? { ...f.options.presets, names: Object.keys(f.specs), registerAuto() { assert.fail('must not publish official FullAccess Auto'); } } : undefined; },
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
