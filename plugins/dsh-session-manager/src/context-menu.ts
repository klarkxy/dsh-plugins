/**
 * Right-click forwarding for the sidebar browser: a `contextmenu` gesture on a
 * session or workspace row clicks that row's native "..." trigger, so the
 * host's own menu — including every `sidebar.workspaces.session.menu.item`
 * slot contribution, this plugin's rows included — opens exactly as a
 * left-click on the trigger would. The host owns the menu; this module only
 * relays the gesture. No host code registers a contextmenu listener, so the
 * capture-phase relay does not fight an existing handler.
 *
 * DOM contract (dsh-client-ui-workspace 0.2.0-rc.2, lib/client.js):
 * - Rows are `div[role="treeitem"][data-row-key="session:<id>"]` or
 *   `data-row-key="workspace:<id>"` inside `div[role="tree"]`. Overflow and
 *   empty rows carry other prefixes, search rows carry no `data-row-key`, and
 *   AnimatedRows exit clones have the attribute removed — all are ignored by
 *   the prefix match. (client.js:1287, 1590-1596, 1729, 1842-1846)
 * - The trigger is the first `button[type="button"]` inside the row's trailing
 *   `span` whose CSS-module class ends in `_rowActions`. It stays mounted —
 *   CSS `display:none` until hover or menu-open — so a programmatic click
 *   toggles the menu. Blank new-session rows and the ungrouped bucket render
 *   no trigger; right-click does nothing there. (client.js:1061, 1314-1340,
 *   1640-1660)
 * - Class names carry a per-build hash prefix and the trigger's aria-label is
 *   localized; only `data-row-key` and the structural suffix are stable.
 * - The opened menu portals to `document.body`, outside the tree, so a
 *   right-click on a menu row never re-enters this relay.
 */

const ROW_SELECTOR = '[data-row-key^="session:"], [data-row-key^="workspace:"]'
const TRIGGER_SELECTOR = 'span[class*="rowActions"] button[type="button"]'

/** Resolve the native "..." trigger of the row containing `target`, if any. */
export function findRowMenuTrigger(target: Element): HTMLElement | null {
  if (typeof target.closest !== 'function') return null
  const row = target.closest(ROW_SELECTOR)
  if (row === null || row.closest('[role="tree"]') === null) return null
  const trigger = row.querySelector(TRIGGER_SELECTOR)
  if (trigger === null || typeof (trigger as HTMLElement).click !== 'function') return null
  return trigger as HTMLElement
}

/**
 * Forward one `contextmenu` event to the row's native menu trigger.
 * Returns true when the gesture was relayed (and the default suppressed).
 */
export function forwardContextMenu(event: Event): boolean {
  const target = event.target
  if (target === null || typeof (target as Element).closest !== 'function') return false
  const trigger = findRowMenuTrigger(target as Element)
  if (trigger === null) return false
  event.preventDefault()
  trigger.click()
  return true
}

/** Capture-phase relay on the document; the returned disposer uninstalls it. */
export function installContextMenuForwarding(doc: Document): () => void {
  const listener = (event: Event) => { forwardContextMenu(event) }
  doc.addEventListener('contextmenu', listener, true)
  return () => { doc.removeEventListener('contextmenu', listener, true) }
}
