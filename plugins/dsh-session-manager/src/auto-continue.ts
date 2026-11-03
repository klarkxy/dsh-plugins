/**
 * Per-session auto-continue state: one durable row per session, edited only
 * before the first turn through the same CAS + maintenance-phase discipline
 * as the delegation switch. The table may be absent while storage is
 * unmounted; in that state status reads as locked 'off' and updates fail
 * 'unavailable'.
 */
import { isSubagentSession } from '@klarkxy/dsh-plugin-kit/contracts'
import type { AutoContinueMode, AutoContinueStatus, ResolvedConfig } from './contracts.ts'
import { parseAutoContinue, type SessionAutoContinue } from './storage.ts'

export class AutoContinueError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'AutoContinueError'
    this.code = code
  }
}

export interface AutoContinueTableLike {
  get(key: string): unknown
  put(key: string, value: SessionAutoContinue): Promise<void>
}

export interface AutoContinueSessionLike {
  readonly id: string
  readonly header?: unknown
}

export interface AutoContinueAgentLike {
  readonly id: string
  readonly session?: AutoContinueSessionLike
  /** Claims the host's idle phase; waking input waits until this task settles. */
  runMaintenance?<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>
}

/** Cold-session read handle from the host's session query engine. */
export interface AutoContinueObservationLike {
  readonly header?: unknown
  [Symbol.dispose](): void
}

export interface AutoContinueServiceDeps {
  /** Parsed per-session rows (key: session id); undefined while storage is unmounted. */
  readonly records: () => AutoContinueTableLike | undefined
  readonly sessionStore?: { get(id: string): AutoContinueSessionLike | undefined }
  readonly agents?: { get(id: string): AutoContinueAgentLike | undefined }
  /** Durable turn-boundary projection, including inherited and resumed turns. */
  readonly hasStarted?: (session: AutoContinueSessionLike) => boolean
  /** Reads persisted headers for sessions that are not live (cold sessions). */
  readonly sessionQuery?: {
    observeSession(id: string, options: { signal?: AbortSignal; projectionMode?: string }): Promise<AutoContinueObservationLike>
  }
  readonly config: () => Pick<ResolvedConfig, 'autoContinueMode' | 'autoContinueMax'>
}

/** In-process CAS over the auto-continue table, serialized per session key. */
export class AutoContinueService {
  private readonly deps: AutoContinueServiceDeps
  private readonly chains = new Map<string, Promise<void>>()

  constructor(deps: AutoContinueServiceDeps) {
    this.deps = deps
  }

  private enqueue<T>(key: string, work: () => Promise<T>): Promise<T> {
    const pending = this.chains.get(key) ?? Promise.resolve()
    const result = pending.then(work, work)
    this.chains.set(key, result.then(() => {}, () => {}))
    return result
  }

  /** The parsed session row; undefined means no record (off, revision 0). */
  record(sessionId: string): SessionAutoContinue | undefined {
    const table = this.deps.records()
    return table === undefined ? undefined : parseAutoContinue(table.get(sessionId))
  }

  private locked(session: AutoContinueSessionLike | undefined, agent: AutoContinueAgentLike | undefined): boolean {
    // A cold or incompletely composed session cannot safely race prompt admission.
    return !session || !agent?.runMaintenance || this.deps.hasStarted?.(session) !== false
  }

  private async requireHeader(sessionId: string, signal?: AbortSignal): Promise<unknown> {
    const live = this.deps.sessionStore?.get(sessionId)
    if (live) return live.header
    const query = this.deps.sessionQuery
    if (!query) throw new AutoContinueError('no-session', `session-manager: no live session ${sessionId}`)
    let observation: AutoContinueObservationLike
    try {
      observation = await query.observeSession(sessionId, { signal, projectionMode: 'none' })
    } catch {
      throw new AutoContinueError('no-session', `session-manager: no session ${sessionId}`)
    }
    try {
      return observation.header
    } finally {
      observation[Symbol.dispose]()
    }
  }

  async status(sessionId: string, signal?: AbortSignal): Promise<AutoContinueStatus> {
    const session = this.deps.sessionStore?.get(sessionId)
    const header = session ? session.header : await this.requireHeader(sessionId, signal)
    const record = this.record(sessionId)
    const table = this.deps.records()
    const config = this.deps.config()
    return {
      sessionId,
      role: isSubagentSession({ header }) ? 'executor' : 'coordinator',
      mode: record?.mode ?? 'off',
      max: record?.max ?? config.autoContinueMax,
      revision: record?.revision ?? 0,
      locked: table === undefined ? true : this.locked(session, this.deps.agents?.get(sessionId)),
    }
  }

  async update(sessionId: string, mode: AutoContinueMode, expectedRevision: number, signal?: AbortSignal): Promise<AutoContinueStatus> {
    const table = this.deps.records()
    if (table === undefined) {
      throw new AutoContinueError('unavailable', 'session-manager: auto-continue storage is not mounted')
    }
    const session = this.deps.sessionStore?.get(sessionId)
    const header = session ? session.header : await this.requireHeader(sessionId, signal)
    if (isSubagentSession({ header })) {
      throw new AutoContinueError('not-top-level', 'session-manager: only a top-level session carries auto-continue')
    }
    await this.enqueue(`session:${sessionId}`, async () => {
      const live = this.deps.sessionStore?.get(sessionId)
      const agent = this.deps.agents?.get(sessionId)
      const requireEditable = () => {
        if (this.locked(live, agent)) {
          throw new AutoContinueError('session-locked', 'session-manager: choose auto-continue before the session starts')
        }
      }
      requireEditable()
      let entered = false
      try {
        // The host holds first-turn input while storage commits. Without this
        // guard, a slow save could change the mode after the first assembly.
        await agent!.runMaintenance!(async maintenanceSignal => {
          entered = true
          requireEditable()
          maintenanceSignal.throwIfAborted()
          signal?.throwIfAborted()
          const current = this.record(sessionId)
          const revision = current?.revision ?? 0
          if (revision !== expectedRevision) {
            throw new AutoContinueError('stale', 'session-manager: session state changed; refresh and retry')
          }
          await table.put(sessionId, { mode, max: this.deps.config().autoContinueMax, revision: revision + 1 })
        })
      } catch (error) {
        if (!entered) throw new AutoContinueError('session-busy', 'session-manager: session is busy; refresh and retry')
        throw error
      }
    })
    return this.status(sessionId, signal)
  }

  /**
   * `agent/created` seeding. Only a fresh ('startup') non-subagent session gets
   * an initial row: a human fork inherits its parent's choice, every other new
   * top-level session takes the configured default. Resumed, cleared and
   * compacted sessions keep whatever they already have — and stay off when
   * they predate the plugin.
   */
  async seed(agent: AutoContinueAgentLike, source: string): Promise<void> {
    if (source !== 'startup') return
    const session = agent.session
    if (!session || isSubagentSession(session)) return
    const id = session.id
    await this.enqueue(`session:${id}`, async () => {
      if (this.record(id)) return
      const table = this.deps.records()
      if (table === undefined) return
      const parentId = typeof (session.header as { parentSession?: unknown } | undefined)?.parentSession === 'string'
        ? (session.header as { parentSession: string }).parentSession
        : undefined
      const inherited = parentId ? this.record(parentId) : undefined
      const config = this.deps.config()
      await table.put(id, {
        mode: inherited?.mode ?? config.autoContinueMode,
        max: inherited?.max ?? config.autoContinueMax,
        revision: 1,
      })
    })
  }
}
