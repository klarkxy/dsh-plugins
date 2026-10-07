import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Node does not load .jsx natively. This file uses plain createElement syntax:
// resolve its imports and load the exact source, without a build or loader.
// The UI primitives are stubbed because their browser bundle needs the host's
// CSS modules; see client-primitives-stub.mjs.
const source = await readFile(new URL('../src/client.jsx', import.meta.url), 'utf8');
const resolve = specifier => specifier === '@deepseek-ai/dsh-client-ui-primitives'
  ? new URL('./client-primitives-stub.mjs', import.meta.url).href
  : import.meta.resolve(specifier);
const client = await import(`data:text/javascript;base64,${Buffer.from(source
  .replace("from 'react'", `from '${resolve('react')}'`)
  .replace("from '@deepseek-ai/dsh-client-ui-primitives'", `from '${resolve('@deepseek-ai/dsh-client-ui-primitives')}'`)
  .replace("from '@klarkxy/dsh-model-route/ui'", `from '${new URL('./model-menu-stub.mjs', import.meta.url).href}'`)
  .replace("from '@klarkxy/dsh-model-route'", `from '${resolve('@klarkxy/dsh-model-route')}'`)
  .replace("from '@klarkxy/dsh-plugin-kit/official-ui'", `from '${resolve('@klarkxy/dsh-plugin-kit/official-ui')}'`)
  .replace("from '@klarkxy/dsh-plugin-kit/client-utils'", `from '${resolve('@klarkxy/dsh-plugin-kit/client-utils')}'`)).toString('base64')}`);
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const values = { provider: 'retired', model: 'legacy', reasoningEffort: 'unlisted', reviewerPrompt: '' };
const catalog = { groups: [{ id: 'provider', name: 'Provider', models: [{ id: 'reasoner', name: 'Reasoner', reasoning: { efforts: [{ id: 'medium', name: 'Medium' }] } }, { id: 'plain', name: 'Plain' }] }] };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const snapshot = (extra = {}) => ({ revision: '1:0', current: 'workspace-write', safeAuto: false, available: true, platform: 'win32',
  options: [{ value: 'read-only', name: 'read-only' }, { value: 'workspace-write', name: 'workspace-write' },
    { value: 'danger-full-access', name: 'danger-full-access' }, { value: 'safe-auto', name: 'Safe Auto' }], ...extra });

test('exact slot registrations use injection, replacement priority and bundle key; registration does not write', () => {
  const waiting = [], registered = [], calls = [];
  client.apply({ slots: { inject: (name, fn) => waiting.push([name, fn]), register: (options, component) => registered.push({ options, component }) }, connection: { rpc: { call: (...args) => { calls.push(args); return Promise.resolve({ ok: true, value: {} }); } } }, remote: { session: { modelCatalog: () => catalog } } });
  assert.deepEqual(client.inject, ['slots', 'connection', 'remote', 'remote.session', 'locale']);
  assert.deepEqual(waiting.map(([name]) => name), ['conversation.input.permission', 'plugins.bundle.config']);
  assert.equal(registered.length, 0);
  waiting.forEach(([, fn]) => fn());
  assert.equal(registered.length, 2);
  const menu = registered.find(r => r.component === client.PermissionMenu);
  assert.equal(menu.options.name, 'conversation.input.permission');
  assert.equal(menu.options.priority, -10);
  const panel = registered.find(r => r.component === client.SettingsPanel);
  assert.equal(panel.options.key, '@klarkxy/dsh-safe-auto');
  assert.deepEqual(calls, []);
  assert.deepEqual(Object.keys(panel.options.inject()), ['api', 'locale']);
});

test('RPC envelope uses exact channel, rejects errors and preserves values', async () => {
  const calls = [];
  const value = await client.unwrapRpc(async (...args) => { calls.push(args); return { ok: true, value: { revision: 3 } }; }, 'settings.get', {});
  assert.deepEqual(calls, [['/dsh-safe-auto', 'settings.get', {}]]);
  assert.deepEqual(value, { revision: 3 });
  await assert.rejects(client.unwrapRpc(async () => ({ ok: false, error: { message: 'conflict' } }), 'settings.save', {}), /conflict/);
});

test('catalog parsing delegates the remote envelope to dsh-model-route', () => {
  // The live host resolves Remote methods to `{ ok, value }`; the shared
  // parser unwraps it, so the menu never reads groups off the envelope.
  const bare = client.reviewerMenuState({ provider: 'provider', model: 'reasoner' }, catalog);
  const wrapped = client.reviewerMenuState({ provider: 'provider', model: 'reasoner' }, { ok: true, value: catalog });
  assert.deepEqual(wrapped.choices, bare.choices);
  assert.equal(bare.known, true);
  assert.deepEqual(bare.efforts, [{ id: 'medium', name: 'Medium' }]);
  // A failed or absent catalog keeps only the retained saved route.
  for (const bad of [{ ok: false, error: { code: 'X', message: 'no' } }, undefined, null]) {
    const state = client.reviewerMenuState({ provider: 'provider', model: 'reasoner' }, bad);
    assert.equal(state.known, false);
    assert.deepEqual(state.choices.map(choice => `${choice.provider}/${choice.model}`), ['provider/reasoner']);
  }
});

test('approval API uses session-scoped read and explicit one-shot answer RPCs', async () => {
  const waiting = [], registered = [], calls = [];
  client.apply({ slots: { inject: (name, fn) => waiting.push(fn), register: (options, component) => registered.push({ options, component }) },
    connection: { rpc: { call: async (...args) => { calls.push(args); return { ok: true, value: { accepted: true } }; } } },
    remote: { session: { modelCatalog: () => catalog } } });
  waiting.forEach(fn => fn());
  const { api } = registered.find(item => item.component === client.PermissionMenu).options.inject();
  await api.getApprovals('session-A');
  await api.answerApproval({ sessionId: 'session-A', requestId: 'request-A', outcome: 'allow' });
  assert.deepEqual(calls, [
    ['/dsh-safe-auto', 'approval.list', { sessionId: 'session-A' }],
    ['/dsh-safe-auto', 'approval.answer', { sessionId: 'session-A', requestId: 'request-A', outcome: 'allow' }],
  ]);
});

test('reviewer menu state lists exact catalog ids and retains an absent saved route', () => {
  const state = client.reviewerMenuState(values, catalog);
  assert.equal(state.follow, false);
  assert.equal(state.known, false);
  assert.deepEqual(state.choices.map(choice => `${choice.provider}/${choice.model}`), ['provider/reasoner', 'provider/plain', 'retired/legacy']);
  assert.deepEqual(state.choices[0].efforts, [{ id: 'medium', name: 'Medium' }]);
  // The saved-but-unlisted effort stays selectable through the shared helper.
  assert.deepEqual(state.efforts, [{ id: 'unlisted', name: 'unlisted' }]);
  const follow = client.reviewerMenuState({ provider: '', model: '', reasoningEffort: 'high' }, catalog);
  assert.equal(follow.follow, true);
  assert.equal(follow.known, true);
  assert.equal(follow.selected, undefined);
  assert.deepEqual(follow.efforts, []);
});

test('picking a model clears the effort and retains the prompt; follow clears the route', () => {
  const next = client.pickReviewerModel({ ...values, reviewerPrompt: 'keep me' }, { provider: 'provider', model: 'reasoner' });
  assert.equal(next.reasoningEffort, '');
  assert.equal(next.model, 'reasoner');
  assert.equal(next.reviewerPrompt, 'keep me');
  assert.equal(values.reasoningEffort, 'unlisted');
  const follow = client.pickReviewerModel(next, { provider: '', model: '' });
  assert.deepEqual([follow.provider, follow.model, follow.reasoningEffort], ['', '', '']);
});

const zhLocale = { getSnapshot: () => ({ active: 'zh-CN' }), subscribe: () => () => {} };

test('permission menu lists native presets plus Safe Auto with the current one checked', () => {
  const html = render(client.PermissionMenu, { sessionId: 's', locked: false, api: {}, initialSnapshot: snapshot({ current: 'safe-auto', safeAuto: true }) });
  // The list stays closed in SSR; only the anchor shows the current selection.
  assert.match(html, /Safe Auto/);
  assert.doesNotMatch(html, /role="menu"/);
  assert.match(source, /selectedId: snapshot\?\.current/);
  assert.equal(client.permissionLabel('read-only', 'read-only'), 'Read Only');
  assert.equal(client.permissionLabel('workspace-write', 'workspace-write', client.translator('zh')), '工作区内修改');
  assert.equal(client.permissionLabel('custom-preset', 'My Preset'), 'My Preset');
});

test('permission menu keeps an unavailable Safe Auto visible but disabled', () => {
  const html = render(client.PermissionMenu, { sessionId: 's', locked: false, api: {},
    initialSnapshot: snapshot({ available: false, options: snapshot().options.filter(o => o.value !== 'safe-auto') }) });
  assert.match(html, /Workspace Write/);
  assert.match(source, /unavailableShort/);
  assert.match(source, /disabled: true/);
});

test('permission menu zh anchor uses the localized labels', () => {
  const html = render(client.PermissionMenu, { sessionId: 's', locked: false, api: {}, locale: zhLocale, initialSnapshot: snapshot() });
  assert.match(html, /工作区内修改/);
  assert.doesNotMatch(html, /Workspace Write/);
});

test('settings render as a tablist: reviewer tab selected, other panels hidden', () => {
  const policyLimits = { timeoutMs: 1, maxInputBytes: 2, outputTokens: 3, maxReviewsPerTask: 4, consecutiveDenials: 5 };
  const html = render(client.SettingsPanel, { view: 'page', api: {}, initialSettings: { revision: 'r', values, policyLimits }, initialCatalog: catalog });
  assert.equal((html.match(/role="tab"/g) || []).length, 3);
  assert.equal((html.match(/role="tabpanel"/g) || []).length, 3);
  assert.match(html, /aria-selected="true"[^>]*>Reviewer/);
  // Only the reviewer panel is visible; hidden panels stay in the markup so
  // aria-controls always resolves.
  assert.equal((html.match(/hidden=""/g) || []).length, 2);
  assert.match(html, /<textarea/);
  assert.match(html, /--dsw-alias-label-primary/);
});

test('the limits tab exists only while the host reports policy limits', () => {
  const html = render(client.SettingsPanel, { view: 'page', api: {}, initialSettings: { revision: 'r', values }, initialCatalog: catalog });
  assert.equal((html.match(/role="tab"/g) || []).length, 2);
  assert.doesNotMatch(html, /-limits-panel"/);
  // A stale limits selection falls back to the reviewer tab.
  const stale = render(client.SettingsPanel, { view: 'page', api: {}, initialSettings: { revision: 'r', values }, initialCatalog: catalog, initialTab: 'limits' });
  assert.match(stale, /aria-selected="true"[^>]*>Reviewer/);
});

test('tab controls reference their panels by id', () => {
  const html = render(client.SettingsPanel, { view: 'page', api: {}, initialSettings: { revision: 'r', values }, initialCatalog: catalog });
  for (const [, panelId] of html.matchAll(/aria-controls="([^"]+)"/g)) assert.match(html, new RegExp(`id="${panelId}"`));
  for (const [, tabId] of html.matchAll(/aria-labelledby="([^"]+)"/g)) assert.match(html, new RegExp(`id="${tabId}"`));
});

test('reviewer tab shows prompt limits and retains unknown saved values', () => {
  const html = render(client.SettingsPanel, { view: 'page', api: {}, initialSettings: { revision: 'r', values }, initialCatalog: catalog });
  assert.match(html, /Additional reviewer prompt/);
  assert.match(html, /maxLength="4096"/i);
  assert.match(html, /never expand authorization/);
  assert.match(html, /retired \/ legacy/);
  assert.match(html, /unlisted/);
});

test('copy renders in one language chosen from the host locale', () => {
  const props = { view: 'page', api: {}, initialSettings: { revision: 1, values }, initialCatalog: catalog };
  const en = render(client.SettingsPanel, props);
  const zh = render(client.SettingsPanel, { ...props, locale: zhLocale });
  assert.match(en, />Reviewer</);
  assert.doesNotMatch(en, /审核配置/);
  assert.match(zh, /审核配置/);
  assert.match(zh, /安全说明/);
  assert.doesNotMatch(zh, />Reviewer</);
  assert.doesNotMatch(zh, / \/ [A-Z][a-z]+ /, 'no "中文 / English" pairs');
});

test('prompt counter describes the textarea', () => {
  const html = render(client.SettingsPanel, { view: 'page', api: {}, initialSettings: { revision: 1, values }, initialCatalog: catalog });
  assert.match(html, /<textarea[^>]*aria-describedby="sa-prompt-hint"/);
  assert.match(html, /id="sa-prompt-hint"[^>]*>0\/4096/);
});

test('the timed confirmation policy and evidence disclosure appear in the safety tab', () => {
  const props = { view: 'page', api: {}, initialSettings: { revision: 1, values }, initialCatalog: catalog, locale: zhLocale };
  const closed = render(client.SettingsPanel, props);
  assert.match(closed, /安全说明/);
  assert.match(closed, /id="[^"]*-details-panel" aria-labelledby="[^"]*-details-tab" hidden=""/, 'the safety panel stays hidden until its tab is selected');
  const open = render(client.SettingsPanel, { ...props, initialTab: 'details' });
  assert.match(open, /id="[^"]*-details-panel" aria-labelledby="[^"]*-details-tab" tabindex="0"/);
  assert.match(open, /无法自动判断时/);
  assert.match(source, /请你在 60 秒内确认；超时拒绝/);
  assert.match(source, /真人指令和有界的本地脚本证据/);
  assert.doesNotMatch(source, /change\(\{[^\n]*(?:human|fallbackPolicy)/);
});

test('follow-conversation picks the leading row and keeps a saved nondefault effort warned', () => {
  const html = render(client.ReviewerFields, { values: { provider: '', model: '', reasoningEffort: 'high', reviewerPrompt: '' }, catalog, onChange() {} });
  assert.ok(!html.includes('<select'), 'the native select is gone; the contract editor replaces it');
  assert.match(html, /aria-haspopup="menu"/);
  // The follow row is the checked leading item; the effort pane stays empty.
  assert.match(html, /role="menuitemradio" aria-checked="true"[^>]*>Follow conversation/);
  assert.match(html, /class="stub-efforts" data-selected="high"><\/span>/);
  assert.match(html, /Saved effort .* retained/);
  assert.doesNotMatch(html, /clears the reasoning effort/, 'the clear-effort hint only applies to an explicit model');
});

test('an explicit reviewer model offers its advertised efforts and clears on switch', () => {
  const on = render(client.ReviewerFields, { values: { provider: 'provider', model: 'reasoner', reasoningEffort: '', reviewerPrompt: '' }, catalog, onChange() {} });
  assert.match(on, /aria-haspopup="menu"/);
  assert.match(on, />Provider \/ Reasoner</);
  assert.match(on, /aria-checked="true"[^>]*>Provider \/ Reasoner</);
  assert.match(on, /class="stub-efforts" data-selected="">Medium<\/span>/);
  assert.match(on, /clears the reasoning effort/);
  const next = client.pickReviewerModel(values, { provider: '', model: '' });
  assert.deepEqual([next.provider, next.model, next.reasoningEffort], ['', '', '']);
});

test('summary view contains no editing form', () => {
  const summary = render(client.SettingsPanel, { view: 'summary', api: {}, initialSettings: { revision: 'r', values }, initialCatalog: catalog });
  assert.ok(!summary.includes('<select'));
  assert.ok(!summary.includes('<textarea'));
  assert.match(summary, /independent reviewer/);
});

test('request scope drops stale reads, closed view responses and unmounted responses', async () => {
  const scope = client.createRequestScope(), seen = [];
  const first = deferred(), second = deferred();
  const a = scope.run(() => first.promise, { value: value => seen.push(value) });
  const b = scope.run(() => second.promise, { value: value => seen.push(value) });
  second.resolve('new'); await b; first.resolve('old'); await a;
  assert.deepEqual(seen, ['new']);
  const closed = deferred(); const c = scope.run(() => closed.promise, { value: value => seen.push(value) });
  scope.invalidate(); closed.resolve('closed'); await c;
  const removed = deferred(); const d = scope.run(() => removed.promise, { value: value => seen.push(value), settled: () => seen.push('settled') });
  scope.dispose(); removed.resolve('removed'); await d;
  assert.deepEqual(seen, ['new']);
});

test('write lock prevents double click and refresh races; selection changes only after success', async () => {
  const scope = client.createRequestScope(), pending = deferred(), seen = [];
  let writes = 0;
  const write = () => { writes++; return pending.promise; };
  const a = scope.run(write, { value: value => seen.push(value) }, true);
  assert.equal(scope.writing, true);
  assert.deepEqual(seen, []);
  assert.equal(await scope.run(write, {}, true), false);
  assert.equal(await scope.run(async () => 'read'), false);
  assert.equal(writes, 1);
  pending.resolve('confirmed'); await a;
  assert.deepEqual(seen, ['confirmed']);
  assert.equal(scope.writing, false);
});

test('failed writes do not publish a new selection or retry and unlock', async () => {
  const scope = client.createRequestScope(), values = [], errors = [];
  let writes = 0;
  await scope.run(async () => { writes++; throw new Error('revision conflict'); }, { value: value => values.push(value), error: e => errors.push(e.message) }, true);
  assert.deepEqual(values, []);
  assert.deepEqual(errors, ['revision conflict']);
  assert.equal(writes, 1);
  assert.equal(scope.writing, false);
});

test('automatic scope reads pause after transport failure and manual retry retains one-shot writes', async () => {
  const scope = client.createRequestScope(), errors = [], seen = [];
  let reads = 0, writes = 0;
  const read = async () => { reads++; throw new Error('transport failure for /dsh-safe-auto/settings.get: HTTP 503'); };
  await scope.run(read, { error: error => errors.push(error.message) }, false, true);
  for (let index = 0; index < 100; index++) assert.equal(await scope.run(read, { error: error => errors.push(error.message) }, false, true), false);
  assert.equal(reads, 1); assert.equal(errors.length, 1);
  await scope.run(async () => { reads++; return 'recovered'; }, { value: value => seen.push(value) });
  await scope.run(async () => { writes++; throw new Error('transport failure for /dsh-safe-auto/settings.save: HTTP 503'); }, {}, true);
  assert.deepEqual(seen, ['recovered']); assert.equal(reads, 2); assert.equal(writes, 1);
  scope.dispose();
});

test('reconnected scope ignores an old read rejection and preserves recovered state', async () => {
  const scope = client.createRequestScope(), seen = [], errors = [];
  let rejectOld;
  const old = scope.run(() => new Promise((_, reject) => { rejectOld = reject; }), { error: error => errors.push(error.message) }, false, true);
  scope.invalidate();
  await scope.run(async () => 'recovered', { value: value => seen.push(value) }, false, true);
  rejectOld(new Error('transport failure for /dsh-safe-auto/session.get: HTTP 404')); await old;
  await scope.run(async () => 'still readable', { value: value => seen.push(value) }, false, true);
  assert.deepEqual(seen, ['recovered', 'still readable']); assert.deepEqual(errors, []);
  scope.dispose();
});

const approval = (extra = {}) => ({ id: 'approval-1', action: { tool: 'bash', cwd: '/workspace',
  arguments: { command: 'printf "<script>exact & complete</script>"\nnext command', workdir: '/workspace/subdir', sandbox_permissions: 'require_escalated', justification: 'Need <access>' },
  permission: { from: 'workspace-write', to: 'danger-full-access', scope: 'this-call-only' } },
  review: { code: 'denied', risk: 'high', authorization: 'insufficient', reason: '<b>Review opinion</b>' }, expiresAt: 61000, remainingMs: 60000, ...extra });

test('confirmation displays full escaped native command, cwd, permission and model opinion in both languages', () => {
  const request = approval();
  for (const locale of ['en', 'zh-CN']) {
    const html = render(client.ApprovalDialog, { request, remainingMs: 59001, pendingCount: 2, locale, onAnswer() {} });
    assert.match(html, /role="dialog" aria-modal="true"/);
    assert.match(html, /data-modal-autofocus="true"/);
    assert.match(html, /printf &quot;&lt;script&gt;exact &amp; complete&lt;\/script&gt;&quot;\nnext command/);
    assert.match(html, /\/workspace\/subdir/);
    assert.match(html, /this-call-only/);
    assert.match(html, /require_escalated/);
    assert.match(html, /&lt;b&gt;Review opinion&lt;\/b&gt;/);
    assert.doesNotMatch(html, /<script>|<b>Review opinion/);
    assert.doesNotMatch(html, /disabled=""/);
    assert.match(html, locale === 'en' ? /2 pending confirmations/ : /2 个请求待确认/);
    assert.match(html, locale === 'en' ? /Allow this call only/ : /仅允许这一次/);
    assert.match(html, locale === 'en' ? /60 seconds left/ : /剩余 60 秒/);
  }
});

test('write and edit confirmation preserves complete content, replacement fields and false flags', () => {
  const full = `${'many lines\n'.repeat(500)}<end marker>`;
  for (const tool of ['write', 'edit']) {
    const html = render(client.ApprovalDialog, { request: approval({ action: { tool, cwd: 'H:\\workspace',
      arguments: { file_path: 'file.txt', content: full, old_string: '<old>', new_string: full, replace_all: false },
      permission: { from: 'read-only', to: 'workspace-write', scope: 'this-call-only' } } }), remainingMs: 1, onAnswer() {} });
    assert.match(html, /&lt;end marker&gt;/);
    assert.match(html, /&lt;old&gt;/);
    assert.match(html, />false<\/pre>/);
    assert.equal((html.match(/many lines\n/g) || []).length, 1000);
  }
});

test('expired and submitting confirmations disable both decision buttons', () => {
  for (const props of [{ remainingMs: 0 }, { remainingMs: 1, busy: true }]) {
    const html = render(client.ApprovalDialog, { request: approval(), onAnswer() {}, ...props });
    assert.equal((html.match(/disabled=""/g) || []).length, 2);
  }
  assert.equal(render(client.ApprovalDialog, { request: null }), '');
});

function approvalHarness(api) {
  let clock = 0;
  const states = [], timers = new Map(); let nextTimer = 0;
  const controller = client.createApprovalController({ api, sessionId: 'session-A',
    now: () => clock, onState: state => states.push(state),
    schedule: fn => { const id = ++nextTimer; timers.set(id, fn); return id; }, cancel: id => timers.delete(id) });
  return { controller, states, timers, advance: ms => { clock += ms; } };
}

test('approval polling pauses request and error dispatches, reconnects, and never replays answers', async () => {
  let reads = 0, writes = 0, failing = true;
  const harness = approvalHarness({ getApprovals: async () => {
    reads++; if (failing) throw new Error('transport failure for /dsh-safe-auto/approval.list: HTTP 503');
    return { requests: [approval()] };
  }, answerApproval: async () => { writes++; throw new Error('transport failure for /dsh-safe-auto/approval.answer: HTTP 503'); } });
  await harness.controller.refresh();
  const states = harness.states.length;
  for (let index = 0; index < 100; index++) await harness.controller.refresh();
  assert.equal(reads, 1); assert.equal(harness.states.length, states);
  failing = false; harness.controller.reconnect();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 2); assert.equal(harness.states.at(-1).error, '');
  await harness.controller.answer('approval-1', 'deny');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes, 1);
  harness.controller.dispose(); assert.equal(harness.timers.size, 0);
});

test('approval polling discovers new requests before one is pending and never overlaps or writes', async () => {
  const reads = [], waiting = deferred(); let calls = 0, writes = 0;
  const harness = approvalHarness({ getApprovals: sessionId => { reads.push(sessionId); return ++calls === 1 ? waiting.promise : Promise.resolve({ requests: [approval()] }); },
    answerApproval: () => { writes++; } });
  const first = harness.controller.refresh();
  assert.equal(await harness.controller.refresh(), false);
  waiting.resolve({ requests: [] }); await first;
  assert.equal(harness.states.at(-1).requests.length, 0);
  assert.equal(harness.timers.size, 1);
  const poll = [...harness.timers.values()][0]; poll();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.states.at(-1).requests[0].id, 'approval-1');
  assert.deepEqual(reads, ['session-A', 'session-A']);
  assert.equal(writes, 0);
  harness.controller.dispose(); assert.equal(harness.timers.size, 0);
});

test('server countdown subtracts network time, never extends a request and prevents expired answers', async () => {
  const waiting = deferred(); let reads = 0, writes = 0;
  const harness = approvalHarness({ getApprovals: () => ++reads === 1 ? waiting.promise : Promise.resolve({ requests: [approval()] }),
    answerApproval: () => { writes++; return { accepted: true }; } });
  const first = harness.controller.refresh(); harness.advance(2000); waiting.resolve({ requests: [approval()] }); await first;
  const request = harness.states.at(-1).requests[0];
  assert.equal(client.approvalRemaining(request, 2000), 58000);
  await harness.controller.refresh();
  assert.equal(harness.states.at(-1).requests[0].deadline, request.deadline);
  harness.advance(58000);
  assert.equal(await harness.controller.answer(request.id, 'allow'), false);
  assert.equal(writes, 0);
  await harness.controller.refresh();
  assert.deepEqual(harness.states.at(-1).requests, []);
  harness.controller.dispose();
});

test('answers are explicit, session-bound, single writes and reject stale competing responses', async () => {
  const writes = [], pendingWrite = deferred(), pendingRead = deferred(); let reads = 0;
  const harness = approvalHarness({ getApprovals: () => ++reads === 1 ? Promise.resolve({ requests: [approval()] }) : pendingRead.promise,
    answerApproval: payload => { writes.push(payload); return pendingWrite.promise; } });
  await harness.controller.refresh();
  const stale = harness.controller.refresh();
  const answer = harness.controller.answer('approval-1', 'deny');
  assert.equal(await harness.controller.answer('approval-1', 'allow'), false);
  pendingWrite.resolve({ accepted: true }); await answer;
  pendingRead.resolve({ requests: [approval()] }); await stale;
  assert.deepEqual(writes, [{ sessionId: 'session-A', requestId: 'approval-1', outcome: 'deny' }]);
  assert.deepEqual(harness.states.at(-1).requests, []);
  assert.equal(harness.states.at(-1).busy, false);
  harness.controller.dispose();
});

test('failed answers refresh without retrying writes and disposed sessions ignore late responses', async () => {
  let reads = 0, writes = 0;
  const refresh = deferred();
  const harness = approvalHarness({ getApprovals: () => ++reads === 1 ? Promise.resolve({ requests: [approval()] }) : refresh.promise,
    answerApproval: async () => { writes++; throw new Error('expired or answered elsewhere'); } });
  await harness.controller.refresh();
  await harness.controller.answer('approval-1', 'allow');
  assert.equal(writes, 1); assert.equal(reads, 2);
  assert.deepEqual(harness.states.at(-1).requests, []);
  assert.match(harness.states.at(-1).error, /answered elsewhere/);
  const count = harness.states.length;
  harness.controller.dispose(); refresh.resolve({ requests: [approval({ id: 'old-session' })] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.states.length, count); assert.equal(harness.timers.size, 0);
});
