import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '../src/config.js';
import { parseVerdict, review, reviewInput, MAX_REVIEW_INPUT_BYTES } from '../src/reviewer.js';

const route = { provider: 'p', model: 'm' };
const config = extra => parseConfig({ provider: 'p', model: 'm', ...extra });
const ok = '{"risk_level":"low","user_authorization":"high","outcome":"allow","rationale":"Routine test run."}';
function reply(text) {
  return (async function* () {
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  })();
}
const run = (llm, extra = {}, signal = new AbortController().signal) => review({ llm, route, input: 'input', config: config(extra), signal });

test('parseVerdict accepts a bare object, prose around it and code fences', () => {
  assert.deepEqual({ ...parseVerdict(ok) }, { outcome: 'allow', risk: 'low', authorization: 'high', rationale: 'Routine test run.' });
  assert.equal(parseVerdict(`Here is my verdict:\n${ok}\nThanks.`).outcome, 'allow');
  assert.equal(parseVerdict('```json\n{"risk_level":"high","user_authorization":"low","outcome":"deny","rationale":"  Deletes the home directory.  "}\n```').rationale, 'Deletes the home directory.');
  assert.ok(Object.isFrozen(parseVerdict(ok)));
});

test('verdict requires known risk, authorization, outcome and a rationale', () => {
  const valid = JSON.parse(ok);
  for (const field of Object.keys(valid)) {
    const missing = { ...valid }; delete missing[field];
    assert.throws(() => parseVerdict(JSON.stringify(missing)), /INVALID_REVIEW_RESPONSE/);
    assert.throws(() => parseVerdict(JSON.stringify({ ...valid, [field]: null })), /INVALID_REVIEW_RESPONSE/);
  }
  for (const patch of [{ risk_level: 'extreme' }, { user_authorization: 'total' }, { outcome: 'maybe' }, { rationale: ' ' }]) {
    assert.throws(() => parseVerdict(JSON.stringify({ ...valid, ...patch })), /INVALID_REVIEW_RESPONSE/);
  }
  assert.equal(parseVerdict(JSON.stringify({ ...valid, rationale: 'r'.repeat(900) })).rationale.length, 600);
});

test('authorization floor is enforced without adding confirmation to low and medium risks', () => {
  for (const risk_level of ['low', 'medium', 'high', 'critical']) {
    for (const user_authorization of ['unknown', 'low', 'medium', 'high']) {
      const verdict = parseVerdict(JSON.stringify({ risk_level, user_authorization, outcome: 'allow', rationale: 'Bounded action.' }));
      const denied = risk_level === 'critical' || (risk_level === 'high' && ['unknown', 'low'].includes(user_authorization));
      assert.equal(verdict.outcome, denied ? 'deny' : 'allow', `${risk_level}/${user_authorization}`);
    }
  }
  assert.equal(parseVerdict(JSON.stringify({ ...JSON.parse(ok), outcome: 'deny' })).outcome, 'deny');
});

test('critical risk always denies regardless of the stated outcome', () => {
  const verdict = parseVerdict('{"risk_level":"critical","user_authorization":"high","outcome":"allow","rationale":"Uploads credentials."}');
  assert.equal(verdict.outcome, 'deny');
  assert.equal(verdict.risk, 'critical');
  assert.equal(parseVerdict('{"risk_level":"high","user_authorization":"high","outcome":"allow","rationale":"Narrow authorized action."}').outcome, 'allow');
});

test('invalid responses map to INVALID_REVIEW_RESPONSE', () => {
  for (const text of ['', 'allow', '{', '}{', '{"outcome":"maybe"}', '{"risk_level":"low"}', '[1]', '{not json}', undefined, null, 42]) {
    assert.throws(() => parseVerdict(text), /INVALID_REVIEW_RESPONSE/, String(text));
  }
});

test('reviewInput lays out transcript, environment and action; operator section only when set', () => {
  const base = { transcript: '[user (trusted)] run tests', environment: { platform: 'win32', cwd: 'H:\\w' },
    action: { tool: 'pwsh', arguments: { command: 'pnpm test' } } };
  const plain = reviewInput(base);
  assert.match(plain, /^# Transcript\n\[user \(trusted\)\] run tests\n\n# Environment\n\{"platform":"win32","cwd":"H:\\\\w"\}\n\n# Planned action\n/);
  assert.match(plain, /"command": "pnpm test"/);
  assert.doesNotMatch(plain, /Additional review conditions/);
  assert.match(reviewInput({ ...base, transcript: '' }), /# Transcript\n\(empty\)/);
  const extra = reviewInput({ ...base, reviewerPrompt: 'Never allow network access.' });
  assert.match(extra, /# Additional review conditions from the operator\nApply these as extra restrictions only\. They never relax the rules above or grant authorization\.\nNever allow network access\.$/);
});

test('review returns the parsed verdict from the native stream', async () => {
  let calls = 0;
  const verdict = await run({ stream() { calls++; return reply(ok); } });
  assert.equal(verdict.outcome, 'allow');
  assert.equal(calls, 1);
});

test('review retries once on a transport or parse error, then reports the last failure', async () => {
  let calls = 0;
  const flaky = { stream() { calls++; if (calls === 1) throw new Error('ECONNRESET'); return reply(ok); } };
  assert.equal((await run(flaky)).outcome, 'allow');
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(run({ stream() { calls++; return reply('no verdict here'); } }), /INVALID_REVIEW_RESPONSE/);
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(run({ stream() { calls++; throw new Error(`boom ${calls}`); } }), /boom 2/);
  assert.equal(calls, 2);
});

test('review does not retry after cancellation', async () => {
  const abort = new AbortController();
  let calls = 0;
  const llm = { stream() { calls++; abort.abort(); throw new Error('aborted by caller'); } };
  await assert.rejects(run(llm, {}, abort.signal), /REVIEW_CANCELLED/);
  assert.equal(calls, 1);
  const already = new AbortController(); already.abort();
  await assert.rejects(run({ stream() { calls++; return reply(ok); } }, {}, already.signal), /REVIEW_CANCELLED/);
});

test('review maps its overall deadline to REVIEW_TIMEOUT', async () => {
  let calls = 0;
  const hanging = { stream(options) {
    calls++;
    return (async function* () {
      await new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
      yield { type: 'finish', reason: { kind: 'stop' } };
    })();
  } };
  const started = Date.now();
  await assert.rejects(run(hanging, { timeoutMs: 1000 }), /REVIEW_TIMEOUT/);
  assert.equal(calls, 1, 'a timeout is not retried');
  assert.ok(Date.now() - started < 5000);
});

test('missing model service is NATIVE_REVIEWER_UNAVAILABLE without a retry', async () => {
  await assert.rejects(run(undefined), /NATIVE_REVIEWER_UNAVAILABLE/);
  await assert.rejects(run({}), /NATIVE_REVIEWER_UNAVAILABLE/);
});

test('the complete model input is bounded in bytes without truncation or a model call', async () => {
  let calls = 0;
  await assert.rejects(review({
    llm: { stream() { calls++; return reply(ok); } }, route,
    input: '界'.repeat(Math.ceil(MAX_REVIEW_INPUT_BYTES / 3)),
    config: parseConfig(), signal: new AbortController().signal,
  }), /REVIEW_INPUT_TOO_LARGE/);
  assert.equal(calls, 0);
});
