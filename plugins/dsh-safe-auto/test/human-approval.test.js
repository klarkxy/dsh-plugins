import test from 'node:test';
import assert from 'node:assert/strict';
import { createHumanApprovals } from '../src/human-approval.js';
import { parseConfig } from '../src/config.js';

const action = { tool: 'pwsh', arguments: { command: 'pnpm check' }, cwd: '/work', permission: { from: 'workspace-write', to: 'danger-full-access', scope: 'this-call-only' } };
function fixture() {
  let time = 0, valid = true;
  const queue = createHumanApprovals({ now: () => time, wallNow: () => 100000 });
  const controller = new AbortController(), session = {};
  const request = () => queue.request({ session, action, review: { code: 'MODEL_NOT_ALLOWED' }, signal: controller.signal, timeoutMs: 60000, valid: () => valid });
  return { queue, controller, session, request, advance: ms => { time += ms; }, invalidate: () => { valid = false; } };
}
test('default is sixty seconds and timeout remains an operator-owned bounded field', () => {
  assert.equal(parseConfig().humanApprovalTimeoutMs, 60000);
  assert.equal(parseConfig({ humanApprovalTimeoutMs: 0 }).humanApprovalTimeoutMs, 0);
  for (const value of [-1, NaN, 300001, '60000']) assert.throws(() => parseConfig({ humanApprovalTimeoutMs: value }));
});
test('responses are session-scoped and atomic; concurrent tabs cannot approve twice', async () => {
  const f = fixture(); const pending = f.request();
  const view = f.queue.list(f.session); assert.equal(view.requests[0].remainingMs, 60000);
  assert.deepEqual(view.requests[0].action, action);
  assert.deepEqual(f.queue.list({}).requests, []);
  const id = view.requests[0].id;
  assert.throws(() => f.queue.answer({}, id, 'allow'));
  assert.equal(f.queue.answer(f.session, id, 'allow').accepted, true);
  assert.throws(() => f.queue.answer(f.session, id, 'allow'));
  assert.equal((await pending).code, 'HUMAN_ALLOWED');
  assert.equal(f.queue.list(f.session).requests.length, 0); f.queue.dispose();
});
test('monotonic deadline wins even if expiry timer was delayed; late answers fail', async () => {
  const f = fixture(); const pending = f.request(); const id = f.queue.list(f.session).requests[0].id;
  f.advance(60000); assert.throws(() => f.queue.answer(f.session, id, 'allow'));
  const decision = await pending; assert.equal(decision.code, 'HUMAN_APPROVAL_EXPIRED');
  assert.equal(f.queue.beforeDeadline(decision), false); f.queue.dispose();
});
test('expiry is automatic without polling and explicit rejection resolves once', async () => {
  const queue = createHumanApprovals(); const session = {};
  const pending = queue.request({ session, action, review: {}, signal: new AbortController().signal, timeoutMs: 20, valid: () => true });
  assert.equal((await pending).code, 'HUMAN_APPROVAL_EXPIRED');
  const f = fixture(); const rejected = f.request();
  f.queue.answer(f.session, f.queue.list(f.session).requests[0].id, 'deny');
  assert.equal((await rejected).code, 'HUMAN_REJECTED'); queue.dispose(); f.queue.dispose();
});
test('cancellation, revocation, detach and runtime disposal remove pending entries', async () => {
  for (const kind of ['abort', 'invalidate', 'detach', 'dispose']) {
    const f = fixture(); const pending = f.request(); const id = f.queue.list(f.session).requests[0].id;
    if (kind === 'abort') f.controller.abort();
    if (kind === 'invalidate') { f.invalidate(); f.queue.invalidate(); }
    if (kind === 'detach') f.queue.cancelAll();
    if (kind === 'dispose') f.queue.dispose();
    assert.notEqual((await pending).kind, 'allow');
    assert.throws(() => f.queue.answer(f.session, id, 'allow')); f.queue.dispose();
  }
});
test('approval during the window still requires verification to finish before deadline', async () => {
  const f = fixture(); const pending = f.request();
  f.queue.answer(f.session, f.queue.list(f.session).requests[0].id, 'allow');
  const decision = await pending; assert.equal(f.queue.beforeDeadline(decision), true);
  f.advance(60000); assert.equal(f.queue.beforeDeadline(decision), false); f.queue.dispose();
});
