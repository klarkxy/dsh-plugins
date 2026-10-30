/**
 * Host-side edit-and-resend engine. A commit never writes to the source log:
 * it forks the retained conversation prefix, queues the
 * edited prompt on the fork, mirrors the title/sidebar position/pin, and
 * archives the source so the branch looks like the same chat.
 *
 * Why a fork and not a same-session `surfaceOp` replace: a replace bumps
 * `surface.contentGeneration`, which starts a new request series and
 * reshuffles the system/tool projections — the provider's prompt prefix
 * cache can be disrupted. Retaining the unchanged model-visible prefix gives
 * the provider the same content to reuse; actual cache hits remain provider-dependent.
 *
 * The profile's durable journal records intent before creating a fork and
 * the child identity before prompting it. Replays resume that same child.
 * The host cannot create a fork idempotently: an interrupted fork with no
 * saved child identity is therefore refused, never guessed or repeated.
 */
import { SessionId as brandSessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import { isSubagentSession } from '@klarkxy/dsh-plugin-kit/contracts'
import type {
  RetryCapabilities,
  RetryCommitRequest,
  RetryCommitValue,
  RetryPreviewRequest,
  RetryPreviewValue,
} from './retry-contracts.ts'
import {
  editForkBoundary,
  hasLiveJobs,
  inputRevisionOf,
  isOnActiveSurface,
  modificationEvidence,
} from './retry-branch.ts'
import { editedPromptBlocks } from './retry-content.ts'
import { activeEventsOf, PresenceError, type PresenceServices } from './welcome-back.ts'
import { RetryJournalError, type RetryJournal, type RetryRecord } from './retry-journal.ts'

/** Failure codes surfaced to the client through `readFailure`. */
export type RetryErrorCode =
  | 'session-manager/invalid-request'
  | 'session-manager/not-found'
  | 'session-manager/busy'
  | 'session-manager/unavailable'
  | 'session/retry-revision'
  | 'session/retry-input'
  | 'session/retry-conflict'
  | 'session/retry-blocked'
  | 'session/retry-failed'
  | 'session/retry-pending'
  | 'session/retry-uncertain'

export class RetryError extends Error {
  override readonly name = 'RetryError'
  constructor(readonly code: RetryErrorCode, message: string) {
    super(message)
  }
}

interface RetryServices extends PresenceServices {
  readonly sessionQuery: SessionQueryEngine
  readonly retryJournal?: RetryJournal
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type CommitEntry = RetryRecord

/** Retry needs a session controller that can fork and prompt; capabilities are honest about it. */
export function retryCapabilities(services: RetryServices): RetryCapabilities {
  const controller = services.sessionController
  const available = services.retryJournal !== undefined && controller !== undefined
    && typeof controller.fork === 'function'
    && typeof controller.prompt === 'function'
  return { retry: available, retryModified: available, retryContent: false }
}

function requireSessionId(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RetryError('session-manager/invalid-request', 'sessionId must be a non-empty string')
  }
  return value
}

function findPrompt(events: readonly SessionEvent[], messageId: string): SessionEvent<'user/message'> | undefined {
  return events.find((event): event is SessionEvent<'user/message'> => (
    event.type === 'user/message' && event.data.id === messageId && event.data.source.kind === 'user'
  ))
}

async function observe(services: RetryServices, sessionId: string, signal: AbortSignal) {
  const observation = await services.sessionQuery.observeSession(brandSessionId(sessionId), {
    signal,
    projectionMode: 'none',
  })
  const events = activeEventsOf(observation)
  if (events === undefined) {
    observation[Symbol.dispose]()
    throw new RetryError('session-manager/unavailable', 'the active conversation branch cannot be inspected')
  }
  return { observation, events }
}

export async function previewRetry(
  services: RetryServices,
  request: RetryPreviewRequest,
  signal: AbortSignal,
): Promise<RetryPreviewValue> {
  const sessionId = requireSessionId(request?.sessionId)
  if (typeof request.messageId !== 'string' || request.messageId === '') {
    throw new RetryError('session-manager/invalid-request', 'messageId must be a non-empty string')
  }
  const { observation, events } = await observe(services, sessionId, signal)
  try {
    const base = { sessionId, messageId: request.messageId }
    if (isSubagentSession({ header: observation.header })) {
      return { ...base, promptSeq: -1, branchRevision: 0, inputRevision: '', eligible: false, modified: false, reason: 'subagent' }
    }
    if (services.agents?.get(sessionId)?.status === 'running' || hasLiveJobs(events)) {
      return { ...base, promptSeq: -1, branchRevision: 0, inputRevision: '', eligible: false, modified: false, reason: 'busy' }
    }
    const prompt = findPrompt(events, request.messageId)
    if (prompt === undefined || !isOnActiveSurface(events, prompt.seq)) {
      return { ...base, promptSeq: -1, branchRevision: 0, inputRevision: '', eligible: false, modified: false, reason: 'prompt-unavailable' }
    }
    const modified = modificationEvidence(events, prompt.seq).length > 0
    return {
      ...base,
      promptSeq: prompt.seq,
      branchRevision: events[events.length - 1]?.seq ?? 0,
      inputRevision: inputRevisionOf(prompt),
      eligible: !modified,
      modified,
      ...modified ? { reason: 'modified' } : {},
    }
  } finally {
    observation[Symbol.dispose]()
  }
}

/**
 * Latest `session/title` text at or before `throughSeq`. Title events are
 * log-only and merge-augmented, so the scan reads plain strings — the same
 * fold the title projection applies, without importing the title service.
 */
function foldedTitle(events: readonly SessionEvent[], throughSeq: number): string | undefined {
  let title: string | undefined
  for (const event of events) {
    if (event.seq > throughSeq) break
    const type: string = event.type
    if (type !== 'session/title') continue
    const value = (event.data as { title?: unknown }).title
    if (typeof value === 'string' && value.trim() !== '') title = value
  }
  return title
}

/**
 * The title the child still needs after the cut. A title event inside the
 * inherited prefix already lands on the fork; a title beyond that prefix
 * has to be re-applied — before the prompt, so an explicit
 * user-source title pins it ahead of any automatic generation.
 */
function titleToApply(events: readonly SessionEvent[], forkSeq: number): string | undefined {
  const title = foldedTitle(events, Number.MAX_SAFE_INTEGER)
  if (title === undefined || foldedTitle(events, forkSeq) === title) return undefined
  return title
}

/**
 * Canonical request equality: replay is valid only when every stored field of
 * the original request matches — same target, same edit text, same preview
 * tokens. `content` is rejected at validation so it never reaches this point.
 */
function assertSameRequest(entry: CommitEntry, request: RetryCommitRequest): void {
  if (entry.source !== request.sessionId
    || entry.messageId !== request.messageId
    || entry.text !== request.text
    || entry.expectedRevision !== request.expectedRevision
    || entry.expectedInputRevision !== request.expectedInputRevision) {
    throw new RetryError('session/retry-conflict', 'the same requestId carries a different retry body')
  }
}

/**
 * Re-check every preview guarantee on the live log, then record the resume
 * state a fork commit needs. The source log is never mutated, so this is the
 * only place the observed head matters: a stale check rejects before any
 * stage lands.
 */
async function validateCommit(
  services: RetryServices,
  request: RetryCommitRequest,
  sessionId: string,
  signal: AbortSignal,
): Promise<CommitEntry> {
  const { observation, events } = await observe(services, sessionId, signal)
  try {
    signal.throwIfAborted()
    if (isSubagentSession({ header: observation.header })) {
      throw new RetryError('session/retry-blocked', 'subagent sessions cannot be edited and resent')
    }
    if (services.agents?.get(sessionId)?.status === 'running' || hasLiveJobs(events)) {
      throw new RetryError('session-manager/busy', 'the session is busy')
    }
    const prompt = findPrompt(events, request.messageId)
    if (prompt === undefined) {
      throw new RetryError('session/retry-input', 'the prompt is no longer in the session')
    }
    if (!isOnActiveSurface(events, prompt.seq)) {
      throw new RetryError('session/retry-revision', 'the prompt is no longer on the active surface')
    }
    const lastSeq = events[events.length - 1]?.seq ?? -1
    if (lastSeq !== request.expectedRevision) {
      throw new RetryError('session/retry-revision', 'the session changed after the preview')
    }
    if (inputRevisionOf(prompt) !== request.expectedInputRevision) {
      throw new RetryError('session/retry-input', 'the prompt changed after the preview')
    }
    // Every resend rewrites history; the client confirms explicitly on each send.
    if (request.allowModified !== true) {
      throw new RetryError('session/retry-input', 'resend requires explicit confirmation')
    }
    const blocks = editedPromptBlocks(prompt.data.content, request.text)
    if (!blocks.some(block => block.type !== 'text' || block.text !== '')) {
      throw new RetryError('session/retry-input', 'the resent prompt would be empty')
    }
    const forkSeq = editForkBoundary(events, prompt.seq)
    if (forkSeq === undefined) {
      throw new RetryError('session/retry-blocked', 'the prompt has no drained conversation prefix to fork from')
    }
    return {
      requestId: request.requestId,
      source: sessionId,
      messageId: request.messageId,
      text: request.text,
      expectedRevision: request.expectedRevision,
      expectedInputRevision: request.expectedInputRevision,
      forkSeq,
      title: titleToApply(events, forkSeq),
      forkStarted: false,
      prompted: false,
    }
  } finally {
    observation[Symbol.dispose]()
  }
}

/**
 * The prompt the child receives keeps the original block order. Image
 * bytes are re-read from the source log first; file
 * receipts are bound to the target agent, so original files are staged
 * against the child — never the source — after every image resolved.
 */
async function promptContent(
  services: RetryServices,
  controller: RetryController,
  entry: CommitEntry & { childId: string },
  signal: AbortSignal,
): Promise<readonly unknown[]> {
  const { observation, events } = await observe(services, entry.source, signal)
  let blocks: SessionEvent<'user/message'>['data']['content']
  try {
    const prompt = findPrompt(events, entry.messageId)
    if (!prompt || inputRevisionOf(prompt) !== entry.expectedInputRevision) {
      throw new RetryError('session/retry-input', 'the original prompt can no longer be read')
    }
    blocks = editedPromptBlocks(prompt.data.content, entry.text)
  } finally { observation[Symbol.dispose]() }
  const parts: unknown[] = []
  const files: { index: number; attachment: { attachmentId: string; name: string; bytes: number } }[] = []
  for (const block of blocks) {
    if (block.type === 'text') {
      parts.push(block)
    } else if (block.type === 'image') {
      if (typeof controller.attachment !== 'function') {
        throw new RetryError('session-manager/unavailable', 'this runtime cannot read the original image')
      }
      const value = await controller.attachment({
        sessionId: entry.source,
        attachmentId: block.attachment.attachmentId,
      })
      const image = value as { attachment?: { mediaType?: unknown; name?: unknown }; data?: unknown } | undefined
      if (typeof image?.attachment?.mediaType !== 'string' || typeof image.data !== 'string' || image.data === '') {
        throw new RetryError('session/retry-failed', 'the original image could not be read')
      }
      parts.push({
        type: 'image',
        mediaType: image.attachment.mediaType,
        data: image.data,
        ...typeof image.attachment.name === 'string' && image.attachment.name !== '' ? { name: image.attachment.name } : {},
      })
    } else if (block.type === 'file') {
      files.push({ index: parts.length, attachment: block.attachment })
      parts.push(undefined)
    }
  }
  for (const file of files) {
    if (services.fileUploads === undefined || services.attachments === undefined) {
      throw new RetryError('session-manager/unavailable', 'this runtime cannot copy the original file')
    }
    const staged = await services.fileUploads.uploadStream({
      sessionId: entry.childId,
      name: file.attachment.name,
      data: services.attachments.readFileStream(file.attachment, signal),
      signal,
    })
    const receiptId = (staged as { receiptId?: unknown })?.receiptId
    if (typeof receiptId !== 'string' || receiptId === '') {
      throw new RetryError('session/retry-failed', 'the original file could not be staged')
    }
    parts[file.index] = { type: 'file', receiptId }
  }
  return parts
}

/** The source's workspace and pin state, read from the controller's opening baseline. */
async function workspacePlacement(
  workspace: NonNullable<PresenceServices['workspaceController']>,
  sourceId: string,
  signal: AbortSignal,
): Promise<{ workspaceId?: string; pinned: boolean }> {
  if (typeof workspace.follow !== 'function') return { pinned: false }
  for await (const frame of workspace.follow(signal)) {
    if (frame?.type !== 'baseline') return { pinned: false }
    const items = Array.isArray(frame.value?.items) ? frame.value.items : []
    const owner = items.find(item => Array.isArray(item?.sessionIds) && item.sessionIds.includes(sourceId))
    const pinned = Array.isArray(frame.value?.pinnedSessionIds) && frame.value.pinnedSessionIds.includes(sourceId)
    return {
      ...typeof owner?.workspaceId === 'string' && owner.workspaceId !== '' ? { workspaceId: owner.workspaceId } : {},
      pinned,
    }
  }
  return { pinned: false }
}

/**
 * Make the fork look like the same chat: the sidebar slot just before the
 * source, the source's pin, then the source archived. Every step is
 * best-effort — the conversation itself is already correct without them.
 */
async function finalizeCommit(
  services: RetryServices,
  entry: CommitEntry & { childId: string },
  signal: AbortSignal,
): Promise<RetryCommitValue> {
  const workspace = services.workspaceController
  let archived = false
  if (workspace !== undefined) {
    let placement: { workspaceId?: string; pinned: boolean } = { pinned: false }
    try {
      placement = await workspacePlacement(workspace, entry.source, signal)
    } catch { /* sidebar placement is best-effort */ }
    if (placement.workspaceId !== undefined && typeof workspace.insertSessionBefore === 'function') {
      try {
        await workspace.insertSessionBefore({
          workspaceId: placement.workspaceId,
          sessionId: entry.childId,
          beforeSessionId: entry.source,
        })
      } catch { /* sidebar placement is best-effort */ }
    }
    if (placement.pinned && typeof workspace.pinSession === 'function') {
      try {
        await workspace.pinSession({ sessionId: entry.childId })
      } catch { /* pinning is best-effort */ }
    }
    if (typeof workspace.archiveSession === 'function') {
      try {
        await workspace.archiveSession({ sessionId: entry.source })
        archived = true
      } catch { /* archiving is best-effort */ }
    }
  }
  return { sessionId: entry.childId, sourceSessionId: entry.source, archived }
}

/** The controller methods a commit needs; guaranteed by the requireController guard. */
type RetryController = NonNullable<PresenceServices['sessionController']> & {
  fork(request: { sessionId: string; atSeq?: number }): Promise<{ sessionId?: string }>
  prompt(request: {
    requestId: string
    sessionId: string
    mode: 'queue' | 'steer'
    content: readonly unknown[]
  }, signal?: AbortSignal): Promise<unknown>
}

function requireController(services: RetryServices): RetryController {
  const controller = services.sessionController
  if (controller === undefined
    || typeof controller.fork !== 'function'
    || typeof controller.prompt !== 'function') {
    throw new RetryError('session-manager/unavailable', 'this runtime cannot fork a session')
  }
  return controller as RetryController
}

/**
 * Resume recorded stages. A failed save retains the live child identity;
 * after restart, an intent with no child fails closed because fork has no
 * request-id contract. No stage proceeds until its prerequisite is durable.
 */
async function runCommit(services: RetryServices, journal: RetryJournal, entry: CommitEntry, signal: AbortSignal): Promise<RetryCommitValue> {
  try {
    const controller = requireController(services)
    if (entry.childId === undefined) {
      if (entry.forkStarted) {
        throw new RetryError('session/retry-uncertain', 'the previous fork outcome is unknown; inspect the session list')
      }
      entry.forkStarted = true
      await journal.put(entry)
      const forked = await controller.fork({ sessionId: entry.source, atSeq: entry.forkSeq })
      const childId = (forked as { sessionId?: unknown } | null | undefined)?.sessionId
      if (typeof childId !== 'string' || childId === '') {
        throw new RetryError('session/retry-failed', 'the fork returned no session')
      }
      entry.childId = childId
    }
    await journal.put(entry)
    const forkedEntry = entry as CommitEntry & { childId: string }
    if (forkedEntry.title !== undefined && forkedEntry.renamed !== true
      && typeof controller.rename === 'function') {
      await controller.rename({ sessionId: forkedEntry.childId, title: forkedEntry.title })
      forkedEntry.renamed = true
      await journal.put(entry)
    }
    if (forkedEntry.prompted !== true) {
      const content = await promptContent(services, controller, forkedEntry, signal)
      await controller.prompt({
        requestId: forkedEntry.requestId,
        sessionId: forkedEntry.childId,
        mode: 'queue',
        content,
      }, signal)
      forkedEntry.prompted = true
      await journal.put(entry)
    }
    forkedEntry.result = await finalizeCommit(services, forkedEntry, signal)
    await journal.put(entry)
    return forkedEntry.result
  } catch (error) {
    if (entry.forkStarted && !entry.childId && journal.get(entry.requestId)) {
      throw new RetryError('session/retry-uncertain', 'the previous fork outcome is unknown; inspect the session list')
    }
    if (entry.childId) {
      // The browser must keep this request even for a structured host error:
      // changing its id would abandon a partially committed operation.
      throw new RetryError('session/retry-pending', 'resend is incomplete; retry the same request')
    }
    throw commitFailure(error, signal)
  }
}

/** Host RemoteError codes worth surfacing verbatim; anything else is a generic commit failure. */
function commitFailure(error: unknown, signal: AbortSignal): unknown {
  if (error instanceof RetryError || error instanceof RetryJournalError || error instanceof PresenceError) return error
  if (signal.aborted) return error
  if (error instanceof Error && error.name === 'AbortError') return error
  const code = (error as { code?: unknown })?.code
  if (code === 'session/not-found') return new RetryError('session-manager/not-found', 'the session is not available')
  if (code === 'session/agent-busy' || code === 'session/writer-held') {
    return new RetryError('session-manager/busy', 'the session is busy')
  }
  if (code === 'session/fork-unavailable' || code === 'session/migration-required') {
    return new RetryError('session/retry-blocked', 'the session cannot be forked here')
  }
  return new RetryError('session/retry-failed', 'the retry commit failed')
}

export async function commitRetry(
  services: RetryServices,
  request: RetryCommitRequest,
  signal: AbortSignal,
): Promise<RetryCommitValue> {
  const sessionId = requireSessionId(request?.sessionId)
  if (typeof request.messageId !== 'string' || request.messageId === '') {
    throw new RetryError('session-manager/invalid-request', 'messageId must be a non-empty string')
  }
  if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) {
    throw new RetryError('session-manager/invalid-request', 'expectedRevision must be a non-negative integer')
  }
  if (typeof request.expectedInputRevision !== 'string') {
    throw new RetryError('session-manager/invalid-request', 'expectedInputRevision must be a string')
  }
  if (!UUID.test(request.requestId)) {
    throw new RetryError('session-manager/invalid-request', 'requestId must be a UUID')
  }
  if (request.content !== undefined) {
    throw new RetryError('session/retry-input', 'content replacement is not supported; edit the text only')
  }
  if (request.text !== undefined && typeof request.text !== 'string') {
    throw new RetryError('session-manager/invalid-request', 'text must be a string')
  }
  if (request.allowModified !== true) {
    throw new RetryError('session/retry-input', 'resend requires explicit confirmation')
  }
  requireController(services)
  const journal = services.retryJournal
  if (!journal) throw new RetryError('session-manager/unavailable', 'durable retry storage is unavailable')
  return journal.run(sessionId, request.requestId, async () => {
    const existing = journal.get(request.requestId)
    if (existing !== undefined) {
      assertSameRequest(existing, request)
      if (existing.result !== undefined) {
        try { await journal.put(existing) }
        catch { throw new RetryError('session/retry-pending', 'resend completed but its receipt could not be saved') }
        return existing.result
      }
    }
    const entry = existing ?? await validateCommit(services, request, sessionId, signal)
    return runCommit(services, journal, entry, signal)
  })
}
