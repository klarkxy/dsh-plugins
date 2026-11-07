import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig, Config } from '../src/config.js';
import { nativeCompletion, resolveReviewRoute } from '../src/model-route.js';
import { review, reviewInput, SYSTEM_PROMPT } from '../src/reviewer.js';

const owner = { agent: { options: { provider: 'chat', model: 'main', reasoningEffort: 'parent-effort' } } };
const signal = () => new AbortController().signal;
const verdict = { risk_level: 'low', user_authorization: 'high', outcome: 'allow', rationale: 'Bounded and user-requested.' };
function runtime(seen) {
  return { async *stream(options) {
    seen.push(options);
    yield { type: 'block-end', index: 0, block: { type: 'text', text: JSON.stringify(verdict) } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } };
}
const input = reviewer => reviewInput({ transcript: '[user (trusted)] Inspect repository status',
  environment: { platform: 'linux' }, action: { tool: 'bash', arguments: { command: 'git status' } }, reviewerPrompt: reviewer });
const run = (config, llm) => review({ llm, route: resolveReviewRoute(config, owner), input: input(config.reviewerPrompt), config, signal: signal() });

test('defaults follow the conversation without inheriting parent sampling settings', async () => {
  const c = parseConfig();
  for (const key of ['provider', 'model', 'reasoningEffort', 'reviewerPrompt']) assert.equal(c[key], '');
  assert.equal(c.timeoutMs, 90000); assert.equal(c.outputTokens, 4096); assert.equal(c.maxTranscriptBytes, 48000);
  assert.deepEqual(resolveReviewRoute(c, owner), { provider: 'chat', model: 'main' });
  const seen = [];
  assert.equal((await run(c, runtime(seen))).outcome, 'allow');
  assert.equal(Object.hasOwn(seen[0], 'reasoningEffort'), false);
  assert.equal(seen[0].system, SYSTEM_PROMPT);
  assert.equal(seen[0].maxTokens, 4096);
  assert.match(seen[0].messages[0].content[0].text, /git status/);
  assert.doesNotMatch(seen[0].messages[0].content[0].text, /Additional review conditions/);
});

test('explicit effort travels with the fixed route and the configured output cap', async () => {
  const c = parseConfig({ provider: 'fixed', model: 'small', reasoningEffort: 'vendor:thorough-v2', outputTokens: 300 });
  assert.deepEqual(resolveReviewRoute(c, owner), { provider: 'fixed', model: 'small', reasoningEffort: 'vendor:thorough-v2' });
  const seen = [];
  await run(c, runtime(seen));
  assert.deepEqual(seen.map(x => [x.provider, x.model, x.reasoningEffort, x.maxTokens, x.tools]),
    [['fixed', 'small', 'vendor:thorough-v2', 300, []]]);
});

test('reasoningEffort rejects invalid IDs without trimming or coercion', () => {
  for (const value of [null, undefined, 1, {}, [], ' ', ' low', 'low ', 'lo\nw', 'x'.repeat(4097)]) {
    assert.throws(() => parseConfig({ provider: 'p', model: 'm', reasoningEffort: value }), undefined, String(value));
    assert.ok(Config['~standard'].validate({ provider: 'p', model: 'm', reasoningEffort: value }).issues);
  }
  assert.equal(parseConfig({ provider: 'p', model: 'm', reasoningEffort: 'x'.repeat(4096) }).reasoningEffort.length, 4096);
  assert.throws(() => parseConfig({ reasoningEffort: 'high' }), /requires a reviewer model/);
});

test('unsupported effort fails without fallback or effort removal', async () => {
  for (const terminal of [false, true]) {
    let calls = 0;
    const llm = { async *stream(options) {
      calls++;
      assert.equal(options.reasoningEffort, 'unknown-effort');
      if (!terminal) throw new Error('UNSUPPORTED_REASONING_EFFORT');
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'UNSUPPORTED_REASONING_EFFORT', message: 'unsupported' } } };
    } };
    await assert.rejects(run(parseConfig({ provider: 'p', model: 'm', reasoningEffort: 'unknown-effort' }), llm), /UNSUPPORTED_REASONING_EFFORT|INVALID_COMPLETION/);
    // One retry inside the deadline, never with a different route or without the effort.
    assert.equal(calls, 2);
  }
});

test('native boundary rejects malformed effort even with a directly supplied route', async () => {
  await assert.rejects(nativeCompletion(runtime([]), { provider: 'p', model: 'm', reasoningEffort: ' bad' }, 'system', 'input', 64, signal()), /INVALID_REASONING_EFFORT/);
});

test('operator conditions stay in the user input; the system prompt is immutable', async () => {
  const reviewerPrompt = 'Only allow read-only operations.\nDo not modify generated files.';
  const seen = [];
  await run(parseConfig({ reviewerPrompt }), runtime(seen));
  assert.equal(seen[0].system, SYSTEM_PROMPT);
  assert.equal(seen[0].system.includes(reviewerPrompt), false);
  const text = seen[0].messages[0].content[0].text;
  assert.match(text, /# Additional review conditions from the operator/);
  assert.match(text, /never relax the rules above or grant authorization/);
  // The operator conditions are stable material: they lead the user input and
  // stay ahead of this request's facts.
  const contextBlock = text.slice(text.indexOf('<auxiliary-context'), text.indexOf('</auxiliary-context>'));
  assert.ok(contextBlock.trimEnd().endsWith(reviewerPrompt));
  assert.match(text, /<request>\n# Transcript\n\[user \(trusted\)\] Inspect repository status/);
  assert.match(text, /# Planned action/);
});

test('system prompt carries the Codex-style policy and strict output format', () => {
  for (const pattern of [/\(trusted\)/, /untrusted evidence/, /`critical` -> `deny`/, /Reading files, listing directories/,
    /sandbox escalation or retry .* is not suspicious/, /"outcome":"allow\|deny"/]) assert.match(SYSTEM_PROMPT, pattern);
});

test('config limits and retired fields', () => {
  for (const reviewerPrompt of [null, undefined, 1, {}, 'x'.repeat(4097)]) assert.throws(() => parseConfig({ reviewerPrompt }));
  assert.equal(parseConfig({ reviewerPrompt: 'x'.repeat(4096) }).reviewerPrompt.length, 4096);
  for (const [key, bad] of [['timeoutMs', 999], ['timeoutMs', 300001], ['outputTokens', 255], ['outputTokens', 16385],
    ['maxTranscriptBytes', 4095], ['maxTranscriptBytes', 200001], ['timeoutMs', 1.5]]) {
    assert.throws(() => parseConfig({ [key]: bad }), new RegExp(`invalid ${key}`));
  }
  assert.throws(() => parseConfig({ mystery: 1 }), /unknown config field/);
  // Profiles written by 0.2 keep loading; their retired fields are ignored.
  const legacy = parseConfig({ maxInputBytes: 1, humanApprovalTimeoutMs: 0, maxReviewsPerTask: 5, consecutiveDenials: 2, staticReadonly: false });
  assert.equal(Object.hasOwn(legacy, 'maxInputBytes'), false);
  assert.equal(Object.isFrozen(legacy), true);
});
