import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '../src/config.js';
import { assessApproval, bindingOf, escalationReason } from '../src/approval-review.js';
import { parseStructuredVerdict, review } from '../src/reviewer.js';
import { createGate } from '../src/gate.js';

const config = extra => parseConfig({ provider: 'p', model: 'm', ...extra });
const call = extra => ({ tool: 'pwsh', args: { command: 'Get-Location; Get-Date', description: 'Inspect location',
  sandbox_permissions: 'danger-full-access', justification: 'Inspect requested location' }, cwd: 'D:\\work',
  sandbox: { mode: 'workspace-write', workspaceRoot: 'D:\\work' }, session: {}, subagent: false, nested: false,
  localExecution: true, signal: new AbortController().signal, task: 1, intent: 'Inspect the current location', ...extra });
const verdict = extra => ({ decision: 'allow', risk: 'low', authorization: 'high', bounded: true,
  reason: 'The operation is covered by direct user intent.', ...extra });
const ledger = () => ({ reviews: 0, consecutive: 0, reportedTokens: 0 });
const streamer = (text, inspect) => ({ async *stream(options) { await inspect?.(options);
  yield { type: 'block-end', index: 0, block: { type: 'text', text } };
  yield { type: 'finish', reason: { kind: 'stop' } };
} });
test('Windows PowerShell enters independent review; workspace-write widening is reviewed too', () => {
  const req = call(); const result = assessApproval(req, config());
  assert.equal(result.kind, 'review'); assert.deepEqual(result.action.arguments, req.args);
  assert.notEqual(result.action.arguments, req.args);
  assert.deepEqual(result.action.permission, { from: 'workspace-write', to: 'danger-full-access', scope: 'this-call-only' });
  assert.equal(assessApproval(call({ args: { ...req.args, sandbox_permissions: 'workspace-write' } }), config()).kind, 'review');
  assert.equal(assessApproval(req, parseConfig({ enabled: false })).code, 'SAFE_AUTO_DISABLED');
});
for (const extra of [{ subagent: true }, { subagent: undefined }, { nested: true }, { nested: undefined },
  { localExecution: false }, { localExecution: undefined }, { remote: true }, { session: null }, { cwd: '' },
  { tool: 'shell' }, { tool: 'run_code' }, { sandbox: { mode: 'danger-full-access' } }]) {
  test(`approval rejects unverified boundary ${JSON.stringify(extra)}`, () => assert.notEqual(assessApproval(call(extra), config()).kind, 'review'));
}
test('hard risk and secrets precede review', () => {
  assert.equal(assessApproval(call({ tool: 'write', args: { file_path: '.env', content: 'a' } }), config()).kind, 'deny');
  const req = call();
  assert.equal(assessApproval(call({ args: { ...req.args, command: 'echo token=abc123' } }), config()).kind, 'deny');
  assert.equal(assessApproval(call({ tool: 'write', args: { file_path: 'a.txt', content: 'api_key=abc123',
    sandbox_permissions: 'danger-full-access', justification: 'Write requested source' } }), config()).kind, 'deny');
});
test('unknown and invalid native parameters fail closed', () => {
  const req = call();
  for (const args of [{ ...req.args, env: {} }, { ...req.args, timeout: 2 }, { ...req.args, timeoutMs: 0 },
    { ...req.args, run_in_background: 'true' }, { ...req.args, workdir: '' }, { ...req.args, description: '' },
    { ...req.args, sandbox_permissions: 'require_escalated' }, { ...req.args, justification: undefined }]) {
    assert.equal(assessApproval(call({ args }), config()).kind, 'ask');
  }
  const invisible = { ...req.args }; Object.defineProperty(invisible, 'hidden', { value: 1 });
  assert.equal(assessApproval(call({ args: invisible }), config()).kind, 'ask');
});
test('file schemas accept empty content/replacement but reject invalid fields', () => {
  const base = { file_path: 'D:\\elsewhere\\a.txt', sandbox_permissions: 'danger-full-access', justification: 'Write requested file' };
  for (const [tool, args] of [['write', { ...base, content: '' }], ['edit', { ...base, old_string: 'a', new_string: '', replace_all: false }]]) {
    assert.equal(assessApproval(call({ tool, args }), config()).kind, 'review');
    assert.equal(assessApproval(call({ tool, args: { ...args, extra: 1 } }), config()).kind, 'ask');
  }
  for (const args of [{ ...base }, { ...base, old_string: '', new_string: 'a' }, { ...base, old_string: 'a', new_string: 1 },
    { ...base, old_string: 'a', new_string: '', replace_all: null }]) assert.equal(assessApproval(call({ tool: 'edit', args }), config()).kind, 'ask');
});
test('full contents are verbatim, never truncated', () => {
  const req = call({ tool: 'write', args: { file_path: 'D:\\work\\a.txt', content: '界'.repeat(2000),
    sandbox_permissions: 'danger-full-access', justification: 'Write requested source' } });
  assert.equal(assessApproval(req, config()).action.arguments.content, req.args.content);
  assert.equal(assessApproval(req, config({ maxInputBytes: 512 })).code, 'REVIEW_INPUT_TOO_LARGE');
});
test('grant binding tracks the exact call, authority and environment', () => {
  const req = call();
  const bound = bindingOf(req, assessApproval(req, config()));
  assert.equal(bindingOf(req, assessApproval(req, config())), bound);
  assert.notEqual(bindingOf(call({ intent: 'different' }), assessApproval(req, config())), bound);
  assert.equal(escalationReason(req), 'escalate sandbox to danger-full-access: Inspect requested location');
});
for (const risk of ['low', 'medium', 'high', 'critical']) for (const authorization of ['high', 'medium', 'low', 'unknown']) for (const bounded of [true, false]) {
  test(`structured policy matrix ${risk}/${authorization}/${bounded}`, () => {
    const value = parseStructuredVerdict(JSON.stringify(verdict({ risk, authorization, bounded })));
    const expected = risk === 'critical' ? 'deny' : risk === 'high' || !bounded || ['low', 'unknown'].includes(authorization) ? 'ask' : 'allow';
    assert.equal(value.decision, expected); assert.equal(value.risk, risk); assert.equal(value.authorization, authorization);
  });
}
test('strict structured shape and vocabulary; deny cannot be softened', () => {
  for (const value of [[], null, { decision: 'allow' }, verdict({ extra: 1 }), verdict({ reason: '' }), verdict({ reason: ' '.repeat(2) }),
    verdict({ reason: 'a'.repeat(513) }), verdict({ risk: 'uncertain' }), verdict({ authorization: 'yes' }), verdict({ bounded: 'true' }),
    verdict({ decision: 'ALLOW' }), verdict({ decision: 'review' })]) {
    assert.throws(() => parseStructuredVerdict(JSON.stringify(value)));
  }
  assert.throws(() => parseStructuredVerdict('```json\n{}\n```'));
  assert.equal(parseStructuredVerdict(JSON.stringify(verdict({ decision: 'deny', risk: 'high' }))).decision, 'deny');
});
test('native structured completion remains independent and tool free', async () => {
  let received;
  const result = await review(config({ outputTokens: 96 }), assessApproval(call(), config()).action, 'Inspect current location',
    ledger(), new AbortController().signal, { llm: streamer(JSON.stringify(verdict()), options => { received = options; }) });
  assert.equal(result.decision, 'allow'); assert.equal(result.bounded, true);
  assert.deepEqual(received.tools, []); assert.equal(received.sessionId, undefined); assert.equal(received.maxTokens, 96);
});
test('approval gate retains classification and rationale but audit never raw commands', async () => {
  const rows = [];
  const llm = streamer(JSON.stringify(verdict({ reason: 'Get-Location; Get-Date' })));
  const g = createGate(config(), { audit: row => rows.push(row), getLlm: () => llm });
  const result = await g.decide(call());
  assert.equal(result.kind, 'allow'); assert.equal(result.risk, 'low'); assert.equal(result.authorization, 'high');
  assert.equal(result.reason, 'Get-Location; Get-Date'); assert.equal(rows[0].risk, 'low');
  assert.ok(!JSON.stringify(rows).includes('Get-Location')); assert.equal(rows[0].reviews, 1);
});
test('approval gate shares one ledger and never refunds failed calls', async () => {
  let count = 0; const c = config({ maxReviewsPerTask: 1, consecutiveDenials: 20 });
  const llm = { async *stream() { count++; throw new Error('offline'); } };
  const g = createGate(c, { getLlm: () => llm }); const req = call();
  assert.equal((await g.decide(req)).kind, 'ask');
  assert.equal((await g.decide(req, config({ maxReviewsPerTask: 1, model: 'other' }))).kind, 'ask');
  assert.equal(count, 1);
});
test('high risk asks, critical denies, truncated completion fails closed', async () => {
  for (const [value, expected] of [[verdict({ risk: 'high' }), 'ask'], [verdict({ risk: 'critical' }), 'deny'], [{ decision: 'allow' }, 'ask']]) {
    const g = createGate(config(), { getLlm: () => streamer(JSON.stringify(value)) });
    assert.equal((await g.decide(call())).kind, expected);
  }
  const truncated = { async *stream() { yield { type: 'block-end', index: 0, block: { type: 'text', text: JSON.stringify(verdict()) } };
    yield { type: 'finish', reason: { kind: 'max-tokens' } }; } };
  assert.equal((await createGate(config(), { getLlm: () => truncated }).decide(call())).kind, 'ask');
});
test('cancellation, disposal and timeout never grant late allows', async () => {
  const c = config({ timeoutMs: 100 });
  const hanging = { async *stream() { await new Promise(() => {}); } };
  assert.equal((await createGate(c, { getLlm: () => hanging }).decide(call())).kind, 'ask');
  for (const dispose of [false, true]) {
    let release; const controller = new AbortController();
    const llm = { async *stream() { await new Promise(r => { release = r; }); yield { type: 'block-end', index: 0, block: { type: 'text', text: JSON.stringify(verdict()) } }; yield { type: 'finish', reason: { kind: 'stop' } }; } };
    const g = createGate(c, { getLlm: () => llm });
    const pending = g.decide(call({ signal: controller.signal }));
    dispose ? g.dispose() : controller.abort();
    assert.equal((await pending).kind, 'cancel'); release?.();
  }
});
test('circuit breaker and subagent refusal are fail-closed', async () => {
  let calls = 0;
  const llm = { async *stream() { calls++; yield { type: 'block-end', index: 0, block: { type: 'text', text: JSON.stringify(verdict({ decision: 'deny' })) } }; yield { type: 'finish', reason: { kind: 'stop' } }; } };
  const g = createGate(config({ consecutiveDenials: 2 }), { getLlm: () => llm });
  const req = call();
  await g.decide(req); await g.decide(req);
  assert.equal((await g.decide(req)).code, 'CIRCUIT_OPEN'); assert.equal(calls, 2);
  assert.equal((await g.decide({ ...req, subagent: true })).kind, 'ask'); assert.equal(calls, 2);
});
test('audit failure cannot grant approval', async () => {
  const g = createGate(config(), { audit() { throw new Error('no audit'); }, getLlm: () => streamer(JSON.stringify(verdict())) });
  assert.equal((await g.decide(call())).code, 'AUDIT_UNAVAILABLE');
});
