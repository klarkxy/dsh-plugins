import { expect, it, vi } from 'vitest'
import { extractHandoff, nativeHandoffSummarizer } from './handoff.ts'
import type { TurnPage } from './turns.ts'

const turns: TurnPage[] = [{ turnId: 'turn:0', state: 'completed', boundary: 'recorded', startSeq: 0, endSeq: 3,
  inherited: false, toolCalls: 0, partial: false, context: [], requests: [{ kind: 'request', text: 'Repair the menu', reference: { sessionId: 's', turnId: 'turn:0', seq: 1 } }],
  conclusion: { kind: 'conclusion', text: 'Menu repaired; restart pending.', reference: { sessionId: 's', turnId: 'turn:0', seq: 2 } },
}]
const valid = { objective: [{ text: 'Repair the menu', references: ['r0'] }], decisions: [], reportedOutcomes: [{ text: 'Reported menu repair', references: ['r1'] }],
  outstanding: [{ text: 'Restart still pending', references: ['r1'] }], nextSteps: [], constraints: [] }
function host(text: string) {
  const prepareCall = vi.fn(async (config: any, _signal: AbortSignal) => ({ config: { ...config, model: 'resolved-model' },
    stream: async function* (options: any) {
      expect(options.signal).toBeInstanceOf(AbortSignal)
      expect(options.purpose).toBeUndefined()
      yield { type: 'text-delta', index: 0, text }; yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }))
  return { llm: { prepareCall }, agentDefaultModel: { currentSelection: () => ({ provider: 'fixture', model: 'requested-model' }) } }
}

it('generates only explicitly requested, bounded handoff facts with original references and actual model identity', async () => {
  const ctx = host(JSON.stringify(valid)), signal = new AbortController().signal
  const output = await nativeHandoffSummarizer(ctx)(turns, extractHandoff(turns, true), signal, 4_000)
  expect(ctx.llm.prepareCall).toHaveBeenCalledOnce()
  expect(output).toMatchObject({ source: 'model', summaryStatus: 'generated', coverage: { partial: true, hasMoreHistory: true },
    model: { provider: 'fixture', model: 'resolved-model' }, requestedModel: { provider: 'fixture', model: 'requested-model' } })
  expect(output.sections.outstanding.facts[0]?.references).toEqual([turns[0]!.conclusion!.reference])
})

it.each(['invalid-json', 'invalid-ref', 'oversized'])('retains source excerpts after %s without retrying or inventing sources', async reason => {
  const text = reason === 'invalid-json' ? 'bad json' : reason === 'oversized' ? 'x'.repeat(6_000)
    : JSON.stringify({ ...valid, objective: [{ text: 'invented', references: ['unknown'] }] })
  const ctx = host(text), original = extractHandoff(turns)
  const output = await nativeHandoffSummarizer(ctx)(turns, original, new AbortController().signal, 4_000)
  expect(output).toMatchObject({ source: 'extractive', summaryStatus: 'failed', sections: original.sections })
  expect(output.error).toBeTruthy()
  expect(ctx.llm.prepareCall).toHaveBeenCalledOnce()
})

it('retains local handoff when the model route is absent or fails, and never converts cancellation to success', async () => {
  expect(await nativeHandoffSummarizer(undefined)(turns, extractHandoff(turns), new AbortController().signal, 4_000))
    .toMatchObject({ source: 'extractive', summaryStatus: 'unavailable' })
  const ctx = host('unused')
  ctx.llm.prepareCall.mockRejectedValueOnce(new Error('provider failed'))
  expect(await nativeHandoffSummarizer(ctx)(turns, extractHandoff(turns), new AbortController().signal, 4_000))
    .toMatchObject({ source: 'extractive', summaryStatus: 'failed', error: 'provider failed' })
  const abort = new AbortController()
  let received: AbortSignal | undefined
  ctx.llm.prepareCall.mockImplementationOnce(async (_config, signal) => {
    received = signal
    await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    throw new Error('unreachable')
  })
  const active = nativeHandoffSummarizer(ctx)(turns, extractHandoff(turns), abort.signal, 4_000)
  await vi.waitFor(() => expect(received).toBe(abort.signal))
  abort.abort()
  await expect(active).rejects.toThrow()
})
