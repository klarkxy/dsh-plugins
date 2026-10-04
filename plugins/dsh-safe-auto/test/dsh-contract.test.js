import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as safeAuto from '../src/index.js';

// Reuse the workspace's pinned real DSH packages, not a second drifting set of versions.
// Offline source-only testing can skip this test; CI must install the workspace and run it.
const requireHost = createRequire(new URL('../../dsh-dev-index/package.json', import.meta.url));
let host;
try {
  const load = name => import(pathToFileURL(requireHost.resolve(name)).href);
  host = {
    cordis: await load('@deepseek-ai/cordis'),
    prompt: await load('@deepseek-ai/dsh-system-prompt'),
    tools: await load('@deepseek-ai/dsh-tools'),
  };
} catch (error) {
  if (process.env.CI || error.code !== 'MODULE_NOT_FOUND') throw error;
}

test('real Cordis + DSH ToolRuntime: schema, hard-risk guard, policy composition and disposal',
  { skip: !host && 'DSH workspace dependencies are not installed (mandatory in CI)' }, async t => {
    const { Context, Service } = host.cordis;
    class TestSandboxPolicy extends Service {
      constructor(ctx) { super(ctx, 'sandboxPolicy'); }
      resolve() { return { mode: 'workspace-write', workspaceRoot: 'D:\\contract' }; }
    }
    const ctx = new Context();
    const fixtures = [];
    t.after(async () => { for (const fiber of fixtures.reverse()) await fiber.dispose(); });
    fixtures.push(await ctx.plugin(host.prompt.default, {}));
    fixtures.push(await ctx.plugin(host.tools.default));
    fixtures.push(await ctx.plugin(TestSandboxPolicy));
    let executions = 0;
    for (const name of ['read', 'write']) ctx.tools.register({
      name, description: 'test fixture (no actual filesystem side effects)',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async () => { executions++; return 'executed'; },
    });
    const agent = { id: 'contract-agent', session: { id: 'contract-session', header: { cwd: 'D:\\contract' }, snapshotEvents: () => [] } };
    const run = (name, args) => ctx.tools.execute({ callId: 'same-call-id', name, arguments: args, agent, signal: new AbortController().signal });
    const fiber = await ctx.plugin(safeAuto, {});
    fixtures.push(fiber);
    assert.equal((await run('read', { file_path: 'a.txt' })).isError, false, 'ordinary calls pass through untouched');
    assert.equal((await run('read', { file_path: 'a.txt' })).isError, false, 'result cleanup permits another call with the same visible ID');
    assert.equal((await run('write', { file_path: '.env', content: 'x' })).isError, true, 'hard risk denies before review');
    assert.equal(executions, 2);

    const stopDeny = ctx.on('tools/pre-execute', async () => ({ kind: 'deny', reason: 'downstream-policy' }));
    assert.equal((await run('read', { file_path: 'a.txt' })).isError, true, 'Safe Auto must retain downstream denial');
    stopDeny();
    const stopBypass = ctx.on('tools/pre-execute', async () => ({ kind: 'allow' }), { prepend: true });
    const bypassed = await run('write', { file_path: '.env', content: 'x' });
    assert.equal(bypassed.isError, true, 'a pre-execute bypass cannot skip the hard-risk guard');
    assert.match(JSON.stringify(bypassed.content), /PROTECTED_PATH/);
    stopBypass();
    await fiber.dispose();
    fixtures.pop();
    assert.equal((await run('write', { file_path: '.env', content: 'x' })).isError, false, 'plugin unload removes its listeners and guard');
  });
