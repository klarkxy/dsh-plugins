/**
 * Web client companion for `open_sidebar`:
 * - Watches live `tool/result` and `tool/ptc-dispatch` events across retained
 *   sessions, opening files (`sidebarRight.openResource`) and HTTP(S) URLs
 *   (`sidebarRight.openTab('browser')`) immediately on the mounted session.
 * - Queues off-screen background session previews and flushes them once with
 *   bounded retry backoff when the user switches to that session, while never
 *   re-triggering historical or paged-older events across reloads.
 * - Renders a `.sl-root`-scoped tool card on `tool.call.toolview` so any
 *   settled `open_sidebar` call can be manually reopened at a click.
 */
import type { Context } from '@deepseek-ai/cordis'
import { useState } from 'react'
import {
  SIDEBAR_OPEN_HANDLED_KEY,
  SIDEBAR_OPEN_TOOL,
  isSidebarOpenPayload,
  sessionFileAddress,
  type SidebarLayoutStorage,
  type SidebarOpenDestination,
  type SidebarOpenPayload,
} from './contracts.ts'

const MAX_HANDLED = 500
const NOT_MOUNTED_FRAGMENT = 'sidebarRight: no session surface is mounted'
const NO_TAB_TYPE_FRAGMENT = 'sidebarRight: no registered tab type'
const RETRY_DELAYS_MS = [0, 16, 40, 100, 200, 400, 800, 1500] as const
const OPEN_LOCALE_NS = 'dsh-sidebar-layout-open'
const ROOT_CLASS = 'sl-root'

const openZh = {
  title: '侧边栏预览',
  preparing: '正在准备打开侧边栏…',
  running: '正在打开',
  ok: '已打开',
  error: '失败',
  stopped: '已停止',
  reopen: '在侧栏中打开',
  inspect: '查看详情',
} as const

const openEn: Record<keyof typeof openZh, string> = {
  title: 'Sidebar preview',
  preparing: 'Preparing sidebar preview…',
  running: 'Opening',
  ok: 'Opened',
  error: 'Failed',
  stopped: 'Stopped',
  reopen: 'Open in sidebar',
  inspect: 'Inspect details',
}

export interface ObservableSnapshotLike<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

export interface SessionEventRecordLike {
  readonly type?: string | undefined
  readonly event?: {
    readonly type?: string | undefined
    readonly seq?: number | undefined
    readonly time?: number | undefined
    readonly data?: {
      readonly name?: string | undefined
      readonly isError?: boolean | undefined
      readonly subCallId?: string | number | undefined
      readonly meta?: unknown
      readonly message?: {
        readonly isError?: boolean | undefined
        readonly source?: { readonly callId?: string | number | undefined } | undefined
      } | undefined
    } | undefined
  } | undefined
}

export interface SessionEventWindowLike {
  readonly revision: number
  readonly entries: readonly SessionEventRecordLike[]
  readonly change?: {
    readonly kind: 'append' | 'prepend' | 'replace'
    readonly entries: readonly SessionEventRecordLike[]
  } | undefined
}

export interface SessionBindingLike {
  readonly sessionId?: string | undefined
  readonly eventSource: ObservableSnapshotLike<SessionEventWindowLike | undefined>
}

export interface SessionsServiceLike {
  readonly list: ObservableSnapshotLike<{
    readonly ids?: readonly string[] | undefined
    readonly byId?: Readonly<Record<string, unknown>> | undefined
  }>
  binding(sessionId: string): SessionBindingLike | undefined
}

export interface SidebarRightPreviewFace {
  readonly mounted?: ObservableSnapshotLike<string | null | undefined> | undefined
  openResource?(
    address: string,
    options?: {
      params?: { line?: number | undefined } | undefined
      destination?: SidebarOpenDestination | undefined
    } | undefined,
  ): void
  openTab?(kind: string, options?: { params?: Record<string, unknown> | undefined } | undefined): void
}

export interface SidebarOpenClientHost {
  readonly sessions: SessionsServiceLike
  readonly sidebarRight: SidebarRightPreviewFace
  readonly locale: {
    register(ns: string, dicts: Record<string, Record<string, string>>): () => void
  }
  readonly slots: {
    inject(key: string, callback: () => unknown): () => void
    register(spec: Record<string, unknown>, component: unknown): () => void
  }
  get?(key: string): unknown
  readonly sidebarRightTabs?: { get?(id: string): unknown } | undefined
  effect: Context['effect']
}

export interface ExtractedOpenTarget {
  readonly callId: string
  readonly eventTime: number
  readonly payload: SidebarOpenPayload
}

function loadHandledKeys(storage: SidebarLayoutStorage | undefined): string[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(SIDEBAR_OPEN_HANDLED_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string').slice(-MAX_HANDLED)
      : []
  } catch {
    return []
  }
}

function saveHandledKeys(storage: SidebarLayoutStorage | undefined, keys: readonly string[]): void {
  if (!storage) return
  try {
    storage.setItem(SIDEBAR_OPEN_HANDLED_KEY, JSON.stringify(keys.slice(-MAX_HANDLED)))
  } catch {
    /* ignore quota / private-browsing failures */
  }
}

/** Extract a settled non-error `open_sidebar` payload from a session event record. */
export function extractSidebarOpenTarget(event: SessionEventRecordLike['event']): ExtractedOpenTarget | null {
  if (!event || typeof event !== 'object') return null
  if (event.type === 'tool/result') {
    const message = event.data?.message
    if (!message || message.isError === true) return null
    const meta = event.data?.meta
    if (!isSidebarOpenPayload(meta)) return null
    if ((meta as { tool?: unknown }).tool !== SIDEBAR_OPEN_TOOL) return null
    const callId = message.source?.callId ?? event.seq
    if (callId === undefined) return null
    const eventTime = typeof meta.openedAt === 'number'
      ? meta.openedAt
      : (typeof event.time === 'number' ? event.time : 0)
    return { callId: String(callId), eventTime, payload: meta }
  }
  if (event.type === 'tool/ptc-dispatch') {
    if (event.data?.isError === true || event.data?.name !== SIDEBAR_OPEN_TOOL) return null
    const meta = event.data?.meta
    if (!isSidebarOpenPayload(meta)) return null
    const callId = event.data?.subCallId ?? event.seq
    if (callId === undefined) return null
    const eventTime = typeof meta.openedAt === 'number'
      ? meta.openedAt
      : (typeof event.time === 'number' ? event.time : 0)
    return { callId: String(callId), eventTime, payload: meta }
  }
  return null
}

/** Dispatch a file or URL payload into `sidebarRight` (or `window.open` fallback on manual URL click). */
export function openSidebarPayload(
  host: Pick<SidebarOpenClientHost, 'sidebarRight' | 'get' | 'sidebarRightTabs'>,
  sessionId: string | null | undefined,
  payload: SidebarOpenPayload,
  manual: boolean,
): boolean {
  if (payload.kind === 'file' && typeof payload.path === 'string' && payload.path.length > 0 && sessionId) {
    if (typeof host.sidebarRight.openResource !== 'function') return false
    const options: {
      params?: { line?: number | undefined } | undefined
      destination?: SidebarOpenDestination | undefined
    } = {}
    if (typeof payload.line === 'number' && Number.isSafeInteger(payload.line) && payload.line >= 1) {
      options.params = { line: payload.line }
    }
    if (payload.destination === 'sidebar' || payload.destination === 'float') {
      options.destination = payload.destination
    }
    host.sidebarRight.openResource(sessionFileAddress(sessionId, payload.path), options)
    return true
  }
  if (payload.kind === 'url' && typeof payload.url === 'string' && payload.url.length > 0) {
    const tabs = (typeof host.get === 'function' ? host.get('sidebarRightTabs') : host.sidebarRightTabs) as
      | { get?(id: string): unknown }
      | undefined
    if (tabs?.get?.('browser') !== undefined && typeof host.sidebarRight.openTab === 'function') {
      host.sidebarRight.openTab('browser', { params: { url: payload.url } })
      return true
    }
    if (manual && typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open(payload.url, '_blank', 'noopener,noreferrer')
      return true
    }
    return false
  }
  return false
}

function summarizeTargetLabel(rawArgs: string, meta: unknown): string {
  if (isSidebarOpenPayload(meta)) {
    return meta.kind === 'url'
      ? (meta.url ?? '')
      : `${meta.path ?? ''}${meta.line !== undefined ? `:${meta.line}` : ''}`
  }
  try {
    const parsed = JSON.parse(rawArgs || '{}') as { url?: unknown; path?: unknown; line?: unknown }
    if (typeof parsed.url === 'string' && parsed.url.length > 0) return parsed.url
    if (typeof parsed.path === 'string' && parsed.path.length > 0) {
      const lineSuffix = typeof parsed.line === 'number' && Number.isSafeInteger(parsed.line) ? `:${parsed.line}` : ''
      return `${parsed.path}${lineSuffix}`
    }
  } catch {
    /* keep raw string fallback */
  }
  return rawArgs
}

function PreviewIcon({ isUrl }: { readonly isUrl: boolean }) {
  return isUrl ? (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="M2.5 8h11M8 2c1.8 1.8 1.8 10.2 0 12M8 2c-1.8 1.8-1.8 10.2 0 12" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="11" rx="2" />
      <path d="M9.5 2.5v11" />
    </svg>
  )
}

export interface OpenSidebarToolRowProps {
  readonly phase?: 'preparing' | 'call' | 'result' | undefined
  readonly block?: {
    readonly kind?: string | undefined
    readonly isError?: boolean | undefined
    readonly argsRaw?: string | undefined
    readonly meta?: unknown
    readonly content?: readonly { readonly type?: string | undefined; readonly text?: string | undefined }[] | undefined
    readonly error?: { readonly name?: string | undefined; readonly code?: string | undefined } | undefined
    readonly call?: { readonly argsRaw?: string | undefined } | undefined
  } | undefined
  readonly inspect?: (() => void) | undefined
  readonly openFile?: ((path: string, options?: { line?: number | undefined } | undefined) => unknown) | undefined
  readonly t?: ((key: string) => string) | undefined
  readonly onOpenPayload?: ((payload: SidebarOpenPayload) => boolean) | undefined
}

export function OpenSidebarToolRow(props: OpenSidebarToolRowProps) {
  const [expanded, setExpanded] = useState(false)
  const label = (key: keyof typeof openEn): string =>
    typeof props.t === 'function' ? props.t(key) : openEn[key]

  const settled = Boolean(props.block && 'kind' in props.block && props.block.kind !== undefined)
  const rawArgs = (settled ? props.block?.call?.argsRaw : props.block?.argsRaw) ?? ''
  const meta = props.block?.meta
  const targetLabel = summarizeTargetLabel(rawArgs, meta)
  const isUrlTarget = isSidebarOpenPayload(meta)
    ? meta.kind === 'url'
    : /^https?:\/\//i.test(targetLabel.trim())

  if (props.phase === 'preparing') {
    return (
      <div className={`${ROOT_CLASS} sl-open-card`} data-tool={SIDEBAR_OPEN_TOOL} data-state="preparing" aria-label={label('preparing')}>
        <button type="button" className="sl-open-header" disabled>
          <PreviewIcon isUrl={isUrlTarget} />
          <span className="sl-open-title">{label('title')}</span>
          <span className="sl-open-summary">
            <span className="sl-open-status">{label('preparing')}</span>
          </span>
        </button>
      </div>
    )
  }

  const state = !settled
    ? 'running'
    : props.block?.error?.code === 'interrupted'
      ? 'stopped'
      : props.block?.isError
        ? 'error'
        : 'ok'
  const output = settled
    ? (props.block?.content ?? [])
        .map(part => (part.type === 'text' ? (part.text ?? '') : JSON.stringify(part)))
        .join('\n')
    : ''
  const details = output || (settled && props.block?.error
    ? `${props.block.error.name ?? 'Error'}: ${props.block.error.code ?? 'failed'}`
    : '')
  const canExpand = details !== ''
  const isOpen = expanded && canExpand

  const handleReopen = () => {
    if (isSidebarOpenPayload(meta) && props.onOpenPayload?.(meta)) return
    try {
      const parsed = JSON.parse(rawArgs || '{}') as { url?: unknown; path?: unknown; line?: unknown }
      if (typeof parsed.url === 'string' && parsed.url.length > 0) {
        props.onOpenPayload?.({ kind: 'url', url: parsed.url, openedAt: Date.now() })
      } else if (typeof parsed.path === 'string' && parsed.path.length > 0 && typeof props.openFile === 'function') {
        const line = typeof parsed.line === 'number' && Number.isSafeInteger(parsed.line) ? parsed.line : undefined
        void props.openFile(parsed.path, line !== undefined ? { line } : undefined)
      }
    } catch {
      /* ignore malformed argsRaw */
    }
  }

  return (
    <div className={`${ROOT_CLASS} sl-open-card`} data-tool={SIDEBAR_OPEN_TOOL} data-state={state}>
      <button
        type="button"
        className="sl-open-header"
        disabled={!canExpand}
        aria-expanded={canExpand ? isOpen : undefined}
        onClick={() => {
          if (canExpand) setExpanded(prev => !prev)
        }}
      >
        <PreviewIcon isUrl={isUrlTarget} />
        <span className="sl-open-title">{label('title')}</span>
        <span className="sl-open-summary">
          <span className="sl-open-status">{label(state)}</span>
          <span className="sl-open-target">{targetLabel}</span>
        </span>
      </button>
      {isOpen ? (
        <div className="sl-open-body">
          <pre className="sl-open-output">{details}</pre>
          <div className="sl-open-actions">
            {settled && state === 'ok' ? (
              <button type="button" className="sl-open-btn" onClick={handleReopen}>
                {label('reopen')}
              </button>
            ) : null}
            {props.inspect ? (
              <button type="button" className="sl-open-btn" onClick={props.inspect}>
                {label('inspect')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function installSidebarOpenClient(
  host: SidebarOpenClientHost,
  options: {
    readonly storage?: SidebarLayoutStorage | undefined
    readonly now?: (() => number) | undefined
  } = {},
): () => void {
  const now = options.now ?? Date.now
  const bootTime = now()
  const handledOrder = loadHandledKeys(options.storage)
  const handled = new Set<string>(handledOrder)
  const pendingBySession = new Map<string, Map<string, ExtractedOpenTarget>>()
  const attached = new Map<string, { binding: SessionBindingLike; revision: number; stop: () => void }>()
  const retryTimers = new Map<string, { raf: boolean; id: number | ReturnType<typeof setTimeout> }>()
  let disposed = false

  const mountedSource = host.sidebarRight.mounted
  const getMountedId = (): string | null => mountedSource?.getSnapshot() ?? null

  const markHandled = (key: string) => {
    if (handled.has(key)) return
    handled.add(key)
    handledOrder.push(key)
    while (handledOrder.length > MAX_HANDLED) {
      const oldest = handledOrder.shift()
      if (oldest !== undefined) handled.delete(oldest)
    }
    saveHandledKeys(options.storage, handledOrder)
  }

  const clearTimer = (sessionId: string) => {
    const timer = retryTimers.get(sessionId)
    if (!timer) return
    retryTimers.delete(sessionId)
    if (timer.raf && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(timer.id as number)
    } else {
      clearTimeout(timer.id as ReturnType<typeof setTimeout>)
    }
  }

  const detachSession = (sessionId: string) => {
    clearTimer(sessionId)
    const rec = attached.get(sessionId)
    if (!rec) return
    attached.delete(sessionId)
    try {
      rec.stop()
    } catch {
      /* ignore teardown errors */
    }
  }

  const scheduleFlush = (sessionId: string, retryIndex: number) => {
    if (disposed || retryIndex >= RETRY_DELAYS_MS.length) return
    clearTimer(sessionId)
    const run = () => {
      retryTimers.delete(sessionId)
      flush(sessionId, retryIndex + 1)
    }
    if (retryIndex === 0 && typeof requestAnimationFrame === 'function') {
      retryTimers.set(sessionId, { raf: true, id: requestAnimationFrame(run) })
    } else {
      retryTimers.set(sessionId, { raf: false, id: setTimeout(run, RETRY_DELAYS_MS[retryIndex]) })
    }
  }

  const flush = (sessionId: string, attempt = 0) => {
    if (disposed || getMountedId() !== sessionId) return
    const queue = pendingBySession.get(sessionId)
    if (!queue || queue.size === 0) return
    clearTimer(sessionId)
    for (const [key, item] of [...queue.entries()]) {
      if (handled.has(key)) {
        queue.delete(key)
        continue
      }
      try {
        openSidebarPayload(host, sessionId, item.payload, false)
        markHandled(key)
        queue.delete(key)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes(NOT_MOUNTED_FRAGMENT) || message.includes(NO_TAB_TYPE_FRAGMENT)) {
          scheduleFlush(sessionId, attempt)
          return
        }
        markHandled(key)
        queue.delete(key)
      }
    }
    if (queue.size === 0) pendingBySession.delete(sessionId)
  }

  const scan = (sessionId: string, entries: readonly SessionEventRecordLike[], isAppend: boolean) => {
    let added = false
    for (const entry of entries) {
      if (entry?.type !== 'event') continue
      const found = extractSidebarOpenTarget(entry.event)
      if (!found) continue
      const key = `${sessionId}:${found.callId}`
      if (handled.has(key) || (!isAppend && found.eventTime < bootTime)) continue
      let queue = pendingBySession.get(sessionId)
      if (!queue) {
        queue = new Map()
        pendingBySession.set(sessionId, queue)
      }
      queue.set(key, found)
      added = true
    }
    if (added && getMountedId() === sessionId) {
      flush(sessionId, 0)
    }
  }

  const syncSessions = () => {
    if (disposed) return
    const snap = host.sessions.list.getSnapshot() ?? {}
    const ids = new Set<string>([
      ...(snap.ids ?? []),
      ...Object.keys(snap.byId ?? {}),
    ])
    const currentMounted = getMountedId()
    if (currentMounted) ids.add(currentMounted)

    for (const [id, rec] of [...attached.entries()]) {
      if (host.sessions.binding(id) !== rec.binding) detachSession(id)
    }
    for (const id of ids) {
      const binding = host.sessions.binding(id)
      if (!binding || attached.get(id)?.binding === binding) continue
      detachSession(id)
      const rec = { binding, revision: -1, stop: () => {} }
      const onEvent = () => {
        const win = binding.eventSource.getSnapshot()
        if (!win || win.revision === rec.revision) return
        rec.revision = win.revision
        if (win.change?.kind === 'append') {
          scan(id, win.change.entries, true)
        } else if (win.change?.kind === 'replace') {
          scan(id, win.change.entries, false)
        }
      }
      rec.stop = binding.eventSource.subscribe(onEvent)
      attached.set(id, rec)
      onEvent()
    }
  }

  const stopLocale = host.locale.register(OPEN_LOCALE_NS, { zh: { ...openZh }, en: { ...openEn } })
  const stopList = host.sessions.list.subscribe(syncSessions)
  const stopMounted = mountedSource
    ? mountedSource.subscribe(() => {
        syncSessions()
        const current = getMountedId()
        if (current) flush(current, 0)
      })
    : () => {}

  syncSessions()

  const BoundToolRow = (props: OpenSidebarToolRowProps) => (
    <OpenSidebarToolRow
      {...props}
      onOpenPayload={payload => openSidebarPayload(host, getMountedId(), payload, true)}
    />
  )
  const stopToolView = host.slots.inject('tool.call.toolview', () =>
    host.slots.register(
      { name: 'tool.call.toolview', key: SIDEBAR_OPEN_TOOL, locale: OPEN_LOCALE_NS },
      BoundToolRow,
    ),
  )

  return () => {
    disposed = true
    stopToolView()
    stopMounted()
    stopList()
    stopLocale()
    for (const id of [...attached.keys()]) detachSession(id)
    for (const id of [...retryTimers.keys()]) clearTimer(id)
  }
}
