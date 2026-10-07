/**
 * Stand-in for `@deepseek-ai/dsh-client-ui-primitives` in the Node SSR tests.
 *
 * The real package is a browser bundle: its entry imports every `*.module.css`
 * file and pulls in the host's own shiki/katex/markdown dependencies, none of
 * which are installed here, so `node --test` cannot load it. These stand-ins
 * render the same host elements with the same attribute order, which is all
 * the SSR assertions in this directory are about — the plugin's own markup,
 * copy and control state. Styling lives in the real CSS modules in the browser
 * bundle and in the shared contract stylesheet these tests also read.
 */
import React from 'react';

const h = React.createElement;

/** A native button, in the order the primitives emit their own props. */
export function Button({ variant, size, icon, className, children, ...rest }) {
  return h('button', { type: 'button', className, ...rest }, icon, children);
}

export function Tag({ tone, className, children }) {
  return h('span', { className }, children);
}

/** Controlled tablist: one button per tab with roving selection; panels are
 * the plugin's own markup, linked by id/aria-controls. */
export function SegmentedTabs({ items, value, onChange, label, className }) {
  return h('div', { role: 'tablist', 'aria-label': label, className },
    items.map(item => h('button', { key: item.value, type: 'button', role: 'tab', id: item.id,
      'aria-controls': item.panelId, 'aria-selected': item.value === value,
      tabIndex: item.value === value ? 0 : -1, onClick: () => onChange(item.value) }, item.label)));
}

export function Switch({ checked, onChange, label, disabled, className }) {
  return h('button', { type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label, disabled, className, onClick: () => onChange(!checked) });
}

/** Anchored dropdown: the anchor always renders; rows render only while open. */
export function Menu({ open, anchor, items = [], selectedId, onSelect, children, listClassName }) {
  return h('span', { className: listClassName }, anchor,
    open ? h('div', { role: 'menu' }, items.map(item => item.type ? null :
      h('button', { key: item.id, type: 'button', role: 'menuitem', disabled: item.disabled,
        'aria-checked': selectedId === item.id, onClick: () => onSelect?.(item.id) }, item.icon, item.label))) : null,
    children);
}

export function MenuItemButton({ children, disabled, onSelect }) {
  return h('button', { type: 'button', role: 'menuitem', disabled, onClick: onSelect }, children);
}

/** SSR records modal content and control state; real portals, focus trapping,
 * Escape and backdrop dismissal are exercised by the host browser tests. */
export function Modal({ open, title, closeLabel, onClose, footer, className, contentClassName, children }) {
  return open ? h('section', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, className },
    h('button', { type: 'button', 'aria-label': closeLabel, onClick: onClose }, closeLabel),
    h('div', { className: contentClassName }, children), footer) : null;
}

export function IconShieldOutlineRegular(props) {
  return h('svg', { ...props, 'aria-hidden': 'true' });
}
export function IconChevronUpOutlineRegular(props) {
  return h('svg', { ...props, 'aria-hidden': 'true' });
}
export function IconChevronDownOutlineRegular(props) {
  return h('svg', { ...props, 'aria-hidden': 'true' });
}
export function PermissionIconReadOnlyRegular(props) {
  return h('svg', { ...props, 'aria-hidden': 'true' });
}
export function PermissionIconWorkspaceWriteRegular(props) {
  return h('svg', { ...props, 'aria-hidden': 'true' });
}
export function PermissionIconFullAccessRegular(props) {
  return h('svg', { ...props, 'aria-hidden': 'true' });
}
