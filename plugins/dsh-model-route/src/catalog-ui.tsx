import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  checkedModelCatalog, modelCatalogErrorMessage, modelCatalogFailures, parseModelMenuChoices,
  type ModelCatalogFailure, type ModelMenuChoice,
} from './catalog.ts'

export interface UseModelCatalogOptions {
  /** Used only on mount; subsequent changes come from load(). */
  readonly initialCatalog?: unknown
  /** Disables initial, focus, subscription, and manual refreshes. */
  readonly enabled?: boolean
  readonly subscribe?: (onChange: () => void) => (() => void) | undefined
}

export interface ModelCatalogState {
  readonly catalog: unknown
  readonly choices: ModelMenuChoice[]
  readonly loading: boolean
  readonly error: string
  readonly failures: readonly ModelCatalogFailure[]
  readonly refresh: () => Promise<void>
}

type Snapshot = Pick<ModelCatalogState, 'catalog' | 'loading' | 'error'>

/**
 * Latest refresh wins, including retries while a previous request is pending.
 * Keep load stable (for example with useCallback); changing it invalidates the
 * previous source and fetches again, so switching clients cannot publish stale data.
 */
export function useModelCatalog(load: () => Promise<unknown>, options: UseModelCatalogOptions = {}): ModelCatalogState {
  const enabled = options.enabled !== false
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const live = useRef(false)
  const source = useRef(load)
  const revision = useRef(0)
  const [state, setState] = useState<Snapshot>(() => {
    try {
      return { catalog: options.initialCatalog === undefined ? undefined : checkedModelCatalog(options.initialCatalog), loading: enabled, error: '' }
    } catch (error) {
      return { catalog: undefined, loading: enabled, error: modelCatalogErrorMessage(error) }
    }
  })
  const refresh = useCallback(async (): Promise<void> => {
    if (!live.current || !enabledRef.current) return
    const request = ++revision.current
    setState(previous => ({ ...previous, loading: true, error: '' }))
    try {
      const catalog = checkedModelCatalog(await load())
      if (live.current && request === revision.current) setState({ catalog, loading: false, error: '' })
    } catch (error) {
      if (live.current && request === revision.current) {
        setState(previous => ({ ...previous, loading: false, error: modelCatalogErrorMessage(error) }))
      }
    }
  }, [load, enabled])

  useEffect(() => {
    live.current = true
    if (source.current !== load) {
      source.current = load
      // Last-good retention belongs to one source; a new client must not
      // inherit another client's models if its initial request fails.
      setState({ catalog: undefined, loading: enabled, error: '' })
    }
    if (enabled) void refresh()
    else setState(previous => ({ ...previous, loading: false }))
    return () => { live.current = false; ++revision.current }
  }, [enabled, refresh])

  useEffect(() => {
    if (!enabled) return
    const reload = (): void => { void refresh() }
    // No polling: the host owns catalog production, and focus is a cheap
    // recovery path for missed ordinary notifications or changed credentials.
    if (typeof window !== 'undefined') window.addEventListener('focus', reload)
    let unsubscribe: (() => void) | undefined
    try { unsubscribe = options.subscribe?.(reload) } catch (error) {
      setState(previous => ({ ...previous, error: modelCatalogErrorMessage(error) }))
    }
    return () => {
      if (typeof window !== 'undefined') window.removeEventListener('focus', reload)
      unsubscribe?.()
    }
  }, [enabled, refresh, options.subscribe])

  const choices = useMemo(() => parseModelMenuChoices(state.catalog), [state.catalog])
  const failures = useMemo(() => state.catalog === undefined ? [] : modelCatalogFailures(state.catalog), [state.catalog])
  return { ...state, choices, failures, refresh }
}

export interface ModelCatalogStatusProps {
  readonly state: Pick<ModelCatalogState, 'loading' | 'error' | 'failures' | 'refresh'>
  readonly locale?: string
}

/** Also accepts a mapped state from a caller that owns broader async orchestration. */
export function ModelCatalogStatus({ state, locale }: ModelCatalogStatusProps) {
  const zh = locale?.toLowerCase().startsWith('zh') === true
  const copy = zh
    ? { loading: '正在加载模型…', error: '模型列表加载失败', partial: '部分提供商的模型未能加载', retry: '重试' }
    : { loading: 'Loading models…', error: 'Unable to load models', partial: 'Some providers could not load their models', retry: 'Retry' }
  if (!state.loading && !state.error && state.failures.length === 0) return null
  return <div className="dsh-model-catalog-status" lang={zh ? 'zh' : 'en'}>
    {state.loading ? <p role="status">{copy.loading}</p> : null}
    {state.error ? <p role="alert">{copy.error}: {state.error}</p> : null}
    {state.failures.length > 0 ? <div role="status">
      <p>{copy.partial}</p>
      <ul>{state.failures.map((failure, index) => <li key={`${failure.id}:${index}`}>{failure.name || failure.id}: {failure.message}</li>)}</ul>
    </div> : null}
    {state.error || state.failures.length > 0
      ? <Button type="button" size="sm" disabled={state.loading} onClick={() => { void state.refresh() }}>{copy.retry}</Button>
      : null}
  </div>
}
