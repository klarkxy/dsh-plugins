import { describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { AutoContinueRunner, type AutoContinueRunnerDeps } from './auto-runner.ts'
import type { AutoContinueService } from './auto-continue.ts'
import type { SessionAutoContinue } from './storage.ts'
import { resolveConfig } from './contracts.ts'
import type { PresenceModelHost } from './welcome-back.ts'

const ev = (type: string, seq: number, data: unknown = {}) =>
  ({ type, seq, time: seq, data }) as unknown as SessionEvent
const turnStart = (seq: number, turn: number) => ev('turn/start', seq, { turn })
const turnEnd = (seq: number, turn: number) => ev('turn/end', seq, { turn, reason: { kind: 'completed' } })
const user = (seq: number, text = '', kind = 'user') =>
  ev('user/message', seq, { id: `u${seq}`, role: 'user', source: { kind }, content: [{ type: 'text', text }] })
const assistant = (seq: number, turn: number, text = '') =>
  ev('assistant/message', seq, { turn, step: 1, stream: [], message: { id: `a${seq}`, role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text }] } })

const ENDED = [turnStart(1, 1), user(2, 'fix it'), assistant(3, 1, 'halfway'), turnEnd(4, 1)]

function judgeModel(answer: string | Error | Promise<never>) {
  const prepareCall = vi.fn(async () => {
    if (answer instanceof Error) throw answer
    const text = typeof answer === 'string' ? answer : await answer
    return {
      config: {},
      stream: async function* () {
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
  })
  const host: PresenceModelHost & { prepareCall: typeof prepareCall } = {
    prepareCall,
    host: { llm: { prepareCall }, agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) } },
    signal: new AbortController().signal,
  }
  return host
}

function harness(options: {
  record?: SessionAutoContinue
  events?: SessionEvent[]
  model?: ReturnType<typeof judgeModel>
  subagent?: boolean
  extraAgents?: Map<string, unknown>
} = {}) {
  const events = options.events ?? [...ENDED]
  const record: SessionAutoContinue | undefined = 'record' in options
    ? options.record
    : { mode: 'cautious', max: 3, revision: 1 }
  const followup = vi.fn()
  const flush = vi.fn(async () => true)
  const agent = {
    id: 's1',
    session: { id: 's1', header: options.subagent ? { origin: 'subagent', delegationDepth: 1 } : {} },
    followup,
  }
  const agents = new Map<string, unknown>([['s1', agent], ...(options.extraAgents ?? new Map())])
  const observeSession = vi.fn(async (_id: string, _options?: unknown) => ({
    events,
    [Symbol.dispose]() {},
  }))
  const runner = new AutoContinueRunner({
    service: () => ({ record: () => record }) as unknown as AutoContinueService,
    config: () => resolveConfig(),
    models: () => options.model,
    agents: { get: id => agents.get(id) as never },
    sessions: { flush },
    sessionQuery: { observeSession },
    isSubagent: session => Boolean((session as { header?: { origin?: string } }).header?.origin === 'subagent'),
  })
  return { runner, followup, flush, observeSession, agents }
}

const tick = async (n = 20) => { for (let i = 0; i < n; i++) await Promise.resolve() }

describe('auto-continue runner', () => {
  it('sends a marked followup then flushes on a continue verdict', async () => {
    const { runner, followup, flush } = harness({ model: judgeModel('{"verdict":"continue","reason":"unfinished","prompt":"keep going"}') })
    runner.onSessionEvent({ id: 's1' }, ENDED.at(-1)!)
    await vi.waitFor(() => expect(followup).toHaveBeenCalledTimes(1))
    const message = followup.mock.calls[0]![0] as { content: { type: string; text: string }[]; source: { kind: string; form: string; summary: string } }
    expect(message.source).toMatchObject({ kind: 'auto-continue', form: 'notice' })
    expect(message.source.summary).toContain('1/3')
    expect(message.content[0]!.text).toBe('Continue')
    await vi.waitFor(() => expect(flush).toHaveBeenCalledTimes(1))
  })

  it('stays silent on a done verdict and never calls the model when off or subagent', async () => {
    const done = harness({ model: judgeModel('{"verdict":"done","reason":"complete","prompt":""}') })
    done.runner.onSessionEvent({ id: 's1' }, ENDED.at(-1)!)
    await tick()
    expect(done.followup).not.toHaveBeenCalled()

    const off = harness({ record: { mode: 'off', max: 3, revision: 1 }, model: judgeModel('{}') })
    off.runner.onSessionEvent({ id: 's1' }, ENDED.at(-1)!)
    await tick()
    expect(off.observeSession).not.toHaveBeenCalled()

    const sub = harness({ subagent: true, model: judgeModel('{}') })
    sub.runner.onSessionEvent({ id: 's1' }, ENDED.at(-1)!)
    await tick()
    expect(sub.observeSession).not.toHaveBeenCalled()
  })

  it('abandons the followup when a newer turn started during the judge call', async () => {
    let release!: () => void
    const pending = new Promise<never>(done => { release = () => done('{"verdict":"continue","reason":"x","prompt":"go"}') })
    const { runner, followup } = harness({ model: judgeModel(pending) })
    runner.onSessionEvent({ id: 's1' }, ENDED.at(-1)!)
    await vi.waitFor(() => expect((runner as never as { inflight: Map<string, unknown> }).inflight.size).toBe(1))
    // A newer turn start (or human message) cancels the pending evaluation.
    runner.onSessionEvent({ id: 's1' }, turnStart(5, 2))
    release()
    await tick()
    expect(followup).not.toHaveBeenCalled()
  })

  it('stays silent when the model throws and when storage has no record', async () => {
    const { runner, followup } = harness({ model: judgeModel(new Error('llm down')) })
    runner.onSessionEvent({ id: 's1' }, ENDED.at(-1)!)
    await tick()
    expect(followup).not.toHaveBeenCalled()
    const absent = harness({ record: undefined, model: judgeModel('{}') })
    absent.runner.onSessionEvent({ id: 's1' }, ENDED.at(-1)!)
    await tick()
    expect(absent.observeSession).not.toHaveBeenCalled()
  })

  it('aborts every in-flight evaluation on dispose', async () => {
    const pending = new Promise<never>(() => {})
    const { runner, followup } = harness({ model: judgeModel(pending) })
    runner.onSessionEvent({ id: 's1' }, ENDED.at(-1)!)
    await vi.waitFor(() => expect((runner as never as { inflight: Map<string, unknown> }).inflight.size).toBe(1))
    await runner.dispose()
    expect(followup).not.toHaveBeenCalled()
  })
})
