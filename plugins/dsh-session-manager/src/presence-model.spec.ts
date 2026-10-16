import { describe, expect, it, vi } from 'vitest'
import { bindPresenceHost, createContinueModel, createPresenceConfigModel } from './presence-model.ts'
import { CONFIG_READ_ENDPOINT, CONFIG_WRITE_ENDPOINT } from './contracts.ts'

describe('welcome-back native compaction binding', () => {
  it('retains the exact session and executes its command only after ready', async () => {
    const command = vi.fn(async () => ({ ok: true, value: { matched: true } }))
    let ready!: (binding: { session: { command: typeof command } }) => void
    const pending = new Promise<{ session: { command: typeof command } }>(resolve => { ready = resolve })
    const using = vi.fn(async (_id: string, _options: unknown, operation: (reference: { ready: typeof pending }) => Promise<void>) => {
      await operation({ ready: pending })
    })
    const rpc = { call: vi.fn() }
    const host = bindPresenceHost({ sessions: { using }, connection: { rpc } })
    const signal = new AbortController().signal
    const action = host.compactContext!('source', signal)
    expect(command).not.toHaveBeenCalled()
    ready({ session: { command } })
    await action
    expect(using).toHaveBeenCalledWith('source', { source: 'controllerOperation', signal }, expect.any(Function))
    expect(command).toHaveBeenCalledWith('/compact')
    expect(rpc.call).not.toHaveBeenCalled()
  })

  it.each([
    { ok: true, value: { matched: false } },
    { ok: false, error: { code: 'session-manager/unavailable' } },
  ])('fails closed without admitting an unavailable native command', async result => {
    const host = bindPresenceHost({ sessions: {
      using: async (_id: string, _options: unknown, operation: (reference: unknown) => Promise<void>) => {
        await operation({ ready: Promise.resolve({ session: { command: async () => result } }) })
      },
    } })
    await expect(host.compactContext!('source', new AbortController().signal))
      .rejects.toMatchObject({ code: 'session-manager/unavailable' })
  })

  it('does not invoke a command after lifecycle cancellation while opening', async () => {
    const lifetime = new AbortController()
    const command = vi.fn()
    const host = bindPresenceHost({ sessions: {
      using: async (_id: string, _options: unknown, operation: (reference: unknown) => Promise<void>) => {
        lifetime.abort()
        await operation({ ready: Promise.resolve({ session: { command } }) })
      },
    } })
    await expect(host.compactContext!('source', lifetime.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(command).not.toHaveBeenCalled()
  })
})

describe('presence config confirmation', () => {
  const config = { recapMinutes: 15, compactMinutes: 60, continueText: 'B', continueMode: 'fixed' as const,
    model: { provider: 'p', model: 'm', reasoningEffort: 'low' }, ghostModel: null }

  it('requires effort to match before reporting a confirmed save', async () => {
    let reads = 0
    const model = createPresenceConfigModel({ rpc: { call: async (_channel, endpoint) => {
      if (endpoint === CONFIG_WRITE_ENDPOINT) return { ok: true, value: {} }
      reads++
      return { ok: true, value: reads === 1 ? config : { ...config, model: { ...config.model, reasoningEffort: 'high' } } }
    } } }, async () => {})
    await model.save({ model: { ...config.model, reasoningEffort: 'high' } })
    expect(reads).toBe(2)
    expect(model.getSnapshot()).toMatchObject({ saved: true, values: { model: { reasoningEffort: 'high' } } })
  })

  it('ignores a late pre-save config read and late reads after cancellation', async () => {
    let release!: (value: unknown) => void
    let reads = 0
    const model = createPresenceConfigModel({ rpc: { call: async (_channel, endpoint) => {
      if (endpoint === CONFIG_WRITE_ENDPOINT) return { ok: true, value: {} }
      if (reads++ === 0) return new Promise(resolve => { release = resolve })
      return { ok: true, value: config }
    } } }, async () => {})
    const old = model.load()
    await model.save({ continueText: 'B' })
    release({ ok: true, value: { ...config, continueText: 'A' } })
    await old
    expect(model.getSnapshot().values?.continueText).toBe('B')
    const stale = model.load()
    model.cancel()
    await stale
    expect(model.getSnapshot().values?.continueText).toBe('B')
  })
})

it('clears all continuation caches, aborts pending replies and ignores their late delivery', async () => {
  let release!: (value: unknown) => void
  const signals: AbortSignal[] = []
  const call = vi.fn(async (_channel, _endpoint, payload: { sessionId: string }, signal?: AbortSignal) => {
    if (payload.sessionId === 'pending') {
      signals.push(signal!)
      return new Promise(resolve => { release = resolve })
    }
    return { ok: true, value: { text: 'A' } }
  })
  const model = createContinueModel({ rpc: { call } })
  model.load('cached')
  model.load('pending')
  await vi.waitFor(() => expect(model.getSnapshot('cached').text).toBe('A'))
  const before = model.getSnapshot('pending')
  model.invalidateAll()
  expect(model.getSnapshot('cached').text).toBeUndefined()
  expect(model.getSnapshot('pending')).not.toBe(before)
  expect(signals[0]?.aborted).toBe(true)
  release({ ok: true, value: { text: 'stale' } })
  await Promise.resolve()
  await Promise.resolve()
  expect(model.getSnapshot('pending').text).toBeUndefined()
  model.load('cached')
  await vi.waitFor(() => expect(model.getSnapshot('cached').text).toBe('A'))
  expect(call).toHaveBeenCalledTimes(3)
  model.cancel()
})

it.each(['RPC failure', 'transport rejection'])('retains an existing suggestion after %s and allows a later explicit load', async failure => {
  const call = vi.fn()
    .mockResolvedValueOnce({ ok: true, value: { seq: 4, text: 'Previous suggestion' } })
  if (failure === 'RPC failure') {
    call.mockResolvedValueOnce({ ok: false, error: { code: 'session-manager/failed', message: 'request cancelled' } })
  } else {
    call.mockRejectedValueOnce(new Error('connection reset'))
  }
  call.mockResolvedValue({ ok: true, value: { seq: 5, text: 'Restored suggestion' } })
  const model = createContinueModel({ rpc: { call } })
  const changed = vi.fn()
  const stop = model.subscribe(changed)
  try {
    model.load('s')
    await vi.waitFor(() => expect(model.getSnapshot('s').text).toBe('Previous suggestion'))
    const previous = model.getSnapshot('s')
    changed.mockClear()
    model.load('s')
    await new Promise<void>(done => setImmediate(done))
    expect(call).toHaveBeenCalledTimes(2)
    expect(call.mock.calls[1]![3].aborted).toBe(false)
    expect(model.getSnapshot('s')).toBe(previous)
    expect(changed).not.toHaveBeenCalled()
    model.load('s')
    await vi.waitFor(() => expect(model.getSnapshot('s')).toEqual({ seq: 5, text: 'Restored suggestion' }))
    expect(call).toHaveBeenCalledTimes(3)
  } finally {
    stop()
    model.cancel()
  }
})
