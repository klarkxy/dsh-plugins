import { expect, it, vi } from 'vitest'
import type { ModelSettingsProvider } from '@klarkxy/dsh-plugin-kit/model-settings'
vi.mock('@klarkxy/dsh-plugin-kit/host-rpc', () => ({ registerHostRpc: () => () => {} }))
import { apply } from './index.ts'

it('contributes the owned title model, preserves sibling settings, checks revisions and unloads', async () => {
  let row: unknown = { revision: 3, locale: 'en', prompt: 'Preserve this instruction', cadence: 'first-prompt', model: { provider: 'p', model: 'old' } }
  let collect: ((emit: (provider: ModelSettingsProvider) => void) => void) | undefined
  const off: (() => unknown)[] = []
  const ctx = {
    storageDomain: { open: async () => ({ table: () => ({ get: () => row, put: async (_key: string, value: unknown) => { row = value } }), close: async () => {} }) },
    provide() {}, effect(fn: () => () => unknown) { off.push(fn()) },
    on(_event: string, callback: typeof collect) { collect = callback; return () => { collect = undefined } },
  }
  await apply(ctx as any)
  let owner!: ModelSettingsProvider
  collect!(value => { owner = value })
  const signal = new AbortController().signal
  expect(await owner.read(signal)).toMatchObject({ revision: 3, fields: [{ path: ['model'], current: { provider: 'p', model: 'old' }, allowFollow: true }] })
  await owner.write(['model'], { provider: 'q', model: 'new', reasoningEffort: 'high' }, 3, signal)
  expect(row).toEqual({ revision: 4, locale: 'auto', prompt: 'Preserve this instruction', cadence: 'first-prompt', model: { provider: 'q', model: 'new', reasoningEffort: 'high' } })
  await expect(owner.write(['model'], { provider: '', model: '' }, 3, signal)).rejects.toThrow(/changed/)
  await expect(owner.write(['prompt'], { provider: '', model: '' }, 4, signal)).rejects.toThrow(/Unknown/)
  await owner.write(['model'], { provider: '', model: '' }, 4, signal)
  for (const dispose of off.reverse()) await dispose()
  expect(collect).toBeUndefined()
  await expect(owner.write(['model'], { provider: 'q', model: 'late' }, 5, signal)).rejects.toThrow(/unloaded/)
})
