import { describe, expect, it, vi } from 'vitest'
import type { DelegationSettings } from './contracts.ts'
import { DelegationService, type DelegationServiceDeps, type DelegationTableLike } from './service.ts'
import type { RecentChoice, SessionDelegation } from './storage.ts'
import type { DelegationSessionLike } from './policy.ts'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function table<V>(rows: Record<string, V> = {}): DelegationTableLike<V> & { rows: Record<string, V>; puts: V[] } {
  const puts: V[] = []
  return {
    rows, puts,
    get: key => rows[key],
    put: async (key, value) => { puts.push(value); rows[key] = value },
  }
}

const top = (id: string): DelegationSessionLike => ({ id, header: {} })
const sub = (id: string, parentSession: string): DelegationSessionLike => ({
  id, header: { parentSession, origin: 'subagent', delegationDepth: 1, isSeeded: true },
})
const fork = (id: string, parentSession: string): DelegationSessionLike => ({ id, header: { parentSession, isSeeded: true } })

function service(overrides: Partial<DelegationServiceDeps> = {}) {
  return new DelegationService({
    settings: table<DelegationSettings>(),
    records: table<SessionDelegation>(),
    recent: table<RecentChoice>(),
    hasStarted: () => false,
    agents: { get: id => ({ id, runMaintenance: job => job(new AbortController().signal) }) },
    ...overrides,
  })
}

describe('delegation settings CAS', () => {
  it('rejects a stale expectedRevision and leaves the row untouched', async () => {
    const settings = table<DelegationSettings>({ global: { revision: 2, defaultEnabled: false } })
    const svc = service({ settings })
    await expect(svc.updateSettings(true, 1)).rejects.toMatchObject({ code: 'stale' })
    expect(settings.rows.global).toEqual({ revision: 2, defaultEnabled: false })
  })

  it('accepts exactly one of two concurrent updates sharing a revision', async () => {
    const gate = deferred<void>()
    const rows: DelegationSettings[] = []
    let puts = 0
    const settings: DelegationTableLike<DelegationSettings> = {
      get: () => rows.at(-1) ?? ({ revision: 0, defaultEnabled: false } as DelegationSettings),
      put: async (_key, value) => { puts++; await gate.promise; rows.push(value) },
    }
    const svc = service({ settings })
    const first = svc.updateSettings(true, 0)
    const second = svc.updateSettings(false, 0)
    const outcome = Promise.allSettled([first, second])
    await vi.waitFor(() => expect(puts).toBe(1))
    gate.resolve()
    const results = await outcome
    expect(results.map(row => row.status)).toEqual(['fulfilled', 'rejected'])
    expect((results[0] as PromiseFulfilledResult<DelegationSettings>).value).toEqual({ revision: 1, defaultEnabled: true })
    expect((results[1] as PromiseRejectedResult).reason).toMatchObject({ code: 'stale' })
    expect(puts).toBe(1)
    expect(rows).toHaveLength(1)
  })

  it('creates the row at revision 1 when expectedRevision is 0', async () => {
    const svc = service()
    expect(await svc.updateSettings(true, 0)).toEqual({ revision: 1, defaultEnabled: true })
  })
})

describe('session seeding', () => {
  it('uses the current defaultEnabled for a startup session without a record', async () => {
    const records = table<SessionDelegation>()
    const settings = table<DelegationSettings>({ global: { revision: 3, defaultEnabled: true } })
    const svc = service({ settings, records })
    await svc.seedSession({ id: 's1', session: top('s1') }, 'startup')
    expect(records.rows.s1).toEqual({ enabled: true, revision: 1 })
  })

  it('writes nothing for a resumed session without a record, which reads off', async () => {
    const records = table<SessionDelegation>()
    const sessions = new Map([['s1', top('s1')]])
    const svc = service({ records, sessionStore: { get: id => sessions.get(id) } })
    await svc.seedSession({ id: 's1', session: top('s1') }, 'resume')
    expect(records.rows.s1).toBeUndefined()
    expect(await svc.sessionStatus('s1')).toMatchObject({ enabled: false, revision: 0, role: 'coordinator' })
  })

  it('never seeds a subagent session', async () => {
    const records = table<SessionDelegation>()
    const svc = service({ records })
    await svc.seedSession({ id: 'sub1', session: sub('sub1', 'root') }, 'startup')
    expect(records.rows.sub1).toBeUndefined()
  })

  it('lets a human fork inherit the parent record instead of the default', async () => {
    const records = table<SessionDelegation>({ root: { enabled: true, revision: 4 } })
    const settings = table<DelegationSettings>({ global: { revision: 1, defaultEnabled: false } })
    const svc = service({ settings, records })
    await svc.seedSession({ id: 'fork', session: fork('fork', 'root') }, 'startup')
    expect(records.rows.fork).toEqual({ enabled: true, revision: 1 })
  })

  it('falls back to the default when the forked parent has no record', async () => {
    const records = table<SessionDelegation>()
    const settings = table<DelegationSettings>({ global: { revision: 1, defaultEnabled: true } })
    const svc = service({ settings, records })
    await svc.seedSession({ id: 'fork', session: fork('fork', 'root') }, 'startup')
    expect(records.rows.fork).toEqual({ enabled: true, revision: 1 })
  })

  it('keeps an existing record when the default later changes', async () => {
    const records = table<SessionDelegation>({ s1: { enabled: false, revision: 2 } })
    const settings = table<DelegationSettings>({ global: { revision: 1, defaultEnabled: false } })
    const svc = service({ settings, records })
    await svc.updateSettings(true, 1)
    expect(records.rows.s1).toEqual({ enabled: false, revision: 2 })
  })

  it('propagates storage failures so the event listener can swallow them', async () => {
    const records: DelegationTableLike<SessionDelegation> = {
      get: () => undefined,
      put: async () => { throw new Error('disk full') },
    }
    const svc = service({ records })
    await expect(svc.seedSession({ id: 's1', session: top('s1') }, 'startup')).rejects.toThrow('disk full')
  })
})

describe('remembered new-session choice', () => {
  it('seeds a fresh session from the remembered choice, not the stored default', async () => {
    const records = table<SessionDelegation>()
    const recent = table<RecentChoice>({ global: { enabled: true } })
    const settings = table<DelegationSettings>({ global: { revision: 3, defaultEnabled: false } })
    const svc = service({ records, recent, settings })
    await svc.seedSession({ id: 's1', session: top('s1') }, 'startup')
    expect(records.rows.s1).toEqual({ enabled: true, revision: 1 })
    // Seeding only reads the memo; it never creates one.
    expect(recent.puts).toHaveLength(0)
  })

  it('persists the remembered choice across a service restart (same store, new instance)', async () => {
    const records = table<SessionDelegation>()
    const recent = table<RecentChoice>()
    const sessions = new Map([['s1', top('s1')], ['s2', top('s2')]])
    const sessionStore = { get: (id: string) => sessions.get(id) }
    const first = service({ records, recent, sessionStore })
    await first.updateSession('s1', true, 0)
    const restarted = service({ records, recent, sessionStore })
    await restarted.seedSession({ id: 's2', session: top('s2') }, 'startup')
    expect(records.rows.s2).toEqual({ enabled: true, revision: 1 })
  })

  it('remembers an explicit off choice just like an on choice', async () => {
    const records = table<SessionDelegation>()
    const recent = table<RecentChoice>({ global: { enabled: true } })
    const settings = table<DelegationSettings>({ global: { revision: 1, defaultEnabled: true } })
    const sessions = new Map([['s1', top('s1')]])
    const svc = service({ records, recent, settings, sessionStore: { get: id => sessions.get(id) } })
    await svc.updateSession('s1', false, 0)
    expect(recent.rows.global).toEqual({ enabled: false })
    await svc.seedSession({ id: 's2', session: top('s2') }, 'startup')
    expect(records.rows.s2).toEqual({ enabled: false, revision: 1 })
  })

  it('falls back to the stored default when the memo is missing or unreadable', async () => {
    const settings = table<DelegationSettings>({ global: { revision: 1, defaultEnabled: true } })
    for (const raw of [undefined, { enabled: 'yes' }, 'true', 1]) {
      const records = table<SessionDelegation>()
      const recent: DelegationTableLike<RecentChoice> = {
        get: () => raw as RecentChoice | undefined,
        put: async () => {},
      }
      const svc = service({ records, recent, settings })
      await svc.seedSession({ id: 's1', session: top('s1') }, 'startup')
      expect(records.rows.s1).toEqual({ enabled: true, revision: 1 })
    }
    // No recent table at all still seeds from the default.
    const records = table<SessionDelegation>()
    const svc = service({ records, settings, recent: undefined })
    await svc.seedSession({ id: 's1', session: top('s1') }, 'startup')
    expect(records.rows.s1).toEqual({ enabled: true, revision: 1 })
  })

  it('keeps the old fork semantics: a missing parent row uses the default, never the memo', async () => {
    const records = table<SessionDelegation>()
    const recent = table<RecentChoice>({ global: { enabled: false } })
    const settings = table<DelegationSettings>({ global: { revision: 1, defaultEnabled: true } })
    const svc = service({ records, recent, settings })
    await svc.seedSession({ id: 'f1', session: fork('f1', 'gone') }, 'startup')
    expect(records.rows.f1).toEqual({ enabled: true, revision: 1 })
  })

  it('commits concurrent memo writes in enqueue order', async () => {
    const records = table<SessionDelegation>()
    const gate = deferred<void>()
    const entered: boolean[] = []
    const recent = table<RecentChoice>()
    const base = recent.put
    recent.put = async (key, value) => {
      entered.push(value.enabled)
      if (entered.length === 1) await gate.promise
      await base(key, value)
    }
    const sessions = new Map([['s1', top('s1')], ['s2', top('s2')]])
    const svc = service({ records, recent, sessionStore: { get: id => sessions.get(id) } })
    const first = svc.updateSession('s1', true, 0)
    await vi.waitFor(() => expect(entered).toEqual([true]))
    const second = svc.updateSession('s2', false, 0)
    await vi.waitFor(() => expect(records.rows.s2).toBeDefined())
    expect(entered).toEqual([true])
    gate.resolve()
    await Promise.all([first, second])
    expect(entered).toEqual([true, false])
    expect(recent.rows.global).toEqual({ enabled: false })
  })

  it('lets a fork inherit its parent while leaving the remembered choice untouched', async () => {
    const records = table<SessionDelegation>({ root: { enabled: false, revision: 2 } })
    const recent = table<RecentChoice>({ global: { enabled: true } })
    const sessions = new Map([['f1', fork('f1', 'root')]])
    const svc = service({ records, recent, sessionStore: { get: id => sessions.get(id) } })
    await svc.seedSession({ id: 'f1', session: fork('f1', 'root') }, 'startup')
    expect(records.rows.f1).toEqual({ enabled: false, revision: 1 })
    await svc.updateSession('f1', true, 1)
    expect(records.rows.f1).toEqual({ enabled: true, revision: 2 })
    expect(recent.rows.global).toEqual({ enabled: true })
    expect(recent.puts).toHaveLength(0)
  })

  it('does not write the memo when the session update is rejected', async () => {
    const records = table<SessionDelegation>({ s1: { enabled: true, revision: 2 } })
    const recent = table<RecentChoice>()
    const svc = service({ records, recent, hasStarted: () => true, sessionStore: { get: () => top('s1') } })
    await expect(svc.updateSession('s1', false, 2)).rejects.toMatchObject({ code: 'session-locked' })
    expect(recent.puts).toHaveLength(0)
  })

  it('still reports a committed session update when the memo write fails', async () => {
    const records = table<SessionDelegation>()
    const recent: DelegationTableLike<RecentChoice> = {
      get: () => undefined,
      put: async () => { throw new Error('memo disk full') },
    }
    const sessions = new Map([['s1', top('s1')]])
    const svc = service({ records, recent, sessionStore: { get: id => sessions.get(id) } })
    await expect(svc.updateSession('s1', true, 0)).resolves.toMatchObject({ enabled: true, revision: 1 })
    expect(records.rows.s1).toEqual({ enabled: true, revision: 1 })
  })
})

describe('session updates', () => {
  it('locks started, resumed, forked and uninspectable sessions without writing', async () => {
    for (const hasStarted of [() => true, undefined]) {
      const records = table<SessionDelegation>({ s1: { enabled: true, revision: 2 } })
      const svc = service({ records, hasStarted, sessionStore: { get: () => top('s1') } })
      expect(await svc.sessionStatus('s1')).toMatchObject({ locked: true })
      await expect(svc.updateSession('s1', false, 2)).rejects.toMatchObject({ code: 'session-locked' })
      expect(records.puts).toHaveLength(0)
      expect(records.rows.s1).toEqual({ enabled: true, revision: 2 })
    }
  })

  it('holds the host maintenance phase until a slow save finishes', async () => {
    const gate = deferred<void>()
    let maintenance = false
    const records = table<SessionDelegation>()
    const put = records.put
    records.put = async (key, value) => { await gate.promise; await put(key, value) }
    const svc = service({
      records, sessionStore: { get: () => top('s1') },
      agents: { get: id => ({ id, runMaintenance: async job => {
        maintenance = true
        try { return await job(new AbortController().signal) } finally { maintenance = false }
      } }) },
    })
    const saving = svc.updateSession('s1', true, 0)
    await vi.waitFor(() => expect(maintenance).toBe(true))
    expect(records.rows.s1).toBeUndefined()
    gate.resolve()
    await saving
    expect(maintenance).toBe(false)
    expect(records.rows.s1).toEqual({ enabled: true, revision: 1 })
  })

  it('rejects a first-turn race before maintenance admission', async () => {
    const records = table<SessionDelegation>()
    const svc = service({
      records, sessionStore: { get: () => top('s1') },
      agents: { get: id => ({ id, runMaintenance: () => { throw new Error('active work') } }) },
    })
    await expect(svc.updateSession('s1', true, 0)).rejects.toMatchObject({ code: 'session-busy' })
    expect(records.puts).toHaveLength(0)
  })

  it('rechecks the durable boundary after acquiring maintenance', async () => {
    const records = table<SessionDelegation>()
    let started = false
    const svc = service({
      records, sessionStore: { get: () => top('s1') }, hasStarted: () => started,
      agents: { get: id => ({ id, runMaintenance: job => {
        started = true
        return job(new AbortController().signal)
      } }) },
    })
    await expect(svc.updateSession('s1', true, 0)).rejects.toMatchObject({ code: 'session-locked' })
    expect(records.puts).toHaveLength(0)
  })

  it('rejects a missing session, a subagent session, and a stale revision', async () => {
    const sessions = new Map([['s1', top('s1')], ['sub1', sub('sub1', 's1')]])
    const svc = service({ sessionStore: { get: id => sessions.get(id) } })
    await expect(svc.updateSession('ghost', true, 0)).rejects.toMatchObject({ code: 'no-session' })
    await expect(svc.updateSession('sub1', true, 0)).rejects.toMatchObject({ code: 'not-top-level' })
    const records = table<SessionDelegation>({ s1: { enabled: false, revision: 2 } })
    const stale = service({ records, sessionStore: { get: id => sessions.get(id) } })
    await expect(stale.updateSession('s1', true, 1)).rejects.toMatchObject({ code: 'stale' })
  })

  it('creates revision 1 for a first write and reports fresh status', async () => {
    const sessions = new Map([['s1', top('s1')]])
    const svc = service({
      sessionStore: { get: id => sessions.get(id) },
      agents: { get: id => id === 's1' ? { id, runMaintenance: job => job(new AbortController().signal) } : undefined },
      tools: { get: name => name === 'subagent' ? {} : undefined },
    })
    const status = await svc.updateSession('s1', true, 0)
    expect(status).toMatchObject({ sessionId: 's1', role: 'coordinator', enabled: true, revision: 1, capable: true })
  })

  it('reports executor role and null capability where appropriate', async () => {
    const sessions = new Map([['sub1', sub('sub1', 'root')], ['s1', top('s1')]])
    const svc = service({ sessionStore: { get: id => sessions.get(id) }, agents: undefined })
    expect(await svc.sessionStatus('sub1')).toMatchObject({ role: 'executor', enabled: false, revision: 0, capable: null })
    expect(await svc.sessionStatus('s1')).toMatchObject({ role: 'coordinator', capable: null })
  })
})

describe('cold sessions', () => {
  const observation = (header: unknown) => {
    const disposed = vi.fn()
    return {
      handle: { header, [Symbol.dispose]: disposed },
      disposed,
    }
  }

  it('resolves a cold top-level session through the query engine and disposes the observation', async () => {
    const obs = observation({ parentSession: undefined })
    const observeSession = vi.fn(async () => obs.handle)
    const svc = service({
      sessionQuery: { observeSession },
      records: table<SessionDelegation>({ s1: { enabled: true, revision: 4 } }),
    })
    expect(await svc.sessionStatus('s1')).toMatchObject({
      sessionId: 's1', role: 'coordinator', enabled: true, revision: 4, capable: null,
    })
    expect(observeSession).toHaveBeenCalledWith('s1', expect.objectContaining({ projectionMode: 'none' }))
    expect(obs.disposed).toHaveBeenCalledOnce()
  })

  it('reads a cold subagent as executor and rejects its update as not-top-level', async () => {
    const obs = observation({ parentSession: 'root', origin: 'subagent', delegationDepth: 1, isSeeded: true })
    const svc = service({ sessionQuery: { observeSession: async () => obs.handle } })
    expect(await svc.sessionStatus('sub1')).toMatchObject({ role: 'executor', enabled: false, revision: 0 })
    await expect(svc.updateSession('sub1', true, 0)).rejects.toMatchObject({ code: 'not-top-level' })
    expect(obs.disposed).toHaveBeenCalled()
  })

  it('answers no-session when the observation fails', async () => {
    const svc = service({ sessionQuery: { observeSession: async () => { throw new Error('not found') } } })
    await expect(svc.sessionStatus('ghost')).rejects.toMatchObject({ code: 'no-session' })
    await expect(svc.updateSession('ghost', true, 0)).rejects.toMatchObject({ code: 'no-session' })
  })

  it('disposes the observation when a cold session update is rejected', async () => {
    const obs = observation({})
    const svc = service({
      sessionQuery: { observeSession: async () => obs.handle },
      records: { get: () => undefined, put: async () => { throw new Error('disk full') } },
    })
    await expect(svc.updateSession('s1', true, 0)).rejects.toMatchObject({ code: 'session-locked' })
    expect(obs.disposed).toHaveBeenCalledOnce()
  })

  it('rejects a CAS write on a cold top-level session without changing its record', async () => {
    const records = table<SessionDelegation>({ s1: { enabled: false, revision: 2 } })
    const svc = service({
      records,
      sessionQuery: { observeSession: async () => observation({}).handle },
    })
    await expect(svc.updateSession('s1', true, 2)).rejects.toMatchObject({ code: 'session-locked' })
    expect(records.rows.s1).toEqual({ enabled: false, revision: 2 })
  })
})
