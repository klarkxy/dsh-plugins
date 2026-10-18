// Current-host selection is read per call as config.searchProvider.get() ?? searchProviderEnv.
// The installed development package still snapshots those inputs into searchProviderId, so this
// suite builds that newer shape itself. Passing the old WebRuntime here would not prove it.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebError, type WebFetchProvider, type WebSearchProvider } from '@deepseek-ai/dsh-web'
import { WebSearchManager } from './manager.ts'

type Kind = 'search' | 'fetch'
type Provider = WebSearchProvider | WebFetchProvider
/** What the host reads from a selection cell. `value` is the unfrozen stand-in's own field. */
type VolatileField = { get(): string | undefined, value?: string | undefined }
class Selection {
  constructor(public value: string | undefined) {}
  get(): string | undefined { return this.value }
}
class CurrentHost {
  searchProviders = new Map<string, Provider>()
  fetchProviders = new Map<string, Provider>()
  searchProviderEnv: string | undefined
  fetchProviderEnv: string | undefined
  config: { searchProvider: VolatileField, fetchProvider: VolatileField }
  constructor(search: string | undefined, fetch: string | undefined) {
    this.config = { searchProvider: new Selection(search), fetchProvider: new Selection(fetch) }
  }
  registerSearchProvider(provider: WebSearchProvider): () => void { return this.register('search', provider) }
  registerFetchProvider(provider: WebFetchProvider): () => void { return this.register('fetch', provider) }
  private register(kind: Kind, provider: Provider): () => void {
    const map = kind === 'search' ? this.searchProviders : this.fetchProviders
    if (map.has(provider.id)) throw new WebError(`duplicate ${provider.id}`, 'WEB_DUPLICATE_PROVIDER')
    map.set(provider.id, provider)
    return () => { map.delete(provider.id) }
  }
  private resolve(kind: Kind): Provider {
    const configured = (kind === 'search' ? this.config.searchProvider.get() ?? this.searchProviderEnv
      : this.config.fetchProvider.get() ?? this.fetchProviderEnv)
    const providers = kind === 'search' ? this.searchProviders : this.fetchProviders
    if (configured !== undefined) {
      const provider = providers.get(configured)
      if (!provider) throw new WebError(`missing ${configured}`, 'WEB_PROVIDER_CONFIGURED_MISSING')
      if (!provider.available()) throw new WebError(`unavailable ${configured}`, 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE')
      return provider
    }
    const usable = [...providers.values()].filter(provider => provider.available())
    if (usable.length === 0) throw new WebError('none', 'WEB_PROVIDER_UNAVAILABLE')
    if (usable.length > 1) throw new WebError(usable.map(provider => provider.id).join(','), 'WEB_PROVIDER_AMBIGUOUS')
    return usable[0]
  }
  async search(request: { query: string }, signal?: AbortSignal): Promise<{ sources: Array<{ url: string }>; truncated: false }> {
    const provider = this.resolve('search') as WebSearchProvider
    return provider.search(request, signal) as Promise<{ sources: Array<{ url: string }>; truncated: false }>
  }
  async fetch(request: { url: string }, signal?: AbortSignal) {
    const provider = this.resolve('fetch') as WebFetchProvider
    return provider.fetch(request, signal)
  }
}

/** cosmokit/lib createVolatile: the cell the host reads on every call is frozen, so `get` is an
 * own non-configurable data property and a get trap may not answer it differently. The host moves
 * the value through a symbol instead. A `Selection` field is substitutable; this one is not. */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')
function createVolatile(initial: string | undefined): VolatileField {
  const store = { current: initial }
  return Object.freeze({ get: () => store.current,
    [VOLATILE_WRITE]: (value: string | undefined) => { store.current = value } })
}
function writeVolatile(field: VolatileField, value: string | undefined): void {
  ;(field as Record<symbol, (value: string | undefined) => void>)[VOLATILE_WRITE](value)
}
/** Same host, with the selection cells the running host actually builds. `frozenConfig` covers the
 * outer object too: nothing proves the host froze it, but a call view that assumes it did not would
 * break the moment it does. */
class FrozenHost extends CurrentHost {
  constructor(search: string | undefined, fetch: string | undefined, frozenConfig = false) {
    super(search, fetch)
    const pair = { searchProvider: createVolatile(search), fetchProvider: createVolatile(fetch) }
    this.config = frozenConfig ? Object.freeze(pair) : pair
  }
  /** Host-side selection update: the closed-over cell moves, the frozen members stay in place. */
  select(kind: Kind, value: string | undefined): void {
    writeVolatile(kind === 'search' ? this.config.searchProvider : this.config.fetchProvider, value)
  }
}

const cleanup: Array<() => Promise<unknown> | void> = []
afterEach(async () => { for (const off of cleanup.splice(0).reverse()) await off() })
const searchProvider = (id: string): WebSearchProvider => ({ id, available: () => true,
  search: vi.fn(async () => ({ sources: [{ url: `https://example.com/${id}` }], truncated: false })),
})
const fetchProvider = (id: string): WebFetchProvider => ({ id, available: () => true,
  fetch: vi.fn(async request => ({ url: request.url, statusCode: 200, body: { kind: 'text' as const, content: 'page' }, truncated: false })),
})
function manage(web: CurrentHost) {
  const manager = new WebSearchManager({
    web, initial: { revision: 0, searchEnabled: false, fetchEnabled: false, searchOrder: [], fetchOrder: [],
      searchProvider: '', fetchProvider: '', maxResults: 5, maxQueries: 1, timeoutMs: 10_000, maxFetchChars: 20_000, endpoints: {} },
    save: async () => {}, resolveCredential: async () => undefined,
  })
  cleanup.push(() => manager.dispose())
  return manager
}
async function enable(manager: WebSearchManager, patch: { searchOrder?: string[]; fetchOrder?: string[] }) {
  const { revision, ...settings } = manager.status().settings
  await manager.update({
    ...settings,
    searchEnabled: patch.searchOrder !== undefined ? true : settings.searchEnabled,
    fetchEnabled: patch.fetchOrder !== undefined ? true : settings.fetchEnabled,
    ...patch,
  }, revision)
}

describe('current host selection shape, not the installed development WebRuntime', () => {
  it('orders providers while config and env selections stay stored', async () => {
    const web = new CurrentHost('search-first', 'fetch-first')
    web.searchProviderEnv = 'search-env'
    web.fetchProviderEnv = 'fetch-env'
    const searches = [searchProvider('search-first'), searchProvider('search-second')]
    const fetches = [fetchProvider('fetch-first'), fetchProvider('fetch-second')]
    for (const provider of searches) web.registerSearchProvider(provider)
    for (const provider of fetches) web.registerFetchProvider(provider)
    const manager = manage(web)
    await enable(manager, { searchOrder: ['search-second', 'search-first'], fetchOrder: ['fetch-second', 'fetch-first'] })
    await web.search({ query: 'managed' })
    await web.fetch({ url: 'https://example.com' })
    expect(searches[1].search).toHaveBeenCalledOnce()
    expect(fetches[1].fetch).toHaveBeenCalledOnce()
    expect(searches[0].search).not.toHaveBeenCalled()
    expect(web.config.searchProvider.get()).toBe('search-first')
    expect(web.searchProviderEnv).toBe('search-env')
    expect(web.config.fetchProvider).toBeInstanceOf(Selection)
    expect(web.fetchProviderEnv).toBe('fetch-env')
  })
  it('follows a saved selection change without remounting and restores it on unload', async () => {
    const web = new CurrentHost('search-first', undefined)
    const first = searchProvider('search-first')
    const second = searchProvider('search-second')
    web.registerSearchProvider(first)
    web.registerSearchProvider(second)
    const manager = manage(web)
    await enable(manager, { searchOrder: ['search-second'] })
    web.config.searchProvider.value = 'search-second'
    web.searchProviderEnv = 'search-first'
    await web.search({ query: 'still managed' })
    expect(second.search).toHaveBeenCalledOnce()
    expect(first.search).not.toHaveBeenCalled()
    await manager.dispose()
    await web.search({ query: 'restored saved selection' })
    expect(second.search).toHaveBeenCalledTimes(2)
    web.config.searchProvider.value = undefined
    await web.search({ query: 'restored env selection' })
    expect(first.search).toHaveBeenCalledOnce()
    expect(web.searchProviderEnv).toBe('search-first')
  })
  it('does not report the wrapped providers as ambiguous', async () => {
    const web = new CurrentHost(undefined, undefined)
    web.registerSearchProvider(searchProvider('one'))
    web.registerSearchProvider(searchProvider('two'))
    const manager = manage(web)
    await enable(manager, { searchOrder: ['two', 'one'] })
    await expect(web.search({ query: 'ranked' })).resolves.toMatchObject({ sources: [{ url: 'https://example.com/two' }] })
  })
  it('keeps two current-host instances independent', async () => {
    const left = new CurrentHost('left-pin', undefined)
    const right = new CurrentHost('right-pin', undefined)
    const leftPin = searchProvider('left-pin')
    const leftOther = searchProvider('left-other')
    const rightPin = searchProvider('right-pin')
    const rightOther = searchProvider('right-other')
    left.registerSearchProvider(leftPin); left.registerSearchProvider(leftOther)
    right.registerSearchProvider(rightPin); right.registerSearchProvider(rightOther)
    const manager = manage(left)
    await enable(manager, { searchOrder: ['left-other'] })
    await left.search({ query: 'managed' })
    await right.search({ query: 'native' })
    expect(leftOther.search).toHaveBeenCalledOnce()
    expect(rightPin.search).toHaveBeenCalledOnce()
    expect(Object.hasOwn(left, 'search')).toBe(true)
    expect(Object.hasOwn(right, 'search')).toBe(false)
    expect(Object.hasOwn(CurrentHost.prototype, 'search')).toBe(true)
    await manager.dispose()
    expect(Object.hasOwn(left, 'search')).toBe(false)
    await left.search({ query: 'restored' })
    expect(leftPin.search).toHaveBeenCalledOnce()
    expect(rightPin.search).toHaveBeenCalledOnce()
  })
  it('refuses a second manager and a host with neither selection shape', () => {
    const web = new CurrentHost(undefined, undefined)
    const manager = manage(web)
    expect(() => manage(web)).toThrow(/另一个/)
    expect(() => manage({ searchProviders: new Map(), fetchProviders: new Map(),
      registerSearchProvider() { return () => {} }, registerFetchProvider() { return () => {} },
    } as unknown as CurrentHost)).toThrow(/兼容/)
    void manager
  })
  it('rolls back map and method ownership when attachment fails partway', () => {
    const web = new CurrentHost('pinned', undefined)
    const original = searchProvider('pinned')
    web.registerSearchProvider(original)
    Object.defineProperty(web, 'fetch', { value: 'not-a-method', writable: false, configurable: false })
    expect(() => manage(web)).toThrow(/恢复原状/)
    expect(web.searchProviders.get('pinned')).toBe(original)
    expect(Object.hasOwn(web.searchProviders, 'set')).toBe(false)
    expect(Object.hasOwn(web, 'search')).toBe(false)
  })
})

describe.each([
  { label: 'plain config', frozenConfig: false },
  { label: 'frozen config', frozenConfig: true },
])('frozen volatile selection cell over a $label', ({ frozenConfig }) => {
  it('ranks providers while the frozen cells keep their own selection', async () => {
    const web = new FrozenHost('search-first', 'fetch-first', frozenConfig)
    web.searchProviderEnv = 'search-env'
    web.fetchProviderEnv = 'fetch-env'
    const searches = [searchProvider('search-first'), searchProvider('search-second')]
    const fetches = [fetchProvider('fetch-first'), fetchProvider('fetch-second')]
    for (const provider of searches) web.registerSearchProvider(provider)
    for (const provider of fetches) web.registerFetchProvider(provider)
    const manager = manage(web)
    await enable(manager, { searchOrder: ['search-second', 'search-first'], fetchOrder: ['fetch-second', 'fetch-first'] })
    await web.search({ query: 'managed' })
    await web.fetch({ url: 'https://example.com' })
    expect(searches[1].search).toHaveBeenCalledOnce()
    expect(fetches[1].fetch).toHaveBeenCalledOnce()
    expect(searches[0].search).not.toHaveBeenCalled()
    expect(fetches[0].fetch).not.toHaveBeenCalled()
    // Untouched objects: same stored ids, same env fallback, still no own `value` to write through.
    expect(web.config.searchProvider.get()).toBe('search-first')
    expect(web.config.fetchProvider.get()).toBe('fetch-first')
    expect(web.searchProviderEnv).toBe('search-env')
    expect(web.fetchProviderEnv).toBe('fetch-env')
  })
  it('follows a write into the frozen cell while managed and restores it on unload', async () => {
    const web = new FrozenHost('search-first', undefined, frozenConfig)
    const first = searchProvider('search-first')
    const second = searchProvider('search-second')
    web.registerSearchProvider(first)
    web.registerSearchProvider(second)
    const manager = manage(web)
    await enable(manager, { searchOrder: ['search-second'] })
    web.select('search', 'search-second')
    web.searchProviderEnv = 'search-first'
    await web.search({ query: 'still managed' })
    expect(second.search).toHaveBeenCalledOnce()
    expect(first.search).not.toHaveBeenCalled()
    // The write went through the cell's own closure, so it outlives the managed call.
    expect(web.config.searchProvider.get()).toBe('search-second')
    await manager.dispose()
    await web.search({ query: 'restored saved selection' })
    expect(second.search).toHaveBeenCalledTimes(2)
    expect(web.config.searchProvider.get()).toBe('search-second')
    web.select('search', undefined)
    await web.search({ query: 'restored env selection' })
    expect(first.search).toHaveBeenCalledOnce()
    expect(web.searchProviderEnv).toBe('search-first')
  })
})
