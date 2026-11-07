/**
 * Auto-continue runner: after a turn ends in a session whose locked mode is
 * not 'off', run the hard rules, then one judge model call, and let the host
 * send the composed continuation as a marked user message. At most one
 * evaluation is in flight per session; a newer turn boundary or any user
 * message aborts it, and disposal awaits every evaluation already started.
 */
import { SessionId as brandSessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { isSubagentSession } from '@klarkxy/dsh-plugin-kit/contracts'
import { callLlmText, resolveFeatureModel, type LlmTextCaller } from '@klarkxy/dsh-plugin-kit/llm-call'
import type { AutoContinueService } from './auto-continue.ts'
import {
  AUTO_CONTINUE_KIND,
  buildJudgeMaterial,
  composeContinuation,
  judgeSystem,
  parseVerdict,
  preJudge,
} from './auto-judge.ts'
import { FEATURE_JUDGE, PLUGIN_NAME, type ResolvedConfig } from './contracts.ts'
import { activeEventsOf, type PresenceModelHost } from './welcome-back.ts'

export interface RunnerSessionLike {
  readonly id: string
  readonly header?: unknown
}

export interface RunnerAgentLike {
  readonly id: string
  readonly session?: RunnerSessionLike
  followup?(message: UserMessage): void
}

export interface RunnerObservationLike {
  readonly header?: unknown
  readonly events: readonly SessionEvent[]
  readonly activeEvents?: unknown
  readonly branchRevision?: unknown
  [Symbol.dispose](): void
}

export interface AutoContinueRunnerDeps {
  /** The per-session record service; absent while storage is unmounted. */
  readonly service: () => AutoContinueService | undefined
  readonly config: () => ResolvedConfig
  readonly models: () => PresenceModelHost | undefined
  readonly agents: { get(id: string): RunnerAgentLike | undefined }
  readonly sessions: { flush(session: unknown): Promise<unknown> }
  readonly sessionQuery: {
    observeSession(id: string, options: { signal?: AbortSignal; projectionMode?: string }): Promise<RunnerObservationLike>
  }
  readonly isSubagent?: (session: unknown) => boolean
  readonly log?: {
    debug?(message: string): void
    warn?(message: string): void
  }
}

export class AutoContinueRunner {
  private readonly deps: AutoContinueRunnerDeps
  private readonly inflight = new Map<string, { controller: AbortController; done: Promise<void> }>()
  private disposed = false

  constructor(deps: AutoContinueRunnerDeps) {
    this.deps = deps
  }

  /** `session/event` listener: evaluates ended turns, aborts on newer input. */
  readonly onSessionEvent = (session: { id: string }, event: SessionEvent): void => {
    if (event.type === 'turn/end') {
      this.start(session.id, event)
    } else if (event.type === 'turn/start' || event.type === 'user/message') {
      this.abort(session.id)
    }
  }

  /** `agent/disposed` listener payload. */
  readonly onAgentDisposed = (payload: { agent?: { id?: string; session?: { id?: string } } }): void => {
    const id = payload.agent?.id ?? payload.agent?.session?.id
    if (typeof id === 'string') this.abort(id)
  }

  private abort(sessionId: string): void {
    this.inflight.get(sessionId)?.controller.abort()
  }

  private start(sessionId: string, turnEnd: SessionEvent): void {
    if (this.disposed) return
    this.abort(sessionId)
    const controller = new AbortController()
    const done = this.evaluate(sessionId, turnEnd, controller.signal)
      .catch(error => {
        if (!controller.signal.aborted) {
          this.deps.log?.warn?.(`session-manager: auto-continue failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      })
      .finally(() => {
        if (this.inflight.get(sessionId)?.controller === controller) this.inflight.delete(sessionId)
      })
    this.inflight.set(sessionId, { controller, done })
  }

  private async evaluate(sessionId: string, turnEnd: SessionEvent, signal: AbortSignal): Promise<void> {
    const service = this.deps.service()
    if (service === undefined) return
    const record = service.record(sessionId)
    if (record === undefined || record.mode === 'off') return
    const subagent = this.deps.isSubagent ?? isSubagentSession
    const agent = this.deps.agents.get(sessionId)
    if (agent?.session === undefined || subagent(agent.session)) return
    const events = await this.observe(sessionId, signal)
    if (events === undefined) return
    const decision = preJudge(events, turnEnd, record)
    if (decision.action !== 'judge') {
      this.deps.log?.debug?.(`session-manager: auto-continue skipped (${decision.reason})`)
      return
    }
    const material = buildJudgeMaterial(events, turnEnd, record, decision.count)
    const verdict = await this.judge(material, record.mode, sessionId, signal)
    if (verdict === undefined || verdict.verdict === 'done' || verdict.verdict === 'needs_user') return
    const config = this.deps.config()
    const composed = composeContinuation({
      verdict: verdict.verdict,
      mode: record.mode,
      continueMode: config.continueMode,
      continueText: config.continueText,
      judgePrompt: verdict.prompt,
      request: material.request,
      count: decision.count,
      max: record.max,
      reason: verdict.reason,
    })
    // The judge call took time: anything that changed in the meantime wins.
    signal.throwIfAborted()
    const latest = service.record(sessionId)
    if (latest === undefined || latest.revision !== record.revision || latest.mode !== record.mode) return
    const live = this.deps.agents.get(sessionId)
    if (live?.session === undefined || live.followup === undefined) return
    const fresh = await this.observe(sessionId, signal)
    if (fresh === undefined) return
    if (fresh.some(event => event.seq > turnEnd.seq && (event.type === 'turn/start' || event.type === 'user/message'))) return
    live.followup(createUserMessage({
      content: [{ type: 'text', text: composed.text }],
      source: { kind: AUTO_CONTINUE_KIND, form: 'notice', summary: composed.summary },
    }))
    await this.deps.sessions.flush(live.session)
  }

  /** One observation of the active branch; the lease is always disposed. */
  private async observe(sessionId: string, signal: AbortSignal): Promise<readonly SessionEvent[] | undefined> {
    const observation = await this.deps.sessionQuery.observeSession(brandSessionId(sessionId) as unknown as string, {
      signal,
      projectionMode: 'none',
    })
    try {
      signal.throwIfAborted()
      return activeEventsOf(observation)
    } finally {
      observation[Symbol.dispose]()
    }
  }

  /**
   * One judge call. The judge has its own model field and its own context
   * bucket: it never reuses the ghost material or route. An explicit
   * judgeModel:null means "follow the default chain" — legacy ghost rows are
   * migrated once by the store, so there is no runtime ghost fallback.
   */
  private async judge(
    material: ReturnType<typeof buildJudgeMaterial>,
    mode: 'cautious' | 'bold',
    sessionId: string,
    signal: AbortSignal,
  ): Promise<ReturnType<typeof parseVerdict>> {
    const models = this.deps.models()
    if (models === undefined) return undefined
    try {
      const saved = models.savedJudge?.() ?? undefined
      // A broken auxiliary store forbids the silent paid-model fallback.
      if (saved === undefined && models.auxBroken) return undefined
      const route = resolveFeatureModel(models.host, saved, sessionId)
      const llm = (models.host as { llm?: LlmTextCaller } | undefined)?.llm
      if (!route || !llm) return undefined
      const result = await callLlmText(llm, {
        plugin: PLUGIN_NAME,
        feature: FEATURE_JUDGE,
        // Judge context is the human request alone — never the ghost context.
        context: [JSON.stringify({ request: material.request })],
        route,
        sessionId,
        signal: AbortSignal.any([signal, models.signal]),
        maxTokens: 600,
        configure: (controls, model) => {
          const effort = model.reasoning?.efforts[0]?.id
          return { ...controls, ...(effort === undefined ? {} : { reasoningEffort: effort }) }
        },
        system: judgeSystem(mode),
        text: JSON.stringify({
          response: material.response,
          tools: material.tools,
          ...material.todos === undefined ? {} : { todos: material.todos },
          autoContinues: material.autoContinues,
        }),
      })
      const verdict = parseVerdict(result.text, mode)
      if (verdict === undefined) {
        this.deps.log?.debug?.('session-manager: auto-continue judge returned an unreadable verdict')
      }
      return verdict
    } catch (error) {
      if (signal.aborted) return undefined
      this.deps.log?.debug?.(`session-manager: auto-continue judge failed: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  /** Abort every pending evaluation and wait for them to settle. */
  async dispose(): Promise<void> {
    this.disposed = true
    const pending = [...this.inflight.values()]
    for (const entry of pending) entry.controller.abort()
    await Promise.allSettled(pending.map(entry => entry.done))
  }
}
