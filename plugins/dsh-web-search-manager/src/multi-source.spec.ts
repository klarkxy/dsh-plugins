import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WebError, WebRuntime, type WebFetchProvider, type WebSearchProvider } from '@deepseek-ai/dsh-web'
import { registerBuiltins } from './builtins.ts'
import { defaultSettings, providerKey, type DiscoverableSearchProvider, type WebSettings } from './contracts.ts'
import { WebSearchManager } from './manager.ts'
import {
  canonicalSourceUrl, fuseSearchResults, isPrivateOrLocalUrl, planFetchEntries, planSearchEntries, searchProviderFamily,
} from './multi-source.ts'

const cleanup: Array<() => Promise<unknown> | void> = []
afterEach(async () => {
  for (const off of cleanup.splice(0).reverse()) await off()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

function createHost() {
  vi.stubEnv('DSH_WEB_SEARCH_PROVIDER', undefined)
  vi.stubEnv('DSH_WEB_FETCH_PROVIDER', undefined)
  const ctx = new Context()
  const web = new WebRuntime(ctx, {
    searchProvider: { get: () => undefined },
    fetchProvider: { get: () => undefined },
  } as never)
  cleanup.push(() => ctx.fiber.dispose())
  return { ctx, web }
}

async function patchSettings(manager: WebSearchManager, patch: Partial<WebSettings>) {
  const { revision, ...settings } = manager.status().settings
  return manager.update({ ...settings, ...patch }, revision)
}

describe('multi-source RRF fusion, URL canonicalization, and billing opt-in planners', () => {
  it('canonicalizes tracking URLs and fuses multi-engine hits with RRF consensus and field enrichment', () => {
    expect(canonicalSourceUrl('https://Example.com:443/docs/web/?utm_source=x&b=2&a=1&spm=123#top'))
      .toBe('https://example.com/docs/web?a=1&b=2')

    const fused = fuseSearchResults([
      {
        providerId: 'deepseek-search-api',
        rankIndex: 0,
        result: {
          sources: [
            { url: 'https://example.com/alpha', title: 'Alpha Only', snippet: 'Primary top hit' },
            { url: 'https://example.com/shared/?utm_source=ds', title: 'example.com', snippet: 'Short', publishedAt: '2026-11-18' },
          ],
          truncated: false,
        },
      },
      {
        providerId: 'ddg',
        rankIndex: 1,
        result: {
          sources: [
            { url: 'https://example.com/shared', title: 'Shared Consensus Article', snippet: 'Much richer snippet from second engine', summary: 'Detailed summary' },
            { url: 'https://example.com/beta', title: 'Beta Only', snippet: 'Secondary hit' },
          ],
          truncated: false,
        },
      },
    ], 10)

    // The 2-engine consensus URL rises above single-engine hits and merges richer fields.
    expect(fused.sources.map(item => item.url)).toEqual([
      'https://example.com/shared/?utm_source=ds',
      'https://example.com/alpha',
      'https://example.com/beta',
    ])
    expect(fused.sources[0]).toMatchObject({
      title: 'Shared Consensus Article',
      snippet: 'Much richer snippet from second engine',
      summary: 'Detailed summary',
      publishedAt: '2026-11-18',
    })
  })

  it('deduplicates equivalent DeepSeek search families and enforces per-request billing opt-in', () => {
    expect(searchProviderFamily('deepseek-search-api')).toBe('deepseek')
    expect(searchProviderFamily('deepseek-official')).toBe('deepseek')
    expect(searchProviderFamily('deepseek-managed')).toBe('deepseek')

    const ready = new Map([
      ['deepseek-search-api', { kind: 'search' as const, descriptor: { id: 'deepseek-search-api', label: 'DS API', description: '', billing: 'none' as const } }],
      ['deepseek-official', { kind: 'search' as const, descriptor: { id: 'deepseek-official', label: 'DS Msg', description: '', billing: 'model-and-tools' as const } }],
      ['tavily', { kind: 'search' as const, descriptor: { id: 'tavily', label: 'Tavily', description: '', billing: 'request' as const } }],
      ['ddg', { kind: 'search' as const, descriptor: { id: 'ddg', label: 'DDG', description: '', billing: 'none' as const } }],
    ])

    // Without opt-in, Tavily is skipped in fusion and DeepSeek family is only queried once.
    const freeOnly = planSearchEntries(
      ready,
      ['deepseek-search-api', 'deepseek-official', 'tavily', 'ddg'],
      'fusion',
      3,
      [],
    )
    expect(freeOnly.map(entry => entry.descriptor.id)).toEqual(['deepseek-search-api', 'ddg'])

    // With explicit opt-in, Tavily joins parallel fusion up to maxParallel.
    const withTavily = planSearchEntries(
      ready,
      ['deepseek-search-api', 'tavily', 'ddg'],
      'fusion',
      3,
      [providerKey('search', 'tavily')],
    )
    expect(withTavily.map(entry => entry.descriptor.id)).toEqual(['deepseek-search-api', 'tavily', 'ddg'])

    // If an un-opted paid provider is explicitly ranked #1, run #1 alone without unexpected fan-out.
    const paidPrimary = planSearchEntries(ready, ['tavily', 'ddg'], 'fusion', 3, [])
    expect(paidPrimary.map(entry => entry.descriptor.id)).toEqual(['tavily'])
  })

  it('detects private/local URLs and strips cloud fetchers from local waterfall plans', () => {
    expect(isPrivateOrLocalUrl('http://127.0.0.1:3000/api')).toBe(true)
    expect(isPrivateOrLocalUrl('http://192.168.1.20/admin')).toBe(true)
    expect(isPrivateOrLocalUrl('http://[::1]:8080/')).toBe(true)
    expect(isPrivateOrLocalUrl('http://[::ffff:10.0.0.1]:8080/')).toBe(true)
    // Hex-form v4-mapped addresses must be treated like their dotted form.
    expect(isPrivateOrLocalUrl('http://[::ffff:0a00:0001]:8080/')).toBe(true)
    expect(isPrivateOrLocalUrl('https://internal.service.local/doc')).toBe(true)
    expect(isPrivateOrLocalUrl('https://api-docs.deepseek.com/zh-cn/quick_start/pricing/')).toBe(false)
    expect(isPrivateOrLocalUrl('http://8.8.8.8/dns')).toBe(false)
    expect(isPrivateOrLocalUrl('http://172.32.0.1/net')).toBe(false)

    const fetchMap = new Map([
      ['deepseek-fetch-api', { kind: 'fetch' as const, descriptor: { id: 'deepseek-fetch-api', label: 'DS Fetch', description: '', billing: 'none' as const } }],
      ['jina', { kind: 'fetch' as const, descriptor: { id: 'jina', label: 'Jina', description: '', billing: 'none' as const } }],
      ['firecrawl', { kind: 'fetch' as const, descriptor: { id: 'firecrawl', label: 'Firecrawl', description: '', billing: 'request' as const } }],
      ['http', { kind: 'fetch' as const, descriptor: { id: 'http', label: 'HTTP', description: '', billing: 'none' as const } }],
    ])

    expect(planFetchEntries(
      fetchMap,
      ['deepseek-fetch-api', 'jina', 'firecrawl', 'http'],
      'waterfall',
      [providerKey('fetch', 'firecrawl')],
      'http://localhost:5173/preview',
    ).map(entry => entry.descriptor.id)).toEqual(['http'])
  })
})

describe('WebSearchManager multi-source runtime orchestration over ctx.web', () => {
  it('auto-seeds official free DSH 0.2.2-rc.5 host providers on fresh install and fuses results without ambiguity', async () => {
    const { web } = createHost()
    const dsSearch: WebSearchProvider = {
      id: 'deepseek-search-api',
      available: () => true,
      search: vi.fn(async () => ({
        sources: [
          { url: 'https://docs.example.org/guide?utm_medium=referral', title: 'Guide', summary: 'Official summary' },
          { url: 'https://ds.example.org/a', title: 'DS Hit', snippet: 'From DeepSeek' },
        ],
        truncated: false,
      })),
    }
    const dsFetch: WebFetchProvider = {
      id: 'deepseek-fetch-api',
      available: () => true,
      fetch: vi.fn(async request => ({
        url: request.url,
        statusCode: 403,
        body: { kind: 'text', content: '' },
        truncated: false,
      })),
    }
    const localHttp: WebFetchProvider = {
      id: 'http',
      available: () => true,
      fetch: vi.fn(async request => ({
        url: request.url,
        statusCode: 200,
        body: { kind: 'text', content: `local:${request.url}` },
        truncated: false,
      })),
    }
    web.registerSearchProvider(dsSearch)
    web.registerFetchProvider(dsFetch)
    web.registerFetchProvider(localHttp)

    const manager = new WebSearchManager({
      web,
      save: async () => {},
      resolveCredential: async () => undefined,
    })
    cleanup.push(() => manager.dispose())
    const offBuiltins = registerBuiltins(web, {
      settings: () => manager.status().settings,
      resolveCredential: async () => undefined,
    })
    cleanup.push(offBuiltins)
    await manager.refresh()

    // Fresh install seeds ['deepseek-search-api', 'ddg'] and ['deepseek-fetch-api', 'jina', 'http'].
    expect(manager.status().settings.searchOrder).toEqual(['deepseek-search-api', 'ddg'])
    expect(manager.status().settings.fetchOrder).toEqual(['deepseek-fetch-api', 'jina', 'http'])

    // Override ddg transport via a custom free provider to verify parallel fusion + surviving partial error.
    const communitySearch: DiscoverableSearchProvider = {
      id: 'community-free',
      available: () => true,
      dshWebManagement: { id: 'community-free', label: 'Community', description: 'Free index', billing: 'none' },
      search: vi.fn(async () => ({
        sources: [
          { url: 'https://docs.example.org/guide', title: 'Complete Guide Title', snippet: 'Corroborated snippet' },
        ],
        truncated: false,
      })),
    }
    web.registerSearchProvider(communitySearch)
    await patchSettings(manager, { searchOrder: ['deepseek-search-api', 'community-free'], searchMode: 'fusion' })

    const searchResult = await web.search({ query: 'dsh 0.2.2 web' })
    expect(dsSearch.search).toHaveBeenCalledOnce()
    expect(communitySearch.search).toHaveBeenCalledOnce()
    expect(searchResult.sources[0]?.url).toBe('https://docs.example.org/guide?utm_medium=referral')
    expect(searchResult.sources[0]?.summary).toBe('Official summary')
    expect(searchResult.sources[0]?.snippet).toBe('Corroborated snippet')

    // Localhost fetch bypasses cloud fetchers (deepseek-fetch-api & jina) and hits local http directly.
    const localResult = await web.fetch({ url: 'http://127.0.0.1:4321/status' })
    expect(dsFetch.fetch).not.toHaveBeenCalled()
    expect(localHttp.fetch).toHaveBeenCalledOnce()
    expect(localResult.body.content).toBe('local:http://127.0.0.1:4321/status')
  })

  it('survives partial upstream failure in fusion mode, supports failover mode, and forwards ready(llmProvider)', async () => {
    const { web } = createHost()
    const modelScoped: DiscoverableSearchProvider = {
      id: 'deepseek-official',
      available: () => true,
      ready: vi.fn(async (llmProvider?: string) => llmProvider === undefined || llmProvider === 'deepseek'),
      search: vi.fn(async () => { throw new WebError('upstream 502', 'WEB_PROVIDER_ERROR') }),
    }
    const backupFree: DiscoverableSearchProvider = {
      id: 'ddg-custom',
      available: () => true,
      dshWebManagement: { id: 'ddg-custom', label: 'DDG Custom', description: 'Free', billing: 'none' },
      search: vi.fn(async () => ({
        sources: [{ url: 'https://example.org/fallback', title: 'Fallback Hit', snippet: 'Survived' }],
        truncated: false,
      })),
    }
    web.registerSearchProvider(modelScoped)
    web.registerSearchProvider(backupFree)

    const manager = new WebSearchManager({
      web,
      initial: {
        ...defaultSettings(),
        searchEnabled: true,
        searchMode: 'fusion',
        searchOrder: ['deepseek-official', 'ddg-custom'],
      },
      save: async () => {},
      resolveCredential: async () => undefined,
    })
    cleanup.push(() => manager.dispose())
    await manager.refresh()

    // Even when llmProvider is 'anthropic' (where deepseek-official.ready is false), backupFree keeps searchReady true.
    const searchReadyFn = (web as unknown as { searchReady?: (llmProvider?: string) => Promise<boolean> }).searchReady
    if (typeof searchReadyFn === 'function') {
      expect(await searchReadyFn.call(web, 'anthropic')).toBe(true)
    }

    // In fusion mode, deepseek-official throws 502 while backupFree succeeds -> returns backupFree's sources.
    const fused = await web.search({ query: 'resilience' })
    expect(fused.sources.map(item => item.url)).toEqual(['https://example.org/fallback'])
    expect(manager.status().providers.find(p => p.id === 'deepseek-official')?.failures).toBe(1)
    expect(manager.status().providers.find(p => p.id === 'ddg-custom')?.calls).toBe(1)

    // Switch to failover mode: primary fails, backup succeeds sequentially.
    await patchSettings(manager, { searchMode: 'failover' })
    const failedOver = await web.search({ query: 'failover test' })
    expect(failedOver.sources.map(item => item.url)).toEqual(['https://example.org/fallback'])
  })
})
