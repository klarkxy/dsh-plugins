import { describe, expect, it, vi } from 'vitest'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { callLlmText, type LlmTextCaller, type LlmTextRequest } from './llm-call.ts'

const request = (signal = new AbortController().signal): LlmTextRequest => ({
  plugin: 'test', route: { provider: 'p', model: 'm' }, system: 'system', text: 'input', maxTokens: 100, signal,
})
async function* output(): AsyncIterable<StreamChunk> {
  yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

describe('native text call ownership', () => {
  it('passes configure into preparation and preserves ordinary adapter defaults', async () => {
    const seen: GenerateOptions[] = []
    const prepareCall = vi.fn(async (config: Parameters<LlmTextCaller['prepareCall']>[0], _signal?: AbortSignal, configure?: Parameters<LlmTextCaller['prepareCall']>[2]) => {
      const selected = configure?.({ maxTokens: config.maxTokens }, { provider: 'p', id: 'm', name: 'm', reasoning: {
        efforts: [{ id: 'opaque-min' as never, name: 'Minimum' }, { id: 'opaque-max' as never, name: 'Maximum' }], defaultEffort: 'opaque-max' as never,
      } })
      return { config: { ...config, reasoningEffort: 'opaque-max', ...selected }, stream: (options: GenerateOptions) => { seen.push(options); return output() } }
    })
    const llm = { prepareCall, resolveCallConfig: vi.fn() } as unknown as LlmTextCaller
    await callLlmText(llm, request())
    expect(seen[0]?.reasoningEffort).toBe('opaque-max')
    expect(prepareCall.mock.calls[0]?.[2]).toBeUndefined()
    await callLlmText(llm, { ...request(), configure: (controls, model) => ({ ...controls, reasoningEffort: model.reasoning!.efforts[0]!.id }) })
    expect(seen[1]?.reasoningEffort).toBe('opaque-min')
  })

  it('waits for asynchronous iterator cleanup after cancellation', async () => {
    const controller = new AbortController()
    const entered = Promise.withResolvers<void>()
    const closing = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const llm = { resolveCallConfig: vi.fn(), prepareCall: async (config: unknown) => ({ config,
      stream: () => ({ [Symbol.asyncIterator]: () => ({
        async next() {
          entered.resolve()
          await new Promise<void>(resolve => controller.signal.addEventListener('abort', () => resolve(), { once: true }))
          return { done: false, value: { type: 'finish', reason: { kind: 'stop' } } }
        },
        async return() { closing.resolve(); await release.promise; return { done: true } },
      }) }),
    }) } as unknown as LlmTextCaller
    const pending = callLlmText(llm, request(controller.signal))
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    let settled = false
    void pending.then(() => { settled = true }, () => { settled = true })
    await entered.promise
    controller.abort()
    await closing.promise
    expect(settled).toBe(false)
    release.resolve()
    await rejected
    expect(settled).toBe(true)
  })
})
