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
