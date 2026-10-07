import { it, expect, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WebRuntime } from '@deepseek-ai/dsh-web'
import { apply } from './index.ts'
import { defaultSettings } from './contracts.ts'

it('closes the opened storage domain if registry compatibility fails during apply', async () => {
  const ctx = new Context()
  const close = vi.fn(async () => {})
  ctx.provide('storageDomain', { open: async () => ({ table: () => ({ get: () => undefined }), close }) } as never)
  ctx.provide('web', { registerSearchProvider: () => () => {}, registerFetchProvider: () => () => {} } as never)
  await expect(apply(ctx)).rejects.toMatchObject({ code: 'WEB_REGISTRY_UNSUPPORTED' })
  await ctx.fiber.dispose()
  expect(close).toHaveBeenCalledOnce()
})

it('finishes a pending settings write before closing storage during actual Cordis teardown', async () => {
  const ctx = new Context()
  new WebRuntime(ctx)
  const events: string[] = []
  let release = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  const put = vi.fn(async () => { events.push('saving'); await gate; events.push('saved') })
  const close = vi.fn(async () => { events.push('closed') })
  ctx.provide('storageDomain', { open: async () => ({ table: () => ({ get: () => defaultSettings(), put }), close }) } as never)
  ctx.provide('credentials', { resolve: async () => undefined } as never)
  ctx.provide('webServer', { register: () => () => {} } as never)
  ctx.provide('connection', {} as never)
  await apply(ctx)
  const manager = ctx.webSearchManager
  const { revision, ...settings } = manager.status().settings
  const pending = manager.update({ ...settings, maxResults: 3 }, revision)
  await vi.waitFor(() => expect(put).toHaveBeenCalledOnce())
  const unloading = ctx.fiber.dispose()
  await Promise.resolve()
  expect(close).not.toHaveBeenCalled()
  release()
  await pending
  await unloading
  expect(events).toEqual(['saving', 'saved', 'closed'])
})
