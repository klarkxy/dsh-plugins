import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, MESSAGES, createBreaker, MAX_ACTION_BYTES } from '../src/index.js';
import { parseConfig } from '../src/config.js';
import { createControl } from '../src/control.js';

const allowVerdict = { risk_level: 'low', user_authorization: 'high', outcome: 'allow', rationale: 'Routine.' };
const denyVerdict = { risk_level: 'high', user_authorization: 'low', outcome: 'deny', rationale: 'Deletes unrelated data.' };

function streamOf(verdict) {
  return (async function* () {
    const text = JSON.stringify(verdict);
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  })();
}

/** Fake host: records ctx.on handlers and drives them like the native pipeline. */
function fixture({ config = { provider: 'p', model: 'm' }, header = {}, llm: withLlm = true } = {}) {
  const handlers = {}, listenerOptions = {}, logs = [], seen = [];
  const reviewer = { verdict: allowVerdict, fail: false };
  const llm = { stream(options) {
    seen.push(options);
    if (reviewer.fail) throw new Error('ECONNRESET');
    if (reviewer.wait) return (async function* () {
      reviewer.enter?.();
      await reviewer.wait;
      yield* streamOf(reviewer.verdict);
    })();
    return streamOf(reviewer.verdict);
  } };
  let runtime;
  const ctx = {
    provide(key, value) { assert.equal(key, 'safeAutoRuntime'); runtime = value; },
    inject(deps, fn) { assert.deepEqual(deps, ['llm']); if (withLlm) fn({ llm, effect: fn2 => fn2() }); },
    effect(fn) { fn(); },
    on(event, fn, options) { handlers[event] = fn; listenerOptions[event] = options; },
    workingDirectory: { get: () => reviewer.cwd ?? '/w' },
    sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: '/w' }) },
    logger: { info: (...args) => logs.push(args) },
  };
  const events = [];
  const session = { id: 's', header: { cwd: '/w', ...header }, snapshotEvents: () => events };
  const agent = { session };
  const say = text => events.push({ seq: events.length, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } });
  say('Clean the build output and run the tests.');
  apply(ctx, config);
  let calls = 0;
  const exec = (name, args, extra = {}) => ({ name, arguments: args, agent, callId: `c${++calls}`, token: Symbol(`t${calls}`),
    signal: new AbortController().signal, ...extra });
  const preExecute = async (e, decision = { kind: 'allow' }) => handlers['tools/pre-execute'](e, async () => decision);
  const ask = (e, extra = {}) => handlers['approval/request']({ agent, toolName: e.name, callId: e.callId, reason: 'escalate', ...extra },
    async () => 'downstream');
  const postExecute = (e, result = { isError: true, content: [{ type: 'text', text: 'native error' }] }) =>
    handlers['tools/post-execute'](e, result, async () => ({ kind: 'accept' }));
  const finish = e => handlers['tools/result'](e, {});
  return { handlers, listenerOptions, runtime, reviewer, seen, logs, session, agent, events, say, exec, preExecute, ask, postExecute, finish };
}

const control = (enabled, extra = {}) => ({
  config: () => parseConfig({ provider: 'p', model: 'm', ...extra, enabled }),
  state: () => ({ active: enabled, revision: '0:0' }),
});
const escalated = { command: 'git push', description: 'push', sandbox_permissions: 'danger-full-access', justification: 'Push the branch.' };

test('registers the native seams with prepend for pre-execute and approval', () => {
  const f = fixture();
  assert.deepEqual(Object.keys(f.handlers).sort(), ['approval/request', 'tools/post-execute', 'tools/pre-execute', 'tools/result']);
  assert.deepEqual(f.listenerOptions['tools/pre-execute'], { prepend: true });
  assert.deepEqual(f.listenerOptions['approval/request'], { prepend: true });
});

test('a non-active session delegates approval and leaves pre-execute untouched', async () => {
  const f = fixture();
  f.runtime.attach(control(false));
  const dangerous = f.exec('bash', { command: 'rm -rf node_modules' });
  assert.deepEqual(await f.preExecute(dangerous), { kind: 'allow' });
  const e = f.exec('bash', escalated);
  await f.preExecute(e);
  assert.equal(await f.ask(e), 'downstream');
  assert.equal(f.seen.length, 0);
});

test('ordinary calls keep the native decision unchanged, including the reported false positives', async () => {
  const f = fixture();
  const ordinary = [
    ['read', { file_path: 'AGENTS.md' }],
    ['grep', { pattern: 'api_key:' }],
    ['pwsh', { command: 'Get-Content AGENTS.md' }],
    ['pwsh', { command: 'git log --oneline -5 -- .github/workflows' }],
    ['pwsh', { command: '$token = 1; echo $token' }],
    ['pwsh', { command: 'Get-ChildItem $env:USERPROFILE\\.dsh\\sessions' }],
    ['bash', { command: 'grep -rn "api_key:" src' }],
    ['bash', { command: 'cat .dsh/config.toml' }],
    ['bash', { command: 'curl --version' }],
    ['bash', { command: 'env | sort' }],
    ['bash', { command: 'find . -name "*.js" | xargs wc -l' }],
    ['pwsh', { command: 'Remove-Item .scratch\\tmp.txt' }],
    ['pwsh', { command: 'pnpm --filter x test 2>&1 | Select-Object -Last 20' }],
    ['write', { file_path: 'src/a.js', content: 'x' }],
    ['edit', { file_path: '.github/workflows/ci.yml', old_string: 'a', new_string: 'b' }],
  ];
  for (const [name, args] of ordinary) {
    for (const decision of [{ kind: 'allow' }, { kind: 'deny', reason: 'native' }, { kind: 'ask', reason: 'native ask' }]) {
      assert.deepEqual(await f.preExecute(f.exec(name, args), decision), decision, `${name} ${JSON.stringify(args)}`);
    }
  }
  assert.equal(f.seen.length, 0);
});

test('a dangerous shell command without escalation becomes an ask; with escalation it is unchanged', async () => {
  const f = fixture();
  const asked = await f.preExecute(f.exec('bash', { command: 'rm -rf node_modules' }));
  assert.equal(asked.kind, 'ask');
  assert.match(asked.reason, /dangerous command \(forced-rm\)/);
  assert.match(asked.displayReason.en, /Safe Auto review/);
  assert.match(asked.displayReason.zh, /安全自动审核/);
  assert.equal((await f.preExecute(f.exec('pwsh', { command: 'Remove-Item -Recurse -Force dist' }))).kind, 'ask');
  assert.deepEqual(await f.preExecute(f.exec('bash', { command: 'rm -rf node_modules', sandbox_permissions: 'danger-full-access' })), { kind: 'allow' });
  // A native denial is never softened into an ask.
  const denial = { kind: 'deny', reason: 'native' };
  assert.deepEqual(await f.preExecute(f.exec('bash', { command: 'rm -rf x' }), denial), denial);
  // Non-shell tools are never inspected.
  assert.deepEqual(await f.preExecute(f.exec('write', { file_path: 'x', content: 'rm -rf /' })), { kind: 'allow' });
  assert.equal(f.seen.length, 0);
});

test('approval outcomes: allow grants once; deny and review failure reject with model-facing guidance', async () => {
  const f = fixture();
  const allowed = f.exec('bash', escalated);
  await f.preExecute(allowed);
  assert.equal(await f.ask(allowed), 'allowed-once');
  assert.deepEqual(await f.postExecute(allowed, { isError: false, content: [] }), { kind: 'accept' });

  f.reviewer.verdict = denyVerdict;
  const denied = f.exec('bash', escalated);
  await f.preExecute(denied);
  assert.equal(await f.ask(denied), 'rejected');
  const replaced = await f.postExecute(denied);
  assert.deepEqual(replaced, { kind: 'accept', content: [{ type: 'text', text: MESSAGES.denied('Deletes unrelated data.') }] });
  assert.match(replaced.content[0].text, /rejected due to unacceptable risk/);
  // Feedback is consumed once.
  assert.deepEqual(await f.postExecute(denied), { kind: 'accept' });

  f.reviewer.fail = true;
  const failed = f.exec('pwsh', { ...escalated, command: 'pnpm install' });
  await f.preExecute(failed);
  assert.equal(await f.ask(failed), 'rejected');
  const failure = await f.postExecute(failed);
  assert.equal(failure.content[0].text, MESSAGES.failed('the reviewer request failed'));
  assert.match(failure.content[0].text, /review failure, not a determination that the action is unsafe/);
  assert.equal(f.seen.length, 4, 'one review each, plus one retry for the transport failure');
});

test('post-execute keeps a block or value replacement from a later policy untouched', async () => {
  const f = fixture();
  f.reviewer.verdict = denyVerdict;
  const e = f.exec('bash', escalated);
  await f.preExecute(e);
  await f.ask(e);
  const block = { kind: 'block', feedback: [{ type: 'text', text: 'other policy' }] };
  assert.deepEqual(await f.handlers['tools/post-execute'](e, { isError: true, content: [] }, async () => block), block);
});

test('an aborted request is cancelled without feedback', async () => {
  const f = fixture();
  const abort = new AbortController(); abort.abort();
  const e = f.exec('bash', escalated);
  await f.preExecute(e);
  assert.equal(await f.ask(e, { signal: abort.signal }), 'cancelled');
  assert.deepEqual(await f.postExecute(e), { kind: 'accept' });
  const aborted = f.exec('bash', escalated, { signal: abort.signal });
  await f.preExecute(aborted);
  assert.equal(await f.ask(aborted), 'cancelled');
});

test('approval requests without a tracked execution go to the native flow', async () => {
  const f = fixture();
  assert.equal(await f.ask({ name: 'bash', callId: 'unknown' }), 'downstream');
  assert.equal(await f.ask({ name: 'external', callId: undefined }), 'downstream');
  // A finished execution is forgotten.
  const e = f.exec('bash', escalated);
  await f.preExecute(e);
  f.finish(e);
  assert.equal(await f.ask(e), 'downstream');
  assert.equal(f.seen.length, 0);
});

test('circuit breaker: three denials pause review for the turn; a new user message resets it', async () => {
  const f = fixture();
  f.reviewer.verdict = denyVerdict;
  for (let i = 0; i < 3; i++) {
    const e = f.exec('bash', escalated);
    await f.preExecute(e);
    assert.equal(await f.ask(e), 'rejected');
  }
  assert.equal(f.seen.length, 3);
  const paused = f.exec('bash', escalated);
  await f.preExecute(paused);
  assert.equal(await f.ask(paused), 'rejected');
  assert.equal(f.seen.length, 3, 'no model call while the breaker is open');
  assert.equal((await f.postExecute(paused)).content[0].text, MESSAGES.breaker);

  f.say('Okay, try a safer approach.');
  f.reviewer.verdict = allowVerdict;
  const resumed = f.exec('bash', escalated);
  await f.preExecute(resumed);
  assert.equal(await f.ask(resumed), 'allowed-once');
  assert.equal(f.seen.length, 4);
});

test('breaker window: ten denials among the last fifty reviews also open it', () => {
  const breaker = createBreaker(), session = {};
  for (let i = 0; i < 10; i++) { breaker.record(session, 1, true); breaker.record(session, 1, false); }
  assert.equal(breaker.open(session, 1), true);
  assert.equal(breaker.open(session, 2), false, 'a new turn starts a fresh window');
  for (let i = 0; i < 2; i++) breaker.record(session, 2, true);
  breaker.record(session, 2, false);
  assert.equal(breaker.open(session, 2), false, 'an allow resets the consecutive count');
});

test('subagent sessions are never reviewed', async () => {
  const f = fixture({ header: { origin: 'subagent', delegationDepth: 1 } });
  const e = f.exec('bash', escalated);
  assert.deepEqual(await f.preExecute(f.exec('bash', { command: 'rm -rf x' })), { kind: 'allow' });
  await f.preExecute(e);
  assert.equal(await f.ask(e), 'downstream');
  assert.equal(f.seen.length, 0);
});

test('headless profiles review with the base config until the UI row attaches; after it detaches review stops', async () => {
  const f = fixture({ config: { provider: 'base', model: 'reviewer' } });
  const first = f.exec('bash', escalated);
  await f.preExecute(first);
  assert.equal(await f.ask(first), 'allowed-once');
  assert.deepEqual([f.seen[0].provider, f.seen[0].model], ['base', 'reviewer']);
  const detach = f.runtime.attach(control(true, { provider: 'ui', model: 'chosen' }));
  assert.throws(() => f.runtime.attach(control(true)), /already attached/);
  const second = f.exec('bash', escalated);
  await f.preExecute(second);
  assert.equal(await f.ask(second), 'allowed-once');
  assert.equal(f.seen[1].model, 'chosen');
  detach();
  const third = f.exec('bash', escalated);
  await f.preExecute(third);
  assert.equal(await f.ask(third), 'downstream');
  assert.equal((await f.preExecute(f.exec('bash', { command: 'rm -rf x' }))).kind, 'allow');
  assert.equal(f.seen.length, 2);
});

test('attaching and detaching the UI row without any traffic still ends headless review', async () => {
  const f = fixture();
  f.runtime.attach(control(true))();
  const e = f.exec('bash', escalated);
  await f.preExecute(e);
  assert.equal(await f.ask(e), 'downstream');
  assert.equal(f.seen.length, 0);
});

test('a disabled profile registers nothing but still provides the runtime', () => {
  const f = fixture({ config: { enabled: false } });
  assert.deepEqual(Object.keys(f.handlers), []);
  assert.equal(f.runtime.base.enabled, false);
});

test('missing model service rejects with the failure guidance', async () => {
  const f = fixture({ llm: false });
  const e = f.exec('bash', escalated);
  await f.preExecute(e);
  assert.equal(await f.ask(e), 'rejected');
  assert.equal((await f.postExecute(e)).content[0].text, MESSAGES.failed('no reviewer model service'));
});

test('reviewer input carries the transcript with the trusted user message and the exact action', async () => {
  const f = fixture();
  f.events.push({ seq: 1, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'I will clean dist.' }] } } });
  const e = f.exec('pwsh', { command: 'Remove-Item -Recurse -Force dist', description: 'clean', sandbox_permissions: 'danger-full-access', justification: 'Clean output.' });
  await f.preExecute(e);
  assert.equal(await f.ask(e, { reason: 'escalate sandbox to danger-full-access: Clean output.' }), 'allowed-once');
  const options = f.seen[0];
  const input = options.messages[0].content[0].text;
  assert.match(input, /^# Transcript\n\[user \(trusted\)\] Clean the build output and run the tests\.\n\[assistant\] I will clean dist\./);
  assert.match(input, /"cwd":"\/w","workspaceRoot":"\/w","sandbox":"workspace-write"/);
  const action = JSON.parse(input.slice(input.indexOf('# Planned action\n') + '# Planned action\n'.length));
  assert.deepEqual(action, { tool: 'pwsh', arguments: e.arguments, approvalReason: 'escalate sandbox to danger-full-access: Clean output.' });
  assert.deepEqual([options.provider, options.model, options.maxTokens], ['p', 'm', 4096]);
  // Audit rows carry outcome metadata, never arguments.
  const audit = f.logs.map(args => args[1]).join('\n');
  assert.match(audit, /"outcome":"allowed-once"/);
  assert.doesNotMatch(audit, /Remove-Item/);
});

test('long arguments are complete and token-shaped arguments are redacted', async () => {
  const f = fixture();
  const token = `ghp_${'a'.repeat(36)}`;
  const e = f.exec('write', { file_path: 'notes.md', content: `${token} ${'z'.repeat(7000)}`, sandbox_permissions: 'danger-full-access', justification: 'x' });
  await f.preExecute(e);
  await f.ask(e);
  const input = f.seen[0].messages[0].content[0].text;
  assert.equal(input.includes(token), false);
  assert.match(input, /\[redacted-token\]/);
  assert.doesNotMatch(input, /<truncated chars/);
  assert.match(input, new RegExp('z'.repeat(7000)));
});

test('same-mode, narrower and invalid permission fields never exempt dangerous shell commands', async () => {
  const f = fixture();
  for (const name of ['bash', 'pwsh']) {
    const command = name === 'bash' ? 'rm -rf dist' : 'Remove-Item -Recurse -Force dist';
    for (const sandbox_permissions of ['workspace-write', 'read-only', '', null, 42, 'unknown']) {
      assert.equal((await f.preExecute(f.exec(name, { command, sandbox_permissions }))).kind, 'ask');
    }
    assert.equal((await f.preExecute(f.exec(name, { command, sandbox_permissions: 'danger-full-access' }))).kind, 'allow');
  }
});

test('the reviewer sees destructive suffixes, late array items, late keys and deeply nested redacted strings', async () => {
  const f = fixture();
  const secret = `ghp_${'a'.repeat(36)}`;
  let nested = { secret };
  for (let i = 0; i < 12; i++) nested = { child: nested };
  const args = {
    command: `echo ${'x'.repeat(6100)}; rm -rf /important-data`,
    items: [...Array(200).fill('safe'), 'last-item'],
    fields: { ...Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, i])), lastField: 'delete-target' },
    nested,
  };
  const e = f.exec('bash', args);
  await f.preExecute(e);
  assert.equal(await f.ask(e, { reason: `review ${secret}` }), 'allowed-once');
  const input = f.seen[0].messages[0].content[0].text;
  assert.match(input, /rm -rf \/important-data/);
  assert.match(input, /last-item/);
  assert.match(input, /delete-target/);
  assert.match(input, /\[redacted-token\]/);
  assert.equal(input.includes(secret), false);
  assert.doesNotMatch(input, /<truncated/);
});

test('oversized or non-JSON complete actions fail closed without model calls', async () => {
  const f = fixture();
  const circular = {}; circular.self = circular;
  for (const args of [{ command: 'x'.repeat(MAX_ACTION_BYTES) }, { command: '界'.repeat(MAX_ACTION_BYTES / 2) },
    { circular }, { value: 1n }, { value: Number.NaN }, { omitted: undefined }]) {
    const e = f.exec('write', args);
    await f.preExecute(e);
    assert.equal(await f.ask(e), 'rejected');
    assert.match((await f.postExecute(e)).content[0].text, /complete action/);
  }
  assert.equal(f.seen.length, 0);
});

test('redaction does not discard values when token-shaped keys become identical', async () => {
  const f = fixture({ config: { provider: 'p', model: 'm', reviewerPrompt: `Restrict ${'ghp_' + 'c'.repeat(36)}` } });
  const first = `ghp_${'a'.repeat(36)}`, second = `ghp_${'b'.repeat(36)}`;
  const e = f.exec('write', { [first]: 'first-target', [second]: 'second-target' });
  await f.preExecute(e);
  assert.equal(await f.ask(e), 'allowed-once');
  const input = f.seen[0].messages[0].content[0].text;
  assert.match(input, /first-target/);
  assert.match(input, /second-target/);
  assert.doesNotMatch(input, /ghp_/);
});

async function pendingReview(f, e) {
  const entered = Promise.withResolvers(), released = Promise.withResolvers();
  f.reviewer.enter = entered.resolve;
  f.reviewer.wait = released.promise;
  await f.preExecute(e);
  const result = f.ask(e);
  await entered.promise;
  return { result, release: released.resolve };
}

test('review uses effective cwd while keeping the sandbox workspace boundary', async () => {
  const f = fixture();
  f.reviewer.cwd = '/other';
  const e = f.exec('bash', escalated);
  await f.preExecute(e);
  assert.equal(await f.ask(e), 'allowed-once');
  const input = f.seen[0].messages[0].content[0].text;
  assert.match(input, /"cwd":"\/other","workspaceRoot":"\/w"/);
});

test('a cwd change invalidates a pending approval without changing workspaceRoot', async () => {
  const f = fixture();
  const e = f.exec('bash', escalated);
  const pending = await pendingReview(f, e);
  f.reviewer.cwd = '/other';
  pending.release();
  assert.equal(await pending.result, 'cancelled');
});

test('pending verdicts cannot outlive activation, permission, settings or control lifecycle changes', async t => {
  for (const change of ['disable', 'disable-enable', 'settings', 'dispose', 'detach-reattach']) {
    await t.test(change, async () => {
      const f = fixture();
      let preset = 'workspace-write';
      const presets = {
        catalog: () => ({ options: [{ value: 'workspace-write', name: 'Workspace' }] }),
        current: () => preset,
        resolve: () => ({ sandbox: 'workspace-write', approval: 'ask' }),
        set: (_session, value) => {
          preset = value;
          f.events.push({ seq: f.events.length, type: 'permission/preset', data: { preset: value } });
        },
      };
      Object.defineProperty(f.session, 'seq', { get: () => f.events.length });
      const owner = createControl(parseConfig({ provider: 'p', model: 'm' }), {
        table: { get: () => undefined, put: async () => {} }, presets,
        sandboxPolicy: { resolve: () => ({ mode: 'workspace-write' }) },
        sessions: { get: () => f.session, list: () => [f.session] },
      });
      const select = async value => owner.call('session.select', {
        sessionId: 's', expectedRevision: (await owner.call('session.get', { sessionId: 's' })).revision, value,
      });
      await select('safe-auto');
      const detach = f.runtime.attach(owner);
      const e = f.exec('bash', escalated);
      const pending = await pendingReview(f, e);
      if (change === 'disable' || change === 'disable-enable') {
        await select('workspace-write');
        if (change === 'disable-enable') await select('safe-auto');
      } else if (change === 'settings') {
        await owner.call('settings.save', { expectedRevision: 0, values: { reviewerPrompt: 'New restriction.' } });
      } else if (change === 'dispose') {
        await owner.dispose();
      } else {
        detach();
        f.runtime.attach(owner);
        detach(); // A stale disposer must not detach the new activation.
      }
      pending.release();
      assert.equal(await pending.result, 'cancelled');
      assert.deepEqual(await f.postExecute(e), { kind: 'accept' });
      f.reviewer.wait = undefined;
      if (change === 'detach-reattach' || change === 'disable-enable') {
        const fresh = f.exec('bash', escalated); await f.preExecute(fresh);
        assert.equal(await f.ask(fresh), 'allowed-once');
      }
      await owner.dispose();
    });
  }
});

test('verdicts bind raw arguments and the live execution, not just their redacted representation', async t => {
  for (const change of ['secret', 'finished', 'session', 'token']) {
    await t.test(change, async () => {
      const f = fixture();
      const e = f.exec('write', { value: `ghp_${'a'.repeat(36)}` });
      const pending = await pendingReview(f, e);
      if (change === 'secret') e.arguments.value = `ghp_${'b'.repeat(36)}`;
      if (change === 'finished') f.finish(e);
      if (change === 'session') f.agent.session = { ...f.session };
      if (change === 'token') e.token = Symbol('different');
      pending.release();
      assert.equal(await pending.result, 'cancelled');
    });
  }
});

test('ordinary conversation activity preserves a current pending review', async () => {
  const f = fixture();
  const e = f.exec('bash', escalated);
  const pending = await pendingReview(f, e);
  f.events.push({ seq: f.events.length, type: 'tool/result', data: {} });
  pending.release();
  assert.equal(await pending.result, 'allowed-once');
});

test('headless permission changes and switch-backs invalidate the pending verdict', async t => {
  for (const type of ['permission/preset', 'sandbox/mode', 'approval/policy']) {
    await t.test(type, async () => {
      const f = fixture();
      const e = f.exec('bash', escalated);
      const pending = await pendingReview(f, e);
      f.events.push({ seq: f.events.length, type, data: { value: 'changed' } });
      f.events.push({ seq: f.events.length, type, data: { value: 'original' } });
      pending.release();
      assert.equal(await pending.result, 'cancelled');
    });
  }
});
