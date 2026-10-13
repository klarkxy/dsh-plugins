import test from 'node:test';
import assert from 'node:assert/strict';
import { win32, posix } from 'node:path';
import { resolveReviewPaths } from '../src/review-paths.js';

const local = { processPathFromHostPath: value => value };
const windowsCall = (tool, args = {}) => ({ tool, args, cwd: 'C:\\session', sandbox: { workspaceRoot: 'D:\\workspace' } });

test('relative shell workdirs follow each native tool base without changing arguments', () => {
  const args = Object.freeze({ workdir: 'packages\\app\\..\\lib', command: 'pnpm test' });
  const pwsh = windowsCall('pwsh', args);
  const bash = windowsCall('bash', args);
  assert.deepEqual(resolveReviewPaths(pwsh, local, win32), { localExecution: true, workdir: 'C:\\session\\packages\\lib' });
  assert.deepEqual(resolveReviewPaths(bash, local, win32), { localExecution: true, workdir: 'D:\\workspace\\packages\\lib' });
  assert.equal(pwsh.args, args);
  assert.equal(bash.args, args);
  assert.equal(args.workdir, 'packages\\app\\..\\lib');
  assert.equal(pwsh.cwd, 'C:\\session');
});

test('omitted workdir follows native pwsh and bash defaults', () => {
  assert.equal(resolveReviewPaths(windowsCall('pwsh'), local, win32).workdir, 'C:\\session');
  assert.equal(resolveReviewPaths(windowsCall('bash'), local, win32).workdir, 'D:\\workspace');
});

test('file mutation paths resolve against the policy root, including absent new files', () => {
  for (const tool of ['write', 'edit']) {
    assert.deepEqual(resolveReviewPaths(windowsCall(tool, { file_path: 'src/new.js' }), local, win32),
      { localExecution: true, filePath: 'D:\\workspace\\src\\new.js' });
  }
});

test('the session cwd is the fallback when no policy workspace root exists', () => {
  for (const tool of ['pwsh', 'bash', 'write', 'edit']) {
    const call = { tool, cwd: '/session', args: { workdir: '.', file_path: 'new.txt' } };
    const result = resolveReviewPaths(call, local, posix);
    assert.equal(result.localExecution, true);
    assert.equal(result.workdir ?? result.filePath, ['bash', 'pwsh'].includes(tool) ? '/session' : '/session/new.txt');
  }
});

test('locality does not pretend to prove workspace containment or resolve symlinks', () => {
  const call = { tool: 'pwsh', cwd: '/workspace', sandbox: { workspaceRoot: '/workspace' }, args: { workdir: '../outside' } };
  assert.deepEqual(resolveReviewPaths(call, local, posix), { localExecution: true, workdir: '/outside' });
  assert.equal(resolveReviewPaths({ ...call, args: { workdir: 'link' } }, local, posix).workdir, '/workspace/link');
});

test('absolute drive and UNC paths keep their execution coordinates', () => {
  for (const workdir of ['E:\\other', '\\\\server\\share\\project']) {
    assert.deepEqual(resolveReviewPaths(windowsCall('pwsh', { workdir }), local, win32), { localExecution: true, workdir });
  }
});

test('missing, translated, throwing and mismatched provider mappings fail closed', () => {
  const call = windowsCall('pwsh', { workdir: '.' });
  for (const fs of [undefined, {}, { processPathFromHostPath: () => undefined },
    { processPathFromHostPath: value => `/remote/${value}` }, { processPathFromHostPath() { throw new Error('unavailable'); } },
    { processPathFromHostPath: value => value === 'D:\\workspace' ? undefined : value }]) {
    assert.deepEqual(resolveReviewPaths(call, fs, win32), { localExecution: false });
  }
});

test('invalid and ambient Windows paths cannot establish locality', () => {
  for (const workdir of ['', ' ', null, 5, 'bad\u0000path', 'C:relative', 'E:relative', '\\root-relative', '/root-relative']) {
    assert.deepEqual(resolveReviewPaths(windowsCall('pwsh', { workdir }), local, win32), { localExecution: false });
  }
  for (const extra of [{ cwd: undefined }, { cwd: 'relative' }, { sandbox: { workspaceRoot: 'relative' } }, { tool: 'read' }]) {
    assert.deepEqual(resolveReviewPaths({ ...windowsCall('pwsh'), ...extra }, local, win32), { localExecution: false });
  }
});
