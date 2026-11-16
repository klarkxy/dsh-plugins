import { useMemo, useSyncExternalStore } from 'react'
import type { PendingView, ViewNode } from './contracts.ts'
import { uiEn, uiZh } from './copy.ts'

export type LocaleSource = { getSnapshot?(): { active?: string }; subscribe?(listener: () => void): () => void }

/** Ephemeral presentation state. Durable answers remain Session-owned; this store
 * only coordinates where an open card is being edited and local progress. */
export type ViewStatus = {
  state: 'filling' | 'filled' | 'sending' | 'failed'
  text: string
  copyKey?: 'filling' | 'filled' | 'sending' | 'answerFailed' | 'fillFailed' | 'expired' | 'dismissFailed'
}
export type ProgressRecord = { callId: string; title: string; view: ViewNode; at: number }
type Store = ReturnType<typeof createViewStateStore>
export function createViewStateStore(locale?: LocaleSource) {
  let statuses: Record<string, ViewStatus> = {}
  let pending: Record<string, PendingView> = {}
  let progress: Record<string, ProgressRecord> = {}
  const listeners = new Set<() => void>()
  const publish = () => { for (const fn of [...listeners]) fn() }
  return {
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
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
      publish()
    },
    clearPending: (sessionId: string, callId: string) => {
      const key = `${sessionId}:${callId}`
      if (!(key in pending)) return
      pending = { ...pending }
      delete pending[key]
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
    localeSnapshot: () => locale?.getSnapshot?.(),
    localeSubscribe: (fn: () => void) => locale?.subscribe?.(fn) ?? (() => {}),
  }
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
