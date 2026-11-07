import { describe, expect, it, vi } from 'vitest'
import { readPresenceConfig, sanitizeConfigPatch, writePresenceConfig, type ConfigEditorLike, type PresenceModelStore } from './config-editor.ts'
import { resolveConfig } from './contracts.ts'
import { PresenceError } from './welcome-back.ts'

const base = resolveConfig()

function store(model: { provider: string; model: string } | null = null): PresenceModelStore & { writes: (typeof model)[]; ghostWrites: (typeof model)[]; fieldWrites: [string, typeof model][] } {
  const row = { revision: 0, model, ghostModel: null as typeof model, judgeModel: null as typeof model, handoffModel: null as typeof model }
  const writes: (typeof model)[] = []
  const ghostWrites: (typeof model)[] = []
  const fieldWrites: [string, typeof model][] = []
  const stub = {
    writes,
    ghostWrites,
    fieldWrites,
    read: () => row,
    write: async (next: typeof model) => stub.writeFeature('model', next),
    writeGhost: async (next: typeof model) => stub.writeFeature('ghostModel', next),
    writeFeature: async (field: 'model' | 'ghostModel' | 'judgeModel' | 'handoffModel', next: typeof model) => {
      fieldWrites.push([field, next])
      if (field === 'model') { writes.push(next); row.model = next }
      if (field === 'ghostModel') { ghostWrites.push(next); row.ghostModel = next }
      if (field === 'judgeModel') row.judgeModel = next
      if (field === 'handoffModel') row.handoffModel = next
      row.revision += 1
      return row.revision
    },
  }
  return stub as PresenceModelStore & { writes: (typeof model)[]; ghostWrites: (typeof model)[]; fieldWrites: [string, typeof model][] }
}

describe('presence config patches', () => {
  it('validates every key and rejects unknown or out-of-range values', () => {
    expect(sanitizeConfigPatch({ recapMinutes: 30, continueMode: 'auto' })).toEqual({ recapMinutes: 30, continueMode: 'auto' })
    expect(sanitizeConfigPatch({ continueText: '  接着做  ' })).toEqual({ continueText: '接着做' })
    expect(sanitizeConfigPatch({ model: { provider: ' p ', model: ' m ' } })).toEqual({ model: { provider: 'p', model: 'm' } })
    expect(sanitizeConfigPatch({ model: null })).toEqual({ model: null })
    for (const patch of [
      { recapMinutes: -1 }, { compactMinutes: 10_081 }, { recapMinutes: 1.5 }, { recapMinutes: '15' },
      { continueText: 42 }, { continueText: '很'.repeat(201) }, { continueMode: 'sometimes' }, { theme: 'dark' },
      { model: 42 }, { model: 'openai/gpt' }, { model: {} }, { model: { provider: 'p' } }, { model: { provider: ' ', model: 'm' } },
      { model: [] }, null, [],
    ]) {
      expect(() => sanitizeConfigPatch(patch)).toThrowError(PresenceError)
    }
  })

  it('reads the resolved view and writes through the host config editor', async () => {
    expect(readPresenceConfig(base)).toEqual({
      recapMinutes: 15, compactMinutes: 60, continueText: '', continueMode: 'fixed', model: null, ghostModel: null, judgeModel: null, handoffModel: null, autoContinueMode: 'off', autoContinueMax: 3,
    })
    const models = store({ provider: 'p', model: 'm' })
    expect(readPresenceConfig(base, models).model).toEqual({ provider: 'p', model: 'm' })
    const edit = vi.fn(async (_entry: unknown, change: (current: Record<string, unknown>) => Record<string, unknown>) => {
      expect(change({ pageChars: 4000 })).toEqual({ pageChars: 4000, continueMode: 'auto' })
    })
    const editor: ConfigEditorLike = {
      entries: () => [{ options: { name: '@klarkxy/dsh-session-manager' } }],
      edit,
    }
    const root = { get: (name: string) => name === 'configEditor' ? editor : undefined }
    const view = await writePresenceConfig(root as never, base, { continueMode: 'auto' })
    expect(edit).toHaveBeenCalledOnce()
    expect(view).toMatchObject({ continueMode: 'auto', recapMinutes: 15 })
  })

  it('writes the model route to plugin storage without touching the config editor', async () => {
    const models = store()
    const root = { get: () => undefined }
    const view = await writePresenceConfig(root as never, base, { model: { provider: 'p', model: 'm' } }, models)
    expect(models.writes).toEqual([{ provider: 'p', model: 'm' }])
    expect(view.model).toEqual({ provider: 'p', model: 'm' })
    const ghost = await writePresenceConfig(root as never, base, { ghostModel: { provider: 'g', model: 'ghost' } }, models)
    expect(models.ghostWrites).toEqual([{ provider: 'g', model: 'ghost' }])
    expect(ghost.ghostModel).toEqual({ provider: 'g', model: 'ghost' })
    // Follow-default clears the stored route.
    const cleared = await writePresenceConfig(root as never, base, { model: null }, models)
    expect(models.writes.at(-1)).toBeNull()
    expect(cleared.model).toBeNull()
  })

  it('validates and retains optional effort and forwards request cancellation to every feature write', async () => {
    const route = { provider: 'p', model: 'm', reasoningEffort: 'high' }
    const models = store()
    const feature = vi.spyOn(models, 'writeFeature')
    const signal = new AbortController().signal
    const view = await writePresenceConfig({ get: () => undefined } as never, base,
      { model: route, ghostModel: route, judgeModel: route, handoffModel: route }, models, signal)
    expect(view).toMatchObject({ model: route, ghostModel: route, judgeModel: route, handoffModel: route })
    expect(feature.mock.calls).toEqual([
      ['model', route, { signal }],
      ['ghostModel', route, { signal }],
      ['judgeModel', route, { signal }],
      ['handoffModel', route, { signal }],
    ])
    for (const reasoningEffort of ['', ' ', 4, null, {}]) {
      expect(() => sanitizeConfigPatch({ ghostModel: { ...route, reasoningEffort } })).toThrow(PresenceError)
    }
    const abort = new AbortController()
    abort.abort()
    await expect(writePresenceConfig({} as never, base, { model: route }, models, abort.signal))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(feature).toHaveBeenCalledTimes(4)
  })

  it('fails soft on a model write when plugin storage is absent', async () => {
    const root = { get: () => undefined }
    await expect(writePresenceConfig(root as never, base, { model: { provider: 'p', model: 'm' } }))
      .rejects.toMatchObject({ code: 'session-manager/unavailable' })
  })

  it('fails closed without the editor or the entry', async () => {
    const missingEditor = { get: () => undefined }
    await expect(writePresenceConfig(missingEditor as never, base, { recapMinutes: 20 }))
      .rejects.toMatchObject({ code: 'session-manager/unavailable' })
    const missingEntry = { get: () => ({ entries: () => [], edit: vi.fn() }) }
    await expect(writePresenceConfig(missingEntry as never, base, { recapMinutes: 20 }))
      .rejects.toMatchObject({ code: 'session-manager/unavailable' })
  })
})
