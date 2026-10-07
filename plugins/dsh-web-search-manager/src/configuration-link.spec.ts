import { it, expect } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WebRuntime } from '@deepseek-ai/dsh-web'
import { safeConfigurationUrl } from './contracts.ts'
import { WebSearchManager } from './manager.ts'

it('allows explicit host routes and HTTPS settings links, rejecting unsafe targets', () => {
  for (const url of ['/plugins/custom', '#/plugin-settings', 'https://example.com/settings']) expect(safeConfigurationUrl(url)).toBe(url)
  for (const url of ['javascript:alert(1)', 'data:text/html,unsafe', '//example.com', '/\\example.com', 'http://example.com', 'https://secret@example.com', 'https://example.com\n', 'plugins/guessed', null]) {
    expect(safeConfigurationUrl(url)).toBeUndefined()
  }
})
it('keeps configuration links explicit, owner-independent and safe through discovery', async () => {
  const web = new WebRuntime(new Context())
  const manager = new WebSearchManager({ web, resolveCredential: async () => undefined, save: async () => {} })
  try {
    web.registerSearchProvider({ id: 'external', dshWebManagement: {
      label: 'External', description: 'Custom', billing: 'unknown', configurationUrl: '/plugins/custom',
    }, available: () => true, search: async () => ({ sources: [] }) } as never)
    web.registerSearchProvider({ id: 'unsafe', dshWebManagement: { configurationUrl: 'javascript:bad' },
      available: () => true, search: async () => ({ sources: [] }) } as never)
    expect(manager.status().providers.find(row => row.id === 'external')).toMatchObject({ configurationOwned: false, configurationUrl: '/plugins/custom' })
    expect(manager.status().providers.find(row => row.id === 'external')?.configurationOwner).toBeUndefined()
    expect(manager.status().providers.find(row => row.id === 'unsafe')?.configurationUrl).toBeUndefined()
  } finally { await manager.dispose() }
})
