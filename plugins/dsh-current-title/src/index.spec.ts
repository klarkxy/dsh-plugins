import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
vi.mock('@klarkxy/dsh-plugin-kit/host-rpc', () => ({ registerHostRpc: () => () => {} }))
import { apply, inject, name } from './index.ts'
import { PLUGIN_NAME } from './contracts.ts'

describe('plugin wiring', () => {
  it('declares the package name and every service it waits for', () => {
    expect(name).toBe(PLUGIN_NAME)
    expect(inject).toEqual(['sessionTitle', 'llm', 'sessions', 'loader', 'storageDomain',
      'connection', 'webServer', 'agents', 'sessionProjections', 'agentDefaultModel'])
  })

  it('disposes the service before closing its storage domain on unload', async () => {
    const order: string[] = []
    const ctx = new Context()
    Object.assign(ctx, {
      storageDomain: { open: async () => ({
        table: () => ({ get: () => undefined, put: async () => {} }),
        close: async () => { order.push('domain.close') },
      }) },
    })
    await apply(ctx as never)
    const service = (ctx as unknown as { currentTitle: { dispose(): Promise<void> } }).currentTitle
    const dispose = service.dispose.bind(service)
    service.dispose = async () => { order.push('service.dispose'); await dispose() }
    await ctx.fiber.dispose()
    expect(order).toEqual(['service.dispose', 'domain.close'])
  })
})
