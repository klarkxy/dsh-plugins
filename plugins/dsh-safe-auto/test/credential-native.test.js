import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as safeAuto from '../src/index.js';

const requireHost = createRequire(new URL('../../dsh-dev-index/package.json', import.meta.url));
const load = path => import(pathToFileURL(path).href);
const toolsPath = requireHost.resolve('@deepseek-ai/dsh-tools');
const fsPath = createRequire(toolsPath).resolve('@deepseek-ai/dsh-fs');
const version = JSON.parse(readFileSync(resolve(dirname(fsPath), '../package.json'), 'utf8')).version;
const store = resolve(dirname(fsPath), '../../../../..');
const pinned = async name => {
  const folder = readdirSync(store).filter(entry => entry.startsWith(name.replace('/', '+').slice(0, 24)))
    .map(entry => join(store, entry, 'node_modules', name))
    .find(path => existsSync(join(path, 'package.json')) && JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')).version === version);
  assert.ok(folder, `${name} must be installed at the pinned host version`);
  return load(join(folder, 'lib/index.js'));
};
const host = {
  cordis: await load(requireHost.resolve('@deepseek-ai/cordis')),
  tools: await load(toolsPath), prompt: await load(requireHost.resolve('@deepseek-ai/dsh-system-prompt')),
  local: await pinned('@deepseek-ai/dsh-fs-local'), read: await pinned('@deepseek-ai/dsh-tool-fs'),
  search: await pinned('@deepseek-ai/dsh-tool-fs-search'),
};

async function fixture(t, readCaps = {}) {
  const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'safe-auto-credential-')));
  const root = join(tempRoot, 'workspace'); mkdirSync(root);
  const ctx = new host.cordis.Context(); const fibers = [];
  t.after(async () => {
    for (const fiber of fibers.reverse()) await fiber.dispose();
    assert.ok(tempRoot.startsWith(realpathSync(tmpdir()) + sep));
    rmSync(tempRoot, { recursive: true, force: true });
  });
  class Sandbox extends host.cordis.Service {
    constructor(scope) { super(scope, 'sandboxPolicy'); }
    resolve() { return { mode: 'workspace-write', workspaceRoot: root }; }
  }
  for (const [plugin, config] of [[host.prompt.default, {}], [host.tools.default, {}], [host.local.default, { cwd: root }], [Sandbox, {}], [host.read, readCaps]]) {
    fibers.push(await ctx.plugin(plugin, config));
  }
  const observations = [], posted = [], final = [], spills = [];
  ctx.on('fs/observed', (_target, value) => observations.push(value));
  ctx.on('tools/post-execute', async (_exec, result, next) => { posted.push(JSON.stringify(result)); return next(); });
  ctx.on('tools/result', (_exec, result) => final.push(JSON.stringify(result)));
  let rows = [], spawns = 0, shellRuns = 0;
  ctx.provide('subprocess', { spawn() {
    spawns++;
    const text = rows.map(row => JSON.stringify({ type: 'match', data: { path: { text: row.path }, line_number: row.lineNumber, lines: { text: row.line + '\n' } } })).join('\n');
    return { done: Promise.resolve({ exitCode: 0, signal: null }), collected: {
      stdout: { readFrom: () => ({ text, lossy: false }) }, stderr: { readFrom: () => ({ text: '', lossy: false }) },
    } };
  } });
  ctx.provide('spillStore', { async saveText(value) { spills.push(value.content); return { locator: 'synthetic-spill', retrievalHint: 'read fixture' }; } });
  fibers.push(await ctx.plugin({ name: 'search-fixture', inject: ['tools', 'systemPrompt', 'subprocess'], apply(scope) {
    host.search.applyGrepTool(scope, { maxMatches: 1, maxLineBytes: 2000, maxMetaBytes: 10000, timeoutMs: 30000, rawOutputMaxBytes: 1024 * 1024, graceMs: 100, stderrMaxBytes: 1000 });
  } }));
  ctx.tools.register({ name: 'bash', description: 'synthetic shell, never executes', parameters: { type: 'object' },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async () => { shellRuns++; return 'executed'; } });
  const agent = { id: 'agent', session: { id: 'session', header: { id: 'session', cwd: root }, snapshotEvents: () => [] } };
  const safeFiber = await ctx.plugin(safeAuto, {}); fibers.push(safeFiber);
  return { ctx, root, tempRoot, observations, posted, final, spills,
    setRows(value) { rows = value; }, counts: () => ({ spawns, shellRuns }),
    file(path, text) { const file = join(root, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); return file; },
    run(name, args, signal = new AbortController().signal) { return ctx.tools.execute({ callId: 'repeatable-id', name, arguments: args, agent, signal }); },
  };
}

test('native read keeps ordinary agent directories usable and removes mixed values from value/content/meta', async t => {
  const f = await fixture(t);
  for (const dir of ['.codex', '.dsh', '.claude', '.agents', '.config', '.ssh']) {
    f.file(`${dir}/skills/guide.md`, '# Ordinary skill\nKeep user changes.\n');
    const value = await f.run('read', { file_path: `${dir}/skills/guide.md` });
    assert.equal(value.isError, false, JSON.stringify(value));
    assert.match(JSON.stringify(value), /Keep user changes/);
  }
  const secret = 'fixtureSensitiveValue123';
  for (const [path, source] of [
    ['.codex/config.toml', `model = "example"\napi_key = "${secret}"\n`],
    ['.dsh/settings.yaml', `theme: dark\npassword: |\n  ${secret}\n  secondSecretLine\n`],
    ['.claude/settings.json', `{"model":"example","env":{"API_KEY":"${secret}"}}`],
    ['.env', `MODEL=example\nAPI_KEY=${secret}\n`],
  ]) {
    f.file(path, source);
    const result = await f.run('read', { file_path: path });
    assert.equal(result.isError, false, JSON.stringify(result));
    assert.ok(!JSON.stringify(result).includes(secret));
    assert.match(JSON.stringify(result), /example|dark/);
    assert.ok(!JSON.stringify(result).includes('secondSecretLine'));
  }
  assert.ok(!JSON.stringify([f.posted, f.final, f.observations]).includes(secret));
  assert.ok(f.observations.some(row => row.kind === 'present' && row.version));
});

test('dedicated stores, backup names and canonical junction aliases are refused before native body', async t => {
  const f = await fixture(t);
  f.file('.codex/auth.json', '{"secret":"syntheticAuthValue"}');
  f.file('.claude/.credentials.json.bak', '{"secret":"syntheticAuthValue"}');
  f.file('.gnupg/private-keys-v1.d/material.txt', 'syntheticAuthValue');
  symlinkSync(join(f.root, '.gnupg/private-keys-v1.d'), join(f.root, 'ordinary-link'), process.platform === 'win32' ? 'junction' : 'dir');
  const bypass = f.ctx.on('tools/pre-execute', async () => ({ kind: 'allow' }), { prepend: true });
  for (const path of ['.codex/auth.json', '.claude/.credentials.json.bak', join(f.root, '.codex/auth.json'), 'ordinary-link/material.txt']) {
    const before = f.observations.length;
    const result = await f.run('read', { file_path: path });
    assert.equal(result.isError, true); assert.ok(!JSON.stringify(result).includes('syntheticAuthValue'));
    assert.equal(f.observations.length, before, 'read body must not observe the denied store');
  }
  bypass();
});

test('native read pagination and configured line/byte caps survive Unicode and multiline masking', async t => {
  const f = await fixture(t, { readLimit: 3, readMaxLineLength: 35, readMaxBytes: 120 });
  f.file('.dsh/config.yaml', 'model: 模型\napi_key: |\n  abcdefghijklmnopqrstuvwxyzLongSyntheticSecret\n  secondSensitiveLine\ntheme: dark\n');
  const result = await f.run('read', { file_path: '.dsh/config.yaml', offset: 3, limit: 2 });
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.deepEqual(result.value.lines.map(row => row.number), [3, 4]);
  assert.equal(result.value.offset, 3); assert.equal(result.value.totalLines, 5);
  assert.ok(result.value.lines[0].text.endsWith('... (line truncated to 35 chars)'));
  assert.ok(!JSON.stringify(result).includes('Sensitive')); assert.ok(!JSON.stringify(result).includes('abcdefghijklmnopqrstuvwxyz'));
  assert.deepEqual(result.meta.lines, result.value.lines);
  assert.equal((await f.run('read', { file_path: '.dsh/config.yaml', limit: 4 })).isError, true, 'native argument cap still applies');
});

test('large JSONL sessions remain pageable while selected complete lines are safely screened', async t => {
  const f = await fixture(t, { readMaxLineLength: 60 });
  const prefix = JSON.stringify({ text: 'ordinary history '.repeat(40) }) + '\n';
  f.file('.codex/sessions/session.jsonl.bak', JSON.stringify({ text: 'x'.repeat(1100000) }) + '\n' + prefix.repeat(2000) + '{"api_key":"syntheticLargeSessionSecret","text":"last normal message"}\n');
  const result = await f.run('read', { file_path: '.codex/sessions/session.jsonl.bak', offset: 2002, limit: 1 });
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.equal(result.value.totalLines, 2002); assert.equal(result.value.lines[0].number, 2002);
  assert.ok(!JSON.stringify(result).includes('syntheticLargeSessionSecret'));
});

test('malformed, unsupported or oversized structured files never publish raw fragments', async t => {
  const f = await fixture(t);
  for (const [path, source] of [
    ['.claude/config.json', '{"api_key":"syntheticMalformedSecret'],
    ['.codex/config.toml', 'api_key = "syntheticMalformedSecret'],
    ['.dsh/config.yaml', 'a: [\npassword: syntheticMalformedSecret'],
    ['config.xml', '<password>syntheticMalformedSecret</password>'],
    ['large-config.json', '{"api_key":"syntheticMalformedSecret","data":"' + 'x'.repeat(1100000) + '"}'],
  ]) {
    f.file(path, source);
    const result = await f.run('read', { file_path: path });
    assert.equal(result.isError, true, path); assert.ok(!JSON.stringify(result).includes('syntheticMalformedSecret'));
    assert.match(JSON.stringify(result), /CREDENTIAL_READ_UNAVAILABLE/, 'safe native error and recovery guidance survive normalization');
    assert.doesNotMatch(JSON.stringify(result), /losslessly JSON-serializable/);
  }
  assert.ok(!JSON.stringify([f.posted, f.final]).includes('syntheticMalformedSecret'));
});

test('native grep masks matches before presentation and real search spill policy', async t => {
  const f = await fixture(t);
  const raw = '{"model":"visible-model","api_key":"syntheticGrepSecret"}';
  f.file('.claude/settings.json', raw); f.file('.codex/auth.json', raw); f.file('normal.md', 'normal match');
  f.setRows([{ path: '.claude/settings.json', lineNumber: 1, line: raw },
    { path: '.codex/auth.json', lineNumber: 1, line: raw }, { path: 'normal.md', lineNumber: 1, line: 'normal match' }]);
  const result = await f.run('grep', { pattern: 'match|key', path: '.' });
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.equal(f.counts().spawns, 1); assert.equal(f.spills.length, 1);
  assert.ok(!JSON.stringify([result, f.posted, f.final, f.spills]).includes('syntheticGrepSecret'));
  assert.match(f.spills[0], /visible-model/); assert.match(f.spills[0], /normal match/);
});

test('native read and grep protect Docker, Kubernetes, URL passwords and structured backups', async t => {
  const f = await fixture(t);
  const cases = [
    ['.docker/config.json', '{"auths":{"registry.example.test":{"auth":"Zml4dHVyZTpmaXh0dXJl"}},"credsStore":"desktop"}', 'Zml4dHVyZTpmaXh0dXJl', 'desktop'],
    ['.kube/config', 'apiVersion: v1\nusers:\n- name: visible-user\n  user:\n    client-key-data: Zml4dHVyZUtleQ==\n    client-certificate-data: publicCertificate\n    token: |\n      syntheticBlockToken\n', 'Zml4dHVyZUtleQ==|syntheticBlockToken', 'publicCertificate'],
    ['.git/config', '[remote "origin"]\n  url = https://fixture:fixturePassword@example.test/repo.git\n', 'fixturePassword', 'example.test/repo.git'],
    ['.dsh/config.yaml.bak', 'model: visible\napi_key: |\n  syntheticBackupKey\n', 'syntheticBackupKey', 'visible'],
    ['.codex/config.toml.bak', 'model = "visible"\nenv."API_KEY" = "syntheticBackupKey"\n', 'syntheticBackupKey', 'visible'],
  ];
  for (const [path, source, hidden, visible] of cases) {
    f.file(path, source);
    const result = await f.run('read', { file_path: path });
    assert.equal(result.isError, false, JSON.stringify(result));
    assert.doesNotMatch(JSON.stringify([result, f.posted, f.final]), new RegExp(hidden), path);
    assert.ok(JSON.stringify(result).includes(visible), path);
  }
  f.setRows([{ path: '.docker/config.json', lineNumber: 1, line: cases[0][1] },
    { path: '.kube/config', lineNumber: 5, line: '    client-key-data: Zml4dHVyZUtleQ==' }]);
  const result = await f.run('grep', { pattern: 'auth|client-key-data', path: '.' });
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.doesNotMatch(JSON.stringify([result, f.posted, f.final, f.spills]), /Zml4dHVyZTpmaXh0dXJl|Zml4dHVyZUtleQ==/);
  assert.match(JSON.stringify(result), /desktop/);
});

test('known absolute mixed-config shell dumps are stopped before jobs or process execution', async t => {
  const f = await fixture(t);
  const file = f.file('custom-settings.json', '{"model":"normal","api_key":"syntheticShellSecret"}');
  const result = await f.run('bash', { command: `cat '${file}'` });
  assert.equal(result.isError, true, JSON.stringify(result)); assert.equal(f.counts().shellRuns, 0);
  assert.ok(!JSON.stringify([result, f.posted, f.final]).includes('syntheticShellSecret'));
  const ordinary = f.file('normal.md', 'normal prose');
  assert.equal((await f.run('bash', { command: `cat '${ordinary}'` })).isError, false);
  assert.equal(f.counts().shellRuns, 1);
});

test('conventional relative settings dumps are stopped before the shell body; native content remains usable', async t => {
  const f = await fixture(t);
  for (const path of ['.claude/settings.json', '.claude/settings.local.json', '.dsh/profiles/main/settings.yaml', '.codex/settings.toml']) {
    const source = path.endsWith('.yaml') ? 'model: visible\napi_key: syntheticRelativeSecret\n'
      : path.endsWith('.toml') ? 'model = "visible"\napi_key = "syntheticRelativeSecret"\n'
        : '{"model":"visible","env":{"API_KEY":"syntheticRelativeSecret"}}';
    f.file(path, source);
    assert.equal((await f.run('bash', { command: `cat '${path}'` })).isError, true, path);
    const result = await f.run('read', { file_path: path });
    assert.equal(result.isError, false); assert.match(JSON.stringify(result), /visible/);
    assert.ok(!JSON.stringify(result).includes('syntheticRelativeSecret'));
  }
  assert.equal(f.counts().shellRuns, 0);
});

test('changed source is withheld instead of publishing an incoherent native read window', async t => {
  const f = await fixture(t);
  const path = f.file('mixed.json', '{"model":"initial","api_key":"syntheticOldSecret"}');
  const stop = f.ctx.on('tools/execute', async (exec, next) => {
    const result = await next();
    if (exec.name === 'read') writeFileSync(path, '{"model":"changed","api_key":"syntheticChangedSecret"}');
    return result;
  });
  const result = await f.run('read', { file_path: path }); stop();
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result), /CREDENTIAL_READ_UNAVAILABLE/);
  assert.doesNotMatch(JSON.stringify([result, f.posted, f.final]), /syntheticOldSecret|syntheticChangedSecret/);
});
