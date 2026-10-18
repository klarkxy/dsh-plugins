import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WebRuntime } from '@deepseek-ai/dsh-web'
import { registerChatGptGlobalSearchProvider } from '../../dsh-chatgpt/src/web-search-provider.ts'
import { registerGrokWebProviders } from '../../dsh-grok-build/src/web-provider.ts'
import { registerMiniMaxWebProvider } from '../../dsh-minimax-code/src/web-provider.ts'
import { DEFAULT_SETTINGS as MINIMAX_SETTINGS } from '../../dsh-minimax-code/src/contracts.ts'
import { WebSearchManager } from './manager.ts'
import { defaultSettings, type WebSettings } from './contracts.ts'

const cleanup: Array<() => void | Promise<unknown>> = []
afterEach(async () => { for (const off of cleanup.splice(0).reverse()) await off() })
const gate = <T>(signal: AbortSignal, action: (signal: AbortSignal) => Promise<T>) => action(signal)
function setup() {
  const ctx = new Context()
  new WebRuntime(ctx)
  cleanup.push(() => ctx.fiber.dispose())
  const resolveCredential = vi.fn(async () => undefined)
  const manager = new WebSearchManager({ web: ctx.web, initial: { ...defaultSettings(), searchOrder: [], fetchOrder: [] }, resolveCredential, save: async () => {} })
  cleanup.push(() => manager.dispose())
  return { web: ctx.web, manager, resolveCredential }
}
async function update(manager: WebSearchManager, patch: Partial<WebSettings>) {
  const { revision, ...settings } = manager.status().settings
  return manager.update({ ...settings, ...patch }, revision)
}

describe('CLI providers through the managed native web registry', () => {
  it('discovers CLI capabilities without running them, orders search and preserves external configuration', async () => {
    const { web, manager, resolveCredential } = setup()
    let chatReady = true
    const chatRun = vi.fn(async () => ({ id: 'test', mode: 'search' as const, answer: 'Chat answer', images: [], sources: [{ url: 'https://example.com/chat' }], searchCount: 1, elapsedMs: 1 }))
    const grokRun = vi.fn(async () => ({ answer: 'Grok answer', sources: [{ url: 'https://example.com/grok' }], files: [], state: 'completed' as const }))
    cleanup.push(registerChatGptGlobalSearchProvider(web, { available: () => chatReady, run: chatRun }))
    cleanup.push(registerGrokWebProviders(web, { available: () => true, runtime: () => ({ run: grokRun }), run: gate }))
    const miniRun = vi.fn(async () => ({ status: 'complete' as const, answer: 'MiniMax answer', files: [], data: { sources: [{ url: 'https://example.com/minimax', title: 'MiniMax', snippet: 'result' }] } }))
    cleanup.push(registerMiniMaxWebProvider(web, { available: () => true, settings: () => MINIMAX_SETTINGS, run: gate, search: { run: miniRun, status: async () => true } }))
    await manager.refresh()
    expect(manager.status().providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'chatgpt', kind: 'search', configurationOwned: false, configurationOwner: '@klarkxy/dsh-chatgpt' }),
      expect.objectContaining({ id: 'grok-build', kind: 'search', configurationOwned: false }),
      expect.objectContaining({ id: 'grok-build', kind: 'fetch', configurationOwned: false }),
      expect.objectContaining({ id: 'minimax-code', kind: 'search', configurationOwned: false }),
    ]))
    expect(chatRun).not.toHaveBeenCalled()
    expect(grokRun).not.toHaveBeenCalled()
    expect(resolveCredential).not.toHaveBeenCalled()
    await expect(web.search({ query: 'disabled' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
    await update(manager, { searchOrder: ['chatgpt', 'grok-build'] })
    expect((await web.search({ query: 'first' })).content).toBe('Chat answer')
    expect(grokRun).not.toHaveBeenCalled()
    chatReady = false
    expect((await web.search({ query: 'second' })).content).toBe('Grok answer')
    await update(manager, { searchOrder: ['grok-build', 'chatgpt'] })
    chatReady = true
    expect((await web.search({ query: 'reordered' })).content).toBe('Grok answer')
    expect(chatRun).toHaveBeenCalledTimes(1)
    expect(miniRun).not.toHaveBeenCalled()
    await update(manager, { searchOrder: ['minimax-code', 'grok-build', 'chatgpt'] })
    expect((await web.search({ query: 'minimax' })).sources[0].url).toBe('https://example.com/minimax')
    expect(miniRun).toHaveBeenCalledOnce()
    await update(manager, { searchOrder: ['chatgpt', 'grok-build'] })
    chatRun.mockRejectedValueOnce(new Error('CLI failed'))
    const calls = grokRun.mock.calls.length
    await expect(web.search({ query: 'failure' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    expect(grokRun).toHaveBeenCalledTimes(calls)
  })

  it('keeps native fetch status and final URL while enforcing manager content limits', async () => {
    const { web, manager } = setup()
    const run = vi.fn(async () => ({ answer: '', sources: [], files: [], state: 'completed' as const,
      fetch: { url: 'https://example.com/final', statusCode: 404, body: { kind: 'text' as const, content: 'x'.repeat(1500) }, truncated: false },
    }))
    const off = registerGrokWebProviders(web, { available: () => true, runtime: () => ({ run }), run: gate })
    cleanup.push(off)
    await update(manager, { fetchOrder: ['grok-build'], maxFetchChars: 1000 })
    const result = await web.fetch({ url: 'https://example.com/start' })
    expect(result).toMatchObject({ url: 'https://example.com/final', statusCode: 404, truncated: true })
    expect(result.body.content).toHaveLength(1000)
    off()
    expect(manager.status().providers.filter(p => p.id === 'grok-build')).toEqual([])
    await expect(web.fetch({ url: 'https://example.com/start' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
  })
})
