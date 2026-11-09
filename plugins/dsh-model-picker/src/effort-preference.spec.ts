import { describe, expect, it, vi } from 'vitest'
import { EffortPreference } from './effort-preference.ts'

const P_ONE = { provider: 'p', model: 'one' }
const P_TWO = { provider: 'p', model: 'two' }
const Q_PLAIN = { provider: 'q', model: 'plain' }

const LOW_HIGH = { efforts: ['low', 'high'] }
const LOW_ONLY = { efforts: ['low'] }
const NO_REASONING = { efforts: [] as string[] }

const ok = () => ({ ok: true as const })
const fail = (code = 'session/model-unavailable') => ({ ok: false as const, error: { code, message: 'nope' } })

describe('EffortPreference.remember/effortFor', () => {
  it('records an explicit effort per route and clears it on undefined', () => {
    const pref = new EffortPreference()
    expect(pref.effortFor(P_ONE)).toBeUndefined()
    pref.remember(P_ONE, 'high')
    pref.remember(P_TWO, 'low')
    expect(pref.effortFor(P_ONE)).toBe('high')
    expect(pref.effortFor(P_TWO)).toBe('low')
    // Choosing "Default" clears the route entry.
    pref.remember(P_ONE, undefined)
    expect(pref.effortFor(P_ONE)).toBeUndefined()
    expect(pref.effortFor(P_TWO)).toBe('low')
  })

  it('route keys are collision-free: {a,bc} and {ab,c} stay distinct', () => {
    const pref = new EffortPreference()
    pref.remember({ provider: 'a', model: 'bc' }, 'high')
    expect(pref.effortFor({ provider: 'ab', model: 'c' })).toBeUndefined()
    expect(pref.effortFor({ provider: 'a', model: 'bc' })).toBe('high')
  })
})

describe('EffortPreference.resolve', () => {
  it('re-attaches the remembered effort only while the route declares it', () => {
    const pref = new EffortPreference()
    pref.remember(P_ONE, 'high')
    // 不支持 High 的模型不會收到 High: declared efforts gate the replay.
    expect(pref.resolve(P_ONE, LOW_HIGH)).toBe('high')
    expect(pref.resolve(P_ONE, LOW_ONLY)).toBeUndefined()
    expect(pref.resolve(P_ONE, NO_REASONING)).toBeUndefined()
    expect(pref.resolve(P_ONE, undefined)).toBeUndefined()
  })
})

describe('EffortPreference.submit', () => {
  it('a model pick attaches the remembered effort so the Host default keeps it', async () => {
    const pref = new EffortPreference()
    pref.remember(P_ONE, 'high')
    const select = vi.fn(async () => ok())
    const result = await pref.submit({ provider: 'p', model: 'one' }, LOW_HIGH, select)
    // New-Session inheritance flows through the Host default save: the
    // submitted selection carries the remembered effort.
    expect(select).toHaveBeenCalledWith({ provider: 'p', model: 'one', reasoningEffort: 'high' })
    expect(result).toEqual({ ok: true })
  })

  it('never attaches an effort the target route does not declare', async () => {
    const pref = new EffortPreference()
    pref.remember(P_ONE, 'high')
    const select = vi.fn(async () => ok())
    await pref.submit({ provider: 'p', model: 'one' }, LOW_ONLY, select)
    expect(select).toHaveBeenCalledWith({ provider: 'p', model: 'one' })
    await pref.submit({ provider: 'q', model: 'plain' }, NO_REASONING, select)
    expect(select).toHaveBeenLastCalledWith({ provider: 'q', model: 'plain' })
  })

  it('a failed RPC updates nothing: memory and the effort on resubmission stay put', async () => {
    const pref = new EffortPreference()
    pref.remember(P_ONE, 'high')
    const select = vi.fn(async () => fail())
    // A rejected "Default" pick must not clear the remembered effort.
    const result = await pref.submit({ provider: 'p', model: 'one', reasoningEffort: undefined }, LOW_HIGH, select)
    expect(result).toEqual(fail())
    expect(select).toHaveBeenCalledWith({ provider: 'p', model: 'one', reasoningEffort: 'high' })
    expect(pref.effortFor(P_ONE)).toBe('high')
  })

  it('an undefined result (unavailable directory) is not success and updates nothing', async () => {
    const pref = new EffortPreference()
    pref.remember(P_ONE, 'high')
    const select = vi.fn(async () => undefined)
    const result = await pref.submit({ provider: 'p', model: 'one' }, LOW_HIGH, select)
    expect(result).toBeUndefined()
    expect(pref.effortFor(P_ONE)).toBe('high')
    // An explicit effort in a vanished-directory call is not recorded either.
    pref.remember(P_TWO, undefined)
    await pref.submit({ provider: 'p', model: 'two', reasoningEffort: 'low' }, LOW_HIGH, select)
    expect(pref.effortFor(P_TWO)).toBeUndefined()
  })

  it('a thrown RPC propagates and updates nothing', async () => {
    const pref = new EffortPreference()
    const select = vi.fn(async () => { throw new Error('offline') })
    await expect(pref.submit(P_ONE, LOW_HIGH, select)).rejects.toThrow('offline')
    expect(pref.effortFor(P_ONE)).toBeUndefined()
  })

  it('after a confirmed Default clear, the next model pick follows the adapter default', async () => {
    const pref = new EffortPreference()
    pref.remember(P_ONE, 'high')
    const select = vi.fn(async () => ok())
    // The seat clears "Default" through select + remember(undefined), never
    // through submit (resolve would re-attach the memory). Once cleared…
    pref.remember(P_ONE, undefined)
    // …the next pick of the same route travels bare — no forced effort.
    await pref.submit({ provider: 'p', model: 'one' }, LOW_HIGH, select)
    expect(select).toHaveBeenCalledWith({ provider: 'p', model: 'one' })
  })

  it('an explicit effort in the request wins over memory and is remembered on success', async () => {
    const pref = new EffortPreference()
    pref.remember(P_ONE, 'high')
    const select = vi.fn(async () => ok())
    await pref.submit({ provider: 'p', model: 'one', reasoningEffort: 'low' }, LOW_HIGH, select)
    expect(select).toHaveBeenCalledWith({ provider: 'p', model: 'one', reasoningEffort: 'low' })
    expect(pref.effortFor(P_ONE)).toBe('low')
  })

  it('per-route isolation: one route never leaks its effort to another', async () => {
    const pref = new EffortPreference()
    pref.remember(P_ONE, 'high')
    const select = vi.fn(async () => ok())
    await pref.submit(P_TWO, LOW_HIGH, select)
    expect(select).toHaveBeenCalledWith({ provider: 'p', model: 'two' })
    expect(pref.effortFor(P_TWO)).toBeUndefined()
  })
})
