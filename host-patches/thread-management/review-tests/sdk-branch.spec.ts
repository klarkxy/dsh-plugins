import { expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { finalResponse } from '../../packages/sdk/client/src/api.ts'

it('does not derive a superseded assistant result after the active branch cut', () => {
  const session = Session.create(SessionId('sdk-current-branch-review'))
  const prompt = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'original' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  session.append('assistant/message', { turn: 1, step: 1, message: createAssistantMessage({ content: [{ type: 'text', text: 'SUPERSEDED_REPLY' }] }), stream: [] }, { surfaceOp: 'append' })
  session.append('session/active-branch', { revision: 1, anchorSeq: prompt.seq, prompt: prompt.data, messageId: prompt.data.id, requestId: 'sdk-branch-review', expectedRevision: 0, inputRevision: 'review' })
  expect(finalResponse(session.snapshotEvents())).toBe('')
})
