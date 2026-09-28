import { randomUUID } from 'node:crypto'
import type { AiFeatureScope, RpcResult, TaskContract } from '@klarkxy/dsh-ai-services/contracts'
import {
  MOOD_ANALYZE_PURPOSE, PROMPT_VERSION, SCHEMA_VERSION, cloneContract, defaultSettings, excerptOf, fail, ok,
  operationalSettings, parseSessionId, projectIdFromCwd, sessionIdOf,
  type AskUserRequest, type AskUserQuestionAnswer, type ClarificationItem, type HeldRequest,
  type MoodSettings, type MoodStatus,
} from './contracts.ts'
import { ANALYZE_SYSTEM, analyzePurpose, boundQuestions, contractFromDraft, parseAnalysis } from './analyze.ts'
import {
  collectClaimedHumans, collectLogHumans, latestUserSeq, sourceVersionOf,
  type SessionEventLike, type UserMessageLike,
} from './evidence.ts'
import { AUTONOMY_POLICY, createMoodContextMessage, formatContract, mergeContractMessage } from './inject.ts'
import { parseEdit, parseManual, parseModeUpdate, type ContractEdit } from './schema.ts'
import { isContinuationRequest } from './trigger.ts'

export interface MoodPersistedState {
  settings: MoodSettings
  sessions: Record<string, MoodStoredSession>
}

/** Existing storage/RPC shape is retained; heldRequest is recovery-only. */
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

export interface SessionLike {
  id?: unknown
  header?: { cwd?: string }
  meta?: { cwd?: string }
}

export interface PreStepPayload {
  agent: { id?: unknown; session?: SessionLike }
  messages: UserMessageLike[]
  turn: number
  step: number
  signal: AbortSignal
}

export type PreStepDecision = { kind: 'reject' } | { kind: 'enter'; messages: unknown[]; startsRequestSeries?: true }

export interface MoodServiceOptions {
  store?: MoodStore
  now?: () => number
  id?: () => string
  readEvents: (sessionId: string) => readonly SessionEventLike[] | undefined
  liveSession?: (sessionId: string) => SessionLike | undefined
  activateAi?: () => AiFeatureScope | undefined
  /** Kept for Host compatibility. The main Agent owns necessary native questions. */
  askUser?: (request: AskUserRequest) => Promise<AskUserQuestionAnswer>
  createInjectMessage?: (text: string) => unknown
  resumeHeld?: (sessionId: string, messages: unknown[]) => Promise<void>
}

type InternalSession = MoodStoredSession & {
  generation: number
  work?: AbortController
  requestVersion?: string
  latest?: UserMessageLike[]
  retrying?: boolean
}

export class MoodService {
  private settings = defaultSettings()
  private sessions = new Map<string, InternalSession>()
  private storageFailed = false
  private active = true
  private ai?: AiFeatureScope
  private unregisterPurpose?: () => void
  private pending = Promise.resolve()
  private readonly now: () => number
  private readonly nextId: () => string

  constructor(private readonly options: MoodServiceOptions) {
    this.now = options.now ?? Date.now
    this.nextId = options.id ?? randomUUID
    try {
      const loaded = structuredClone(options.store?.load() ?? { settings: defaultSettings(), sessions: {} })
      this.settings = operationalSettings(loaded.settings)
      for (const [sessionId, row] of Object.entries(loaded.sessions)) {
        this.sessions.set(sessionId, {
          ...row, clarification: row.clarification ?? [], pendingManual: false, generation: 0,
          requestVersion: row.lastHandledVersion ?? row.contract?.sourceVersion ?? row.heldRequest?.sourceVersion,
        })
      }
    } catch {
      // Optional task notes must not prevent the main Agent from starting.
      this.storageFailed = true
    }
  }

  getContract(sessionId: string): TaskContract | undefined {
    const contract = this.sessions.get(sessionId)?.contract
    return contract ? cloneContract(contract) : undefined
  }

  status(sessionId?: string): MoodStatus {
    const status: MoodStatus = { settings: { ...this.settings }, storageFailed: this.storageFailed }
    if (!sessionId) return status
    const row = this.ensure(sessionId)
    status.session = {
      sessionId, projectId: row.projectId, contract: this.getContract(sessionId),
      clarification: structuredClone(row.clarification), pendingManual: row.pendingManual,
      held: Boolean(row.heldRequest?.messages.length),
    }
    return status
  }

  isActive(): boolean { return this.active }

  async dispose(): Promise<void> {
    this.active = false
    for (const row of this.sessions.values()) this.cancelWork(row)
    this.unregisterPurpose?.()
    this.ai?.dispose()
    this.ai = undefined
    await this.pending
  }

  async call(endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResult> {
    if (!this.active) return fail('MOOD_DISABLED', '自主推进已关闭。')
    if (signal.aborted) return fail('MOOD_CANCELLED', '请求已取消。')
    try {
      if (endpoint === 'status') return ok(this.status(parseSessionId(payload)))
      if (endpoint === 'contract') {
        const sessionId = parseSessionId(payload)
        if (!sessionId) return fail('MOOD_INVALID', '缺少会话。')
        return ok(this.getContract(sessionId) ?? null)
      }
      if (endpoint === 'mode') {
        const parsed = parseModeUpdate(payload)
        if (!parsed) return fail('MOOD_INVALID', '模式格式无效。')
        return ok(await this.serialize(async () => {
          this.assertLive()
          signal.throwIfAborted()
          if (parsed.expectedRevision !== this.settings.revision) coded('MOOD_STALE', '设置已更新，请刷新后重试。')
          const settings = operationalSettings({ mode: parsed.mode, revision: this.settings.revision + 1 })
          await this.persist({ ...this.snapshot(), settings })
          this.settings = settings
          return this.status()
        }))
      }
      if (endpoint === 'manual' || endpoint === 'retry' || endpoint === 'edit') {
        const parsed = endpoint === 'edit' ? parseEdit(payload) : parseManual(payload)
        if (!parsed) return fail('MOOD_INVALID', '请求格式无效。')
        const sessionId = this.hostSessionId(parsed.sessionId)
        if (!sessionId) return fail('MOOD_SESSION_NOT_FOUND', '会话不在当前 Host。')
        if (endpoint === 'manual') await this.analyzeManually(sessionId, signal)
        if (endpoint === 'retry') await this.retryLegacy(sessionId, signal)
        if (endpoint === 'edit') await this.editContract(sessionId, parsed as ContractEdit, signal)
        return ok(this.status(sessionId))
      }
      return fail('MOOD_INVALID', '未知操作。')
    } catch (error) {
      const aborted = signal.aborted || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))
      const code = aborted ? 'MOOD_CANCELLED'
        : error && typeof error === 'object' && 'code' in error ? String(error.code) : 'MOOD_FAILED'
      return fail(code, error instanceof Error ? error.message : '需求梳理失败。')
    }
  }

  /** No model call, question, disk write, or requirement gate on the normal path. */
  async handlePreStep(payload: PreStepPayload, next: () => Promise<PreStepDecision>): Promise<PreStepDecision> {
    const inner = await next()
    if (!this.active || inner.kind !== 'enter') return inner
    payload.signal.throwIfAborted()
    const sessionId = sessionIdOf(payload.agent)
    if (!sessionId) return inner
    try {
      const row = this.ensure(sessionId)
      const humans = collectClaimedHumans(payload.messages)
      if (humans.length) {
        const version = sourceVersionOf(humans)
        if (row.requestVersion !== version) {
          this.cancelWork(row)
          if (!isContinuationRequest(humans.at(-1)!.text) && row.contract && row.contract.sourceVersion !== version) {
            row.contract = { ...row.contract, readiness: 'stale' }
          }
          row.requestVersion = version
          row.heldRequest = undefined
        }
        row.latest = structuredClone(payload.messages.filter(message => message.source?.kind === 'user'))
      }
      row.projectId = projectIdFromCwd(payload.agent.session?.header?.cwd ?? payload.agent.session?.meta?.cwd) ?? row.projectId
      const contract = row.contract
      const settled = contract && ['user-confirmed', 'disclosed-assumptions', 'clear-request'].includes(contract.readiness)
      // Old automatically generated thin contracts add no information to the conversation.
      const explicit = contract && (contract.readiness === 'user-confirmed' || contract.evidence.some(ref => ref.kind === 'manual'))
      const text = settled && explicit ? `${AUTONOMY_POLICY}\n\n${formatContract(contract, row.clarification)}` : AUTONOMY_POLICY
      const extra = (this.options.createInjectMessage ?? createMoodContextMessage)(text)
      return { ...inner, messages: mergeContractMessage(inner.messages, extra) }
    } catch {
      // Never override an upstream rejection, swallow user cancellation, or fail closed on optional context.
      payload.signal.throwIfAborted()
      return inner
    }
  }

  /** Explicit RPC only. Produces optional notes, never a blocking question dialog. */
  private async analyzeManually(sessionId: string, signal: AbortSignal): Promise<void> {
    const row = this.ensure(sessionId)
    const logged = collectLogHumans(sessionId, this.options.readEvents(sessionId) ?? [])
    const claimed = collectClaimedHumans(row.latest ?? [])
    const turns = new Map(logged.map(turn => [turn.id, { id: turn.id, text: turn.text }]))
    for (const turn of claimed) turns.set(turn.id, turn)
    const recent = [...turns.values()].slice(-12)
    if (!recent.length) coded('MOOD_NOT_FOUND', '没有可梳理的用户请求。')
    this.cancelWork(row)
    const generation = row.generation
    const work = new AbortController()
    row.work = work
    row.pendingManual = true
    const version = row.requestVersion ?? recent.at(-1)!.id
    row.requestVersion = version
    try {
      const scope = this.scope()
      const combined = AbortSignal.any([signal, work.signal, scope.signal, AbortSignal.timeout(analyzePurpose.timeoutMs)])
      const evidence = logged.filter(turn => recent.some(item => item.id === turn.id)).map(turn => turn.evidence)
      evidence.push({ sessionId, seq: latestUserSeq(this.options.readEvents(sessionId) ?? []), kind: 'manual', excerpt: '用户主动梳理需求；不是执行授权' })
      const result = await scope.run({
        purpose: MOOD_ANALYZE_PURPOSE, sessionId, sourceVersion: version,
        promptVersion: PROMPT_VERSION, schemaVersion: SCHEMA_VERSION, system: ANALYZE_SYSTEM,
        input: JSON.stringify({ turns: recent.map(turn => ({ ...turn, text: turn.text.slice(-2000) })), evidence }),
        signal: combined, priority: 'interactive',
        isCurrent: () => this.active && row.generation === generation && !combined.aborted,
      })
      combined.throwIfAborted()
      this.assertCurrent(row, generation)
      const draft = result.receipt.status === 'success' ? parseAnalysis(result.text) : undefined
      if (!draft) coded('MOOD_ANALYZE', '未能生成需求摘要；普通对话不受影响。')
      const contract = contractFromDraft({
        id: this.nextId(), sessionId, sourceVersion: version, revision: (row.contract?.revision ?? 0) + 1,
        goalFallback: recent.at(-1)!.text, evidence, draft,
        questions: boundQuestions(draft.questions, 'mild'), readiness: 'disclosed-assumptions', now: this.now(),
      })
      await this.commit(sessionId, generation, () => ({
        contract, clarification: [], pendingManual: false, lastHandledVersion: version,
      }), combined)
    } finally {
      if (row.work === work) { row.work = undefined; row.pendingManual = false }
    }
  }

  private async editContract(sessionId: string, input: ContractEdit, signal: AbortSignal): Promise<void> {
    const row = this.ensure(sessionId)
    this.cancelWork(row)
    await this.commit(sessionId, row.generation, current => {
      const contract = current.contract
      if (!contract) coded('MOOD_NOT_FOUND', '还没有可修订的约定。')
      if (contract.revision !== input.expectedRevision) coded('MOOD_STALE', '约定已更新，请刷新后重试。')
      return {
        contract: {
          ...contract, ...input.patch, revision: contract.revision + 1, readiness: 'user-confirmed', updatedAt: this.now(),
          evidence: [...contract.evidence, { sessionId, seq: latestUserSeq(this.options.readEvents(sessionId) ?? []), kind: 'manual', excerpt: excerptOf(input.patch.goal ?? '修订约定') }],
        },
        // Editing a goal must not fabricate answers to unrelated old questions.
        clarification: current.clarification.filter(item => item.status === 'answered'), pendingManual: false, heldRequest: undefined,
      }
    }, signal)
  }

  private async retryLegacy(sessionId: string, signal: AbortSignal): Promise<void> {
    const row = this.ensure(sessionId)
    const held = row.heldRequest
    if (!held?.messages.length || row.retrying) coded('MOOD_NOT_FOUND', '没有可按原请求重试的内容。')
    const resume = this.options.resumeHeld
    if (!resume) coded('MOOD_NO_RESUME', '当前 Host 不能按原请求恢复。')
    this.cancelWork(row)
    const generation = row.generation
    row.retrying = true
    try {
      await this.commit(sessionId, generation, () => ({ heldRequest: undefined, pendingManual: false }), signal)
      signal.throwIfAborted()
      this.assertCurrent(row, generation)
      await resume(sessionId, structuredClone(held.messages))
    } catch (error) {
      if (this.active && row.generation === generation && !row.heldRequest) {
        await this.commit(sessionId, generation, () => ({ heldRequest: held }))
      }
      throw error
    } finally { row.retrying = false }
  }

  private scope(): AiFeatureScope {
    if (this.ai?.active) return this.ai
    this.unregisterPurpose?.()
    this.ai?.dispose()
    this.ai = this.options.activateAi?.()
    if (!this.ai?.active) coded('MOOD_NO_AI', '需求梳理服务不可用；普通对话不受影响。')
    this.unregisterPurpose = this.ai.registerPurpose(analyzePurpose)
    return this.ai
  }

  private hostSessionId(sessionId: string): string | undefined {
    if (!this.options.liveSession) return sessionId
    const session = this.options.liveSession(sessionId)
    return session ? String(session.id ?? sessionId) : undefined
  }

  private ensure(sessionId: string): InternalSession {
    let row = this.sessions.get(sessionId)
    if (!row) {
      row = { clarification: [], pendingManual: false, generation: 0 }
      this.sessions.set(sessionId, row)
    }
    return row
  }

  private cancelWork(row: InternalSession): void {
    row.generation += 1
    row.work?.abort()
    row.work = undefined
    row.pendingManual = false
  }

  private assertLive(): void {
    if (!this.active) coded('MOOD_DISABLED', '自主推进已关闭。')
  }

  private assertCurrent(row: InternalSession, generation: number): void {
    this.assertLive()
    if (row.generation !== generation) coded('MOOD_CANCELLED', '会话已更新，已丢弃过期的需求梳理。')
  }

  private commit(
    sessionId: string, generation: number,
    patch: (row: InternalSession) => Partial<MoodStoredSession>, signal?: AbortSignal,
  ): Promise<void> {
    return this.serialize(async () => {
      const row = this.ensure(sessionId)
      this.assertCurrent(row, generation)
      signal?.throwIfAborted()
      const next = patch(row)
      const proposed = this.snapshot()
      proposed.sessions[sessionId] = storedOf({ ...row, ...next })
      await this.persist(proposed)
      if (!this.active || row.generation !== generation || signal?.aborted) {
        // A save may finish after cancellation. Restore live notes before releasing the write queue.
        await this.persist(this.snapshot())
        signal?.throwIfAborted()
        this.assertCurrent(row, generation)
      }
      Object.assign(row, next)
    })
  }

  private snapshot(): MoodPersistedState {
    return structuredClone({ settings: this.settings, sessions: Object.fromEntries(
      [...this.sessions].map(([id, row]) => [id, storedOf(row)]),
    ) })
  }

  private async persist(state: MoodPersistedState): Promise<void> {
    try {
      await this.options.store?.save(structuredClone(state))
      this.storageFailed = false
    } catch {
      this.storageFailed = true
      coded('MOOD_STORAGE', '需求摘要保存失败，已保留原内容。')
    }
  }

  private serialize<T>(run: () => Promise<T>): Promise<T> {
    const task = this.pending.then(run, run)
    this.pending = task.then(() => {}, () => {})
    return task
  }
}

function storedOf(row: MoodStoredSession): MoodStoredSession {
  return {
    contract: row.contract, clarification: row.clarification, lastHandledVersion: row.lastHandledVersion,
    pendingManual: false, projectId: row.projectId, heldRequest: row.heldRequest,
  }
}

function coded(code: string, message: string): never {
  throw Object.assign(new Error(message), { code })
}
