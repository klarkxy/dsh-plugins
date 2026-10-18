import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WebRuntime, type WebFetchProvider, type WebSearchProvider } from '@deepseek-ai/dsh-web'
import type { DshWebManagementDescriptor } from '@klarkxy/dsh-plugin-kit/contracts'
import { WebSearchManager } from './manager.ts'
import { defaultSettings, type WebSettings } from './contracts.ts'

const cleanup: Array<() => void | Promise<unknown>> = []
afterEach(async () => { for (const off of cleanup.splice(0).reverse()) await off() })

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
function externalSearch(id: string, owner: string, search: WebSearchProvider['search'], available = () => true): WebSearchProvider & { dshWebManagement: DshWebManagementDescriptor } {
  return {
    id, available, search, dshWebManagement: {
      id, label: id, description: `${id} search`, billing: 'model-and-tools', configurationOwner: owner,
    },
  }
}

describe('external providers through the managed native web registry', () => {
  it('discovers external capabilities without running them, orders search and preserves external configuration', async () => {
    const { web, manager, resolveCredential } = setup()
    let chatReady = true
    const chatRun = vi.fn<WebSearchProvider['search']>(async () => ({ content: 'Chat answer', sources: [{ url: 'https://example.com/chat' }] }))
    const grokRun = vi.fn<WebSearchProvider['search']>(async () => ({ content: 'Grok answer', sources: [{ url: 'https://example.com/grok' }] }))
    const miniRun = vi.fn<WebSearchProvider['search']>(async () => ({ sources: [{ url: 'https://example.com/minimax', title: 'MiniMax', snippet: 'result' }] }))
    const grokFetch = vi.fn<WebFetchProvider['fetch']>(async request => ({ url: request.url, statusCode: 200, body: { kind: 'text', content: 'fetched' }, truncated: false }))
    const grokFetchProvider: WebFetchProvider & { dshWebManagement: DshWebManagementDescriptor } = {
      id: 'grok-build', available: () => true, fetch: grokFetch, dshWebManagement: {
        id: 'grok-build', label: 'grok-build', description: 'grok-build fetch', billing: 'model-and-tools', configurationOwner: '@example/grok-build',
      },
    }
    cleanup.push(web.registerSearchProvider(externalSearch('chatgpt', '@example/chatgpt', chatRun, () => chatReady)))
    cleanup.push(web.registerSearchProvider(externalSearch('grok-build', '@example/grok-build', grokRun)))
    cleanup.push(web.registerFetchProvider(grokFetchProvider))
    cleanup.push(web.registerSearchProvider(externalSearch('minimax-code', '@example/minimax-code', miniRun)))
    await manager.refresh()
    expect(manager.status().providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'chatgpt', kind: 'search', configurationOwned: false, configurationOwner: '@example/chatgpt' }),
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
    expect(grokFetch).not.toHaveBeenCalled()
  })

  it('keeps native fetch status and final URL while enforcing manager content limits', async () => {
    const { web, manager } = setup()
    const fetch = vi.fn<WebFetchProvider['fetch']>(async () => ({
      url: 'https://example.com/final', statusCode: 404, body: { kind: 'text', content: 'x'.repeat(1500) }, truncated: false,
    }))
    const provider: WebFetchProvider & { dshWebManagement: DshWebManagementDescriptor } = {
      id: 'grok-build', available: () => true, fetch, dshWebManagement: {
        id: 'grok-build', label: 'grok-build', description: 'grok-build fetch', billing: 'model-and-tools', configurationOwner: '@example/grok-build',
      },
    }
    const off = web.registerFetchProvider(provider)
    cleanup.push(off)
    await update(manager, { fetchOrder: ['grok-build'], maxFetchChars: 1000 })
    const result = await web.fetch({ url: 'https://example.com/start' })
    expect(result).toMatchObject({ url: 'https://example.com/final', statusCode: 404, truncated: true })
    expect(result.body.content).toHaveLength(1000)
    off()
    expect(manager.status().providers.filter(provider => provider.id === 'grok-build')).toEqual([])
    await expect(web.fetch({ url: 'https://example.com/start' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
  })
})
