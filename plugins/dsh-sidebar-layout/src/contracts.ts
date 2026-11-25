/** Browser-safe contracts for @klarkxy/dsh-sidebar-layout: the layout modes,
 * the localStorage-backed mode store shared by every entry point, the DOM
 * attribute names the locator and stylesheet agree on, and the shared wire
 * metadata for `open_sidebar`. No React, no cordis — every export runs in
 * Node tests and the browser. */

export const PLUGIN_NAME = '@klarkxy/dsh-sidebar-layout'

/** Browser-local persistence: one mode string per browser profile. */
export const STORAGE_KEY = 'klarkxy.dsh-sidebar-layout.mode.v1'

/** Browser-local deduplication ring for handled `open_sidebar` tool calls. */
export const SIDEBAR_OPEN_HANDLED_KEY = 'klarkxy.dsh-sidebar-layout.open-handled.v1'

/** Host tool name registered so user-facing agents can preview files or URLs. */
export const SIDEBAR_OPEN_TOOL = 'open_sidebar'

/** Maximum accepted HTTP(S) URL length for `open_sidebar`. */
export const MAX_SIDEBAR_URL_LENGTH = 16 * 1024

/** Written on the host AppFrame grid; the injected stylesheet keys every
 * layout rule off it. */
export const FRAME_ATTRIBUTE = 'data-dsh-sidebar-layout'

/** Written on the frame's centre column. The host gives it no data attribute,
 * and better-sidebar's notes show a `:has()` conversation selector pays a
 * restyle on every streaming mutation, so the locator tags the node once and
 * CSS reads the tag. */
export const CENTER_ATTRIBUTE = 'data-dsh-sidebar-layout-center'

/** The three presentations:
 * `push` — native behaviour, the panel squeezes the conversation column;
 * `drawer` — the panel overlays the conversation, which keeps full width;
 * `swap` — the panel takes the centre column and the conversation moves right. */
export type SidebarLayoutMode = 'push' | 'drawer' | 'swap'
export const SIDEBAR_LAYOUT_MODES: readonly SidebarLayoutMode[] = ['push', 'drawer', 'swap']

export type SidebarOpenDestination = 'sidebar' | 'float'

export interface SidebarOpenPayload {
  readonly kind: 'file' | 'url'
  readonly path?: string | undefined
  readonly absolutePath?: string | undefined
  readonly url?: string | undefined
  readonly line?: number | undefined
  readonly destination?: SidebarOpenDestination | undefined
  readonly openedAt: number
}

export interface SidebarOpenPresentationMeta extends SidebarOpenPayload {
  readonly tool: typeof SIDEBAR_OPEN_TOOL
}

/** Build the `dsh-resource://file/session/...` URI expected by `sidebarRight.openResource`. */
export function sessionFileAddress(sessionId: string, filePath: string): string {
  const encodeSegment = (segment: string) => encodeURIComponent(segment).replace(/%3A/gi, ':')
  const normalized = String(filePath).replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
  return `dsh-resource://file/session/${encodeSegment(sessionId)}/${normalized.split('/').map(encodeSegment).join('/')}`
}

/** Narrow unknown metadata onto `SidebarOpenPayload`. */
export function isSidebarOpenPayload(value: unknown): value is SidebarOpenPayload {
  if (value === null || typeof value !== 'object') return false
  const rec = value as Record<string, unknown>
  if (rec.kind !== 'file' && rec.kind !== 'url') return false
  if (rec.kind === 'file' && (typeof rec.path !== 'string' || rec.path.length === 0)) return false
  if (rec.kind === 'url' && (typeof rec.url !== 'string' || rec.url.length === 0)) return false
  return true
}

/** Anything stored or injected that is not a known mode is treated as the
 * native default rather than breaking the frame. */
export function normalizeMode(value: unknown): SidebarLayoutMode {
  return SIDEBAR_LAYOUT_MODES.includes(value as SidebarLayoutMode) ? value as SidebarLayoutMode : 'push'
}

/** The keyboard command's cycle order: push → drawer → swap → push. */
export function nextMode(mode: SidebarLayoutMode): SidebarLayoutMode {
  const index = SIDEBAR_LAYOUT_MODES.indexOf(mode)
  return SIDEBAR_LAYOUT_MODES[(index + 1) % SIDEBAR_LAYOUT_MODES.length]!
}

export interface SidebarLayoutStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface SidebarLayoutStore {
  get(): SidebarLayoutMode
  /** ObservableSnapshot face so slot `hooks` can select over the store. */
  getSnapshot(): SidebarLayoutMode
  set(mode: SidebarLayoutMode): void
  subscribe(fn: () => void): () => void
}

/** Browser-local persistence, same shape as the conversation-font store: the
 * default mode removes the key so a reset leaves no residue; storage failures
 * degrade to in-memory behaviour; a `storage` event listener (attached with
 * the first subscriber, detached with the last) keeps sibling windows in sync.
 * A failed local write wins over stale persisted values on remount, so reads
 * are skipped while a write is pending. */
export function createSidebarLayoutStore(storage: SidebarLayoutStorage | undefined): SidebarLayoutStore {
  let current: SidebarLayoutMode = 'push'
  let pendingPersistence = false
  const listeners = new Set<() => void>()
  let detachStorage: (() => void) | undefined

  function load(): SidebarLayoutMode {
    if (storage && !pendingPersistence) {
      try {
        current = normalizeMode(storage.getItem(STORAGE_KEY))
      } catch {
        /* keep the last readable or locally saved value */
      }
    }
    return current
  }

  function notify() {
    for (const fn of [...listeners]) fn()
  }

  function attach() {
    if (detachStorage || typeof window === 'undefined') return
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return
      load()
      notify()
    }
    window.addEventListener('storage', onStorage)
    detachStorage = () => window.removeEventListener('storage', onStorage)
  }

  return {
    get: load,
    getSnapshot: load,
    set(mode) {
      current = normalizeMode(mode)
      if (storage) {
        pendingPersistence = true
        try {
          if (current === 'push') storage.removeItem(STORAGE_KEY)
          else storage.setItem(STORAGE_KEY, current)
          pendingPersistence = false
        } catch {
          /* stay in-memory */
        }
      }
      notify()
    },
    subscribe(fn) {
      if (listeners.size === 0) attach()
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
        if (listeners.size === 0) {
          detachStorage?.()
          detachStorage = undefined
        }
      }
    },
  }
}
