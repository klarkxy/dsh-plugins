/**
 * Relay sidebar right-clicks to the host's own session actions menu.
 *
 * dsh-client-ui-workspace SessionNodeItem renders a keyed treeitem, with a
 * trailing rowActions span. Its first button is the Menu anchor; subsequent
 * buttons are contributed row actions. The span stops click propagation, so
 * clicking the anchor opens the menu without opening the session. Menu portals
 * outside the tree and the row carries a *_menuOpen class while it is open.
 * Blank rows, search results, and AnimatedRows exit clones have no keyed menu
 * anchor and are left alone. CSS-module hash prefixes vary between host builds.
 */
const ROW_SELECTOR = '[role="treeitem"][data-row-key^="session:"]'
const ACTIONS_SELECTOR = 'span[class*="_rowActions"]'

/** Resolve a live session row in the sidebar tree. */
export function findSessionRow(target: Element): HTMLElement | null {
  if (typeof target.closest !== 'function') return null
  const row = target.closest<HTMLElement>(ROW_SELECTOR)
  if (row === null || row.closest('[role="tree"]') === null || row.closest('[inert]') !== null) return null
  return row
}

/** Forward a context-menu gesture only when the host provides a menu anchor. */
export function forwardContextMenu(event: Event): boolean {
  if (event.defaultPrevented) return false
  const target = event.target
  if (target === null || typeof (target as Element).closest !== 'function') return false
  const element = target as Element
  const row = findSessionRow(element)
  if (row === null) return false
  const actions = row.querySelector(ACTIONS_SELECTOR)
  const trigger = actions?.querySelector<HTMLButtonElement>('button')
  if (trigger == null || trigger.disabled) return false
  // Other row actions (pin/archive/etc.) must never fire on right-click.
  if (element.closest(ACTIONS_SELECTOR) !== null && !trigger.contains(element)) return false
  event.preventDefault()
  // The host anchor toggles. Repeated context-menu gestures should keep it open.
  if (!Array.from(row.classList).some(name => name.endsWith('_menuOpen'))) {
    trigger.focus({ preventScroll: true })
    trigger.click()
  }
  return true
}

/** Capture-phase relay; disposing the client removes the listener. */
export function installContextMenuForwarding(doc: Document): () => void {
  const listener = (event: Event) => { forwardContextMenu(event) }
  doc.addEventListener('contextmenu', listener, true)
  return () => { doc.removeEventListener('contextmenu', listener, true) }
}
