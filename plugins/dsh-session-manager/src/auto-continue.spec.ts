import { describe, expect, it, vi } from 'vitest'
import { AutoContinueService, type AutoContinueServiceDeps, type AutoContinueTableLike } from './auto-continue.ts'
import type { SessionAutoContinue } from './storage.ts'
import { parseAutoContinue } from './storage.ts'
import type { ResolvedConfig } from './contracts.ts'

function table(rows: Record<string, SessionAutoContinue> = {}) {
  const puts: SessionAutoContinue[] = []
  return {
    rows, puts,
    get: (key: string) => rows[key],
    put: async (key: string, value: SessionAutoContinue) => { puts.push(value); rows[key] = value },
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
function service(overrides: Partial<AutoContinueServiceDeps> = {}, records: AutoContinueTableLike | typeof UNMOUNTED = table()) {
  return new AutoContinueService({
    records: () => records === UNMOUNTED ? undefined : records,
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
})

describe('auto-continue row parsing', () => {
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
