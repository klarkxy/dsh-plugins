import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { collectExecutionEvidence } from '../src/execution-evidence.js';

const requireHost = createRequire(new URL('../../dsh-dev-index/package.json', import.meta.url));
let host;
try {
  const tools = requireHost.resolve('@deepseek-ai/dsh-tools');
  const requireTools = createRequire(tools);
  const fsEntry = requireTools.resolve('@deepseek-ai/dsh-fs');
  const fsVersion = JSON.parse(readFileSync(resolve(dirname(fsEntry), '../package.json'), 'utf8')).version;
  const store = resolve(dirname(fsEntry), '../../../../..');
  // Reuse the workspace's matching pinned backend; do not install a second host.
  const local = readdirSync(store).filter(name => name.startsWith('@deepseek-ai+dsh-fs-local@'))
    .map(name => join(store, name, 'node_modules/@deepseek-ai/dsh-fs-local'))
    .find(path => JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')).version === fsVersion);
  if (!local) throw Object.assign(new Error('matching local filesystem unavailable'), { code: 'MODULE_NOT_FOUND' });
  host = { cordis: await import(pathToFileURL(requireHost.resolve('@deepseek-ai/cordis')).href),
    local: await import(pathToFileURL(join(local, 'lib/index.js')).href) };
} catch (error) {
  if (process.env.CI || error.code !== 'MODULE_NOT_FOUND') throw error;
}

test('real DSH local filesystem: bounded package/script reads, symlink escape and stale content',
  { skip: !host && 'Pinned local FS unavailable (mandatory in CI)' }, async t => {
    const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'safe-auto-evidence-')));
    const root = join(tempRoot, 'workspace'), outside = join(tempRoot, 'outside');
    mkdirSync(join(root, 'scripts'), { recursive: true }); mkdirSync(outside);
    writeFileSync(join(root, 'package.json'), '{"scripts":{"check":"node scripts/check.mjs"}}');
    writeFileSync(join(root, 'scripts/check.mjs'), 'console.log("checked")');
    writeFileSync(join(outside, 'escape.js'), 'outside-private-content');
    writeFileSync(join(root, 'oversize.js'), 'x'.repeat(7000));
    const ctx = new host.cordis.Context(); const fiber = await ctx.plugin(host.local.default, { cwd: root });
    t.after(async () => {
      await fiber.dispose();
      assert.ok(tempRoot.startsWith(realpathSync(tmpdir()) + sep));
      rmSync(tempRoot, { recursive: true, force: true });
    });
    const call = { tool: 'pwsh', args: { command: 'pnpm check' }, cwd: root, sandbox: { workspaceRoot: root } };
    const signal = new AbortController().signal;
    const evidence = await collectExecutionEvidence(call, ctx.fs, signal);
    assert.equal(evidence.data.files.length, 2); assert.equal(await evidence.verify(), true);
    writeFileSync(join(root, 'scripts/check.mjs'), 'console.log("changed")');
    assert.equal(await evidence.verify(), false);
    const capped = await collectExecutionEvidence({ ...call, args: { command: 'node oversize.js' } }, ctx.fs, signal);
    assert.ok(capped.data.omissions.includes('EVIDENCE_TOO_LARGE'));
    // A directory junction on Windows requires no privileged symlink grant.
    symlinkSync(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    const escaped = await collectExecutionEvidence({ ...call, args: { command: 'node linked/escape.js' } }, ctx.fs, signal);
    assert.ok(escaped.data.omissions.includes('EVIDENCE_OUTSIDE_WORKSPACE_OR_PROTECTED'));
    assert.ok(!JSON.stringify(escaped.data).includes('outside-private-content'));
  });
