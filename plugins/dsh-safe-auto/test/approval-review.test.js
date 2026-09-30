import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '../src/config.js';
import { assessApproval } from '../src/approval-review.js';
import { parseStructuredVerdict, review } from '../src/reviewer.js';
import { createGate } from '../src/gate.js';

const config = extra => parseConfig({ mode: 'smart', approvalReview: true,
  endpoint: 'https://review.example/v1', fastModel: 'fast', ...extra });
const call = extra => ({ tool: 'pwsh', args: { command: 'Get-Location; Get-Date', description: 'Inspect location',
  sandbox_permissions: 'danger-full-access', justification: 'Inspect requested location' }, cwd: 'D:\\work',
  sandbox: { mode: 'workspace-write', workspaceRoot: 'D:\\work' }, session: {}, subagent: false, nested: false,
  localExecution: true, signal: new AbortController().signal, task: 1, intent: 'Inspect the current location', ...extra });
const verdict = extra => ({ decision: 'allow', risk: 'low', authorization: 'high', bounded: true,
  reason: 'The operation is covered by direct user intent.', ...extra });
const response = value => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }));
const ledger = () => ({ fastCalls: 0, deepCalls: 0, units: 0, reportedTokens: 0 });

test('approvalReview defaults false and does not alter output budgets', () => {
  const c = parseConfig(); assert.equal(c.approvalReview, false); assert.equal(c.fastOutputTokens, 64); assert.equal(c.deepOutputTokens, 256);
  for (const approvalReview of [1, 'true', null]) assert.throws(() => parseConfig({ approvalReview }));
});
test('Windows PowerShell enters independent review, not POSIX candidate/static proof', () => {
  const req = call(); const result = assessApproval(req, config());
  assert.equal(result.kind, 'review'); assert.deepEqual(result.action.arguments, req.args);
  assert.notEqual(result.action.arguments, req.args);
  assert.deepEqual(result.action.permission, { from: 'workspace-write', to: 'danger-full-access', scope: 'this-call-only' });
  assert.equal(assessApproval(req, parseConfig()).kind, 'ask');
  assert.equal(assessApproval(call({ args: { ...req.args, sandbox_permissions: 'workspace-write' } }), config()).kind, 'review');
});
for (const extra of [{ subagent: true }, { subagent: undefined }, { nested: true }, { nested: undefined },
  { localExecution: false }, { localExecution: undefined }, { remote: true }, { session: null }, { cwd: '' },
  { tool: 'shell' }, { tool: 'run_code' }, { sandbox: { mode: 'danger-full-access' } }]) {
  test(`approval rejects unverified boundary ${JSON.stringify(extra)}`, () => assert.notEqual(assessApproval(call(extra), config()).kind, 'review'));
}
test('hard risk and secrets precede review regardless of explicit mode', () => {
  assert.equal(assessApproval(call({ tool: 'write', args: { file_path: '.env', content: 'a' } }), parseConfig()).kind, 'deny');
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
for (const risk of ['low', 'medium', 'high', 'critical']) for (const authorization of ['high', 'medium', 'low', 'unknown']) for (const bounded of [true, false]) {
  test(`structured policy matrix ${risk}/${authorization}/${bounded}`, () => {
    const value = parseStructuredVerdict(JSON.stringify(verdict({ risk, authorization, bounded })));
    const expected = risk === 'critical' ? 'deny' : risk === 'high' || !bounded || ['low', 'unknown'].includes(authorization) ? 'ask' : 'allow';
    assert.equal(value.decision, expected); assert.equal(value.risk, risk); assert.equal(value.authorization, authorization);
  });
}
test('strict structured shape and vocabulary; deny cannot be softened', () => {
  for (const value of [[], null, { decision: 'allow' }, verdict({ extra: 1 }), verdict({ reason: '' }), verdict({ reason: ' '.repeat(2) }),
    verdict({ reason: 'a'.repeat(513) }), verdict({ risk: 'uncertain' }), verdict({ authorization: 'yes' }), verdict({ bounded: 'true' }), verdict({ decision: 'ALLOW' })]) {
    assert.throws(() => parseStructuredVerdict(JSON.stringify(value)));
  }
  assert.throws(() => parseStructuredVerdict('```json\n{}\n```'));
  assert.equal(parseStructuredVerdict(JSON.stringify(verdict({ decision: 'deny', risk: 'high' }))).decision, 'deny');
  assert.equal(parseStructuredVerdict(JSON.stringify(verdict({ decision: 'review' })), true).decision, 'ask');
});
test('structured fast review goes deep, keeps legacy string interface', async () => {
  const models = []; const c = config({ deepModel: 'deep' }); const action = assessApproval(call(), c).action;
  const result = await review(c, action, 'Inspect the current location', ledger(), new AbortController().signal, async (_, init) => {
    const b = JSON.parse(init.body); models.push(b.model); assert.equal(b.tools, undefined);
    assert.match(b.messages[0].content, /independent reviewer with no tools/);
    assert.deepEqual(JSON.parse(b.messages[1].content).action, action);
    return response(verdict({ decision: b.model === 'fast' ? 'review' : 'allow' }));
  }, { structured: true });
  assert.equal(result.decision, 'allow'); assert.deepEqual(models, ['fast', 'deep']);
  assert.equal(await review(config(), action, 'Inspect location', ledger(), new AbortController().signal,
    async () => response({ decision: 'allow' })), 'allow');
  assert.equal((await review(config(), action, 'Inspect location', ledger(), new AbortController().signal,
    async () => response(verdict({ decision: 'review' })), { structured: true })).decision, 'ask');
});
test('approval gate retains classification and rationale but audit never raw commands', async () => {
  const rows = []; const g = createGate(config(), { audit: row => rows.push(row), fetcher: async () => response(verdict({ reason: 'Get-Location; Get-Date' })) });
  const result = await g.decide(call(), 'approval');
  assert.equal(result.kind, 'allow'); assert.equal(result.risk, 'low'); assert.equal(result.authorization, 'high');
  assert.equal(result.reason, 'Get-Location; Get-Date'); assert.equal(rows[0].risk, 'low');
  assert.ok(!JSON.stringify(rows).includes('Get-Location')); assert.ok(rows[0].reservedUnits > 0);
});
test('approval gate shares original ledger and never refunds failed calls', async () => {
  let count = 0; const c = config({ fastCallsPerTask: 1, consecutiveDenials: 20 });
  const g = createGate(c, { fetcher: async () => { count++; throw new Error('offline'); } }); const req = call();
  assert.equal((await g.decide(req, 'approval')).kind, 'ask');
  assert.equal((await g.decide(req, 'approval', config({ fastCallsPerTask: 1, fastModel: 'other' }))).kind, 'ask');
  assert.equal(count, 1);
});
test('high risk asks, critical denies, truncated completion fails closed', async () => {
  for (const [value, expected] of [[verdict({ risk: 'high' }), 'ask'], [verdict({ risk: 'critical' }), 'deny'], [{ decision: 'allow' }, 'ask']]) {
    const g = createGate(config(), { fetcher: async () => response(value) }); assert.equal((await g.decide(call(), 'approval')).kind, expected);
  }
  const g = createGate(config(), { fetcher: async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: JSON.stringify(verdict()) } }] })) });
  assert.equal((await g.decide(call(), 'approval')).kind, 'ask');
});
test('approval cancellation/disposal and timeout never grant late allows', async () => {
  const c = config({ timeoutMs: 100 });
  const g = createGate(c, { fetcher: () => new Promise(() => {}) });
  assert.equal((await g.decide(call(), 'approval')).kind, 'ask');
  for (const dispose of [false, true]) {
    let release; const controller = new AbortController();
    const gate = createGate(c, { fetcher: () => new Promise(r => { release = r; }) });
    const pending = gate.decide(call({ signal: controller.signal }), 'approval');
    dispose ? gate.dispose() : controller.abort();
    assert.equal((await pending).kind, 'cancel'); release?.(response(verdict()));
  }
});
test('native structured completion remains independent and tool free', async () => {
  const c = parseConfig({ approvalReview: true, mode: 'smart' });
  const routes = { fast: { transport: 'dsh', provider: 'p', model: 'm' } };
  const llm = { async *stream(options) {
    assert.deepEqual(options.tools, []); assert.equal(options.sessionId, undefined);
    assert.equal(options.maxTokens, 64);
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: JSON.stringify(verdict()) } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } };
  const result = await review(c, assessApproval(call(), c).action, 'Inspect current location', ledger(), new AbortController().signal,
    undefined, { structured: true, llm, routes });
  assert.equal(result.decision, 'allow'); assert.equal(result.bounded, true);
});
test('preflight and approval phases share task and session budget ledger', async () => {
  const c = config({ shellCandidates: ['git status'], fastCallsPerTask: 1 }); let count = 0;
  const g = createGate(c, { fetcher: async () => { count++; return response({ decision: 'allow' }); } });
  const req = call({ tool: 'shell', cwd: 'D:\\work', args: { command: 'git status' } });
  const preflightConfig = { ...c, workspaceRoots: [req.cwd] };
  assert.equal((await g.decide(req, 'preflight', preflightConfig)).kind, 'allow');
  assert.equal((await g.decide(call({ session: req.session }), 'approval', c)).kind, 'ask');
  assert.equal(count, 1);
});
test('audit failure cannot grant approval', async () => {
  const g = createGate(config(), { audit() { throw new Error('no audit'); }, fetcher: async () => response(verdict()) });
  assert.equal((await g.decide(call(), 'approval')).code, 'AUDIT_UNAVAILABLE');
});
