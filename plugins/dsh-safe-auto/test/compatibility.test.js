import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { apply } from '../src/index.js';

function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'safe-auto-compatibility-')));
  const root = join(base, 'workspace'), runtime = join(base, '.dsh', 'runtime space');
  mkdirSync(join(root, 'subdir'), { recursive: true }); mkdirSync(runtime, { recursive: true });
  const node = join(runtime, 'node.exe'), pnpm = join(runtime, 'pnpm.mjs');
  writeFileSync(node, 'fixture node'); writeFileSync(pnpm, 'fixture pnpm');
  const events = [{ type: 'user/message', seq: 1, data: { source: { kind: 'user' },
    content: [{ type: 'text', text: 'Install dependencies and run check and test locally. Do not publish.' }] } }];
  const session = { id: 'compatibility', header: { id: 'compatibility', cwd: root, createdAt: 1, isSeeded: false }, seq: 1, snapshotEvents: () => events };
  const agent = { session }, owner = {}, handlers = {}, disposers = [], inputs = [], resolves = [];
  const files = new Map([root, join(root, 'subdir')].map(dir => [join(dir, 'package.json'), JSON.stringify({ scripts: { check: 'node check.js', test: 'node test.js' } })]));
  const fs = { processPathFromHostPath: path => path, async resolve(path) { resolves.push(path); return { path }; }, processPath: target => target.path,
    contains(parent, child) { const r = relative(parent.path, child.path); return !isAbsolute(r) && r !== '..' && !r.startsWith(`..${sep}`); },
    async stat(target) { const text = files.get(target.path); return text === undefined ? undefined : { type: 'file', version: text, size: Buffer.byteLength(text) }; },
    async readBytes(target, _signal, limit) { const bytes = Buffer.from(files.get(target.path)); assert.ok(bytes.length <= limit); return bytes; } };
  const f = { base, root, node, pnpm, agent, inputs, resolves, files, onReview: undefined, global: owner, scoped: owner };
  let guard;
  const shell = { sandboxMode: 'workspace-write', processPathFromHostPath: path => path };
  const ctx = { tools: { guard(fn) { guard = fn; }, get(name, scope) { return name === 'load_workspace_dependencies' ? (scope ? f.scoped : f.global) : undefined; } },
    get(key) { return ({ fs, shell, pwsh: shell, jobs: {} })[key]; },
    sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: root }) }, logger: { info() {} },
    on(event, fn) { handlers[event] = fn; }, effect(fn) { disposers.push(fn()); },
    inject(_deps, fn) { fn({ effect: ctx.effect, llm: { async *stream(options) {
      const input = JSON.parse(options.messages[0].content[0].text); inputs.push(input); await f.onReview?.(input);
      yield { type: 'block-end', index: 0, block: { type: 'text', text: JSON.stringify({ decision: 'allow', risk: 'low', authorization: 'high', bounded: true, reason: 'Authorized local verification.' }) } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    } } }); } };
  apply(ctx, { provider: 'p', model: 'm', humanApprovalTimeoutMs: 0 });
  t.after(() => {
    disposers.reverse().forEach(dispose => dispose());
    assert.equal(resolve(base), base); assert.match(base, /safe-auto-compatibility-[^\\/]+$/);
    rmSync(base, { recursive: true, force: true });
  });
  const makeExec = (name, args, caller = agent) => ({ name, arguments: args, agent: caller, token: Symbol(), callId: String(Math.random()), signal: new AbortController().signal });
  f.command = (script = 'test') => `& '${node}' '${pnpm}' ${script}`;
  f.exec = (extra = {}, caller) => makeExec('pwsh', { command: f.command(), description: 'Verify local project', workdir: '.', timeoutMs: 240000,
    sandbox_permissions: 'danger-full-access', justification: 'Retry requested verification after sandbox denial', ...extra }, caller);
  f.guard = exec => guard(exec);
  f.value = { node, pnpm, python: join(runtime, 'python.exe'), pythonPackages: join(runtime, 'site-packages'), pythonDistributions: {} };
  f.observe = async (result = { isError: false, value: f.value, content: [] }, caller = agent) => {
    const exec = makeExec('load_workspace_dependencies', {}, caller);
    await handlers['tools/pre-execute'](exec, async () => undefined);
    assert.equal(guard(exec), undefined);
    const actual = await handlers['tools/execute'](exec, async () => result);
    handlers['tools/result'](exec, actual);
  };
  f.run = async exec => {
    const pre = await handlers['tools/pre-execute'](exec, async () => undefined);
    if (pre?.kind === 'deny') return pre.reason;
    const denied = guard(exec); if (denied) return denied;
    let outcome;
    const result = await handlers['tools/execute'](exec, async () => {
      const reason = `escalate sandbox to ${exec.arguments.sandbox_permissions}: ${exec.arguments.justification}`;
      outcome = await handlers['approval/request']({ agent: exec.agent, toolName: exec.name, callId: exec.callId, signal: exec.signal, reason }, async () => assert.fail('unbound approval fallback'));
      return { isError: outcome !== 'allowed-once', content: [] };
    });
    handlers['tools/result'](exec, result); return outcome;
  };
  return f;
}

test('only observed native runtime results enable review of the exact original command', async t => {
  const f = fixture(t), exec = f.exec(), ordinary = f.exec();
  delete ordinary.arguments.sandbox_permissions; delete ordinary.arguments.justification;
  assert.match(f.guard(exec), /SENSITIVE_COMMAND/); assert.match(f.guard(ordinary), /SENSITIVE_COMMAND/);
  await f.observe({ isError: false, content: [{ type: 'text', text: JSON.stringify(f.value) }] });
  assert.match(f.guard(exec), /SENSITIVE_COMMAND/);
  await f.observe(); assert.equal(f.guard(exec), undefined); assert.equal(f.guard(ordinary), undefined);
  assert.equal(f.inputs.length, 0, 'runtime attestation alone never calls or bypasses the reviewer');
  assert.match(f.guard(f.exec({}, { session: { ...f.agent.session } })), /SENSITIVE_COMMAND/);
  f.scoped = {}; assert.match(f.guard(exec), /SENSITIVE_COMMAND/);
});

test('install/check/test with long native timeouts and relative workdirs preserve exact arguments and evidence cwd', async t => {
  const f = fixture(t); await f.observe();
  for (const script of ['install', 'check', 'test']) for (const timeoutMs of [240000, 300000, 600000]) for (const workdir of ['.', 'subdir']) {
    const exec = f.exec({ command: f.command(script), timeoutMs, workdir });
    const original = structuredClone(exec.arguments); Object.freeze(exec.arguments);
    assert.equal(await f.run(exec), 'allowed-once', `${script}/${timeoutMs}/${workdir}`);
    const sent = f.inputs.at(-1), effective = resolve(f.root, workdir);
    assert.deepEqual(exec.arguments, original); assert.deepEqual(sent.action.arguments, original);
    assert.equal(sent.action.reviewPaths.workdir, effective);
    assert.ok(f.resolves.includes(effective));
    assert.ok(sent.executionEvidence.files.some(file => file.content === f.files.get(join(effective, 'package.json'))));
  }
  assert.equal(f.inputs.length, 18);
});

test('protected data, child flags and redirects remain denied after runtime attestation', async t => {
  const f = fixture(t); await f.observe();
  for (const suffix of [
    `test --userconfig '${join(f.root, '.npmrc')}'`, `exec cat '${join(f.root, '.env')}'`,
    `exec cat '${join(f.root, 'credentials')}'`, `test '${join(f.root, '.ssh', 'id_rsa')}'`,
    `test '${f.node}'`, `test > '${join(f.root, 'out.txt')}'`, `test; Get-Content '${join(f.root, '.env')}'`,
  ]) assert.match(f.guard(f.exec({ command: f.command(suffix) })), /SENSITIVE_COMMAND/, suffix);
  assert.match(f.guard(f.exec({ command: `& '${f.node}' --require preload '${f.pnpm}' test` })), /SENSITIVE_COMMAND/);
  assert.equal(f.inputs.length, 0);
});

test('definition or file replacement invalidates runtime trust before approval', async t => {
  const f = fixture(t); await f.observe(); f.global = {};
  assert.match(f.guard(f.exec()), /SENSITIVE_COMMAND/);
  const changed = fixture(t); await changed.observe(); writeFileSync(changed.pnpm, 'replaced runtime script');
  assert.match(changed.guard(changed.exec()), /SENSITIVE_COMMAND/);
});

test('runtime changes while the reviewer answers invalidate the grant', async t => {
  const f = fixture(t); await f.observe();
  f.onReview = () => writeFileSync(f.pnpm, 'runtime changed during review');
  assert.equal(await f.run(f.exec()), 'rejected');
  assert.equal(f.inputs.length, 1);
});
