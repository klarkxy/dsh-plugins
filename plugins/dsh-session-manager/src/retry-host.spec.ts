import { describe, expect, it, vi } from 'vitest'
import { bindRetryHost, retryCommitAndOpen } from './retry-host.ts'
import type { RetryCommitRequest } from './retry-contracts.ts'

const request: RetryCommitRequest = {
  sessionId: 'source-1',
  messageId: 'm2',
  expectedRevision: 9,
  expectedInputRevision: 'input-1',
  requestId: crypto.randomUUID(),
  text: 'edited',
}

describe('retryCommitAndOpen', () => {
  it('opens the committed branch session after a successful commit', async () => {
    const commit = vi.fn(async () => ({ sessionId: 'child-1', sourceSessionId: 'source-1', archived: true }))
    const open = vi.fn()
    const value = await retryCommitAndOpen(commit, open)(request)
    expect(value).toEqual({ sessionId: 'child-1', sourceSessionId: 'source-1', archived: true })
    expect(open).toHaveBeenCalledWith('child-1')
  })

  it('still returns the commit value when navigation is absent', async () => {
    const commit = vi.fn(async () => ({ sessionId: 'child-1', sourceSessionId: 'source-1', archived: false }))
    await expect(retryCommitAndOpen(commit, undefined)(request))
      .resolves.toMatchObject({ sessionId: 'child-1' })
  })

  it('preserves the committed request when opening the child fails', async () => {
    const commit = vi.fn(async () => ({ sessionId: 'child-1', sourceSessionId: 'source-1', archived: true }))
    const open = vi.fn().mockRejectedValueOnce({ code: 'session/not-found' }).mockResolvedValue(undefined)
    const send = retryCommitAndOpen(commit, open)
    await expect(send(request)).rejects.toMatchObject({ code: 'session/retry-pending' })
    await expect(send(request)).resolves.toMatchObject({ sessionId: 'child-1' })
    expect(open.mock.calls).toEqual([['child-1'], ['child-1']])
  })
})

describe('bindRetryHost commit validation', () => {
  it('accepts the fork commit value and rejects the legacy same-session shape', async () => {
    const rpc = {
      call: vi.fn(async () => ({ ok: true, value: { sessionId: 'child-1', sourceSessionId: 'source-1', archived: false } })),
    }
    await expect(bindRetryHost(rpc as never).commit(request)).resolves.toMatchObject({ sessionId: 'child-1' })
    rpc.call.mockResolvedValue({ ok: true, value: { sessionId: 'source-1', branchRevision: 10 } })
    await expect(bindRetryHost(rpc as never).commit(request))
      .rejects.toMatchObject({ code: 'session-manager/unavailable' })
  })
})
