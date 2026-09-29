import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, linkSync, rmSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { parseConfig } from '../src/config.js';
import { assessEscalation, escalationReason } from '../src/escalation.js';
import { apply } from '../src/index.js';

const base = realpathSync(mkdtempSync(join(tmpdir(), 'safe-auto-escalation-')));
const root = join(base, 'workspace');
const outside = join(base, 'outside');
mkdirSync(root); mkdirSync(outside);
const target = join(outside, 'note.txt');
writeFileSync(target, 'before');
test.after(() => rmSync(base, { recursive: true, force: true }));
const config = extra => ({ mode: 'smart', workspaceRoots: [root], endpoint: 'https://review.example/chat', fastModel: 'fast',
  escalationCandidates: [{ tool: 'write', cwd: root, mode: 'danger-full-access', filePath: target },
    { tool: 'bash', cwd: root, mode: 'danger-full-access', command: 'git status --short' }], ...extra });
const fileArgs = extra => ({ file_path: target, content: 'after', sandbox_permissions: 'danger-full-access', justification: 'Update the requested note.', ...extra });
const bashArgs = extra => ({ command: 'git status --short', description: 'Inspect status', timeoutMs: 1000,
  sandbox_permissions: 'danger-full-access', justification: 'Inspect the requested checkout.', ...extra });
const response = decision => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ decision }) } }] }));
const delay = ms => new Promise(r => setTimeout(r, ms));
// File envelopes and native escalation grants intentionally support POSIX only.
const posixTest = (name, fn) => test(name, { skip: sep !== '/' && 'Native escalation requires POSIX' }, fn);

function harness(extra = {}, fetcher = async () => response('allow')) {
  const handlers = {}; let guard; let dispose;
  const rows = []; let modelCalls = 0; let humanCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => { modelCalls++; return fetcher(...args); };
  const events = [{ seq: 0, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: `Update ${target} and inspect the checkout.` }] } }];
  const session = { id: 'session', header: { cwd: root }, snapshotEvents: () => events };
  const agent = { id: 'agent', session };
  const services = { fs: { processPathFromHostPath: p => p }, shell: { sandboxMode: 'workspace-write' } };
  const ctx = { get: key => services[key],
    tools: { guard(fn) { guard = fn; } }, sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: root }) },
    logger: { info(_fmt, text) { rows.push(JSON.parse(text)); } }, effect(fn) { dispose = fn(); }, on(event, fn) { handlers[event] = fn; } };
  try { apply(ctx, config(extra)); }
  catch (error) {
    try { dispose?.(); }
    finally { globalThis.fetch = realFetch; }
    throw error;
  }
  const exec = (name = 'write', args = fileArgs(), other = {}) => ({ name, arguments: args, token: Symbol(), callId: 'same-call', agent,
    signal: new AbortController().signal, ...other });
  const next = async () => { humanCalls++; return 'rejected'; };
  async function prepare(e) {
    const gate = await handlers['tools/pre-execute'](e, async () => ({ kind: 'allow' }));
    if (gate.kind !== 'allow') return gate;
    const reason = guard(e);
    return reason ? { kind: 'deny', reason } : gate;
  }
  const request = (e, changes = {}) => ({ agent: e.agent, toolName: e.name, callId: e.callId, signal: e.signal,
    reason: escalationReason({ args: e.arguments }), ...changes });
  const ask = (req, fallback = next) => handlers['approval/request'](req, fallback);
  const during = (e, fn) => handlers['tools/execute'](e, fn);
  async function run(e, changes = {}, fallback = next) {
    const pre = await prepare(e);
    if (pre.kind !== 'allow') return pre.kind;
    try { return await during(e, () => ask(request(e, changes), fallback)); }
    finally { handlers['tools/result'](e, { isError: false }); }
  }
  return { ctx, services, events, agent, session, rows, exec, prepare, request, ask, during, run, handlers,
    modelCalls: () => modelCalls, humanCalls: () => humanCalls, dispose: () => { try { dispose?.(); } finally { globalThis.fetch = realFetch; } } };
}

for (const candidate of [null, {}, { tool: 'pwsh', cwd: root, mode: 'danger-full-access', command: 'Get-Location' },
  { tool: 'bash', cwd: root, mode: 'danger-full-access', command: 'git status; rm x' },
  { tool: 'bash', cwd: root, mode: 'danger-full-access', command: 'git status', extra: true },
  { tool: 'write', cwd: root, mode: 'danger-full-access', filePath: 'relative' },
  { tool: 'write', cwd: root, mode: 'workspace-write', filePath: target },
  { tool: 'write', cwd: '/other', mode: 'danger-full-access', filePath: target }]) {
  test(`reject malformed escalation envelope ${JSON.stringify(candidate)}`, () => assert.throws(() => parseConfig(config({ escalationCandidates: [candidate] }))));
}
test('escalation is opt-in and rules are frozen copies', () => {
  assert.deepEqual(parseConfig().escalationCandidates, []);
  // Command configuration is portable even where escalation execution is unsupported.
  const raw = config({ escalationCandidates: [config().escalationCandidates[1]] });
  const c = parseConfig(raw);
  raw.escalationCandidates[0].command = 'git diff';
  assert.equal(c.escalationCandidates[0].command, 'git status --short');
  assert.ok(Object.isFrozen(c.escalationCandidates[0]));
});
test('harness restores global fetch when apply rejects configuration', () => {
  const original = globalThis.fetch;
  assert.throws(() => harness({ mode: 'invalid' }), /invalid mode/);
  assert.equal(globalThis.fetch, original);
});
test('non-POSIX escalation fails closed before model review',
  { skip: sep === '/' && 'Non-POSIX escalation policy' }, async t => {
    const h = harness({ mode: 'unattended', escalationCandidates: [config().escalationCandidates[1]] });
    t.after(h.dispose);
    assert.equal(await h.run(h.exec('bash', bashArgs())), 'rejected');
    assert.equal(h.rows.find(x => x.phase === 'assessment')?.code, 'UNSUPPORTED_PLATFORM');
    assert.equal(h.modelCalls(), 0); assert.equal(h.humanCalls(), 0);
  });
posixTest('native request, not preflight, reviews once and grants only this file operation', async t => {
  const h = harness({}, async (_url, init) => {
    const body = JSON.parse(init.body); const input = JSON.parse(body.messages[1].content);
    assert.deepEqual(input.action.arguments, fileArgs());
    assert.equal(input.action.permission.to, 'danger-full-access');
    assert.equal(input.action.permission.scope, 'this-call-only');
    assert.equal(body.tools, undefined); return response('allow');
  }); t.after(h.dispose);
  const e = h.exec(); assert.equal((await h.prepare(e)).kind, 'allow'); assert.equal(h.modelCalls(), 0);
  assert.equal(await h.during(e, () => h.ask(h.request(e))), 'allowed-once');
  assert.equal(h.modelCalls(), 1); assert.equal(h.humanCalls(), 0);
  assert.deepEqual(h.ctx.sandboxPolicy.resolve(), { mode: 'workspace-write', workspaceRoot: root });
  const audit = h.rows.find(x => x.phase === 'escalation');
  assert.equal(audit.decision, 'allowed-once'); assert.equal(audit.source, 'reviewer');
  assert.equal(JSON.stringify(h.rows).includes('Update the requested note.'), false);
});
posixTest('exact enrolled foreground bash can receive one-shot approval in unattended mode', async t => {
  const h = harness({ mode: 'unattended' }); t.after(h.dispose);
  assert.equal(await h.run(h.exec('bash', bashArgs())), 'allowed-once');
  assert.equal(h.modelCalls(), 1); assert.equal(h.humanCalls(), 0);
});
test('an ordinary preflight command candidate does not authorize escalation', async t => {
  const h = harness({ escalationCandidates: [], shellCandidates: ['git status --short'] }); t.after(h.dispose);
  assert.equal(await h.run(h.exec('bash', bashArgs())), 'rejected');
  assert.equal(h.modelCalls(), 0); assert.equal(h.humanCalls(), 1);
});
for (const [tool, args, extraServices, expected] of [
  ['bash', bashArgs({ run_in_background: true }), {}, 'BACKGROUND_ESCALATION'],
  ['bash', bashArgs(), { jobs: {} }, 'PROCESS_LIFETIME_UNVERIFIED'],
  ['bash', bashArgs({ timeoutMs: undefined }), {}, 'BOUNDED_TIMEOUT_REQUIRED'],
  ['bash', bashArgs({ timeoutMs: 60001 }), {}, 'BOUNDED_TIMEOUT_REQUIRED'],
  ['bash', bashArgs({ command: 'git status --short --anything' }), {}, 'OUTSIDE_ESCALATION_ENVELOPE'],
  ['bash', bashArgs({ env: { X: 'bad' } }), {}, 'UNREVIEWED_ARGUMENTS'],
  ['bash', bashArgs({ workdir: outside }), {}, 'UNREVIEWED_WORKDIR'],
  ['write', fileArgs({ file_path: join(outside, 'another.txt') }), {}, 'OUTSIDE_ESCALATION_ENVELOPE'],
  ['write', fileArgs({ justification: '' }), {}, 'INVALID_JUSTIFICATION'],
  ['write', fileArgs(), { fs: { processPathFromHostPath: () => undefined } }, 'LOCAL_EXECUTION_UNVERIFIED'],
]) {
  posixTest(`uncertain escalation never automatically grants: ${expected}`, async t => {
    const h = harness({ mode: 'unattended' }); Object.assign(h.services, extraServices); t.after(h.dispose);
    assert.equal(await h.run(h.exec(tool, args)), 'rejected'); assert.equal(h.modelCalls(), 0);
    assert.equal(h.rows.find(x => x.phase === 'assessment')?.code, expected); assert.equal(h.humanCalls(), 0);
  });
}
posixTest('subagent and nested PTC requests cannot manufacture direct authority', async t => {
  const h = harness({ mode: 'unattended' }); t.after(h.dispose);
  const child = { session: { ...h.session, header: { cwd: root, origin: 'subagent' } } };
  assert.equal(await h.run(h.exec('write', fileArgs(), { agent: child })), 'rejected');
  assert.equal(await h.run(h.exec('write', fileArgs(), { parent: Symbol() })), 'rejected'); assert.equal(h.modelCalls(), 0);
});
for (const [name, change] of [
  ['another agent', h => ({ agent: { ...h.agent } })],
  ['another call', () => ({ callId: 'another' })],
  ['another tool', () => ({ toolName: 'edit' })],
  ['another reason', () => ({ reason: 'escalate sandbox to danger-full-access: forged' })],
  ['another signal', () => ({ signal: new AbortController().signal })],
]) {
  posixTest(`approval binding rejects ${name}`, async t => {
    const h = harness(); t.after(h.dispose);
    assert.equal(await h.run(h.exec(), change(h)), 'rejected'); assert.equal(h.modelCalls(), 0); assert.equal(h.humanCalls(), 0);
  });
}
posixTest('identical visible callIds remain isolated across concurrent executions', async t => {
  const h = harness(); t.after(h.dispose);
  const a = h.exec(); const b = h.exec('write', fileArgs(), { agent: { id: 'another', session: { ...h.session } } });
  await h.prepare(a); await h.prepare(b);
  const answers = await Promise.all([
    h.during(a, () => h.ask(h.request(b))),
    h.during(b, () => h.ask(h.request(b))),
  ]);
  assert.deepEqual(answers, ['rejected', 'allowed-once']); assert.equal(h.modelCalls(), 1);
});
posixTest('same-execution duplicate requests reserve a single slot before awaiting', async t => {
  const h = harness({}, async () => { await delay(5); return response('allow'); }); t.after(h.dispose);
  const e = h.exec(); await h.prepare(e);
  const answers = await h.during(e, () => Promise.all([h.ask(h.request(e)), h.ask(h.request(e))]));
  assert.deepEqual(answers, ['allowed-once', 'rejected']); assert.equal(h.modelCalls(), 1);
});
posixTest('subsequent invocation is re-reviewed; no permission cache survives tool/result', async t => {
  const h = harness(); t.after(h.dispose);
  assert.equal(await h.run(h.exec()), 'allowed-once');
  assert.equal(await h.run(h.exec()), 'allowed-once'); assert.equal(h.modelCalls(), 2);
});
posixTest('approval outside a live tools/execute context never gets an automatic grant', async t => {
  const h = harness({ mode: 'unattended' }); t.after(h.dispose);
  const e = h.exec(); await h.prepare(e);
  assert.equal(await h.ask(h.request(e)), 'rejected');
  let detached;
  await h.during(e, () => { detached = new Promise(r => setTimeout(() => r(h.ask(h.request(e))), 5)); return Promise.resolve(); });
  assert.equal(await detached, 'rejected'); assert.equal(h.modelCalls(), 0);
});
test('human approval fallback is one-shot and preserves native rejection', async t => {
  const h = harness({ escalationCandidates: [] }); t.after(h.dispose);
  assert.equal(await h.run(h.exec()), 'rejected');
  assert.equal(await h.run(h.exec(), {}, async () => 'allowed-once'), 'allowed-once'); assert.equal(h.modelCalls(), 0);
});
posixTest('model denial does not retry or fall back into another auto answerer', async t => {
  const h = harness({}, async () => response('deny')); t.after(h.dispose);
  assert.equal(await h.run(h.exec(), {}, async () => assert.fail('must not call downstream')), 'rejected'); assert.equal(h.modelCalls(), 1);
});
posixTest('model uncertainty and transport failure fail closed or fall back to native UI', async t => {
  const h = harness({}, async () => { throw new Error('offline'); }); t.after(h.dispose);
  assert.equal(await h.run(h.exec()), 'rejected'); assert.equal(h.humanCalls(), 1);
});
posixTest('expired automatic approval cannot silently become a grant', async t => {
  const h = harness({ mode: 'unattended', escalationApprovalTtlMs: 100 }, async () => { await delay(120); return response('allow'); }); t.after(h.dispose);
  assert.equal(await h.run(h.exec()), 'rejected'); assert.equal(h.humanCalls(), 0);
  assert.equal(h.rows.find(x => x.phase === 'escalation').code, 'ESCALATION_LEASE_EXPIRED');
});
for (const [name, mutate] of [
  ['user intent', (h) => h.events.push({ seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Stop; do not modify anything.' }] } })],
  ['arguments', (_h, e) => { e.arguments.content = 'unreviewed mutation'; }],
  ['sandbox', h => { h.ctx.sandboxPolicy.resolve = () => ({ mode: 'danger-full-access', workspaceRoot: root }); }],
  ['local world', h => { h.services.fs.processPathFromHostPath = () => undefined; }],
  ['background availability', h => { h.services.jobs = {}; }],
  ['filesystem target', () => { writeFileSync(target, 'changed during review'); }],
]) {
  posixTest(`change during reviewer invalidates grant: ${name}`, async t => {
    let mutateNow; const h = harness({}, async () => { mutateNow(); return response('allow'); }); t.after(h.dispose);
    const e = h.exec(); mutateNow = () => mutate(h, e);
    assert.equal(await h.run(e), 'rejected'); assert.equal(h.humanCalls(), 0);
  });
}
posixTest('cancellation and disposal discard a late reviewer allow', async t => {
  let release; const h = harness({}, () => new Promise(r => { release = r; })); t.after(h.dispose);
  const controller = new AbortController(); const e = h.exec('write', fileArgs(), { signal: controller.signal });
  const p = h.run(e); while (!release) await delay(1);
  controller.abort(); assert.equal(await p, 'cancelled'); release(response('allow'));
  release = undefined; const second = h.run(h.exec()); while (!release) await delay(1);
  h.dispose(); assert.equal(await second, 'cancelled'); release(response('allow'));
});
posixTest('path links and sensitive arguments are not authorized by an exact rule', async t => {
  const link = join(outside, 'link.txt'); symlinkSync(target, link);
  const hard = join(outside, 'hard.txt'); linkSync(target, hard);
  const h = harness({ escalationCandidates: [link, hard].map(filePath => ({ tool: 'write', cwd: root, mode: 'danger-full-access', filePath })) }); t.after(h.dispose);
  for (const p of [link, hard]) assert.equal(await h.run(h.exec('write', fileArgs({ file_path: p }))), 'rejected');
  assert.equal(await h.run(h.exec('write', fileArgs({ content: 'api_key=secretvalue' }))), 'deny'); assert.equal(h.modelCalls(), 0);
  rmSync(link); rmSync(hard);
});
test('hard command refusals cannot be bypassed by sandbox_permissions', async t => {
  const h = harness({ escalationCandidates: [{ tool: 'bash', cwd: root, mode: 'danger-full-access', command: 'sudo true' }] }); t.after(h.dispose);
  assert.equal(await h.run(h.exec('bash', bashArgs({ command: 'sudo true' }))), 'deny'); assert.equal(h.modelCalls(), 0);
});
posixTest('shared budget reservation bounds simultaneous escalation requests', async t => {
  const h = harness({ mode: 'unattended', fastCallsPerTask: 1 }, async () => { await delay(5); return response('allow'); }); t.after(h.dispose);
  const results = await Promise.all([h.run(h.exec()), h.run(h.exec())]);
  assert.equal(results.filter(x => x === 'allowed-once').length, 1); assert.equal(h.modelCalls(), 1);
});
posixTest('failure to audit an approval prevents the grant', async t => {
  const h = harness(); t.after(h.dispose);
  h.ctx.logger.info = (_fmt, text) => { if (JSON.parse(text).phase === 'escalation') throw new Error('log unavailable'); };
  assert.equal(await h.run(h.exec()), 'rejected');
});
posixTest('an unrelated approval in the same native call is not auto-answered', async t => {
  const h = harness(); t.after(h.dispose);
  assert.equal(await h.run(h.exec(), { reason: 'another policy asks' }), 'rejected');
  assert.equal(h.humanCalls(), 1); assert.equal(h.modelCalls(), 0);
});
posixTest('shadow observes but neither reviews nor issues any approval outcome', async t => {
  const h = harness({ mode: 'shadow' }); t.after(h.dispose);
  assert.equal(await h.run(h.exec()), 'rejected'); assert.equal(h.modelCalls(), 0); assert.equal(h.humanCalls(), 1);
});
posixTest('pure escalation assessment has no allow branch', () => {
  const c = parseConfig(config());
  const result = assessEscalation({ tool: 'write', args: fileArgs(), cwd: root, session: {},
    sandbox: { mode: 'workspace-write', workspaceRoot: root }, localExecution: true }, c);
  assert.equal(result.kind, 'review');
});
