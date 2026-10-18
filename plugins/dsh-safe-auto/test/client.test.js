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
  .replace("from '@klarkxy/dsh-plugin-kit/client-utils'", `from '${resolve('@klarkxy/dsh-plugin-kit/client-utils')}'`)
  .replace("from '@klarkxy/dsh-plugin-kit/model-settings-client'", `from '${resolve('@klarkxy/dsh-plugin-kit/model-settings-client')}'`)).toString('base64')}`);
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const values = { provider: 'retired', model: 'legacy', reasoningEffort: 'unlisted', reviewerPrompt: '' };
const catalog = { groups: [{ id: 'provider', name: 'Provider', models: [{ id: 'reasoner', name: 'Reasoner', reasoning: { efforts: [{ id: 'medium', name: 'Medium' }] } }, { id: 'plain', name: 'Plain' }] }] };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const snapshot = (extra = {}) => ({ revision: '1:0', current: 'workspace-write', safeAuto: false, available: true, platform: 'win32',
  options: [{ value: 'read-only', name: 'read-only' }, { value: 'workspace-write', name: 'workspace-write' },
    { value: 'danger-full-access', name: 'danger-full-access' }, { value: 'safe-auto', name: 'Safe Auto' }], ...extra });

test('exact slot registrations use injection, replacement priority and bundle key; registration does not write', () => {
  const waiting = [], registered = [], calls = [], dependencies = [];
  client.apply({ slots: { inject: (name, fn) => waiting.push([name, fn]), register: (options, component) => registered.push({ options, component }) }, connection: { rpc: { call: (...args) => { calls.push(args); return Promise.resolve({ ok: true, value: {} }); } } }, remote: { session: { modelCatalog: () => catalog } }, inject: (names, callback) => { dependencies.push(names); callback({ remote: { $mount: async () => async () => {} }, effect: () => {} }); } });
  assert.deepEqual(client.inject, ['slots', 'connection', 'remote', 'remote.session', 'locale']);
  assert.deepEqual(dependencies, [['remote']]);
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
  const policyLimits = { timeoutMs: 90000, outputTokens: 4096, maxTranscriptBytes: 48000 };
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

test('the safety tab explains scope, reviewer input and the circuit breaker', () => {
  const props = { view: 'page', api: {}, initialSettings: { revision: 1, values }, initialCatalog: catalog, locale: zhLocale };
  const closed = render(client.SettingsPanel, props);
  assert.match(closed, /安全说明/);
  assert.match(closed, /id="[^"]*-details-panel" aria-labelledby="[^"]*-details-tab" hidden=""/, 'the safety panel stays hidden until its tab is selected');
  const open = render(client.SettingsPanel, { ...props, initialTab: 'details' });
  assert.match(open, /id="[^"]*-details-panel" aria-labelledby="[^"]*-details-tab" tabindex="0"/);
  assert.match(open, /普通调用照常在工作区沙箱内运行，插件不拦截/);
  assert.match(open, /发给审核模型的内容：对话记录/);
  assert.match(open, /连续拒绝 3 次，或最近 50 次审核拒绝 10 次/);
  const en = render(client.SettingsPanel, { ...props, locale: undefined, initialTab: 'details' });
  assert.match(en, /Ordinary calls run inside the workspace sandbox as usual/);
  assert.match(en, /Sent to the reviewer: the conversation/);
  assert.match(en, /After 3 consecutive denials/);
  // The retired timed human confirmation is gone from the client.
  assert.doesNotMatch(source, /60 秒|ApprovalDialog|approval\.list|approval\.answer/);
});

test('the limits tab shows one line built from the reported limits', () => {
  const policyLimits = { timeoutMs: 90000, outputTokens: 4096, maxTranscriptBytes: 48000 };
  const html = render(client.SettingsPanel, { view: 'page', api: {}, initialSettings: { revision: 'r', values, policyLimits }, initialCatalog: catalog, initialTab: 'limits' });
  assert.match(html, /Review timeout 90 s · Output cap 4096 tokens · Transcript cap 48000 bytes/);
  assert.match(html, /configured in the profile/);
  assert.doesNotMatch(source, /limitsFuses/);
  const zh = render(client.SettingsPanel, { view: 'page', api: {}, initialSettings: { revision: 'r', values, policyLimits }, initialCatalog: catalog, initialTab: 'limits', locale: zhLocale });
  assert.match(zh, /单次审核超时 90 秒 · 输出上限 4096 tokens · 对话记录上限 48000 bytes/);
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
  assert.match(summary, /a reviewer model answers approval requests/);
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
