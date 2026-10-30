import { SessionId as brandSessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import { isSubagentSession } from '@klarkxy/dsh-plugin-kit/contracts'
import type { EditContent, EditPrepareRequest, EditPrepareValue } from './contracts.ts'
import { activeEventsOf, PresenceError } from './welcome-back.ts'

function unavailable(message: string): PresenceError {
  return new PresenceError('session-manager/unavailable', message)
}

function promptContent(event: SessionEvent<'user/message'>): { text: string; content: EditContent[] } {
  const content = event.data.content.map((block): EditContent => {
    if (block.type === 'text') return { type: 'text', text: block.text }
    if (block.type === 'image') return { type: 'image', attachmentId: block.attachment.attachmentId }
    if (block.type === 'file') return { type: 'file', ...block.attachment }
    throw unavailable('This prompt contains an unsupported content block')
  })
  const text = event.data.content.map(block => block.type === 'text' ? block.text : '').join('')
  if (text.trim() === '' && !content.some(block => block.type !== 'text')) throw unavailable('The selected prompt has no content to resend')
  return { text, content }
}

/** Resolve one exact human prompt on the active branch, with its original attachments. */
export async function prepareEdit(
  sessionQuery: SessionQueryEngine,
  request: EditPrepareRequest,
  signal: AbortSignal,
): Promise<EditPrepareValue> {
  if (typeof request?.sessionId !== 'string' || request.sessionId.trim() === '') {
    throw new PresenceError('session-manager/invalid-request', 'sessionId must be a non-empty string')
  }
  if (!Number.isSafeInteger(request.promptSeq) || request.promptSeq < 0) {
    throw new PresenceError('session-manager/invalid-request', 'promptSeq must be a non-negative integer')
  }
  const observation = await sessionQuery.observeSession(brandSessionId(request.sessionId), {
    signal,
    projectionMode: 'none',
  })
  try {
    if (isSubagentSession({ header: observation.header })) throw unavailable('Subagent prompts cannot be edited here')
    const events = activeEventsOf(observation)
    if (events === undefined) throw unavailable('The active conversation branch cannot be inspected')
    const prompt = events.find((event): event is SessionEvent<'user/message'> => (
      event.type === 'user/message' && event.seq === request.promptSeq && event.data.source.kind === 'user'
    ))
    if (prompt === undefined) throw unavailable('The selected prompt is unavailable')
    const { text, content } = promptContent(prompt)
    const modified = events.some(event => (event as { type: string }).type === 'workspace/changes' && event.seq > prompt.seq)
    return {
      sessionId: request.sessionId,
      promptSeq: prompt.seq,
      text,
      ...content.some(block => block.type !== 'text') ? { content } : {},
      modified,
    }
  } finally {
    observation[Symbol.dispose]()
  }
}
