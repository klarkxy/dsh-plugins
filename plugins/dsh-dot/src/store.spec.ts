import { describe, expect, it } from 'vitest'
import { DotStore, type DotDomainHandle } from './store.ts'

function fakeDomain(seed: Record<string, Record<string, unknown>> = {}) {
  const tables: Record<string, Map<string, unknown>> = {
    state: new Map(Object.entries(seed.state ?? {})),
    tasks: new Map(Object.entries(seed.tasks ?? {})),
    schedules: new Map(Object.entries(seed.schedules ?? {})),
    proposals: new Map(Object.entries(seed.proposals ?? {})),
  }
  const puts: string[] = []
  const domain: DotDomainHandle = {
    table: name => ({
      entries: () => tables[name]!.entries(),
      get: key => tables[name]!.get(key),
      put: async (key, value) => { puts.push(`${name}:${key}`); tables[name]!.set(key, value) },
      delete: async key => { puts.push(`${name}:-${key}`); return tables[name]!.delete(key) },
    }),
    close: async () => {},
  }
  return { domain, tables, puts }
}

describe('DotStore', () => {
  it('round-trips tasks and the dot identity through the domain', async () => {
    const { domain, tables } = fakeDomain()
    const store = new DotStore(domain)
    await store.setDot({ dotSessionId: 'dot', dotWorkspaceId: 'w' })
    await store.track({ sessionId: 's1', origin: 'started', title: 'T', goal: 'G', cwd: '/w', at: 1 })
    await store.apply({ type: 'turn-end', sessionId: 's1', at: 2, note: 'ok' }, [])
    const reloaded = new DotStore(domain)
    expect(reloaded.dotSessionId).toBe('dot')
    expect(reloaded.task('s1')).toMatchObject({ status: 'idle', unseenTurns: 1, lastNote: 'ok' })
    expect(tables.tasks!.size).toBe(1)
  })

  it('skips malformed rows and rows filed under another key', () => {
    const { domain } = fakeDomain({ tasks: { bad: { nope: true }, other: { sessionId: 'x', origin: 'started', title: '', goal: '', cwd: '', status: 'idle', createdAt: 0, updatedAt: 0, unseenTurns: 0 } } })
    expect(new DotStore(domain).list()).toEqual([])
  })

  it('ignores events of untracked sessions without writing', async () => {
    const { domain, puts } = fakeDomain()
    const store = new DotStore(domain)
    await store.apply({ type: 'status', sessionId: 'nobody', status: 'running', at: 1 }, [])
    expect(puts).toEqual([])
  })

  it('re-tracking an archived task revives it and keeps history', async () => {
    const store = new DotStore(undefined)
    await store.track({ sessionId: 's', origin: 'watched', title: 'T', goal: 'first', cwd: '/', at: 1 })
    await store.apply({ type: 'archived', sessionId: 's', at: 2 }, [])
    const again = await store.track({ sessionId: 's', origin: 'watched', title: 'T', goal: '', cwd: '/', at: 3 })
    expect(again).toMatchObject({ status: 'idle', goal: 'first', createdAt: 1 })
  })

  it('syncs blocked flags and clears unread counters', async () => {
    const store = new DotStore(undefined)
    await store.track({ sessionId: 's', origin: 'started', title: 'T', goal: 'G', cwd: '/', at: 1 })
    await store.apply({ type: 'turn-end', sessionId: 's', at: 2 }, [])
    await store.syncPending([{ id: 'ap-1', kind: 'approval', sessionId: 's', createdAt: 2, subject: 'bash' }])
    expect(store.task('s')!.status).toBe('blocked')
    await store.markAllSeen()
    expect(store.task('s')!.unseenTurns).toBe(0)
    expect(store.board([]).tasks).toHaveLength(1)
  })

  it('keeps reminders across a reload, the one due first on top, and deletes them for good', async () => {
    const { domain, tables, puts } = fakeDomain({ schedules: { broken: { id: 'broken' }, moved: { id: 'other', title: 't', prompt: 'p', timing: { kind: 'once', at: 5 }, createdAt: 1, nextAt: 5 } } })
    const store = new DotStore(domain)
    expect(store.schedules).toEqual([])
    await store.putSchedule({ id: 'sch-b', title: 'later', prompt: 'p', timing: { kind: 'daily', time: '09:00', weekdays: [1, 3] }, createdAt: 1, nextAt: 900 })
    await store.putSchedule({ id: 'sch-a', title: 'sooner', prompt: 'p', timing: { kind: 'every', minutes: 30, anchor: 1 }, createdAt: 2, nextAt: 300, lastFiredAt: 100 })
    const reloaded = new DotStore(domain)
    expect(reloaded.schedules.map(record => record.id)).toEqual(['sch-a', 'sch-b'])
    expect(reloaded.schedule('sch-a')).toMatchObject({ lastFiredAt: 100, timing: { kind: 'every', minutes: 30 } })
    expect(reloaded.board([]).schedules).toHaveLength(2)
    expect(await reloaded.deleteSchedule('sch-a')).toBe(true)
    expect(await reloaded.deleteSchedule('sch-a')).toBe(false)
    expect(tables.schedules!.has('sch-a')).toBe(false)
    expect(puts.at(-1)).toBe('schedules:-sch-a')
    expect(new DotStore(domain).schedules.map(record => record.id)).toEqual(['sch-b'])
  })

  it('serializes writes in call order', async () => {
    const { domain, puts } = fakeDomain()
    const store = new DotStore(domain)
    void store.track({ sessionId: 'a', origin: 'started', title: 'A', goal: '', cwd: '/', at: 1 })
    void store.setDot({ dotSessionId: 'd' })
    void store.track({ sessionId: 'b', origin: 'started', title: 'B', goal: '', cwd: '/', at: 2 })
    await store.flush()
    expect(puts).toEqual(['tasks:a', 'state:current', 'tasks:b'])
  })
})

describe('DotStore settings proposals', () => {
  it('keeps pending decisions across reload and removes them once settled', async () => {
    const { domain, tables } = fakeDomain()
    const store = new DotStore(domain)
    const proposal = { id: 'setting-1', field: 'scope' as const, before: 'all', after: 'tracked', reason: 'test', createdAt: 1 }
    await store.putSettingProposal(proposal)
    expect(new DotStore(domain).settingProposals).toEqual([proposal])
    await store.deleteSettingProposal(proposal.id)
    expect(tables.proposals!.size).toBe(0)
  })
})
