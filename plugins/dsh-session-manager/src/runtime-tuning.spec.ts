import { describe, expect, it, vi } from 'vitest'
import {
  PROGRESS_NOTE_KIND,
  StreamStallError,
  createProgressTracker,
  createScopedSummarizeReceiver,
  createSseCounter,
  installCompactionEffortBridge,
  installRuntimeTuning,
  isModelStream,
  progressNoteText,
  resolvePolicySummaryTarget,
  resolveSummaryEffort,
  wrapStreamStallFetch,
  type CompactionEngineLike,
  type LlmServiceLike,
} from './runtime-tuning.ts'
import { resolveConfig } from './contracts.ts'

describe('compaction reasoningEffort inheritance', () => {
  it('inherits requestHeader reasoningEffort on the same provider/model when supported', async () => {
    const resolution = await resolveSummaryEffort({
      agent: {
        session: {
          requestHeader: () => ({
            config: { provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'max' },
          }),
        },
      },
      llm: {
        resolveModelInfo: async () => ({
          reasoning: { efforts: [{ id: 'low' }, { id: 'high' }, { id: 'max' }] },
        }),
      },
      policy: { summarizationProvider: '', summarizationModel: '' },
      inheritReasoningEffort: true,
    })
    expect(resolution).toMatchObject({
      reasoningEffort: 'max',
      source: 'request-header',
      summaryTarget: { provider: 'deepseek', model: 'deepseek-reasoner' },
    })
  })

  it('leaves independent summarization models and unsupported efforts untouched', async () => {
    const independent = await resolveSummaryEffort({
      agent: {
        session: {
          requestHeader: () => ({
            config: { provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'max' },
          }),
        },
      },
      policy: resolvePolicySummaryTarget(
        { summarizationProvider: 'openai', summarizationModel: 'gpt-4o-mini' },
        { provider: 'deepseek', model: 'deepseek-reasoner' },
      ),
      inheritReasoningEffort: true,
    })
    expect(independent).toMatchObject({ reasoningEffort: undefined, source: 'independent-model' })

    const unsupported = await resolveSummaryEffort({
      agent: {
        options: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'max' },
      },
      llm: {
        resolveModelInfo: async () => ({
          reasoning: { efforts: ['low', 'medium', 'high'] },
        }),
      },
      inheritReasoningEffort: true,
    })
    expect(unsupported).toMatchObject({
      reasoningEffort: undefined,
      source: 'unsupported-effort',
      candidate: 'max',
    })
  })

  it('scopes reasoningEffort to each concurrent compaction call without mutating shared llm state', async () => {
    const seen: Array<{ tag: unknown; effort: unknown; purpose: unknown }> = []
    const llm: LlmServiceLike = {
      stream(options) {
        seen.push({ tag: options.tag, effort: options.reasoningEffort, purpose: options.purpose })
        return { ok: true }
      },
      resolveModelInfo: async () => ({ reasoning: { efforts: ['low', 'high', 'max'] } }),
    }
    const engine: CompactionEngineLike = {
      ctx: { llm },
      config: {},
      async summarize(this: CompactionEngineLike, input) {
        await new Promise(resolve => setTimeout(resolve, 5))
        this.ctx!.llm!.stream({ tag: input, purpose: 'compaction' })
        this.ctx!.llm!.stream({ tag: `${String(input)}-other`, purpose: 'title' })
        return input
      },
    }
    const dispose = installCompactionEffortBridge(
      engine,
      llm,
      () => ({ compactionInheritEffort: true, compactionReasoningEffort: undefined }),
    )

    await Promise.all([
      engine.summarize('s-max', {
        session: { requestHeader: () => ({ config: { provider: 'deepseek', model: 'm1', reasoningEffort: 'max' } }) },
      }),
      engine.summarize('s-low', {
        session: { requestHeader: () => ({ config: { provider: 'deepseek', model: 'm1', reasoningEffort: 'low' } }) },
      }),
      Promise.resolve().then(() => llm.stream({ tag: 'direct', purpose: 'compaction' })),
    ])

    expect(seen).toContainEqual({ tag: 's-max', effort: 'max', purpose: 'compaction' })
    expect(seen).toContainEqual({ tag: 's-max-other', effort: undefined, purpose: 'title' })
    expect(seen).toContainEqual({ tag: 's-low', effort: 'low', purpose: 'compaction' })
    expect(seen).toContainEqual({ tag: 'direct', effort: undefined, purpose: 'compaction' })

    dispose()
    await engine.summarize('after-dispose', {
      session: { requestHeader: () => ({ config: { provider: 'deepseek', model: 'm1', reasoningEffort: 'max' } }) },
    })
    expect(seen.find(row => row.tag === 'after-dispose')?.effort).toBeUndefined()
    expect(createScopedSummarizeReceiver(engine, undefined)).toBe(engine)
  })
})

describe('silent-turn progress note', () => {
  const MIN = 60_000
  const toolStep = { message: { content: [{ type: 'reasoning', text: 'thinking' }, { type: 'tool-call', name: 'bash' }] } }
  const textStep = { message: { content: [{ type: 'text', text: 'Checked logs; running tests next.' }, { type: 'tool-call', name: 'bash' }] } }

  it('queues one deferred progress note after silence and minSteps, then waits for reply and interval', () => {
    let clock = 0
    const replies: string[] = []
    const tracker = createProgressTracker(
      () => ({ minutes: 3, minSteps: 3 }),
      { now: () => clock, onReplyAfterNote: (_id, reply) => replies.push(reply) },
    )
    tracker.onEvent('s1', { type: 'turn/start', time: 0 } as never)
    clock = 1 * MIN
    tracker.onEvent('s1', { type: 'assistant/message', time: clock, data: toolStep } as never)
    tracker.onEvent('s1', { type: 'assistant/message', time: clock, data: toolStep } as never)
    tracker.onEvent('s1', { type: 'assistant/message', time: clock, data: toolStep } as never)
    clock = 2.9 * MIN
    expect(tracker.due('s1')).toBeUndefined()

    clock = 4 * MIN
    expect(tracker.due('s1')).toBe(4)
    // Parallel tools in the same step do not emit duplicate notes.
    expect(tracker.due('s1')).toBeUndefined()

    tracker.onEvent('s1', { type: 'assistant/message', time: clock, data: toolStep } as never)
    expect(replies).toEqual(['tools-only'])
    clock = 5 * MIN
    expect(tracker.due('s1')).toBeUndefined()

    clock = 7.2 * MIN
    expect(tracker.due('s1')).toBe(7)
    tracker.onEvent('s1', { type: 'assistant/message', time: clock, data: textStep } as never)
    expect(replies).toEqual(['tools-only', 'text-with-tools'])
    expect(progressNoteText(4)).toContain('reply without tool calls ends the turn')
  })

  it('attaches deferred context only on top-level sessions and ignores subagents', async () => {
    let clock = 0
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    try {
      const listeners = new Map<string, (...args: any[]) => any>()
      const disposers: Array<() => void> = []
      const ctx = {
        inject: () => () => {},
        effect: (fn: () => (() => void) | void) => {
          const stop = fn()
          if (typeof stop === 'function') disposers.push(stop)
        },
        on: (name: string, fn: (...args: any[]) => any) => {
          listeners.set(name, fn)
          return () => listeners.delete(name)
        },
      }
      installRuntimeTuning(ctx as never, resolveConfig({ streamStallSeconds: 0, compactionInheritEffort: false }))

      const topNotes: any[] = []
      const subNotes: any[] = []
      const topSession = { id: 'top', header: { delegationDepth: 0 } }
      const subSession = { id: 'sub', header: { delegationDepth: 1, origin: 'subagent' } }

      listeners.get('session/event')!(topSession, { type: 'turn/start', time: 0 })
      listeners.get('session/event')!(subSession, { type: 'turn/start', time: 0 })
      for (let i = 1; i <= 3; i += 1) {
        clock = i * MIN
        listeners.get('session/event')!(topSession, { type: 'assistant/message', time: clock, data: toolStep })
        listeners.get('session/event')!(subSession, { type: 'assistant/message', time: clock, data: toolStep })
      }
      clock = 4 * MIN
      await listeners.get('tools/execute')!(
        { name: 'bash', agent: { session: topSession }, deferContext: (m: unknown) => topNotes.push(m) },
        async () => 'ok',
      )
      await listeners.get('tools/execute')!(
        { name: 'bash', agent: { session: subSession }, deferContext: (m: unknown) => subNotes.push(m) },
        async () => 'ok',
      )

      expect(topNotes).toHaveLength(1)
      expect(topNotes[0].source.kind).toBe(PROGRESS_NOTE_KIND)
      expect(subNotes).toHaveLength(0)
      for (const stop of disposers) stop()
    } finally {
      vi.restoreAllMocks()
    }
  })
})

describe('SSE stream stall guard', () => {
  const URL_ = 'https://api.deepseek.com/anthropic/v1/messages'
  const POST: RequestInit = { method: 'POST', headers: { accept: 'text/event-stream', 'content-type': 'application/json' } }
  const enc = new TextEncoder()
  const sseEvent = (type: string) => `event: ${type}\ndata: {"type":"${type}","index":0}\n\n`
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

  it('matches only POST .../messages event-stream requests and parses chunked SSE lines', () => {
    expect(isModelStream(URL_, POST)).toBe(true)
    expect(isModelStream(new URL(URL_), {
      method: 'POST',
      headers: new Headers({ accept: 'text/event-stream', 'content-type': 'application/json' }),
    })).toBe(true)
    expect(isModelStream(URL_, { ...POST, method: 'GET' })).toBe(false)
    expect(isModelStream('https://api.deepseek.com/v1/models', POST)).toBe(false)
    expect(isModelStream(URL_, { method: 'POST', headers: { accept: 'application/json' } })).toBe(false)

    const types: string[] = []
    const feed = createSseCounter(type => types.push(type))
    feed(enc.encode(': keep-alive\n\nevent: ping\ndata: {"ty'))
    feed(enc.encode('pe":"ping"}\n\ndata: {"type":"content_block_delta"}\n\ndata: [raw]\n'))
    expect(types).toEqual(['ping', 'content_block_delta', 'unknown'])
  })

  it('aborts streams that stall on heartbeats after content starts and disarms after message_stop', async () => {
    let abortedReason: unknown
    const stalledUpstream: typeof fetch = async (_input, init) => {
      init?.signal?.addEventListener('abort', () => { abortedReason = init.signal?.reason })
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(enc.encode(sseEvent('message_start') + sseEvent('content_block_delta')))
          for (let i = 0; i < 15 && !init?.signal?.aborted; i += 1) {
            await sleep(20)
            if (!init?.signal?.aborted) controller.enqueue(enc.encode(': keep-alive\n\n' + sseEvent('ping')))
          }
          if (!init?.signal?.aborted) controller.close()
        },
      })
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }

    const stalls: Array<{ phase: string; path: string }> = []
    const guarded = wrapStreamStallFetch(stalledUpstream, { stallSeconds: 0.08 }, {
      onStall: detail => stalls.push({ phase: detail.phase, path: detail.path }),
    })
    const response = await guarded(URL_, POST)
    const reader = response.body!.getReader()
    await expect((async () => {
      while (!(await reader.read()).done) { /* consume */ }
    })()).rejects.toBeInstanceOf(StreamStallError)
    expect(abortedReason).toBeInstanceOf(StreamStallError)
    expect(stalls).toEqual([{ phase: 'stalled', path: '/anthropic/v1/messages' }])

    // Disarms cleanly once `message_stop` arrives or reader cancels.
    const cleanStalls: unknown[] = []
    const completedUpstream: typeof fetch = async () => {
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(enc.encode(sseEvent('message_start') + sseEvent('content_block_delta') + sseEvent('message_stop')))
          await sleep(140)
          controller.close()
        },
      })
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    const cleanGuarded = wrapStreamStallFetch(completedUpstream, { stallSeconds: 0.06 }, {
      onStall: detail => cleanStalls.push(detail),
    })
    const okRes = await cleanGuarded(URL_, POST)
    const okReader = okRes.body!.getReader()
    await okReader.read()
    await okReader.cancel()
    await sleep(120)
    expect(cleanStalls).toEqual([])
  })
})
