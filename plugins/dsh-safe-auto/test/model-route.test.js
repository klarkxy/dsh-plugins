import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '../src/config.js';
import { conversationRoute, resolveReviewRoute, nativeCompletion, sameRoute } from '../src/model-route.js';

const config = extra => parseConfig({ ...extra });
const signal = () => new AbortController().signal;
const selected = (provider = 'chat-provider', model = 'chat-model') => ({ provider, model });
function owner(route = selected()) {
  const state = { config: route };
  const session = { header: {}, requestHeader: () => state };
  return { state, session, agent: { session, options: selected('old-provider', 'old-model') } };
}
const VERDICT = '{"outcome":"allow"}';
function* chunks(text = VERDICT) {
  yield { type: 'block-start', index: 0, blockType: 'text' };
  yield { type: 'text-delta', index: 0, text };
  yield { type: 'block-end', index: 0, block: { type: 'text', text } };
  yield { type: 'usage', usage: { inputTokens: 10, cacheReadTokens: 20, outputTokens: 5 } };
  yield { type: 'finish', reason: { kind: 'stop' } };
}
const runtime = inspect => ({ async *stream(options) { inspect?.(options); yield* chunks(); } });
const route = { provider: 'p', model: 'm' };
const complete = (llm, extra = {}) => nativeCompletion(llm, { ...route, ...extra }, 'system', 'input', 4096, signal());

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
test('sameRoute compares the snapshotted route', () => {
  assert.equal(sameRoute(route, { ...route }), true);
  assert.equal(sameRoute(route, { ...route, reasoningEffort: 'low' }), false);
});
for (const extra of [
  { provider: 'p' }, { model: 'm' }, { provider: 'p', model: ' ' }, { provider: 'p\n', model: 'm' },
  { reasoningEffort: 'low' },
]) test(`invalid or ambiguous routing rejected: ${JSON.stringify(extra)}`, () => assert.throws(() => config(extra)));

test('native request is fresh, tool-free, capped and has no parent session/replay metadata', async () => {
  let received;
  const result = await complete(runtime(opts => { received = opts; }));
  assert.equal(result.text, VERDICT);
  assert.equal(result.totalTokens, 35, 'cache counters are disjoint and counted once');
  assert.deepEqual(Object.keys(received).sort(), ['maxTokens', 'messages', 'model', 'provider', 'signal', 'system', 'tools']);
  assert.equal(received.maxTokens, 4096);
  assert.deepEqual(received.tools, []);
  assert.equal(received.messages.length, 1);
  assert.equal(received.messages[0].role, 'user');
  assert.equal(received.messages[0].id, undefined);
  assert.equal(received.messages[0].source, undefined);
});
test('reasoning effort is forwarded only when present', async () => {
  let received;
  await complete(runtime(opts => { received = opts; }), { reasoningEffort: 'low' });
  assert.equal(received.reasoningEffort, 'low');
  await assert.rejects(complete(runtime(), { reasoningEffort: 'bad\nvalue' }), /INVALID_REASONING_EFFORT/);
});
test('native stream supports completed blocks without deltas; reasoning text is not returned', async () => {
  const llm = { async *stream() {
    yield { type: 'block-start', index: 0, blockType: 'reasoning' };
    yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'not returned' } };
    yield { type: 'block-start', index: 1, blockType: 'text' };
    yield { type: 'block-end', index: 1, block: { type: 'text', text: VERDICT } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } };
  assert.equal((await complete(llm)).text, VERDICT);
});
for (const kind of ['max-tokens', 'tool-calls', 'error', 'aborted', 'unknown']) {
  test(`native finish ${kind} fails`, async () => {
    const llm = { async *stream() { yield* [...chunks()].slice(0, -1); yield { type: 'finish', reason: { kind } }; } };
    await assert.rejects(complete(llm));
  });
}
for (const invalid of [
  { type: 'tool-call-delta', index: 0, argumentsDelta: '{}' },
  { type: 'block-start', index: 0, blockType: 'tool-call' },
  { type: 'block-end', index: 0, block: { type: 'tool-call', name: 'bash' } },
  { type: 'text-delta', index: -1, text: 'bad' },
]) test(`native invalid chunk ${JSON.stringify(invalid)} fails`, async () => {
  await assert.rejects(complete({ async *stream() { yield invalid; yield* chunks(); } }));
});
test('native missing finish, missing block-end and data after finish fail closed', async () => {
  for (const list of [[...chunks()].slice(0, -1), [...chunks()].filter(c => c.type !== 'block-end'), [...chunks(), { type: 'usage', usage: {} }]]) {
    await assert.rejects(complete({ async *stream() { yield* list; } }));
  }
});
test('long reasoning within the stream limit is accepted', async () => {
  const llm = { async *stream() {
    yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'r'.repeat(256 * 1024) } };
    yield { type: 'block-end', index: 1, block: { type: 'text', text: VERDICT } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } };
  assert.equal((await complete(llm)).text, VERDICT);
});
test('stream total is capped at 512 KiB and final text at 16 KiB', async () => {
  await assert.rejects(complete({ async *stream() {
    yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'x'.repeat(512 * 1024 + 1) } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } }), /TOO_LARGE/);
  await assert.rejects(complete({ async *stream() {
    yield { type: 'block-start', index: 0, blockType: 'reasoning' };
    for (let i = 0; i < 9; i++) yield { type: 'reasoning-delta', index: 0, text: 'x'.repeat(64 * 1024) };
  } }), /TOO_LARGE/);
  await assert.rejects(complete({ async *stream() {
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'x'.repeat(16 * 1024 + 1) } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } }), /INVALID_COMPLETION/);
});
test('native cancel and missing runtime fail', async () => {
  await assert.rejects(complete(undefined), /NATIVE_REVIEWER_UNAVAILABLE/);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(nativeCompletion(runtime(), route, 's', 'i', 10, abort.signal));
});
