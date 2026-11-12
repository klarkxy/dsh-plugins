import { describe, expect, it } from 'vitest'
import { detachNative } from './native.ts'

describe('detachNative', () => {
  it('gives downstream answerers a signal that closes alone', () => {
    const caller = new AbortController()
    const request: { signal?: AbortSignal } = { signal: caller.signal }
    const lease = detachNative(request)!
    expect(request.signal).not.toBe(caller.signal)
    lease.close()
    expect(request.signal!.aborted).toBe(true)
    expect(caller.signal.aborted).toBe(false)
  })

  it('follows the caller when the caller aborts', () => {
    const caller = new AbortController()
    const request: { signal?: AbortSignal } = { signal: caller.signal }
    detachNative(request)
    caller.abort()
    expect(request.signal!.aborted).toBe(true)
  })

  it('adds a closable signal when the caller had none', () => {
    const request: { signal?: AbortSignal } = {}
    detachNative(request)!.close()
    expect(request.signal!.aborted).toBe(true)
  })

  it('leaves frozen requests and aborted callers alone', () => {
    const caller = new AbortController()
    const frozen = Object.freeze({ signal: caller.signal })
    expect(detachNative(frozen)).toBeUndefined()
    expect(frozen.signal).toBe(caller.signal)
    caller.abort()
    expect(detachNative({ signal: caller.signal })).toBeUndefined()
  })
})
