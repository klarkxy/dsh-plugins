import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import { activeEventsOf, PresenceError } from './welcome-back.ts'

interface FileRef { attachmentId: string; name: string; bytes: number }
export interface EditFileServices {
  attachments?: { readFileStream(ref: FileRef, signal: AbortSignal): AsyncIterable<Uint8Array> }
  fileUploads?: { uploadStream(request: { sessionId: string; data: AsyncIterable<Uint8Array>; name: string; signal: AbortSignal }): Promise<unknown> }
}

/** Reuse the host's streaming intake; only a file in the exact source prompt may be copied. */
export async function stageEditFile(
  query: SessionQueryEngine, services: EditFileServices,
  request: { sessionId: string; promptSeq: number; attachmentId: string }, signal: AbortSignal,
): Promise<unknown> {
  if (![request.sessionId, request.attachmentId].every(value => typeof value === 'string' && value !== '')
    || !Number.isSafeInteger(request.promptSeq) || request.promptSeq < 0) {
    throw new PresenceError('session-manager/invalid-request', 'Invalid attachment request')
  }
  const observation = await query.observeSession(SessionId(request.sessionId), { signal, projectionMode: 'none' })
  try {
    const prompt = activeEventsOf(observation)?.find((event): event is SessionEvent<'user/message'> => (
      event.seq === request.promptSeq && event.type === 'user/message' && event.data.source.kind === 'user'
    ))
    const part = prompt?.data.content.find(part => part.type === 'file' && part.attachment.attachmentId === request.attachmentId)
    if (part?.type !== 'file' || !services.attachments || !services.fileUploads) {
      throw new PresenceError('session-manager/unavailable', 'The selected file is unavailable')
    }
    return await services.fileUploads.uploadStream({
      sessionId: request.sessionId, name: part.attachment.name,
      data: services.attachments.readFileStream(part.attachment, signal), signal,
    })
  } finally { observation[Symbol.dispose]() }
}
