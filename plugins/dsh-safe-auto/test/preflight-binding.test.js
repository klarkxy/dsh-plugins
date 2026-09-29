import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { apply } from '../src/index.js';
import * as safeAuto from '../src/index.js';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

function harness(verdict = 'allow', duringReview = () => {}) {
  const root = resolve('review-workspace');
  const events = [{ type: 'user/message', seq: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Inspect status' }] } }];
  const session = { header: { cwd: root }, snapshotEvents: () => events };
  const agent = { session };
  const listeners = {}, disposers = [];
  let guard;
  let sandbox = { mode: 'workspace-write', workspaceRoot: root };
  const llm = { async *stream() {
    duringReview(events);
    yield { type: 'block-end', index: 0, block: { type: 'text', text: JSON.stringify({ decision: verdict }) } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } };
  const ctx = {
    tools: { guard(fn) { guard = fn; } }, sandboxPolicy: { resolve: () => sandbox },
    logger: { info() {} }, on(name, fn) { listeners[name] = fn; },
    effect(fn) { disposers.push(fn()); },
    inject(_deps, fn) { fn({ llm, effect: ctx.effect }); },
  };
  apply(ctx, { mode: 'smart', workspaceRoots: [root], shellCandidates: ['git status', 'git diff'], fastProvider: 'reviewer', fastModel: 'small' });
  const exec = { token: Symbol(), callId: 'call', name: 'bash', arguments: { command: 'git status' }, agent, signal: new AbortController().signal };
  return { exec, events, session, listeners, guard: () => guard(exec), setSandbox(value) { sandbox = value; },
    dispose() { disposers.reverse().forEach(fn => fn()); } };
}

for (const [label, mutate] of [
  ['authority', h => { h.events[0].data.content[0].text = 'Stop this operation'; }],
  // Defensive mock mutation only: real ToolRuntime already freezes arguments.
  ['another enrolled command (defensive mock)', h => { h.exec.arguments.command = 'git diff'; }],
  ['sandbox policy', h => { h.setSandbox({ mode: 'workspace-write', workspaceRoot: h.session.header.cwd, approval: 'never' }); }],
  ['subagent origin', h => { h.session.header.origin = 'subagent'; }],
]) test(`reviewed preflight is invalidated by changed ${label} downstream`, async t => {
  const h = harness(); t.after(() => h.dispose());
  const decision = await h.listeners['tools/pre-execute'](h.exec, async () => {
    mutate(h);
    return { kind: 'allow' };
  });
  assert.equal(decision.kind, 'allow');
  assert.match(h.guard(), /PREFLIGHT_CHANGED/);
});

test('unchanged reviewed preflight still passes final guard', async t => {
  const h = harness(); t.after(() => h.dispose());
  assert.equal((await h.listeners['tools/pre-execute'](h.exec, async () => ({ kind: 'allow' }))).kind, 'allow');
  assert.equal(h.guard(), undefined);
});

test('authority change cannot downgrade explicit model denial to human fallback', async t => {
  const h = harness('deny', events => { events[0].data.content[0].text = 'New request'; });
  t.after(() => h.dispose());
  let downstream = false;
  const decision = await h.listeners['tools/pre-execute'](h.exec, async () => { downstream = true; return { kind: 'allow' }; });
  assert.equal(decision.kind, 'deny');
  assert.match(decision.reason, /MODEL_NOT_ALLOWED/);
  assert.equal(downstream, false);
});

const requireHost = createRequire(new URL('../../dsh-dev-index/package.json', import.meta.url));
let host;
try {
  const requireTools = createRequire(requireHost.resolve('@deepseek-ai/dsh-tools'));
  const load = name => import(pathToFileURL(requireTools.resolve(name)).href);
  host = { cordis: await load('@deepseek-ai/cordis'), tools: await load('@deepseek-ai/dsh-tools'),
    prompt: await load('@deepseek-ai/dsh-system-prompt'), llm: await load('@deepseek-ai/dsh-llm') };
} catch (error) {
  if (process.env.CI || error.code !== 'MODULE_NOT_FOUND') throw error;
}

for (const change of ['authority downstream', 'workspace during review']) {
  test(`real ToolRuntime rejects stale preflight: ${change}`, { skip: !host && 'Workspace DSH dependencies missing; required in CI' }, async t => {
    const ctx = new host.cordis.Context();
    const fibers = [];
    t.after(async () => { for (const fiber of fibers.reverse()) await fiber.dispose(); });
    const mount = async (plugin, config) => { fibers.push(await ctx.plugin(plugin, config)); };
    const roots = [resolve('workspace-a'), resolve('workspace-b')];
    let cwd = roots[0];
    const events = [{ type: 'user/message', seq: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Inspect status' }] } }];
    const session = { header: { cwd }, snapshotEvents: () => events };
    class Policy extends host.cordis.Service {
      constructor(inner) { super(inner, 'sandboxPolicy'); }
      resolve() { return { mode: 'workspace-write', workspaceRoot: cwd }; }
    }
    class Reviewer extends host.llm.LlmAdapter {
      async *stream() {
        if (change === 'workspace during review') { cwd = roots[1]; session.header.cwd = cwd; }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: '{"decision":"allow"}' } };
        yield { type: 'finish', reason: { kind: 'stop' } };
      }
    }
    await mount(host.prompt.default, {}); await mount(host.tools.default);
    await mount(Policy); await mount(host.llm.default);
    ctx.llm.registerAdapter(['reviewer'], new Reviewer());
    let executions = 0;
    ctx.tools.register({ name: 'bash', description: 'No effect fixture', parameters: { type: 'object' },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async () => { executions++; return 'ran'; } });
    ctx.on('tools/pre-execute', async (exec, next) => {
      assert.ok(Object.isFrozen(exec.arguments));
      if (change === 'authority downstream') events.push({ type: 'user/message', seq: 2,
        data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Stop; do not run commands' }] } });
      return next();
    });
    await mount(safeAuto, { mode: 'unattended', workspaceRoots: roots, shellCandidates: ['git status'], fastProvider: 'reviewer', fastModel: 'small' });
    const result = await ctx.tools.execute({ name: 'bash', callId: 'one', arguments: { command: 'git status' },
      agent: { id: 'binding-agent', session }, signal: new AbortController().signal });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result), /PREFLIGHT_CHANGED/);
    assert.equal(executions, 0);
  });
}
