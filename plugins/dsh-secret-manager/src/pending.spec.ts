import { describe, expect, it } from 'vitest'
import { PENDING_TTL_MS } from './contracts.ts'
import { PendingRegistry, type PendingSpec } from './pending.ts'

const spec = (overrides: Partial<PendingSpec> = {}): PendingSpec => ({
  sessionId: 'session-a',
  callId: 'call-1',
  kind: 'store',
  slot: 'db-prod',
  envKey: 'DSH_SECRET_DB_PROD',
  ref: 'secret://db-prod',
  purpose: 'Read the production database.',
  requestEnv: true,
  authHeader: 'Authorization',
  authPrefix: 'Bearer ',
  configured: false,
  ...overrides,
})

const flush = async () => { await Promise.resolve(); await Promise.resolve() }

describe('PendingRegistry', () => {
  it('hands out an unpredictable id and reports the same view for the owning call', () => {
    const pending = new PendingRegistry({ now: () => 1_000 })
    const { request } = pending.create(spec())
    expect(request.expiresAt).toBe(1_000 + PENDING_TTL_MS)
    expect(request.id.length).toBeGreaterThan(16)
    expect(pending.view('session-a', 'call-1')?.id).toBe(request.id)
    expect(pending.view('session-b', 'call-1')).toBeUndefined()
    expect(pending.view('session-a', 'call-2')).toBeUndefined()
  })

  it('lets exactly one submit claim a request', () => {
    const pending = new PendingRegistry()
    const { request } = pending.create(spec())
    const claim = { id: request.id, sessionId: 'session-a', callId: 'call-1' }
    expect(pending.take(claim).ok).toBe(true)
    const second = pending.take(claim)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.reason).toBe('stale')
  })

  it('refuses an answer addressed to another session or call', () => {
    const pending = new PendingRegistry()
    const { request } = pending.create(spec())
    expect(pending.take({ id: request.id, sessionId: 'session-b', callId: 'call-1' }).ok).toBe(false)
    expect(pending.take({ id: request.id, sessionId: 'session-a', callId: 'call-9' }).ok).toBe(false)
    // The genuine claimant still wins afterwards.
    expect(pending.take({ id: request.id, sessionId: 'session-a', callId: 'call-1' }).ok).toBe(true)
  })

  it('settles the waiting call through submit and through cancel', async () => {
    const pending = new PendingRegistry()
    const first = pending.create(spec())
    const firstAnswer = first.answer
    expect(pending.take({ id: first.request.id, sessionId: 'session-a', callId: 'call-1' }).ok).toBe(true)
    pending.settle(first.request.id, { kind: 'cancelled' })
    expect(await firstAnswer).toEqual({ kind: 'cancelled' })

    const second = pending.create(spec({ callId: 'call-2' }))
    const secondAnswer = second.answer
    pending.take({ id: second.request.id, sessionId: 'session-a', callId: 'call-2' })
    pending.settle(second.request.id, {
      kind: 'submitted',
      outcome: {
        status: 'ready', ref: 'secret://db-prod', slot: 'db-prod', envKey: 'DSH_SECRET_DB_PROD',
        configured: true, envGranted: true, httpGranted: false,
      },
    })
    expect((await secondAnswer).kind).toBe('submitted')
  })

  it('expires an unanswered request once the deadline passes', async () => {
    let now = 1_000
    const pending = new PendingRegistry({ now: () => now })
    const { request, answer } = pending.create(spec())
    now = request.expiresAt + 1
    expect(pending.view('session-a', 'call-1')).toBeUndefined()
    expect(await answer).toEqual({ kind: 'timeout' })
    expect(pending.take({ id: request.id, sessionId: 'session-a', callId: 'call-1' }).ok).toBe(false)
  })

  it('closes an abandoned dialog so a late submit cannot answer it', async () => {
    const pending = new PendingRegistry()
    const { request, answer, abandon } = pending.create(spec())
    abandon()
    expect(await answer).toEqual({ kind: 'cancelled' })
    expect(pending.take({ id: request.id, sessionId: 'session-a', callId: 'call-1' }).ok).toBe(false)
  })

  it('sweeps every overdue request exactly once', async () => {
    let now = 1_000
    const pending = new PendingRegistry({ now: () => now })
    const first = pending.create(spec())
    const second = pending.create(spec({ callId: 'call-2' }))
    now = first.request.expiresAt + 1
    expect(pending.sweep()).toBe(2)
    expect(pending.sweep()).toBe(0)
    await flush()
    expect(await first.answer).toEqual({ kind: 'timeout' })
    expect(await second.answer).toEqual({ kind: 'timeout' })
  })

  it('closes everything on unload', async () => {
    const pending = new PendingRegistry()
    const first = pending.create(spec())
    const second = pending.create(spec({ callId: 'call-2' }))
    pending.clear()
    expect(await first.answer).toEqual({ kind: 'cancelled' })
    expect(await second.answer).toEqual({ kind: 'cancelled' })
  })
})
