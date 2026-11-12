import { describe, expect, it, vi } from 'vitest'
import { approvalAuditId, raceApproval } from './approval-relay.ts'
import type { RawEvent } from './chat.ts'
import { PendingHub } from './pending.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

const request = { kind: 'approval' as const, sessionId: 'task', subject: 'pwsh' }

describe('approval audit correlation', () => {
  const asked = (id: string, callId?: string): RawEvent => ({ type: 'approval/asked', data: { id, toolName: 'pwsh', ...callId === undefined ? {} : { callId } } })
  const session = (events: RawEvent[]) => ({ seq: events.length, eventAt: (seq: number) => events[seq] })

  it('matches the exact tool call and excludes already decided requests', () => {
    expect(approvalAuditId(session([asked('one', 'call-one'), asked('two', 'call-two')]), 'pwsh', 'call-one')).toBe('one')
    expect(approvalAuditId(session([asked('one'), { type: 'approval/decided', data: { id: 'one' } }, asked('two')]), 'pwsh')).toBe('two')
    expect(approvalAuditId(session([asked('one')]), 'bash')).toBeUndefined()
  })

  it('does not guess between concurrent calls lacking a unique call id', () => {
    expect(approvalAuditId(session([asked('one'), asked('two')]), 'pwsh')).toBeUndefined()
    expect(approvalAuditId(session([asked('one', 'same'), asked('two', 'same')]), 'pwsh', 'same')).toBeUndefined()
  })
})

describe('approval answerer race', () => {
  it('keeps the caller cancellation link until a pending native fallback actually settles', async () => {
    const hub = new PendingHub()
    const routed = hub.open(request)
    const native = deferred<'cancelled'>()
    const lease = { close: vi.fn(), release: vi.fn() }
    const result = raceApproval(routed, () => native.promise, lease)
    routed.withdraw()
    await Promise.resolve()
    await Promise.resolve()
    expect(lease.release).not.toHaveBeenCalled()
    native.resolve('cancelled')
    expect(await result).toBe('cancelled')
    expect(lease.release).toHaveBeenCalledOnce()
  })

  it.each(['allowed-once', 'rejected', 'cancelled'] as const)('withdraws when the original session settles %s', async outcome => {
    const hub = new PendingHub()
    const routed = hub.open(request)
    const lease = { close: vi.fn(), release: vi.fn() }
    expect(await raceApproval(routed, async () => outcome, lease)).toBe(outcome)
    expect(hub.get(routed.id)).toBeUndefined()
    expect(hub.settlement(routed.id)?.reason).toBe('withdrawn')
    expect(lease.close).not.toHaveBeenCalled()
    expect(lease.release).toHaveBeenCalledOnce()
  })

  it('keeps a human fallback pending after the reviewer delegates instead of treating it as a decision', async () => {
    const hub = new PendingHub()
    const routed = hub.open(request)
    const human = deferred<'allowed-once'>()
    // A reviewer that defers to a human returns next()'s pending promise.
    const result = raceApproval(routed, () => human.promise, undefined)
    await Promise.resolve()
    expect(hub.get(routed.id)).toBeDefined()
    human.resolve('allowed-once')
    expect(await result).toBe('allowed-once')
    expect(hub.get(routed.id)).toBeUndefined()
  })

  it('keeps a manual retry independent after Safe Auto rejected the original request', async () => {
    const hub = new PendingHub()
    const rejected = hub.open(request)
    expect(await raceApproval(rejected, async () => 'rejected', undefined)).toBe('rejected')
    const retry = hub.open(request)
    expect(retry.id).not.toBe(rejected.id)
    const human = deferred<'allowed-once'>()
    const result = raceApproval(retry, () => human.promise, undefined)
    expect(hub.get(retry.id)).toBeDefined()
    human.resolve('allowed-once')
    expect(await result).toBe('allowed-once')
    expect(hub.list()).toEqual([])
  })

  it('lets dot answer when the native answerer is unavailable and closes only the native card', async () => {
    const hub = new PendingHub()
    const routed = hub.open(request)
    const lease = { close: vi.fn(), release: vi.fn() }
    const result = raceApproval(routed, async () => 'unavailable', lease)
    await Promise.resolve()
    expect(hub.get(routed.id)).toBeDefined()
    hub.answer(routed.id, { kind: 'approval', allow: false })
    expect(await result).toBe('rejected')
    expect(lease.close).toHaveBeenCalledOnce()
  })
})
