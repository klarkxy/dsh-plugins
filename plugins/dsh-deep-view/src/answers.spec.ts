import { describe, expect, it } from 'vitest'
import { Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { checkedAnswer, replyAnswers } from './answers.ts'
import { createRpc } from './index.ts'
import type { ReplySnapshot } from './runtime.ts'
import type { PendingView, ViewNode } from './contracts.ts'
import { answerText, legacyAnswer } from './answer-text.ts'

const view: ViewNode = { type: 'stack', children: [
  { type: 'number', id: 'price', label: '单价', value: 4 },
  { type: 'slider', id: 'count', label: '数量', min: 0, max: 10, value: 2 },
  { type: 'metric', label: '合计', value: { '=': 'price * count' } },
  { type: 'options', id: 'result', options: [{ label: '确认结果' }, { label: '重新调整' }] },
] }
const savedAnswer = { id: 'v1', action: 'result', values: { selected: ['确认结果'], inputs: { price: 6, count: 2 } } }
function fromSources(sources: unknown[], kind = 'user'): ReplySnapshot {
  return { order: sources.map((_, i) => String(i)), locations: { getTurn: () => [] },
    nodes: { get: key => ({ kind, data: { source: sources[Number(key)] } }) } }
}

describe('durable card answers', () => {
  it('round-trips checked values with the same real Session user message', async () => {
    const id = SessionId('deep-view-durable')
    const session = Session.create(id)
    const events: ReturnType<Session['append']>[] = []
    const agent = { id, session, followup: (message: Parameters<Session['append']>[1]) => {
      events.push(session.append('user/message', message as never, { surfaceOp: 'append' }))
    } }
    const host = { agents: { get: () => agent, roots: () => [agent] },
      sessionController: { resolveAgent: async () => ({ agent }) },
      sessions: { flush: async () => true } }
    const pending = new Map<string, PendingView>([[id, { id: 'v1', sessionId: id, callId: 'c1', title: '订单', view, interactive: true, revision: 1 }]])
    const rpc = createRpc(host as never, pending)
    expect(await rpc('reply', { sessionId: id, viewId: 'v1', action: 'result', values: savedAnswer.values }, new AbortController().signal)).toMatchObject({ ok: true })
    // Restore through the Host's validation, as a cold-opened persisted session.
    const restored = Session.fromRestore(id, JSON.parse(JSON.stringify(events)), session.header, SessionLogOffset(0), 'detached')
    const [message] = restored.deriveMessages()
    expect(message.content).toEqual([{ type: 'text', text: '订单\n确认结果\n单价=6; 数量=2' }])
    expect(message.source).toMatchObject({ kind: 'user', deepView: { owner: 'dsh-deep-view', version: 1, answer: savedAnswer } })
    expect(checkedAnswer(replyAnswers(fromSources([message.source])).get('v1'), 'v1', view)).toEqual({ ...savedAnswer, revision: 1 })
    expect(await rpc('reply', { sessionId: id, viewId: 'v1', action: 'result', values: savedAnswer.values }, new AbortController().signal)).toMatchObject({ ok: false })
    expect(events).toHaveLength(1)
  })
  it('ignores foreign and malformed metadata and preserves the first accepted answer', () => {
    const source = { kind: 'user', deepView: { owner: 'dsh-deep-view', version: 1, answer: savedAnswer } }
    expect(replyAnswers(fromSources([source], 'context')).size).toBe(0)
    expect(replyAnswers(fromSources([{ ...source, kind: 'tool' }])).size).toBe(0)
    expect(replyAnswers(fromSources([{ kind: 'user', deepView: { owner: 'other', answer: savedAnswer } }])).size).toBe(0)
    expect(replyAnswers(fromSources([source, { kind: 'user', deepView: { ...source.deepView, answer: { ...savedAnswer, action: 'changed' } } }])).get('v1')).toBe(savedAnswer)
    expect(checkedAnswer(savedAnswer, 'other-card', view)).toBeNull()
    expect(checkedAnswer({ ...savedAnswer, values: { selected: ['forged'] } }, 'v1', view)).toBeNull()
    expect(checkedAnswer({ ...savedAnswer, values: { ...savedAnswer.values, inputs: { price: 6, count: 999 } } }, 'v1', view)).toBeNull()
  })
  it('matches the answer revision without rejecting legacy revision-one messages', () => {
    expect(checkedAnswer(savedAnswer, 'v1', view, 1)).toEqual(savedAnswer)
    expect(checkedAnswer(savedAnswer, 'v1', view, 2)).toBeNull()
    expect(checkedAnswer({ ...savedAnswer, revision: 2 }, 'v1', view, 2)?.revision).toBe(2)
    expect(checkedAnswer({ ...savedAnswer, revision: 2 }, 'v1', view, 1)).toBeNull()
  })
  it('restores the previous readable reply without rewriting its history', () => {
    const card = { id: 'v1', title: '订单', view }
    const text = '订单\n确认结果\n单价=6; 数量=2'
    expect(legacyAnswer(card, text)).toEqual(savedAnswer)
    expect(legacyAnswer(card, text + '\nExtra prose')).toBeNull()
    expect(legacyAnswer(card, '订单\n确认结果\n单价=6; 数量=200')).toBeNull()
    const nodes = new Map([
      ['card', { kind: 'tool-call', data: { root: { kind: 'tool-result', callId: 'c1', meta: {
        owner: 'dsh-deep-view', viewId: 'v1', ...card, awaitReply: true,
      } } } }],
      ['answer', { kind: 'user', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } }],
    ])
    const snapshot = { order: ['card', 'answer'], locations: { getTurn: () => [] }, nodes: { get: (id: string) => nodes.get(id) } } as ReplySnapshot
    expect(replyAnswers(snapshot).get('v1')).toEqual({ ...savedAnswer, revision: 1 })
    const unrelated = { kind: 'user', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Another question' }] } }
    expect(replyAnswers({ ...snapshot, order: ['card', 'unrelated', 'answer'], nodes: { get: id => id === 'unrelated' ? unrelated : snapshot.nodes.get(id) } }).size).toBe(0)
  })
  it('can read the original structured reply but rejects other cards and ambiguous controls', () => {
    const card = { id: 'v1', title: '订单', view }
    expect(legacyAnswer(card, JSON.stringify({ kind: 'answer_to_pending_view', tool: 'show_view', answers: [savedAnswer] }))).toEqual(savedAnswer)
    expect(legacyAnswer({ ...card, id: 'other' }, JSON.stringify({ kind: 'answer_to_pending_view', tool: 'show_view', answers: [savedAnswer] }))).toBeNull()
    const ambiguous: ViewNode = { type: 'stack', children: [
      { type: 'options', id: 'a', options: [{ label: 'Yes' }] },
      { type: 'options', id: 'b', options: [{ label: 'Yes' }] },
    ] }
    expect(legacyAnswer({ id: 'v', title: 'Choose', view: ambiguous }, 'Choose\nYes')).toBeNull()
  })
  it('answers the latest revision when a composer reply matches several revisions of one view', () => {
    const pick: ViewNode = { type: 'stack', children: [{ type: 'options', id: 'pick', options: [{ label: 'Yes' }, { label: 'No' }] }] }
    const card = (revision: number, callId: string) => ({ callId, kind: 'tool-result' as const, meta: {
      owner: 'dsh-deep-view', viewId: 'q', title: 'Choose', view: pick, awaitReply: true, revision,
    } })
    const message = { kind: 'user', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Choose\nYes' }] } }
    const nodes = new Map([
      ['r1', { kind: 'tool-call', data: { root: card(1, 'one') } }],
      ['r2', { kind: 'tool-call', data: { root: card(2, 'two') } }],
      ['m', message],
    ])
    const snapshot = { order: ['r1', 'r2', 'm'], locations: { getTurn: () => [] }, nodes: { get: (id: string) => nodes.get(id) } } as ReplySnapshot
    // Both revisions produce identical text for 'Yes'; the answer settles the newest revision.
    const answer = replyAnswers(snapshot).get('q')
    expect(answer).toEqual({ id: 'q', action: 'pick', values: { selected: ['Yes'] }, revision: 2 })
    expect(checkedAnswer(answer, 'q', pick, 2)).toEqual(answer)
    expect(checkedAnswer(answer, 'q', pick, 1)).toBeNull()
  })
  it('keeps the revision when only the newest revision matches the composer text', () => {
    const pick = (label: string): ViewNode => ({ type: 'stack', children: [{ type: 'options', id: 'pick', options: [{ label }, { label: 'No' }] }] })
    const card = (revision: number, callId: string, view: ViewNode) => ({ callId, kind: 'tool-result' as const, meta: {
      owner: 'dsh-deep-view', viewId: 'q', title: 'Choose', view, awaitReply: true, revision,
    } })
    const nodes = new Map([
      ['r1', { kind: 'tool-call', data: { root: card(1, 'one', pick('One')) } }],
      ['r2', { kind: 'tool-call', data: { root: card(2, 'two', pick('Two')) } }],
      ['m', { kind: 'user', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Choose\nTwo' }] } }],
    ])
    const snapshot = { order: ['r1', 'r2', 'm'], locations: { getTurn: () => [] }, nodes: { get: (id: string) => nodes.get(id) } } as ReplySnapshot
    const answer = replyAnswers(snapshot).get('q')
    expect(answer).toEqual({ id: 'q', action: 'pick', values: { selected: ['Two'] }, revision: 2 })
    expect(checkedAnswer(answer, 'q', pick('Two'), 2)).toEqual(answer)
  })
  it('still rejects identical text answering different views and never matches future revisions', () => {
    const pick: ViewNode = { type: 'stack', children: [{ type: 'options', id: 'pick', options: [{ label: 'Yes' }, { label: 'No' }] }] }
    const card = (viewId: string, revision: number, callId: string) => ({ callId, kind: 'tool-result' as const, meta: {
      owner: 'dsh-deep-view', viewId, title: 'Choose', view: pick, awaitReply: true, revision,
    } })
    const message = { kind: 'user', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Choose\nYes' }] } }
    const all = new Map<string, { kind: string; data: unknown }>([
      ['a1', { kind: 'tool-call', data: { root: card('a', 1, 'a1') } }],
      ['b1', { kind: 'tool-call', data: { root: card('b', 1, 'b1') } }],
      ['m1', message],
      ['a2', { kind: 'tool-call', data: { root: card('a', 2, 'a2') } }],
      ['m2', message],
    ])
    const take = (order: string[]) => ({ order, locations: { getTurn: () => [] }, nodes: { get: (id: string) => all.get(id) } } as ReplySnapshot)
    // Two different views legitimately answerable by the same text stay ambiguous.
    expect(replyAnswers(take(['a1', 'b1', 'm1'])).size).toBe(0)
    // A message predating revision 2 cannot settle it, even with matching text;
    // revision 2 remains unanswered and stale-revision checks still reject it.
    const later = replyAnswers(take(['a1', 'm1', 'a2']))
    expect(later.get('a')).toEqual({ id: 'a', action: 'pick', values: { selected: ['Yes'] }, revision: 1 })
    expect(checkedAnswer(later.get('a'), 'a', pick, 2)).toBeNull()
    expect(checkedAnswer(later.get('a'), 'a', pick, 1)).toEqual(later.get('a'))
    // The first accepted reply settles a view; later identical text cannot move it to a newer revision.
    const next = replyAnswers(take(['a1', 'm1', 'a2', 'm2']))
    expect(next.get('a')).toEqual(later.get('a'))
  })
  it('round-trips legacy confirm, form, submit and scalar input replies', () => {
    const cases: { view: ViewNode; action: string; values: Record<string, unknown> }[] = [
      { view: { type: 'confirm', id: 'confirm' }, action: 'confirm', values: { confirmed: false } },
      { view: { type: 'form', id: 'form', fields: [{ id: 'name', label: 'Name' }] }, action: 'form', values: { fields: { name: 'Ada' } } },
      { view: { type: 'stack', children: [
        { type: 'toggle', id: 'on', label: 'Enabled', value: false },
        { type: 'choice', id: 'color', label: 'Color', options: [{ label: 'Red', value: 'red' }], value: 'red' },
        { type: 'submit', id: 'send', label: 'Send' },
      ] }, action: 'send', values: { inputs: { on: true, color: 'red' } } },
    ]
    for (const item of cases) {
      const card = { id: 'v', title: 'Title', view: item.view }
      expect(legacyAnswer(card, answerText(card, item.action, item.values))).toEqual({ id: 'v', action: item.action, values: item.values })
    }
  })
  it('restores synchronous ask_view answers from tool-result meta and multi-select legacy text', () => {
    const multiView: ViewNode = { type: 'stack', children: [
      { type: 'choice', id: 'mods', label: '模块', multi: true, allowCustom: true, options: [{ label: '缓存', value: 'cache' }, { label: '日志', value: 'log' }] },
      { type: 'options', id: 'pick', multi: true, allowCustom: true, options: [{ label: '通过' }, { label: '复核' }] },
    ] }
    const directAnswer = { id: 'ask-1', action: 'pick', values: { selected: ['通过', '补测'], inputs: { mods: ['cache', '告警'] } }, revision: 1 }
    const toolNode = { kind: 'tool-call', data: { root: { kind: 'tool-result', callId: 'c-ask', meta: {
      owner: 'dsh-deep-view', viewId: 'ask-1', title: '评审', view: multiView, interactive: true, awaitReply: true, revision: 1, answer: directAnswer,
    } } } }
    const snap = { order: ['t'], locations: { getTurn: () => ['t'] }, nodes: { get: (key: string) => key === 't' ? toolNode : undefined } } as ReplySnapshot
    expect(checkedAnswer(replyAnswers(snap).get('ask-1'), 'ask-1', multiView, 1)).toEqual(directAnswer)

    const card = { id: 'ask-1', title: '评审', view: multiView }
    const text = answerText(card, 'pick', directAnswer.values)
    expect(text).toBe('评审\n通过, 补测\n模块=缓存, 告警')
    expect(legacyAnswer(card, text)).toEqual({ id: 'ask-1', action: 'pick', values: directAnswer.values })
  })
})
