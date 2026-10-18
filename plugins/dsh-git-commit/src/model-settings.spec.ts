import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { MODEL_SETTINGS_EVENT, type ModelSettingsProvider } from '@klarkxy/dsh-plugin-kit/model-settings'
vi.mock('@klarkxy/dsh-plugin-kit/host-rpc', () => ({ registerHostRpc: () => () => {} }))
import { apply } from './index.ts'

it('waits for owned Git settings, preserves fallback and guards stale paths and unload', async () => {
  let row: unknown = { revision: 8, model: { provider: 'p', model: 'saved' }, allowFallback: true }
  let open!: () => void
  const ready = new Promise<void>(resolve => { open = resolve })
  const ctx = new Context()
  Object.assign(ctx, {
    storageDomain: { open: async () => { await ready; return { table: () => ({ get: () => row, put: async (_key: string, value: unknown) => { row = value } }), close: async () => {} } } },
  })
  apply(ctx as any)
  let owner!: ModelSettingsProvider
  ctx.emit(MODEL_SETTINGS_EVENT, (value: ModelSettingsProvider) => { owner = value })
  expect(owner.title).toEqual({ zh: 'Git 提交', en: 'Git Commit' })
  const signal = new AbortController().signal
  const reading = owner.read(signal), settled = vi.fn()
  void Promise.resolve(reading).then(settled)
  await Promise.resolve(); expect(settled).not.toHaveBeenCalled()
  open()
  expect(await reading).toMatchObject({ revision: 8, fields: [{ label: { zh: '提交模型', en: 'Commit model' }, current: { provider: 'p', model: 'saved' } }] })
  await owner.write(['model'], { provider: 'q', model: 'new' }, 8, signal)
  expect(row).toEqual({ revision: 9, model: { provider: 'q', model: 'new' }, allowFallback: true })
  await expect(owner.write(['model'], { provider: '', model: '' }, 8, signal)).rejects.toThrow(/changed/)
  await expect(owner.write(['allowFallback'], { provider: '', model: '' }, 9, signal)).rejects.toThrow(/Unknown/)
  await ctx.fiber.dispose()
  ctx.emit(MODEL_SETTINGS_EVENT, () => { throw new Error('owner remained registered') })
  await expect(owner.read(signal)).rejects.toThrow(/unloaded/)
})
