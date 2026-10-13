import { describe, expect, it, vi } from 'vitest'
import { TavilySearchProvider } from './tavily.ts'
function adapter(payload: unknown) {
  const transport = vi.fn(async () => Response.json(payload))
  return { transport, provider: new TavilySearchProvider({ apiKey: 'fixture-secret', fetch: transport }) }
}
describe('Tavily direct API adapter', () => {
  it('normalizes results and never requests auto-depth, an answer, images or raw content', async () => {
    const { provider, transport } = adapter({ results: [{ title: 'A', url: 'https://example.com/a', content: 'Source', published_date: '2026-01-01' }] })
    expect(provider.available()).toBe(true); expect(transport).not.toHaveBeenCalled()
    const result = await provider.search({ query: ' test ', maxResults: 3 })
    expect(result.sources[0]).toMatchObject({ title: 'A', url: 'https://example.com/a', snippet: 'Source', publishedAt: '2026-01-01T00:00:00.000Z' })
    const [url, options] = transport.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.tavily.com/search')
    expect(options.redirect).toBe('error')
    expect(options.headers).toMatchObject({ authorization: 'Bearer fixture-secret' })
    expect(JSON.parse(String(options.body))).toMatchObject({ query: 'test', max_results: 3, search_depth: 'basic', auto_parameters: false, include_answer: false, include_raw_content: false, include_images: false })
  })
  it('drops unsafe or credential-bearing links and preserves optional fields honestly', async () => {
    const { provider } = adapter({ results: [
      { url: 'javascript:alert(1)' }, { url: 'https://secret@example.com' }, { url: 'not a url' },
      { url: 'https://example.com', published_date: 'unknown' },
    ] })
    const result = await provider.search({ query: 'test' })
    expect(result.sources).toEqual([{ url: 'https://example.com/' }])
  })
  it('caps over-returned sources', async () => {
    const { provider } = adapter({ results: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }] })
    expect(await provider.search({ query: 'test', maxResults: 1 })).toMatchObject({ sources: [{ url: 'https://example.com/a' }], truncated: true })
  })
  it('preserves empty strings, field caps and publication dates through shared source validation', async () => {
    const { provider } = adapter({ results: [
      { url: 'http://example.com/empty', title: '', content: '', published_date: '2026-01-01' },
      { url: 'https://example.com/long', title: 't'.repeat(1001), content: 's'.repeat(8001) },
    ] })
    const { sources } = await provider.search({ query: 'test' })
    expect(sources[0]).toEqual({ url: 'http://example.com/empty', title: '', snippet: '', publishedAt: '2026-01-01T00:00:00.000Z' })
    expect(sources[1]?.title).toHaveLength(1000)
    expect(sources[1]?.snippet).toHaveLength(8000)
    expect(sources[1]).not.toHaveProperty('publishedAt')
  })
  it.each(['http://api.tavily.com', 'https://user:secret@api.tavily.com',
    'https://api.tavily.com?query=1', 'https://api.tavily.com#fragment'])('rejects unsafe endpoint %s before sending', async baseURL => {
    const transport = vi.fn()
    const provider = new TavilySearchProvider({ apiKey: 'fixture-secret', baseURL, fetch: transport })
    expect(provider.available()).toBe(false)
    await expect(provider.search({ query: 'test' })).rejects.toMatchObject({ code: 'WEB_CREDENTIAL_MISSING' })
    expect(transport).not.toHaveBeenCalled()
  })
  it('allows the exact JSON byte cap and cancels/releases an oversized stream', async () => {
    const valid = '{"results":[]}'
    const cancel = vi.fn()
    const oversized = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(2_000_001)) }, cancel,
    }))
    const transport = vi.fn().mockResolvedValueOnce(new Response(valid + ' '.repeat(2_000_000 - valid.length)))
      .mockResolvedValueOnce(oversized)
    const provider = new TavilySearchProvider({ apiKey: 'fixture-secret', fetch: transport })
    expect(await provider.search({ query: 'test' })).toEqual({ sources: [], truncated: false })
    await expect(provider.search({ query: 'test' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    expect(cancel).toHaveBeenCalledOnce()
    expect(oversized.body?.locked).toBe(false)
  })
  it.each([401, 429, 500])('does not retry or leak an HTTP %s response body', async status => {
    const transport = vi.fn(async () => new Response('fixture-secret echo', { status }))
    const provider = new TavilySearchProvider({ apiKey: 'fixture-secret', fetch: transport })
    const error = await provider.search({ query: 'test' }).catch(error => error)
    expect(error.code).toBe('WEB_PROVIDER_ERROR'); expect(error.message).not.toContain('fixture-secret')
    expect(transport).toHaveBeenCalledOnce()
  })
  it('rejects malformed and oversized responses', async () => {
    const transport = vi.fn().mockResolvedValueOnce(new Response('{ invalid')).mockResolvedValueOnce(new Response('x'.repeat(2_000_001)))
    const provider = new TavilySearchProvider({ apiKey: 'fixture-secret', fetch: transport })
    await expect(provider.search({ query: 'test' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    await expect(provider.search({ query: 'test' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
  })
  it('does not send invalid queries, result counts, missing credentials or cancelled calls', async () => {
    const { provider, transport } = adapter({ results: [] })
    await expect(provider.search({ query: ' ' })).rejects.toMatchObject({ code: 'WEB_INVALID_REQUEST' })
    await expect(provider.search({ query: 'ok', maxResults: 21 })).rejects.toMatchObject({ code: 'WEB_INVALID_REQUEST' })
    await expect(provider.search({ query: 'ok' }, AbortSignal.abort())).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    await expect(new TavilySearchProvider({ apiKey: '', fetch: transport }).search({ query: 'ok' })).rejects.toMatchObject({ code: 'WEB_CREDENTIAL_MISSING' })
    expect(transport).not.toHaveBeenCalled()
  })
})
