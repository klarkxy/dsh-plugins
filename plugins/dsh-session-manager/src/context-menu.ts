/**
 * Right-click open for the sidebar browser: a `contextmenu` gesture on a
 * session row clicks the row itself, so the host's own `onClick` opens that
 * session. The host owns opening (including the archived-session refusal);
 * this module only relays the gesture. No host code registers a contextmenu
 * listener, so the capture-phase relay does not fight an existing handler.
 *
 * DOM contract (dsh-client-ui-workspace, lib/client.js SessionNodeItem):
 * - Session rows are `div[role="treeitem"][data-row-key="session:<id>"]`
 *   inside `div[role="tree"]`. Their `onClick` calls the browser's guarded
 *   open. Overflow and empty rows carry other prefixes, search rows carry no
 *   `data-row-key`, and AnimatedRows exit clones have the attribute removed —
 *   all are ignored by the prefix match.
 * - Workspace group rows toggle expansion on click and have no session to
 *   open, so a right-click there is left alone. Blank new-session rows also
 *   carry `session:` but their click is a no-op in the host; relaying it is
 *   harmless and keeps the selector structural.
 * - The "..." trigger lives in a trailing `span` whose CSS-module class ends
 *   in `_rowActions`, and that span stops click propagation. A right-click
 *   there keeps the native menu button; it must not also open the session.
 * - Class names carry a per-build hash prefix; only `data-row-key` and the
 *   structural suffix are stable.
 * - An opened menu portals to `document.body`, outside the tree, so a
 *   right-click on a menu row never re-enters this relay.
 */

const ROW_SELECTOR = '[data-row-key^="session:"]'
const ACTIONS_SELECTOR = 'span[class*="rowActions"]'

/** Resolve the session row containing `target` when a right-click should open it. */
export function findSessionRow(target: Element): HTMLElement | null {
  if (typeof target.closest !== 'function') return null
  if (target.closest(ACTIONS_SELECTOR) !== null) return null
  const row = target.closest(ROW_SELECTOR)
  if (row === null || row.closest('[role="tree"]') === null) return null
  if (typeof (row as HTMLElement).click !== 'function') return null
  return row as HTMLElement
}

/**
 * Forward one `contextmenu` event to the session row's own click.
 * Returns true when the gesture was relayed (and the default suppressed).
 */
export function forwardContextMenu(event: Event): boolean {
  const target = event.target
  if (target === null || typeof (target as Element).closest !== 'function') return false
  const row = findSessionRow(target as Element)
  if (row === null) return false
  event.preventDefault()
  row.click()
  return true
}

/** Capture-phase relay on the document; the returned disposer uninstalls it. */
export function installContextMenuForwarding(doc: Document): () => void {
  const listener = (event: Event) => { forwardContextMenu(event) }
  doc.addEventListener('contextmenu', listener, true)
  return () => { doc.removeEventListener('contextmenu', listener, true) }
}
