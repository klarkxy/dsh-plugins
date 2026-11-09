import { describe, expect, it, vi } from 'vitest'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { createPreferredSelect } from './client.tsx'
import { EffortPreference } from './effort-preference.ts'

/* Groups mirroring client.spec's catalog: 'one' offers low+high, 'two' low,
 * 'plain' has no reasoning metadata at all. */
const groups: ModelDirectoryState['groups'] = [
  { id: 'p', name: 'Provider', models: [
    { id: 'one', name: 'One', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'high' } },
    { id: 'two', name: 'Two', reasoning: { efforts: [{ id: 'low', name: 'Low' }], defaultEffort: 'low' } },
  ] },
  { id: 'q', name: 'Q', models: [{ id: 'plain', name: 'Plain' }] },
]

function harness(state: Partial<ModelDirectoryState> = {}, result: { ok: boolean; error?: { code: string; message: string } } | undefined = { ok: true }) {
  const snapshot: ModelDirectoryState = {
    current: { provider: 'p', model: 'one', reasoningEffort: 'high' },
    routable: true, groups, failures: [], status: 'ready', pending: null, error: null,
    ...state,
  }
  const directory = {
    store: {
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
      update: () => {},
      set: () => {},
    },
    select: vi.fn(async () => result),
  }
  const preference = new EffortPreference()
  return { directory, preference, select: createPreferredSelect(directory as never, preference) }
}

describe('createPreferredSelect (seat wiring)', () => {
  it('same-route picks pass through verbatim and are remembered on success', async () => {
    const { directory, preference, select } = harness()
    const result = await select({ provider: 'p', model: 'one', reasoningEffort: 'low' })
    expect(directory.select).toHaveBeenCalledWith({ provider: 'p', model: 'one', reasoningEffort: 'low' })
    expect(result).toEqual({ ok: true })
    expect(preference.effortFor({ provider: 'p', model: 'one' })).toBe('low')
  })

  it('a successful Default pick clears the remembered effort for the route', async () => {
    const { preference, select } = harness()
    preference.remember({ provider: 'p', model: 'one' }, 'high')
    await select({ provider: 'p', model: 'one' })
    expect(preference.effortFor({ provider: 'p', model: 'one' })).toBeUndefined()
  })

  it('a cross-route pick re-attaches the remembered effort the target declares', async () => {
    const { directory, preference, select } = harness()
    preference.remember({ provider: 'p', model: 'two' }, 'low')
    await select({ provider: 'p', model: 'two' })
    expect(directory.select).toHaveBeenCalledWith({ provider: 'p', model: 'two', reasoningEffort: 'low' })
    expect(preference.effortFor({ provider: 'p', model: 'two' })).toBe('low')
  })

  it('a cross-route pick to a model not declaring the remembered effort goes out bare', async () => {
    const { directory, select } = harness()
    // 'two' declares only 'low': a 'high' memory can never reach it.
    const pref = new EffortPreference()
    pref.remember({ provider: 'p', model: 'two' }, 'high')
    const select2 = createPreferredSelect(directory as never, pref)
    await select2({ provider: 'p', model: 'two' })
    expect(directory.select).toHaveBeenCalledWith({ provider: 'p', model: 'two' })
    await select({ provider: 'q', model: 'plain' })
    expect(directory.select).toHaveBeenLastCalledWith({ provider: 'q', model: 'plain' })
  })

  it('an explicit effort wins over memory even across routes', async () => {
    const { directory, select, preference } = harness()
    preference.remember({ provider: 'p', model: 'two' }, 'low')
    await select({ provider: 'p', model: 'two', reasoningEffort: 'low' })
    expect(directory.select).toHaveBeenCalledWith({ provider: 'p', model: 'two', reasoningEffort: 'low' })
    expect(preference.effortFor({ provider: 'p', model: 'two' })).toBe('low')
  })

  it('a failed select never updates memory: remembered effort survives, failure result passes through', async () => {
    const failure = { ok: false, error: { code: 'session/model-unavailable', message: 'gone' } }
    const { preference, select } = harness({}, failure)
    preference.remember({ provider: 'p', model: 'two' }, 'low')
    const result = await select({ provider: 'p', model: 'two' })
    expect(result).toEqual(failure)
    expect(preference.effortFor({ provider: 'p', model: 'two' })).toBe('low')
  })

  it('an undefined result (unavailable directory) is not success and writes nothing', async () => {
    const { preference, select } = harness({}, undefined)
    await select({ provider: 'p', model: 'two' })
    expect(preference.effortFor({ provider: 'p', model: 'two' })).toBeUndefined()
  })

  it('a cleared route stays bare: Default is never re-forced on later picks', async () => {
    const { directory, select } = harness()
    const pref = new EffortPreference()
    pref.remember({ provider: 'p', model: 'two' }, 'low')
    pref.remember({ provider: 'p', model: 'two' }, undefined)
    const select2 = createPreferredSelect(directory as never, pref)
    await select2({ provider: 'p', model: 'two' })
    expect(directory.select).toHaveBeenCalledWith({ provider: 'p', model: 'two' })
  })
})
