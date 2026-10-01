import { randomUUID } from 'node:crypto'
import type { RpcResult, TaskContract } from '@klarkxy/dsh-plugin-kit/contracts'
import {
  cloneContract, defaultSettings, excerptOf, fail, ok, parseSessionId,
  type ClarificationItem, type HeldRequest, type MoodSettings,
} from './contracts.ts'
import { messageSource, textFromContent, type SessionEventLike } from './evidence.ts'
import { isContinuationRequest } from './trigger.ts'
import type { RecordRequirements } from './schema.ts'

/** Legacy state is retained so existing notes, answers and settings are not lost. */
export interface MoodPersistedState {
  settings: MoodSettings
  sessions: Record<string, MoodStoredSession>
}
export interface MoodStoredSession {
  contract?: TaskContract
  clarification: ClarificationItem[]
  lastHandledVersion?: string
  pendingManual: boolean
  projectId?: string
  heldRequest?: HeldRequest
}
export interface MoodStore {
  load(): MoodPersistedState
  save(state: MoodPersistedState): Promise<void>
}
export interface MoodServiceOptions {
  store: MoodStore
  readEvents(sessionId: string): readonly SessionEventLike[] | undefined
  now?: () => number
  id?: () => string
}

export class MoodService {
  private state: MoodPersistedState = { settings: defaultSettings(), sessions: {} }
  private active = true
  private loadFailed = false
  private pending = Promise.resolve()

  constructor(private readonly options: MoodServiceOptions) {
    try { this.state = structuredClone(options.store.load()) }
    catch { this.loadFailed = true }
  }

  /** Acknowledgement/continuation keeps the latest substantive human request anchor. */
  private request(sessionId: string) {
    const events = this.options.readEvents(sessionId)
    if (!events) coded('MOOD_SESSION_NOT_FOUND', 'The current session is unavailable.')
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]!
      if (event.type !== 'user/message' || messageSource(event.data)?.kind !== 'user') continue
      const data = event.data as { id?: unknown; content?: unknown; message?: { id?: unknown; content?: unknown } }
      const message = data.message ?? data
      const text = textFromContent(message.content)
      if (isContinuationRequest(text)) continue
      return {
        sourceVersion: typeof message.id === 'string' && message.id ? message.id : `log:${event.seq}`,
        evidence: { sessionId, seq: event.seq, kind: 'user' as const, excerpt: excerptOf(text) },
      }
    }
    return undefined
  }

  getContract(sessionId: string): TaskContract | undefined {
    if (!this.active || this.loadFailed) return undefined
    const contract = this.state.sessions[sessionId]?.contract
    if (!contract) return undefined
    const result = cloneContract(contract)
    // Recap may read an unloaded historical session; keep its stored notes readable.
    const events = this.options.readEvents(sessionId)
    if (events) {
      const request = this.request(sessionId)
      if (request && result.sourceVersion !== request.sourceVersion) result.readiness = 'stale'
    }
    return result
  }

  read(sessionId: string) {
    this.assertReadable()
    const request = this.request(sessionId)
    const requirements = this.getContract(sessionId) ?? null
    return {
      revision: requirements?.revision ?? 0,
      sourceVersion: request?.sourceVersion ?? null,
      requirements,
      interpretation: 'agent-understanding' as const,
    }
  }

  record(sessionId: string, input: RecordRequirements, signal: AbortSignal): Promise<ReturnType<MoodService['read']>> {
    const draft = structuredClone(input)
    const task = this.pending.then(async () => {
      this.assertReadable()
      signal.throwIfAborted()
      const request = this.request(sessionId)
      if (!request) coded('MOOD_NO_REQUEST', 'No substantive human request exists to record.')
      if (request.sourceVersion !== draft.sourceVersion) coded('MOOD_STALE_REQUEST', 'The request changed. Read requirements again and reconsider the summary.')
      const previous = this.state.sessions[sessionId]
      if ((previous?.contract?.revision ?? 0) !== draft.expectedRevision) coded('MOOD_STALE', 'Requirements changed. Read the latest revision before recording.')
      const contract: TaskContract = {
        ...draft.requirements,
        id: previous?.contract?.id ?? (this.options.id ?? randomUUID)(),
        sessionId, sourceVersion: request.sourceVersion,
        revision: draft.expectedRevision + 1,
        evidence: [request.evidence],
        readiness: draft.requirements.questions.length ? 'pending'
          : draft.requirements.assumptions.length ? 'disclosed-assumptions' : 'clear-request',
        updatedAt: (this.options.now ?? Date.now)(),
      }
      const proposed = structuredClone(this.state)
      proposed.sessions[sessionId] = {
        ...previous, contract, clarification: previous?.clarification ?? [],
        pendingManual: false, lastHandledVersion: request.sourceVersion,
      }
      try { await this.options.store.save(proposed) }
      catch { coded('MOOD_STORAGE', 'Requirements could not be saved; the previous record is unchanged.') }
      // Storage receipt commits the write. A later abort never rolls it back.
      this.state = proposed
      let current: ReturnType<MoodService['request']>
      try { current = this.request(sessionId) } catch { current = undefined }
      const saved = cloneContract(contract)
      if (!current || saved.sourceVersion !== current.sourceVersion) saved.readiness = 'stale'
      return { revision: saved.revision, sourceVersion: current?.sourceVersion ?? null, requirements: saved, interpretation: 'agent-understanding' as const }
    })
    this.pending = task.then(() => {}, () => {})
    return task
  }

  /** Read-only compatibility RPC. Retired UI/model/analyze/retry operations do no work. */
  async call(endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResult> {
    try {
      signal.throwIfAborted()
      const sessionId = parseSessionId(payload)
      if (!sessionId || !['status', 'contract'].includes(endpoint)) return fail('MOOD_TOOL_ONLY', 'Use the current Agent\'s mood_requirements tool.')
      const view = this.read(sessionId)
      return ok(endpoint === 'contract' ? view.requirements : view)
    } catch (error) {
      return fail(errorCode(error), error instanceof Error ? error.message : 'Requirements are unavailable.')
    }
  }

  async dispose(): Promise<void> {
    this.active = false
    await this.pending
  }

  private assertReadable(): void {
    if (!this.active) coded('MOOD_DISABLED', 'Mood is disabled.')
    if (this.loadFailed) coded('MOOD_STORAGE', 'Existing requirements could not be loaded; refusing to overwrite them.')
  }
}

export function coded(code: string, message: string): never {
  throw Object.assign(new Error(message), { code })
}
export function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : 'MOOD_FAILED'
}
