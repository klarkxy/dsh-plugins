/**
 * Narrow client faces the host owner still has to publish.
 * Call these only when the live service actually has the method.
 * Do not call the session remote directly: manager.create still drops `kind`,
 * and delete/retry have to update the catalog and the open selection.
 */
import type { OperationFailure } from './ui-copy.ts'
import { freeChatRows, matchFreeRows, type ListedSession, type SessionListSnapshot } from './free-list.ts'
import { FREE_PANEL_ID } from './contracts.ts'

export interface SessionCapabilities {
  readonly retry: boolean
  readonly freeSession: boolean
  readonly deleteSession: boolean
}

export const UNSUPPORTED_CAPABILITIES: SessionCapabilities = {
  retry: false,
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

/** Direct retry omits `text` so the host keeps the original attachments. */
export interface DirectRetryRequest {
  readonly sessionId: string
  readonly messageId: string
  readonly expectedRevision: number
  readonly expectedInputRevision: string
  readonly requestId: string
}

/** Edit sends plain text only. The host keeps attachments. */
export interface EditRetryRequest extends DirectRetryRequest {
  readonly text: string
}

export interface DeleteOutcome {
  readonly phase: 'deleted' | 'cleanup-pending'
  readonly releasedSelection: boolean
}

export interface ObservableList {
  getSnapshot(): SessionListSnapshot
  subscribe(listener: () => void): () => void
}

export interface SessionHost {
  readonly list: ObservableList
  capabilities?: () => Promise<unknown> | unknown
  create?: (opts: { kind: 'free' }) => Promise<unknown>
  fork?: (opts: { sessionId: string; increaseTitle?: boolean }) => Promise<unknown>
  refresh?: () => Promise<unknown>
  previewRetry?: (request: { sessionId: string; messageId: string }) => Promise<unknown>
  retry?: (request: DirectRetryRequest | EditRetryRequest) => Promise<unknown>
  openSession?: (sessionId: string) => void
  forkSession?: (sessionId: string) => Promise<unknown>
  deleteSession?: (sessionId: string, requestId: string) => Promise<unknown>
  selectPanel?: (id: string) => void
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
      freeSession: record.freeSession === true,
      deleteSession: record.deleteSession === true,
    }
  } catch {
    return UNSUPPORTED_CAPABILITIES
  }
}

export function controlsFor(capabilities: SessionCapabilities, ready: boolean, host: SessionHost): {
  create: boolean
  fork: boolean
  delete: boolean
  retry: boolean
} {
  return {
    create: ready && capabilities.freeSession && typeof host.create === 'function',
    fork: ready && capabilities.freeSession && (typeof host.forkSession === 'function' || typeof host.fork === 'function'),
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

/** Returns the child id. The caller opens it only while its generation is still current. */
export async function forkOwnedChild(host: SessionHost, sessionId: string): Promise<string> {
  if (typeof host.forkSession === 'function') return sessionIdOf(await unwrap(host.forkSession(sessionId)))
  if (typeof host.fork === 'function') return sessionIdOf(await unwrap(host.fork({ sessionId, increaseTitle: true })))
  throw new HostOperationError('session/fork-unavailable')
}

export async function deleteOwnedSession(host: SessionHost, sessionId: string, requestId: string): Promise<DeleteOutcome> {
  if (typeof host.deleteSession !== 'function') throw new HostOperationError('session/lifecycle-unavailable')
  const value = await unwrap(host.deleteSession(sessionId, requestId))
  if (typeof value !== 'object' || value === null) throw new HostOperationError('session/delete-pending', 'missing-outcome')
  const phase = (value as { phase?: unknown }).phase
  if (phase !== 'deleted' && phase !== 'cleanup-pending') {
    throw new HostOperationError('session/delete-pending', 'missing-outcome')
  }
  return { phase, releasedSelection: (value as { releasedSelection?: unknown }).releasedSelection === true }
}

export function directRetryRequest(input: {
  sessionId: string
  messageId: string
  expectedRevision: number
  expectedInputRevision: string
  requestId: string
}): DirectRetryRequest {
  return {
    sessionId: input.sessionId,
    messageId: input.messageId,
    expectedRevision: input.expectedRevision,
    expectedInputRevision: input.expectedInputRevision,
    requestId: input.requestId,
  }
}

export function editRetryRequest(input: DirectRetryRequest & { text: string }): EditRetryRequest {
  return { ...directRetryRequest(input), text: input.text }
}

export class SubmissionLedger {
  private active = false
  private unresolved: DirectRetryRequest | EditRetryRequest | undefined

  get busy(): boolean {
    return this.active
  }

  pending(): DirectRetryRequest | EditRetryRequest | undefined {
    return this.unresolved
  }

  /** Resend the stored body. A non-recoverable result drops it; a lost reply keeps it. */
  async replay(execute: (body: DirectRetryRequest | EditRetryRequest) => Promise<unknown>): Promise<void> {
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
  async submit(body: DirectRetryRequest | EditRetryRequest, execute: () => Promise<unknown>): Promise<void> {
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
  readonly rows: readonly ListedSession[]
  readonly listStatus: 'loading' | 'empty' | 'nomatch' | 'ready' | 'error'
  readonly listFailure?: OperationFailure
  readonly query: string
  readonly controls: ReturnType<typeof controlsFor>
  readonly capabilitiesReady: boolean
  readonly creating: boolean
  readonly notice?: OperationFailure
  readonly deleteRequest?: DeleteRequestState
  readonly focusNonce: number
}

export interface FreeChatModel {
  subscribe(listener: Listener): () => void
  getSnapshot(): FreeChatSnapshot
  reloadCapabilities(): Promise<void>
  setQuery(query: string): void
  refreshList(): Promise<void>
  create(): Promise<void>
  open(sessionId: string): void
  fork(sessionId: string): Promise<void>
  requestDelete(sessionId: string): void
  cancelDelete(): void
  confirmDelete(): Promise<void>
  cancel(): void
}

export function createFreeChatModel(host: SessionHost, ids: () => string = () => crypto.randomUUID()): FreeChatModel {
  const events = store()
  let capabilities = UNSUPPORTED_CAPABILITIES
  let capabilitiesReady = false
  let query = ''
  let creating = false
  let notice: OperationFailure | undefined
  let deleteRequest: DeleteRequestState | undefined
  let focusNonce = 0
  let listFailure: OperationFailure | undefined
  let generation = 0
  let snapshot: FreeChatSnapshot = build()
  const stopList = host.list.subscribe(() => publish())

  function listError(listed: SessionListSnapshot): OperationFailure {
    const code = typeof listed.error?.code === 'string' && listed.error.code !== '' ? listed.error.code : 'transport'
    const message = listed.error?.message
    return { code, ...typeof message === 'string' && message !== '' ? { reason: message } : {} }
  }

  function build(): FreeChatSnapshot {
    let status: FreeChatSnapshot['listStatus'] = 'ready'
    let rows: ListedSession[] = []
    try {
      const listed = host.list.getSnapshot()
      if (listed.phase === 'error') {
        status = 'error'
        listFailure = listError(listed)
        rows = []
      } else {
        listFailure = undefined
        const matched = matchFreeRows(freeChatRows(listed), query)
        if (listed.phase === 'pending' && matched.length === 0) status = 'loading'
        else if (listed.phase === 'ready' && matched.length === 0 && query.trim() === '') status = 'empty'
        else if (matched.length === 0) status = 'nomatch'
        else status = 'ready'
        rows = matched
      }
    } catch (error) {
      status = 'error'
      listFailure = readFailure(error)
      rows = []
    }
    return {
      rows,
      listStatus: status,
      ...listFailure === undefined ? {} : { listFailure },
      query,
      controls: controlsFor(capabilities, capabilitiesReady, host),
      capabilitiesReady,
      creating,
      ...notice === undefined ? {} : { notice },
      ...deleteRequest === undefined ? {} : { deleteRequest },
      focusNonce,
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
    setQuery(next) {
      query = next
      publish()
    },
    async refreshList() {
      if (typeof host.refresh !== 'function') return
      await unwrap(host.refresh())
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
    open(sessionId) {
      host.openSession?.(sessionId)
    },
    async fork(sessionId) {
      const ticket = generation
      notice = undefined
      try {
        const child = await forkOwnedChild(host, sessionId)
        if (ticket !== generation) return
        if (typeof host.openSession !== 'function') throw new HostOperationError('session/lifecycle-unavailable', 'open-session')
        host.openSession(child)
      } catch (error) {
        if (ticket !== generation) return
        notice = readFailure(error)
      }
      if (ticket === generation) publish()
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
        deleteRequest = undefined
        if (outcome.releasedSelection) {
          host.selectPanel?.(FREE_PANEL_ID)
          focusNonce += 1
        }
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
      stopList()
      publish()
    },
  }
}

export interface RetrySnapshot {
  readonly controlsRetry: boolean
  readonly busy: boolean
  readonly editing: boolean
  readonly draft: string
  readonly sessionId: string
  readonly messageId: string
  readonly failure?: OperationFailure
}

export interface RetryModel {
  subscribe(listener: Listener): () => void
  getSnapshot(): RetrySnapshot
  load(): Promise<void>
  retry(sessionId: string, messageId: string, signal: AbortSignal): Promise<void>
  beginEdit(sessionId: string, messageId: string, text: string, signal: AbortSignal): Promise<void>
  setDraft(text: string): void
  cancelEdit(): void
  sendEdit(sessionId: string, messageId: string, signal: AbortSignal): Promise<void>
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
      busy,
      editing,
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
    if (eligible && inputRevision === '') throw new HostOperationError('session/lifecycle-unavailable', 'input-revision')
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

  async function callRetry(body: DirectRetryRequest | EditRetryRequest, signal: AbortSignal, ticket: number): Promise<void> {
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
      ) editing = false
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
    async retry(sessionId, id, signal) {
      if (busy || !controlsFor(capabilities, ready, host).retry || signal.aborted) return
      if (ledger.pending() !== undefined) {
        if (!samePending(sessionId, id)) return
        await replaySame(signal)
        return
      }
      const ticket = ++call
      busy = true
      failure = undefined
      editing = false
      ownerSession = sessionId
      ownerMessage = id
      publish()
      try {
        const seen = await preview(sessionId, id, signal, ticket)
        if (seen === undefined) return
        if (!seen.eligible) {
          failure = { code: 'session/retry-blocked', reason: seen.reason ?? 'unknown' }
          return
        }
        if (signal.aborted || ticket !== call) return
        expectedRevision = seen.branchRevision
        expectedInputRevision = seen.inputRevision
        const body = directRetryRequest({
          sessionId,
          messageId: id,
          expectedRevision: seen.branchRevision,
          expectedInputRevision: seen.inputRevision,
          requestId: ids(),
        })
        await ledger.submit(body, () => callRetry(body, signal, ticket))
      } catch (error) {
        if (ticket === call && !signal.aborted) failure = readFailure(error)
      } finally {
        settle()
      }
    },
    async beginEdit(sessionId, id, text, signal) {
      if (busy || !controlsFor(capabilities, ready, host).retry || signal.aborted) return
      if (ledger.pending() !== undefined) {
        if (!samePending(sessionId, id)) return
        await replaySame(signal)
        return
      }
      const ticket = ++call
      busy = true
      failure = undefined
      ownerSession = sessionId
      ownerMessage = id
      publish()
      try {
        const seen = await preview(sessionId, id, signal, ticket)
        if (seen === undefined) return
        if (!seen.eligible) {
          failure = { code: 'session/retry-blocked', reason: seen.reason ?? 'unknown' }
          return
        }
        if (signal.aborted || ticket !== call) return
        expectedRevision = seen.branchRevision
        expectedInputRevision = seen.inputRevision
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
      publish()
    },
    async sendEdit(sessionId, id, signal) {
      if (signal.aborted || busy || !controlsFor(capabilities, ready, host).retry) return
      if (!editing || ownerSession !== sessionId || ownerMessage !== id) return
      if (ledger.pending() !== undefined) {
        if (!samePending(sessionId, id)) return
        await replaySame(signal)
        return
      }
      const ticket = ++call
      busy = true
      failure = undefined
      const text = draft
      publish()
      try {
        if (signal.aborted || ticket !== call) return
        const body = editRetryRequest({
          sessionId,
          messageId: id,
          expectedRevision,
          expectedInputRevision,
          requestId: ids(),
          text,
        })
        await ledger.submit(body, () => callRetry(body, signal, ticket))
        if (ticket === call && !signal.aborted) editing = false
      } catch (error) {
        if (ticket === call && !signal.aborted) failure = readFailure(error)
      } finally {
        settle()
      }
    },
    retire(sessionId, messageId) {
      if (ownerSession !== sessionId || ownerMessage !== messageId) return
      call += 1
      editing = false
      failure = undefined
      draft = ''
      if (!ledger.busy) busy = false
      publish()
    },
    cancel() {
      call += 1
      editing = false
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
    fork?: SessionHost['fork']
    refresh?: SessionHost['refresh']
    previewRetry?: SessionHost['previewRetry']
    retry?: SessionHost['retry']
  }
  uiWorkspace?: {
    openSession?: SessionHost['openSession']
    forkSession?: SessionHost['forkSession']
    deleteSession?: SessionHost['deleteSession']
  }
  layout?: { selectPanel?: SessionHost['selectPanel'] }
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
    ...typeof sessions?.fork === 'function' ? { fork: opts => sessions.fork!(opts) } : {},
    ...typeof sessions?.refresh === 'function' ? { refresh: () => sessions.refresh!() } : {},
    ...typeof sessions?.previewRetry === 'function' ? { previewRetry: request => sessions.previewRetry!(request) } : {},
    ...typeof sessions?.retry === 'function' ? { retry: request => sessions.retry!(request) } : {},
    ...typeof workspace?.openSession === 'function' ? { openSession: sessionId => workspace.openSession!(sessionId) } : {},
    ...typeof workspace?.forkSession === 'function' ? { forkSession: sessionId => workspace.forkSession!(sessionId) } : {},
    ...typeof workspace?.deleteSession === 'function' ? { deleteSession: (sessionId, requestId) => workspace.deleteSession!(sessionId, requestId) } : {},
    ...typeof ctx.layout?.selectPanel === 'function' ? { selectPanel: id => ctx.layout!.selectPanel!(id) } : {},
  }
}
