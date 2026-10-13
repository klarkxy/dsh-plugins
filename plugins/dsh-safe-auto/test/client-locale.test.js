import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { JSDOM } from 'jsdom';

const source = await readFile(new URL('../src/client.jsx', import.meta.url), 'utf8');
const replacements = {
  react: import.meta.resolve('react'),
  '@deepseek-ai/dsh-client-ui-primitives': new URL('./client-primitives-stub.mjs', import.meta.url).href,
  '@klarkxy/dsh-model-route/ui': new URL('./model-menu-stub.mjs', import.meta.url).href,
  ...Object.fromEntries(['@klarkxy/dsh-model-route', '@klarkxy/dsh-plugin-kit/official-ui', '@klarkxy/dsh-plugin-kit/client-utils', '@klarkxy/dsh-plugin-kit/model-settings-client'].map(name => [name, import.meta.resolve(name)])),
};
const transformed = Object.entries(replacements).reduce((text, [name, url]) => text.replace(`from '${name}'`, `from '${url}'`), source);
const { SettingsPanel, PermissionMenu, ApprovalDialog, translator, errorText } = await import(`data:text/javascript;base64,${Buffer.from(transformed).toString('base64')}`);

async function mount(run) {
  const dom = new JSDOM('<div id="root"></div>'), previous = new Map(), listeners = new Set();
  let active = 'en';
  const locale = { getSnapshot: () => ({ active }), subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } };
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, globalThis[key]); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const root = createRoot(dom.window.document.getElementById('root'));
  try { await run(dom, root, locale, async next => { await act(async () => { active = next; for (const listener of [...listeners]) listener(); }); }); }
  finally { await act(async () => root.unmount()); dom.window.close(); for (const [key, value] of previous) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); }
  assert.equal(listeners.size, 0);
}
const button = (dom, label) => [...dom.window.document.querySelectorAll('button')].find(item => item.textContent === label);

test('Safe Auto keeps a reviewer draft and translates an existing save failure on live locale changes', async () => {
  await mount(async (dom, root, locale, switchLocale) => {
    let reads = 0, saves = 0;
    const api = {
      getSettings: async () => { reads++; return { revision: 1, values: { reviewerPrompt: 'Original', provider: '', model: '', reasoningEffort: '' } }; },
      saveSettings: async () => { saves++; throw new Error('Settings changed; reload and retry'); },
      modelCatalog: async () => ({ groups: [] }),
    };
    await act(async () => root.render(React.createElement(SettingsPanel, { api, locale })));
    const textarea = dom.window.document.querySelector('textarea');
    await act(async () => Simulate.change(textarea, { target: { value: '用户自己的 draft' } }));
    await act(async () => button(dom, 'Save').click());
    assert.match(dom.window.document.querySelector('[role="alert"]').textContent, /Draft retained/);
    await switchLocale('zh');
    assert.equal(textarea.value, '用户自己的 draft');
    assert.match(dom.window.document.querySelector('[role="alert"]').textContent, /配置已更新.*草稿已保留/);
    assert.doesNotMatch(dom.window.document.body.textContent, /Draft retained|Settings changed/);
    assert.equal(dom.window.document.querySelector('[role="tablist"]').getAttribute('aria-label'), '设置分区');
    assert.equal(reads, 1); assert.equal(saves, 1);
    await switchLocale('en');
    assert.match(dom.window.document.querySelector('[role="alert"]').textContent, /Settings changed.*Draft retained/);
    assert.equal(textarea.value, '用户自己的 draft');
  });
});

test('Safe Auto permission menu and approval dialog follow host locale without changing request data', async () => {
  await mount(async (dom, root, locale, switchLocale) => {
    let reads = 0;
    const snapshot = { current: 'workspace-write', available: true, revision: '1', safeAuto: false, options: [
      { value: 'read-only', name: 'server Read' }, { value: 'workspace-write', name: 'server Write' }, { value: 'safe-auto', name: 'server Safe' },
    ] };
    const api = { getSession: async () => { reads++; return snapshot; } };
    const request = { id: 'request-id', action: { tool: 'bash', cwd: '/user/path', arguments: { command: 'echo 用户内容' } }, review: { opinion: '模型原文' } };
    const answer = () => { throw new Error('locale must not answer approvals'); };
    await act(async () => root.render(React.createElement(React.Fragment, null,
      React.createElement(PermissionMenu, { sessionId: 's', api, locale }),
      React.createElement(ApprovalDialog, { request, locale, remainingMs: 1000, onAnswer: answer, error: 'Confirmation is no longer available' }))));
    await act(async () => dom.window.document.querySelector('[aria-haspopup="menu"]').click());
    const before = reads;
    assert.match(dom.window.document.body.textContent, /Read Only|Allow this call only/);
    await switchLocale('zh');
    assert.equal(reads, before);
    assert.equal(dom.window.document.querySelector('[role="dialog"]').getAttribute('aria-label'), '确认这一次调用');
    assert.match(dom.window.document.body.textContent, /仅可查看|仅允许这一次|确认已不可用/);
    assert.match(dom.window.document.body.textContent, /echo 用户内容|模型原文/);
    assert.doesNotMatch(dom.window.document.body.textContent, /Confirmation is no longer available|Allow this call only/);
  });
});

test('Safe Auto local fallback/config errors translate, external diagnostics remain verbatim', () => {
  for (const message of ['Request failed', 'Invalid approval response', 'invalid reviewer provider/model identifier', 'provider and model must be configured together', 'reviewerPrompt must be a string', 'Approval expired or invalidated']) {
    assert.match(errorText(translator('zh'), message), /[\u4e00-\u9fff]/);
    assert.doesNotMatch(errorText(translator('en'), message), /[\u4e00-\u9fff]/);
  }
  assert.equal(errorText(translator('zh'), 'Provider diagnostic 原文'), 'Provider diagnostic 原文');
});
