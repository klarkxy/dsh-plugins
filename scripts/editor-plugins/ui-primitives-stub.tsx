/**
 * Test double for `@deepseek-ai/dsh-client-ui-primitives`.
 *
 * The published entry is a Vite build input: it statically imports every
 * `*.module.css` plus `shiki`, `katex`, `simple-icons`, `clsx` and friends,
 * all of which are the *primitives'* own devDependencies and are deliberately
 * absent from a consumer's install. Node cannot import it, so any spec that
 * reaches a plugin's client half through the real module dies at load with
 * `ERR_MODULE_NOT_FOUND` before a single assertion runs.
 *
 * So the editor-plugin vitest config points that specifier here. This is a
 * double for the *components*, not for the plugin: each one renders the same
 * element with the same props and the same accessible name the real primitive
 * publishes, so a spec can still assert on what the plugin did — which variant
 * it chose, which tone, which role, which label. Anything a plugin starts
 * importing that is not listed here throws, so a gap surfaces as a loud failure
 * instead of a silently missing element.
 *
 * Visual styling is not the double's business: the real geometry lives in the
 * primitives' CSS modules and is verified against the built client bundles, not
 * here. What matters under test is structure, semantics and props.
 */
import * as React from 'react'
import * as ReactDOM from 'react-dom'

const h = React.createElement
const cx = (...parts: Array<string | undefined | false>) => parts.filter(Boolean).join(' ')

export type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'toolbar'

/** The real component forwards every native button attribute and its ref, and
 * carries the variant in a hashed CSS-module class rather than in an attribute —
 * so the double must not surface `variant` on the DOM either, or a spec
 * asserting that adapter-only props do not leak would see it. */
export const Button = React.forwardRef<HTMLButtonElement, {
  variant?: ButtonVariant
  size?: 'md' | 'sm'
  icon?: React.ReactNode
  className?: string
  children?: React.ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>>(function Button(
  { variant = 'ghost', size, icon, className, children, ...rest }, ref,
) {
  return h('button', {
    ...rest,
    ref,
    type: rest.type ?? 'button',
    className: cx('dsh-stub-button', `dsh-stub-button--${variant}`, size && `dsh-stub-button--${size}`, className),
  }, icon, children)
})

export type TagTone =
  | 'outline' | 'solid' | 'neutral' | 'quiet' | 'success' | 'info' | 'warning' | 'danger'

/** Read-only badge. The real one is a span carrying the tone. */
export function Tag({ tone = 'outline', className, children }: {
  tone?: TagTone
  className?: string
  children?: React.ReactNode
}) {
  return h('span', { className: cx('dsh-stub-tag', className), 'data-tone': tone }, children)
}

export function Checkbox({ checked, onChange, label, disabled, title, className }: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
  title?: string
  className?: string
}) {
  return h('label', { className: cx('dsh-stub-checkbox', className), title },
    h('input', {
      type: 'checkbox',
      checked,
      disabled,
      'aria-label': label,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.checked),
    }),
    label)
}

export function Switch({ checked, onChange, label, disabled, title, className }: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
  title?: string
  className?: string
}) {
  return h('button', {
    type: 'button',
    role: 'switch',
    'aria-checked': checked,
    'aria-label': label,
    disabled,
    title,
    className: cx('dsh-stub-switch', className),
    onClick: () => onChange(!checked),
  })
}

/** The real Input is a wrapper span around a native input; keep that shape. */
export function Input({ icon, className, ...rest }: {
  icon?: React.ReactNode
  className?: string
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return h('span', { className: cx('dsh-stub-input', className) },
    icon, h('input', { ...rest, className: 'dsh-stub-input__control' }))
}

export function Pill({ active, className, children, onClick, ...rest }: {
  active?: boolean
  className?: string
  children?: React.ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  if (!onClick) return h('span', { className: cx('dsh-stub-pill', className), 'data-active': active }, children)
  return h('button', {
    ...rest,
    type: 'button',
    className: cx('dsh-stub-pill', className),
    'data-active': active,
    onClick,
  }, children)
}

export interface SegmentedTab<Value extends string = string> {
  value: Value
  label: React.ReactNode
  id: string
  panelId: string
}

/** Controlled tablist. The real one owns a sliding indicator; the structure is
 * what a plugin's spec can meaningfully assert, so that is what this keeps. */
export function SegmentedTabs<Value extends string>({ items, value, onChange, label, className }: {
  items: readonly [SegmentedTab<Value>, ...SegmentedTab<Value>[]]
  value: Value
  onChange: (value: Value) => void
  label: string
  className?: string
}) {
  /* Mirrors the real roving tablist: arrows, Home and End move focus and select. */
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const moves: Record<string, number> = {
      ArrowLeft: (index + items.length - 1) % items.length,
      ArrowRight: (index + 1) % items.length,
      Home: 0,
      End: items.length - 1,
    }
    const next = moves[event.key]
    if (next === undefined) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]').item(next)?.focus()
    onChange(items[next]!.value)
  }
  return h('div', { role: 'tablist', 'aria-label': label, className: cx('dsh-stub-tabs', className) },
    items.map((item, index) => h('button', {
      key: item.value,
      type: 'button',
      role: 'tab',
      id: item.id,
      'aria-controls': item.panelId,
      'aria-selected': item.value === value,
      tabIndex: item.value === value ? 0 : -1,
      className: 'dsh-stub-tab',
      onClick: () => onChange(item.value),
      onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => onKeyDown(event, index),
    }, item.label)))
}

/** Controlled 24px disclosure row. */
export const DisclosureRow = React.memo(function DisclosureRow({
  icon, title, open, expandable, onToggle, running, expandOnRowClick, collapsedContent, children, className,
}: {
  icon: React.ReactNode
  title: string
  open: boolean
  expandable: boolean
  onToggle: () => void
  running?: boolean
  expandOnRowClick?: boolean
  collapsedContent?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return h('div', { className: cx('dsh-stub-disclosure', className), 'data-open': open, 'data-running': running },
    h('button', {
      type: 'button',
      'aria-expanded': expandable ? open : undefined,
      onClick: expandOnRowClick ? onToggle : undefined,
      className: 'dsh-stub-disclosure__row',
    }, icon, title),
    expandable
      ? h('button', { type: 'button', 'aria-expanded': open, onClick: onToggle, className: 'dsh-stub-disclosure__toggle' })
      : null,
    (open || collapsedContent) && h('div', { className: 'dsh-stub-disclosure__body' }, open ? children : collapsedContent))
})

/** The real Modal portals to document.body and owns mask, card and Escape. */
export function Modal({ open, onClose, title, closeLabel, description, children, footer, className, contentClassName, headless }: {
  open: boolean
  onClose: () => void
  title: string
  closeLabel?: string
  description?: string
  children?: React.ReactNode
  footer?: React.ReactNode
  className?: string
  contentClassName?: string
  headless?: boolean
}) {
  if (!open) return null
  const body = h('div', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title,
    className: cx('dsh-stub-modal', className),
  },
    headless ? null : h('div', { className: 'dsh-stub-modal__head' },
      h('h2', { className: 'dsh-stub-modal__title' }, title),
      closeLabel
        ? h('button', { type: 'button', 'aria-label': closeLabel, onClick: onClose, className: 'dsh-stub-modal__close' })
        : null),
    description ? h('p', { className: 'dsh-stub-modal__description' }, description) : null,
    h('div', { className: cx('dsh-stub-modal__body', contentClassName) }, children),
    footer ? h('div', { className: 'dsh-stub-modal__footer' }, footer) : null)
  return typeof document === 'undefined' ? body : ReactDOM.createPortal(body, document.body)
}

export function PathLabel({ path, className, ...attributes }: {
  path: string
} & Omit<React.HTMLAttributes<HTMLSpanElement>, 'children' | 'title'>) {
  return h('span', { ...attributes, className: cx('dsh-stub-path', className), title: path }, path)
}

/** The real Tooltip clones its anchor and adds a fixed bubble; the double keeps
 * the anchor intact so a spec can still query and click it. */
export function Tooltip({ label, children, disabled }: {
  label: string | (() => string)
  children: React.ReactElement
  disabled?: boolean
  side?: 'right' | 'bottom' | 'top'
  align?: 'center' | 'end'
  gap?: number
  portal?: boolean
  delayMs?: number
  maxWidth?: number
  shortcutKeys?: readonly string[]
}) {
  return h(React.Fragment, null, children,
    disabled ? null : h('span', { role: 'tooltip', className: 'dsh-stub-tooltip' },
      typeof label === 'function' ? label() : label))
}

export type StateDotState = 'done' | 'warning' | 'ongoing' | 'error' | 'idle'

/** `aria-hidden` in the real component; the name comes from the render site. */
export function StateDot({ state, size, className, appearance }: {
  state: StateDotState
  size?: number
  className?: string
  appearance?: 'dot' | 'step'
}) {
  return h('span', {
    'aria-hidden': 'true',
    className: cx('dsh-stub-dot', className),
    'data-state': state,
    'data-appearance': appearance,
    style: size ? { width: size, height: size } : undefined,
  })
}

export type MenuEntry =
  | { id: string; label: React.ReactNode; disabled?: boolean; danger?: boolean; submenu?: readonly MenuEntry[] }
  | { type: 'separator'; id: string }
  | { type: 'label'; id: string; text: string }

/** MenuSurface double: a plain div carrying the class and children (no macOS backing). */
export const MenuSurface = React.forwardRef<HTMLDivElement, {
  compact?: boolean
  children?: React.ReactNode
} & React.ComponentPropsWithoutRef<'div'>>(function MenuSurface({ compact: _compact, children, ...rest }, ref) {
  return h('div', { ...rest, ref }, children)
})

/** MenuGroup double: a section with its visible heading, no sticky observation. */
export function MenuGroup({ label, children }: { label: string; children?: React.ReactNode }) {
  return h('section', { className: 'dsh-stub-menu-group' },
    h('div', { className: 'dsh-stub-menu-heading' }, label), children)
}

export function observeStickyMenuGroups(_viewport: HTMLElement): () => void { return () => {} }

/** rankByName double: empty query returns the input; otherwise a substring match
 * on name or label. The real subsequence ranking is verified by the host suite. */
export function rankByName<T extends { readonly name: string; readonly label?: string }>(
  items: readonly T[], rawQuery: string,
): readonly T[] {
  const needle = rawQuery.trim().toLowerCase()
  if (!needle) return items
  return items.filter(item => item.name.toLowerCase().includes(needle) || item.label?.toLowerCase().includes(needle))
}

function menuEntries(entries: readonly MenuEntry[], onSelect?: (id: string) => void): React.ReactNode {
  return entries.map(entry => {
    if ('type' in entry && entry.type === 'separator') return h('hr', { key: entry.id, 'aria-hidden': 'true' })
    if ('type' in entry && entry.type === 'label') return h('div', { key: entry.id, className: 'dsh-stub-menu-label' }, entry.text)
    const item = entry as Extract<MenuEntry, { id: string; label: React.ReactNode }>
    return h('button', {
      key: item.id, role: 'menuitem', disabled: item.disabled,
      onClick: () => onSelect?.(item.id),
    }, item.label, item.submenu ? h('div', { className: 'dsh-stub-submenu' }, menuEntries(item.submenu, onSelect)) : null)
  })
}

/** Anchored menu double: the trigger renders in place; rows render while open. */
export function Menu({ open, anchor, items = [], children, onSelect, listClassName }: {
  open: boolean
  anchor: React.ReactNode
  items?: readonly MenuEntry[]
  children?: React.ReactNode
  selectedId?: string
  selectedIds?: readonly string[]
  onSelect?: (id: string) => void
  onClose?: () => void
  side?: 'bottom' | 'top' | 'right'
  align?: 'start' | 'end'
  portal?: boolean
  listClassName?: string
}) {
  return h('span', { className: 'dsh-stub-menu' }, anchor,
    open ? h('div', { role: 'menu', className: listClassName }, menuEntries(items, onSelect), children) : null)
}

function icon(name: string) {
  return function Icon({ size, className }: { size?: number; className?: string }) {
    return h('svg', {
      width: size ?? 16, height: size ?? 16, viewBox: '0 0 16 16',
      'aria-hidden': 'true', className: cx('dsh-stub-icon', className), 'data-icon': name,
    })
  }
}

export const IconChecklistOutlineRegular = icon('checklist')
export const IconCheckOutlineRegular = icon('check')
export const IconChevronDownOutlineMedium = icon('chevron-down-medium')
export const IconChevronRightOutlineMedium = icon('chevron-right-medium')
export const IconChevronDownOutlineRegular = icon('chevron-down')
export const IconChevronRightOutlineRegular = icon('chevron-right')
export const IconCloseFillRegular = icon('close-fill')
export const IconEditOutlineRegular = icon('edit')
export const IconShieldOutlineRegular = icon('shield')
export const IconUserOutlineRegular = icon('user')
export const IconUsersOutlineRegular = icon('users')

/* --- Hooks. The real ones measure and listen; under test there is no viewport
 * to measure and no pointer to dismiss with, so these are inert but keep their
 * signatures and their return shapes. --- */

export function useAnchoredPosition(_options: {
  open: boolean
  anchorRef: React.RefObject<HTMLElement | null>
  panelRef: React.RefObject<HTMLElement | null>
  side?: 'top' | 'bottom'
  align?: 'start' | 'end'
  gap: number
  margin: number
}): React.CSSProperties | null {
  return null
}

export function useDismissOnOutsidePointer(
  _root: React.RefObject<HTMLElement | null>,
  open: boolean,
  setOpen: (open: boolean) => void,
  _portal?: React.RefObject<HTMLElement | null>,
): void {
  if (!open) return
  React.useEffect(() => () => setOpen(false), [setOpen])
}

export function useModalLayer(
  _dialog: React.RefObject<HTMLElement | null>,
  _open: boolean,
  _onClose: () => void,
): void {}

export const modalSelector = '[role="dialog"][aria-modal="true"], [role="menu"]'

export function closeTopModal(_document: Document): void {}
export function isBehindModal(_anchor: HTMLElement | null): boolean { return false }

// The barrel is expected to export everything above; a plugin importing a name
// that is not here would otherwise get `undefined` and fail far from the cause.
const known = new Set([
  'Button', 'Tag', 'Checkbox', 'Switch', 'Input', 'Pill', 'SegmentedTabs', 'DisclosureRow',
  'Modal', 'Menu', 'MenuSurface', 'MenuGroup', 'PathLabel', 'Tooltip', 'StateDot', 'IconChecklistOutlineRegular',
  'IconCheckOutlineRegular', 'IconChevronDownOutlineMedium', 'IconChevronRightOutlineMedium', 'IconChevronDownOutlineRegular',
  'IconChevronRightOutlineRegular', 'IconCloseFillRegular', 'IconEditOutlineRegular', 'IconShieldOutlineRegular',
  'IconUserOutlineRegular', 'IconUsersOutlineRegular', 'useAnchoredPosition',
  'useDismissOnOutsidePointer', 'useModalLayer', 'modalSelector', 'closeTopModal', 'isBehindModal',
  'observeStickyMenuGroups', 'rankByName',
])

export function assertKnownPrimitive(name: string): void {
  if (!known.has(name)) {
    throw new Error(
      `ui-primitives stub has no '${name}'. A plugin started importing a primitive this ` +
      `double does not model; add it here rather than letting the spec render nothing.`,
    )
  }
}
