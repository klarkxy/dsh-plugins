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

it('waits for real removed provider work before completing Cordis teardown', async () => {
  const ctx = new Context()
  new WebRuntime(ctx)
  let release!: () => void
  let signal!: AbortSignal
  const search = vi.fn((_request, combined?: AbortSignal) => {
    signal = combined!
    return new Promise<{ sources: []; truncated: false }>(resolve => { release = () => resolve({ sources: [], truncated: false }) })
  })
  const off = ctx.web.registerSearchProvider({ id: 'slow-native', available: () => true, search })
  const close = vi.fn(async () => {})
  ctx.provide('storageDomain', { open: async () => ({ table: () => ({ get: () => ({ ...defaultSettings(), searchEnabled: true, searchOrder: ['slow-native'] }) }), close }) } as never)
  ctx.provide('credentials', { resolve: async () => undefined } as never)
  ctx.provide('webServer', { register: () => () => {} } as never)
  ctx.provide('connection', {} as never)
  await apply(ctx)
  const pending = ctx.web.search({ query: 'slow' }).catch(error => error)
  await vi.waitFor(() => expect(search).toHaveBeenCalledOnce())
  off()
  let disposed = false
  const unloading = ctx.fiber.dispose().then(() => { disposed = true })
  await Promise.resolve()
  expect(signal.aborted).toBe(true)
  expect(disposed).toBe(false)
  expect(close).not.toHaveBeenCalled()
  release()
  expect(await pending).toMatchObject({ code: 'WEB_ABORTED' })
  await unloading
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
