import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Node does not load .jsx natively. This file uses plain createElement syntax:
// resolve its sole import and load the exact source, without a build or loader.
const source = await readFile(new URL('../src/client.jsx', import.meta.url), 'utf8');
const client = await import(`data:text/javascript;base64,${Buffer.from(source.replace("from 'react'", `from '${import.meta.resolve('react')}'`)).toString('base64')}`);
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const values = { fastProvider: '', fastModel: '', deepProvider: 'retired', deepModel: 'legacy', fastReasoningEffort: '', deepReasoningEffort: 'unlisted', reviewerPrompt: '' };
const catalog = { groups: [{ id: 'provider', name: 'Provider', models: [{ id: 'reasoner', name: 'Reasoner', reasoning: { efforts: [{ id: 'medium', name: 'Medium' }] } }, { id: 'plain', name: 'Plain' }] }] };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('exact slot registrations use injection, replacement rank and bundle key; activation does not write', () => {
  const waiting = [], registered = [], calls = [];
  client.apply({ slots: { inject: (name, fn) => waiting.push([name, fn]), register: (options, component) => registered.push({ options, component }) }, connection: { rpc: { call: (...args) => { calls.push(args); return Promise.resolve({ ok: true, value: {} }); } } }, remote: { session: { modelCatalog: () => catalog } } });
  assert.deepEqual(client.inject, ['slots', 'connection', 'remote', 'locale']);
  assert.deepEqual(waiting.map(([name]) => name), ['conversation.input.permission', 'plugins.bundle.config']);
  assert.equal(registered.length, 0);
  waiting.forEach(([, fn]) => fn());
  assert.equal(registered[0].options.priority, -10);
  assert.equal(registered[1].options.key, '@klarkxy/dsh-safe-auto');
  assert.equal(registered[0].component, client.PermissionMenu);
  assert.equal(registered[1].component, client.SettingsPanel);
  assert.deepEqual(calls, []);
  assert.deepEqual(Object.keys(registered[0].options.inject()), ['api']);
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

test('explicit model selection clears only corresponding effort and retains all other configuration', () => {
  const next = client.selectModel(values, 'deep', { provider: 'provider', model: 'reasoner' });
  assert.equal(next.deepReasoningEffort, '');
  assert.equal(next.deepModel, 'reasoner');
  assert.equal(next.fastProvider, values.fastProvider);
  assert.equal(values.deepReasoningEffort, 'unlisted');
});

test('permission SSR preserves native and custom names, selection and lock', () => {
  const options = ['read-only', 'workspace-write', 'danger-full-access', 'custom', 'safe-auto'].map(value => ({ value, name: `Host ${value}`, description: 'Host explanation' }));
  const html = render(client.PermissionMenu, { sessionId: 's', locked: true, api: {}, initialSnapshot: { revision: 2, current: 'custom', available: true, options } });
  for (const name of ['Host read-only', 'Host workspace-write', 'Host danger-full-access', 'Host custom', '安全自动 / Safe Auto']) assert.ok(html.includes(name));
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /Permissions locked/);
  assert.ok(!html.includes('Host safe-auto'));
});

test('unavailable Safe Auto keeps native exit selectable and unknown custom permission visible', () => {
  const html = render(client.PermissionMenu, { sessionId: 's', locked: false, api: {}, initialSnapshot: { revision: 1, current: 'unknown-custom', available: false, options: [{ value: 'read-only', name: 'Original read only' }, { value: 'safe-auto', name: 'Safe Auto' }] } });
  assert.match(html, /unknown-custom/);
  assert.match(html, /display only/);
  assert.match(html, /<button type="button" aria-pressed="false">Original read only/);
  assert.match(html, /<button type="button" disabled="" aria-pressed="false">安全自动/);
});

test('settings SSR provides prompt limits, output budget warning and unknown saved values', () => {
  const html = render(client.SettingsPanel, { view: 'page', api: {}, initialSettings: { revision: 'r', values, http: false }, initialCatalog: catalog });
  assert.match(html, /额外审核提示词/);
  assert.match(html, /maxLength="4096"/i);
  assert.match(html, /never expand authorization/);
  assert.match(html, /fastOutputTokens/);
  assert.match(html, /deepOutputTokens/);
  assert.match(html, /retired \/ legacy/);
  assert.match(html, /unlisted/);
  assert.match(html, /--dsw-alias-label-primary/);
});

test('follow-conversation effort is not selectable and saved nondefault effort is warned', () => {
  const html = render(client.ModelFields, { stage: 'fast', values: { ...values, fastReasoningEffort: 'high' }, catalog, onChange() {} });
  assert.equal((html.match(/<select/g) || []).length, 1);
  assert.match(html, /high/);
  assert.match(html, /Saved effort retained/);
});

test('HTTP settings SSR is read-only and summary contains no editing form', () => {
  const props = { api: {}, initialSettings: { revision: 'r', values, http: true }, initialCatalog: catalog };
  const html = render(client.SettingsPanel, { ...props, view: 'page' });
  assert.match(html, /HTTP mode: read-only/);
  assert.equal((html.match(/<fieldset disabled=""/g) || []).length, 2);
  assert.match(html, /<textarea[^>]*disabled=""/);
  const summary = render(client.SettingsPanel, { ...props, view: 'summary' });
  assert.ok(!summary.includes('<select'));
  assert.ok(!summary.includes('<textarea'));
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
