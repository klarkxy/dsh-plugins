import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as safeAuto from '../src/index.js';

// Reuse the exact DSH packages already pinned by the workspace; CI cannot skip this contract.
const requireHost = createRequire(new URL('../../dsh-dev-index/package.json', import.meta.url));
let host;
try {
  const requireTools = createRequire(requireHost.resolve('@deepseek-ai/dsh-tools'));
  const load = name => import(pathToFileURL(requireTools.resolve(name)).href);
  host = { cordis: await load('@deepseek-ai/cordis'), llm: await load('@deepseek-ai/dsh-llm'),
    prompt: await load('@deepseek-ai/dsh-system-prompt'), tools: await load('@deepseek-ai/dsh-tools') };
} catch (error) {
  if (process.env.CI || error.code !== 'MODULE_NOT_FOUND') throw error;
}

test('real DSH native reviewer: conversation switch, independent route and service loss',
  { skip: !host && 'Workspace DSH dependencies missing; required in CI' }, async t => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'safe-auto-native-contract-')));
    writeFileSync(join(root, 'read.txt'), 'ordinary');
    const ctx = new host.cordis.Context();
    const fibers = [];
    const mount = async (plugin, ...config) => { const fiber = await ctx.plugin(plugin, ...config); fibers.push(fiber); return fiber; };
    t.after(async () => { for (const fiber of fibers.reverse()) await fiber.dispose(); rmSync(root, { recursive: true, force: true }); });
    class Policy extends host.cordis.Service {
      constructor(inner) { super(inner, 'sandboxPolicy'); }
      resolve() { return { mode: 'workspace-write', workspaceRoot: root }; }
    }
    await mount(host.prompt.default, {});
    await mount(host.tools.default);
    await mount(Policy);
    const modelFiber = await mount(host.llm.default);
    const seen = [];
    class Reviewer extends host.llm.LlmAdapter {
      async *stream(options) {
        seen.push(options);
        assert.deepEqual(options.tools, []);
        assert.equal(options.messages.length, 1);
        assert.equal(options.maxTokens, 64);
        assert.equal(options.sessionId, undefined);
        const text = '{"decision":"allow"}';
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'text-delta', index: 0, text };
        yield { type: 'block-end', index: 0, block: { type: 'text', text } };
        yield { type: 'finish', reason: { kind: 'stop' } };
      }
    }
    ctx.llm.registerAdapter(['conversation', 'reviewer'], new Reviewer());
    for (const name of ['bash', 'read']) ctx.tools.register({ name, description: 'No-effect test tool',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async () => 'ran',
    });
    let selected = { provider: 'conversation', model: 'one' };
    const session = { id: 'model-contract-session', header: { cwd: root }, requestHeader: () => ({ config: selected }),
      snapshotEvents: () => [{ type: 'user/message', seq: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Inspect git status' }] } }],
    };
    const agent = { id: 'model-contract-agent', session, options: { provider: 'invalid', model: 'must-not-be-used' } };
    const run = (name = 'bash', args = { command: 'git status --short' }) => ctx.tools.execute({
      name, arguments: args, agent, callId: 'one', signal: new AbortController().signal,
    });
    const base = { mode: 'smart', workspaceRoots: [root], shellCandidates: ['git status --short'] };
    const following = await mount(safeAuto, base);
    assert.equal((await run()).isError, false);
    selected = { provider: 'conversation', model: 'two' };
    assert.equal((await run()).isError, false);
    assert.deepEqual(seen.map(x => x.model), ['one', 'two']);
    await following.dispose();
    await mount(safeAuto, { ...base, fastProvider: 'reviewer', fastModel: 'small' });
    assert.equal((await run()).isError, false);
    assert.equal(seen.at(-1).provider, 'reviewer');
    assert.equal(seen.at(-1).model, 'small');
    assert.deepEqual(selected, { provider: 'conversation', model: 'two' });
    await modelFiber.dispose();
    assert.equal((await run()).isError, true, 'model service loss cannot make the policy disappear');
    assert.equal((await run('read', { file_path: 'read.txt' })).isError, false, 'deterministic path remains usable');
  });
