import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WebRuntime, type WebSearchProvider, type WebFetchProvider } from '@deepseek-ai/dsh-web'
import { WebSearchManager } from './manager.ts'
import { defaultSettings, type DiscoverableSearchProvider, type WebSettings } from './contracts.ts'
import { registerBuiltins } from './builtins.ts'
import { bindZhihuWebSearch } from '../../dsh-zhihu/src/web-search-provider.ts'

const cleanup: Array<() => Promise<unknown> | void> = []
afterEach(async () => { for (const off of cleanup.splice(0).reverse()) await off(); vi.restoreAllMocks() })
const searchProvider = (id: string): WebSearchProvider => ({ id, available: () => true,
  search: vi.fn(async () => ({ sources: [{ url: `https://example.com/${id}` }] })),
})
const fetchProvider = (id: string): WebFetchProvider => ({ id, available: () => true,
  fetch: vi.fn(async request => ({ url: request.url, statusCode: 200, body: { kind: 'text', content: 'x'.repeat(2000) } })),
})
function host(config = {}) {
  const ctx = new Context()
  new WebRuntime(ctx, config)
  cleanup.push(() => ctx.fiber.dispose())
  return { ctx, web: ctx.web }
}
function manage(web: WebRuntime, initial = { ...defaultSettings(), searchEnabled: false, fetchEnabled: false, searchOrder: [] }) {
  const save = vi.fn(async (_value: WebSettings) => {})
  const resolveCredential = vi.fn(async (): Promise<string | undefined> => undefined)
  const manager = new WebSearchManager({ web, initial, save, resolveCredential })
  cleanup.push(() => manager.dispose())
  return { manager, save, resolveCredential }
}
async function update(manager: WebSearchManager, patch: Partial<WebSettings>) {
  const { revision, ...settings } = manager.status().settings
  return manager.update({ ...settings, ...patch }, revision)
}

describe('discovery from native ctx.web, using actual DSH and Cordis lifecycles', () => {
  it('discovers existing and later bare providers without an adapter or network call', async () => {
    const { web } = host()
    const early = searchProvider('vendor.search')
    web.registerSearchProvider(early)
    const { manager } = manage(web)
    const off = web.registerSearchProvider(searchProvider('late'))
    web.registerFetchProvider(fetchProvider('native-fetch'))
    expect(manager.status().providers.map(row => row.id)).toEqual(['native-fetch', 'late', 'vendor.search'])
    expect(manager.status().providers.find(row => row.id === early.id)).toMatchObject({ label: early.id, billing: 'unknown', configurationOwned: false })
    expect(manager.status().providers.find(row => row.id === early.id)?.configurationOwner).toBeUndefined()
    expect(early.search).not.toHaveBeenCalled()
    expect(manager.status().settings.searchOrder).toEqual([])
    await expect(web.search({ query: 'off' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
    off()
    expect(manager.status().providers.some(row => row.id === 'late')).toBe(false)
  })
  it('keeps provider receivers, request fields and live availability', async () => {
    const { web } = host({ searchProvider: 'old-operational-pin' })
    let available = true
    const provider: WebSearchProvider = {
      id: 'native', available() { expect(this).toBe(provider); return available },
      async search(request) { expect(this).toBe(provider); expect(request).toMatchObject({ query: 'trimmed', maxResults: 2, extra: 'kept' }); return { sources: [] } },
    }
    web.registerSearchProvider(provider)
    const { manager } = manage(web)
    await update(manager, { searchEnabled: true, searchOrder: ['native'], maxResults: 2 })
    await web.search({ query: ' trimmed ', maxResults: 8, extra: 'kept' } as { query: string; maxResults: number })
    available = false
    expect(manager.status().searchActive).toBe(false)
    await expect(update(manager, { maxQueries: 2 })).resolves.toMatchObject({ searchActive: false, settings: { searchEnabled: true, searchOrder: ['native'] } })
    await expect(web.search({ query: 'unavailable' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
  })
  it('removes provider entries when Cordis unloads the registering plugin automatically', async () => {
    const { ctx, web } = host()
    const { manager } = manage(web)
    const fiber = ctx.plugin({ name: 'late-native-provider', apply(child: Context) { child.web.registerSearchProvider(searchProvider('late')) } })
    await vi.waitFor(() => expect(manager.status().providers).toHaveLength(1))
    await fiber.dispose()
    expect(manager.status().providers).toHaveLength(0)
  })
  it('manages native fetch selection independently, and preserves it through limit edits', async () => {
    const { web } = host()
    const first = fetchProvider('first'), second = fetchProvider('second')
    web.registerFetchProvider(first); web.registerFetchProvider(second)
    const { manager } = manage(web)
    await update(manager, { fetchEnabled: true, fetchProvider: 'second', maxFetchChars: 1000 })
    const result = await web.fetch({ url: 'https://example.com' })
    expect(result.body.content).toHaveLength(1000)
    expect(result.truncated).toBe(true)
    expect(first.fetch).not.toHaveBeenCalled()
    await update(manager, { maxResults: 3 })
    expect(manager.status().settings).toMatchObject({ fetchProvider: 'second', fetchEnabled: true })
    await update(manager, { fetchEnabled: false })
    await expect(web.fetch({ url: 'https://example.com' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
  })
  it('keeps external config out of manager writes and filters unsafe optional links', async () => {
    const { web } = host()
    const provider: DiscoverableSearchProvider = { ...searchProvider('external'), dshWebManagement: {
      id: 'external', label: 'External', description: 'Owned config', billing: 'request',
      credentialRef: 'EXTERNAL_KEY', configurationOwner: 'external-plugin', defaultBaseURL: 'https://example.com',
      pricingUrl: 'javascript:bad',
    } }
    web.registerSearchProvider(provider)
    const { manager, resolveCredential } = manage(web)
    await manager.refresh()
    expect(resolveCredential).not.toHaveBeenCalled()
    expect(manager.status().providers[0]).toMatchObject({ configured: true, configurationOwner: 'external-plugin' })
    expect(manager.status().providers[0].pricingUrl).toBeUndefined()
    await expect(update(manager, { endpoints: { 'search:external': 'https://changed.example.com' } })).rejects.toMatchObject({ code: 'WEB_INVALID_CONFIG' })
  })
  it('does not let a stale credential refresh re-enable a revoked key', async () => {
    const { web } = host()
    const { manager, resolveCredential } = manage(web)
    resolveCredential.mockResolvedValue('fixture-key')
    manager.registerSearchProvider({ id: 'keyed', label: 'Keyed', description: '', billing: 'request', credentialRef: 'TEST_KEY' }, () => searchProvider('keyed'))
    await manager.refresh()
    await update(manager, { searchEnabled: true, searchOrder: ['keyed'] })
    let finishOld = (_value: string | undefined) => {}
    resolveCredential.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
    const old = manager.refresh()
    resolveCredential.mockResolvedValue(undefined)
    await manager.refresh()
    finishOld('stale-key')
    await old
    expect(manager.status().searchActive).toBe(false)
  })
  it('preserves dormant search choices and explicit empty order across reloads', async () => {
    const { web } = host()
    const initial = { ...defaultSettings(), searchOrder: ['temporarily-absent'], searchProvider: 'temporarily-absent' }
    const { manager, save } = manage(web, initial)
    await update(manager, { maxResults: 3 })
    expect(save.mock.calls[0][0].searchOrder).toEqual(['temporarily-absent'])
    const restored = searchProvider('temporarily-absent')
    web.registerSearchProvider(restored)
    await web.search({ query: 'restored' })
    expect(restored.search).toHaveBeenCalledOnce()
    await update(manager, { searchEnabled: false, searchOrder: [] })
    const saved = manager.status().settings
    await manager.dispose()
    const { manager: reloaded } = manage(web, saved)
    expect(reloaded.status()).toMatchObject({ searchActive: false, settings: { searchOrder: [] } })
  })
  it('cancels ignored signals on provider removal and does not invoke a fallback', async () => {
    const { web } = host()
    const slow = { ...searchProvider('slow'), search: vi.fn(() => new Promise<{ sources: [] }>(() => {})) }
    const fallback = searchProvider('other')
    const off = web.registerSearchProvider(slow)
    web.registerSearchProvider(fallback)
    const { manager } = manage(web)
    await update(manager, { searchEnabled: true, searchOrder: ['slow', 'other'] })
    const pending = web.search({ query: 'slow' }).catch(error => error)
    await vi.waitFor(() => expect(slow.search).toHaveBeenCalledOnce())
    off()
    expect(await pending).toMatchObject({ code: 'WEB_ABORTED' })
    expect(fallback.search).not.toHaveBeenCalled()
    await web.search({ query: 'next call' })
    expect(fallback.search).toHaveBeenCalledOnce()
  })
  it('restores the native registry and prior operational selection on unload without resurrecting removed rows', async () => {
    const { web } = host({ searchProvider: 'pinned' })
    const pinned = searchProvider('pinned'), gone = searchProvider('gone')
    web.registerSearchProvider(pinned)
    const off = web.registerSearchProvider(gone)
    const { manager } = manage(web)
    off()
    await manager.dispose()
    expect((web as unknown as { searchProviders: Map<string, WebSearchProvider> }).searchProviders.get('pinned')).toBe(pinned)
    expect((web as unknown as { searchProviders: Map<string, WebSearchProvider> }).searchProviders.has('gone')).toBe(false)
    await web.search({ query: 'native restored' })
    expect(pinned.search).toHaveBeenCalledOnce()
  })
  it('handles replacement and clear, and restores the latest original provider', async () => {
    const { web } = host()
    const { manager } = manage(web)
    const map = (web as unknown as { searchProviders: Map<string, WebSearchProvider> }).searchProviders
    const first = searchProvider('same'), second = searchProvider('same')
    map.set('same', first)
    await update(manager, { searchEnabled: true, searchOrder: ['same'] })
    const stale = map.get('same')!
    map.set('same', second)
    expect(stale.available()).toBe(false)
    await expect(stale.search({ query: 'stale' })).rejects.toMatchObject({ code: 'WEB_DISABLED' })
    expect(manager.status().providers).toHaveLength(1)
    await manager.dispose()
    expect(map.get('same')).toBe(second)
    const { manager: next } = manage(web)
    map.clear()
    expect(next.status().providers).toHaveLength(0)
    await next.dispose()
    expect(map.size).toBe(0)
    expect(Object.hasOwn(map, 'set')).toBe(false)
  })
  it('refuses multiple managers and rolls back a partially failed attachment', async () => {
    const { web } = host({ searchProvider: 'pinned' })
    const original = searchProvider('pinned')
    web.registerSearchProvider(original)
    const { manager } = manage(web)
    expect(() => manage(web)).toThrow(/另一个/)
    await manager.dispose()
    const runtime = web as unknown as { searchProviders: Map<string, WebSearchProvider>; fetchProviders: Map<string, WebFetchProvider> }
    Object.preventExtensions(runtime.fetchProviders)
    expect(() => manage(web)).toThrow(/恢复原状/)
    expect(runtime.searchProviders.get('pinned')).toBe(original)
    expect(Object.hasOwn(runtime.searchProviders, 'set')).toBe(false)
    await web.search({ query: 'still native' })
    expect(original.search).toHaveBeenCalledOnce()
  })
  it('reports unsupported runtimes explicitly', () => {
    expect(() => new WebSearchManager({ web: { registerSearchProvider: () => () => {}, registerFetchProvider: () => () => {} },
      resolveCredential: async () => undefined, save: async () => {} })).toThrow(/兼容/)
  })
  it('does not replace already registered official/builtin ids', async () => {
    const { web } = host()
    const native = searchProvider('deepseek-official'), http = fetchProvider('http')
    web.registerSearchProvider(native); web.registerFetchProvider(http)
    const { manager } = manage(web)
    const off = registerBuiltins(web, { settings: () => manager.status().settings, resolveCredential: async () => undefined })
    await manager.refresh()
    expect(manager.status().providers.filter(row => row.id === native.id)).toHaveLength(1)
    expect(manager.status().providers.find(row => row.id === 'http')?.configurationOwned).toBe(false)
    off()
    expect(manager.status().providers.map(row => row.id)).toEqual(['http', 'deepseek-official'])
    await manager.dispose()
    expect((web as unknown as { fetchProviders: Map<string, WebFetchProvider> }).fetchProviders.get('http')).toBe(http)
  })
  it('allows official providers to load after bundled fallbacks and retains legacy configuration', async () => {
    const { web } = host()
    const initial = { ...defaultSettings(), searchOrder: ['deepseek-official'], searchProvider: 'deepseek-official',
      endpoints: { 'search:deepseek-official': 'https://custom.example.com' } }
    const { manager, save, resolveCredential } = manage(web, initial)
    resolveCredential.mockResolvedValue('fixture-key')
    const off = registerBuiltins(web, { settings: () => manager.status().settings, resolveCredential })
    await manager.refresh()
    expect(manager.status().settings).toMatchObject({ searchOrder: ['deepseek-managed'], searchProvider: 'deepseek-managed', fetchProvider: 'http-managed',
      endpoints: { 'search:deepseek-official': 'https://custom.example.com', 'search:deepseek-managed': 'https://custom.example.com' } })
    expect(initial.searchOrder).toEqual(['deepseek-official'])
    expect(save).not.toHaveBeenCalled()
    const native = searchProvider('deepseek-official'), http = fetchProvider('http')
    expect(() => web.registerSearchProvider(native)).not.toThrow()
    expect(() => web.registerFetchProvider(http)).not.toThrow()
    expect(manager.status().settings.searchOrder).toEqual(['deepseek-managed'])
    await update(manager, { maxResults: 3 })
    expect(save.mock.calls.at(-1)?.[0].endpoints).toMatchObject(initial.endpoints)
    off()
    expect(manager.status().providers.map(row => row.id)).toEqual(['http', 'deepseek-official'])
  })
  it('keeps unchanged legacy endpoint values when a native provider owns the id', async () => {
    const { web } = host()
    web.registerSearchProvider(searchProvider('deepseek-official'))
    const initial = { ...defaultSettings(), searchOrder: ['deepseek-official'],
      endpoints: { 'search:deepseek-official': 'https://legacy.example.com' } }
    const { manager } = manage(web, initial)
    await expect(update(manager, { maxResults: 3 })).resolves.toMatchObject({ settings: { endpoints: initial.endpoints } })
    await expect(update(manager, { endpoints: { 'search:deepseek-official': 'https://new.example.com' } })).rejects.toMatchObject({ code: 'WEB_INVALID_CONFIG' })
  })
  it.each([true, false])('registers Zhihu natively in either load order (manager first=%s)', async managerFirst => {
    const { ctx, web } = host()
    let key = 'fixture-first-secret'
    const tokens: string[] = []
    const service = {
      run: <T>(work: (signal: AbortSignal) => Promise<T>, signal: AbortSignal) => work(signal),
      toolOptions: { resolveCredential: async () => key, onExecuted: () => {},
        fetcher: async (_url: string, init?: { headers?: Record<string, string> }) => {
          tokens.push(init?.headers?.Authorization ?? '')
          return { ok: true, status: 200, text: async () => '', json: async () => ({ Code: 0, Data: { Items: [{ Title: 'Zhihu', Url: 'https://example.com/zhihu' }] } }) }
        },
      },
    }
    let manager: WebSearchManager | undefined
    if (managerFirst) manager = manage(web).manager
    const plugin = ctx.plugin({ name: 'native-zhihu-binding', apply(child: Context) { bindZhihuWebSearch(child, service) } })
    await vi.waitFor(() => expect((web as unknown as { searchProviders: Map<string, WebSearchProvider> }).searchProviders.size).toBe(1))
    if (!managerFirst) manager = manage(web).manager
    ctx.on('web/provider-availability-updated', () => { void manager!.refresh() })
    await vi.waitFor(() => expect(manager!.status().providers[0]?.configured).toBe(true))
    await update(manager!, { searchEnabled: true, searchOrder: ['zhihu-global'] })
    await web.search({ query: 'q' })
    key = 'fixture-rotated-secret'
    await web.search({ query: 'rotated' })
    expect(tokens).toEqual(['Bearer fixture-first-secret', 'Bearer fixture-rotated-secret'])
    key = ''
    ctx.emit('credentials/reference-updated', 'ZHIHU_ACCESS_TOKEN' as never)
    await vi.waitFor(() => expect(manager!.status().searchActive).toBe(false))
    await plugin.dispose()
    expect(manager!.status().providers).toHaveLength(0)
  })
})
