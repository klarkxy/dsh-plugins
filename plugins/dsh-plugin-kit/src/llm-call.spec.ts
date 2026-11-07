import { describe, expect, it, vi } from 'vitest'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { AUXILIARY_MODEL_SERVICE } from './contracts.ts'
import { callLlmText, resolveFeatureModel, type LlmTextCaller, type LlmTextRequest } from './llm-call.ts'

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

  it('packs stable context before the live text and leaves plain calls untouched', async () => {
    const seen: GenerateOptions[] = []
    const llm = { resolveCallConfig: vi.fn(), prepareCall: async (config: unknown) => ({ config,
      stream: (options: GenerateOptions) => { seen.push(options); return output() } }) } as unknown as LlmTextCaller
    await callLlmText(llm, request())
    const plain = seen[0]?.messages[0]
    expect(plain?.content).toEqual([{ type: 'text', text: 'input' }])
    await callLlmText(llm, { ...request(), feature: 'review', context: ['facts', 'facts2'] })
    const enriched = seen[1]?.messages[0]
    expect(enriched?.content).toEqual([{ type: 'text',
      text: '<auxiliary-context feature="review">\nfacts\nfacts2\n</auxiliary-context>\n<request>\ninput\n</request>' }])
    // One user message with one text block: no model-visible history is forged.
    expect(seen[1]?.messages).toHaveLength(1)
  })

  it('passes every usable host usage field through without inventing missing ones', async () => {
    async function* full(): AsyncIterable<StreamChunk> {
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 20, cacheWriteTokens: 3, totalTokens: 38, reasoningTokens: 2 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
    const llm = { resolveCallConfig: vi.fn(), prepareCall: async (config: unknown) => ({ config,
      stream: () => full() }) } as unknown as LlmTextCaller
    const result = await callLlmText(llm, request())
    expect(result).toEqual({ text: 'done', provider: 'p', model: 'm',
      inputTokens: 10, outputTokens: 5, cacheReadTokens: 20, cacheWriteTokens: 3, totalTokens: 38, reasoningTokens: 2 })
    // reasoningTokens is reported, not folded into outputTokens.
    expect(result.outputTokens).toBe(5)

    async function* partial(): AsyncIterable<StreamChunk> {
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } }
      yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 2 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
    const sparse = { resolveCallConfig: vi.fn(), prepareCall: async (config: unknown) => ({ config,
      stream: () => partial() }) } as unknown as LlmTextCaller
    const trimmed = await callLlmText(sparse, request())
    expect(trimmed).toEqual({ text: 'done', provider: 'p', model: 'm', inputTokens: 7, outputTokens: 2 })
    expect('totalTokens' in trimmed).toBe(false)
    expect('cacheReadTokens' in trimmed).toBe(false)
    expect('reasoningTokens' in trimmed).toBe(false)

    const bare = { resolveCallConfig: vi.fn(), prepareCall: async (config: unknown) => ({ config,
      stream: () => output() }) } as unknown as LlmTextCaller
    const none = await callLlmText(bare, request())
    expect(none).toEqual({ text: 'done', provider: 'p', model: 'm' })
    expect('inputTokens' in none).toBe(false)
  })
})

describe('resolveFeatureModel auxiliary tier', () => {
  const auxHost = (model: unknown) => ({ root: { get: (name: string) => name === AUXILIARY_MODEL_SERVICE
    ? { snapshot: () => ({ revision: 1, model }) }
    : undefined } })

  it('prefers the shared default over session and host fallbacks', () => {
    const host = { ...auxHost({ provider: 'aux-p', model: 'aux-m' }),
      agentDefaultModel: { currentSelection: () => ({ provider: 'host-p', model: 'host-m' }) } }
    expect(resolveFeatureModel(host, undefined, 's')).toEqual({ provider: 'aux-p', model: 'aux-m' })
  })

  it('keeps the explicit feature override first and falls back when aux is unset', () => {
    const host = { ...auxHost({ provider: 'aux-p', model: 'aux-m' }),
      agentDefaultModel: { currentSelection: () => ({ provider: 'host-p', model: 'host-m' }) } }
    expect(resolveFeatureModel(host, { provider: 'f-p', model: 'f-m' }, 's')).toEqual({ provider: 'f-p', model: 'f-m' })
    const unset = { ...auxHost(null), agentDefaultModel: { currentSelection: () => ({ provider: 'host-p', model: 'host-m' }) } }
    expect(resolveFeatureModel(unset, undefined, 's')).toEqual({ provider: 'host-p', model: 'host-m' })
    expect(resolveFeatureModel({}, undefined, 's')).toBeUndefined()
  })

  it('propagates a sticky store failure instead of falling back', () => {
    const host = { root: { get: () => ({ snapshot: () => { throw new Error('bad store') } }) },
      agentDefaultModel: { currentSelection: () => ({ provider: 'host-p', model: 'host-m' }) } }
    expect(() => resolveFeatureModel(host, undefined, 's')).toThrow('bad store')
  })
})
