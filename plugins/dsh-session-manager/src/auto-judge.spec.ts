import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  AUTO_CONTINUE_KIND,
  buildJudgeMaterial,
  composeContinuation,
  judgeSystem,
  parseVerdict,
  preJudge,
} from './auto-judge.ts'

const ev = (type: string, seq: number, data: unknown = {}) =>
  ({ type, seq, time: seq, data }) as unknown as SessionEvent
const turnStart = (seq: number, turn: number) => ev('turn/start', seq, { turn })
const turnEnd = (seq: number, turn: number, kind: string = 'completed') =>
  ev('turn/end', seq, { turn, reason: { kind } })
const user = (seq: number, text = '', kind: string = 'user') =>
  ev('user/message', seq, { id: `u${seq}`, role: 'user', source: { kind }, content: [{ type: 'text', text }] })
const assistant = (seq: number, turn: number, text = '') =>
  ev('assistant/message', seq, {
    turn, step: 1, stream: [],
    message: { id: `a${seq}`, role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text }] },
  })
const call = (seq: number, turn: number, callId: string, name: string, args = '{}') =>
  ev('tool/call', seq, { turn, step: 1, callId, name, arguments: args })
const result = (seq: number, turn: number, callId: string, isError = false) =>
  ev('tool/result', seq, {
    turn, step: 1,
    message: { id: `t${seq}`, role: 'tool', source: { kind: 'tool' }, toolCallId: callId, isError, content: [] },
  })

const record = { max: 3 }

/** One human turn with a reply and a tool round trip, then its turn/end. */
function humanTurn(withResult = true) {
  return [
    turnStart(1, 1), user(2, 'fix the bug'),
    call(3, 1, 'c1', 'read_file'),
    ...(withResult ? [result(4, 1, 'c1')] : []),
    assistant(5, 1, 'fixed half of it'),
    turnEnd(6, 1),
  ]
}

describe('preJudge hard rules', () => {
  it('stops on every non-completable reason except max-tokens', () => {
    const base = humanTurn()
    for (const kind of ['aborted', 'blocked', 'error', 'interrupted', 'forked']) {
      const events = [...base.slice(0, -1), turnEnd(6, 1, kind)]
      expect(preJudge(events, events.at(-1)!, record).action).toBe('stop')
    }
    const maxed = [...base.slice(0, -1), turnEnd(6, 1, 'max-tokens')]
    expect(preJudge(maxed, maxed.at(-1)!, record)).toEqual({ action: 'judge', count: 0 })
  })

  it('stops when no human message exists on the branch', () => {
    const events = [turnStart(1, 1), user(2, 'ping', 'schedule'), assistant(3, 1, 'pong'), turnEnd(4, 1)]
    expect(preJudge(events, events.at(-1)!, record).action).toBe('stop')
  })

  it('counts only auto-continue messages after the latest human message', () => {
    const events = [
      turnStart(1, 1), user(2, 'go'), assistant(3, 1, 'one'), turnEnd(4, 1),
      turnStart(5, 2), user(6, '', AUTO_CONTINUE_KIND), assistant(7, 2, 'two'), turnEnd(8, 2),
      turnStart(9, 3), user(10, '', AUTO_CONTINUE_KIND), call(11, 3, 'c1', 'read_file'), result(12, 3, 'c1'), assistant(13, 3, 'three'), turnEnd(14, 3),
    ]
    expect(preJudge(events, events.at(-1)!, record)).toEqual({ action: 'judge', count: 2 })
    // A newer human message resets the count entirely.
    const reset = [...events, turnStart(15, 4), user(16, 'thanks'), turnEnd(17, 4)]
    expect(preJudge(reset, reset.at(-1)!, record)).toEqual({ action: 'judge', count: 0 })
  })

  it('stops once the continuation limit is reached', () => {
    const events = [
      turnStart(1, 1), user(2, 'go'), assistant(3, 1, 'one'), turnEnd(4, 1),
      turnStart(5, 2), user(6, '', AUTO_CONTINUE_KIND), assistant(7, 2, 'two'), turnEnd(8, 2),
      turnStart(9, 3), user(10, '', AUTO_CONTINUE_KIND), assistant(11, 3, 'three'), turnEnd(12, 3),
      turnStart(13, 4), user(14, '', AUTO_CONTINUE_KIND), assistant(15, 4, 'four'), turnEnd(16, 4),
    ]
    expect(preJudge(events, events.at(-1)!, record).action).toBe('stop')
  })

  it('stops when the ended turn was itself a tool-less continuation', () => {
    const events = [
      turnStart(1, 1), user(2, 'go'), call(3, 1, 'c1', 'read_file'), result(4, 1, 'c1'), assistant(5, 1, 'one'), turnEnd(6, 1),
      turnStart(7, 2), user(8, '', AUTO_CONTINUE_KIND), assistant(9, 2, 'replied, no tools'), turnEnd(10, 2),
    ]
    expect(preJudge(events, events.at(-1)!, record).action).toBe('stop')
    // The same continuation turn WITH a tool call is allowed to be judged.
    const progressed = [...events.slice(0, -1), call(10, 2, 'c2', 'read_file'), result(11, 2, 'c2'), turnEnd(12, 2)]
    expect(preJudge(progressed, progressed.at(-1)!, record)).toEqual({ action: 'judge', count: 1 })
    // A context injection (other source kinds) may precede the continuation in
    // the same turn; the turn is still recognized as auto-started.
    const injected = [
      turnStart(1, 1), user(2, 'go'), call(3, 1, 'c1', 'read_file'), result(4, 1, 'c1'), assistant(5, 1, 'one'), turnEnd(6, 1),
      turnStart(7, 2), user(8, 'context note', 'schedule'), user(9, '', AUTO_CONTINUE_KIND), assistant(10, 2, 'replied, no tools'), turnEnd(11, 2),
    ]
    expect(preJudge(injected, injected.at(-1)!, record)).toEqual({ action: 'stop', reason: 'continuation made no progress' })
  })

  it('stops on an unmatched tool call and on any ask_user call', () => {
    const pending = humanTurn(false)
    expect(preJudge(pending, pending.at(-1)!, record).action).toBe('stop')
    const ask = [
      turnStart(1, 1), user(2, 'go'),
      call(3, 1, 'c1', 'ask_user_question'), result(4, 1, 'c1'),
      assistant(5, 1, 'asked'), turnEnd(6, 1),
    ]
    expect(preJudge(ask, ask.at(-1)!, record).action).toBe('stop')
  })
})

describe('buildJudgeMaterial', () => {
  it('caps the request and response and summarizes tools, todos and usage', () => {
    const long = 'x'.repeat(4_000)
    const events = [
      turnStart(1, 1), user(2, long),
      call(3, 1, 'c1', 'todo_write', JSON.stringify({ todos: [
        { content: 'a'.repeat(200), status: 'pending' },
        { content: 'done item', status: 'completed' },
      ] })),
      result(4, 1, 'c1'),
      call(5, 1, 'c2', 'shell'), result(6, 1, 'c2', true),
      assistant(7, 1, 'still going'),
      turnEnd(8, 1),
    ]
    const material = buildJudgeMaterial(events, events.at(-1)!, { max: 3 }, 1)
    expect(Array.from(material.request)).toHaveLength(1500)
    expect(material.response).toBe('still going')
    expect(material.tools).toEqual({ total: 2, failed: 1, names: ['todo_write', 'shell'] })
    expect(material.todos).toEqual([
      { content: 'a'.repeat(120), status: 'pending' },
      { content: 'done item', status: 'completed' },
    ])
    expect(material.autoContinues).toEqual({ used: 1, limit: 3 })
  })

  it('omits todos when the latest todo_write input is unreadable or absent', () => {
    const events = [
      turnStart(1, 1), user(2, 'go'),
      call(3, 1, 'c1', 'todo_write', 'not json'), result(4, 1, 'c1'),
      assistant(5, 1, 'done?'), turnEnd(6, 1),
    ]
    expect(buildJudgeMaterial(events, events.at(-1)!, { max: 3 }, 0).todos).toBeUndefined()
    const noTodo = [...humanTurn()]
    expect(buildJudgeMaterial(noTodo, noTodo.at(-1)!, { max: 3 }, 0).todos).toBeUndefined()
  })
})

describe('judgeSystem and parseVerdict', () => {
  it('embeds the stance matching the mode', () => {
    expect(judgeSystem('cautious')).toContain('Stance: cautious.')
    expect(judgeSystem('cautious')).not.toContain('Stance: bold.')
    expect(judgeSystem('bold')).toContain('Stance: bold.')
    expect(judgeSystem('cautious')).not.toContain('{STANCE}')
  })

  it('parses fenced JSON and rejects unknown shapes and verdicts', () => {
    expect(parseVerdict('```json\n{"verdict":"continue","reason":"unfinished todos","prompt":"keep going"}\n```', 'cautious'))
      .toEqual({ verdict: 'continue', reason: 'unfinished todos', prompt: 'keep going' })
    expect(parseVerdict('not json', 'cautious')).toBeUndefined()
    expect(parseVerdict('{"verdict":"maybe"}', 'bold')).toBeUndefined()
    expect(parseVerdict('[1,2]', 'bold')).toBeUndefined()
  })

  it('downgrades choose to needs_user outside bold and caps fields', () => {
    expect(parseVerdict('{"verdict":"choose","reason":"r","prompt":"pick A"}', 'cautious')?.verdict).toBe('needs_user')
    expect(parseVerdict('{"verdict":"choose","reason":"r","prompt":"pick A"}', 'bold')?.verdict).toBe('choose')
    const long = JSON.stringify({ verdict: 'continue', reason: 'r'.repeat(200), prompt: 'p'.repeat(600) })
    const verdict = parseVerdict(long, 'bold')!
    expect(Array.from(verdict.reason)).toHaveLength(80)
    expect(Array.from(verdict.prompt)).toHaveLength(500)
  })
})

describe('composeContinuation', () => {
  const base = {
    verdict: 'continue' as const,
    mode: 'cautious' as const,
    continueMode: 'auto' as const,
    continueText: '',
    judgePrompt: 'finish the tests',
    request: 'fix the bug',
    count: 0,
    max: 3,
    reason: 'unfinished todos',
  }

  it('sends the judge prompt in auto mode and the fixed text otherwise', () => {
    expect(composeContinuation(base).text).toBe('finish the tests')
    expect(composeContinuation({ ...base, continueMode: 'fixed', continueText: 'carry on' }).text).toBe('carry on')
    // An empty judge prompt falls back to the fixed-text rule.
    expect(composeContinuation({ ...base, judgePrompt: '  ' }).text).toBe('Continue')
    expect(composeContinuation({ ...base, judgePrompt: '', request: '修复这个错误' }).text).toBe('继续')
  })

  it('appends the choose suffix only when the text did not come from the judge', () => {
    const choose = { ...base, verdict: 'choose' as const, mode: 'bold' as const }
    expect(composeContinuation(choose).text).toBe('finish the tests')
    expect(composeContinuation({ ...choose, continueMode: 'fixed', continueText: 'carry on' }).text)
      .toBe('carry on Go with the option you recommended and say which one you chose.')
    expect(composeContinuation({ ...choose, judgePrompt: '', request: '修复这个错误' }).text)
      .toBe('继续 按你推荐的方案继续，并在回复中说明选了哪个。')
  })

  it('formats the notice summary by request language', () => {
    expect(composeContinuation(base).summary).toBe('Auto-continue 1/3: unfinished todos')
    expect(composeContinuation({ ...base, request: '修复这个错误', count: 1 }).summary).toBe('自动继续 2/3：unfinished todos')
  })
})
