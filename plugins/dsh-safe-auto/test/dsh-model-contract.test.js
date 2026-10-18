import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as safeAuto from '../src/index.js';
import { createControl } from '../src/control.js';
import { parseConfig } from '../src/config.js';

// Use the SAME pinned packages as the workspace's DSH contract tests.
const requireHost = createRequire(new URL('../../dsh-dev-index/package.json', import.meta.url));
let host;
try {
  const toolsPath = requireHost.resolve('@deepseek-ai/dsh-tools');
  const requireTools = createRequire(toolsPath);
  const load = (require, name) => import(pathToFileURL(require.resolve(name)).href);
  host = {
    cordis: await load(requireHost, '@deepseek-ai/cordis'),
    prompt: await load(requireHost, '@deepseek-ai/dsh-system-prompt'),
    tools: await import(pathToFileURL(toolsPath).href),
    llm: await load(requireTools, '@deepseek-ai/dsh-llm'),
    approval: await load(requireTools, '@deepseek-ai/dsh-user-approval'),
    sandbox: await load(requireTools, '@deepseek-ai/dsh-sandbox'),
  };
} catch (error) {
  if (process.env.CI || error.code !== 'MODULE_NOT_FOUND') throw error;
}
const skip = !host && 'DSH dependencies unavailable locally; mandatory in CI';
const text = result => result.content.map(block => block.text ?? '').join('\n');

/** Real Cordis + ToolRuntime + ApprovalService + LlmRuntime with a scripted reviewer adapter. */
async function harness(t, { config = {} } = {}) {
  const { Context, Service } = host.cordis;
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'safe-auto-native-')));
  const ctx = new Context(), mounted = [], events = [], seen = [], downstream = [], bodies = [];
  const state = { mode: 'workspace-write', verdict: { risk_level: 'low', user_authorization: 'high', outcome: 'allow', rationale: 'Bounded user-requested action.' } };
  t.after(async () => {
    try { for (const fiber of mounted.reverse()) await fiber.dispose(); }
    finally { rmSync(root, { recursive: true, force: true }); }
  });
  class SandboxFixture extends Service {
    constructor(scope) { super(scope, 'sandboxPolicy'); }
    resolve() { return { mode: state.mode, workspaceRoot: root }; }
  }
  mounted.push(await ctx.plugin(host.prompt.default, {}));
  mounted.push(await ctx.plugin(host.tools.default));
  mounted.push(await ctx.plugin(SandboxFixture));
  class WorkingDirectoryFixture extends Service {
    constructor(scope) { super(scope, 'workingDirectory'); }
    get() { return root; }
  }
  mounted.push(await ctx.plugin(WorkingDirectoryFixture));
  mounted.push(await ctx.plugin(host.approval.default, { policy: 'ask' }));
  const modelFiber = await ctx.plugin(host.llm.default); mounted.push(modelFiber);
  class Reviewer extends host.llm.LlmAdapter {
    async *stream(options) {
      seen.push(options);
      assert.deepEqual(options.tools, []);
      assert.equal(options.messages.length, 1);
      assert.equal(options.sessionId, undefined);
      if (state.wait) { state.enter?.(); await state.wait; }
      const reply = JSON.stringify(state.verdict);
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: reply };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  ctx.llm.registerAdapter(['conversation'], new Reviewer());
  const target = join(root, 'target.txt'); writeFileSync(target, 'before');
  const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] };
  // `write` consumes the real native escalation helper; effects stay in the temp directory.
  ctx.tools.register({ name: 'write', description: 'escalating write fixture', parameters: { type: 'object', properties: {} }, output,
    async execute(args, exec) {
      bodies.push('write');
      const mode = args.sandbox_permissions === undefined ? 'workspace-write' : await host.sandbox.approveEscalation({
        requestedMode: args.sandbox_permissions, effectiveMode: 'workspace-write', justification: args.justification, subject: 'operation',
      }, { approver: ctx.approval, agent: exec.agent, callId: exec.callId, toolName: 'write', signal: exec.signal });
      if (args.file_path !== target) throw new Error('fixture target mismatch');
      writeFileSync(target, args.content); return mode;
    } });
  // Shell and read fixtures never start a process; they only record that the body ran.
  for (const name of ['bash', 'pwsh', 'read', 'grep']) {
    ctx.tools.register({ name, description: `${name} fixture`, parameters: { type: 'object', properties: {} }, output,
      async execute(args, exec) {
        const mode = args.sandbox_permissions === undefined ? state.mode : await host.sandbox.approveEscalation({
          requestedMode: args.sandbox_permissions, effectiveMode: state.mode, justification: args.justification, subject: 'command',
        }, { approver: ctx.approval, agent: exec.agent, callId: exec.callId, toolName: name, signal: exec.signal });
        bodies.push(`${name}:${args.command ?? args.file_path ?? args.pattern}`);
        return mode;
      } });
  }
  // A downstream answerer would grant anything; Safe Auto must answer before it.
  ctx.on('approval/request', async req => { downstream.push(req.toolName); return 'allowed-once'; });
  const session = { id: 'native-contract', header: { cwd: root },
    get seq() { return events.length; }, eventAt(seq) { return events[seq]; },
    requestHeader: () => ({ config: { provider: 'conversation', model: 'one' } }),
    snapshotEvents(from = 0) { return events.slice(from); }, append(type, data) { events.push({ seq: events.length, type, data }); } };
  session.append('turn/start', {});
  session.append('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: `Write "after" to ${target}.` }] });
  const agent = { id: 'native-agent', session };
  mounted.push(await ctx.plugin(safeAuto, config));
  let calls = 0;
  const execute = (name, args) => ctx.tools.execute({ callId: `call-${++calls}`, name, agent, signal: new AbortController().signal, arguments: args });
  const escalatedWrite = () => execute('write', { file_path: target, content: 'after',
    sandbox_permissions: 'danger-full-access', justification: 'Write the note the user specified.' });
  const decided = () => events.filter(e => e.type === 'approval/decided').map(e => e.data.outcome);
  return { ctx, state, seen, downstream, bodies, events, session, target, execute, escalatedWrite, decided, modelFiber };
}

async function enableControl(h, t) {
  const presets = {
    catalog: () => ({ options: ['workspace-write', 'read-only'].map(value => ({ value, name: value })) }),
    current: () => h.state.mode,
    resolve: value => ({ sandbox: value, approval: 'ask' }),
    set: (session, value) => { h.state.mode = value; session.append('permission/preset', { preset: value }); },
  };
  const owner = createControl(parseConfig({ provider: 'conversation', model: 'one' }), {
    table: { get: () => undefined, put: async () => {} }, presets, sandboxPolicy: h.ctx.sandboxPolicy,
    sessions: { get: () => h.session, list: () => [h.session] },
  });
  const detach = h.ctx.safeAutoRuntime.attach(owner);
  t.after(async () => { detach(); await owner.dispose(); });
  const select = async value => owner.call('session.select', { sessionId: h.session.id,
    expectedRevision: (await owner.call('session.get', { sessionId: h.session.id })).revision, value });
  await select('safe-auto');
  return { owner, select };
}

test('escalated write: reviewer allow runs it once; deny returns the denial guidance without a downstream answerer',
  { skip }, async t => {
    const h = await harness(t);
    const allowed = await h.escalatedWrite();
    assert.equal(allowed.isError, false, JSON.stringify(allowed));
    assert.equal(readFileSync(h.target, 'utf8'), 'after');
    assert.equal(h.seen.length, 1);
    assert.deepEqual([h.seen[0].provider, h.seen[0].model], ['conversation', 'one']);
    const input = h.seen[0].messages[0].content[0].text;
    assert.match(input, /\[user \(trusted\)\] Write "after" to /);
    assert.match(input, /"sandbox_permissions": "danger-full-access"/);
    assert.deepEqual(h.decided(), ['allowed-once']);
    assert.deepEqual(h.downstream, []);
    assert.equal(h.ctx.sandboxPolicy.resolve().mode, 'workspace-write', 'standing policy is never changed');

    writeFileSync(h.target, 'before');
    h.state.verdict = { risk_level: 'high', user_authorization: 'low', outcome: 'deny', rationale: 'Overwrites an unrelated file.' };
    const denied = await h.escalatedWrite();
    assert.equal(denied.isError, true);
    assert.equal(readFileSync(h.target, 'utf8'), 'before');
    assert.match(text(denied), /This action was rejected due to unacceptable risk\./);
    assert.match(text(denied), /Reason: Overwrites an unrelated file\./);
    assert.match(text(denied), /must not attempt to achieve the same outcome via workaround/);
    assert.deepEqual(h.decided(), ['allowed-once', 'rejected']);
    assert.deepEqual(h.downstream, [], 'no downstream answerer participates');
  });

test('review failure (model service removed) is rejected as a review failure, not a denial', { skip }, async t => {
  const h = await harness(t);
  await h.modelFiber.dispose();
  const failed = await h.escalatedWrite();
  assert.equal(failed.isError, true);
  assert.match(text(failed), /review failure, not a determination that the action is unsafe/);
  assert.match(text(failed), /no reviewer model service/);
  assert.equal(readFileSync(h.target, 'utf8'), 'before');
  assert.deepEqual(h.decided(), ['rejected']);
  assert.deepEqual(h.downstream, []);
});

test('native never policy still wins before Safe Auto answers', { skip }, async t => {
  const h = await harness(t);
  host.approval.setApprovalPolicy(h.session, 'never');
  const result = await h.escalatedWrite();
  assert.equal(result.isError, true);
  assert.equal(h.seen.length, 0, 'the reviewer is never consulted');
  assert.deepEqual(h.decided(), ['rejected']);
  assert.equal(readFileSync(h.target, 'utf8'), 'before');
});

test('ordinary non-escalated calls pass with zero model calls, including the reported false positives', { skip }, async t => {
  const h = await harness(t);
  const calls = [
    ['read', { file_path: 'AGENTS.md' }],
    ['read', { file_path: '.dsh/config.toml' }],
    ['grep', { pattern: 'api_key:' }],
    ['pwsh', { command: 'Get-Content AGENTS.md', description: 'read' }],
    ['pwsh', { command: 'git log --oneline -5 -- .github/workflows', description: 'log' }],
    ['pwsh', { command: '$token = 1; echo $token', description: 'echo' }],
    ['pwsh', { command: 'Get-ChildItem $env:USERPROFILE\\.dsh\\sessions', description: 'list' }],
    ['bash', { command: 'grep -rn "api_key:" src', description: 'search' }],
    ['bash', { command: 'curl --version', description: 'version' }],
    ['bash', { command: 'env | sort', description: 'env' }],
    ['bash', { command: 'find . -name "*.js" | xargs wc -l', description: 'count' }],
    ['pwsh', { command: 'Remove-Item .scratch\\tmp.txt', description: 'remove' }],
    ['write', { file_path: h.target, content: 'sandboxed' }],
  ];
  for (const [name, args] of calls) {
    const result = await h.execute(name, args);
    assert.equal(result.isError, false, `${name} ${JSON.stringify(args)}: ${JSON.stringify(result)}`);
  }
  assert.equal(h.seen.length, 0);
  assert.equal(h.events.filter(e => e.type === 'approval/asked').length, 0);
  assert.equal(h.bodies.length, calls.length);
});

test('a dangerous command without escalation goes through ask to the reviewer', { skip }, async t => {
  const h = await harness(t);
  const allowed = await h.execute('bash', { command: 'rm -rf node_modules', description: 'clean' });
  assert.equal(allowed.isError, false, JSON.stringify(allowed));
  assert.equal(h.seen.length, 1);
  assert.match(h.seen[0].messages[0].content[0].text, /"command": "rm -rf node_modules"/);
  assert.match(h.seen[0].messages[0].content[0].text, /dangerous command \(forced-rm\)/);
  assert.deepEqual(h.decided(), ['allowed-once']);
  assert.deepEqual(h.bodies, ['bash:rm -rf node_modules']);

  h.state.verdict = { risk_level: 'high', user_authorization: 'unknown', outcome: 'deny', rationale: 'Unrequested recursive deletion.' };
  const denied = await h.execute('pwsh', { command: 'Remove-Item -Recurse -Force dist', description: 'clean' });
  assert.equal(denied.isError, true);
  assert.match(text(denied), /rejected due to unacceptable risk/);
  assert.match(text(denied), /Unrequested recursive deletion/);
  assert.deepEqual(h.bodies, ['bash:rm -rf node_modules'], 'a denied command never runs');
  assert.deepEqual(h.downstream, []);
});

test('same-mode dangerous bash and pwsh calls reach review before the native helper can return without approval', { skip }, async t => {
  const h = await harness(t);
  await enableControl(h, t);
  h.state.verdict = { risk_level: 'high', user_authorization: 'unknown', outcome: 'deny', rationale: 'Unrequested deletion.' };
  for (const [name, command] of [['bash', 'rm -rf dist'], ['pwsh', 'Remove-Item -Recurse -Force dist']]) {
    const result = await h.execute(name, { command, sandbox_permissions: 'workspace-write', justification: 'Same mode.' });
    assert.equal(result.isError, true);
  }
  assert.equal(h.seen.length, 2);
  assert.deepEqual(h.decided(), ['rejected', 'rejected']);
  assert.deepEqual(h.bodies, []);
  assert.deepEqual(h.downstream, []);
});

test('a valid wider native escalation is reviewed once and runs once', { skip }, async t => {
  const h = await harness(t);
  await enableControl(h, t);
  const result = await h.execute('bash', { command: 'rm -rf dist', sandbox_permissions: 'danger-full-access', justification: 'Authorized fixture.' });
  assert.equal(result.isError, false);
  assert.equal(h.seen.length, 1);
  assert.deepEqual(h.decided(), ['allowed-once']);
  assert.deepEqual(h.bodies, ['bash:rm -rf dist']);
  assert.equal(h.state.mode, 'workspace-write');
});

test('disabling Safe Auto while native escalation awaits its verdict prevents full-access execution', { skip }, async t => {
  const h = await harness(t);
  const { owner, select } = await enableControl(h, t);
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  h.state.wait = release.promise;
  h.state.enter = entered.resolve;
  const pending = h.execute('bash', { command: 'rm -rf dist', sandbox_permissions: 'danger-full-access', justification: 'Fixture.' });
  await entered.promise;
  await select('workspace-write');
  assert.equal(owner.config(h.session).enabled, false);
  release.resolve();
  const result = await pending;
  assert.equal(result.isError, true);
  assert.deepEqual(h.decided(), ['cancelled']);
  assert.deepEqual(h.bodies, []);
  assert.deepEqual(h.downstream, []);
});

test('headless native never policy revokes an already-pending escalation review', { skip }, async t => {
  const h = await harness(t);
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  h.state.wait = release.promise;
  h.state.enter = entered.resolve;
  const pending = h.escalatedWrite();
  await entered.promise;
  host.approval.setApprovalPolicy(h.session, 'never');
  release.resolve();
  const result = await pending;
  assert.equal(result.isError, true);
  assert.deepEqual(h.decided(), ['cancelled']);
  assert.equal(readFileSync(h.target, 'utf8'), 'before');
  assert.deepEqual(h.downstream, []);
});

test('the native approval path sees a long command suffix and rejects oversized actions without execution', { skip }, async t => {
  const h = await harness(t);
  const command = `echo ${'x'.repeat(6100)}; rm -rf /important-data`;
  const allowed = await h.execute('bash', { command, sandbox_permissions: 'danger-full-access', justification: 'Fixture.' });
  assert.equal(allowed.isError, false);
  assert.ok(h.seen[0].messages[0].content[0].text.includes(command));
  assert.deepEqual(h.bodies, [`bash:${command}`]);
  const oversized = await h.execute('bash', { command: `echo ${'x'.repeat(safeAuto.MAX_ACTION_BYTES)}`,
    sandbox_permissions: 'danger-full-access', justification: 'Fixture.' });
  assert.equal(oversized.isError, true);
  assert.equal(h.seen.length, 1);
  assert.equal(h.bodies.length, 1);
  assert.deepEqual(h.decided(), ['allowed-once', 'rejected']);
});
