import { expect, it, vi } from 'vitest'
import type { ModelSettingsProvider } from '@klarkxy/dsh-plugin-kit/model-settings'
import { parseModelMenuChoices } from '@klarkxy/dsh-model-route'
const mocks = vi.hoisted(() => ({ status: vi.fn(), dispose: vi.fn(async () => {}) }))
vi.mock('./runtime.ts', () => ({ CodexRuntime: class { status = mocks.status; dispose = mocks.dispose } }))
vi.mock('@klarkxy/dsh-plugin-kit/host-rpc', () => ({ registerHostRpc: () => () => {} }))
import { apply } from './index.ts'

function mount() {
  let row: any = { revision: 6, settings: { executable: 'custom-codex', model: 'saved', effort: 'low', timeoutMs: 100_000 } }
  let collect: ((emit: (provider: ModelSettingsProvider) => void) => void) | undefined
  const off: (() => unknown)[] = []
  const ctx = {
    storageDomain: { open: async () => ({ table: () => ({ get: () => row, put: async (_key: string, value: unknown) => { row = value } }), close: async () => {} }) },
    tools: { register() {} }, effect(fn: () => () => unknown) { off.push(fn()) },
    on(_event: string, callback: typeof collect) { collect = callback; return () => { collect = undefined } },
  }
  apply(ctx as any)
  let owner!: ModelSettingsProvider
  collect!(value => { owner = value })
  return { owner, row: () => row, async unload() { for (const dispose of off.reverse()) await dispose() }, listener: () => collect }
}

it('contributes a separate Codex catalog without account or executable data and saves through owned CAS', async () => {
  mocks.status.mockResolvedValue({ available: true, models: [{ id: 'sol', label: 'Sol', efforts: ['low', 'high'] }], accountLabel: 'private', executable: 'private-path' })
  const app = mount(), signal = new AbortController().signal
  const snapshot = await app.owner.read(signal)
  expect(snapshot).toMatchObject({ revision: 6, fields: [{ path: ['model'], current: { provider: 'codex', model: 'saved', reasoningEffort: 'low' }, followLabel: { zh: 'Codex 默认模型', en: 'Codex default model' } }] })
  expect(JSON.stringify(snapshot)).not.toContain('private')
  expect(parseModelMenuChoices(snapshot.catalog)).toEqual([{ provider: 'codex', model: 'sol', label: 'Codex / Sol', efforts: [{ id: 'low', name: 'low' }, { id: 'high', name: 'high' }] }])
  await app.owner.write(['model'], { provider: 'codex', model: 'sol', reasoningEffort: 'high' }, 6, signal)
  expect(app.row()).toEqual({ revision: 7, settings: { executable: 'custom-codex', model: 'sol', effort: 'high', timeoutMs: 100_000 } })
  await expect(app.owner.write(['model'], { provider: 'codex', model: 'old' }, 6, signal)).rejects.toThrow(/刷新/)
  await expect(app.owner.write(['model'], { provider: 'dsh', model: 'other' }, 7, signal)).rejects.toThrow(/Codex/)
  await expect(app.owner.write(['executable'], { provider: '', model: '' }, 7, signal)).rejects.toThrow(/Unknown/)
  await app.owner.write(['model'], { provider: '', model: '' }, 7, signal)
  expect(app.row().settings).toEqual({ executable: 'custom-codex', model: '', effort: '', timeoutMs: 100_000 })
  await app.unload()
  expect(app.listener()).toBeUndefined()
  await expect(app.owner.read(signal)).rejects.toThrow(/unloaded/)
})

it('keeps an empty Codex catalog envelope when unavailable', async () => {
  mocks.status.mockResolvedValue({ available: false, models: [], error: 'Codex unavailable' })
  const app = mount()
  expect(await app.owner.read(new AbortController().signal)).toMatchObject({ revision: 6, catalog: { groups: [{ id: 'codex', models: [] }] }, catalogError: 'Codex unavailable' })
  await app.unload()
})

it('contributes bilingual model labels and known catalog errors without changing model IDs', async () => {
  mocks.status.mockResolvedValue({ available: false, models: [], error: '未找到官方 Codex 运行时，请在配置中指定路径。' })
  const app = mount()
  const snapshot = await app.owner.read(new AbortController().signal)
  expect(snapshot.fields[0]!.label).toEqual({ zh: 'ChatGPT 模型', en: 'ChatGPT model' })
  expect(snapshot.fields[0]!.current).toEqual({ provider: 'codex', model: 'saved', reasoningEffort: 'low' })
  expect(snapshot.catalogError).toEqual({ zh: '未找到官方 Codex 运行时，请在配置中指定路径。', en: 'Official Codex runtime not found. Specify its path in settings.' })
  await app.unload()
})

it('holds a consistent settings revision while status is in flight and rejects concurrent saves', async () => {
  let started!: () => void, complete!: () => void
  const entered = new Promise<void>(resolve => { started = resolve })
  const pending = new Promise<void>(resolve => { complete = resolve })
  mocks.status.mockImplementation(async () => { started(); await pending; return { available: true, models: [] } })
  const app = mount(), signal = new AbortController().signal
  const reading = app.owner.read(signal)
  await entered
  await expect(app.owner.write(['model'], { provider: 'codex', model: 'new' }, 6, signal)).rejects.toThrow(/完成/)
  complete()
  expect(await reading).toMatchObject({ revision: 6, fields: [{ current: { model: 'saved' } }] })
  expect(app.row().revision).toBe(6)
  await app.unload()
})
