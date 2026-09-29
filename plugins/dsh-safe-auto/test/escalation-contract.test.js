import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
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
    approval: await load(requireTools, '@deepseek-ai/dsh-user-approval'),
    sandbox: await load(requireTools, '@deepseek-ai/dsh-sandbox'),
  };
} catch (error) {
  if (process.env.CI || error.code !== 'MODULE_NOT_FOUND') throw error;
}

test('real Cordis, ToolRuntime, ApprovalService and approveEscalation with loopback HTTP reviewer',
  { skip: sep !== '/' ? 'Native escalation requires POSIX' : !host && 'DSH dependencies unavailable locally; mandatory in CI' }, async t => {
    const { Context, Service } = host.cordis;
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'safe-auto-native-')));
    const root = join(base, 'workspace'); const outside = join(base, 'external');
    mkdirSync(root); mkdirSync(outside);
    const target = join(outside, 'target.txt'); writeFileSync(target, 'before');
    let modelCalls = 0; let humanCalls = 0; let verdict = 'allow';
    const server = createServer(async (req, res) => {
      try {
        let body = ''; for await (const chunk of req) body += chunk;
        const parsed = JSON.parse(body);
        assert.equal(parsed.max_tokens, 64); assert.equal(parsed.tools, undefined);
        const input = JSON.parse(parsed.messages[1].content);
        assert.equal(input.action.permission.scope, 'this-call-only');
        assert.equal(input.action.arguments.file_path, target);
        modelCalls++;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ decision: verdict }) } }] }));
      } catch { res.writeHead(500); res.end('{}'); }
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const endpoint = `http://127.0.0.1:${server.address().port}/v1/chat/completions`;
    const ctx = new Context(); const mounted = [];
    t.after(async () => {
      try { for (const fiber of mounted.reverse()) await fiber.dispose(); }
      finally { server.closeAllConnections(); await new Promise(r => server.close(r)); rmSync(base, { recursive: true, force: true }); }
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
    // This is an event-log fixture, not a durable Session/OS sandbox implementation.
    const events = [];
    const session = { id: 'native-contract', header: { cwd: root },
      get seq() { return events.length; }, eventAt(seq) { return events[seq]; },
      snapshotEvents() { return [...events]; }, append(type, data) { events.push({ seq: events.length, type, data }); } };
    session.append('turn/start', {});
    session.append('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: `Write after to ${target}.` }] });
    const agent = { id: 'native-agent', session };
    let writes = 0;
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
        if (mode !== 'danger-full-access') throw new Error('fixture sandbox denied outside workspace');
        writeFileSync(target, args.content); writes++; return mode;
      },
    });
    ctx.on('approval/request', async () => { humanCalls++; return 'rejected'; });
    mounted.push(await ctx.plugin(safeAuto, { mode: 'unattended', workspaceRoots: [root], endpoint, fastModel: 'mock',
      escalationCandidates: [{ tool: 'write', cwd: root, mode: 'danger-full-access', filePath: target }] }));
    const run = (escalate = true) => ctx.tools.execute({ token: Symbol(), callId: 'same-visible-id', name: 'write', agent,
      signal: new AbortController().signal, arguments: { file_path: target, content: 'after',
        ...(escalate ? { sandbox_permissions: 'danger-full-access', justification: 'Write the note the user specified.' } : {}) } });

    const allowed = await run();
    assert.equal(allowed.isError, false, JSON.stringify(allowed));
    assert.equal(readFileSync(target, 'utf8'), 'after'); assert.equal(writes, 1);
    assert.equal(modelCalls, 1); assert.equal(humanCalls, 0);
    const asked = events.find(e => e.type === 'approval/asked');
    const decided = events.find(e => e.type === 'approval/decided');
    assert.equal(asked.data.id, decided.data.id); assert.equal(decided.data.outcome, 'allowed-once');
    assert.equal(events.some(e => e.type === 'sandbox/mode'), false);
    assert.equal(ctx.sandboxPolicy.resolve().mode, 'workspace-write');

    assert.equal((await run(false)).isError, true, 'the next ordinary call has no inherited escalation');
    assert.equal(writes, 1); assert.equal(modelCalls, 1);
    host.approval.setApprovalPolicy(session, 'never');
    assert.equal((await run()).isError, true, 'native never policy wins before the automatic answerer');
    assert.equal(modelCalls, 1); assert.equal(writes, 1);
    host.approval.setApprovalPolicy(session, 'ask');
    verdict = 'deny'; assert.equal((await run()).isError, true); assert.equal(writes, 1); assert.equal(humanCalls, 0);
    verdict = 'allow';
    const stop = ctx.on('tools/pre-execute', async () => ({ kind: 'deny', reason: 'another policy' }));
    assert.equal((await run()).isError, true); stop(); assert.equal(modelCalls, 2);
    assert.equal((await run()).isError, false); assert.equal(writes, 2); assert.equal(modelCalls, 3);
    const outcomes = events.filter(e => e.type === 'approval/decided').map(e => e.data.outcome);
    assert.deepEqual(outcomes, ['allowed-once', 'rejected', 'rejected', 'allowed-once']);
  });
