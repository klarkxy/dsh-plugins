/**
 * Stand-in for `@klarkxy/dsh-model-route/ui` in the Node SSR tests. The real
 * entry statically imports the host ui-primitives browser bundle, which Node
 * cannot load here (see client-primitives-stub.mjs). This double surfaces the
 * props ReviewerFields computes — choices, selection, effort rows and the
 * leading modes — so the SSR assertions cover the plugin's own wiring; the
 * component's own rendering is covered by dsh-model-route's ui.spec and the
 * host browser.
 */
import React from 'react';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Exercise the real shared catalog hook/status while keeping the model menu
// focused on this consumer's props. Transpile in-process for the Node harness.
const catalogSource = await readFile(new URL('../../dsh-model-route/src/catalog-ui.tsx', import.meta.url), 'utf8');
const catalogCode = ts.transpileModule(catalogSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  .replaceAll('"react"', JSON.stringify(import.meta.resolve('react')))
  .replaceAll("'react'", JSON.stringify(import.meta.resolve('react')))
  .replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve('react/jsx-runtime')))
  .replaceAll("'@deepseek-ai/dsh-client-ui-primitives'", JSON.stringify(new URL('./client-primitives-stub.mjs', import.meta.url).href))
  .replaceAll("'./catalog.ts'", JSON.stringify(import.meta.resolve('@klarkxy/dsh-model-route')));
export const { useModelCatalog, ModelCatalogStatus } = await import(`data:text/javascript;base64,${Buffer.from(catalogCode).toString('base64')}`);

const h = React.createElement;
export const modelMenuCss = '';

export function ModelMenu({ anchor, choices = [], selected, leading = [], efforts = [], selectedEffort, onPick, onPickLeading }) {
  return h('span', { className: 'dsh-model-menu-stub' },
    anchor,
    h('span', { className: 'stub-choices' }, choices.map(choice => `${choice.provider}/${choice.model}`).join(' ')),
    h('span', { className: 'stub-efforts', 'data-selected': selectedEffort || '' }, efforts.map(item => item.name).join(' ')),
    leading.map(item => h('button', { key: item.id, type: 'button', role: 'menuitemradio',
      'aria-checked': item.selected === true, onClick: () => onPickLeading?.(item.id) }, item.label)),
    choices.map(choice => h('button', { key: `${choice.provider}/${choice.model}`, type: 'button', role: 'menuitemradio',
      'aria-checked': selected?.provider === choice.provider && selected?.model === choice.model,
      onClick: () => onPick?.({ provider: choice.provider, model: choice.model }) }, choice.label)));
}
