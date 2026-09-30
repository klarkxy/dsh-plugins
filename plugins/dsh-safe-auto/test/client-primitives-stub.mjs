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

/** The header row always renders; its content follows the controlled `open`. */
export function DisclosureRow({ icon, title, open, expandable, expandOnRowClick, onToggle, children, className }) {
  return h('div', { className, role: expandOnRowClick ? 'button' : undefined, tabIndex: expandOnRowClick ? 0 : undefined, 'aria-expanded': expandOnRowClick ? open : undefined },
    h('span', null, icon),
    h('span', null, title),
    expandable && !expandOnRowClick ? h('button', { type: 'button', 'aria-expanded': open, onClick: onToggle }, icon) : null,
    open ? children : null);
}

export function Switch({ checked, onChange, label, disabled, className }) {
  return h('button', { type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label, disabled, className, onClick: () => onChange(!checked) });
}

export function IconShieldOutlineRegular(props) {
  return h('svg', { ...props, 'aria-hidden': 'true' });
}
