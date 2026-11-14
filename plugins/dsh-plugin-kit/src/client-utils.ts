import type { Context } from '@deepseek-ai/cordis'
import { createElement, useCallback, useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { SESSION_SETTINGS_ITEM_SLOT, SESSION_SETTINGS_SECTION_ID, SETTINGS_SECTION_ICON_SLOT } from './contracts.ts'
import type { PluginLogger } from './log-shared.ts'

/** Fixed pause for failing background reads; manual work is never replayed. */
export function createPluginReadGate(now: () => number = Date.now, logger?: PluginLogger) {
  let pausedUntil = 0
  let epoch = 0
  return {
    canRead: () => now() >= pausedUntil,
    reset: () => { epoch++; pausedUntil = 0 },
    async run<T>(read: () => Promise<T>): Promise<T> {
      const current = epoch
      try {
        const value = await read()
        if (current === epoch) {
          if (pausedUntil > 0) logger?.debug('read-gate.resumed', 'Background read gate recovered.')
          pausedUntil = 0
        }
        return value
      } catch (error) {
        // The native Connection error is an Error with this exact HTTP text.
        // Authentication, application failures, and cancellation stay distinct.
        const message = error instanceof Error ? error.message : ''
        if (current === epoch && (/(?:^|\s)transport failure for .+: HTTP (?:404|405|503)\b/.test(message)
          || (error instanceof TypeError && /^(?:Failed to fetch|fetch failed|NetworkError when attempting to fetch resource\.?)$/i.test(message)))) {
          pausedUntil = now() + 30_000
          logger?.warn('read-gate.paused', 'Background reads paused for 30s after transport failure.', error)
        }
        throw error
      }
    },
  }
}

export interface NativeSurfaceClient {
  sessions: {
    binding?(sessionId: string): { eventSource: { subscribe(listener: () => void): () => void } } | undefined
  }
  uiWorkspace: { current?: { getSnapshot(): { sessionId: string } | undefined; subscribe(listener: () => void): () => void } }
  uiSession: { adapter: { current: { getSnapshot(): { key?: string }; subscribe(listener: () => void): () => void } } }
  locale: { getSnapshot(): { active: string }; subscribe(listener: () => void): () => void }
  connection?: { generation?: { subscribe(listener: () => void): () => void } }
}

/** The Editor retains its manuscript session separately; native DSH exposes the main-view binding. */
export function selectedSessionId(client: Pick<NativeSurfaceClient, 'uiWorkspace' | 'uiSession'>): string {
  const workspace = client.uiWorkspace?.current
  return workspace
    ? workspace.getSnapshot()?.sessionId ?? ''
    : client.uiSession.adapter.current.getSnapshot().key ?? ''
}

/**
 * Owner props are data the host composed, never a Cordis context: reading an
 * undeclared property off one throws instead of returning undefined, which
 * would crash the slot entry and abdicate its cell for good. Tolerate a
 * throwing read so a mistaken prop degrades to "not supplied".
 */
function read(source: unknown, key: string): unknown {
  if (source === null || typeof source !== 'object') return undefined
  try {
    return (source as Record<string, unknown>)[key]
  } catch {
    return undefined
  }
}

function readString(source: unknown, key: string): string | undefined {
  const value = read(source, key)
  return typeof value === 'string' ? value : undefined
}

/** Owner props win; native settings only supplies close, so resolve its selected session. */
export function useNativeSeat(client: NativeSurfaceClient, props?: unknown) {
  const current = useSyncExternalStore(
    useCallback((fn: () => void) => (client.uiWorkspace?.current ?? client.uiSession.adapter.current).subscribe(fn), [client]),
    useCallback(() => selectedSessionId(client), [client]),
    () => '',
  )
  const language = useSyncExternalStore(
    useCallback((fn: () => void) => client.locale.subscribe(fn), [client]),
    useCallback(() => client.locale.getSnapshot().active, [client]),
    () => 'en',
  )
  const sessionId = readString(props, 'sessionId') ?? readString(read(props, 'owner'), 'sessionId') ?? current
  const requestedLocale = read(props, 'locale') ?? read(read(props, 'owner'), 'locale') ?? language
  return { sessionId, locale: (String(requestedLocale).startsWith('zh') ? 'zh' : 'en') as 'zh' | 'en',
    hidden: read(props, 'hidden') === true || read(read(props, 'owner'), 'hidden') === true }
}

/** Refresh on native log boundaries/reconnect/focus. Read-only settling is bounded to an observed job. */
export function useFeatureRefresh(
  client: NativeSurfaceClient, sessionId: string, refresh: () => void,
  working = false, enabled = true,
): void {
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const queue = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      clearTimeout(timer)
      timer = setTimeout(() => refreshRef.current(), 150)
    }
    const source = sessionId ? client.sessions.binding?.(sessionId)?.eventSource : undefined
    const stopEvents = source?.subscribe(queue)
    const stopConnection = client.connection?.generation?.subscribe(queue)
    const visibility = () => { if (document.visibilityState === 'visible') queue() }
    window.addEventListener('focus', queue)
    document.addEventListener('visibilitychange', visibility)
    // Details are collapsed by default; opening an existing panel must get current state.
    document.addEventListener('toggle', queue, true)
    return () => {
      clearTimeout(timer)
      stopEvents?.(); stopConnection?.()
      window.removeEventListener('focus', queue)
      document.removeEventListener('visibilitychange', visibility)
      document.removeEventListener('toggle', queue, true)
    }
  }, [client, sessionId, enabled])
  useEffect(() => {
    if (!enabled || !working) return
    let delay = 250
    const until = Date.now() + 300_000
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      if (Date.now() >= until) return
      if (document.visibilityState !== 'hidden') refreshRef.current()
      delay = Math.min(delay * 2, 2000)
      timer = setTimeout(tick, delay)
    }
    timer = setTimeout(tick, delay)
    return () => clearTimeout(timer)
  }, [client, sessionId, working, enabled])
}

/* Shared "Session Management" settings page. The page is root-owned shared
 * infrastructure, not a business plugin: any participant alone yields the same
 * section, and participants never import each other. Synchronization crosses
 * separately bundled copies of this helper through the Cordis root context —
 * `root.get`/`root.provide` is the only rendezvous, so no window global or
 * module singleton is needed and no participant depends on another being enabled.
 */

/** A row contributed into the shared Session Management page. */
export interface SessionSettingsItemSpec {
  readonly id: string
  readonly order: number
}

/* Original line icons for settings-section navigation seats. The official
 * `dsh-client-ui-primitives` icon set covers generic glyphs only; these keep
 * the same conventions (16×16 viewBox, 1px stroke, round caps, currentColor)
 * so the plugin set stays visually consistent with the native nav. Colors
 * never appear here: `currentColor` lets the host style the active state, and
 * `aria-hidden` keeps the section label the single accessible name. */

/** Owner props the host's `settings.section.icon` seat hands to its cell. */
export interface SettingsSectionIconProps {
  readonly size?: number
  /** Selection state; the nav styles active icons through color, not geometry. */
  readonly active?: boolean
}

type IconChild = readonly [tag: string, attrs: Record<string, string | number>]

/** One `<svg>` with the shared icon chrome; children are plain elements. */
function lineIcon(children: IconChild[]) {
  return function SettingsSectionIcon(props: SettingsSectionIconProps): ReactNode {
    return createElement('svg', {
      'aria-hidden': 'true',
      width: props.size ?? 16,
      height: props.size ?? 16,
      viewBox: '0 0 16 16',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }, ...children.map(([tag, attrs], index) => createElement(tag, { key: index, ...attrs })))
  }
}

/** Chat bubble for the shared Session Management section. */
export const IconSessionSettings = lineIcon([
  ['path', { d: 'M8.5 13a5.5 5.5 0 0 0 5.5-5.5A5.5 5.5 0 0 0 8.5 2 5.5 5.5 0 0 0 3 7.5a5.48 5.48 0 0 0 .9 3L2.8 12.6a.5.5 0 0 0 .62.62l2.9-.98a5.48 5.48 0 0 0 2.18.76Z' }],
])

/** Serif-flavoured letter A for the Font section. */
export const IconFontSettings = lineIcon([
  ['path', { d: 'M3.3 12.6 7.9 3.1a.5.5 0 0 1 .9 0l4.6 9.5' }],
  ['path', { d: 'M5.2 9.4h6.3' }],
  ['path', { d: 'M2.4 12.6h2.4' }],
  ['path', { d: 'M11.9 12.6h2.4' }],
])

/** Keyboard for the Shortcuts section. */
export const IconKeyboardSettings = lineIcon([
  ['rect', { x: 1.75, y: 4.75, width: 12.5, height: 7.5, rx: 1.2 }],
  ['path', { d: 'M4.5 7.25h0' }],
  ['path', { d: 'M8 7.25h0' }],
  ['path', { d: 'M11.5 7.25h0' }],
  ['path', { d: 'M5.25 9.75h5.5' }],
])

/** Linked model nodes for the Model Management section. */
export const IconModelNetworkSettings = lineIcon([
  ['line', { x1: 10.6, y1: 5.3, x2: 8.8, y2: 7.1 }],
  ['line', { x1: 7.2, y1: 8.9, x2: 5.4, y2: 10.7 }],
  ['circle', { cx: 12, cy: 4, r: 1.9 }],
  ['circle', { cx: 4, cy: 12, r: 1.9 }],
  ['circle', { cx: 8, cy: 8, r: 1.5 }],
])

/**
 * Contribute the nav icon of a `settings.section` entry. The `settings
 * .section.icon` seat is declared by the host independently of the section
 * list, so the wait runs in parallel: the icon appears as soon as both seats
 * exist and unloading removes it again, restoring the host's default glyph.
 * The `id` must equal the section id; `order`/`priority` mirror `order` so the
 * icon cell sorts like its section and, for shared sections, several
 * contributors can register the same icon id under different priorities
 * without duplicating nav entries.
 */
export function registerSettingsSectionIcon(
  ctx: Context,
  sectionId: string,
  order: number,
  component: (props: SettingsSectionIconProps) => ReactNode,
): () => void {
  const slots = (ctx as unknown as { slots: SessionSettingsSlots }).slots
  return slots.inject(SETTINGS_SECTION_ICON_SLOT, () =>
    slots.register({ name: SETTINGS_SECTION_ICON_SLOT, id: sectionId, order, priority: order }, component))
}

interface SessionSettingsSlots {
  inject(key: string, callback: () => Iterable<(() => void) | void> | (() => void) | void): () => void
  register(spec: Record<string, unknown>, render: unknown): () => void
}

interface SessionSettingsRoot {
  get(name: string, strict?: boolean): unknown
  provide(name: string, value: unknown): () => void
  readonly slots?: SessionSettingsSlots
}

/** Private Cordis rendezvous; every bundled copy of this helper resolves the same root service. */
const SESSION_SETTINGS_PAGE_SERVICE = 'dshSessionSettingsPage'

interface SessionSettingsPage {
  retain(): void
  release(): void
}

/** The page component renders only its declared child list: items paint their own titles and styles. */
function SessionSettingsPageView(props: { renderSlot: (key: string, owner: Record<string, never>) => ReactNode }): ReactNode {
  return props.renderSlot(SESSION_SETTINGS_ITEM_SLOT, {})
}

/**
 * Acquire the root-owned page service, creating and providing it on first use.
 * One counter covers participants, the section wait and the provider: the last
 * release removes the wait and then the provider synchronously (Cordis deletes
 * the impl before its async disposer awaits), so a later acquire sees a clean
 * get() miss and can re-establish the page.
 */
function acquireSessionSettingsPage(root: SessionSettingsRoot): SessionSettingsPage {
  const existing = root.get(SESSION_SETTINGS_PAGE_SERVICE, false) as SessionSettingsPage | undefined
  if (existing) return existing
  const slots = root.slots as SessionSettingsSlots
  let users = 0
  let stopPage: (() => void) | undefined
  let unprovide: (() => void) | undefined
  const page: SessionSettingsPage = {
    retain() {
      // The reservation is counted before the throwing install, so a failure
      // lets the caller's release() undo it fully instead of leaking the service.
      users += 1
      if (!stopPage) {
        stopPage = slots.inject('settings.section', () => slots.register(
          {
            name: 'settings.section',
            id: SESSION_SETTINGS_SECTION_ID,
            order: 30,
            label: () => {
              const locale = root.get('locale', false) as { getSnapshot?(): { active?: unknown } } | undefined
              return String(locale?.getSnapshot?.().active ?? '').startsWith('zh') ? '会话管理' : 'Session Management'
            },
            children: { [SESSION_SETTINGS_ITEM_SLOT]: { kind: 'list', scope: 'root' } },
          },
          SessionSettingsPageView,
        ))
      }
    },
    release() {
      if (users <= 0) return
      users -= 1
      if (users > 0) return
      // The last contributor tears the section down; collapsing its children
      // declaration clears the item slot for every other bundle as well.
      stopPage?.()
      stopPage = undefined
      unprovide?.()
    },
  }
  unprovide = root.provide(SESSION_SETTINGS_PAGE_SERVICE, page)
  return page
}

/**
 * Contribute one row to the shared Session Management settings page.
 *
 * `ctx` is the plugin's own context: the row's slot wait unloads with the
 * plugin, while the page itself is retained on the shared root context for as
 * long as any contributor lives. There is no fallback seat — when every
 * contributor is gone the section disappears with the page. Returns a disposer.
 * Shared root-owned infrastructure (the auxiliary-model card) calls this on
 * `ctx.root` so its row, icon and page share are owned by the root lifetime
 * and released by the returned disposer, not by any plugin fiber.
 */
export function registerSessionSettingsItem(
  ctx: Context,
  item: SessionSettingsItemSpec,
  component: (props: never) => ReactNode,
): () => void {
  const slots = (ctx as unknown as { slots: SessionSettingsSlots }).slots
  const root = ctx.root as unknown as SessionSettingsRoot
  const page = acquireSessionSettingsPage(root)
  let stopItem: (() => void) | undefined
  let stopIcon: (() => void) | undefined
  try {
    page.retain()
    stopItem = slots.inject(SESSION_SETTINGS_ITEM_SLOT, () => slots.register({ name: SESSION_SETTINGS_ITEM_SLOT, ...item }, component))
    // Every contributor also waits on the nav-icon seat, registering the same
    // section icon id under its own priority (its row order). Same-id entries
    // coexist on the ledger while the host renders one icon, so no contributor
    // owns the icon and none depends on another for it; the wait lives with
    // this ctx, so it fires now on fresh loads and retro-fills on HMR.
    stopIcon = slots.inject(SETTINGS_SECTION_ICON_SLOT, () => slots.register(
      { name: SETTINGS_SECTION_ICON_SLOT, id: SESSION_SETTINGS_SECTION_ID, order: item.order, priority: item.order },
      IconSessionSettings,
    ))
  } catch (error) {
    // A synchronous failure (for example a duplicate row id or a failing page
    // install) must not pin the shared page for a contributor that never joined.
    stopIcon?.()
    stopItem?.()
    page.release()
    throw error
  }
  // The disposer may be invoked by both ctx.effect and an explicit caller;
  // releasing twice would unbalance the shared refcount.
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    stopIcon?.()
    stopItem?.()
    page.release()
  }
}
