import { describe, expect, it, vi } from 'vitest'
import { bindGrokWeb, registerGrokWebProviders } from './web-provider.ts'

function fixture() {
  let search: any, fetch: any
  const offSearch = vi.fn(), offFetch = vi.fn()
  const execute = vi.fn(async () => ({ answer: 'native', sources: [{ url: 'https://source.test' }], state: 'completed', files: [], fetch: { url: 'https://source.test/final', statusCode: 404, body: { kind: 'text', content: '  raw\nbody  ' }, truncated: false } }))
  const available = vi.fn(() => true)
  const off = registerGrokWebProviders({ registerSearchProvider(p) { search = p; return offSearch }, registerFetchProvider(p) { fetch = p; return offFetch } }, { available, runtime: () => ({ run: execute }), run: async (signal, action) => { signal.throwIfAborted(); return action(signal) } })
  return { search, fetch, off, offSearch, offFetch, execute }
}
describe('Grok native web providers', () => {
  it('registers both capabilities with local-only availability and preserves non-2xx resource content', async () => {
    const f = fixture(); expect(f.search.available()).toBe(true); expect(f.fetch.available()).toBe(true); expect(f.execute).not.toHaveBeenCalled()
    expect(await f.fetch.fetch({ url: 'https://source.test' })).toEqual({ url: 'https://source.test/final', statusCode: 404, body: { kind: 'text', content: '  raw\nbody  ' }, truncated: false })
    expect(f.execute.mock.calls[0][0]).toMatchObject({ capability: 'fetch', nativeInput: { url: 'https://source.test' }, inputs: [], jobDirectory: '' })
    expect(f.execute.mock.calls[0][0]).not.toHaveProperty('session')
    f.off(); expect(f.offSearch).toHaveBeenCalledOnce(); expect(f.offFetch).toHaveBeenCalledOnce()
  })
  it('validates before invoking and propagates cancellation without returning partial results', async () => {
    const f = fixture()
    await expect(f.search.search({ query: 'x', maxResults: 0 })).rejects.toThrow()
    await expect(f.fetch.fetch({ url: 'file:///private' })).rejects.toThrow()
    expect(f.execute).not.toHaveBeenCalled()
    const controller = new AbortController()
    f.execute.mockImplementation(async (_request: any, signal: AbortSignal) => { expect(signal).toBe(controller.signal); controller.abort(); return { state: 'uncertain' } as any })
    await expect(f.search.search({ query: 'x' }, controller.signal)).rejects.toThrow()
  })
  it('caps sources without inventing titles and requires native fetch data', async () => {
    const f = fixture(); expect(await f.search.search({ query: 'x', maxResults: 1 })).toEqual({ content: 'native', sources: [{ url: 'https://source.test' }], truncated: false })
    f.execute.mockResolvedValue({ answer: 'assistant prose', sources: [], files: [], state: 'completed' } as any)
    await expect(f.fetch.fetch({ url: 'https://source.test' })).rejects.toThrow('no native fetched resource')
  })
  it('waits for optional web and disposes registration and availability subscriptions', () => {
    const f = fixture(), subscribe = vi.fn(() => vi.fn()), emit = vi.fn()
    let callback: any
    bindGrokWeb({ inject: (_deps, apply) => { callback = apply } }, { available: () => true, runtime: () => ({ run: f.execute }), run: async (signal, action) => action(signal) }, subscribe)
    expect(subscribe).not.toHaveBeenCalled(); expect(callback({ get: () => undefined })).toBeUndefined()
    const cleanup = callback({ get: () => ({ registerSearchProvider: () => f.offSearch, registerFetchProvider: () => f.offFetch }), emit })
    subscribe.mock.calls[0][0](); expect(emit.mock.calls.map(call => call[1])).toEqual(['search', 'fetch']); cleanup()
    expect(subscribe.mock.results[0].value).toHaveBeenCalledOnce()
  })
})
