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
    const pending = new Map<string, PendingView>([[id, { id: 'v1', sessionId: id, callId: 'c1', title: '订单', view }]])
    const rpc = createRpc(host as never, pending)
    expect(await rpc('reply', { sessionId: id, viewId: 'v1', action: 'result', values: savedAnswer.values }, new AbortController().signal)).toMatchObject({ ok: true })
    // Restore through the Host's validation, as a cold-opened persisted session.
    const restored = Session.fromRestore(id, JSON.parse(JSON.stringify(events)), session.header, SessionLogOffset(0), 'detached')
    const [message] = restored.deriveMessages()
    expect(message.content).toEqual([{ type: 'text', text: '订单\n确认结果\n单价=6; 数量=2' }])
    expect(message.source).toMatchObject({ kind: 'user', deepView: { owner: 'dsh-deep-view', version: 1, answer: savedAnswer } })
    expect(checkedAnswer(replyAnswers(fromSources([message.source])).get('v1'), 'v1', view)).toEqual(savedAnswer)
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
    expect(replyAnswers(snapshot).get('v1')).toEqual(savedAnswer)
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
})
