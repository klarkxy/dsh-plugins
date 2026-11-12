import { describe, expect, it } from 'vitest'
import { chatItems, type RawEvent } from './chat.ts'

const ev = (seq: number, type: string, data: unknown): RawEvent => ({ seq, type, time: 1000 + seq, data })

describe('chatItems', () => {
  it('turns a session log into chat rows', () => {
    const items = chatItems([
      ev(0, 'system/message', {}),
      ev(1, 'turn/start', { turn: 1 }),
      ev(2, 'user/message', { content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }),
      ev(3, 'assistant/message', { message: { content: [{ type: 'thinking', text: 'hmm' }, { type: 'text', text: 'On it.' }] } }),
      ev(4, 'tool/call', { callId: 'c1', name: 'dot_start_task', arguments: '{}' }),
      ev(5, 'tool/result', { message: { toolCallId: 'c1', content: [{ type: 'text', text: 'Started task s1' }] } }),
      ev(6, 'user/message', { content: [{ type: 'text', text: '[dot notice] Updates' }], source: { kind: 'agent-message', form: 'relay' } }),
      ev(7, 'turn/end', { reason: { kind: 'error', error: { message: 'rate limited' } } }),
    ])
    expect(items.map(item => item.kind)).toEqual(['user', 'bot', 'tool', 'notice', 'error'])
    expect(items[1]).toMatchObject({ text: 'On it.' })
    expect(items[2]).toMatchObject({ name: 'dot_start_task', status: 'done', detail: 'Started task s1' })
    expect(items[4]).toMatchObject({ text: 'rate limited' })
  })

  it('splits notices carried by a human message into separate chat rows', () => {
    const notice = '[dot notice] Updates from other sessions:\n- turn-end · watched: done'
    const items = chatItems([
      ev(1, 'user/message', {
        content: [{ type: 'text', text: `${notice}\n\nplease check it` }],
        source: { kind: 'user', dshDot: { carriedChars: notice.length } },
      }),
    ])
    expect(items.map(item => item.kind)).toEqual(['notice', 'user'])
    expect(items[0]).toMatchObject({ key: '1:notice', text: notice })
    expect(items[1]).toMatchObject({ key: '1', text: 'please check it' })
  })

  it('keeps show_view cards with their presentation and the answers given to them', () => {
    const items = chatItems([
      ev(1, 'tool/call', { callId: 'v1', name: 'show_view', arguments: JSON.stringify({ title: 'Pick', view: { type: 'confirm', id: 'ok' } }) }),
      ev(2, 'tool/result', { message: { toolCallId: 'v1', content: [] }, meta: { owner: 'dsh-deep-view', viewId: 'view-1', awaitReply: true } }),
      ev(3, 'user/message', { content: [{ type: 'text', text: 'Confirmed' }], source: { kind: 'user', deepView: { owner: 'dsh-deep-view', version: 1, answer: { id: 'view-1', action: 'confirm', values: {} } } } }),
    ])
    expect(items[0]).toMatchObject({ kind: 'view', key: 'v1', title: 'Pick', presentation: { viewId: 'view-1' } })
    expect(items[1]).toMatchObject({ kind: 'answer', text: 'Confirmed' })
  })

  it('marks failed tools and a card whose result carried no presentation', () => {
    const items = chatItems([
      ev(1, 'tool/call', { callId: 'a', name: 'dot_read', arguments: JSON.stringify({ session_id: 's1' }) }),
      ev(2, 'tool/result', { message: { toolCallId: 'a', isError: true, content: 'boom' } }),
      ev(3, 'tool/call', { callId: 'b', name: 'show_view', arguments: 'not json' }),
      ev(4, 'tool/result', { message: { toolCallId: 'b', isError: true, content: [] } }),
      ev(5, 'tool/call', { callId: 'c', name: 'dot_answer', arguments: JSON.stringify({ id: 'ap-22', allow: true }) }),
      ev(6, 'tool/result', { message: { toolCallId: 'c', content: 'Error [dot/unknown-request]: no waiting request ap-22; it may have been answered in its own session' } }),
      ev(7, 'tool/call', { callId: 'd', name: 'dot_answer', arguments: JSON.stringify({ id: '' }) }),
      ev(8, 'tool/result', { message: { toolCallId: 'd', content: 'Error [dot/invalid]: give allow for an approval or answers for a question' } }),
      ev(9, 'tool/call', { callId: 'e', name: 'list_sessions', arguments: JSON.stringify({ limit: 50 }) }),
      ev(10, 'tool/result', { message: { toolCallId: 'e', content: '{"status":"failed","code":"SESSION_QUERY_INVALID_LIMIT","message":"limit must be an integer from 1 to 20; omit it or pass null for the default"}' } }),
      ev(11, 'tool/call', { callId: 'f', name: 'list_sessions', arguments: JSON.stringify({ limit: 5 }) }),
      ev(12, 'tool/result', { message: { toolCallId: 'f', content: '{"status":"ok","items":[]}' } }),
    ])
    expect(items[0]).toMatchObject({ status: 'error', args: { session_id: 's1' }, detail: 'boom' })
    expect(items[1]).toMatchObject({ kind: 'view', failed: true })
    expect(items[2]).toMatchObject({ status: 'done', args: { id: 'ap-22', allow: true } })
    expect(items[3]).toMatchObject({ status: 'error' })
    expect(items[4]).toMatchObject({ name: 'list_sessions', status: 'error' })
    expect(items[5]).toMatchObject({ name: 'list_sessions', status: 'done' })
  })
})
