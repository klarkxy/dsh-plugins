import test from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from '../src/config.js';
import { conversationRoute, resolveReviewRoute, nativeCompletion } from '../src/model-route.js';
import { review } from '../src/reviewer.js';
import { createGate } from '../src/gate.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'safe-auto-model-')));
test.after(() => rmSync(root, { recursive: true, force: true }));
const command = 'git status --short';
const config = extra => parseConfig({ ...extra });
const signal = () => new AbortController().signal;
const ledger = () => ({ reviews: 0, consecutive: 0, reportedTokens: 0 });
const selected = (provider = 'chat-provider', model = 'chat-model') => ({ provider, model });
function owner(route = selected()) {
  const state = { config: route };
  const session = { header: { cwd: root }, requestHeader: () => state,
    snapshotEvents: () => [{ type: 'user/message', seq: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Inspect repository status' }] } }],
  };
  return { state, session, agent: { session, options: selected('old-provider', 'old-model') } };
}
const call = own => ({ ...own, tool: 'bash', args: { command, description: 'Inspect repository status',
  sandbox_permissions: 'danger-full-access', justification: 'Inspect repository status' },
  cwd: root, sandbox: { mode: 'workspace-write', workspaceRoot: root },
  subagent: false, nested: false, localExecution: true,
  signal: signal(), task: 1, intent: 'Inspect repository status', callId: 'one' });
const verdict = decision => JSON.stringify({ decision, risk: 'low', authorization: 'high', bounded: true, reason: 'Bounded and user-requested.' });
function* chunks(decision = 'allow') {
  const text = verdict(decision);
  yield { type: 'block-start', index: 0, blockType: 'text' };
  yield { type: 'text-delta', index: 0, text };
  yield { type: 'block-end', index: 0, block: { type: 'text', text } };
  yield { type: 'usage', usage: { inputTokens: 10, cacheReadTokens: 20, outputTokens: 5 } };
  yield { type: 'finish', reason: { kind: 'stop' } };
}
const runtime = inspect => ({ async *stream(options) { const d = await inspect?.(options); yield* chunks(d ?? 'allow'); } });
const action = { tool: 'bash', arguments: { command }, cwd: root,
  permission: { from: 'workspace-write', to: 'danger-full-access', scope: 'this-call-only' } };
const nativeReview = (llm, extra = {}) => review(config(extra), action, 'Inspect repository status', ledger(), signal(),
  { llm, owner: owner() });

test('default follows accepted conversation route without copying main-agent settings', () => {
  const o = owner({ ...selected(), maxTokens: 90000, tools: ['shell'], reasoningEffort: 'high' });
  assert.deepEqual(resolveReviewRoute(config(), o), selected());
  assert.deepEqual(conversationRoute(o), selected());
  o.state.config = selected('other', 'next');
  assert.equal(resolveReviewRoute(config(), o).model, 'next');
});
test('fixed model is independent of the conversation and carries effort only when set', () => {
  assert.deepEqual(resolveReviewRoute(config({ provider: 'reviewer', model: 'small' }), owner()), { provider: 'reviewer', model: 'small' });
  assert.equal(resolveReviewRoute(config({ provider: 'reviewer', model: 'small' })).model, 'small');
  assert.deepEqual(resolveReviewRoute(config({ provider: 'reviewer', model: 'small', reasoningEffort: 'low' })),
    { provider: 'reviewer', model: 'small', reasoningEffort: 'low' });
});
test('options are a fallback only when the accepted request header is absent', () => {
  assert.deepEqual(conversationRoute({ agent: { options: selected() } }), selected());
  assert.throws(() => conversationRoute(owner({ model: 'missing-provider' })), /UNAVAILABLE/);
  assert.throws(() => conversationRoute({}), /UNAVAILABLE/);
});
for (const extra of [
  { provider: 'p' }, { model: 'm' }, { provider: 'p', model: ' ' }, { provider: 'p\n', model: 'm' },
  { reasoningEffort: 'low' },
]) test(`invalid or ambiguous routing rejected: ${JSON.stringify(extra)}`, () => assert.throws(() => config(extra)));
test('native request is fresh, tool-free, capped and has no parent session/replay metadata', async () => {
  let received;
  assert.equal((await nativeReview(runtime(opts => { received = opts; }))).decision, 'allow');
  assert.deepEqual(Object.keys(received).sort(), ['maxTokens', 'messages', 'model', 'provider', 'signal', 'system', 'tools']);
  assert.equal(received.maxTokens, 256);
  assert.deepEqual(received.tools, []);
  assert.equal(received.messages.length, 1);
  assert.equal(received.messages[0].role, 'user');
  assert.equal(received.messages[0].id, undefined);
  assert.equal(received.messages[0].source, undefined);
});
test('native explicit denial is not retried or softened', async () => {
  let calls = 0;
  assert.equal((await nativeReview(runtime(() => { calls++; return 'deny'; }))).decision, 'deny');
  assert.equal(calls, 1);
});
test('native cache usage counters are disjoint and counted once', async () => {
  const l = ledger();
  assert.equal((await review(config(), action, 'Inspect status', l, signal(), { llm: runtime(), owner: owner() })).decision, 'allow');
  assert.equal(l.reportedTokens, 35);
});
test('native stream supports completed blocks without deltas, including preceding reasoning', async () => {
  const llm = { async *stream() {
    yield { type: 'block-start', index: 0, blockType: 'reasoning' };
    yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'not returned' } };
    yield { type: 'block-start', index: 1, blockType: 'text' };
    yield { type: 'block-end', index: 1, block: { type: 'text', text: verdict('allow') } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } };
  assert.equal((await nativeReview(llm)).decision, 'allow');
});
for (const kind of ['max-tokens', 'tool-calls', 'error', 'aborted', 'unknown']) {
  test(`native finish ${kind} cannot grant`, async () => {
    const llm = { async *stream() { yield* [...chunks()].slice(0, -1); yield { type: 'finish', reason: { kind } }; } };
    await assert.rejects(nativeReview(llm));
  });
}
for (const invalid of [
  { type: 'tool-call-delta', index: 0, argumentsDelta: '{}' },
  { type: 'block-start', index: 0, blockType: 'tool-call' },
  { type: 'block-end', index: 0, block: { type: 'tool-call', name: 'bash' } },
  { type: 'text-delta', index: -1, text: 'bad' },
]) test(`native invalid chunk ${JSON.stringify(invalid)} cannot grant`, async () => {
  await assert.rejects(nativeReview({ async *stream() { yield invalid; yield* chunks(); } }));
});
test('native missing finish, missing block-end and data after finish fail closed', async () => {
  for (const list of [[...chunks()].slice(0, -1), [...chunks()].filter(c => c.type !== 'block-end'), [...chunks(), { type: 'usage', usage: {} }]]) {
    await assert.rejects(nativeReview({ async *stream() { yield* list; } }));
  }
});
test('native reasoning stream and final text both have byte limits', async () => {
  for (const type of ['text', 'reasoning']) await assert.rejects(nativeReview({ async *stream() {
    yield { type: 'block-end', index: 0, block: { type, text: 'x'.repeat(40000) } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } }), /TOO_LARGE/);
});
test('native signal-ignoring transport still has an outer deadline', async () => {
  await assert.rejects(nativeReview({ async *stream() { await new Promise(() => {}); } }, { timeoutMs: 100 }), /TIMEOUT/);
});
test('native cancel and missing runtime cannot grant', async () => {
  await assert.rejects(nativeReview(undefined), /UNAVAILABLE/);
  const abort = new AbortController();
  const pending = review(config(), action, 'Inspect status', ledger(), abort.signal,
    { llm: { async *stream() { await new Promise(() => {}); } }, owner: owner() });
  abort.abort(); await assert.rejects(pending, /CANCELLED/);
});
test('gate follows different concurrent sessions without sharing model selection', async () => {
  const seen = [];
  const llm = runtime(opts => { seen.push(opts.model); });
  const g = createGate(config(), { getLlm: () => llm });
  const results = await Promise.all(['a', 'b'].map(m => g.decide(call(owner(selected('p', m))))));
  assert.ok(results.every(r => r.kind === 'allow')); assert.deepEqual(seen.sort(), ['a', 'b']);
});
test('model change during review invalidates allow, but a fixed reviewer is unaffected', async () => {
  for (const fixed of [false, true]) {
    const o = owner();
    const llm = runtime(() => { o.state.config = selected('p', 'next'); });
    const c = fixed ? config({ provider: 'reviewer', model: 'small' }) : config();
    const result = await createGate(c, { getLlm: () => llm }).decide(call(o));
    assert.equal(result.kind, fixed ? 'allow' : 'ask');
  }
});
test('a semantic denial stays final even if the conversation model changes mid-review', async () => {
  const o = owner();
  const llm = runtime(() => { o.state.config = selected('p', 'next'); return 'deny'; });
  const result = await createGate(config(), { getLlm: () => llm }).decide(call(o));
  assert.equal(result.kind, 'deny'); assert.equal(result.code, 'MODEL_NOT_ALLOWED');
});
test('model changes do not reset per-task reviewer call limits', async () => {
  const o = owner(); const llm = runtime();
  const g = createGate(config({ maxReviewsPerTask: 1 }), { getLlm: () => llm });
  assert.equal((await g.decide(call(o))).kind, 'allow');
  o.state.config = selected('p', 'new');
  assert.equal((await g.decide(call(o))).kind, 'ask');
});
test('native service removal and missing route fail closed', async () => {
  let llm = runtime(() => { llm = undefined; });
  const g = createGate(config(), { getLlm: () => llm });
  assert.equal((await g.decide(call(owner()))).kind, 'ask');
  assert.equal((await g.decide(call(owner({})))).kind, 'ask');
});
