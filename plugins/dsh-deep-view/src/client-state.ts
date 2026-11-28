import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { PendingView, ViewNode, ViewSnapshot } from './contracts.ts'
import { uiEn, uiZh } from './copy.ts'

export type LocaleSource = { getSnapshot?(): { active?: string }; subscribe?(listener: () => void): () => void }

/** Default maximum settled, unsubscribed view entries kept in client memory. */
export const DEFAULT_MAX_SETTLED_VIEWS = 200

export type ViewStateStoreOptions = {
  /** Cap on settled view entries without active subscribers or open pending state. */
  maxSettledViews?: number
}

/** Ephemeral presentation state. Durable answers remain Session-owned; this store
 * only coordinates where an open card is being edited and local progress. */
export type ViewStatus = {
  state: 'filling' | 'filled' | 'sending' | 'failed'
  text: string
  copyKey?: 'filling' | 'filled' | 'sending' | 'answerFailed' | 'fillFailed' | 'expired' | 'dismissFailed' | 'deferFailed'
}
export type ProgressRecord = { callId: string; title: string; view: ViewNode; at: number }
export type LiveSnapshot = ViewSnapshot & { originCallId: string }
type Store = ReturnType<typeof createViewStateStore>
export function createViewStateStore(locale?: LocaleSource, options?: ViewStateStoreOptions) {
  const rawMax = options?.maxSettledViews
  const maxSettledViews = typeof rawMax === 'number' && Number.isFinite(rawMax)
    ? Math.max(1, Math.trunc(rawMax))
    : DEFAULT_MAX_SETTLED_VIEWS
  let statuses: Record<string, ViewStatus> = {}
  let pending: Record<string, PendingView> = {}
  let progress: Record<string, ProgressRecord> = {}
  let snapshots: Record<string, LiveSnapshot> = {}
  let bindings: Record<string, Record<string, unknown>> = {}
  const listeners = new Set<() => void>()
  const keySubscribers = new Map<string, number>()
  const accessOrder = new Map<string, true>()

  const touch = (key: string) => {
    accessOrder.delete(key)
    accessOrder.set(key, true)
  }

  const isProtectedKey = (key: string): boolean => {
    if ((keySubscribers.get(key) ?? 0) > 0) return true
    for (const item of Object.values(pending)) {
      if (`${item.sessionId}:${item.id}` === key) return true
      if (item.callId !== undefined && `${item.sessionId}:${item.callId}` === key) return true
    }
    return false
  }

  const evictSettled = (): boolean => {
    const evictable: string[] = []
    for (const key of [...accessOrder.keys()]) {
      if (!(key in snapshots) && !(key in bindings)) {
        accessOrder.delete(key)
        continue
      }
      if (!isProtectedKey(key)) evictable.push(key)
    }
    if (evictable.length <= maxSettledViews) return false
    const overflow = evictable.length - maxSettledViews
    snapshots = { ...snapshots }
    bindings = { ...bindings }
    for (let index = 0; index < overflow; index += 1) {
      const victim = evictable[index]!
      accessOrder.delete(victim)
      delete snapshots[victim]
      delete bindings[victim]
    }
    return true
  }

  const publish = () => { for (const fn of [...listeners]) fn() }
  return {
    subscribe: (fn: () => void) => {
      const listener = () => fn()
      let active = true
      listeners.add(listener)
      return () => {
        if (!active) return
        active = false
        listeners.delete(listener)
      }
    },
    subscribeKey: (key: string, fn: () => void) => {
      const listener = () => fn()
      let active = true
      listeners.add(listener)
      keySubscribers.set(key, (keySubscribers.get(key) ?? 0) + 1)
      if (key in snapshots || key in bindings) touch(key)
      return () => {
        if (!active) return
        active = false
        listeners.delete(listener)
        const next = (keySubscribers.get(key) ?? 1) - 1
        if (next <= 0) {
          keySubscribers.delete(key)
          evictSettled()
        } else {
          keySubscribers.set(key, next)
        }
      }
    },
    status: (callId: string) => statuses[callId],
    setStatus: (callId: string, status: ViewStatus | undefined) => {
      statuses = { ...statuses }
      if (status) statuses[callId] = status
      else delete statuses[callId]
      publish()
    },
    pending: (sessionId: string) => Object.values(pending).filter(item => item.sessionId === sessionId),
    pendingFor: (sessionId: string, callId: string) => Object.values(pending).find(item => item.sessionId === sessionId && item.callId === callId),
    setPending: (record: PendingView | undefined) => {
      pending = { ...pending }
      if (record) {
        // The Host keeps one live answer per session, not a history of pending cards.
        for (const key of Object.keys(pending)) if (key.startsWith(`${record.sessionId}:`)) delete pending[key]
        pending[`${record.sessionId}:${record.callId ?? record.id}`] = record
      }
      evictSettled()
      publish()
    },
    clearPending: (sessionId: string, callId: string) => {
      const key = `${sessionId}:${callId}`
      if (!(key in pending)) return
      pending = { ...pending }
      delete pending[key]
      evictSettled()
      publish()
    },
    setProgress: (sessionId: string, record: Omit<ProgressRecord, 'at'>) => {
      const current = progress[sessionId]
      if (current?.callId === record.callId && current.title === record.title && current.view === record.view) return
      progress = { ...progress, [sessionId]: { ...record, at: Date.now() } }
      publish()
    },
    clearProgress: (sessionId: string) => {
      if (!(sessionId in progress)) return
      progress = { ...progress }
      delete progress[sessionId]
      publish()
    },
    progress: (sessionId: string) => progress[sessionId],
    latest: (sessionId: string, viewId: string | undefined) => {
      if (!viewId) return undefined
      const key = `${sessionId}:${viewId}`
      const hit = snapshots[key]
      if (hit !== undefined) touch(key)
      return hit
    },
    setSnapshot: (record: LiveSnapshot) => {
      const key = `${record.sessionId}:${record.id}`
      const current = snapshots[key]
      if (current && current.revision >= record.revision) {
        touch(key)
        return
      }
      const originCallId = current?.originCallId ?? record.originCallId
      snapshots = { ...snapshots, [key]: { ...record, originCallId } }
      touch(key)
      evictSettled()
      publish()
    },
    values: (sessionId: string, viewId: string) => {
      const key = `${sessionId}:${viewId}`
      const hit = bindings[key]
      if (hit !== undefined) touch(key)
      return hit
    },
    setValues: (sessionId: string, viewId: string, values: Record<string, unknown>) => {
      const key = `${sessionId}:${viewId}`
      bindings = { ...bindings, [key]: values }
      touch(key)
      evictSettled()
      publish()
    },
    localeSnapshot: () => locale?.getSnapshot?.(),
    localeSubscribe: (fn: () => void) => locale?.subscribe?.(fn) ?? (() => {}),
  }
}

export function useLiveSnapshot(store: Store, sessionId: string, viewId: string | undefined) {
  const subscribe = useCallback((fn: () => void) => viewId ? store.subscribeKey(`${sessionId}:${viewId}`, fn) : store.subscribe(fn), [store, sessionId, viewId])
  return useSyncExternalStore(subscribe, () => store.latest(sessionId, viewId), () => store.latest(sessionId, viewId))
}
export function useViewValues(store: Store, sessionId: string, viewId: string) {
  const subscribe = useCallback((fn: () => void) => store.subscribeKey(`${sessionId}:${viewId}`, fn), [store, sessionId, viewId])
  return useSyncExternalStore(subscribe, () => store.values(sessionId, viewId), () => store.values(sessionId, viewId))
}

export function useViewLocale(store: Store) {
  return useSyncExternalStore(store.localeSubscribe, store.localeSnapshot, store.localeSnapshot)
}
/** Slot translation functions are stable identities. Explicitly read the active
 * locale so retained status text also changes when the user switches language. */
export function useViewT(store: Store, fallback: (key: string, params?: Record<string, unknown>) => string) {
  const locale = useViewLocale(store)?.active?.toLowerCase()
  return useMemo(() => (key: string, params?: Record<string, unknown>) => {
    const table = locale?.startsWith('zh') ? uiZh : locale?.startsWith('en') ? uiEn : undefined
    const text = key in (table ?? {}) ? table?.[key as keyof typeof uiZh] : fallback(key, params)
    return String(text ?? key).replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? `{${name}}`))
  }, [locale, fallback])
}

export function useViewStatus(store: Store, callId: string) {
  return useSyncExternalStore(store.subscribe, () => store.status(callId), () => store.status(callId))
}
export function useViewPending(store: Store, sessionId: string, callId: string) {
  return useSyncExternalStore(store.subscribe, () => store.pendingFor(sessionId, callId), () => store.pendingFor(sessionId, callId))
}
export function useLatestPending(store: Store, sessionId: string) {
  return useSyncExternalStore(store.subscribe, () => store.pending(sessionId).at(-1), () => store.pending(sessionId).at(-1))
}
export function useViewProgress(store: Store, sessionId: string) {
  return useSyncExternalStore(store.subscribe, () => store.progress(sessionId), () => store.progress(sessionId))
}
