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
const { SettingsPanel } = await import(`data:text/javascript;base64,${Buffer.from(transformed).toString('base64')}`);
const settings = (revision, model = 'a', effort = 'low') => ({ revision, values: { provider: 'p', model, reasoningEffort: effort, reviewerPrompt: 'Saved' } });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function mount(run) {
  const dom = new JSDOM('<div id="root"></div>'); const previous = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })) { previous.set(key, globalThis[key]); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); }
  const root = createRoot(dom.window.document.getElementById('root')); let change = () => {}, error = () => {};
  const subscribeSettings = (listener, failed) => { change = listener; error = failed; return () => { change = () => {}; error = () => {}; }; };
  try { await run(dom, async api => { await act(async () => root.render(React.createElement(SettingsPanel, { api: { ...api, subscribeSettings }, locale: { getSnapshot: () => ({ active: 'en' }), subscribe: () => () => {} } }))); }, async () => { await act(async () => change()); }, async () => { await act(async () => error('Unavailable')); }); }
  finally { await act(async () => root.unmount()); dom.window.close(); for (const [key, value] of previous) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); }
}
const button = (dom, label) => [...dom.window.document.querySelectorAll('button')].find(item => item.textContent === label);
test('Safe Auto clean refresh preserves model/effort, dirty refresh preserves prompt and blocks save until discard', async () => {
  let current = settings(1), reads = 0, saves = 0;
  const api = { getSettings: async () => { reads++; return current; }, saveSettings: async () => { saves++; return current; }, modelCatalog: async () => ({ groups: [] }) };
  await mount(async (dom, render, notify, fail) => {
    await render(api); current = settings(2, 'b', 'high'); await notify();
    assert.match(dom.window.document.body.textContent, /p \/ b/); assert.match(dom.window.document.body.textContent, /high/);
    const textarea = dom.window.document.querySelector('textarea');
    await act(async () => Simulate.change(textarea, { target: { value: 'My draft' } }));
    current = settings(3, 'c'); await notify(); assert.equal(textarea.value, 'My draft'); assert.equal(reads, 2);
    assert.match(dom.window.document.body.textContent, /Draft preserved/); assert.equal(button(dom, 'Save').disabled, true);
    await act(async () => button(dom, 'Refresh (discard draft)').click());
    assert.equal(textarea.value, 'Saved'); assert.match(dom.window.document.body.textContent, /p \/ c/); assert.equal(saves, 0);
    await fail(); assert.match(dom.window.document.body.textContent, /Automatic refresh unavailable/);
  });
});
test('Safe Auto queues one latest read during save and fences old API errors', async () => {
  const save = deferred(); let reads = 0, current = settings(1);
  const api = { getSettings: async () => { reads++; return current; }, saveSettings: () => save.promise, modelCatalog: async () => ({ groups: [] }) };
  await mount(async (dom, render, notify) => {
    await render(api); const textarea = dom.window.document.querySelector('textarea');
    await act(async () => Simulate.change(textarea, { target: { value: 'Edit' } }));
    await act(async () => button(dom, 'Save').click()); current = settings(3, 'b', 'high'); await notify(); await notify(); assert.equal(reads, 1);
    await act(async () => save.resolve(settings(2))); assert.equal(reads, 2); assert.match(dom.window.document.body.textContent, /p \/ b/);
    const old = deferred(); await render({ ...api, getSettings: () => old.promise });
    await render({ ...api, getSettings: async () => settings(9, 'current') });
    await act(async () => old.reject(new Error('Old failure'))); assert.doesNotMatch(dom.window.document.body.textContent, /Old failure/); assert.match(dom.window.document.body.textContent, /p \/ current/);
  });
});
test('Safe Auto coalesces invalidations during initial read', async () => {
  const first = deferred(); let reads = 0;
  await mount(async (dom, render, notify) => {
    await render({ getSettings: () => ++reads === 1 ? first.promise : Promise.resolve(settings(2, 'b', 'high')), modelCatalog: async () => ({ groups: [] }) });
    await notify(); await notify(); assert.equal(reads, 1);
    await act(async () => first.resolve(settings(1))); assert.equal(reads, 2); assert.match(dom.window.document.body.textContent, /p \/ b/);
  });
});
