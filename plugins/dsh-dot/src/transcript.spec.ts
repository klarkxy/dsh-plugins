import { describe, expect, it } from 'vitest'
import type { RawEvent } from './chat.ts'
import { awaitingReply, clipTokens, estimateTokens, exchanges, formatRows, openCardState, transcriptRows } from './transcript.ts'

const text = (value: string) => [{ type: 'text', text: value }]
const human = (seq: number, value: string, extra: Record<string, unknown> = {}): RawEvent => ({ seq, type: 'user/message', time: seq, data: { content: text(value), source: { kind: 'user', ...extra } } })
const notice = (seq: number, value: string): RawEvent => ({ seq, type: 'user/message', time: seq, data: { content: text(value), source: { kind: 'agent-message', form: 'relay' } } })
const reply = (seq: number, value: string): RawEvent => ({ seq, type: 'assistant/message', time: seq, data: { message: { content: [{ type: 'reasoning', text: 'hidden' }, ...text(value)] } } })
const card = (seq: number, awaitReply: boolean): RawEvent => ({ seq, type: 'tool/result', time: seq, data: { message: { toolCallId: 'c' + seq }, meta: { owner: 'dsh-deep-view', viewId: 'v' + seq, awaitReply } } })

describe('transcriptRows', () => {
  it('keeps what was said and drops the machinery', () => {
    const rows = transcriptRows([
      human(1, ' ship it '),
      { seq: 2, type: 'tool/call', data: { callId: 'c', name: 'dot_overview' } },
      { seq: 3, type: 'tool/result', data: { message: { toolCallId: 'c', content: text('ledger') } } },
      reply(4, 'on it'),
      notice(5, '[dot notice] task finished'),
      { seq: 6, type: 'user/message', data: { content: text('checkpoint'), source: { kind: 'compact-checkpoint' } } },
      reply(7, '   '),
    ])
    expect(rows).toEqual([
      { role: 'human', text: 'ship it', at: 1 },
      { role: 'dot', text: 'on it', at: 4 },
      { role: 'notice', text: '[dot notice] task finished', at: 5 },
    ])
  })

  it('hands a carried notice and the human words to the next segment separately', () => {
    const carried = '[dot notice] watched task finished'
    expect(transcriptRows([human(1, `${carried}\n\nplease check it`, { dshDot: { carriedChars: carried.length } })])).toEqual([
      { role: 'notice', text: carried, at: 1 },
      { role: 'human', text: 'please check it', at: 1 },
    ])
  })

  it('turns a valid show_view card into dot\'s own words and ignores a failed card', () => {
    const meta = { owner: 'dsh-deep-view', title: 'Pick target', view: { type: 'options', id: 'o', options: [{ label: 'A' }, { label: 'B' }] }, interactive: true, awaitReply: true, dotCard: { number: 3 } }
    expect(transcriptRows([
      { seq: 1, type: 'tool/result', time: 1, data: { message: { toolCallId: 'c1' }, meta } },
      { seq: 2, type: 'tool/result', time: 2, data: { message: { toolCallId: 'c2' }, meta: { owner: 'dsh-deep-view', status: 'invalid', title: 'Broken' } } },
    ])).toEqual([{ role: 'dot', text: '[#3] Pick target — options: A/B', at: 1 }])
  })

  it('groups rows into exchanges that start with what came in', () => {
    const rows = transcriptRows([human(1, 'a'), reply(2, 'b'), reply(3, 'c'), notice(4, 'd'), human(5, 'e'), reply(6, 'f')])
    expect(exchanges(rows).map(group => group.map(row => row.text).join(''))).toEqual(['abc', 'def'])
  })

  it('renders rows for the model, stamped only when the time is known', () => {
    expect(formatRows([{ role: 'human', text: 'hi', at: 0 }, { role: 'dot', text: 'hello', at: 0 }])).toBe('Human: hi\n\nYou: hello')
    expect(formatRows([{ role: 'notice', text: 'n', at: Date.UTC(2026, 0, 2, 12) }])).toMatch(/^\[2026-01-0\d \d\d:\d\d\] Notice: n$/)
  })
})

describe('token estimate', () => {
  it('counts CJK characters one each and other text by four', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcdefgh')).toBe(2)
    expect(estimateTokens('你好世界')).toBe(4)
    expect(estimateTokens('你好ab cd')).toBe(4)
  })

  it('clips to a budget from the start', () => {
    expect(clipTokens('short', 10)).toBe('short')
    const clipped = clipTokens('x'.repeat(4000), 100)
    expect(clipped.endsWith('…')).toBe(true)
    expect(estimateTokens(clipped)).toBeLessThanOrEqual(101)
  })
})

describe('awaitingReply', () => {
  it('holds while the latest card waits and clears when the human speaks', () => {
    expect(awaitingReply([human(1, 'q'), card(2, true)])).toBe(true)
    expect(awaitingReply([human(1, 'q'), card(2, false)])).toBe(false)
    expect(awaitingReply([card(2, true), human(3, 'picked', { deepView: { answer: { id: 'v2', action: 'submit' } } })])).toBe(false)
    expect(awaitingReply([card(2, true), notice(3, 'update')])).toBe(true)
  })
})

describe('openCardState', () => {
  it('extracts an unanswered show_view card and clears once the human replies', () => {
    const events: RawEvent[] = [
      { seq: 1, type: 'tool/call', time: 1, data: { callId: 'c2', name: 'show_view', arguments: '{"title":"Pick environment"}' } },
      card(2, true),
    ]
    expect(openCardState(events)).toEqual({
      hadUserMessage: false,
      openCard: 'Pick environment',
    })
    expect(openCardState([...events, human(3, 'staging')])).toEqual({ hadUserMessage: true })
  })
})
