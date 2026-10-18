import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { MODEL_SETTINGS_EVENT, type ModelSettingsProvider } from '@klarkxy/dsh-plugin-kit/model-settings'
vi.mock('@klarkxy/dsh-plugin-kit/host-rpc', () => ({ registerHostRpc: () => () => {} }))
import { apply } from './index.ts'

it('contributes the owned title model, preserves sibling settings, checks revisions and unloads', async () => {
  let row: unknown = { revision: 3, locale: 'en', prompt: 'Preserve this instruction', cadence: 'first-prompt', model: { provider: 'p', model: 'old' } }
  const ctx = new Context()
  Object.assign(ctx, {
    storageDomain: { open: async () => ({ table: () => ({ get: () => row, put: async (_key: string, value: unknown) => { row = value } }), close: async () => {} }) },
  })
  await apply(ctx as any)
  let owner!: ModelSettingsProvider
  ctx.emit(MODEL_SETTINGS_EVENT, (value: ModelSettingsProvider) => { owner = value })
  const signal = new AbortController().signal
  expect(await owner.read(signal)).toMatchObject({ revision: 3, fields: [{ path: ['model'], current: { provider: 'p', model: 'old' }, allowFollow: true }] })
  await owner.write(['model'], { provider: 'q', model: 'new', reasoningEffort: 'high' }, 3, signal)
  expect(row).toEqual({ revision: 4, locale: 'auto', prompt: 'Preserve this instruction', cadence: 'first-prompt', model: { provider: 'q', model: 'new', reasoningEffort: 'high' } })
  await expect(owner.write(['model'], { provider: '', model: '' }, 3, signal)).rejects.toThrow(/changed/)
  await expect(owner.write(['prompt'], { provider: '', model: '' }, 4, signal)).rejects.toThrow(/Unknown/)
  await owner.write(['model'], { provider: '', model: '' }, 4, signal)
  await ctx.fiber.dispose()
  ctx.emit(MODEL_SETTINGS_EVENT, () => { throw new Error('owner remained registered') })
  await expect(owner.write(['model'], { provider: 'q', model: 'late' }, 5, signal)).rejects.toThrow(/unloaded/)
})
