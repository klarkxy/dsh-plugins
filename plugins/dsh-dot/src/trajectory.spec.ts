import { describe, expect, it } from 'vitest'
import type { RawEvent } from './chat.ts'
import { foldTrajectory, TEXT_MAX, turnTotals } from './trajectory.ts'

const ev = (seq: number, type: string, data: unknown = {}, time = 1000 + seq * 10): RawEvent => ({ seq, time, type, data })
const user = (text: string, kind = 'user') => ({ content: [{ type: 'text', text }], source: { kind } })

describe('trajectory fold', () => {
  it('groups inputs, steps, replies and tool calls by turn', () => {
    const { turns, earlier } = foldTrajectory([
      ev(0, 'user/message', user('hello')),
      ev(1, 'turn/start', { turn: 1 }),
      ev(2, 'step/start', { turn: 1, step: 1 }),
      ev(3, 'request/header', { header: { config: { provider: 'p', model: 'm1' } } }),
      ev(4, 'user/message', user('cwd is here', 'runtime-context')),
      ev(5, 'assistant/message', {
        message: { content: [{ type: 'reasoning', text: 'think' }, { type: 'text', text: 'on it' }, { type: 'tool-call', id: 'c1', name: 'dot_overview', arguments: '{}' }] },
        usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 50 },
        stream: [{ type: 'reasoning-chunks', time0: 1045 }, { type: 'chunk', time: 1049, chunk: { type: 'usage' } }],
      }),
      ev(6, 'tool/call', { callId: 'c1', name: 'dot_overview', arguments: '{"limit":5}' }),
      ev(7, 'tool/result', { message: { toolCallId: 'c1', content: [{ type: 'text', text: 'all quiet' }], isError: false } }),
      ev(8, 'step/end', { turn: 1, step: 1 }),
      ev(9, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])
    expect(earlier).toBe(0)
    expect(turns).toHaveLength(1)
    const turn = turns[0]!
    expect(turn).toMatchObject({ turn: 1, end: 'completed', startedAt: 1010, endedAt: 1090 })
    expect(turn.records).toEqual([{ kind: 'input', seq: 0, at: 1000, source: 'user', text: 'hello' }])
    const step = turn.steps[0]!
    expect(step).toMatchObject({ step: 1, model: 'm1', firstTokenAt: 1045, startedAt: 1020, endedAt: 1080, usage: { input: 100, output: 20, cacheRead: 50 } })
    expect(step.records.map(record => record.kind)).toEqual(['input', 'reasoning', 'text', 'call'])
    expect(step.records[3]).toMatchObject({ kind: 'call', name: 'dot_overview', args: '{"limit":5}', status: 'done', result: 'all quiet', endedAt: 1070 })
    expect(turnTotals(turn)).toEqual({ steps: 1, calls: 1, usage: { input: 100, output: 20, cacheRead: 50 } })
  })

  it('keeps failures, running calls, relays, answers and compactions', () => {
    const long = 'x'.repeat(TEXT_MAX + 10)
    const { turns } = foldTrajectory([
      ev(0, 'turn/start', { turn: 1 }),
      ev(1, 'step/start', { step: 1 }),
      ev(2, 'assistant/attempt', { stream: [{ type: 'chunk', chunk: { type: 'finish', reason: { kind: 'error', failure: { message: '400 bad' } } } }] }),
      ev(3, 'turn/end', { reason: { kind: 'error', error: { message: '400 bad' } } }),
      ev(4, 'turn/start', { turn: 2 }),
      ev(5, 'user/message', { ...user('card picked'), source: { kind: 'user', deepView: { answer: { id: 'v', action: 'ok' } } } }),
      ev(6, 'user/message', user('task finished', 'agent-message')),
      ev(7, 'step/start', { step: 1 }),
      ev(8, 'compaction/summary', { summary: [{ type: 'text', text: 'so far' }], shadowedTokenCount: 9000 }),
      ev(9, 'tool/call', { callId: 'c2', name: 'dot_start_task', arguments: long }),
    ])
    expect(turns[0]).toMatchObject({ end: 'error', error: '400 bad' })
    expect(turns[0]!.steps[0]!.failed).toBe('400 bad')
    const second = turns[1]!
    expect(second.end).toBeUndefined()
    expect(second.records.map(record => record.kind === 'input' ? record.source : record.kind)).toEqual(['answer', 'relay'])
    expect(second.steps[0]!.records[0]).toMatchObject({ kind: 'compaction', text: 'so far', shadowed: 9000 })
    expect(second.steps[0]!.records[1]).toMatchObject({ kind: 'call', status: 'running', argsClipped: true })
  })

  it('sends only the newest turns', () => {
    const events: RawEvent[] = []
    for (let turn = 1; turn <= 5; turn++) events.push(ev(turn * 2, 'turn/start', { turn }), ev(turn * 2 + 1, 'turn/end', { reason: { kind: 'completed' } }))
    const { turns, earlier } = foldTrajectory(events, 2)
    expect(earlier).toBe(3)
    expect(turns.map(turn => turn.turn)).toEqual([4, 5])
  })
})
