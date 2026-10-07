import { describe, expect, it, vi } from 'vitest'
import { createPluginReadGate, selectedSessionId } from './client-utils.ts'
const subscribe = () => () => {}
describe('selected feature session', () => {
  const native = { adapter: { current: { getSnapshot: () => ({ key: 'native-session' }), subscribe } } }
  it('uses the selected editor chat, including an explicitly cleared selection', () => {
    expect(selectedSessionId({ uiWorkspace: { current: { getSnapshot: () => ({ sessionId: 'editor-chat' }), subscribe } }, uiSession: native })).toBe('editor-chat')
    expect(selectedSessionId({ uiWorkspace: { current: { getSnapshot: () => undefined, subscribe } }, uiSession: native })).toBe('')
  })
  it('uses the native main-view binding outside the editor', () => {
    expect(selectedSessionId({ uiWorkspace: {}, uiSession: native })).toBe('native-session')
    expect(selectedSessionId({ uiWorkspace: {}, uiSession: { adapter: { current: { getSnapshot: () => ({}), subscribe } } } })).toBe('')
  })
})

describe('background plugin read recovery', () => {
  it('bounds failing native requests and permits one probe after the pause', async () => {
    let now = 0
    const gate = createPluginReadGate(() => now)
    const read = vi.fn().mockRejectedValue(new Error('transport failure for /dsh-recap/status: HTTP 405'))
    const poll = () => gate.canRead() ? gate.run(read).catch(() => {}) : undefined
    await poll()
    for (let i = 0; i < 100; i++) { now += 150; await poll() }
    expect(read).toHaveBeenCalledTimes(1)
    now = 30_000
    await poll()
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('manual recovery resets the pause without automatically replaying work', async () => {
    const gate = createPluginReadGate(() => 0)
    const failed = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(gate.run(failed)).rejects.toThrow('Failed to fetch')
    expect(gate.canRead()).toBe(false)
    gate.reset()
    expect(gate.canRead()).toBe(true)
    const recovered = vi.fn().mockResolvedValue({ ok: true, value: 'new state' })
    await expect(gate.run(recovered)).resolves.toEqual({ ok: true, value: 'new state' })
    expect(failed).toHaveBeenCalledTimes(1)
    expect(recovered).toHaveBeenCalledTimes(1)
  })

  it('an obsolete failure cannot pause a recovered connection', async () => {
    const gate = createPluginReadGate(() => 0)
    let reject!: (reason: unknown) => void
    const old = gate.run(() => new Promise((_, fail) => { reject = fail }))
    const observed = expect(old).rejects.toThrow('HTTP 503')
    gate.reset()
    await gate.run(async () => 'recovered')
    reject(new Error('transport failure for /plugin/status: HTTP 503'))
    await observed
    expect(gate.canRead()).toBe(true)
  })

  it.each(['HTTP 401', 'HTTP 403', 'HTTP 400', 'HTTP 500', 'provider failed', 'rpcId mismatch'])('does not throttle actionable failure %s', async suffix => {
    const gate = createPluginReadGate(() => 0)
    await expect(gate.run(async () => { throw new Error(`transport failure for /plugin/status: ${suffix}`) })).rejects.toThrow(suffix)
    expect(gate.canRead()).toBe(true)
  })

  it('keeps cancellation, business errors and independent readers separate', async () => {
    const one = createPluginReadGate(() => 0)
    const two = createPluginReadGate(() => 0)
    await expect(one.run(async () => { throw new DOMException('Aborted', 'AbortError') })).rejects.toThrow('Aborted')
    expect(one.canRead()).toBe(true)
    await expect(one.run(async () => ({ ok: false, error: { message: 'configuration required' } }))).resolves.toMatchObject({ ok: false })
    await expect(one.run(async () => { throw new Error('transport failure for /one/status: HTTP 404') })).rejects.toThrow('HTTP 404')
    expect(one.canRead()).toBe(false)
    expect(two.canRead()).toBe(true)
  })
})
