import { afterEach, describe, expect, it, vi } from 'vitest'
import { PerplexitySearchProvider, YouSearchProvider } from './rest-search.ts'
import { FirecrawlFetchProvider } from './firecrawl-fetch.ts'
import { MAX_RESPONSE_BYTES } from './http-json.ts'
import { searchProviderInfo, usesBundledPricing } from './provider-info.ts'
import type { ProviderView } from './contracts.ts'

const source = (n: number) => ({ url: `https://example.com/${n}`, title: `Page ${n}`, snippet: 'excerpt' })
afterEach(() => vi.unstubAllGlobals())

it('keeps new bilingual billing notes separate from dated numeric prices and Firecrawl search', () => {
  for (const [id, kind] of [['perplexity', 'search'], ['you', 'search'], ['firecrawl', 'fetch']] as const) {
    const provider: ProviderView = { id, kind, label: id, description: '', billing: 'request', configured: false, calls: 0, failures: 0, configurationOwned: true }
    expect(searchProviderInfo(provider, 'zh').pricing).not.toBe(searchProviderInfo(provider, 'en').pricing)
    expect(searchProviderInfo(provider, 'en').pricing).toContain('account')
    expect(usesBundledPricing(provider)).toBe(false)
    if (kind === 'fetch') expect(searchProviderInfo(provider, 'en').pricing).toContain('separately from search')
  }
})

describe('official search API adapters', () => {
  it('Perplexity uses Search API Bearer auth and count without generating answers', async () => {
    const transport = vi.fn(async () => Response.json({ results: [source(1), source(2), source(3)] }))
    const signal = new AbortController().signal
    const provider = new PerplexitySearchProvider({ apiKey: 'fixture-secret', baseURL: 'https://proxy.example/prefix', fetch: transport })
    expect(provider.available()).toBe(true)
    expect(transport).not.toHaveBeenCalled()
    const result = await provider.search({ query: ' search ', maxResults: 2 }, signal)
    expect(result).toEqual({ sources: [source(1), source(2)], truncated: true })
    const [url, options] = transport.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(url)).toBe('https://proxy.example/prefix/search')
    expect(options).toMatchObject({ method: 'POST', redirect: 'error', signal, headers: { authorization: 'Bearer fixture-secret' } })
    expect(JSON.parse(String(options.body))).toEqual({ query: 'search', max_results: 2, search_type: 'web' })
  })
  it('You.com uses POST with snippets, combines sections, deduplicates and caps the total', async () => {
    const transport = vi.fn(async () => Response.json({ results: {
      web: [{ ...source(1), snippets: ['first', 'second'] }, { url: 'javascript:bad' }],
      news: [{ ...source(1), description: 'duplicate' }, { ...source(2), description: 'news' }, source(3)],
    } }))
    const provider = new YouSearchProvider({ apiKey: 'fixture-key', fetch: transport })
    const result = await provider.search({ query: 'query', maxResults: 2 })
    expect(result).toEqual({ sources: [{ ...source(1), snippet: 'first\nsecond' }, { ...source(2), snippet: 'news' }], truncated: true })
    const [url, options] = transport.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(url)).toBe('https://ydc-index.io/v1/search')
    expect(options.headers).toMatchObject({ 'x-api-key': 'fixture-key' })
    expect(JSON.parse(String(options.body))).toEqual({ query: 'query', count: 2 })
  })
  it.each([PerplexitySearchProvider, YouSearchProvider])('validates locally, accepts empty results, and rejects malformed responses', async Provider => {
    const transport = vi.fn(async () => Response.json({ results: Provider === PerplexitySearchProvider ? [] : { web: [] } }))
    expect(new Provider({ apiKey: '', fetch: transport }).available()).toBe(false)
    expect(new Provider({ apiKey: 'key', baseURL: 'http://bad.example', fetch: transport }).available()).toBe(false)
    const provider = new Provider({ apiKey: 'key', fetch: transport })
    expect(provider.available()).toBe(true)
    expect(transport).not.toHaveBeenCalled()
    await expect(provider.search({ query: ' ', maxResults: 1 })).rejects.toMatchObject({ code: 'WEB_INVALID_REQUEST' })
    await expect(provider.search({ query: 'ok', maxResults: 21 })).rejects.toMatchObject({ code: 'WEB_INVALID_REQUEST' })
    expect(transport).not.toHaveBeenCalled()
    await expect(provider.search({ query: 'ok' })).resolves.toEqual({ sources: [], truncated: false })
    transport.mockImplementation(async () => Response.json({ error: 'bad envelope' }))
    await expect(provider.search({ query: 'ok' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
  })
  it.each([PerplexitySearchProvider, YouSearchProvider])('honours cancellation, bounds responses and redacts transport errors', async Provider => {
    const transport = vi.fn(async () => { throw new Error('echo fixture-secret') })
    const provider = new Provider({ apiKey: 'fixture-secret', fetch: transport })
    const controller = new AbortController(); controller.abort()
    await expect(provider.search({ query: 'ok' }, controller.signal)).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(transport).not.toHaveBeenCalled()
    const error = await provider.search({ query: 'ok' }).catch(cause => cause)
    expect(error.message).not.toContain('fixture-secret')
    const oversized = new Provider({ apiKey: 'key', fetch: async () => new Response('x'.repeat(MAX_RESPONSE_BYTES + 1)) })
    await expect(oversized.search({ query: 'ok' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    const denied = new Provider({ apiKey: 'key', fetch: async () => new Response('private upstream body', { status: 429 }) })
    await expect(denied.search({ query: 'ok' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
  })
})

const scrape = (metadata: unknown = { statusCode: 404, url: 'https://example.com/final' }, markdown: unknown = 'not found page') =>
  Response.json({ success: true, data: { markdown, metadata } })

describe('Firecrawl page reader', () => {
  it('preserves real non-2xx page status, final URL, signal and bounded Markdown', async () => {
    const transport = vi.fn(async () => scrape())
    const provider = new FirecrawlFetchProvider({ apiKey: 'fixture-secret', fetch: transport, maxFetchChars: 5 })
    expect(provider.available()).toBe(true)
    expect(transport).not.toHaveBeenCalled()
    const signal = new AbortController().signal
    await expect(provider.fetch({ url: 'https://example.com/original' }, signal)).resolves.toEqual({
      url: 'https://example.com/final', statusCode: 404, body: { kind: 'text', content: 'not f' }, truncated: true,
    })
    const [url, options] = transport.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.firecrawl.dev/v2/scrape')
    expect(options).toMatchObject({ method: 'POST', redirect: 'error', signal, headers: { authorization: 'Bearer fixture-secret' } })
    expect(JSON.parse(String(options.body))).toEqual({ url: 'https://example.com/original', formats: ['markdown'], onlyMainContent: true, skipTlsVerification: false })
  })
  it.each([
    {}, { url: 'https://example.com' }, { statusCode: 200 },
    { statusCode: '200', url: 'https://example.com' }, { statusCode: 0, url: 'https://example.com' },
    { statusCode: 200, url: 'file:///private' }, { statusCode: 200, url: 'https://user:pass@example.com' },
  ])('rejects missing or invalid page metadata without inventing status or URL: %j', async metadata => {
    const provider = new FirecrawlFetchProvider({ apiKey: 'key', fetch: async () => scrape(metadata) })
    await expect(provider.fetch({ url: 'https://example.com' })).rejects.toMatchObject({ code: expect.stringMatching(/^WEB_(PROVIDER_ERROR|INVALID_URL)$/) })
  })
  it('rejects failed envelopes, missing Markdown and API errors', async () => {
    for (const response of [Response.json({ success: false, error: 'failed' }), scrape(undefined, null), new Response('secret body', { status: 402 })]) {
      const provider = new FirecrawlFetchProvider({ apiKey: 'key', fetch: async () => response })
      await expect(provider.fetch({ url: 'https://example.com' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    }
  })
  it('caps response bytes and propagates cancellation during a request', async () => {
    const oversized = new FirecrawlFetchProvider({ apiKey: 'key', fetch: async () => new Response('x'.repeat(MAX_RESPONSE_BYTES + 1)) })
    await expect(oversized.fetch({ url: 'https://example.com' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    const controller = new AbortController()
    const provider = new FirecrawlFetchProvider({ apiKey: 'key', fetch: async (_url, options) => {
      expect(options?.signal).toBe(controller.signal)
      controller.abort()
      return scrape()
    } })
    await expect(provider.fetch({ url: 'https://example.com' }, controller.signal)).rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })
  it('validates availability and URL locally, preserves cancellation, and redacts errors', async () => {
    const transport = vi.fn(async () => { throw new Error('echo fixture-secret') })
    expect(new FirecrawlFetchProvider({ apiKey: '', fetch: transport }).available()).toBe(false)
    expect(new FirecrawlFetchProvider({ apiKey: 'key', baseURL: 'https://bad.example/?key=x', fetch: transport }).available()).toBe(false)
    const provider = new FirecrawlFetchProvider({ apiKey: 'fixture-secret', fetch: transport })
    await expect(provider.fetch({ url: 'ftp://example.com' })).rejects.toMatchObject({ code: 'WEB_INVALID_URL' })
    const controller = new AbortController(); controller.abort()
    await expect(provider.fetch({ url: 'https://example.com' }, controller.signal)).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(transport).not.toHaveBeenCalled()
    const error = await provider.fetch({ url: 'https://example.com' }).catch(cause => cause)
    expect(error.message).not.toContain('fixture-secret')
    expect(transport).toHaveBeenCalledOnce()
  })
})
