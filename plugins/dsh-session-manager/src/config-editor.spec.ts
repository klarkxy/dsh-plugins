import { describe, expect, it, vi } from 'vitest'
import { readPresenceConfig, sanitizeConfigPatch, writePresenceConfig, type ConfigEditorLike, type PresenceModelStore } from './config-editor.ts'
import { resolveConfig } from './contracts.ts'
import { PresenceError } from './welcome-back.ts'

const base = resolveConfig()

function store(model: { provider: string; model: string } | null = null): PresenceModelStore & { writes: (typeof model)[]; ghostWrites: (typeof model)[] } {
  const row = { revision: 0, model, ghostModel: null as typeof model }
  const writes: (typeof model)[] = []
  const ghostWrites: (typeof model)[] = []
  return {
    writes,
    ghostWrites,
    read: () => row,
    write: async next => { writes.push(next); row.model = next; row.revision += 1; return row.revision },
    writeGhost: async next => { ghostWrites.push(next); row.ghostModel = next; row.revision += 1; return row.revision },
  }
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
      recapMinutes: 15, compactMinutes: 60, continueText: '', continueMode: 'fixed', model: null, ghostModel: null,
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

  it('validates and retains optional effort and forwards request cancellation to both store writes', async () => {
    const route = { provider: 'p', model: 'm', reasoningEffort: 'high' }
    const models = store()
    const write = vi.spyOn(models, 'write')
    const ghost = vi.spyOn(models, 'writeGhost')
    const signal = new AbortController().signal
    const view = await writePresenceConfig({ get: () => undefined } as never, base,
      { model: route, ghostModel: route }, models, signal)
    expect(view).toMatchObject({ model: route, ghostModel: route })
    expect(write).toHaveBeenCalledWith(route, { signal })
    expect(ghost).toHaveBeenCalledWith(route, { signal })
    for (const reasoningEffort of ['', ' ', 4, null, {}]) {
      expect(() => sanitizeConfigPatch({ ghostModel: { ...route, reasoningEffort } })).toThrow(PresenceError)
    }
    const abort = new AbortController()
    abort.abort()
    await expect(writePresenceConfig({} as never, base, { model: route }, models, abort.signal))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(write).toHaveBeenCalledOnce()
  })

  it('fails soft on a model write when plugin storage is absent', async () => {
    const root = { get: () => undefined }
    await expect(writePresenceConfig(root as never, base, { model: { provider: 'p', model: 'm' } }))
      .rejects.toMatchObject({ code: 'session-manager/unavailable' })
    // Patches without a model change never need the store.
    const missingEntry = { get: () => ({ entries: () => [], edit: vi.fn() }) }
    await expect(writePresenceConfig(missingEntry as never, base, { recapMinutes: 20 }))
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
