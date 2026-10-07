import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WebError, WebRuntime } from '@deepseek-ai/dsh-web'
import { WebSearchManager } from './manager.ts'
import { HttpStatusError } from './provider-error.ts'

it('retains HTTP status and provider identity through the manager', async () => {
  const web = new WebRuntime(new Context())
  const manager = new WebSearchManager({
    web,
    resolveCredential: async () => undefined, save: async () => {},
  })
  try {
    manager.registerSearchProvider({ id: 'test', label: 'Test', billing: 'none' }, () => ({
      id: 'test', available: () => true, async search() { throw new HttpStatusError(429) },
    }))
    const { revision, ...settings } = manager.status().settings
    await manager.update({ ...settings, searchEnabled: true, searchOrder: ['test'] }, revision)
    const error = await web.search({ query: 'fixture' }).catch(error => error)
    expect(error.code).toBe('WEB_PROVIDER_ERROR')
    expect(error.message).toContain('[search:test]')
    expect(error.message).toContain('HTTP 429')
    expect(error.cause).toBeUndefined()
  } finally { await manager.dispose() }
})
it.each(['WEB_CREDENTIAL_MISSING', 'WEB_DISABLED', 'WEB_ABORTED', 'WEB_PROVIDER_ERROR', 'WEB_DNS_ERROR', 'WEB_TLS_ERROR', 'WEB_BLOCKED_URL', 'WEB_REDIRECT_BLOCKED', 'WEB_FETCH_TIMEOUT'])(
  'redacts extension errors even when they use the trusted %s code', async code => {
    const web = new WebRuntime(new Context())
    const manager = new WebSearchManager({
      web,
      resolveCredential: async () => 'fixture-private-key', save: async () => {},
    })
    try {
      manager.registerSearchProvider({
        id: 'test', label: 'Test', description: 'Untrusted extension error fixture',
        credentialRef: 'TEST_WEB_API_KEY', billing: 'request',
      }, () => ({
        id: 'test', available: () => true,
        async search() { throw new WebError('provider echoed fixture-private-key', code) },
      }))
      const { revision, ...settings } = manager.status().settings
      await manager.update({ ...settings, searchEnabled: true, searchProvider: 'test', searchOrder: ['test'] }, revision)
      expect(manager.status().searchActive).toBe(true)
      const error = await web.search({ query: 'fixed fixture query' }).catch(error => error)
      expect(error).toBeInstanceOf(WebError)
      expect(error.code).toBe(code)
      expect(error.message).toContain('provider echoed [REDACTED]')
      expect(String(error)).not.toContain('fixture-private-key')
      expect(JSON.stringify(error)).not.toContain('fixture-private-key')
      expect(error.cause).toBeUndefined()
    } finally { await manager.dispose() }
  },
)
