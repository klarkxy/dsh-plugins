/**
 * Narrow client faces the host owner still has to publish.
 * Call these only when the live service actually has the method.
 * Do not call the session remote directly: manager.create still drops `kind`,
 * and delete/retry have to update the catalog and the open selection.
 */
import type { OperationFailure } from './ui-copy.ts'
import type { SessionListSnapshot } from './free-list.ts'
import type { PromptContent } from './edit-host.ts'

export interface SessionCapabilities {
  readonly retry: boolean
  /** Whether retry accepts explicit confirmation of later modifications. */
  readonly retryModified: boolean
  readonly retryContent?: boolean
  readonly freeSession: boolean
  readonly deleteSession: boolean
}

export const UNSUPPORTED_CAPABILITIES: SessionCapabilities = {
  retry: false,
  retryModified: false,
  freeSession: false,
  deleteSession: false,
}

/**
 * `inputRevision` is an opaque token from preview.
 * An eligible preview without it is not a supported retry.
 */
export interface RetryPreview {
  readonly branchRevision: number
  readonly inputRevision: string
  readonly eligible: boolean
  readonly reason?: string
}

/** Base request shape of the host's retry API; an edit adds `text` or `content`. */
export interface DirectRetryRequest {
  readonly sessionId: string
  readonly messageId: string
  readonly expectedRevision: number
  readonly expectedInputRevision: string
  readonly requestId: string
  /** Explicit user confirmation keeps later file and external changes intact. */
  readonly allowModified?: boolean
}

/** Edit sends plain text only. The host keeps attachments. */
export interface EditRetryRequest extends DirectRetryRequest {
  readonly text?: string
  readonly content?: readonly PromptContent[]
}

export interface DeleteOutcome {
  readonly phase: 'deleted' | 'cleanup-pending'
}

export interface ObservableList {
  getSnapshot(): SessionListSnapshot
  subscribe(listener: () => void): () => void
}

export interface SessionHost {
  readonly list: ObservableList
  capabilities?: () => Promise<unknown> | unknown
  create?: (opts: { kind: 'free' }) => Promise<unknown>
  previewRetry?: (request: { sessionId: string; messageId: string }) => Promise<unknown>
  retry?: (request: DirectRetryRequest | EditRetryRequest) => Promise<unknown>
  openSession?: (sessionId: string) => void
  deleteSession?: (sessionId: string, requestId: string) => Promise<unknown>
}

interface RemoteFailure {
  readonly code?: string
  readonly message?: string
  readonly details?: { readonly reason?: string }
}

interface RemoteResult {
  readonly ok: boolean
  readonly value?: unknown
  readonly error?: RemoteFailure
}

export function isRecoverable(failure: OperationFailure): boolean {
  return failure.code === 'transport' || failure.code === 'session/delete-pending'
    || failure.code === 'session/retry-pending' || failure.code === 'session/retry-uncertain'
}

export function isStaleRetryFailure(failure: OperationFailure | undefined): boolean {
  return failure?.code === 'session/retry-revision'
    || failure?.code === 'session/branch-moved'
    || failure?.code === 'session/retry-input'
    || failure?.code === 'session/retry-conflict'
}

export function readFailure(error: unknown): OperationFailure {
  if (isFailure(error)) return { code: error.code, ...error.reason === undefined ? {} : { reason: error.reason } }
  if (typeof error === 'object' && error !== null) {
    const record = error as { code?: unknown; reason?: unknown; message?: unknown; rpcError?: RemoteFailure }
    const rpc = record.rpcError
    if (typeof rpc?.code === 'string') {
      return { code: rpc.code, ...reasonOf(rpc) === undefined ? {} : { reason: reasonOf(rpc) } }
    }
    if (typeof record.code === 'string') {
      const reason = typeof record.reason === 'string' ? record.reason : undefined
      return { code: record.code, ...reason === undefined ? {} : { reason } }
    }
  }
  return { code: 'transport', reason: 'unknown' }
}

function isFailure(error: unknown): error is OperationFailure {
  return typeof error === 'object' && error !== null && 'code' in error && typeof (error as { code: unknown }).code === 'string'
    && (error as { name?: string }).name === 'HostOperationError'
}

export class HostOperationError extends Error implements OperationFailure {
  override readonly name = 'HostOperationError'
  readonly reason?: string
  constructor(readonly code: string, reason?: string) {
    super(code)
    if (reason !== undefined) this.reason = reason
  }
}

function reasonOf(error: RemoteFailure | undefined): string | undefined {
  return typeof error?.details?.reason === 'string' ? error.details.reason : undefined
}

function isRemoteResult(value: unknown): value is RemoteResult {
  if (typeof value !== 'object' || value === null || !('ok' in value)) return false
  const ok = (value as { ok: unknown }).ok
  return typeof ok === 'boolean' && ('value' in value || 'error' in value)
}

export async function unwrap(value: unknown): Promise<unknown> {
  const resolved = await value
  if (!isRemoteResult(resolved)) return resolved
  if (!resolved.ok) {
    throw new HostOperationError(resolved.error?.code ?? 'transport', reasonOf(resolved.error))
  }
  return resolved.value
}

export async function readCapabilities(host: SessionHost): Promise<SessionCapabilities> {
  if (typeof host.capabilities !== 'function') return UNSUPPORTED_CAPABILITIES
  try {
    const value = await unwrap(host.capabilities())
    if (typeof value !== 'object' || value === null) return UNSUPPORTED_CAPABILITIES
    const record = value as Partial<SessionCapabilities>
    return {
      retry: record.retry === true,
      retryModified: record.retryModified === true,
      ...record.retryContent === true ? { retryContent: true } : {},
      freeSession: record.freeSession === true,
      deleteSession: record.deleteSession === true,
    }
  } catch {
    return UNSUPPORTED_CAPABILITIES
  }
}

export function controlsFor(capabilities: SessionCapabilities, ready: boolean, host: SessionHost): {
  create: boolean
  delete: boolean
  retry: boolean
} {
  return {
    create: ready && capabilities.freeSession && typeof host.create === 'function',
    delete: ready && capabilities.deleteSession && typeof host.deleteSession === 'function',
    retry: ready && capabilities.retry && typeof host.previewRetry === 'function' && typeof host.retry === 'function',
  }
}

function sessionIdOf(value: unknown): string {
  if (typeof value === 'string' && value !== '') return value
  if (typeof value === 'object' && value !== null && typeof (value as { sessionId?: unknown }).sessionId === 'string') {
    return (value as { sessionId: string }).sessionId
  }
  throw new HostOperationError('session/lifecycle-unavailable')
}

/** Pass only `{ kind: 'free' }`. A cwd or workspace is rejected by free create, and must not be invented. */
export async function createFreeSession(host: SessionHost): Promise<string> {
  if (typeof host.create !== 'function') throw new HostOperationError('session/lifecycle-unavailable')
  return sessionIdOf(await unwrap(host.create({ kind: 'free' })))
}

export async function deleteOwnedSession(host: SessionHost, sessionId: string, requestId: string): Promise<DeleteOutcome> {
  if (typeof host.deleteSession !== 'function') throw new HostOperationError('session/lifecycle-unavailable')
  const value = await unwrap(host.deleteSession(sessionId, requestId))
  if (typeof value !== 'object' || value === null) throw new HostOperationError('session/delete-pending', 'missing-outcome')
  const phase = (value as { phase?: unknown }).phase
  if (phase !== 'deleted' && phase !== 'cleanup-pending') {
    throw new HostOperationError('session/delete-pending', 'missing-outcome')
  }
  return { phase }
}

/** Build the body for one edited prompt; the host keeps the original attachments when only text changes. */
export function editRetryRequest(input: {
  sessionId: string
  messageId: string
  expectedRevision: number
  expectedInputRevision: string
  requestId: string
  text: string
  content?: readonly PromptContent[]
  allowModified?: boolean
}): EditRetryRequest {
  return {
    sessionId: input.sessionId,
    messageId: input.messageId,
    expectedRevision: input.expectedRevision,
    expectedInputRevision: input.expectedInputRevision,
    requestId: input.requestId,
    ...input.content === undefined ? { text: input.text } : { content: input.content },
    ...input.allowModified === true ? { allowModified: true } : {},
  }
}

export class SubmissionLedger {
  private active = false
  private unresolved: EditRetryRequest | undefined

  get busy(): boolean {
    return this.active
  }

  pending(): EditRetryRequest | undefined {
    return this.unresolved
  }

  /** Resend the stored body. A non-recoverable result drops it; a lost reply keeps it. */
  async replay(execute: (body: EditRetryRequest) => Promise<unknown>): Promise<void> {
    const body = this.unresolved
    if (body === undefined) return
    if (this.active) throw new HostOperationError('busy', 'running')
    this.active = true
    try {
      await execute(body)
      this.unresolved = undefined
    } catch (error) {
      const failure = readFailure(error)
      if (!isRecoverable(failure) && failure.reason !== 'aborted') this.unresolved = undefined
      throw error instanceof HostOperationError ? error : new HostOperationError(failure.code, failure.reason)
    } finally {
      this.active = false
    }
  }

  /** First submission of a body built from the current preview. */
  async submit(body: EditRetryRequest, execute: () => Promise<unknown>): Promise<void> {
    if (this.active || this.unresolved !== undefined) throw new HostOperationError('busy', 'running')
    this.active = true
    try {
      await execute()
      this.unresolved = undefined
    } catch (error) {
      const failure = readFailure(error)
      this.unresolved = isRecoverable(failure) ? body : undefined
      throw error instanceof HostOperationError ? error : new HostOperationError(failure.code, failure.reason)
    } finally {
      this.active = false
    }
  }
}

interface Listener {
  (): void
}

function store() {
  const listeners = new Set<Listener>()
  return {
    subscribe(listener: Listener): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    emit(): void {
      for (const listener of listeners) listener()
    },
  }
}

export interface DeleteRequestState {
  readonly sessionId: string
  readonly title: string
  readonly classification: 'free' | 'ordinary'
  readonly requestId: string
  readonly busy: boolean
  readonly failure?: OperationFailure
}

export interface FreeChatSnapshot {
  readonly controls: ReturnType<typeof controlsFor>
  readonly capabilitiesReady: boolean
  readonly creating: boolean
  readonly notice?: OperationFailure
  readonly deleteRequest?: DeleteRequestState
}

export interface FreeChatModel {
  subscribe(listener: Listener): () => void
  getSnapshot(): FreeChatSnapshot
  reloadCapabilities(): Promise<void>
  create(): Promise<void>
  dismissNotice(): void
  requestDelete(sessionId: string): void
  cancelDelete(): void
  confirmDelete(): Promise<void>
  cancel(): void
}

export function createFreeChatModel(host: SessionHost, ids: () => string = () => crypto.randomUUID()): FreeChatModel {
  const events = store()
  let capabilities = UNSUPPORTED_CAPABILITIES
  let capabilitiesReady = false
  let creating = false
  let notice: OperationFailure | undefined
  let deleteRequest: DeleteRequestState | undefined
  let generation = 0
  let snapshot: FreeChatSnapshot = build()

  function build(): FreeChatSnapshot {
    return {
      controls: controlsFor(capabilities, capabilitiesReady, host),
      capabilitiesReady,
      creating,
      ...notice === undefined ? {} : { notice },
      ...deleteRequest === undefined ? {} : { deleteRequest },
    }
  }

  function publish(): void {
    snapshot = build()
    events.emit()
  }

  return {
    subscribe: events.subscribe,
    getSnapshot: () => snapshot,
    async reloadCapabilities() {
      capabilities = await readCapabilities(host)
      capabilitiesReady = true
      publish()
    },
    async create() {
      if (!controlsFor(capabilities, capabilitiesReady, host).create || creating) return
      const ticket = generation
      creating = true
      notice = undefined
      publish()
      try {
        const id = await createFreeSession(host)
        if (ticket !== generation) return
        if (typeof host.openSession !== 'function') throw new HostOperationError('session/lifecycle-unavailable', 'open-session')
        host.openSession(id)
      } catch (error) {
        if (ticket !== generation) return
        notice = readFailure(error)
      } finally {
        if (ticket === generation) {
          creating = false
          publish()
        }
      }
    },
    dismissNotice() {
      if (notice === undefined) return
      notice = undefined
      publish()
    },
    requestDelete(sessionId) {
      if (!controlsFor(capabilities, capabilitiesReady, host).delete) return
      const row = host.list.getSnapshot().byId[sessionId]
      deleteRequest = {
        sessionId,
        title: row?.displayTitle ?? row?.title ?? sessionId,
        classification: row?.classification === 'free' ? 'free' : 'ordinary',
        requestId: ids(),
        busy: false,
      }
      publish()
    },
    cancelDelete() {
      if (deleteRequest?.busy) return
      deleteRequest = undefined
      publish()
    },
    async confirmDelete() {
      const current = deleteRequest
      if (current === undefined || current.busy) return
      const ticket = generation
      deleteRequest = { ...current, busy: true, failure: undefined }
      publish()
      try {
        const outcome = await deleteOwnedSession(host, current.sessionId, current.requestId)
        if (ticket !== generation) return
        if (outcome.phase !== 'deleted') {
          deleteRequest = {
            ...current,
            busy: false,
            failure: { code: 'session/delete-pending', reason: 'pending' },
          }
          publish()
          return
        }
        // The host clears the open selection itself; there is no panel to jump to.
        deleteRequest = undefined
      } catch (error) {
        if (ticket !== generation) return
        const failure = readFailure(error)
        deleteRequest = { ...current, busy: false, failure }
      }
      if (ticket === generation) publish()
    },
    cancel() {
      generation += 1
      creating = false
      notice = undefined
      deleteRequest = undefined
      publish()
    },
  }
}

export interface RetrySnapshot {
  readonly controlsRetry: boolean
  readonly controlsContent?: boolean
  readonly busy: boolean
  readonly editing: boolean
  /** The current preview found later modifications that the user must acknowledge. */
  readonly modified: boolean
  readonly draft: string
  readonly sessionId: string
  readonly messageId: string
  readonly failure?: OperationFailure
}

export interface RetryModel {
  subscribe(listener: Listener): () => void
  getSnapshot(): RetrySnapshot
  load(): Promise<void>
  beginEdit(sessionId: string, messageId: string, text: string, signal: AbortSignal): Promise<void>
  setDraft(text: string): void
  cancelEdit(): void
  sendEdit(sessionId: string, messageId: string, signal: AbortSignal, content?: readonly PromptContent[], confirmed?: boolean): Promise<void>
  retire(sessionId: string, messageId: string): void
  cancel(): void
}

export function createRetryModel(host: SessionHost, ids: () => string = () => crypto.randomUUID()): RetryModel {
  const events = store()
  const ledger = new SubmissionLedger()
  let capabilities = UNSUPPORTED_CAPABILITIES
  let ready = false
  let busy = false
  let editing = false
  let modified = false
  let editNeedsPreview = false
  let draft = ''
  let failure: OperationFailure | undefined
  let expectedRevision = 0
  let expectedInputRevision = ''
  let ownerSession = ''
  let ownerMessage = ''
  let call = 0
  let snapshot: RetrySnapshot = build()

  function build(): RetrySnapshot {
    return {
      controlsRetry: controlsFor(capabilities, ready, host).retry,
      controlsContent: ready && capabilities.retryContent === true,
      busy,
      editing,
      modified,
      draft,
      sessionId: ownerSession,
      messageId: ownerMessage,
      ...failure === undefined ? {} : { failure },
    }
  }

  function publish(): void {
    snapshot = build()
    events.emit()
  }

  function readPreview(value: unknown): RetryPreview {
    if (typeof value !== 'object' || value === null || typeof (value as { branchRevision?: unknown }).branchRevision !== 'number') {
      throw new HostOperationError('session/lifecycle-unavailable')
    }
    const record = value as { branchRevision: number; eligible?: boolean; reason?: string; inputRevision?: unknown }
    const inputRevision = typeof record.inputRevision === 'string' ? record.inputRevision : ''
    const eligible = record.eligible === true
    if ((eligible || record.reason === 'modified') && inputRevision === '') {
      throw new HostOperationError('session/lifecycle-unavailable', 'input-revision')
    }
    return {
      branchRevision: record.branchRevision,
      inputRevision,
      eligible,
      ...typeof record.reason === 'string' ? { reason: record.reason } : {},
    }
  }

  async function preview(sessionId: string, id: string, signal: AbortSignal, ticket: number): Promise<RetryPreview | undefined> {
    if (ticket !== call || signal.aborted) return undefined
    if (typeof host.previewRetry !== 'function') throw new HostOperationError('session/lifecycle-unavailable')
    const value = await unwrap(host.previewRetry({ sessionId, messageId: id }))
    if (ticket !== call || signal.aborted) return undefined
    return readPreview(value)
  }

  async function callRetry(body: EditRetryRequest, signal: AbortSignal, ticket: number): Promise<void> {
    if (signal.aborted || ticket !== call) throw new HostOperationError('busy', 'aborted')
    if (typeof host.retry !== 'function') throw new HostOperationError('session/lifecycle-unavailable')
    await unwrap(host.retry(body))
  }

  function settle(): void {
    if (!ledger.busy) busy = false
    publish()
  }

  async function replaySame(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return
    const pending = ledger.pending()
    const ticket = ++call
    busy = true
    failure = undefined
    publish()
    try {
      await ledger.replay(async body => { await callRetry(body, signal, ticket) })
      if (
        pending !== undefined
        && ticket === call
        && !signal.aborted
        && ownerSession === pending.sessionId
        && ownerMessage === pending.messageId
      ) {
        editing = false
        modified = false
        editNeedsPreview = false
      }
    } catch (error) {
      if (ticket === call && !signal.aborted) failure = readFailure(error)
    } finally {
      settle()
    }
  }

  function samePending(sessionId: string, id: string): boolean {
    const pending = ledger.pending()
    return pending !== undefined && pending.sessionId === sessionId && pending.messageId === id
  }

  return {
    subscribe: events.subscribe,
    getSnapshot: () => snapshot,
    async load() {
      capabilities = await readCapabilities(host)
      ready = true
      publish()
    },
    async beginEdit(sessionId, id, text, signal) {
      if (busy || !controlsFor(capabilities, ready, host).retry || signal.aborted) return
      if (editing && (ownerSession !== sessionId || ownerMessage !== id)) return
      if (ledger.pending() !== undefined) {
        if (!samePending(sessionId, id)) return
        await replaySame(signal)
        return
      }
      const ticket = ++call
      busy = true
      failure = undefined
      modified = false
      editNeedsPreview = false
      ownerSession = sessionId
      ownerMessage = id
      publish()
      try {
        const seen = await preview(sessionId, id, signal, ticket)
        if (seen === undefined) return
        if (signal.aborted || ticket !== call) return
        expectedRevision = seen.branchRevision
        expectedInputRevision = seen.inputRevision
        if (!seen.eligible && (seen.reason !== 'modified' || !capabilities.retryModified)) {
          failure = { code: 'session/retry-blocked', reason: seen.reason ?? 'unknown' }
          return
        }
        modified = !seen.eligible
        draft = text
        editing = true
      } catch (error) {
        if (ticket === call && !signal.aborted) failure = readFailure(error)
      } finally {
        settle()
      }
    },
    setDraft(text) {
      if (!editing || ownerSession === '' || ownerMessage === '') return
      draft = text
      publish()
    },
    cancelEdit() {
      if (busy) return
      editing = false
      modified = false
      editNeedsPreview = false
      publish()
    },
    async sendEdit(sessionId, id, signal, content, confirmed) {
      if (signal.aborted || busy || !controlsFor(capabilities, ready, host).retry) return
      if (!editing || ownerSession !== sessionId || ownerMessage !== id) return
      if (ledger.pending() !== undefined) {
        if (!samePending(sessionId, id)) return
        await replaySame(signal)
        return
      }
      const ticket = ++call
      busy = true
      const refresh = editNeedsPreview || isStaleRetryFailure(failure)
      failure = undefined
      const text = draft
      publish()
      try {
        if (signal.aborted || ticket !== call) return
        if (refresh) {
          // Revalidate both tokens after a conflict; ordinary first sends keep
          // the beginEdit preview, and lost replies still replay exactly above.
          editNeedsPreview = true
          const seen = await preview(sessionId, id, signal, ticket)
          if (seen === undefined) return
          expectedRevision = seen.branchRevision
          expectedInputRevision = seen.inputRevision
          if (!seen.eligible && (seen.reason !== 'modified' || !capabilities.retryModified)) {
            failure = { code: 'session/retry-blocked', reason: seen.reason ?? 'unknown' }
            return
          }
          modified = !seen.eligible
          editNeedsPreview = false
        }
        if (content !== undefined && capabilities.retryContent !== true) throw new HostOperationError('session/lifecycle-unavailable')
        const body = editRetryRequest({
          sessionId,
          messageId: id,
          expectedRevision,
          expectedInputRevision,
          requestId: ids(),
          text,
          ...content === undefined ? {} : { content },
          allowModified: confirmed === true,
        })
        await ledger.submit(body, () => callRetry(body, signal, ticket))
        if (ticket === call && !signal.aborted) {
          editing = false
          modified = false
          editNeedsPreview = false
        }
      } catch (error) {
        const nextFailure = readFailure(error)
        if (isStaleRetryFailure(nextFailure)) editNeedsPreview = true
        if (ticket === call && !signal.aborted) failure = nextFailure
      } finally {
        settle()
      }
    },
    retire(sessionId, messageId) {
      if (ownerSession !== sessionId || ownerMessage !== messageId) return
      call += 1
      editing = false
      modified = false
      editNeedsPreview = false
      failure = undefined
      draft = ''
      if (!ledger.busy) busy = false
      publish()
    },
    cancel() {
      call += 1
      editing = false
      modified = false
      editNeedsPreview = false
      failure = undefined
      if (!ledger.busy) busy = false
      publish()
    },
  }
}

export function bindHost(ctx: {
  sessions?: {
    list?: ObservableList
    capabilities?: SessionHost['capabilities']
    create?: (opts?: { workspaceId?: string; cwd?: string; sessionId?: string }) => Promise<unknown>
    previewRetry?: SessionHost['previewRetry']
    retry?: SessionHost['retry']
  }
  uiWorkspace?: {
    openSession?: SessionHost['openSession']
    deleteSession?: SessionHost['deleteSession']
  }
}): SessionHost {
  const sessions = ctx.sessions
  const workspace = ctx.uiWorkspace
  const empty: ObservableList = {
    getSnapshot: () => ({ ids: [], byId: {}, phase: 'ready' }),
    subscribe: () => () => {},
  }
  return {
    list: sessions?.list ?? empty,
    ...typeof sessions?.capabilities === 'function' ? { capabilities: () => sessions.capabilities!() } : {},
    ...typeof sessions?.create === 'function'
      ? { create: (opts: { kind: 'free' }) => (sessions.create as (input: { kind: 'free' }) => Promise<unknown>)(opts) }
      : {},
    ...typeof sessions?.previewRetry === 'function' ? { previewRetry: request => sessions.previewRetry!(request) } : {},
    ...typeof sessions?.retry === 'function' ? { retry: request => sessions.retry!(request) } : {},
    ...typeof workspace?.openSession === 'function' ? { openSession: sessionId => workspace.openSession!(sessionId) } : {},
    ...typeof workspace?.deleteSession === 'function' ? { deleteSession: (sessionId, requestId) => workspace.deleteSession!(sessionId, requestId) } : {},
  }
}
