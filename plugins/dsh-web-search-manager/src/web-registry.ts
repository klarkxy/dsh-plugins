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
  searchProviderEnv?: string
  fetchProviderEnv?: string
  config?: {
    searchProvider?: { get?: () => unknown }
    fetchProvider?: { get?: () => unknown }
  }
}
const owner = Symbol.for('@klarkxy/dsh-web-search-manager/registry-owner')

/** The only private-host boundary. Public ctx.web has no selection API.
 * Old hosts snapshot config/env into own searchProviderId/fetchProviderId.
 * Current hosts read config.searchProvider.get() ?? searchProviderEnv on each call
 * (fetch uses the matching pair). Keep the actual Maps: Cordis effects capture them.
 */
function runtimeOf(web: WebRegistry): Runtime {
  const runtime = web as Runtime
  const maps = runtime.searchProviders instanceof Map && runtime.fetchProviders instanceof Map
  const legacy = Object.hasOwn(runtime, 'searchProviderId') && Object.hasOwn(runtime, 'fetchProviderId')
  const current = Object.hasOwn(runtime, 'searchProviderEnv') && Object.hasOwn(runtime, 'fetchProviderEnv')
    && typeof runtime.config?.searchProvider?.get === 'function'
    && typeof runtime.config?.fetchProvider?.get === 'function'
  // Either shape is manageable. A host that still has both is managed too: the call
  // view hides every selection read the two implementations are known to use.
  if (!maps || (!legacy && !current)) {
    throw new WebError('当前 ctx.web 不支持注册表管理，请使用兼容的 DSH 版本。', 'WEB_REGISTRY_UNSUPPORTED')
  }
  return runtime
}
export function hasWebProvider(web: WebRegistry, kind: ProviderKind, id: string): boolean {
  return runtimeOf(web)[kind === 'search' ? 'searchProviders' : 'fetchProviders'].has(id)
}

/** Hide one volatile selection field without replacing the object the settings UI reads.
 * The host builds these with cosmokit's createVolatile and freezes them, so `get` is an own
 * non-configurable data property that a get trap may not answer differently. Return a standalone
 * facade instead of wrapping the cell: the call path reads one thing from it, config.<field>.get().
 */
function selectionView(field: unknown): unknown {
  if (!field || (typeof field !== 'object' && typeof field !== 'function')) return field
  return Object.freeze({ get: () => undefined })
}
/** One call sees no host selection. Config, its volatile source, and env stay on the real runtime.
 * Cordis reads own data properties from the service and ignores an Object.create overlay, so this
 * has to be a get trap. Other reads go to the traced receiver and keep that call's context. Config
 * is proxied over an empty target for the same reason as the cell: a host that froze it would make
 * the two selection fields non-configurable own properties, which no get trap may replace.
 */
function unmanagedView(runtime: Runtime, callReceiver: object): Runtime {
  return new Proxy(runtime, {
    get(target, key, receiver) {
      if (key === 'searchProviderId' || key === 'fetchProviderId' || key === 'searchProviderEnv' || key === 'fetchProviderEnv') return undefined
      if (key === 'config') {
        const config = Reflect.get(target, 'config', target) ?? {}
        return new Proxy({}, {
          get(_view, configKey) {
            if (configKey === 'searchProvider' || configKey === 'fetchProvider') {
              return selectionView(Reflect.get(config, configKey, config))
            }
            return Reflect.get(config, configKey, config)
          },
        })
      }
      if (callReceiver !== target && callReceiver !== receiver) return Reflect.get(callReceiver, key, callReceiver)
      return Reflect.get(target, key, target)
    },
  }) as Runtime
}
function isThisRuntime(runtime: Runtime, receiver: object): boolean {
  if (receiver === runtime) return true
  try {
    return Reflect.get(receiver, 'searchProviders', receiver) === runtime.searchProviders
      && Reflect.get(receiver, 'fetchProviders', receiver) === runtime.fetchProviders
  } catch { return false }
}
function installCallView(runtime: Runtime, key: 'search' | 'fetch', undo: Array<() => void>): void {
  // Own property on this service only. The Cordis proxy forwards defineProperty to that target;
  // writing the shared prototype would couple every WebRuntime.
  if (Object.hasOwn(runtime, key)) throw new TypeError(`ctx.web.${key} is already owned by this runtime`)
  let prototype: object | null = Object.getPrototypeOf(runtime)
  while (prototype && !Object.hasOwn(prototype, key)) prototype = Object.getPrototypeOf(prototype)
  const inherited = prototype ? Object.getOwnPropertyDescriptor(prototype, key) : undefined
  if (!inherited || !('value' in inherited) || typeof inherited.value !== 'function') {
    throw new TypeError(`ctx.web.${key} is not a replaceable method`)
  }
  // Close over the prototype method so the wrapper cannot recurse through itself.
  const original = inherited.value as (this: Runtime, ...args: unknown[]) => unknown
  const wrapped = function (this: object, ...args: unknown[]) {
    const receiver = isThisRuntime(runtime, this) ? unmanagedView(runtime, this) : this
    return original.call(receiver as Runtime, ...args)
  }
  Object.defineProperty(runtime, key, { value: wrapped, writable: true, configurable: true, enumerable: false })
  undo.push(() => {
    const current = Object.getOwnPropertyDescriptor(runtime, key)
    // A later owner replaced this property; restoring would discard that change.
    if (current?.value !== wrapped) return
    delete (runtime as unknown as Record<string, unknown>)[key]
  })
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
    installCallView(runtime, 'search', undo)
    installCallView(runtime, 'fetch', undo)
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
