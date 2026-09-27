import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from '../src/config.js';
import { conversationRoute, resolveReviewRoutes, nativeCompletion } from '../src/model-route.js';
import { review } from '../src/reviewer.js';
import { createGate } from '../src/gate.js';
import { apply } from '../src/index.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'safe-auto-model-')));
test.after(() => rmSync(root, { recursive: true, force: true }));
const command = 'git status --short';
const config = extra => parseConfig({ mode: 'smart', workspaceRoots: [root], shellCandidates: [command], ...extra });
const signal = () => new AbortController().signal;
const ledger = () => ({ fastCalls: 0, deepCalls: 0, units: 0, reportedTokens: 0 });
const selected = (provider = 'chat-provider', model = 'chat-model') => ({ provider, model });
function owner(route = selected()) {
  const state = { config: route };
  const session = { header: { cwd: root }, requestHeader: () => state,
    snapshotEvents: () => [{ type: 'user/message', seq: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Inspect repository status' }] } }],
  };
  return { state, session, agent: { session, options: selected('old-provider', 'old-model') } };
}
const call = own => ({ ...own, tool: 'bash', args: { command }, cwd: root, sandbox: { mode: 'workspace-write', workspaceRoot: root },
  signal: signal(), task: 1, intent: 'Inspect repository status', callId: 'one' });
function* chunks(decision = 'allow') {
  const text = JSON.stringify({ decision });
  yield { type: 'block-start', index: 0, blockType: 'text' };
  yield { type: 'text-delta', index: 0, text };
  yield { type: 'block-end', index: 0, block: { type: 'text', text } };
  yield { type: 'usage', usage: { inputTokens: 10, cacheReadTokens: 20, outputTokens: 5 } };
  yield { type: 'finish', reason: { kind: 'stop' } };
}
const runtime = inspect => ({ async *stream(options) { const d = await inspect?.(options); yield* chunks(d ?? 'allow'); } });
const noHttp = () => { throw new Error('must not use direct HTTP'); };
const nativeReview = (llm, extra = {}) => review(config(extra), { tool: 'bash', command }, 'Inspect repository status', ledger(), signal(), noHttp,
  { llm, owner: owner() });

test('default follows accepted conversation route without copying main-agent settings', () => {
  const o = owner({ ...selected(), maxTokens: 90000, tools: ['shell'], reasoningEffort: 'high' });
  assert.deepEqual(resolveReviewRoutes(config(), o), { fast: { transport: 'dsh', ...selected() }, deep: null });
  assert.deepEqual(conversationRoute(o), selected());
  o.state.config = selected('other', 'next');
  assert.equal(resolveReviewRoutes(config(), o).fast.model, 'next');
});
test('fixed model is independent; deep can use a different native provider', () => {
  const c = config({ fastProvider: 'reviewer', fastModel: 'small', deepProvider: 'judge', deepModel: 'large' });
  assert.deepEqual(resolveReviewRoutes(c, owner()), { fast: { transport: 'dsh', provider: 'reviewer', model: 'small' },
    deep: { transport: 'dsh', provider: 'judge', model: 'large' } });
  assert.equal(resolveReviewRoutes(c).fast.model, 'small');
});
test('deep can be independently set while the primary reviewer follows the conversation', () => {
  assert.equal(resolveReviewRoutes(config({ deepProvider: 'judge', deepModel: 'large' }), owner()).fast.model, 'chat-model');
});
test('options are a fallback only when the accepted request header is absent', () => {
  assert.deepEqual(conversationRoute({ agent: { options: selected() } }), selected());
  assert.throws(() => conversationRoute(owner({ model: 'missing-provider' })), /UNAVAILABLE/);
  assert.throws(() => conversationRoute({}), /UNAVAILABLE/);
});
for (const extra of [
  { fastProvider: 'p' }, { fastModel: 'm' }, { deepProvider: 'p' }, { deepModel: 'm' },
  { fastProvider: 'p', fastModel: ' ' }, { fastProvider: 'p\n', fastModel: 'm' },
  { endpoint: 'https://review.example/v1', fastModel: 'm', fastProvider: 'p' },
  { endpoint: 'https://review.example/v1', fastModel: 'm', deepProvider: 'p', deepModel: 'd' },
]) test(`invalid or ambiguous routing rejected: ${JSON.stringify(extra)}`, () => assert.throws(() => config(extra)));
test('existing HTTP config is preserved and never needs conversation credentials', () => {
  const c = config({ endpoint: 'https://review.example/v1', fastModel: 'http-fast', deepModel: 'http-deep' });
  assert.deepEqual(resolveReviewRoutes(c).fast, { transport: 'http', endpoint: c.endpoint, model: 'http-fast' });
});
test('native request is fresh, tool-free, capped and has no parent session/replay metadata', async () => {
  let received;
  assert.equal(await nativeReview(runtime(opts => { received = opts; })), 'allow');
  assert.deepEqual(Object.keys(received).sort(), ['maxTokens', 'messages', 'model', 'provider', 'signal', 'system', 'tools']);
  assert.equal(received.maxTokens, 64);
  assert.deepEqual(received.tools, []);
  assert.equal(received.messages.length, 1);
  assert.equal(received.messages[0].role, 'user');
  assert.equal(received.messages[0].id, undefined);
  assert.equal(received.messages[0].source, undefined);
});
test('native fast/deep routing and budgets stay independent of the chat model budget', async () => {
  const seen = [];
  assert.equal(await nativeReview(runtime(opts => { seen.push([opts.provider, opts.model, opts.maxTokens]); return opts.model === 'chat-model' ? 'review' : 'allow'; }),
    { deepProvider: 'judge', deepModel: 'large' }), 'allow');
  assert.deepEqual(seen, [['chat-provider', 'chat-model', 64], ['judge', 'large', 256]]);
});
test('unconfigured deep does not silently start a second call on the chat model', async () => {
  let calls = 0;
  assert.equal(await nativeReview(runtime(() => { calls++; return 'review'; })), 'ask');
  assert.equal(calls, 1);
});
test('native explicit denial is not retried or sent to a deep or HTTP fallback', async () => {
  let calls = 0;
  assert.equal(await nativeReview(runtime(() => { calls++; return 'deny'; }), { deepProvider: 'judge', deepModel: 'large' }), 'deny');
  assert.equal(calls, 1);
});
test('native cache usage counters are disjoint and counted once', async () => {
  const l = ledger();
  assert.equal(await review(config(), { command }, 'Inspect status', l, signal(), noHttp, { llm: runtime(), owner: owner() }), 'allow');
  assert.equal(l.reportedTokens, 35);
});
test('native stream supports completed blocks without deltas, including preceding reasoning', async () => {
  const llm = { async *stream() {
    yield { type: 'block-start', index: 0, blockType: 'reasoning' };
    yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'not returned' } };
    yield { type: 'block-start', index: 1, blockType: 'text' };
    yield { type: 'block-end', index: 1, block: { type: 'text', text: '{"decision":"allow"}' } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } };
  assert.equal(await nativeReview(llm), 'allow');
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
  const pending = review(config(), { command }, 'Inspect status', ledger(), abort.signal, noHttp,
    { llm: { async *stream() { await new Promise(() => {}); } }, owner: owner() });
  abort.abort(); await assert.rejects(pending, /CANCELLED/);
});
test('gate follows different concurrent sessions without sharing model selection', async () => {
  const seen = [];
  const llm = runtime(opts => { seen.push(opts.model); });
  const g = createGate(config(), { getLlm: () => llm, fetcher: noHttp });
  const results = await Promise.all(['a', 'b'].map(m => g.decide(call(owner(selected('p', m))))));
  assert.ok(results.every(r => r.kind === 'allow')); assert.deepEqual(seen.sort(), ['a', 'b']);
});
test('model change during review invalidates allow, but a fixed reviewer is unaffected', async () => {
  for (const fixed of [false, true]) {
    const o = owner();
    const llm = runtime(() => { o.state.config = selected('p', 'next'); });
    const c = fixed ? config({ fastProvider: 'reviewer', fastModel: 'small' }) : config();
    const result = await createGate(c, { getLlm: () => llm }).decide(call(o));
    assert.equal(result.kind, fixed ? 'allow' : 'ask');
  }
});
test('model changes do not reset per-task reviewer call limits', async () => {
  const o = owner(); const llm = runtime();
  const g = createGate(config({ fastCallsPerTask: 1 }), { getLlm: () => llm });
  assert.equal((await g.decide(call(o))).kind, 'allow');
  o.state.config = selected('p', 'new');
  assert.equal((await g.decide(call(o))).kind, 'ask');
});
test('native service removal and missing route fail closed without HTTP fallback', async () => {
  let llm = runtime(() => { llm = undefined; });
  const g = createGate(config(), { getLlm: () => llm, fetcher: noHttp });
  assert.equal((await g.decide(call(owner()))).kind, 'ask');
  assert.equal((await g.decide(call(owner({})))).kind, 'ask');
});

function mockHost(extra = {}) {
  const listeners = {}, disposers = [];
  let guard;
  const llm = runtime();
  const ctx = {
    tools: { guard(fn) { guard = fn; } },
    sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: root }) },
    logger: { info() {} }, effect(fn) { disposers.push(fn()); }, on(event, fn) { listeners[event] = fn; },
    inject(deps, fn) { assert.deepEqual(deps, ['llm']); fn({ llm, effect: ctx.effect }); },
    get(key) { if (key === 'fs') return { processPathFromHostPath: p => p }; },
  };
  apply(ctx, { ...config(), ...extra });
  return { listeners, guard: exec => guard(exec), dispose() { disposers.reverse().forEach(fn => fn()); } };
}
test('final guard catches a model change after the preflight result', async () => {
  const h = mockHost(); const o = owner();
  const exec = { agent: o.agent, token: Symbol(), name: 'bash', arguments: { command }, callId: 'x', signal: signal() };
  await h.listeners['tools/pre-execute'](exec, async () => ({ kind: 'allow' }));
  assert.equal(h.guard(exec), undefined);
  o.state.config = selected('p', 'changed');
  assert.match(h.guard(exec), /REVIEW_MODEL_CHANGED/); h.dispose();
});
test('one-shot escalation uses the same conversation-following native reviewer', async () => {
  const target = join(root, 'grant.txt'); writeFileSync(target, 'old');
  const h = mockHost({ escalationCandidates: [{ tool: 'write', cwd: root, mode: 'danger-full-access', filePath: target }] });
  const o = owner();
  const exec = { agent: o.agent, token: Symbol(), name: 'write', callId: 'x', signal: signal(),
    arguments: { file_path: target, content: 'new', sandbox_permissions: 'danger-full-access', justification: 'update file' } };
  assert.equal((await h.listeners['tools/pre-execute'](exec, async () => ({ kind: 'allow' }))).kind, 'allow');
  assert.equal(h.guard(exec), undefined);
  const result = await h.listeners['tools/execute'](exec, () => h.listeners['approval/request']({ agent: o.agent,
    callId: exec.callId, toolName: exec.name, signal: exec.signal, reason: 'escalate sandbox to danger-full-access: update file' },
  async () => { throw new Error('should not need human fallback'); }));
  assert.equal(result, 'allowed-once'); h.dispose();
});
