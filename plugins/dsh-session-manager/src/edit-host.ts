import { EDIT_FILE_ENDPOINT, EDIT_PREPARE_ENDPOINT, TEMP_WORKSPACE_CHANNEL, type EditContent, type EditPrepareValue } from './contracts.ts'
import type { PresenceRpc } from './presence-model.ts'
import { HostOperationError, unwrap } from './session-actions.ts'

export type PromptContent = { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly data: string; readonly mediaType: string; readonly name?: string }
  | { readonly type: 'file'; readonly receiptId: string }

export type DraftAttachment = Exclude<EditContent, { type: 'text' }>
  | { readonly type: 'upload'; readonly file: File }

export interface EditHost {
  uploadFile?: (sessionId: string, file: File, signal: AbortSignal) => Promise<unknown>
  stageFile?: (request: { sessionId: string; promptSeq: number; attachmentId: string }, signal: AbortSignal) => Promise<unknown>
  prepare?: (request: { sessionId: string; promptSeq: number }, signal: AbortSignal) => Promise<unknown>
  attachment?: (request: { sessionId: string; attachmentId: string }) => Promise<unknown>
}

interface EditClient {
  connection?: { rpc?: PresenceRpc }
  remote?: { session?: { attachment?: EditHost['attachment'] } }
}

export function bindEditHost(client: EditClient): EditHost {
  const rpc = client.connection?.rpc
  const remote = client.remote?.session
  return {
    ...typeof rpc?.call === 'function' ? {
      prepare: (request, signal) => rpc.call(TEMP_WORKSPACE_CHANNEL, EDIT_PREPARE_ENDPOINT, request, signal),
      stageFile: (request, signal) => rpc.call(TEMP_WORKSPACE_CHANNEL, EDIT_FILE_ENDPOINT, request, signal),
    } : {},
    uploadFile: async (sessionId, file, signal) => {
      const query = new URLSearchParams({ sessionId, name: file.name })
      const response = await fetch(`/api/session/uploadFileBinary?${query}`, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/octet-stream' }, body: file, signal,
      })
      if (!response.ok) throw new HostOperationError('session/attachment-invalid')
      return response.json()
    },
    ...typeof remote?.attachment === 'function' ? { attachment: request => remote.attachment!(request) } : {},
  }
}

function readPreview(value: unknown): EditPrepareValue {
  if (typeof value !== 'object' || value === null) throw new HostOperationError('session-manager/unavailable')
  const record = value as {
    sessionId?: unknown
    promptSeq?: unknown
    text?: unknown
    content?: unknown
    modified?: unknown
  }
  if (typeof record.sessionId !== 'string'
    || typeof record.promptSeq !== 'number'
    || typeof record.text !== 'string' || typeof record.modified !== 'boolean') {
    throw new HostOperationError('session-manager/unavailable')
  }
  const content = record.content
  if (content !== undefined && (!Array.isArray(content) || !content.every(isEditContent))) {
    throw new HostOperationError('session-manager/unavailable')
  }
  return {
    sessionId: record.sessionId,
    promptSeq: record.promptSeq,
    text: record.text,
    ...content === undefined ? {} : { content: content as EditContent[] },
    modified: record.modified,
  }
}

function isEditContent(value: unknown): value is EditContent {
  if (typeof value !== 'object' || value === null) return false
  const part = value as { type?: unknown; text?: unknown; attachmentId?: unknown; name?: unknown; bytes?: unknown }
  return part.type === 'text' ? typeof part.text === 'string'
    : (part.type === 'image' || (part.type === 'file' && typeof part.name === 'string' && typeof part.bytes === 'number'))
      && typeof part.attachmentId === 'string' && part.attachmentId !== ''
}

type PendingContent = PromptContent | Exclude<DraftAttachment, { type: 'image' }>

/** Build the exact body for the edited prompt; images are read from the source Session. */
async function buildContent(host: EditHost, preview: EditPrepareValue, text: string, signal: AbortSignal, attachments?: readonly DraftAttachment[]): Promise<PendingContent[]> {
  const content: PendingContent[] = []
  let wroteText = false
  const parts = attachments === undefined ? preview.content ?? [{ type: 'text' as const, text: preview.text }]
    : [{ type: 'text' as const, text }, ...attachments]
  for (const part of parts) {
    signal.throwIfAborted()
    if (part.type === 'text') {
      if (text === preview.text) content.push(part)
      else if (!wroteText) content.push({ type: 'text', text })
      wroteText = true
      continue
    }
    if (part.type === 'file') { content.push(part); continue }
    if (part.type === 'upload') {
      if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(part.file.type)) {
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => { resolve(String(reader.result).split(',')[1]!) }
          reader.onerror = () => { reject(reader.error) }
          reader.readAsDataURL(part.file)
        })
        signal.throwIfAborted()
        content.push({ type: 'image', data, mediaType: part.file.type, name: part.file.name })
      } else content.push(part)
      continue
    }
    if (!host.attachment) throw new HostOperationError('session/lifecycle-unavailable')
    // Read against the source session, whose history authorizes this exact image.
    // Complete every read before staging, so a missing image cannot leave a half-staged body.
    const value = await unwrap(host.attachment({ sessionId: preview.sessionId, attachmentId: part.attachmentId }))
    const image = value as { attachment?: { attachmentId?: unknown; mediaType?: unknown; name?: unknown }; data?: unknown } | null
    if (image?.attachment?.attachmentId !== part.attachmentId || typeof image.data !== 'string' || image.data === ''
      || typeof image.attachment.mediaType !== 'string' || !image.attachment.mediaType.startsWith('image/')) {
      throw new HostOperationError('session/attachment-invalid')
    }
    content.push({
      type: 'image', data: image.data, mediaType: image.attachment.mediaType,
      ...typeof image.attachment.name === 'string' ? { name: image.attachment.name } : {},
    })
  }
  if (!wroteText && text !== '') content.push({ type: 'text', text })
  signal.throwIfAborted()
  return content
}

export interface EditSubmission {
  readonly requestId: string
  /** Freeze bytes and receipts after confirmation so retries never reuse an id for a changed body. */
  prepared?: PendingContent[]
  content?: PromptContent[]
  receipts?: Map<number, string>
}

/** Prepare the exact edit body for the existing Session; the host sends it on submit. */
export async function prepareEditContent(
  host: EditHost, preview: EditPrepareValue, text: string, submission: EditSubmission,
  signal: AbortSignal, attachments?: readonly DraftAttachment[],
): Promise<readonly PromptContent[]> {
  submission.prepared ??= await buildContent(host, preview, text, signal, attachments)
  await stageContent(host, preview, submission, preview.sessionId, signal)
  return submission.content!
}

async function stageContent(host: EditHost, preview: EditPrepareValue, submission: EditSubmission, sessionId: string, signal: AbortSignal): Promise<void> {
  const prepared = submission.prepared!
  if (submission.content !== undefined) return
  const content: PromptContent[] = []
  const receipts = submission.receipts ??= new Map()
  for (const [index, part] of prepared.entries()) {
    signal.throwIfAborted()
    if (part.type !== 'upload' && !(part.type === 'file' && 'attachmentId' in part)) { content.push(part); continue }
    let receiptId = receipts.get(index)
    if (receiptId === undefined) {
      const result = part.type === 'upload'
        ? host.uploadFile?.(sessionId, part.file, signal)
        : host.stageFile?.({ sessionId: preview.sessionId, promptSeq: preview.promptSeq, attachmentId: part.attachmentId }, signal)
      if (!result) throw new HostOperationError('session/lifecycle-unavailable')
      const value = await unwrap(result) as { receiptId?: unknown }
      if (typeof value?.receiptId !== 'string' || value.receiptId === '') throw new HostOperationError('session/attachment-invalid')
      receiptId = value.receiptId
      receipts.set(index, receiptId)
    }
    content.push({ type: 'file', receiptId })
  }
  submission.content = content
}

/** Read the exact human prompt that the editor edits. */
export async function previewEdit(
  host: EditHost,
  sessionId: string,
  promptSeq: number,
  signal: AbortSignal,
): Promise<EditPrepareValue> {
  if (typeof host.prepare !== 'function') throw new HostOperationError('session/lifecycle-unavailable')
  return readPreview(await unwrap(host.prepare({ sessionId, promptSeq }, signal)))
}
