import { access, readdir } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { WEB_PROVIDER_AVAILABILITY_EVENT } from '@klarkxy/dsh-plugin-kit/contracts'
import { bindChatGptWebSearch, createChatGptWebSearchProvider, registerChatGptGlobalSearchProvider } from './web-search-provider.ts'
import type { Result } from './contracts.ts'

const result: Result = { id: 'run', mode: 'search', answer: 'Generated search summary', images: [], sources: [{ url: 'https://example.com/a', title: 'A' }, { url: 'https://example.com/b' }], searchCount: 1, elapsedMs: 1 }

describe('ChatGPT web search provider', () => {
  it('reuses the runner without session context and cleans its isolated workspace', async () => {
    let workspace = ''
    const signal = new AbortController().signal
    const run = vi.fn(async (request, root, received) => {
      workspace = root
      expect(request).toEqual({ mode: 'search', prompt: 'query' })
      expect(received).toBe(signal)
      expect(await readdir(root)).toEqual([])
      return result
    })
    const provider = createChatGptWebSearchProvider({ run, available: () => true })
    expect(await provider.search({ query: 'query', maxResults: 1 }, signal)).toEqual({ content: result.answer, sources: result.sources.slice(0, 1), truncated: true })
    expect(run).toHaveBeenCalledTimes(1)
    await expect(access(workspace)).rejects.toThrow()
    expect(provider).not.toHaveProperty('fetch')
    expect(provider.dshWebManagement).toMatchObject({ id: 'chatgpt', configurationOwner: '@klarkxy/dsh-chatgpt' })
  })
  it('passes cancellation to the runner and cleans after failure', async () => {
    const controller = new AbortController()
    let workspace = ''
    const provider = createChatGptWebSearchProvider({ available: () => true, run: async (_request, root, signal) => {
      workspace = root; controller.abort(); signal.throwIfAborted(); return result
    } })
    await expect(provider.search({ query: 'query' }, controller.signal)).rejects.toThrow()
    await expect(access(workspace)).rejects.toThrow()
    const run = vi.fn()
    const aborted = createChatGptWebSearchProvider({ run, available: () => true })
    await expect(aborted.search({ query: 'query' }, controller.signal)).rejects.toThrow()
    expect(run).not.toHaveBeenCalled()
  })
  it('rejects invalid requests before invoking the runner', async () => {
    const run = vi.fn()
    const provider = createChatGptWebSearchProvider({ run, available: () => true })
    for (const query of ['', '  ', 'a'.repeat(100_001)]) await expect(provider.search({ query })).rejects.toMatchObject({ code: 'bad-request' })
    for (const maxResults of [NaN, Infinity, -1, 0, 1.5]) await expect(provider.search({ query: 'query', maxResults })).rejects.toMatchObject({ code: 'bad-request' })
    expect(run).not.toHaveBeenCalled()
  })
  it('registers only search and returns the native disposer', () => {
    const off = vi.fn(), registerSearchProvider = vi.fn(() => off)
    expect(registerChatGptGlobalSearchProvider({ registerSearchProvider }, { run: vi.fn(), available: () => true })).toBe(off)
    expect(registerSearchProvider.mock.calls[0][0]).toMatchObject({ id: 'chatgpt' })
  })
  it('keeps availability synchronous and local, refreshes changes and unregisters', async () => {
    const off = vi.fn(), providers: ReturnType<typeof createChatGptWebSearchProvider>[] = []
    const emit = vi.fn(), run = vi.fn(), executable = vi.fn(async () => 'codex')
    const discover = vi.fn(async () => ({ command: 'codex', path: 'codex', args: [] }))
    let dispose!: () => void
    const ctx = { inject: vi.fn((_deps, apply) => { dispose = apply({ get: () => ({ registerSearchProvider: (provider: ReturnType<typeof createChatGptWebSearchProvider>) => { providers.push(provider); return off } }), emit }) }) }
    const refresh = bindChatGptWebSearch(ctx, { run, executable }, discover)
    await refresh()
    const provider = providers[0]
    expect(provider.available()).toBe(true)
    const calls = discover.mock.calls.length
    provider.available(); provider.available()
    expect(discover).toHaveBeenCalledTimes(calls)
    expect(run).not.toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith(WEB_PROVIDER_AVAILABILITY_EVENT, 'search', 'chatgpt')
    discover.mockRejectedValueOnce(new Error('missing'))
    await refresh()
    expect(provider.available()).toBe(false)
    dispose()
    expect(off).toHaveBeenCalledOnce()
    expect(provider.available()).toBe(false)
  })
  it('does not require the optional web service or perform work without it', async () => {
    const run = vi.fn(), executable = vi.fn(async () => '')
    const ctx = { inject: vi.fn() }
    await bindChatGptWebSearch(ctx, { run, executable })()
    expect(ctx.inject).toHaveBeenCalledWith(['web'], expect.any(Function))
    expect(executable).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })
})
