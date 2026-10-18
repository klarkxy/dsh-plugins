import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { LlmTextCaller } from '@klarkxy/dsh-plugin-kit'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultGenerateConfig } from './contracts.ts'
import { generateCurrentTitle } from './generate.ts'

function waitForAbort(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
}

function caller(stream: (options: GenerateOptions) => AsyncIterable<StreamChunk>): LlmTextCaller {
  return {
    async prepareCall(config) {
      return { config, stream } as Awaited<ReturnType<LlmTextCaller['prepareCall']>>
    },
    async resolveCallConfig() { throw new Error('unused') },
  }
}

function generate(llm: LlmTextCaller, signal = new AbortController().signal, isCurrent = () => true) {
  return generateCurrentTitle({ llm, host: {}, model: { provider: 'p', model: 'm' },
    config: { ...defaultGenerateConfig(), timeoutMs: 50 }, sessionId: 's',
    messages: [{ seq: 1, text: 'Fix login' }], signal, isCurrent })
}

async function* normalStream(): AsyncIterable<StreamChunk> {
  yield { type: 'block-end', index: 0, block: { type: 'text', text: '{"type":"fix","summary":"login"}' } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

afterEach(() => vi.useRealTimers())

describe('title generation deadline through the native caller', () => {
  it('waits for an abort-ignoring preparation to settle before reporting deadline', async () => {
    vi.useFakeTimers()
    const llm = caller(normalStream)
    let release!: () => void
    const stalled = new Promise<void>(resolve => { release = resolve })
    const original = llm.prepareCall
    llm.prepareCall = async (...args) => { await stalled; return original(...args) }
    const pending = generate(llm)
    let settled = false
    void pending.then(() => { settled = true }, () => { settled = true })
    const rejection = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(50)
    expect(settled).toBe(false)
    release()
    await rejection
    expect(vi.getTimerCount()).toBe(0)
  })

  it('waits for a stalled stream that ignores abort and discards its late completion', async () => {
    vi.useFakeTimers()
    let release = () => {}
    const stalled = new Promise<void>(resolve => { release = resolve })
    const llm = caller(async function* () { await stalled; yield* normalStream() })
    const pending = generate(llm)
    const rejection = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
    let settled = false
    void pending.then(() => { settled = true }, () => { settled = true })
    await vi.advanceTimersByTimeAsync(50)
    expect(settled).toBe(false)
    release()
    await rejection
    await vi.advanceTimersByTimeAsync(0)
    await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts a stalled preparation and retains the timeout reason', async () => {
    vi.useFakeTimers()
    let seen: AbortSignal | undefined
    const llm = caller(normalStream)
    llm.prepareCall = async (_config, signal) => {
      seen = signal
      await waitForAbort(signal!)
      throw new DOMException('Preparation aborted', 'AbortError')
    }
    const result = generate(llm)
    const rejection = expect(result).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(50)
    await rejection
    expect(seen?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts a stalled stream, closes it and preserves timeout over shared cancellation', async () => {
    vi.useFakeTimers()
    let closed = false
    let seen: AbortSignal | undefined
    const llm = caller(async function* (options) {
      seen = options.signal
      try {
        await waitForAbort(options.signal!)
        yield { type: 'finish', reason: { kind: 'aborted' } }
      } finally { closed = true }
    })
    const result = generate(llm)
    const rejection = expect(result).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(50)
    await rejection
    expect(seen?.aborted).toBe(true)
    expect(closed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('forwards caller cancellation with its original reason and clears the timer', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const reason = new Error('Plugin disabled')
    const llm = caller(async function* (options) {
      await waitForAbort(options.signal!)
      yield { type: 'finish', reason: { kind: 'aborted' } }
    })
    const result = generate(llm, controller.signal)
    const rejection = expect(result).rejects.toBe(reason)
    await vi.advanceTimersByTimeAsync(0)
    controller.abort(reason)
    await rejection
    expect(vi.getTimerCount()).toBe(0)
  })

  it('returns normal output without leaving a deadline or cancelling later', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    let seen: AbortSignal | undefined
    const result = await generate(caller(options => { seen = options.signal; return normalStream() }), controller.signal)
    expect(result.title).toContain('login')
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(100)
    expect(seen?.aborted).toBe(false)
    expect(controller.signal.aborted).toBe(false)
    controller.abort()
    expect(seen?.aborted).toBe(true)
  })

  it('discards a normal result that became stale and clears the deadline on failure', async () => {
    vi.useFakeTimers()
    let current = true
    await expect(generate(caller(async function* () {
      yield* normalStream()
      current = false
    }), undefined, () => current)).rejects.toMatchObject({ name: 'AbortError' })
    expect(vi.getTimerCount()).toBe(0)
  })
})
