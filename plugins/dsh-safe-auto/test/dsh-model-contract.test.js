import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as safeAuto from '../src/index.js';

// Use the SAME pinned packages as the workspace's original DSH contract test.
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

test('real Cordis, ToolRuntime, ApprovalService and LlmRuntime: conversation-following and fixed native reviewers',
  { skip: !host && 'DSH dependencies unavailable locally; mandatory in CI' }, async t => {
    const { Context, Service } = host.cordis;
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'safe-auto-native-')));
    const target = join(root, 'target.txt'); writeFileSync(target, 'before');
    let modelCalls = 0; let humanCalls = 0; let verdict = 'allow';
    const ctx = new Context(); const mounted = [];
    t.after(async () => {
      try { for (const fiber of mounted.reverse()) await fiber.dispose(); }
      finally { rmSync(root, { recursive: true, force: true }); }
    });
    class SandboxFixture extends Service {
      constructor(ctx) { super(ctx, 'sandboxPolicy'); }
      resolve() { return { mode: 'workspace-write', workspaceRoot: root }; }
    }
    class FilesystemFixture extends Service {
      constructor(ctx) { super(ctx, 'fs'); }
      processPathFromHostPath(path) { return path; }
    }
    mounted.push(await ctx.plugin(host.prompt.default, {}));
    mounted.push(await ctx.plugin(host.tools.default));
    mounted.push(await ctx.plugin(SandboxFixture));
    mounted.push(await ctx.plugin(FilesystemFixture));
    mounted.push(await ctx.plugin(host.approval.default, { policy: 'ask' }));
    const modelFiber = await ctx.plugin(host.llm.default); mounted.push(modelFiber);
    const seen = [];
    class Reviewer extends host.llm.LlmAdapter {
      async *stream(options) {
        seen.push(options);
        assert.deepEqual(options.tools, []);
        assert.equal(options.messages.length, 1);
        assert.equal(options.maxTokens, 256);
        assert.equal(options.sessionId, undefined);
        modelCalls++;
        const text = JSON.stringify({ decision: verdict, risk: 'low', authorization: 'high', bounded: true, reason: 'Bounded user-requested write.' });
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'text-delta', index: 0, text };
        yield { type: 'block-end', index: 0, block: { type: 'text', text } };
        yield { type: 'finish', reason: { kind: 'stop' } };
      }
    }
    ctx.llm.registerAdapter(['conversation', 'reviewer'], new Reviewer());
    ctx.tools.register({ name: 'write', description: 'fixture consumer of the real native escalation helper',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args, exec) {
        const standing = ctx.sandboxPolicy.resolve();
        const mode = args.sandbox_permissions === undefined ? standing.mode : await host.sandbox.approveEscalation({
          requestedMode: args.sandbox_permissions, effectiveMode: standing.mode, justification: args.justification, subject: 'operation',
        }, { approver: ctx.approval, agent: exec.agent, callId: exec.callId, toolName: 'write', signal: exec.signal });
        // All effects stay in this disposable fixture directory. This is NOT an OS confinement test.
        if (args.file_path !== target) throw new Error('fixture target mismatch');
        if (mode !== 'danger-full-access') throw new Error('fixture sandbox denied the write');
        writeFileSync(target, args.content); return mode;
      },
    });
    ctx.on('approval/request', async () => { humanCalls++; return 'rejected'; });
    // This is an event-log fixture, not a durable Session/OS sandbox implementation.
    const events = [];
    const session = { id: 'native-contract', header: { cwd: root },
      get seq() { return events.length; }, eventAt(seq) { return events[seq]; },
      requestHeader: () => ({ config: selected }),
      snapshotEvents() { return [...events]; }, append(type, data) { events.push({ seq: events.length, type, data }); } };
    session.append('turn/start', {});
    session.append('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: `Write after to ${target}.` }] });
    const agent = { id: 'native-agent', session };
    let selected = { provider: 'conversation', model: 'one' };
    mounted.push(await ctx.plugin(safeAuto, {}));
    const run = () => ctx.tools.execute({ token: Symbol(), callId: 'same-visible-id', name: 'write', agent,
      signal: new AbortController().signal, arguments: { file_path: target, content: 'after',
        sandbox_permissions: 'danger-full-access', justification: 'Write the note the user specified.' } });

    const allowed = await run();
    assert.equal(allowed.isError, false, JSON.stringify(allowed));
    assert.equal(readFileSync(target, 'utf8'), 'after');
    assert.equal(modelCalls, 1); assert.equal(humanCalls, 0);
    const asked = events.find(e => e.type === 'approval/asked');
    const decided = events.find(e => e.type === 'approval/decided');
    assert.equal(asked.data.id, decided.data.id); assert.equal(decided.data.outcome, 'allowed-once');
    assert.equal(ctx.sandboxPolicy.resolve().mode, 'workspace-write');

    selected = { provider: 'conversation', model: 'two' };
    assert.equal((await run()).isError, false, 'the reviewer follows a conversation model switch');
    assert.deepEqual(seen.map(x => [x.provider, x.model]), [['conversation', 'one'], ['conversation', 'two']]);

    verdict = 'deny';
    assert.equal((await run()).isError, true, 'an explicit denial is rejected without human fallback');
    assert.equal(humanCalls, 0);
    verdict = 'allow';

    host.approval.setApprovalPolicy(session, 'never');
    assert.equal((await run()).isError, true, 'native never policy wins before the automatic answerer');
    host.approval.setApprovalPolicy(session, 'ask');

    const fixture = mounted.pop();
    await fixture.dispose();
    mounted.push(await ctx.plugin(safeAuto, { provider: 'reviewer', model: 'small' }));
    assert.equal((await run()).isError, false);
    assert.deepEqual(seen.at(-1).provider, 'reviewer');
    assert.deepEqual(seen.at(-1).model, 'small');

    await modelFiber.dispose();
    assert.equal((await run()).isError, true, 'model service loss rejects rather than delegating');
    const outcomes = events.filter(e => e.type === 'approval/decided').map(e => e.data.outcome);
    assert.ok(outcomes.includes('allowed-once'));
    assert.equal(outcomes.at(-1), 'rejected', 'the final reviewless run is rejected');
  });
