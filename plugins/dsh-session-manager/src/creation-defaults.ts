/**
 * New-session defaults mirroring: a preset picked on a blank top-level
 * session is also persisted into the host Settings fields the creation flow
 * reads — `agent-preset-registry.selectedDefault` and
 * `permission.defaultPreset` — so the next new session opens with the
 * last-used choice.
 *
 * Host rules kept deliberately:
 * - `permission.defaultPreset` accepts only `catalog().defaultOptions`
 *   entries; session-only `auto` and derived `custom` are skipped.
 * - `selectedDefault` accepts roster entries only; unknown or broken ids are
 *   skipped (writing one would fail every later create at resolve).
 * - Writes use the official volatile path `settings.describe` +
 *   `settings.mutate` fenced by the descriptor revision; volatile edits
 *   reconcile live, nothing restarts.
 * - Feed-forward only: the mirror records a qualifying pick, never rewrites
 *   an in-flight session, and never fires on the host's own seed events.
 */
import { isSubagentSession } from '@klarkxy/dsh-plugin-kit/contracts'

export const AGENT_PRESET_SETTINGS_NS = 'agent-preset-registry'
export const PERMISSION_SETTINGS_NS = 'permission'
export const AGENT_PRESET_EVENT = 'agent-preset/selected'
export const PERMISSION_PRESET_EVENT = 'permission/preset'

/** One `ctx.settings.describe()` row, narrowed to what the mirror needs. */
export interface CreationSettingsDescriptor {
  readonly ns: string
  readonly value?: unknown
  readonly user?: unknown
  readonly revision: number
}

/** Official Settings service, narrowed to volatile writes. */
export interface CreationSettingsLike {
  describe(): readonly CreationSettingsDescriptor[]
  mutate(ns: string, ops: readonly { op: 'set'; path: readonly string[]; value: unknown }[], expectedRevision?: number): Promise<unknown>
  readonly writable?: boolean
}

export interface PermissionCatalogLike {
  readonly defaultOptions?: readonly { readonly value: string }[]
}

export interface AgentPresetRosterLike {
  readonly presets: readonly { readonly id: string; readonly broken?: string }[]
}

export interface CreationSessionLike {
  readonly id: string
  readonly header?: { readonly parentSession?: unknown }
}

export interface CreationEventLike {
  readonly type: string
  readonly data?: unknown
}

export interface CreationDefaultsDeps {
  /** Official Settings service; absent disables the mirror. */
  readonly settings?: CreationSettingsLike
  /** `ctx.permissionPresets`; absent disables the permission half. */
  readonly permissionPresets?: { catalog(): PermissionCatalogLike }
  /** `ctx.agentPresets`; absent disables the preset half. */
  readonly agentPresets?: { remoteExportList(): Promise<AgentPresetRosterLike> }
  /** Live-session lookup; the event's own session is the fallback. */
  readonly sessions?: { get(id: string): CreationSessionLike | undefined }
  /** `turnBoundary` + `permissions` projections; absent fails closed. */
  readonly sessionProjections?: { stateOf(session: unknown, key: string): unknown }
  readonly log?: { warn?(message: string): void }
}

/** Serializes and fences one describe→mutate round per write, in pick order. */
export class CreationDefaultsMirror {
  private readonly deps: CreationDefaultsDeps
  private queue: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(deps: CreationDefaultsDeps) {
    this.deps = deps
  }

  /** `session/event` listener; failures land in the log, never in dispatch. */
  readonly onSessionEvent = (session: CreationSessionLike, event: CreationEventLike): void => {
    if (event.type === AGENT_PRESET_EVENT) {
      const preset = (event.data as { agentPreset?: unknown } | undefined)?.agentPreset
      if (typeof preset === 'string' && preset !== '') {
        void this.tryMirror(session, () => this.mirrorAgentPreset(preset))
      }
      return
    }
    if (event.type === PERMISSION_PRESET_EVENT && !this.isPermissionSeed(session)) {
      const preset = (event.data as { preset?: unknown } | undefined)?.preset
      if (typeof preset === 'string' && preset !== '') {
        void this.tryMirror(session, () => this.mirrorPermission(preset))
      }
    }
  }

  /**
   * `session/event` dispatches synchronously inside `Session.append`, right
   * after the event enters the log. The creation pin appends
   * `permission/preset` before its `sandbox/mode` knob, so while THAT event is
   * delivered the folded projection still shows `sandbox === null`. Any later
   * pick is delivered only after every seed knob is durable. A missing
   * projection answers "seed" — hosts without the permission service produce
   * no picks anyway.
   */
  private isPermissionSeed(session: CreationSessionLike): boolean {
    const state = this.deps.sessionProjections?.stateOf(this.resolve(session), 'permissions') as { sandbox?: string | null } | null | undefined
    return state === undefined || state === null || state.sandbox === null || state.sandbox === undefined
  }

  /** Only a blank human top-level session qualifies: no subagent thread, no
   * fork (it inherits rather than chooses), nothing with an open or past turn. */
  private eligible(session: CreationSessionLike): boolean {
    if (isSubagentSession(session)) return false
    const parent = session.header?.parentSession
    if (typeof parent === 'string' && parent !== '') return false
    if (this.deps.sessionProjections === undefined) return false
    // A missing projection is not "blank": null means the host has not folded
    // a boundary yet, and reading its fields would throw out of the listener.
    const boundary = this.deps.sessionProjections.stateOf(this.resolve(session), 'turnBoundary') as
      { openTurnStartSeq: unknown; lastTurn: number } | null | undefined
    return boundary != null && boundary.openTurnStartSeq === null && boundary.lastTurn === 0
  }

  private resolve(session: CreationSessionLike): CreationSessionLike {
    return this.deps.sessions?.get(session.id) ?? session
  }

  private async tryMirror(session: CreationSessionLike, work: () => Promise<void>): Promise<void> {
    if (this.disposed || !this.eligible(session)) return
    const task = this.queue.then(async () => { if (!this.disposed) await work() })
    this.queue = task.then(() => {}, () => {})
    try {
      await task
    } catch (error) {
      this.warn(`creation default mirror failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async writeNamespace(ns: string, field: string, value: string): Promise<void> {
    const settings = this.deps.settings
    if (settings === undefined || settings.writable === false) return
    for (let attempt = 0; attempt < 2; attempt++) {
      if (this.disposed) return
      const descriptor = settings.describe().find(row => row.ns === ns)
      if (descriptor === undefined) return
      const layer = descriptor.user !== undefined ? descriptor.user : descriptor.value
      if ((layer as Record<string, unknown> | undefined)?.[field] === value) return
      try {
        await settings.mutate(ns, [{ op: 'set', path: [field], value }], descriptor.revision)
        return
      } catch (error) {
        // A concurrent settings write bumps the revision; re-describe once.
        if (attempt === 1 || !/revision|stale|changed since/i.test(error instanceof Error ? error.message : String(error))) throw error
      }
    }
  }

  private async mirrorAgentPreset(preset: string): Promise<void> {
    const roster = await this.deps.agentPresets?.remoteExportList()
    const row = roster?.presets.find(entry => entry.id === preset)
    if (row === undefined || row.broken !== undefined) return
    await this.writeNamespace(AGENT_PRESET_SETTINGS_NS, 'selectedDefault', preset)
  }

  private async mirrorPermission(preset: string): Promise<void> {
    const catalog = this.deps.permissionPresets?.catalog()
    if (!catalog?.defaultOptions?.some(option => option.value === preset)) return
    await this.writeNamespace(PERMISSION_SETTINGS_NS, 'defaultPreset', preset)
  }

  dispose(): void {
    this.disposed = true
  }

  private warn(text: string): void {
    this.deps.log?.warn?.(`dsh-session-manager: ${text}`)
  }
}
