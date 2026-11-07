import { expect, it, vi } from 'vitest'
import { extractHandoff, nativeHandoffSummarizer } from './handoff.ts'
import type { TurnPage } from './turns.ts'

const turns: TurnPage[] = [{ turnId: 'turn:0', state: 'completed', boundary: 'recorded', startSeq: 0, endSeq: 3,
  inherited: false, toolCalls: 0, partial: false, context: [], requests: [{ kind: 'request', text: 'Repair the menu', reference: { sessionId: 's', turnId: 'turn:0', seq: 1 } }],
  conclusion: { kind: 'conclusion', text: 'Menu repaired; restart pending.', reference: { sessionId: 's', turnId: 'turn:0', seq: 2 } },
}]
const valid = { objective: [{ text: 'Repair the menu', references: ['r0'] }], decisions: [], reportedOutcomes: [{ text: 'Reported menu repair', references: ['r1'] }],
  outstanding: [{ text: 'Restart still pending', references: ['r1'] }], nextSteps: [], constraints: [] }
interface HostProbe {
  prepared: Record<string, unknown>[]
  sessionIds: unknown[]
  userTexts: string[]
}
function host(text: string, probe: HostProbe = { prepared: [], sessionIds: [], userTexts: [] }, aux?: { provider: string; model: string }) {
  const services = new Map<string, unknown>()
  if (aux !== undefined) {
    services.set('dshAuxiliaryModel', { ready: Promise.resolve(), snapshot: () => ({ revision: 1, model: aux }) })
  }
  const prepareCall = vi.fn(async (config: any, _signal: AbortSignal) => {
    probe.prepared.push(config)
    return {
      config: { ...config, model: 'resolved-model' },
      stream: async function* (options: any) {
        expect(options.signal).toBeInstanceOf(AbortSignal)
        expect(options.purpose).toBeUndefined()
        probe.sessionIds.push(options.sessionId)
        probe.userTexts.push((options.messages ?? [])
          .flatMap((message: any) => message.content ?? [])
          .filter((part: any) => part.type === 'text')
          .map((part: any) => part.text ?? '')
          .join(''))
        yield { type: 'text-delta', index: 0, text }; yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
  })
  return {
    llm: { prepareCall },
    agentDefaultModel: { currentSelection: () => ({ provider: 'fixture', model: 'requested-model' }) },
    root: {
      get: (name: string) => services.get(name),
      provide: (name: string, value: unknown) => { services.set(name, value); return () => services.delete(name) },
    },
  }
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

it('routes the summary through the explicit handoff override, then the shared auxiliary default', async () => {
  const probe: HostProbe = { prepared: [], sessionIds: [], userTexts: [] }
  const ctx = host(JSON.stringify(valid), probe, { provider: 'aux-p', model: 'aux-m' })
  const explicit = await nativeHandoffSummarizer(ctx, 'caller-1', {
    savedHandoff: () => ({ provider: 'handoff-p', model: 'handoff-m' }),
  })(turns, extractHandoff(turns), new AbortController().signal, 4_000)
  expect(explicit.summaryStatus).toBe('generated')
  expect(explicit.requestedModel).toEqual({ provider: 'handoff-p', model: 'handoff-m' })
  expect(probe.prepared[0]).toMatchObject({ provider: 'handoff-p', model: 'handoff-m' })
  // The call is attributed to the reading session while fact references stay
  // bound to the supplying target session — never the caller's.
  expect(probe.sessionIds[0]).toBe('caller-1')
  expect(explicit.sections.objective.facts[0]?.references[0]?.sessionId).toBe('s')

  const auxed = await nativeHandoffSummarizer(ctx, 'caller-1', {
    savedHandoff: () => null,
  })(turns, extractHandoff(turns), new AbortController().signal, 4_000)
  expect(auxed.requestedModel).toEqual({ provider: 'aux-p', model: 'aux-m' })
  expect(probe.prepared[1]).toMatchObject({ provider: 'aux-p', model: 'aux-m' })
})

it('packs the handoff excerpts as stable context under its own feature bucket', async () => {
  const probe: HostProbe = { prepared: [], sessionIds: [], userTexts: [] }
  const ctx = host(JSON.stringify(valid), probe)
  await nativeHandoffSummarizer(ctx, 'caller-1')(turns, extractHandoff(turns), new AbortController().signal, 4_000)
  const envelope = probe.userTexts[0]!.match(
    /^<auxiliary-context feature="session-manager\.handoff">\n([\s\S]*?)\n<\/auxiliary-context>\n<request>\n([\s\S]*?)\n<\/request>$/,
  )
  expect(envelope).not.toBeNull()
  const context = JSON.parse(envelope![1]!) as Record<string, unknown>
  const requestBody = JSON.parse(envelope![2]!) as Record<string, unknown>
  // Stable material only: source excerpts with ids and target references.
  expect(Object.keys(context)).toEqual(['excerpts'])
  const excerpts = context.excerpts as { id: string; reference: { sessionId: string }; text: string }[]
  expect(excerpts.map(item => item.id)).toEqual(['r0', 'r1'])
  expect(excerpts.every(item => item.reference.sessionId === 's')).toBe(true)
  expect(Object.keys(requestBody).sort()).toEqual(['coverage', 'executionHistory'])
})

it('degrades without billing the caller chat model once the shared auxiliary store broke', async () => {
  const probe: HostProbe = { prepared: [], sessionIds: [], userTexts: [] }
  const ctx = host('unused', probe)
  const original = extractHandoff(turns)
  const broken = await nativeHandoffSummarizer(ctx, 'caller-1', { auxBroken: true })(
    turns, original, new AbortController().signal, 4_000)
  expect(broken).toMatchObject({ source: 'extractive', summaryStatus: 'unavailable', sections: original.sections })
  expect(ctx.llm.prepareCall).not.toHaveBeenCalled()
  // An explicit handoff route still applies: the fallback chain is what is broken.
  const explicit = await nativeHandoffSummarizer(ctx, 'caller-1', {
    auxBroken: true,
    savedHandoff: () => ({ provider: 'handoff-p', model: 'handoff-m' }),
  })(turns, original, new AbortController().signal, 4_000)
  expect(explicit.requestedModel).toEqual({ provider: 'handoff-p', model: 'handoff-m' })
  expect(ctx.llm.prepareCall).toHaveBeenCalledOnce()
  expect(probe.prepared[0]).toMatchObject({ provider: 'handoff-p', model: 'handoff-m' })
})
