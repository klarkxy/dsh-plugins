import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { projectConversation } from './conversation.ts'

function call(session: Session, name: string, turn: number, step = 1) {
  session.append('tool/call', { callId: 'reused', name, arguments: '{}', turn, step })
  return session.append('tool/result', {
    turn, step, message: { role: 'tool', toolCallId: 'reused', content: [{ type: 'text', text: name }] },
  }, { surfaceOp: 'append' })
}

describe('tool dispatch attribution', () => {
  it('keeps reused IDs attached to the correct turn and step in every conversation view', () => {
    const session = Session.create(SessionId('attribution'))
    const first = call(session, 'write_file', 1)
    const second = call(session, 'read_file', 2)
    const third = call(session, 'list_files', 2, 2)
    const events = session.snapshotEvents()
    for (const view of ['transcript', 'surface'] as const) {
      const cut = projectConversation(events, 0, false, false, view)
      expect(cut.items.map(item => item.toolName)).toEqual(['write_file', 'read_file', 'list_files'])
    }
    const modelRows = [first, second, third].map(event => ({ seq: event.seq, message: event.data.message }))
    expect(projectConversation(events, 0, true, false, 'surface', modelRows).items.map(item => item.toolName))
      .toEqual(['write_file', 'read_file', 'list_files'])
  })

  it('uses the original dispatch of a replaced result after a later call reused its ID', () => {
    const session = Session.create(SessionId('derived-attribution'))
    const first = call(session, 'write_file', 1)
    call(session, 'read_file', 1)
    const replacement = session.append('tool/result', {
      ...first.data,
      message: { ...first.data.message, content: [{ type: 'text', text: 'summarized original result' }] },
    }, { surfaceOp: { op: 'replace', startSeq: first.seq, endSeq: first.seq }, sourceEventSeqs: [first.seq] })
    const cut = projectConversation(session.snapshotEvents(), 0, false, false, 'surface')
    expect(cut.items.find(item => item.seq === replacement.seq)?.toolName).toBe('write_file')
  })

  it('does not attribute a missing dispatch to an unrelated turn or a future call', () => {
    const session = Session.create(SessionId('missing-attribution'))
    const result = session.append('tool/result', {
      turn: 1, step: 1, message: { role: 'tool', toolCallId: 'reused', content: [{ type: 'text', text: 'orphan' }] },
    }, { surfaceOp: 'append' })
    call(session, 'read_file', 2)
    expect(projectConversation(session.snapshotEvents(), 0, false, false).items.find(item => item.seq === result.seq)?.toolName)
      .toBeUndefined()
  })
})
