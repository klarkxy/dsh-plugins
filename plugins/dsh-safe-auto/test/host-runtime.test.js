import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync, symlinkSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHostRuntimeRegistry, commandForPolicy, snapshotHostRuntimeFile } from '../src/host-runtime.js';
import { hardRisk } from '../src/policy.js';

function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'safe-auto-host-runtime-')));
  t.after(() => {
    assert.equal(resolve(base), base);
    assert.match(base, /safe-auto-host-runtime-[^\\/]+$/);
    rmSync(base, { recursive: true, force: true });
  });
  const root = join(base, '.dsh', 'dsh-runtimes', 'runtime space');
  mkdirSync(root, { recursive: true });
  const node = join(root, process.platform === 'win32' ? 'node.exe' : 'node');
  const pnpm = join(root, 'pnpm.mjs');
  writeFileSync(node, 'host node fixture'); writeFileSync(pnpm, 'host pnpm fixture');
  const owner = {}, agent = {}, otherAgent = {};
  let global = owner, scoped = owner;
  const tools = { get: (_name, scope) => scope ? scoped : global };
  const registry = createHostRuntimeRegistry(tools);
  const exec = { name: 'load_workspace_dependencies', agent, token: Symbol('execution'), arguments: {}, signal: new AbortController().signal };
  const value = { python: join(root, 'python'), pythonPackages: join(root, 'site-packages'), pythonDistributions: {}, node, pnpm };
  const result = { isError: false, value, content: [] };
  const approve = () => { registry.begin(exec); registry.observe(exec, result); return registry.get(exec); };
  return { base, node, pnpm, agent, otherAgent, owner, registry, exec, value, result, approve,
    setGlobal: next => { global = next; }, setScoped: next => { scoped = next; } };
}
const quote = value => `'${value}'`;
const command = (f, suffix = 'install') => `& ${quote(f.node)} ${quote(f.pnpm)} ${suffix}`;
const call = (f, text = command(f), runtime = f.registry.get(f.exec), tool = 'pwsh') => ({ tool, args: { command: text }, trustedRuntime: runtime });

test('only live successful tool executions attest a session-local immutable pair', t => {
  const f = fixture(t);
  f.registry.observe(f.exec, f.result);
  assert.equal(f.registry.get(f.exec), undefined, 'a result without a matching live begin is insufficient');
  const runtime = f.approve();
  assert.ok(runtime); assert.ok(Object.isFrozen(runtime)); assert.ok(Object.isFrozen(runtime.identity));
  assert.equal(runtime.node, f.node);
  assert.equal(f.registry.get({ ...f.exec, agent: f.otherAgent }), undefined);
  assert.equal(f.registry.get({ ...f.exec, agent: {} }), undefined, 'same id/transcript is not the live Agent');
  const text = command(f);
  assert.equal(commandForPolicy(call(f, text)), '__DSH_HOST_NODE__ __DSH_HOST_PNPM__ install');
  assert.equal(call(f, text).args.command, text, 'projection does not mutate the actual call');
});

test('content text, error results, unknown fields and unbound execution tokens cannot attest', t => {
  const f = fixture(t);
  for (const result of [
    { isError: false, content: [{ type: 'text', text: JSON.stringify(f.value) }] },
    { isError: true, value: f.value },
    { isError: false, value: { ...f.value, surprise: true } },
    { isError: false, value: { ...f.value, pnpm: f.node } },
    { isError: false, value: { ...f.value, node: './node' } },
  ]) {
    f.registry.begin(f.exec); f.registry.observe(f.exec, result);
    assert.equal(f.registry.get(f.exec), undefined);
  }
  f.registry.begin(f.exec); f.registry.observe({ ...f.exec, token: Symbol('forged') }, f.result);
  assert.equal(f.registry.get(f.exec), undefined);
  f.registry.observe(f.exec, f.result);
  assert.ok(f.registry.get(f.exec), 'the genuine bound execution can still finish');
});

test('tool definition shadows or replacements invalidate runtime evidence', t => {
  const f = fixture(t); const runtime = f.approve();
  f.setScoped({});
  assert.equal(f.registry.get(f.exec), undefined);
  assert.equal(commandForPolicy(call(f, command(f), runtime)), command(f));
  f.registry.begin(f.exec); f.registry.observe(f.exec, f.result);
  assert.equal(f.registry.get(f.exec), undefined);
  f.setScoped(f.owner); f.setGlobal({});
  assert.equal(f.approve(), undefined);
});

test('cancellation and a later unsuccessful query clear prior evidence', t => {
  const f = fixture(t); f.approve();
  const controller = new AbortController();
  const exec = { ...f.exec, token: Symbol('aborted'), signal: controller.signal };
  f.registry.begin(exec); controller.abort(); f.registry.observe(exec, f.result);
  assert.equal(f.registry.get(f.exec), undefined);
  f.approve();
  f.registry.begin(f.exec); f.registry.observe(f.exec, { isError: true });
  assert.equal(f.registry.get(f.exec), undefined);
});

test('dispose removes pending abort listeners and revokes all old attestations', t => {
  const f = fixture(t); const runtime = f.approve();
  let listeners = 0;
  const signal = { aborted: false, addEventListener() { listeners++; }, removeEventListener() { listeners--; } };
  const exec = { ...f.exec, token: Symbol('pending'), signal };
  f.registry.begin(exec);
  assert.equal(listeners, 1);
  f.registry.dispose(); f.registry.dispose();
  assert.equal(listeners, 0);
  assert.equal(f.registry.get(f.exec), undefined);
  assert.equal(commandForPolicy(call(f, command(f), runtime)), command(f));
  f.registry.begin(exec); f.registry.observe(exec, f.result);
  assert.equal(listeners, 0);
  assert.equal(f.registry.get(exec), undefined);
});

test('file replacement or modification revokes the pair, including already obtained evidence', t => {
  const f = fixture(t); const runtime = f.approve();
  writeFileSync(f.pnpm, 'changed host script contents');
  assert.equal(commandForPolicy(call(f, command(f), runtime)), command(f));
  assert.equal(f.registry.get(f.exec), undefined);
  f.approve();
  renameSync(f.node, f.node + '.old'); writeFileSync(f.node, 'replacement');
  assert.equal(f.registry.get(f.exec), undefined);
});

test('file snapshots reject missing, non-file and filesystem alias paths', t => {
  const f = fixture(t);
  assert.ok(snapshotHostRuntimeFile(f.node));
  assert.equal(snapshotHostRuntimeFile(f.base), undefined);
  assert.equal(snapshotHostRuntimeFile(join(f.base, 'missing')), undefined);
  assert.equal(snapshotHostRuntimeFile(join(f.base, 'x') + '/../node'), undefined);
  const alias = join(f.base, 'alias');
  try { symlinkSync(join(f.base, '.dsh'), alias, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.diagnostic('filesystem alias creation unavailable; alias assertion skipped'); return; } throw error; }
  assert.equal(snapshotHostRuntimeFile(join(alias, 'dsh-runtimes', 'runtime space', process.platform === 'win32' ? 'node.exe' : 'node')), undefined);
});

test('only the two literal executable positions are projected; repeated data stays intact', t => {
  const f = fixture(t); f.approve();
  for (const verb of ['install', 'check', 'test', 'run custom']) {
    assert.equal(commandForPolicy(call(f, command(f, verb))), `__DSH_HOST_NODE__ __DSH_HOST_PNPM__ ${verb}`);
  }
  const data = `${quote(f.node)} ${quote(f.pnpm)} --output=${quote(f.pnpm)}`;
  const text = command(f, data);
  // Concatenated quoted/unquoted words are not part of the exemption grammar.
  assert.equal(commandForPolicy(call(f, text)), text);
  const simple = command(f, `test ${quote(f.pnpm)} ${quote(f.node)}`);
  assert.equal(commandForPolicy(call(f, simple)), `__DSH_HOST_NODE__ __DSH_HOST_PNPM__ test ${quote(f.pnpm)} ${quote(f.node)}`);
  const read = `Get-Content ${quote(f.node)}`;
  assert.equal(commandForPolicy(call(f, read)), read);
  assert.equal(commandForPolicy(call(f, command(f), { node: f.node, pnpm: f.pnpm })), command(f), 'plain objects do not forge host attestation');
});

test('hardRisk still refuses quoted protected data after an attested PowerShell pair', t => {
  const f = fixture(t); f.approve();
  for (const name of ['.npmrc', '.env', 'credentials', '.gitconfig', 'private.key']) {
    for (const delimiter of ["'", '"']) {
      const data = join(f.base, 'home space', name);
      const text = command(f, `test --userconfig ${delimiter}${data}${delimiter}`);
      assert.equal(hardRisk(call(f, text))?.code, 'SENSITIVE_COMMAND', text);
      assert.equal(call(f, text).args.command, text);
    }
  }
  assert.equal(hardRisk(call(f)), undefined, 'ordinary install retains its narrow path exemption');
});

test('host-runtime projection preserves read access to ordinary agent directories without widening mutation paths', t => {
  const f = fixture(t); assert.ok(f.approve(), 'the runtime pair must be genuinely attested');
  for (const command of [`cat ${quote(f.node)}`, "ls -la '.dsh/dsh-runtimes'", "cat '.codex/sessions/demo.jsonl'"]) {
    assert.equal(hardRisk(call(f, command, undefined, 'bash')), undefined, command);
  }
  for (const path of ['.codex/auth.json', '.dsh/credentials.json', '.aws/credentials']) {
    assert.equal(hardRisk(call(f, command(f, `test '${path}'`)))?.code, 'SENSITIVE_COMMAND', path);
  }
});

test('PowerShell dynamic/control syntax and spoofed pnpm locations retain full screening', t => {
  const f = fixture(t); f.approve();
  for (const text of [
    command(f) + '; Get-Content secret', command(f) + ' | Out-File out', command(f) + ' > out',
    command(f) + ' && other', command(f) + '\nother', command(f) + ' $(Get-Content secret)',
    command(f) + ' $env:SECRET', command(f) + ' "${env:SECRET}"', command(f) + ' @args',
    command(f) + ' --% extra', command(f) + ' `\nother', command(f) + " 'x''y'",
    `& ${quote(f.node)} --require helper ${quote(f.pnpm)} install`,
    `& ${quote(f.node)} ${quote(f.pnpm + '.fake')} install`,
    `& ${quote(f.node)} ${quote(f.pnpm)} -C=$cwd install`,
    `. ${quote(f.node)} ${quote(f.pnpm)} install`,
    `"${f.node}" "${f.pnpm}" install`,
  ]) assert.equal(commandForPolicy(call(f, text)), text, text);
  assert.equal(commandForPolicy(call(f, `& "${f.node}" "${f.pnpm}" install`)), '__DSH_HOST_NODE__ __DSH_HOST_PNPM__ install');
});

test('POSIX literal invocation supports quoted paths but no shell expansions or operators', t => {
  const f = fixture(t); f.approve();
  const text = `${quote(f.node)} ${quote(f.pnpm)} test`;
  assert.equal(commandForPolicy(call(f, text, undefined, 'bash')), '__DSH_HOST_NODE__ __DSH_HOST_PNPM__ test');
  for (const suffix of ['; id', ' | cat', ' > out', ' $(id)', ' "$HOME"', ' `id`', ' *.js', ' {a,b}', ' &']) {
    assert.equal(commandForPolicy(call(f, text + suffix, undefined, 'bash')), text + suffix);
  }
  assert.equal(commandForPolicy(call(f, `env ${text}`, undefined, 'bash')), `env ${text}`);
  assert.equal(commandForPolicy(call(f, text, undefined, 'shell')), text, 'unknown shell dialect has no exemption');
});
