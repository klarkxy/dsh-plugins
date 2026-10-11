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
  const base = parseConfig({ provider: 'p', model: 'm', humanApprovalTimeoutMs: 0, ...extra });
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
  assert.equal(view.policyLimits.timeoutMs, 30000); assert.equal(view.policyLimits.maxReviewsPerTask, 20);
  assert.equal(fixture({ enabled: false }).control.settingsView().available, false);
});
test('activation excludes official Auto even when it appears first in catalog', async () => {
  const f = fixture(); f.specs.auto = { sandbox: 'danger-full-access', approval: 'ask' };
  f.options.presets.catalog = () => ({ options: ['auto', 'workspace-write', 'danger-full-access'].map(value => ({ value, name: value })) });
  const set = f.options.presets.set;
  f.options.presets.set = (session, value) => { assert.equal(value, 'workspace-write'); set(session, value); };
  await f.select('safe-auto'); assert.equal(f.options.presets.current(), 'workspace-write');
});
function approvalFixture(t, reviewer, extra = {}) {
  const f = fixture(extra);
  f.events.push({ type: 'user/message', seq: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Run git status to inspect the repository.' }] } });
  const handlers = {}, disposers = []; let runtime, guard, calls = 0;
  const ctx = { provide(_key, value) { runtime = value; }, tools: { guard(fn) { guard = fn; } },
    get(key) { if (key === 'permissionPresets') return { ...f.options.presets, names: Object.keys(f.specs), registerAuto() { assert.fail('official Auto forbidden'); } };
      if (key === 'fs') return f.options.evidenceFs ?? { processPathFromHostPath: path => path }; },
    sandboxPolicy: f.options.sandboxPolicy, logger: { info() {} }, on(event, fn) { handlers[event] = fn; }, effect(fn) { disposers.push(fn()); },
    inject(_deps, fn) { fn({ effect: ctx.effect, llm: { async *stream(options) { calls++; const text = await reviewer(f, options);
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }; yield { type: 'finish', reason: { kind: 'stop' } }; } } }); } };
  apply(ctx, f.base); const detach = runtime.attach(f.control);
  t.after(() => { detach(); disposers.reverse().forEach(fn => fn()); });
  const exec = { token: Symbol(), name: 'pwsh', arguments: { command: 'git status', description: 'Inspect repository status',
    sandbox_permissions: 'danger-full-access', justification: 'Inspect repository status', timeoutMs: 1000 }, agent: { session: f.session }, callId: 'approval-one', signal: new AbortController().signal };
  const req = () => ({ agent: exec.agent, toolName: exec.name, callId: exec.callId, signal: exec.signal,
    reason: `escalate sandbox to ${exec.arguments.sandbox_permissions}: ${exec.arguments.justification}` });
  return { ...f, handlers, exec, req, runtime, guard: () => guard(exec), calls: () => calls, detach };
}
const approvalVerdict = decision => JSON.stringify({ decision, risk: 'low', authorization: 'high', bounded: true, reason: 'User requested bounded repository inspection.' });

function evidenceFixture(f) {
  const manifest = resolve(f.root, 'package.json'), script = resolve(f.root, 'scripts/check.mjs');
  const files = new Map([[manifest, '{"scripts":{"check":"node scripts/check.mjs"}}'], [script, 'console.log("checked")']]);
  f.options.evidenceFiles = files;
  f.options.evidenceFs = { processPathFromHostPath: path => path,
    async resolve(path) { return { path }; }, processPath: target => target.path,
    contains(parent, child) { return child.path === parent.path || child.path.startsWith(parent.path + (process.platform === 'win32' ? '\\' : '/')); },
    async stat(target) { return files.has(target.path) ? { type: 'file', version: files.get(target.path) } : undefined; },
    async readBytes(target, _signal, maxBytes) { const b = Buffer.from(files.get(target.path)); assert.ok(b.length <= maxBytes); return b; },
  };
  f.exec.arguments.command = 'pnpm check';
  f.events[0].data.content[0].text = 'Complete and verify the plugin locally. Do not publish.';
  return { files, script };
}

async function pendingRequest(f) {
  for (let i = 0; i < 100; i++) {
    const view = f.runtime.listApprovals('s');
    if (view.requests.length) return view.requests[0];
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.fail('manual confirmation was not published');
}

test('model denial becomes a single timed human request; approval grants only the bound call', async t => {
  const f = approvalFixture(t, async () => approvalVerdict('deny'), { humanApprovalTimeoutMs: 500 });
  await f.select('safe-auto');
  const execution = f.handlers['tools/execute'](f.exec, async () => {
    const outcome = await f.handlers['approval/request'](f.req(), async () => assert.fail('must not delegate'));
    return { isError: outcome !== 'allowed-once', content: [{ type: 'text', text: outcome }] };
  });
  const request = await pendingRequest(f);
  assert.equal(request.action.arguments.command, 'git status'); assert.equal(request.review.code, 'MODEL_NOT_ALLOWED');
  assert.equal(f.runtime.answerApproval({ sessionId: 's', requestId: request.id, outcome: 'allow' }).accepted, true);
  assert.equal((await execution).isError, false);
  assert.throws(() => f.runtime.answerApproval({ sessionId: 's', requestId: request.id, outcome: 'allow' }));
});

test('unanswered confirmation expires and explicit rejection both refuse without delegation', async t => {
  for (const response of ['deny', 'expire']) {
    const f = approvalFixture(t, async () => approvalVerdict('ask'), { humanApprovalTimeoutMs: 60 }); await f.select('safe-auto');
    const execution = f.handlers['tools/execute'](f.exec, async () => {
      const outcome = await f.handlers['approval/request'](f.req(), async () => assert.fail('must not delegate'));
      assert.equal(outcome, 'rejected'); return { isError: true, content: [] };
    });
    const request = await pendingRequest(f);
    if (response === 'deny') f.runtime.answerApproval({ sessionId: 's', requestId: request.id, outcome: 'deny' });
    const result = await execution;
    assert.match(JSON.stringify(result.content), response === 'deny' ? /HUMAN_REJECTED/ : /HUMAN_APPROVAL_EXPIRED/);
    assert.equal(f.runtime.listApprovals('s').requests.length, 0);
  }
});

test('cancellation, argument changes, settings revisions and detach invalidate pending human permission', async t => {
  for (const change of ['cancel', 'arguments', 'settings', 'detach']) {
    const f = approvalFixture(t, async () => approvalVerdict('deny'), { humanApprovalTimeoutMs: 500 }); await f.select('safe-auto');
    const execution = f.handlers['tools/execute'](f.exec, async () => {
      const outcome = await f.handlers['approval/request'](f.req(), async () => assert.fail('must not delegate'));
      assert.notEqual(outcome, 'allowed-once'); return { isError: true, content: [] };
    });
    const request = await pendingRequest(f);
    if (change === 'cancel') {
      // Each signal belongs to the live execution; replacement changes binding.
      f.exec.signal = AbortSignal.abort();
    }
    if (change === 'arguments') f.exec.arguments.command = 'git diff';
    if (change === 'settings') await f.control.call('settings.save', { expectedRevision: 0, values: { model: 'different' } });
    if (change === 'detach') f.detach();
    f.runtime.invalidateApprovals();
    assert.throws(() => f.runtime.answerApproval({ sessionId: 's', requestId: request.id, outcome: 'allow' }));
    assert.equal((await execution).isError, true);
  }
});

test('manual verification uses the original snapshots with a fresh signal after model lease expiry', async t => {
  const f = approvalFixture(t, async () => approvalVerdict('deny'), { timeoutMs: 100, humanApprovalTimeoutMs: 1000 });
  evidenceFixture(f); await f.select('safe-auto');
  const execution = f.handlers['tools/execute'](f.exec, async () => {
    const outcome = await f.handlers['approval/request'](f.req(), async () => assert.fail('must not delegate'));
    return { isError: outcome !== 'allowed-once', content: [] };
  });
  const request = await pendingRequest(f); await new Promise(resolve => setTimeout(resolve, 130));
  f.runtime.answerApproval({ sessionId: 's', requestId: request.id, outcome: 'allow' });
  assert.equal((await execution).isError, false);
});

test('script mutation while awaiting user confirmation blocks a previously approved action', async t => {
  const f = approvalFixture(t, async () => approvalVerdict('deny'), { humanApprovalTimeoutMs: 500 });
  const { files, script } = evidenceFixture(f); await f.select('safe-auto');
  const execution = f.handlers['tools/execute'](f.exec, async () => {
    const outcome = await f.handlers['approval/request'](f.req(), async () => assert.fail('must not delegate'));
    assert.equal(outcome, 'rejected'); return { isError: true, content: [] };
  });
  const request = await pendingRequest(f); files.set(script, 'changed');
  f.runtime.answerApproval({ sessionId: 's', requestId: request.id, outcome: 'allow' });
  assert.match(JSON.stringify((await execution).content), /EVIDENCE_CHANGED/);
});

test('structural refusals never publish a human request even when takeover is enabled', async t => {
  const f = approvalFixture(t, async () => assert.fail('structural refusal cannot review'), { humanApprovalTimeoutMs: 500 });
  await f.select('safe-auto'); f.exec.arguments.workdir = 'relative';
  await f.handlers['tools/execute'](f.exec, async () => {
    assert.notEqual(await f.handlers['approval/request'](f.req(), async () => assert.fail('must not delegate')), 'allowed-once');
  });
  assert.equal(f.runtime.listApprovals('s').requests.length, 0);
});

test('elapsed model lease cannot replace terminal evidence failures with a manual grant', async t => {
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const f = approvalFixture(t, async () => assert.fail('unbounded evidence cannot reach reviewer'), { humanApprovalTimeoutMs: 500 });
  evidenceFixture(f); await f.select('safe-auto');
  f.options.evidenceFs.readBytes = async (_target, _signal, limit) => {
    clock = 31000; return Buffer.alloc(limit + 1, 120);
  };
  const result = await f.handlers['tools/execute'](f.exec, async () => {
    assert.equal(await f.handlers['approval/request'](f.req(), async () => assert.fail('must not delegate')), 'unavailable');
    return { isError: true, content: [] };
  });
  assert.match(JSON.stringify(result.content), /EVIDENCE_PROVIDER_UNBOUNDED/);
  assert.equal(f.runtime.listApprovals('s').requests.length, 0);
});

test('captured requests cannot delegate after controls are disabled or detached before native approval', async t => {
  for (const change of ['disable', 'detach']) {
    const f = approvalFixture(t, async () => assert.fail('invalidated execution must not review'), { humanApprovalTimeoutMs: 500 });
    await f.select('safe-auto'); let downstream = 0;
    await f.handlers['tools/execute'](f.exec, async () => {
      if (change === 'disable') await f.control.call('session.disable', { sessionId: 's', expectedRevision: (await f.control.call('session.get', { sessionId: 's' })).revision });
      else f.detach();
      assert.equal(await f.handlers['approval/request'](f.req(), async () => { downstream++; return 'allowed-once'; }), 'rejected');
    });
    assert.equal(downstream, 0);
  }
});

test('private incomplete history can receive fresh exact-call UI authority without reaching the model', async t => {
  const f = approvalFixture(t, async () => assert.fail('private history must not reach reviewer'), { humanApprovalTimeoutMs: 500 });
  f.events[0].data.content[0].text = 'token=fictional-private-value';
  await f.select('safe-auto');
  const execution = f.handlers['tools/execute'](f.exec, async () => {
    const outcome = await f.handlers['approval/request'](f.req(), async () => assert.fail('must not delegate'));
    return { isError: outcome !== 'allowed-once', content: [] };
  });
  const request = await pendingRequest(f);
  assert.equal(request.review.code, 'AUTHORITY_CONTEXT_INCOMPLETE');
  assert.equal(request.action.arguments.command, 'git status');
  assert.ok(!JSON.stringify(request).includes('fictional-private-value'));
  f.runtime.answerApproval({ sessionId: 's', requestId: request.id, outcome: 'allow' });
  assert.equal((await execution).isError, false); assert.equal(f.calls(), 0);
});

test('actual approval path retains task authority after continue, with script evidence and later revocation', async t => {
  const f = approvalFixture(t, async (_f, options) => {
    const input = JSON.parse(options.messages[0].content[0].text);
    assert.match(input.authorizationContext.directUserMessages[0].text, /Complete and verify/);
    assert.ok(input.executionEvidence.files.some(file => file.content.includes('checked')));
    const revoked = input.authorizationContext.directUserMessages.some(m => m.text === 'Do not run tests now.');
    return approvalVerdict(revoked ? 'deny' : 'allow');
  });
  evidenceFixture(f); await f.select('safe-auto');
  f.events.push({ type: 'user/message', seq: 2, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Continue' }] } });
  await f.handlers['tools/execute'](f.exec, async () => {
    assert.equal(await f.handlers['approval/request'](f.req(), async () => assert.fail('must not delegate')), 'allowed-once');
  });
  f.handlers['tools/result'](f.exec, {}); f.exec.token = Symbol();
  f.events.push({ type: 'user/message', seq: 3, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Do not run tests now.' }] } });
  const result = await f.handlers['tools/execute'](f.exec, async () => {
    assert.equal(await f.handlers['approval/request'](f.req(), async () => assert.fail('must not delegate')), 'rejected');
    return { isError: true, content: [{ type: 'text', text: 'native refusal' }] };
  });
  assert.match(JSON.stringify(result.content), /MODEL_NOT_ALLOWED/);
});

test('script mutation during review invalidates allow and exposes evidence feedback', async t => {
  const f = approvalFixture(t, async inner => {
    inner.options.evidenceFiles.set(resolve(inner.root, 'scripts/check.mjs'), 'console.log("changed")');
    return approvalVerdict('allow');
  });
  evidenceFixture(f); await f.select('safe-auto');
  const result = await f.handlers['tools/execute'](f.exec, async () => {
    assert.equal(await f.handlers['approval/request'](f.req(), async () => assert.fail('must not delegate')), 'unavailable');
    return { isError: true, content: [] };
  });
  assert.match(JSON.stringify(result.content), /EVIDENCE_CHANGED/);
});

test('review timeout feedback is distinct from an explicit denial', async t => {
  const f = approvalFixture(t, async () => { await new Promise(r => setTimeout(r, 150)); return approvalVerdict('allow'); }, { timeoutMs: 100 });
  await f.select('safe-auto');
  const result = await f.handlers['tools/execute'](f.exec, async () => {
    assert.equal(await f.handlers['approval/request'](f.req(), async () => assert.fail('must not delegate')), 'unavailable');
    return { isError: true, content: [] };
  });
  assert.match(JSON.stringify(result.content), /REVIEW_TIMEOUT/);
  assert.match(JSON.stringify(result.content), /not proof that the action is unsafe/);
});
test('unbound and mismatched asks reject without downstream or a review call', async t => {
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

test('foreign native asks pass through only without an owned execution context', async t => {
  const f = approvalFixture(t, async () => assert.fail('foreign requests must not review'));
  await f.select('safe-auto');
  let downstream = 0;
  const answer = async () => { downstream++; return 'allowed-once'; };
  for (const toolName of ['blueprint_apply_order', 'classmates_spawn']) {
    const foreign = { ...f.req(), toolName };
    assert.equal(await f.handlers['approval/request'](foreign, answer), 'allowed-once');
    await f.handlers['tools/execute'](f.exec, async () => {
      assert.equal(await f.handlers['approval/request'](foreign, answer), 'rejected', 'owned context mismatch cannot delegate');
    });
  }
  for (const toolName of ['bash', 'pwsh', 'write', 'edit']) {
    assert.equal(await f.handlers['approval/request']({ ...f.req(), toolName }, answer), 'rejected', 'unbound owned identity remains closed');
  }
  assert.equal(downstream, 2); assert.equal(f.calls(), 0);
});

test('quoted sensitive argv and redirects cannot reach reviewer or manual takeover', async t => {
  for (const command of ["cat '.env'", 'cat .e""nv', "cat < '.env'", "echo 'tok'en=fictional123"]) {
    const f = approvalFixture(t, async () => assert.fail('sensitive request must not reach reviewer'));
    await f.select('safe-auto');
    f.exec.name = 'bash'; f.exec.arguments.command = command;
    await f.handlers['tools/execute'](f.exec, async () => {
      assert.equal(await f.handlers['approval/request'](f.req(), async () => assert.fail('cannot delegate hard refusal')), 'rejected', command);
    });
    assert.equal(f.calls(), 0);
    assert.deepEqual(f.runtime.listApprovals(f.session.id).requests, [], 'hard refusal cannot publish a human override');
  }
});
test('approval review grants once only inside the exact native execution', async t => {
  const f = approvalFixture(t, async () => approvalVerdict('allow')); await f.select('safe-auto');
  assert.equal((await f.handlers['tools/pre-execute'](f.exec, async () => ({ kind: 'allow' }))).kind, 'allow');
  await f.handlers['tools/execute'](f.exec, async () => {
    assert.equal(await f.handlers['approval/request'](f.req(), async () => { assert.fail('approved call must not ask human'); }), 'allowed-once');
    assert.equal(await f.handlers['approval/request'](f.req(), async () => 'allowed-once'), 'rejected');
  });
  assert.equal(f.calls(), 1); assert.equal(f.options.presets.current(), 'workspace-write');
  assert.equal(await f.handlers['approval/request'](f.req(), async () => { assert.fail('ended execution must not delegate'); }), 'rejected');
});
test('mutation or disabling during review rejects a late grant', async t => {
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
test('uncertainty and malformed output are unavailable; explicit deny rejects without downstream', async t => {
  for (const output of [approvalVerdict('ask'), approvalVerdict('deny'), '{"decision":"allow"}']) {
    const f = approvalFixture(t, async () => output); await f.select('safe-auto'); let downstream = 0;
    await f.handlers['tools/execute'](f.exec, async () => {
      assert.equal(await f.handlers['approval/request'](f.req(), async () => { downstream++; return 'allowed-once'; }),
        output === approvalVerdict('deny') ? 'rejected' : 'unavailable');
    });
    assert.equal(downstream, 0); assert.equal(f.calls(), 1);
  }
});
test('review errors and timeout report unavailable without downstream', async t => {
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  for (const scenario of [
    { reviewer: async () => { throw new Error('adapter failure'); }, config: {} },
    { reviewer: async () => { await delay(150); return approvalVerdict('allow'); }, config: { timeoutMs: 100 } },
  ]) {
    const f = approvalFixture(t, scenario.reviewer, scenario.config); await f.select('safe-auto');
    let downstream = 0;
    await f.handlers['tools/execute'](f.exec, async () => {
      assert.equal(await f.handlers['approval/request'](f.req(), async () => { downstream++; return 'allowed-once'; }), 'unavailable');
    });
    assert.equal(downstream, 0); assert.equal(f.calls(), 1);
  }
});
test('exhausted review budget rejects rather than using downstream approvals', async t => {
  const f = approvalFixture(t, async () => approvalVerdict('allow'), { maxReviewsPerTask: 1 }); await f.select('safe-auto');
  const malicious = async () => { assert.fail('exhausted budget must not delegate'); };
  await f.handlers['tools/execute'](f.exec, async () => {
    assert.equal(await f.handlers['approval/request'](f.req(), malicious), 'allowed-once');
  });
  f.handlers['tools/result'](f.exec, {});
  f.exec.token = Symbol(); f.exec.callId = 'approval-two';
  await f.handlers['tools/execute'](f.exec, async () => {
    assert.equal(await f.handlers['approval/request'](f.req(), malicious), 'unavailable');
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
test('an inactive session delegates to the downstream chain unchanged', async t => {
  const f = approvalFixture(t, async () => { assert.fail('inactive sessions must not review'); });
  let downstream = 0;
  assert.equal(await f.handlers['approval/request'](f.req(), async () => { downstream++; return 'allowed-once'; }), 'allowed-once');
  assert.equal(downstream, 1); assert.equal(f.calls(), 0);
});
test('child and nested native requests never receive automatic grants', async t => {
  for (const kind of ['child', 'nested']) {
    const f = approvalFixture(t, async () => { assert.fail('delegations must not review'); }); await f.select('safe-auto');
    if (kind === 'child') f.session.header.parentSession = 'parent'; else f.exec.parent = Symbol();
    await f.handlers['tools/execute'](f.exec, async () => {
      assert.equal(await f.handlers['approval/request'](f.req(), async () => 'rejected'), kind === 'child' ? 'rejected' : 'unavailable');
    });
    assert.equal(f.calls(), 0);
  }
});
test('relative workdir cannot obtain automatic native approval', async t => {
  const f = approvalFixture(t, async () => { assert.fail('relative locality is unverified'); }); await f.select('safe-auto');
  f.exec.arguments.workdir = 'relative';
  await f.handlers['tools/execute'](f.exec, async () => {
    assert.equal(await f.handlers['approval/request'](f.req(), async () => 'rejected'), 'unavailable');
  });
  assert.equal(f.calls(), 0);
});
test('disabling before execute prevents review during the request', async t => {
  const f = approvalFixture(t, async () => { assert.fail('inactive controls cannot review'); }); const enabled = await f.select('safe-auto');
  assert.equal((await f.handlers['tools/pre-execute'](f.exec, async () => ({ kind: 'allow' }))).kind, 'allow');
  await f.control.call('session.disable', { sessionId: 's', expectedRevision: enabled.revision });
  await f.handlers['tools/execute'](f.exec, async () => {
    assert.equal(await f.handlers['approval/request'](f.req(), async () => 'unavailable'), 'unavailable');
  });
  assert.equal(f.calls(), 0);
});
test('settings changes invalidate pending grants; detaching never restores review', async t => {
  const f = approvalFixture(t, async () => approvalVerdict('allow')); await f.select('safe-auto');
  const first = f.exec;
  assert.equal((await f.handlers['tools/pre-execute'](first, async () => ({ kind: 'allow' }))).kind, 'allow');
  await f.handlers['tools/execute'](first, async () => {
    await f.control.call('settings.save', { expectedRevision: 0, values: { reviewerPrompt: 'Be cautious.' } });
    assert.match(f.guard(), /SETTINGS_CHANGED/);
    assert.equal(await f.handlers['approval/request'](f.req(), async () => { assert.fail('stale grant must not delegate'); }), 'rejected');
  });
  assert.equal(f.calls(), 0, 'a settings change rejects before invoking the reviewer');
  f.handlers['tools/result'](first, {});
  f.detach();
  const second = { ...first, token: Symbol(), callId: 'two', signal: new AbortController().signal };
  assert.equal((await f.handlers['tools/pre-execute'](second, async () => ({ kind: 'allow' }))).kind, 'allow');
  assert.equal(f.guard(), undefined, 'guard no longer gates once controls are detached');
  let downstream = 0;
  assert.equal(await f.handlers['approval/request'](f.req(), async () => { downstream++; return 'allowed-once'; }), 'allowed-once');
  assert.equal(downstream, 1); assert.equal(f.calls(), 0);
});
