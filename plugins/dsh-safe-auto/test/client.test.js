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
  .replace("from '@klarkxy/dsh-plugin-kit/official-ui'", `from '${resolve('@klarkxy/dsh-plugin-kit/official-ui')}'`)).toString('base64')}`);
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const values = { provider: 'retired', model: 'legacy', reasoningEffort: 'unlisted', reviewerPrompt: '' };
const catalog = { groups: [{ id: 'provider', name: 'Provider', models: [{ id: 'reasoner', name: 'Reasoner', reasoning: { efforts: [{ id: 'medium', name: 'Medium' }] } }, { id: 'plain', name: 'Plain' }] }] };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('exact slot registrations use injection and bundle key; activation does not write', () => {
  const waiting = [], registered = [], calls = [];
  client.apply({ slots: { inject: (name, fn) => waiting.push([name, fn]), register: (options, component) => registered.push({ options, component }) }, connection: { rpc: { call: (...args) => { calls.push(args); return Promise.resolve({ ok: true, value: {} }); } } }, remote: { session: { modelCatalog: () => catalog } } });
  assert.deepEqual(client.inject, ['slots', 'connection', 'remote', 'locale']);
  assert.deepEqual(waiting.map(([name]) => name), ['plugins.bundle.config']);
  assert.equal(registered.length, 0);
  waiting.forEach(([, fn]) => fn());
  assert.equal(registered[0].options.key, '@klarkxy/dsh-safe-auto');
  assert.equal(registered[0].component, client.SettingsPanel);
  assert.deepEqual(calls, []);
  assert.deepEqual(Object.keys(registered[0].options.inject()), ['api', 'locale']);
});

test('RPC envelope uses exact channel, rejects errors and preserves values', async () => {
  const calls = [];
  const value = await client.unwrapRpc(async (...args) => { calls.push(args); return { ok: true, value: { revision: 3 } }; }, 'settings.get', {});
  assert.deepEqual(calls, [['/dsh-safe-auto', 'settings.get', {}]]);
  assert.deepEqual(value, { revision: 3 });
  await assert.rejects(client.unwrapRpc(async () => ({ ok: false, error: { message: 'conflict' } }), 'settings.save', {}), /conflict/);
});

test('catalog follows exact provider/model/effort ids and retains absent saved models', () => {
  const choices = client.modelChoices(catalog, 'retired', 'legacy');
  assert.equal(choices[0].model, '');
  assert.equal(choices[1].provider, 'provider');
  assert.deepEqual(choices[1].efforts, [{ id: 'medium', name: 'Medium' }]);
  assert.deepEqual(choices[2].efforts, []);
  assert.equal(choices.at(-1).unknown, true);
  assert.equal(choices.at(-1).model, 'legacy');
  assert.equal(client.modelKey('a:b', 'c'), client.modelKey('a:b', 'c'));
  assert.notEqual(client.modelKey('a:b', 'c'), client.modelKey('a', 'b:c'));
});

test('explicit model selection clears the effort and retains the prompt', () => {
  const next = client.selectModel({ ...values, reviewerPrompt: 'keep me' }, { provider: 'provider', model: 'reasoner' });
  assert.equal(next.reasoningEffort, '');
  assert.equal(next.model, 'reasoner');
  assert.equal(next.reviewerPrompt, 'keep me');
  assert.equal(values.reasoningEffort, 'unlisted');
});

const zhLocale = { getSnapshot: () => ({ active: 'zh-CN' }), subscribe: () => () => {} };

test('settings SSR provides prompt limits and retains unknown saved values', () => {
  const html = render(client.SettingsPanel, { view: 'page', api: {}, initialSettings: { revision: 'r', values }, initialCatalog: catalog });
  assert.match(html, /Additional reviewer prompt/);
  assert.match(html, /maxLength="4096"/i);
  assert.match(html, /never expand authorization/);
  assert.match(html, /retired \/ legacy/);
  assert.match(html, /unlisted/);
  assert.match(html, /--dsw-alias-label-primary/);
  assert.match(html, /Safety notes/);
});

test('copy renders in one language chosen from the host locale', () => {
  const props = { view: 'page', api: {}, initialSettings: { revision: 1, values, http: false }, initialCatalog: catalog };
  const en = render(client.SettingsPanel, props);
  const zh = render(client.SettingsPanel, { ...props, locale: zhLocale });
  assert.match(en, /Reviewer model/);
  assert.doesNotMatch(en, /审核模型/);
  assert.match(zh, /审核模型/);
  assert.doesNotMatch(zh, /Reviewer model/);
  assert.doesNotMatch(zh, / \/ [A-Z][a-z]+ /, 'no "中文 / English" pairs');
});

test('prompt counter describes the textarea', () => {
  const html = render(client.SettingsPanel, { view: 'page', api: {}, initialSettings: { revision: 1, values }, initialCatalog: catalog });
  assert.match(html, /<textarea[^>]*aria-describedby="sa-prompt-hint"/);
  assert.match(html, /id="sa-prompt-hint"[^>]*>0\/4096/);
});

test('session controls follow the save action and show a short session label', () => {
  const html = render(client.SettingsPanel, { view: 'page', api: {}, initialSettings: { revision: 1, values }, initialCatalog: catalog });
  assert.match(html, /Approve for me/);
  assert.match(html, /no standing permission grant/i);
  assert.ok(html.indexOf('>Save<') < html.indexOf('Approve for me'), 'session controls come after Save');
  const session = { sessionId: 'root-0123456789abcdef', header: { cwd: 'D:\\work\\project' }, revision: '1:1', current: 'workspace-write', available: true, safeAuto: true };
  assert.equal(client.sessionLabel(session), 'project · root-012 · enabled');
  assert.equal(client.sessionLabel(session, client.translator('zh')), 'project · root-012 · 已启用');
  const controls = render(client.SessionControls, { api: {}, initialSessions: [session] });
  assert.match(controls, /Workspace Write \+ ask/);
  assert.match(controls, /Choose a live session/);
  assert.match(controls, /project · root-012/);
});

test('enable is blocked while settings have unsaved changes', () => {
  const rows = [{ sessionId: 'root', header: { cwd: '/p' }, revision: '1', current: 'workspace-write', available: true, safeAuto: false }];
  const clean = render(client.SessionControls, { api: {}, initialSessions: rows });
  const dirty = render(client.SessionControls, { api: {}, initialSessions: rows, dirty: true });
  assert.doesNotMatch(clean, /unsaved changes/);
  assert.match(dirty, /unsaved changes/);
  assert.match(source, /disabled: !row \|\| !row\.available \|\| row\.safeAuto \|\| dirty/);
});

test('the fixed reject policy is stated in the collapsed safety notes, not a saved field', () => {
  const html = render(client.SettingsPanel, { view: 'page', api: {}, initialSettings: { revision: 1, values }, initialCatalog: catalog, locale: zhLocale });
  assert.match(html, /安全说明/);
  assert.doesNotMatch(html, /无法自动判断时/, 'details stay collapsed by default');
  assert.match(source, /无法自动判断时/);
  assert.match(source, /直接拒绝/);
  assert.doesNotMatch(source, /change\(\{[^\n]*(?:human|fallbackPolicy)/);
});

test('follow-conversation effort is not selectable and saved nondefault effort is warned', () => {
  const html = render(client.ReviewerFields, { values: { provider: '', model: '', reasoningEffort: 'high', reviewerPrompt: '' }, catalog, onChange() {} });
  assert.equal((html.match(/<select/g) || []).length, 1);
  assert.match(html, /high/);
  assert.match(html, /Saved effort .* retained/);
  assert.doesNotMatch(html, /clears the reasoning effort/, 'the clear-effort hint only applies to an explicit model');
});

test('an explicit reviewer model offers its advertised efforts and clears on switch', () => {
  const on = render(client.ReviewerFields, { values: { provider: 'provider', model: 'reasoner', reasoningEffort: '', reviewerPrompt: '' }, catalog, onChange() {} });
  assert.match(on, /Medium/);
  assert.match(on, /clears the reasoning effort/);
  const next = client.selectModel(values, client.modelChoices(catalog)[0]);
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
