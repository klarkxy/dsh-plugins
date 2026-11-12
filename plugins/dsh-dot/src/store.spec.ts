import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from './contracts.ts'
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

describe('DotStore agreements and cognition', () => {
  it('preserves existing cognition history when a legacy import supplies an undo version', async () => {
    const { domain } = fakeDomain()
    const store = new DotStore(domain)
    const existing = [{ text: 'an existing version', at: 10 }]
    await store.setDot({ cognitionHistory: existing })
    await store.commitKnowledgeMigration({ cognition: 'imported notes', cognitionHistory: [{ text: 'old undo', at: 20 }], knowledgeMigrated: '1' })
    expect(store.cognitionHistory).toEqual(existing)
    expect(new DotStore(domain).cognitionHistory).toEqual(existing)
  })

  it('keeps agreements and one undo step across a reload', async () => {
    const { domain } = fakeDomain()
    const store = new DotStore(domain)
    expect(store.agreements).toBe('')
    expect(store.agreementsUndo).toBeUndefined()
    await store.setAgreements('- use the standard preset\n')
    await store.setAgreements('- never push to main\n')
    expect(new DotStore(domain).agreements).toBe('- never push to main\n')
    expect(store.agreementsUndo).toBe('- use the standard preset\n')
    expect(await store.undoAgreements()).toBe(true)
    expect(store.agreements).toBe('- use the standard preset\n')
    // One step is kept: taking back again swaps the same two texts.
    expect(store.agreementsUndo).toBe('- never push to main\n')
    expect(await store.undoAgreements()).toBe(true)
    expect(store.agreements).toBe('- never push to main\n')
    expect(new DotStore(domain).agreements).toBe('- never push to main\n')
  })

  it('records each cognition replacement in a capped, strictly increasing history', async () => {
    const store = new DotStore(undefined)
    expect(store.cognitionHistory).toEqual([])
    // Same millisecond writes still get distinct, increasing timestamps.
    for (let index = 0; index < 12; index++) await store.setCognition(`v${index}`, 1000)
    expect(store.cognition).toBe('v11')
    expect(store.cognitionHistory).toHaveLength(10)
    // Newest first; the oldest two fell off.
    expect(store.cognitionHistory[0]!.text).toBe('v10')
    expect(store.cognitionHistory[9]!.text).toBe('v1')
    const ats = store.cognitionHistory.map(entry => entry.at)
    expect(new Set(ats).size).toBe(ats.length)
    for (let index = 1; index < ats.length; index++) expect(ats[index]!).toBeLessThan(ats[index - 1]!)
  })

  it('restores an older cognition text and pushes the replaced one back onto the history', async () => {
    const store = new DotStore(undefined)
    await store.setCognition('first', 10)
    await store.setCognition('second', 20)
    await store.setCognition('third', 30)
    const target = store.cognitionHistory.find(entry => entry.text === 'first')!
    expect(await store.restoreCognition(target.at, 40)).toBe(true)
    expect(store.cognition).toBe('first')
    // The text it replaced is now the newest history entry.
    expect(store.cognitionHistory[0]!.text).toBe('third')
    expect(await store.restoreCognition(999, 50)).toBe(false)
  })

  it('lets the empty text be a restorable version', async () => {
    const store = new DotStore(undefined)
    await store.setCognition('something', 10)
    const empty = store.cognitionHistory.find(entry => entry.text === '')!
    expect(empty).toBeDefined()
    expect(await store.restoreCognition(empty.at, 20)).toBe(true)
    expect(store.cognition).toBe('')
  })

  it('exposes the legacy fields only to migration and marks the import done', async () => {
    const { domain } = fakeDomain({ state: { current: { memory: 'old notes', memoryUndo: 'older notes' } } })
    const store = new DotStore(domain)
    expect(store.legacyMemory).toBe('old notes')
    expect(store.legacyMemoryUndo).toBe('older notes')
    expect(store.knowledgeMigrated).toBe(false)
    await store.commitKnowledgeMigration({ knowledgeMigrated: '1' })
    expect(new DotStore(domain).knowledgeMigrated).toBe(true)
  })
})

describe('DotStore knowledge migration commit', () => {
  it('sets the marker only after the write succeeds, so a failed import retries without losing the note', async () => {
    const tables: Record<string, Map<string, unknown>> = { state: new Map(), tasks: new Map(), schedules: new Map(), proposals: new Map() }
    let failStatePut = true
    const domain: DotDomainHandle = {
      table: name => ({
        entries: () => tables[name]!.entries(),
        get: key => tables[name]!.get(key),
        put: async (key, value) => {
          if (name === 'state' && failStatePut) { failStatePut = false; throw new Error('put down') }
          tables[name]!.set(key, value)
        },
        delete: async key => tables[name]!.delete(key),
      }),
      close: async () => {},
    }
    const store = new DotStore(domain)
    await expect(store.commitKnowledgeMigration({ agreements: '- old note\n', knowledgeMigrated: '1' })).rejects.toThrow('put down')
    // Nothing reached memory, so the next attempt retries from the old note.
    expect(store.agreements).toBe('')
    expect(store.knowledgeMigrated).toBe(false)
    await store.commitKnowledgeMigration({ agreements: '- old note\n', knowledgeMigrated: '1' })
    expect(store.knowledgeMigrated).toBe(true)
    expect(new DotStore(domain).agreements).toBe('- old note\n')
  })

  it('keeps concurrent settings and the migration marker when the state write is slow', async () => {
    const tables: Record<string, Map<string, unknown>> = { state: new Map(), tasks: new Map(), schedules: new Map(), proposals: new Map() }
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let firstStatePut = true
    const domain: DotDomainHandle = {
      table: name => ({
        entries: () => tables[name]!.entries(),
        get: key => tables[name]!.get(key),
        put: async (key, value) => {
          if (name === 'state' && firstStatePut) { firstStatePut = false; await gate }
          tables[name]!.set(key, value)
        },
        delete: async key => tables[name]!.delete(key),
      }),
      close: async () => {},
    }
    const store = new DotStore(domain)
    const committing = store.commitKnowledgeMigration({ agreements: '- old note\n', knowledgeMigrated: '1' })
    // A settings write lands while the migration's state put is still in flight (queued, not awaited yet).
    const setting = store.setSettings({ ...DEFAULT_SETTINGS, scope: 'tracked' })
    release()
    await Promise.all([committing, setting])
    await store.flush()
    const reloaded = new DotStore(domain)
    // Neither the concurrent setting nor the import was lost on disk or in memory.
    expect(reloaded.knowledgeMigrated).toBe(true)
    expect(reloaded.agreements).toBe('- old note\n')
    expect(reloaded.settings.scope).toBe('tracked')
    expect(store.settings.scope).toBe('tracked')
    expect(store.knowledgeMigrated).toBe(true)
  })
})
