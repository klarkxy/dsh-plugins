import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('real Cordis + DSH ToolRuntime: schema, preflight, final guard, policy composition and disposal',
  { skip: !host && 'DSH workspace dependencies are not installed (mandatory in CI)' }, async t => {
    const { Context, Service } = host.cordis;
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'safe-auto-contract-')));
    writeFileSync(join(root, 'hello.txt'), 'hello');
    class TestSandboxPolicy extends Service {
      constructor(ctx) { super(ctx, 'sandboxPolicy'); }
      resolve() { return { mode: 'workspace-write', workspaceRoot: root }; }
    }
    const ctx = new Context();
    t.after(async () => { await ctx.dispose(); rmSync(root, { recursive: true, force: true }); });
    await ctx.plugin(host.prompt.default, {});
    await ctx.plugin(host.tools.default);
    await ctx.plugin(TestSandboxPolicy);
    let executions = 0;
    ctx.tools.register({
      name: 'read', description: 'test read body (no actual filesystem side effects)',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async () => { executions++; return 'executed'; },
    });
    const agent = { id: 'contract-agent', session: { id: 'contract-session', header: { cwd: root }, snapshotEvents: () => [] } };
    const run = path => ctx.tools.execute({ callId: 'same-call-id', name: 'read', arguments: { file_path: path }, agent, signal: new AbortController().signal });
    const fiber = await ctx.plugin(safeAuto, { mode: 'smart', workspaceRoots: [root] });
    assert.equal((await run('hello.txt')).isError, false, 'real pre-execute runs before monotonic guards');
    assert.equal((await run('hello.txt')).isError, false, 'final-result cleanup permits another call with the same visible ID');
    assert.equal((await run('.env')).isError, true);
    assert.equal(executions, 2);

    const stopDeny = ctx.on('tools/pre-execute', async () => ({ kind: 'deny', reason: 'downstream-policy' }));
    assert.equal((await run('hello.txt')).isError, true, 'Safe Auto must retain downstream denial');
    stopDeny();
    const stopBypass = ctx.on('tools/pre-execute', async () => ({ kind: 'allow' }), { prepend: true });
    const bypassed = await run('hello.txt');
    assert.equal(bypassed.isError, true);
    assert.match(JSON.stringify(bypassed.content), /PREFLIGHT_NOT_RUN/);
    stopBypass();
    await fiber.dispose();
    assert.equal((await run('.env')).isError, false, 'plugin unload removes its listeners and guard');
  });
