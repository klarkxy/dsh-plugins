import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { isSubagentSession } from '@klarkxy/dsh-plugin-kit/contracts'
import type { PluginLogger } from '@klarkxy/dsh-plugin-kit/log-shared'
import {
  REVIEW_PERMISSION_PRESET, defaultSettings, normalizeModelRoute,
  type QuickReviewSettings, type ResolvedModel, type ReviewScope, type ReviewStartValue,
  type ReviewState, type ReviewStatus,
} from './contracts.ts'
import { reviewPrompt } from './prompts.ts'

/**
 * The host's adjacent-agent delivery source, declared identically in
 * `@deepseek-ai/dsh-subagent`'s continuation-messages and re-declared in
 * `dsh-session-manager`. Identical member types merge, so the attribution
 * stays typed where it is produced without a runtime dependency.
 */
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'agent-message': {
      kind: 'agent-message'
      form: 'relay'
      senderSessionId: SessionId
    }
  }
}

export interface SessionEventLike {
  readonly seq: number
  readonly type: string
  readonly data?: unknown
}

export interface SessionLike {
  readonly id: string
  readonly header?: {
    readonly cwd?: string
    readonly origin?: unknown
    readonly parentSession?: unknown
    readonly delegationDepth?: unknown
    readonly isSeeded?: unknown
    readonly classification?: unknown
  }
}

/** Lease over one session's event log at a fixed cut (`ctx.sessionQuery.observeSession`). */
export interface SessionObservationLike extends Disposable {
  readonly events: readonly SessionEventLike[]
}

export interface SessionQueryLike {
  observeSession(sessionId: string, options?: { readonly signal?: AbortSignal }): Promise<SessionObservationLike>
}

export interface AgentLike {
  readonly id: string
  readonly session?: SessionLike
  readonly model?: {
    current?(): unknown
    select(selection: unknown): void
  }
  followup?(message: unknown): void
}

export interface AgentResolution {
  readonly agent?: AgentLike
  readonly error?: { readonly code?: unknown; readonly message?: unknown }
}

export interface SessionControllerLike {
  create(request: { readonly workspaceId?: string; readonly cwd?: string }): Promise<{ readonly sessionId?: string }>
  rename(request: { readonly sessionId: string; readonly title: string }): Promise<unknown>
  prompt(request: {
    readonly requestId: string
    readonly sessionId: string
    readonly mode: 'queue' | 'steer'
    readonly content: readonly unknown[]
  }, signal?: AbortSignal): Promise<unknown>
  resolveAgent(id: string): Promise<AgentResolution>
}

export interface WorkspaceChangesLike {
  summary(sessionId: string, seq: number): { readonly files?: readonly { readonly display?: string; readonly path?: string }[] } | undefined
}

export interface WorkspaceRegistryLike {
  list(): readonly { readonly id: string; readonly sessionIds: readonly string[] }[]
}

export interface PermissionPresetsLike {
  set(session: SessionLike, name: string): void
  optionOf?(name: string): unknown
}

export interface LlmLike {
  resolveCallConfig(selection: unknown): Promise<unknown>
}

export interface DefaultModelLike {
  currentSelection(): { readonly provider?: string; readonly model?: string; readonly reasoningEffort?: string }
}

export interface SessionTitleLike {
  get(session: SessionLike): { readonly title?: string } | undefined
}

export interface QuickReviewServiceDeps {
  readonly plugin: string
  readonly logger?: PluginLogger
  readonly sessionController: SessionControllerLike
  readonly sessionQuery: SessionQueryLike
  readonly llm: LlmLike
  readonly workspaceChanges?: () => WorkspaceChangesLike | undefined
  readonly workspaceRegistry?: () => WorkspaceRegistryLike | undefined
  readonly permissionPresets?: () => PermissionPresetsLike | undefined
  readonly agentDefaultModel?: () => DefaultModelLike | undefined
  readonly sessionTitle?: () => SessionTitleLike | undefined
  readonly settings?: {
    load(): Promise<QuickReviewSettings>
    save(settings: QuickReviewSettings): Promise<void>
  }
  /** Review prompt request id minter. */
  readonly ids?: () => string
}

export class QuickReviewError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = code === 'cancelled' ? 'AbortError' : 'QuickReviewError'
    this.code = code
  }
}

interface ReviewRecord {
  readonly reviewSessionId: string
  readonly sourceSessionId: string
  readonly model: ResolvedModel
  readonly scope: ReviewScope
  state: ReviewState
  error?: string
  /** The first `turn/end` of the review session is consumed exactly once. */
  firstTurnSettled: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function remoteErrorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown })?.code
  return typeof code === 'string' && code !== '' ? code : undefined
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The text blocks of the last assistant message in `turn`, or of the log when no turn is named. */
function finalAssistantText(events: readonly SessionEventLike[], turn?: number): string {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index] as SessionEventLike
    if (event.type !== 'assistant/message') continue
    const data = event.data
    if (!isRecord(data)) continue
    if (turn !== undefined && data.turn !== turn) continue
    const message = data.message
    if (!isRecord(message) || !Array.isArray(message.content)) continue
    const text = (message.content as readonly unknown[])
      .filter((block): block is { type: 'text'; text: string } =>
        isRecord(block) && block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text)
      .join('\n')
      .trim()
    if (text !== '') return text
    // A turn-scoped read looks at the final assistant message only: an empty
    // one is a real "no text" result, not a cue to keep walking backwards.
    if (turn !== undefined) return ''
  }
  return ''
}

function modelLabel(model: ResolvedModel): string {
  return `${model.provider}/${model.model}`
}

/** Attribution prefix mirroring the host's relay convention. */
function relayText(record: ReviewRecord, text: string): string {
  return `Quick review (${modelLabel(record.model)}) from session ${record.reviewSessionId}:\n\n${text}`
}

function agentSource(senderSessionId: SessionId): MessageSource {
  return { kind: 'agent-message', form: 'relay', senderSessionId }
}

function looksChinese(text: string): boolean {
  return /[一-鿿]/u.test(text)
}

export class QuickReviewService {
  private readonly deps: QuickReviewServiceDeps
  private readonly reviews = new Map<string, ReviewRecord>()
  private readonly latestBySource = new Map<string, string>()
  private settings: QuickReviewSettings
  private readonly settingsReady: Promise<void>
  private disposed = false

  constructor(deps: QuickReviewServiceDeps) {
    this.deps = deps
    this.settings = defaultSettings()
    this.settingsReady = deps.settings?.load().then(
      loaded => { if (loaded) this.settings = loaded },
      () => { /* an unreadable row keeps the in-memory default */ },
    ) ?? Promise.resolve()
  }

  async ready(): Promise<void> {
    await this.settingsReady
  }

  getSettings(): QuickReviewSettings {
    return this.settings
  }

  async updateSettings(patch: { readonly model: unknown }, expectedRevision: number): Promise<QuickReviewSettings> {
    await this.ready()
    this.assertLive()
    if (expectedRevision !== this.settings.revision) {
      throw new QuickReviewError('stale', 'settings changed; refresh and retry')
    }
    const next: QuickReviewSettings = {
      revision: this.settings.revision + 1,
      model: normalizeModelRoute(patch.model),
    }
    await this.deps.settings?.save(next)
    this.settings = next
    return next
  }

  private assertLive(): void {
    if (this.disposed) throw new QuickReviewError('disposed', 'quick review is disabled')
  }

  private async resolveAgent(sessionId: string): Promise<AgentLike> {
    const resolved = await this.deps.sessionController.resolveAgent(sessionId)
    const agent = resolved?.agent
    if (agent === undefined) {
      const detail = resolved?.error?.message
      throw new QuickReviewError(
        remoteErrorCode(resolved?.error) ?? 'session/not-found',
        typeof detail === 'string' && detail !== '' ? detail : `session "${sessionId}" is not live`,
      )
    }
    return agent
  }

  private async resolveSource(sourceSessionId: string, signal: AbortSignal): Promise<AgentLike> {
    signal.throwIfAborted()
    const agent = await this.resolveAgent(sourceSessionId)
    if (isSubagentSession(agent.session)) {
      throw new QuickReviewError('subagent-session', 'quick review only runs on top-level conversations')
    }
    return agent
  }

  /**
   * Union every `workspace/changes` summary the host still holds for the
   * source session. A missing service, an unread event seq, or an empty union
   * all degrade to the workspace fallback — the reviewer then covers all
   * uncommitted changes instead.
   */
  computeScope(sessionId: string, events: readonly SessionEventLike[]): ReviewScope {
    const files = new Set<string>()
    const changes = this.deps.workspaceChanges?.()
    if (changes !== undefined) {
      for (const event of events) {
        if (event.type !== 'workspace/changes') continue
        const summary = changes.summary(sessionId, event.seq)
        for (const file of summary?.files ?? []) {
          // `path` is usable in commands; `display` can be a `~/` label.
          const name = file.path ?? file.display
          if (typeof name === 'string' && name !== '') files.add(name)
        }
      }
    }
    return files.size > 0 ? { kind: 'session', files: [...files].sort() } : { kind: 'workspace' }
  }

  /**
   * Read one session's event log through `sessionQuery` — the sanctioned path
   * that also covers prepared (persisted) sessions, unlike the deprecated
   * synchronous Session readers.
   */
  private async observeEvents(sessionId: string, signal: AbortSignal): Promise<readonly SessionEventLike[]> {
    const observed = await this.deps.sessionQuery.observeSession(sessionId, { signal }).catch((error: unknown) => {
      if (remoteErrorCode(error) === 'SESSION_QUERY_SESSION_NOT_FOUND') {
        throw new QuickReviewError('session/not-found', `session "${sessionId}" not found`)
      }
      throw error
    })
    try {
      return [...observed.events]
    } finally {
      observed[Symbol.dispose]()
    }
  }

  /** Cheap popover preview of what a review would cover. */
  async scope(sourceSessionId: string, signal: AbortSignal): Promise<ReviewScope> {
    this.assertLive()
    await this.resolveSource(sourceSessionId, signal)
    return this.computeScope(sourceSessionId, await this.observeEvents(sourceSessionId, signal))
  }

  /**
   * Pick precedence. An explicit request is authoritative: a concrete route is
   * used as-is and an empty route means "follow the host default", never the
   * stored pick. Only a request without a `model` field falls back to the
   * remembered choice, then the host default model.
   */
  private async resolveModel(requested: unknown): Promise<ResolvedModel> {
    await this.ready()
    const stored = this.settings.model
    const effective = requested !== undefined
      ? (() => {
        const route = normalizeModelRoute(requested)
        return route.provider && route.model ? route : this.deps.agentDefaultModel?.()?.currentSelection()
      })()
      : stored.provider && stored.model ? stored : this.deps.agentDefaultModel?.()?.currentSelection()
    const provider = effective?.provider
    const model = effective?.model
    if (typeof provider !== 'string' || provider === '' || typeof model !== 'string' || model === '') {
      throw new QuickReviewError('no-model', 'no review model is selected and the host has no default model')
    }
    const reasoningEffort = effective?.reasoningEffort
    return { provider, model, ...(typeof reasoningEffort === 'string' && reasoningEffort !== '' ? { reasoningEffort } : {}) }
  }

  /**
   * Create the review session, pin it read-only, seed it with the review
   * prompt, and start tracking its first turn. The selection mirrors the
   * host's selectModel minus `agentDefaultModel.saveSelection`: a review pick
   * must never overwrite the user's global default model.
   */
  async start(request: {
    readonly sourceSessionId: string
    readonly model?: unknown
    readonly focus?: string
  }, signal: AbortSignal): Promise<ReviewStartValue> {
    this.assertLive()
    const sourceSessionId = request.sourceSessionId
    const latest = this.latestBySource.get(sourceSessionId)
    if (latest !== undefined && this.reviews.get(latest)?.state === 'running') {
      throw new QuickReviewError('busy', 'a review is already running for this session')
    }
    // Refuse early: a host that cannot pin the preset must never spawn a writable reviewer.
    const presets = this.deps.permissionPresets?.()
    if (presets === undefined || typeof presets.set !== 'function') {
      throw new QuickReviewError('permission-unavailable', 'this host cannot pin a read-only review session')
    }
    if (typeof presets.optionOf === 'function') {
      try {
        presets.optionOf(REVIEW_PERMISSION_PRESET)
      } catch (error) {
        throw new QuickReviewError(
          'permission-unavailable',
          `the host has no "${REVIEW_PERMISSION_PRESET}" permission preset: ${toErrorMessage(error)}`,
        )
      }
    }
    const source = await this.resolveSource(sourceSessionId, signal)
    const scope = this.computeScope(sourceSessionId, await this.observeEvents(sourceSessionId, signal))
    signal.throwIfAborted()
    const model = await this.resolveModel(request.model)
    signal.throwIfAborted()
    // Validate the pick before creating anything: a route the host cannot
    // call must fail here rather than leave a blank review session behind.
    const selection: ResolvedModel = { provider: model.provider, model: model.model, ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}) }
    try {
      await this.deps.llm.resolveCallConfig(selection)
    } catch (error) {
      throw new QuickReviewError('model-unavailable', toErrorMessage(error))
    }
    signal.throwIfAborted()

    const workspace = this.deps.workspaceRegistry?.()?.list().find(item => item.sessionIds.includes(sourceSessionId))
    const cwd = workspace === undefined ? source.session?.header?.cwd : undefined
    if (workspace === undefined && (cwd === undefined || cwd === '')) {
      throw new QuickReviewError('no-cwd', 'the source session has no workspace or working directory')
    }
    const created = await this.deps.sessionController.create(
      workspace !== undefined ? { workspaceId: workspace.id } : { cwd: cwd as string },
    )
    const reviewSessionId = created?.sessionId
    if (typeof reviewSessionId !== 'string' || reviewSessionId === '') {
      throw new QuickReviewError('create-failed', 'the host returned no review session')
    }
    signal.throwIfAborted()
    // The blank session already exists at this point; a setup that cannot pin
    // model + read-only must fail loudly rather than prompt a writable or
    // misconfigured reviewer. (The host has no session-delete API, so the
    // empty session remains — accepted.)
    try {
      const reviewAgent = await this.resolveAgent(reviewSessionId)
      const reviewSession = reviewAgent.session ?? { id: reviewSessionId }
      if (typeof reviewAgent.model?.select !== 'function') {
        throw new Error('the review agent exposes no model selection')
      }
      reviewAgent.model.select(selection)
      presets.set(reviewSession, REVIEW_PERMISSION_PRESET)
    } catch (error) {
      this.deps.logger?.warn('review.setup-failed', 'The review session could not be pinned read-only with the requested model.', error, { reviewSessionId })
      throw new QuickReviewError('setup-failed', `review session ${reviewSessionId} could not be pinned read-only with the requested model: ${toErrorMessage(error)}`)
    }

    const sourceTitle = this.deps.sessionTitle?.()?.get(source.session ?? { id: sourceSessionId })?.title ?? sourceSessionId
    const title = looksChinese(sourceTitle) ? `评审：${sourceTitle}` : `Review: ${sourceTitle}`
    try {
      await this.deps.sessionController.rename({ sessionId: reviewSessionId, title })
    } catch (error) {
      this.deps.logger?.warn('review.rename-failed', 'The review session kept its generated title.', error, { reviewSessionId })
    }
    signal.throwIfAborted()
    // Track before prompting: a fast first turn/end must find the record
    // already running, and a prompt failure must surface as 'prompt-failed'.
    const record: ReviewRecord = {
      reviewSessionId,
      sourceSessionId,
      model: selection,
      scope,
      state: 'running',
      firstTurnSettled: false,
    }
    this.reviews.set(reviewSessionId, record)
    this.latestBySource.set(sourceSessionId, reviewSessionId)
    this.evictSettled()
    const requestId = (this.deps.ids ?? (() => crypto.randomUUID()))()
    try {
      await this.deps.sessionController.prompt({
        requestId,
        sessionId: reviewSessionId,
        mode: 'queue',
        content: [{ type: 'text', text: reviewPrompt({ sourceSessionId, scope, focus: request.focus }) }],
      }, signal)
    } catch (error) {
      record.state = 'failed'
      record.error = 'prompt-failed'
      throw error
    }
    return { reviewSessionId, scope, model: selection }
  }

  status(query: { readonly sourceSessionId?: string; readonly reviewSessionId?: string }): { readonly review?: ReviewStatus; readonly isReview?: boolean } {
    const sessionId = query.reviewSessionId ?? query.sourceSessionId
    const record = query.reviewSessionId !== undefined
      ? this.reviews.get(query.reviewSessionId)
      : query.sourceSessionId !== undefined
        ? this.reviews.get(this.latestBySource.get(query.sourceSessionId) ?? '')
        : undefined
    return {
      ...(record === undefined ? {} : { review: this.publicStatus(record) }),
      ...(sessionId !== undefined && this.reviews.has(sessionId) ? { isReview: true } : {}),
    }
  }

  private publicStatus(record: ReviewRecord): ReviewStatus {
    return {
      reviewSessionId: record.reviewSessionId,
      sourceSessionId: record.sourceSessionId,
      state: record.state,
      model: record.model,
      scope: record.scope,
      ...(record.error === undefined ? {} : { error: record.error }),
    }
  }

  /** Bound the in-memory table: once past 50 records, drop the oldest settled ones. */
  private evictSettled(): void {
    for (const [id, record] of this.reviews) {
      if (this.reviews.size <= 50) return
      if (record.state === 'running') continue
      this.reviews.delete(id)
      if (this.latestBySource.get(record.sourceSessionId) === id) {
        this.latestBySource.delete(record.sourceSessionId)
      }
    }
  }

  /** Re-deliver the review session's latest assistant text to the source session. */
  async resend(reviewSessionId: string, signal: AbortSignal): Promise<ReviewStatus> {
    this.assertLive()
    const record = this.reviews.get(reviewSessionId)
    if (record === undefined) {
      throw new QuickReviewError('not-found', `unknown review session "${reviewSessionId}"`)
    }
    signal.throwIfAborted()
    const text = finalAssistantText(await this.observeEvents(reviewSessionId, signal))
    if (text === '') {
      throw new QuickReviewError('no-text', 'the review session has no assistant answer to send')
    }
    await this.deliver(record, text, signal)
    return this.publicStatus(record)
  }

  /**
   * Deliver `text` to the source session as an agent-relay message. The
   * caller's session is resolved fresh each time so a resumed source still
   * receives the verdict.
   */
  private async deliver(record: ReviewRecord, text: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    const agent = await this.resolveAgent(record.sourceSessionId)
    if (typeof agent.followup !== 'function') {
      throw new QuickReviewError('delivery-unavailable', 'the source session cannot receive agent messages')
    }
    agent.followup(createUserMessage({
      content: [{ type: 'text' as const, text: relayText(record, text) }],
      source: agentSource(record.reviewSessionId as SessionId),
    }))
    record.state = 'sent'
  }

  /**
   * Consume the review session's first `turn/end` once: a completed turn with
   * visible text relays its final assistant message to the source; anything
   * else records a failure instead of sending.
   *
   * Listener scope is deliberate: `session/event` is a global signal, but the
   * handler only acts on sessions this plugin created and still tracks — an
   * explicit opt-in list rather than a per-session filter (see plugins/AGENTS.md).
   */
  onSessionEvent = (session: SessionLike, event: SessionEventLike): void => {
    if (event.type !== 'turn/end' || this.disposed) return
    const record = this.reviews.get(session.id)
    if (record === undefined || record.firstTurnSettled) return
    record.firstTurnSettled = true
    const data = isRecord(event.data) ? event.data : {}
    const kind = isRecord(data.reason) && typeof data.reason.kind === 'string' ? data.reason.kind : 'unknown'
    if (kind !== 'completed') {
      record.state = 'failed'
      record.error = `turn-${kind}`
      return
    }
    void this.finishFirstTurn(record, typeof data.turn === 'number' ? data.turn : undefined)
  }

  /** Read the settled turn's final assistant text and relay it, recording failure instead of sending nothing. */
  private async finishFirstTurn(record: ReviewRecord, turn: number | undefined): Promise<void> {
    try {
      const text = finalAssistantText(
        await this.observeEvents(record.reviewSessionId, AbortSignal.timeout(30_000)),
        turn,
      )
      if (text === '') {
        record.state = 'failed'
        record.error = 'empty-response'
        return
      }
      await this.deliver(record, text)
    } catch (error) {
      if (record.state === 'sent') return
      record.state = 'failed'
      record.error = 'delivery-failed'
      this.deps.logger?.warn('review.delivery-failed', 'The review verdict could not be sent back to the source session.', error, {
        reviewSessionId: record.reviewSessionId,
        sourceSessionId: record.sourceSessionId,
      })
    }
  }

  /** A review session that went away mid-run failed with it; the record stays so status still reports the outcome. */
  onAgentDisposed = (payload: { readonly agent?: AgentLike }): void => {
    const id = payload?.agent?.session?.id ?? payload?.agent?.id
    if (id === undefined) return
    const record = this.reviews.get(id)
    if (record !== undefined && record.state === 'running') {
      record.state = 'failed'
      record.error = 'session-disposed'
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.reviews.clear()
    this.latestBySource.clear()
  }
}
