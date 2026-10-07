import { WebError, type WebSearchProvider, type WebFetchProvider } from '@deepseek-ai/dsh-web'
import type { ProviderKind } from './contracts.ts'

export interface WebRegistry {
  registerSearchProvider(provider: WebSearchProvider): () => void
  registerFetchProvider(provider: WebFetchProvider): () => void
}
export type NativeProvider = WebSearchProvider | WebFetchProvider
type Runtime = WebRegistry & {
  searchProviders: Map<string, NativeProvider>
  fetchProviders: Map<string, NativeProvider>
  searchProviderId?: string
  fetchProviderId?: string
}
const owner = Symbol.for('@klarkxy/dsh-web-search-manager/registry-owner')

/** The only private-host boundary. Verified against DSH 0.2.0-rc.2.
 * Keep the actual Maps: Cordis effects capture them for automatic unregistration.
 * Replace this bridge when the host exposes enumeration/selection publicly.
 */
function runtimeOf(web: WebRegistry): Runtime {
  const runtime = web as Runtime
  if (!(runtime.searchProviders instanceof Map) || !(runtime.fetchProviders instanceof Map)
    || !Object.hasOwn(runtime, 'searchProviderId') || !Object.hasOwn(runtime, 'fetchProviderId')) {
    throw new WebError('当前 ctx.web 不支持注册表管理，请使用兼容的 DSH 版本。', 'WEB_REGISTRY_UNSUPPORTED')
  }
  return runtime
}
export function hasWebProvider(web: WebRegistry, kind: ProviderKind, id: string): boolean {
  return runtimeOf(web)[kind === 'search' ? 'searchProviders' : 'fetchProviders'].has(id)
}

export function observeWebRegistry(web: WebRegistry, hooks: {
  add(kind: ProviderKind, provider: NativeProvider): NativeProvider
  remove(kind: ProviderKind, id: string): void
}): () => void {
  const runtime = runtimeOf(web)
  const maps = [runtime.searchProviders, runtime.fetchProviders]
  if (maps.some(map => Object.hasOwn(map, owner))) {
    throw new WebError('ctx.web 已由另一个搜索管理器管理。', 'WEB_REGISTRY_MANAGED')
  }
  const undo: Array<() => void> = []
  try {
    for (const [kind, map] of [['search', maps[0]], ['fetch', maps[1]]] as const) {
      Object.defineProperty(map, owner, { value: true, configurable: true })
      undo.push(() => { delete (map as unknown as Record<symbol, unknown>)[owner] })
      const originals = new Map<string, { original: NativeProvider; wrapped: NativeProvider }>()
      const set = map.set, remove = map.delete, clear = map.clear
      const wrap = (id: string, provider: NativeProvider) => {
        const wrapped = hooks.add(kind, provider)
        originals.set(id, { original: provider, wrapped })
        return wrapped
      }
      undo.push(() => {
        // Never resurrect removed providers or overwrite another owner's mutations.
        for (const [id, row] of originals) if (map.get(id) === row.wrapped) set.call(map, id, row.original)
      })
      for (const [id, provider] of map) set.call(map, id, wrap(id, provider))
      const replacements = {
        set(id: string, provider: NativeProvider) {
          const wrapped = wrap(id, provider)
          set.call(map, id, wrapped)
          return map
        },
        delete(id: string) {
          const removed = remove.call(map, id)
          if (removed) { originals.delete(id); hooks.remove(kind, id) }
          return removed
        },
        clear() {
          const ids = [...map.keys()]
          clear.call(map)
          originals.clear()
          for (const id of ids) hooks.remove(kind, id)
        },
      }
      for (const key of ['set', 'delete', 'clear'] as const) {
        const before = Object.getOwnPropertyDescriptor(map, key)
        Object.defineProperty(map, key, { value: replacements[key], configurable: true, writable: true })
        undo.push(() => {
          if (map[key] !== replacements[key]) return
          if (before) Object.defineProperty(map, key, before)
          else delete (map as unknown as Record<string, unknown>)[key]
        })
      }
    }
    for (const key of ['searchProviderId', 'fetchProviderId'] as const) {
      const before = Object.getOwnPropertyDescriptor(runtime, key)!
      Object.defineProperty(runtime, key, { ...before, value: undefined })
      undo.push(() => {
        if (runtime[key] === undefined) Object.defineProperty(runtime, key, before)
      })
    }
  } catch (error) {
    for (const restore of undo.reverse()) restore()
    throw new WebError('无法接管 ctx.web 注册表，已恢复原状。', 'WEB_REGISTRY_UNSUPPORTED', { cause: error })
  }
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    for (const restore of undo.reverse()) restore()
  }
}
