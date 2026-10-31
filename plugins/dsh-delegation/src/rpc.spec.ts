import { describe, expect, it } from 'vitest'
import { handleRpc } from './index.ts'
import type { DelegationSettings } from './contracts.ts'
import { DelegationService, type DelegationTableLike } from './service.ts'
import type { SessionDelegation } from './storage.ts'
import type { DelegationSessionLike } from './policy.ts'

const signal = () => new AbortController().signal

function table<V>(rows: Record<string, V> = {}): DelegationTableLike<V> {
  return {
    get: key => rows[key],
    put: async (key, value) => { rows[key] = value },
  }
}

const top = (id: string): DelegationSessionLike => ({ id, header: {} })
const sub = (id: string, parentSession: string): DelegationSessionLike => ({
  id, header: { parentSession, origin: 'subagent', delegationDepth: 1, isSeeded: true },
})

function service(options: { sessions?: Map<string, DelegationSessionLike>; rows?: Record<string, SessionDelegation>; started?: boolean } = {}) {
  return new DelegationService({
    settings: table<DelegationSettings>({ global: { revision: 1, defaultEnabled: false } }),
    records: table<SessionDelegation>(options.rows ?? {}),
    sessionStore: { get: id => options.sessions?.get(id) },
    hasStarted: () => options.started === true,
    agents: { get: id => id === 's1' ? { id, runMaintenance: job => job(new AbortController().signal) } : undefined },
    tools: { get: name => name === 'subagent' ? {} : undefined },
  })
}

describe('delegation RPC', () => {
  it('rejects started-session updates from stale clients', async () => {
    const rows = { s1: { enabled: true, revision: 2 } }
    const svc = service({ sessions: new Map([['s1', top('s1')]]), rows, started: true })
    expect(await handleRpc(svc, 'session.update', { sessionId: 's1', enabled: false, expectedRevision: 2 }, signal()))
      .toMatchObject({ ok: false, error: { code: 'session-locked' } })
    expect(rows.s1).toEqual({ enabled: true, revision: 2 })
  })

  it('serves settings and accepts a valid update', async () => {
    const svc = service()
    expect(await handleRpc(svc, 'settings', {}, signal()))
      .toEqual({ ok: true, value: { revision: 1, defaultEnabled: false } })
    expect(await handleRpc(svc, 'settings.update', { defaultEnabled: true, expectedRevision: 1 }, signal()))
      .toEqual({ ok: true, value: { revision: 2, defaultEnabled: true } })
    expect(await handleRpc(svc, 'settings', undefined, signal()))
      .toEqual({ ok: true, value: { revision: 2, defaultEnabled: true } })
  })

  it('rejects malformed settings updates and stale revisions', async () => {
    const svc = service()
    for (const payload of [{}, { defaultEnabled: 'yes', expectedRevision: 1 }, { defaultEnabled: true }, { defaultEnabled: true, expectedRevision: -1, extra: 1 }]) {
      expect(await handleRpc(svc, 'settings.update', payload, signal()))
        .toMatchObject({ ok: false, error: { code: 'bad-request' } })
    }
    expect(await handleRpc(svc, 'settings.update', { defaultEnabled: true, expectedRevision: 5 }, signal()))
      .toMatchObject({ ok: false, error: { code: 'stale' } })
  })

  it('reports session status with role and capability', async () => {
    const svc = service({
      sessions: new Map([['s1', top('s1')], ['sub1', sub('sub1', 's1')], ['gone', top('gone')]]),
      rows: { s1: { enabled: true, revision: 3 } },
    })
    expect(await handleRpc(svc, 'session.status', { sessionId: 's1' }, signal()))
      .toEqual({ ok: true, value: { sessionId: 's1', role: 'coordinator', enabled: true, revision: 3, capable: true, locked: false } })
    expect(await handleRpc(svc, 'session.status', { sessionId: 'sub1' }, signal()))
      .toMatchObject({ ok: true, value: { sessionId: 'sub1', role: 'executor', enabled: false, revision: 0 } })
    expect(await handleRpc(svc, 'session.status', {}, signal()))
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(await handleRpc(svc, 'session.status', { sessionId: 'nobody' }, signal()))
      .toMatchObject({ ok: false, error: { code: 'no-session' } })
  })

  it('writes session updates with CAS and returns fresh status', async () => {
    const svc = service({ sessions: new Map([['s1', top('s1')], ['sub1', sub('sub1', 's1')]]) })
    expect(await handleRpc(svc, 'session.update', { sessionId: 's1', enabled: true, expectedRevision: 0 }, signal()))
      .toMatchObject({ ok: true, value: { sessionId: 's1', role: 'coordinator', enabled: true, revision: 1, capable: true } })
    expect(await handleRpc(svc, 'session.update', { sessionId: 's1', enabled: false, expectedRevision: 0 }, signal()))
      .toMatchObject({ ok: false, error: { code: 'stale' } })
    expect(await handleRpc(svc, 'session.update', { sessionId: 's1', enabled: false, expectedRevision: 1 }, signal()))
      .toMatchObject({ ok: true, value: { enabled: false, revision: 2 } })
    expect(await handleRpc(svc, 'session.update', { sessionId: 'nobody', enabled: true, expectedRevision: 0 }, signal()))
      .toMatchObject({ ok: false, error: { code: 'no-session' } })
    expect(await handleRpc(svc, 'session.update', { sessionId: 'sub1', enabled: true, expectedRevision: 0 }, signal()))
      .toMatchObject({ ok: false, error: { code: 'not-top-level' } })
    expect(await handleRpc(svc, 'session.update', { sessionId: 's1', enabled: 'yes', expectedRevision: 2 }, signal()))
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
  })

  it('answers not-found for unknown endpoints', async () => {
    const svc = service()
    expect(await handleRpc(svc, 'settings.drop', {}, signal()))
      .toMatchObject({ ok: false, error: { code: 'not-found' } })
  })
})
