import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WebRuntime } from '@deepseek-ai/dsh-web'
import type { WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web'
import { HttpFetchProvider } from '@deepseek-ai/dsh-web-fetch-http'
import { registerBuiltins } from './builtins.ts'
import { WebSearchManager } from './manager.ts'
import { defaultSettings } from './contracts.ts'

const fixtures: WebSearchManager[] = []
const target = 'https://example.com/article'
function response(url: string, content: string, statusCode = 200): WebFetchResult {
  return { url, statusCode, body: { kind: 'text', content }, truncated: false }
}
async function setup() {
  vi.stubEnv('DSH_WEB_SEARCH_PROVIDER', undefined)
  vi.stubEnv('DSH_WEB_FETCH_PROVIDER', undefined)
  const web = new WebRuntime(new Context(), {})
  const initial = { ...defaultSettings(), maxFetchChars: 1000 }
  const save = vi.fn(async () => {})
  const manager = new WebSearchManager({ web, initial, save, resolveCredential: async () => undefined })
  fixtures.push(manager)
  registerBuiltins(web, { settings: () => manager.status().settings, resolveCredential: async () => undefined })
  await manager.refresh()
  return { web, manager, save, initial }
}
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(manager => manager.dispose()))
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('Jina-first builtin wiring through the DSH runtime', () => {
  it('retains settings and keyless http identity, and caps decoded Reader output', async () => {
    const transport = vi.spyOn(HttpFetchProvider.prototype, 'fetch').mockImplementation(async request =>
      response(request.url, JSON.stringify({ code: 200, data: { content: 'x'.repeat(1200) } })))
    const { web, manager, save, initial } = await setup()
    expect(manager.status().settings).toEqual({ ...initial, fetchProvider: 'http-managed' })
    expect(manager.status().providers.find(row => row.kind === 'fetch')).toMatchObject({
      id: 'http-managed', configured: true, billing: 'none',
    })
    expect(save).not.toHaveBeenCalled()
    expect(transport).not.toHaveBeenCalled()
    const result = await web.fetch({ url: target })
    expect(transport).toHaveBeenCalledOnce()
    expect(transport.mock.calls[0]?.[0]).toEqual({ url: 'https://r.jina.ai/' + target })
    expect(result).toMatchObject({ url: target, body: { kind: 'text', content: 'x'.repeat(1000) }, truncated: true })
  })

  it('falls back to the original URL once on 429 using the same HTTP implementation', async () => {
    const urls: string[] = []
    vi.spyOn(HttpFetchProvider.prototype, 'fetch').mockImplementation(async (request: WebFetchRequest) => {
      urls.push(request.url)
      return request.url.startsWith('https://r.jina.ai/')
        ? response(request.url, 'Rate limited', 429) : response(request.url, 'Direct page')
    })
    const { web } = await setup()
    expect(await web.fetch({ url: target })).toMatchObject({ url: target, body: { content: 'Direct page' } })
    expect(urls).toEqual(['https://r.jina.ai/' + target, target])
  })

  it('cancels without direct fallback when the manager disables network access', async () => {
    const transport = vi.spyOn(HttpFetchProvider.prototype, 'fetch').mockImplementation(() => new Promise(() => {}))
    const { web, manager } = await setup()
    const pending = web.fetch({ url: target }).catch(error => error)
    await vi.waitFor(() => expect(transport).toHaveBeenCalledOnce())
    const { revision, ...settings } = manager.status().settings
    await manager.update({ ...settings, searchEnabled: false }, revision)
    expect(await pending).toMatchObject({ code: 'WEB_ABORTED' })
    expect(transport).toHaveBeenCalledOnce()
  })
})
