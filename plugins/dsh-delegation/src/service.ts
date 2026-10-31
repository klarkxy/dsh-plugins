import { isSubagentSession } from '@klarkxy/dsh-plugin-kit/contracts'
import {
  DELEGATION_TOOLS, type DelegationSessionStatus, type DelegationSettings,
} from './contracts.ts'
import { parseSession, parseSettings, SETTINGS_KEY, type SessionDelegation } from './storage.ts'
import type { DelegationSessionLike } from './policy.ts'

export class DelegationError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'DelegationError'
    this.code = code
  }
}

export interface DelegationTableLike<V> {
  get(key: string): V | undefined
  put(key: string, value: V): Promise<void>
}

export interface DelegationAgentLike {
  readonly id: string
  readonly session?: DelegationSessionLike
  /** Claims the host's idle phase; waking input waits until this task settles. */
  runMaintenance?<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>
}

/** Cold-session read handle from the host's session query engine. */
export interface DelegationObservationLike {
  readonly header?: unknown
  [Symbol.dispose](): void
}

export interface DelegationServiceDeps {
  /** Parsed global settings row (one key: 'global'). */
  readonly settings: DelegationTableLike<DelegationSettings>
  /** Parsed per-session rows (key: session id). */
  readonly records: DelegationTableLike<SessionDelegation>
  readonly sessionStore?: { get(id: string): DelegationSessionLike | undefined }
  readonly agents?: { get(id: string): DelegationAgentLike | undefined }
  readonly tools?: { get(name: string, scope?: unknown): unknown }
  /** Durable turn-boundary projection, including inherited and resumed turns. */
  readonly hasStarted?: (session: DelegationSessionLike) => boolean
  /** Reads persisted headers for sessions that are not live (cold sessions). */
  readonly sessionQuery?: {
    observeSession(id: string, options: { signal?: AbortSignal; projectionMode?: string }): Promise<DelegationObservationLike>
  }
}

/**
 * In-process CAS over the two domain tables. Table `get` is synchronous, so a
 * per-key promise chain serializes check-and-write: two concurrent updates can
 * never both pass the revision check, and a caller only hears success after
 * `put` resolves.
 */
export class DelegationService {
  private readonly deps: DelegationServiceDeps
  private readonly chains = new Map<string, Promise<void>>()

  constructor(deps: DelegationServiceDeps) {
    this.deps = deps
  }

  private enqueue<T>(key: string, work: () => Promise<T>): Promise<T> {
    const pending = this.chains.get(key) ?? Promise.resolve()
    const result = pending.then(work, work)
    this.chains.set(key, result.then(() => {}, () => {}))
    return result
  }

  getSettings(): DelegationSettings {
    return parseSettings(this.deps.settings.get(SETTINGS_KEY))
  }

  updateSettings(defaultEnabled: boolean, expectedRevision: number): Promise<DelegationSettings> {
    return this.enqueue('settings', async () => {
      const current = this.getSettings()
      if (current.revision !== expectedRevision) {
        throw new DelegationError('stale', 'dsh-delegation: settings changed; refresh and retry')
      }
      const next: DelegationSettings = { revision: current.revision + 1, defaultEnabled }
      await this.deps.settings.put(SETTINGS_KEY, next)
      return next
    })
  }

  /** The parsed session row; undefined means no record (off, revision 0). */
  record(sessionId: string): SessionDelegation | undefined {
    return parseSession(this.deps.records.get(sessionId))
  }

  private locked(session: DelegationSessionLike | undefined, agent: DelegationAgentLike | undefined): boolean {
    // A cold or incompletely composed session cannot safely race prompt admission.
    return !session || !agent?.runMaintenance || this.deps.hasStarted?.(session) !== false
  }

  /**
   * The session header: live sessions read the store snapshot; a cold session
   * is resolved through the query engine and the observation is always
   * disposed before returning. Unknown sessions throw `no-session`.
   */
  private async requireHeader(sessionId: string, signal?: AbortSignal): Promise<unknown> {
    const live = this.deps.sessionStore?.get(sessionId)
    if (live) return live.header
    const query = this.deps.sessionQuery
    if (!query) throw new DelegationError('no-session', `dsh-delegation: no live session ${sessionId}`)
    let observation: DelegationObservationLike
    try {
      observation = await query.observeSession(sessionId, { signal, projectionMode: 'none' })
    } catch {
      throw new DelegationError('no-session', `dsh-delegation: no session ${sessionId}`)
    }
    try {
      return observation.header
    } finally {
      observation[Symbol.dispose]()
    }
  }

  async sessionStatus(sessionId: string, signal?: AbortSignal): Promise<DelegationSessionStatus> {
    const session = this.deps.sessionStore?.get(sessionId)
    const header = session ? session.header : await this.requireHeader(sessionId, signal)
    const agent = session ? this.deps.agents?.get(sessionId) : undefined
    const capable = agent === undefined
      ? null
      : DELEGATION_TOOLS.some(name => this.deps.tools?.get(name, agent) !== undefined)
    const record = this.record(sessionId)
    return {
      sessionId,
      role: isSubagentSession({ header }) ? 'executor' : 'coordinator',
      enabled: record?.enabled ?? false,
      revision: record?.revision ?? 0,
      locked: this.locked(session, agent),
      capable,
    }
  }

  async updateSession(sessionId: string, enabled: boolean, expectedRevision: number, signal?: AbortSignal): Promise<DelegationSessionStatus> {
    const session = this.deps.sessionStore?.get(sessionId)
    const header = session ? session.header : await this.requireHeader(sessionId, signal)
    if (isSubagentSession({ header })) {
      throw new DelegationError('not-top-level', 'dsh-delegation: only a top-level session carries the switch')
    }
    await this.enqueue(`session:${sessionId}`, async () => {
      const live = this.deps.sessionStore?.get(sessionId)
      const agent = this.deps.agents?.get(sessionId)
      const requireEditable = () => {
        if (this.locked(live, agent)) {
          throw new DelegationError('session-locked', 'dsh-delegation: choose delegation before the session starts')
        }
      }
      requireEditable()
      let entered = false
      try {
        // The host holds first-turn input while storage commits. Without this
        // guard, a slow save could change the policy after the first assembly.
        await agent!.runMaintenance!(async maintenanceSignal => {
          entered = true
          requireEditable()
          maintenanceSignal.throwIfAborted()
          signal?.throwIfAborted()
          const current = this.record(sessionId)
          const revision = current?.revision ?? 0
          if (revision !== expectedRevision) {
            throw new DelegationError('stale', 'dsh-delegation: session state changed; refresh and retry')
          }
          await this.deps.records.put(sessionId, { enabled, revision: revision + 1 })
        })
      } catch (error) {
        if (!entered) throw new DelegationError('session-busy', 'dsh-delegation: session is busy; refresh and retry')
        throw error
      }
    })
    return this.sessionStatus(sessionId, signal)
  }

  /**
   * `agent/created` seeding. Only a fresh ('startup') non-subagent session gets
   * an initial row: a human fork inherits its parent's flag, every other new
   * top-level session takes the current `defaultEnabled`. Resumed, cleared and
   * compacted sessions keep whatever they already have — and stay off when
   * they predate the plugin.
   */
  async seedSession(agent: DelegationAgentLike, source: string): Promise<void> {
    if (source !== 'startup') return
    const session = agent.session
    if (!session || isSubagentSession(session)) return
    const id = session.id
    await this.enqueue(`session:${id}`, async () => {
      if (this.record(id)) return
      const parentId = typeof session.header?.parentSession === 'string' ? session.header.parentSession : undefined
      const inherited = parentId ? this.record(parentId) : undefined
      const enabled = inherited?.enabled ?? this.getSettings().defaultEnabled
      await this.deps.records.put(id, { enabled, revision: 1 })
    })
  }
}
