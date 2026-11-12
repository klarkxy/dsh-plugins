import { describe, expect, it } from 'vitest'
import type { RawEvent } from './chat.ts'
import { HITS_PER_SESSION, READ_MAX_CHARS, READ_ROW_MAX_CHARS, formatRead, formatSearch, historyRows, queryTerms, searchRows, windowRows, type HistoryRow } from './history.ts'

const human = (text: string, seq: number): RawEvent => ({ type: 'user/message', seq, time: seq * 1000, data: { content: [{ type: 'text', text }], source: { kind: 'user' } } })
const notice = (text: string, seq: number): RawEvent => ({ type: 'user/message', seq, time: seq * 1000, data: { content: [{ type: 'text', text }], source: { kind: 'agent-message' } } })
const reply = (text: string, seq: number): RawEvent => ({ type: 'assistant/message', seq, time: seq * 1000, data: { message: { content: [{ type: 'text', text }] } } })
const call = (name: string, args: unknown, seq: number): RawEvent => ({ type: 'tool/call', seq, time: seq * 1000, data: { name, arguments: args } })
const result = (text: string, seq: number): RawEvent => ({ type: 'tool/result', seq, time: seq * 1000, data: { message: { content: [{ type: 'text', text }] } } })

const LOG = [
  human('ship v2 on Friday', 1),
  reply('On it. I will open a task.', 2),
  call('dot_start_task', { title: 'release v2' }, 3),
  result('Started s7 in /proj', 4),
  notice('[dot notice] s7 finished its turn', 5),
  reply('The release task is done.', 6),
  { type: 'assistant/message', seq: 7, time: 7000, data: { message: { content: [] } } },
  { type: 'session/meta', seq: 8, time: 8000, data: {} },
] satisfies RawEvent[]

describe('historyRows', () => {
  it('keeps the conversation and leaves tool traffic out unless asked', () => {
    expect(historyRows(LOG).map(row => [row.seq, row.role])).toEqual([[1, 'human'], [2, 'dot'], [5, 'notice'], [6, 'dot']])
    expect(historyRows(LOG, true).map(row => [row.seq, row.role])).toEqual([[1, 'human'], [2, 'dot'], [3, 'tool-call'], [4, 'tool-result'], [5, 'notice'], [6, 'dot']])
    expect(historyRows(LOG, true)[2]!.text).toBe('dot_start_task {"title":"release v2"}')
  })

  it('leaves out the calls of the named tools together with their results', () => {
    const log: RawEvent[] = [
      human('where did we say friday', 1),
      { type: 'tool/call', seq: 2, time: 2000, data: { callId: 'c1', name: 'dot_search_history', arguments: { query: 'friday' } } },
      { type: 'tool/result', seq: 3, time: 3000, data: { message: { toolCallId: 'c1', content: [{ type: 'text', text: '1 match(es) for "friday"' }] } } },
      { type: 'tool/call', seq: 4, time: 4000, data: { callId: 'c2', name: 'dot_remember', arguments: { text: 'ships on friday' } } },
      { type: 'tool/result', seq: 5, time: 5000, data: { message: { toolCallId: 'c2', content: [{ type: 'text', text: 'Noted.' }] } } },
    ]
    expect(historyRows(log, true, new Set(['dot_search_history'])).map(row => row.seq)).toEqual([1, 4, 5])
    expect(historyRows(log, true).map(row => row.seq)).toEqual([1, 2, 3, 4, 5])
  })

  it('keeps carried notices and the human words as separate searchable rows', () => {
    const carried = '[dot notice] watched task finished'
    const rows = historyRows([{ type: 'user/message', seq: 9, time: 9000, data: { content: `${carried}\n\nplease check it`, source: { kind: 'user', dshDot: { carriedChars: carried.length } } } }])
    expect(rows).toEqual([
      { seq: 9, at: 9000, role: 'notice', text: carried },
      { seq: 9, at: 9000, role: 'human', text: 'please check it' },
    ])
  })

  it('reads a valid show_view card as dot speech and leaves a failed card out', () => {
    const meta = { owner: 'dsh-deep-view', title: 'Pick target', view: { type: 'options', id: 'o', options: [{ label: 'A' }, { label: 'B' }] }, interactive: true, awaitReply: true, dotCard: { number: 4 } }
    const log: RawEvent[] = [
      human('pick one', 1),
      { type: 'tool/call', seq: 2, time: 2000, data: { callId: 'c1', name: 'show_view', arguments: '{"title":"Pick target"}' } },
      { type: 'tool/result', seq: 3, time: 3000, data: { message: { toolCallId: 'c1', content: [{ type: 'text', text: 'shown' }] }, meta } },
      { type: 'tool/call', seq: 4, time: 4000, data: { callId: 'c2', name: 'show_view', arguments: '{}' } },
      { type: 'tool/result', seq: 5, time: 5000, data: { message: { toolCallId: 'c2', content: [{ type: 'text', text: 'invalid' }] }, meta: null } },
    ]
    expect(historyRows(log).map(row => [row.seq, row.role])).toEqual([[1, 'human'], [3, 'dot']])
    expect(historyRows(log)[1]!.text).toBe('[#4] Pick target — options: A/B')
    expect(historyRows(log, true).map(row => [row.seq, row.role])).toEqual([[1, 'human'], [3, 'dot']])
  })

  it('numbers events by their place in the log when the log carries no seq', () => {
    const rows = historyRows([{ type: 'session/meta' }, { type: 'user/message', data: { content: 'hello', source: { kind: 'user' } } }])
    expect(rows).toEqual([{ seq: 1, at: 0, role: 'human', text: 'hello' }])
  })
})

describe('searchRows', () => {
  it('wants every word in one message, in any order and letter case', () => {
    const rows = historyRows(LOG)
    expect(queryTerms('  Friday  SHIP friday ')).toEqual(['friday', 'ship'])
    expect(searchRows(rows, queryTerms('friday SHIP')).map(hit => hit.seq)).toEqual([1])
    // "task" and "friday" are both said, in different messages.
    expect(searchRows(rows, queryTerms('task friday'))).toEqual([])
    expect(searchRows(rows, [])).toEqual([])
  })

  it('finds tool traffic only in rows that include it', () => {
    expect(searchRows(historyRows(LOG), queryTerms('/proj'))).toEqual([])
    expect(searchRows(historyRows(LOG, true), queryTerms('/proj')).map(hit => hit.role)).toEqual(['tool-result'])
  })

  it('cuts a long message down to the text around the match', () => {
    const [hit] = searchRows([{ seq: 1, at: 0, role: 'human', text: `${'a'.repeat(300)} needle\n${'b'.repeat(300)}` }], ['needle'])
    expect(hit!.snippet.startsWith('…')).toBe(true)
    expect(hit!.snippet.endsWith('…')).toBe(true)
    expect(hit!.snippet).toContain(' needle b')
    expect(hit!.snippet.length).toBeLessThan(260)
  })
})

describe('formatSearch', () => {
  const hit = (seq: number, text: string): HistoryRow & { snippet: string } => ({ seq, at: 0, role: 'dot', text, snippet: text })
  const base = { query: 'x', limit: 12, searched: 2, skipped: 0, failed: 0, readTool: 'dot_read_history' }

  it('says what was searched when nothing matches', () => {
    const text = formatSearch({ ...base, groups: [], skipped: 3, failed: 1 })
    expect(text).toContain('Nothing found for "x"')
    expect(text).toContain('2 session(s) searched, 3 older one(s) left out, 1 could not be read')
  })

  it('lists hits by session with the position to read from, and counts what it leaves out', () => {
    const many = Array.from({ length: HITS_PER_SESSION + 2 }, (_, index) => hit(index, `x ${index}`))
    const text = formatSearch({ ...base, groups: [{ sessionId: 'dot1', what: 'Your conversation, current session', own: true, hits: many }, { sessionId: 's7', what: 'Task "release"', own: false, hits: [hit(9, 'x in task')] }] })
    expect(text).toContain(`${HITS_PER_SESSION + 3} match(es) for "x"`)
    expect(text).toContain('Your conversation, current session · dot1')
    expect(text).toContain('- seq 0 [no time] You: x 0')
    expect(text).toContain('(2 more match(es) in this session')
    // In a task session the replies are the task agent's, not dot's.
    expect(text).toContain('- seq 9 [no time] Assistant: x in task')
  })

  it('stops at the limit and counts the sessions it did not reach', () => {
    const text = formatSearch({ ...base, limit: 1, groups: [{ sessionId: 'a', what: 'A', own: false, hits: [hit(1, 'x'), hit(2, 'x')] }, { sessionId: 'b', what: 'B', own: false, hits: [hit(3, 'x')] }] })
    expect(text).toContain('- seq 1 ')
    expect(text).not.toContain('- seq 2 ')
    expect(text).toContain('(1 more session(s) with matches not listed')
  })
})

describe('windowRows', () => {
  const rows = [1, 2, 5, 6, 9].map(seq => ({ seq, at: 0, role: 'human' as const, text: `m${seq}` }))

  it('reads around a position, taking the next row when the position itself holds none', () => {
    expect(windowRows(rows, { seq: 5, before: 1, after: 1 })).toMatchObject({ rows: [{ seq: 2 }, { seq: 5 }, { seq: 6 }], earlier: 1, later: 1 })
    // seq 3 was a tool call that these rows leave out.
    expect(windowRows(rows, { seq: 3, before: 0, after: 0 }).rows.map(row => row.seq)).toEqual([5])
    expect(windowRows(rows, { seq: 99, before: 1, after: 4 }).rows.map(row => row.seq)).toEqual([6, 9])
  })

  it('reads the end of the session without a position', () => {
    expect(windowRows(rows, { before: 1, after: 1 })).toMatchObject({ rows: [{ seq: 5 }, { seq: 6 }, { seq: 9 }], earlier: 2, later: 0 })
    expect(windowRows([], { before: 4, after: 4 })).toEqual({ rows: [], earlier: 0, later: 0 })
  })
})

describe('formatRead', () => {
  const about = { sessionId: 'dot1', what: 'Your conversation, earlier session', own: true }

  it('gives the messages word for word and says what lies on either side', () => {
    const text = formatRead({ ...about, rows: [{ seq: 2, at: 0, role: 'human', text: 'ship v2' }, { seq: 3, at: 0, role: 'dot', text: 'on it' }], earlier: 4, later: 2 })
    expect(text).toContain('Your conversation, earlier session · dot1, seq 2 to 3:')
    expect(text).toContain('seq 2 [no time] Human: ship v2')
    expect(text).toContain('seq 3 [no time] You: on it')
    expect(text).toContain('(4 earlier row(s) before seq 2; 2 later row(s) after seq 3)')
    expect(formatRead({ ...about, rows: [], earlier: 0, later: 0 })).toContain('holds no conversation to read')
  })

  it('cuts one very long message and stops when the read grows too long, naming where to read on', () => {
    const long = 'x'.repeat(READ_ROW_MAX_CHARS + 50)
    const cut = formatRead({ ...about, rows: [{ seq: 1, at: 0, role: 'human', text: long }], earlier: 0, later: 0 })
    expect(cut).toContain('… (50 more characters cut)')
    const rows = Array.from({ length: 8 }, (_, index) => ({ seq: index + 1, at: 0, role: 'human' as const, text: 'y'.repeat(READ_ROW_MAX_CHARS) }))
    const text = formatRead({ ...about, rows, earlier: 0, later: 3 })
    const shown = Math.floor(READ_MAX_CHARS / READ_ROW_MAX_CHARS)
    expect(text.match(/\] Human: /g)).toHaveLength(shown)
    expect(text).toContain(`${8 - shown} row(s) after seq ${shown} left out for length; read on from seq ${shown + 1}`)
  })
})
