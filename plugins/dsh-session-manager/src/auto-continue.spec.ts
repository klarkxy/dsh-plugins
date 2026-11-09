import { describe, expect, it, vi } from 'vitest'
import {
  AutoContinueService, type AutoContinueRecentTableLike, type AutoContinueServiceDeps, type AutoContinueTableLike,
} from './auto-continue.ts'
import type { AutoContinueRecent, SessionAutoContinue } from './storage.ts'
import { parseAutoContinue, parseAutoContinueRecent } from './storage.ts'
import type { ResolvedConfig } from './contracts.ts'

function table(rows: Record<string, SessionAutoContinue> = {}) {
  const puts: SessionAutoContinue[] = []
  return {
    rows, puts,
    get: (key: string) => rows[key],
    put: async (key: string, value: SessionAutoContinue) => { puts.push(value); rows[key] = value },
  }
}

function recentTable(rows: Record<string, AutoContinueRecent> = {}) {
  const puts: AutoContinueRecent[] = []
  return {
    rows, puts,
    get: (key: string) => rows[key],
    put: async (key: string, value: AutoContinueRecent) => { puts.push(value); rows[key] = value },
  }
}

const top = (id: string) => ({ id, header: {} })
const sub = (id: string, parentSession: string) => ({
  id, header: { parentSession, origin: 'subagent', delegationDepth: 1, isSeeded: true },
})
const fork = (id: string, parentSession: string) => ({ id, header: { parentSession, isSeeded: true } })

const config = (): Pick<ResolvedConfig, 'autoContinueMode' | 'autoContinueMax'> =>
  ({ autoContinueMode: 'bold', autoContinueMax: 5 })

const UNMOUNTED = 'unmounted' as const
function service(
  overrides: Partial<AutoContinueServiceDeps> = {},
  records: AutoContinueTableLike | typeof UNMOUNTED = table(),
  recent: AutoContinueRecentTableLike | typeof UNMOUNTED = recentTable(),
) {
  return new AutoContinueService({
    records: () => records === UNMOUNTED ? undefined : records,
    recent: () => recent === UNMOUNTED ? undefined : recent,
    hasStarted: () => false,
    agents: { get: id => ({ id, runMaintenance: job => job(new AbortController().signal) }) },
    config,
    ...overrides,
  })
}

describe('auto-continue seeding', () => {
  it('seeds a startup session with the configured default', async () => {
    const records = table()
    await service({}, records).seed({ id: 's1', session: top('s1') }, 'startup')
    expect(records.rows.s1).toEqual({ mode: 'bold', max: 5, revision: 1 })
  })

  it('lets a human fork inherit the parent record instead of the default', async () => {
    const records = table({ root: { mode: 'cautious', max: 7, revision: 4 } })
    await service({}, records).seed({ id: 'f1', session: fork('f1', 'root') }, 'startup')
    expect(records.rows.f1).toEqual({ mode: 'cautious', max: 7, revision: 1 })
  })

  it('never seeds a subagent session or a resumed session', async () => {
    const records = table()
    const svc = service({}, records)
    await svc.seed({ id: 'sub1', session: sub('sub1', 'root') }, 'startup')
    await svc.seed({ id: 's1', session: top('s1') }, 'resume')
    expect(records.rows.sub1).toBeUndefined()
    expect(records.rows.s1).toBeUndefined()
  })

  it('seeds a fresh session from the remembered choice, not the configured default', async () => {
    const records = table()
    const recent = recentTable({ global: { mode: 'cautious' } })
    await service({}, records, recent).seed({ id: 's1', session: top('s1') }, 'startup')
    expect(records.rows.s1).toEqual({ mode: 'cautious', max: 5, revision: 1 })
    // Seeding only reads the memo; it never creates one.
    expect(recent.puts).toHaveLength(0)
  })

  it('falls back to the configured default when the memo is missing or unreadable', async () => {
    for (const raw of [undefined, { mode: 'wild' }, 'cautious']) {
      const records = table()
      const recent: AutoContinueRecentTableLike = {
        get: () => raw,
        put: async () => {},
      }
      await service({}, records, recent).seed({ id: 's1', session: top('s1') }, 'startup')
      expect(records.rows.s1).toEqual({ mode: 'bold', max: 5, revision: 1 })
    }
    // An unmounted memo table still seeds from the configured default.
    const records = table()
    await service({}, records, UNMOUNTED).seed({ id: 's1', session: top('s1') }, 'startup')
    expect(records.rows.s1).toEqual({ mode: 'bold', max: 5, revision: 1 })
  })

  it('persists the remembered choice across a service restart (same store, new instance)', async () => {
    const records = table()
    const recent = recentTable()
    const sessions = new Map([['s1', top('s1')], ['s2', top('s2')]])
    const sessionStore = { get: (id: string) => sessions.get(id) }
    await service({ sessionStore }, records, recent).update('s1', 'cautious', 0)
    await service({ sessionStore }, records, recent).seed({ id: 's2', session: top('s2') }, 'startup')
    expect(records.rows.s2).toEqual({ mode: 'cautious', max: 5, revision: 1 })
  })

  it('keeps the old fork semantics: a missing parent row uses the configured default, never the memo', async () => {
    const records = table()
    const recent = recentTable({ global: { mode: 'off' } })
    await service({}, records, recent).seed({ id: 'f1', session: fork('f1', 'gone') }, 'startup')
    expect(records.rows.f1).toEqual({ mode: 'bold', max: 5, revision: 1 })
  })

  it('commits concurrent memo writes in enqueue order', async () => {
    const records = table()
    const recent = recentTable()
    const gate = { release: () => {} }
    const base = recent.put
    const entered: string[] = []
    recent.put = async (key, value) => {
      entered.push(value.mode)
      if (entered.length === 1) await new Promise<void>(done => { gate.release = done })
      await base(key, value)
    }
    const sessions = new Map([['s1', top('s1')], ['s2', top('s2')]])
    const svc = service({ sessionStore: { get: id => sessions.get(id) } }, records, recent)
    const first = svc.update('s1', 'cautious', 0)
    await vi.waitFor(() => expect(entered).toEqual(['cautious']))
    const second = svc.update('s2', 'bold', 0)
    await vi.waitFor(() => expect(records.rows.s2).toBeDefined())
    expect(entered).toEqual(['cautious'])
    gate.release()
    await Promise.all([first, second])
    expect(entered).toEqual(['cautious', 'bold'])
    expect(recent.rows.global).toEqual({ mode: 'bold' })
  })

  it('lets a fork inherit its parent while leaving the remembered choice untouched', async () => {
    const records = table({ root: { mode: 'cautious', max: 7, revision: 4 } })
    const recent = recentTable({ global: { mode: 'bold' } })
    const sessions = new Map([['f1', fork('f1', 'root')]])
    const svc = service({ sessionStore: { get: id => sessions.get(id) } }, records, recent)
    await svc.seed({ id: 'f1', session: fork('f1', 'root') }, 'startup')
    expect(records.rows.f1).toEqual({ mode: 'cautious', max: 7, revision: 1 })
    await svc.update('f1', 'bold', 1)
    expect(records.rows.f1).toEqual({ mode: 'bold', max: 5, revision: 2 })
    expect(recent.rows.global).toEqual({ mode: 'bold' })
    expect(recent.puts).toHaveLength(0)
  })
})

describe('auto-continue status and updates', () => {
  it('reports executor role for a subagent and coordinator otherwise', async () => {
    const sessions = new Map([['sub1', sub('sub1', 'root')], ['s1', top('s1')]])
    const svc = service({ sessionStore: { get: id => sessions.get(id) } })
    expect(await svc.status('sub1')).toMatchObject({ role: 'executor', mode: 'off', revision: 0 })
    expect(await svc.status('s1')).toMatchObject({ role: 'coordinator' })
  })

  it('writes the chosen mode with the current limit at the next revision', async () => {
    const records = table({ s1: { mode: 'off', max: 5, revision: 1 } })
    const svc = service({ sessionStore: { get: () => top('s1') } }, records)
    const status = await svc.update('s1', 'cautious', 1)
    expect(records.rows.s1).toEqual({ mode: 'cautious', max: 5, revision: 2 })
    expect(status).toMatchObject({ mode: 'cautious', max: 5, revision: 2, locked: false })
  })

  it('rejects locked, stale and busy sessions without writing', async () => {
    const records = table({ s1: { mode: 'off', max: 5, revision: 2 } })
    const locked = service({ hasStarted: () => true, sessionStore: { get: () => top('s1') } }, records)
    await expect(locked.update('s1', 'bold', 2)).rejects.toMatchObject({ code: 'session-locked' })
    const stale = service({ sessionStore: { get: () => top('s1') } }, records)
    await expect(stale.update('s1', 'bold', 1)).rejects.toMatchObject({ code: 'stale' })
    const busy = service({
      sessionStore: { get: () => top('s1') },
      agents: { get: id => ({ id, runMaintenance: () => { throw new Error('active work') } }) },
    }, records)
    await expect(busy.update('s1', 'bold', 2)).rejects.toMatchObject({ code: 'session-busy' })
    expect(records.puts).toHaveLength(0)
    expect(records.rows.s1).toEqual({ mode: 'off', max: 5, revision: 2 })
  })

  it('rejects a subagent session and a missing session', async () => {
    const sessions = new Map([['sub1', sub('sub1', 'root')]])
    const svc = service({ sessionStore: { get: id => sessions.get(id) } })
    await expect(svc.update('sub1', 'bold', 0)).rejects.toMatchObject({ code: 'not-top-level' })
    await expect(svc.update('ghost', 'bold', 0)).rejects.toMatchObject({ code: 'no-session' })
  })

  it('reads locked off and fails updates when storage is not mounted', async () => {
    const svc = service({ sessionStore: { get: () => top('s1') } }, UNMOUNTED)
    expect(await svc.status('s1')).toMatchObject({ mode: 'off', locked: true, revision: 0 })
    await expect(svc.update('s1', 'bold', 0)).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('remembers the chosen mode for later fresh sessions, including off', async () => {
    const records = table()
    const recent = recentTable()
    const sessions = new Map([['s1', top('s1')]])
    const svc = service({ sessionStore: { get: id => sessions.get(id) } }, records, recent)
    await svc.update('s1', 'off', 0)
    expect(recent.rows.global).toEqual({ mode: 'off' })
    await svc.seed({ id: 's2', session: top('s2') }, 'startup')
    expect(records.rows.s2).toEqual({ mode: 'off', max: 5, revision: 1 })
  })

  it('does not write the memo when the session update is rejected', async () => {
    const records = table({ s1: { mode: 'off', max: 5, revision: 2 } })
    const recent = recentTable()
    const svc = service({ hasStarted: () => true, sessionStore: { get: () => top('s1') } }, records, recent)
    await expect(svc.update('s1', 'bold', 2)).rejects.toMatchObject({ code: 'session-locked' })
    expect(recent.puts).toHaveLength(0)
  })

  it('still reports a committed session update when the memo write fails', async () => {
    const records = table()
    const recent: AutoContinueRecentTableLike = {
      get: () => undefined,
      put: async () => { throw new Error('memo disk full') },
    }
    const sessions = new Map([['s1', top('s1')]])
    const svc = service({ sessionStore: { get: id => sessions.get(id) } }, records, recent)
    await expect(svc.update('s1', 'cautious', 0)).resolves.toMatchObject({ mode: 'cautious', revision: 1 })
    expect(records.rows.s1).toEqual({ mode: 'cautious', max: 5, revision: 1 })
  })
})

describe('auto-continue row parsing', () => {
  it('rejects malformed recent rows and accepts both directions', () => {
    for (const row of [{ mode: 'wild' }, 'cautious', 1, undefined]) {
      expect(parseAutoContinueRecent(row)).toBeUndefined()
    }
    expect(parseAutoContinueRecent({ mode: 'off' })).toEqual({ mode: 'off' })
    expect(parseAutoContinueRecent({ mode: 'bold' })).toEqual({ mode: 'bold' })
  })

  it('rejects malformed rows', () => {
    for (const row of [
      { mode: 'wild', max: 3, revision: 1 },
      { mode: 'bold', max: 0, revision: 1 },
      { mode: 'bold', max: 11, revision: 1 },
      { mode: 'bold', max: 3, revision: 0 },
      { mode: 'bold', max: 3, revision: 1, extra: true },
      'bold',
      undefined,
    ]) {
      expect(parseAutoContinue(row)).toBeUndefined()
    }
    expect(parseAutoContinue({ mode: 'bold', max: 10, revision: 9 })).toEqual({ mode: 'bold', max: 10, revision: 9 })
  })

  it('serializes two same-revision updates so only one wins', async () => {
    const gate = { release: () => {} }
    const records = table({ s1: { mode: 'off', max: 5, revision: 1 } })
    const put = records.put
    records.put = async (key, value) => { await new Promise<void>(done => { gate.release = done }); await put(key, value) }
    const svc = service({ sessionStore: { get: () => top('s1') } }, records)
    const first = svc.update('s1', 'cautious', 1)
    const second = svc.update('s1', 'bold', 1)
    await vi.waitFor(() => expect(records.puts.length + 1).toBeGreaterThan(0))
    gate.release()
    const [won, lost] = await Promise.allSettled([first, second])
    expect(won.status).toBe('fulfilled')
    expect(lost.status).toBe('rejected')
    expect((lost as PromiseRejectedResult).reason).toMatchObject({ code: 'stale' })
  })
})
