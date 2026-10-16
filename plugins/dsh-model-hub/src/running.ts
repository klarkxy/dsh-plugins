/**
 * dsh-model-hub — running subagent routes (host half).
 *
 * Read-only live view answering "which model and reasoning effort is each
 * running subagent actually using". `subagent/start` and `subagent/end`
 * maintain the live set; each child's effective route is read from its
 * session epoch header (`session.requestHeader()`) and kept current through
 * the session's own `request/header` events (reason `change` covers mid-run
 * model switches). Children already running when this plugin (re)loads are
 * recovered from the live agent registry via `isSubagentSession`.
 *
 * The effective route is session data recorded by the host; this tracker
 * never writes to sessions or settings. Display-only invalidations reuse the
 * model-settings change channel with RUNNING_NAMESPACE so open pages refetch.
 */
import { isSubagentSession } from '@klarkxy/dsh-plugin-kit/contracts'

/** Invalidation namespace for the running-subagent view; carries no settings. */
export const RUNNING_NAMESPACE = '@klarkxy/dsh-model-hub/running-subagents'

/** Effective child route recorded by the host epoch header. */
export interface RunningRoute {
  provider: string
  model: string
  reasoningEffort?: string
}

/** One live subagent run as served to the browser half. */
export interface RunningSubagentEntry {
  /** Child session id. */
  id: string
  /** Delegation label from the subagent catalog, when resolvable. */
  label?: string
  parentSessionId?: string
  /** Subagent provider owning the run; absent for registry-recovered entries. */
  providerName?: string
  /** False for non-local providers: no local agent exists to read a route from. */
  local: boolean
  startedAt?: number
  /** Effective route of the latest epoch; absent before the first model request. */
  route?: RunningRoute
  /** True when the displayed effort is the adapter default, not an explicit pick. */
  effortIsAdapterDefault?: boolean
}

/** Snapshot served by the `cast.running` endpoint. */
export interface RunningSubagentsState {
  revision: number
  entries: RunningSubagentEntry[]
}

interface EpochHeaderLike {
  config?: { provider?: unknown; model?: unknown; reasoningEffort?: unknown }
  adapterDefaults?: { reasoningEffort?: unknown }
}

interface SessionLike {
  id?: unknown
  header?: { parentSession?: unknown; createdAt?: unknown }
  requestHeader?: () => EpochHeaderLike | undefined
}

interface AgentLike {
  id: string
  session?: SessionLike
}

export interface RunningAgentsLike {
  get(id: string): AgentLike | undefined
  list(): AgentLike[]
}

export interface RunningSubagentsServiceLike {
  listChildren(parentSessionId: string, signal?: AbortSignal): Promise<readonly { id: string; label?: string }[]>
}

interface SubagentRunInfoLike {
  id: string
  provider?: string
  local?: boolean
}

interface SessionEventLike {
  type?: unknown
  data?: { header?: EpochHeaderLike }
}

/** Structural event face; the host context satisfies it directly. */
export interface RunningEvents {
  on(name: 'subagent/start', callback: (info: SubagentRunInfoLike) => void): unknown
  on(name: 'subagent/end', callback: (info: SubagentRunInfoLike) => void): unknown
  on(name: 'agent/disposed', callback: (payload: { agent: { id: string } }) => void): unknown
  on(name: 'session/event', callback: (session: SessionLike, event: SessionEventLike) => void): unknown
}

export interface RunningDeps {
  events: RunningEvents
  /** Live agent registry; optional so the view degrades to an empty list. */
  agents?: RunningAgentsLike
  /** Subagent catalog used only to resolve delegation labels. */
  subagents?: RunningSubagentsServiceLike
  /** Called with the new revision whenever the served snapshot changed. */
  notify(revision: number): void
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Normalize one epoch header into the display route plus the adapter-default flag. */
export function routeFromHeader(header: EpochHeaderLike | undefined): { route?: RunningRoute; effortIsAdapterDefault?: boolean } {
  const config = header?.config
  const provider = text(config?.provider)
  const model = text(config?.model)
  if (!provider || !model) return {}
  const effort = text(config?.reasoningEffort)
  return {
    route: effort ? { provider, model, reasoningEffort: effort } : { provider, model },
    /* adapterDefaults.reasoningEffort === true marks the recorded effort as
     * adapter-owned rather than explicitly selected (same rule llm-call.ts
     * applies before inheriting a session route). */
    ...(effort && header?.adapterDefaults?.reasoningEffort === true ? { effortIsAdapterDefault: true } : {}),
  }
}

function sameRoute(left: Pick<RunningSubagentEntry, 'route' | 'effortIsAdapterDefault'>, right: Pick<RunningSubagentEntry, 'route' | 'effortIsAdapterDefault'>): boolean {
  return left.route?.provider === right.route?.provider
    && left.route?.model === right.route?.model
    && left.route?.reasoningEffort === right.route?.reasoningEffort
    && left.effortIsAdapterDefault === right.effortIsAdapterDefault
}

export function createRunningTracker(deps: RunningDeps): { list(signal?: AbortSignal): Promise<RunningSubagentsState> } {
  const entries = new Map<string, RunningSubagentEntry>()
  let revision = 0
  const bump = () => deps.notify(++revision)

  const add = (id: string, info?: SubagentRunInfoLike): void => {
    const agent = deps.agents?.get(id)
    const session = agent?.session
    const next = routeFromHeader(session?.requestHeader?.())
    const existing = entries.get(id)
    if (existing) {
      const providerName = info?.provider ?? existing.providerName
      const local = info?.local ?? existing.local
      const changed = existing.providerName !== providerName || existing.local !== local || !sameRoute(existing, next)
      existing.providerName = providerName
      existing.local = local
      existing.route = next.route
      existing.effortIsAdapterDefault = next.effortIsAdapterDefault
      if (changed) bump()
      return
    }
    entries.set(id, {
      id,
      local: info?.local !== false,
      ...(info?.provider ? { providerName: info.provider } : {}),
      ...(typeof session?.header?.parentSession === 'string' && session.header.parentSession
        ? { parentSessionId: session.header.parentSession } : {}),
      ...(typeof session?.header?.createdAt === 'number' ? { startedAt: session.header.createdAt } : {}),
      route: next.route,
      effortIsAdapterDefault: next.effortIsAdapterDefault,
    })
    bump()
  }

  const remove = (id: string): void => {
    if (entries.delete(id)) bump()
  }

  /* Children already running when this plugin (re)loads never emit another
   * subagent/start; recover them from the live registry. The origin/depth
   * guard keeps top-level conversations and native human forks out. */
  try {
    for (const agent of deps.agents?.list() ?? []) {
      if (agent?.id && isSubagentSession(agent.session)) add(agent.id)
    }
  } catch { /* A registry failure must not break the plugin load. */ }

  deps.events.on('subagent/start', info => { if (typeof info?.id === 'string' && info.id) add(info.id, info) })
  deps.events.on('subagent/end', info => { if (typeof info?.id === 'string') remove(info.id) })
  /* Belt and braces: a child whose run end notification was missed still
   * leaves the list when its agent is disposed. */
  deps.events.on('agent/disposed', payload => { if (typeof payload?.agent?.id === 'string') remove(payload.agent.id) })
  deps.events.on('session/event', (session, event) => {
    if (event?.type !== 'request/header') return
    const id = typeof session?.id === 'string' ? session.id : undefined
    const entry = id ? entries.get(id) : undefined
    if (!entry) return
    const next = routeFromHeader(event.data?.header)
    if (sameRoute(entry, next)) return
    entry.route = next.route
    entry.effortIsAdapterDefault = next.effortIsAdapterDefault
    bump()
  })

  return {
    /* Labels live in the subagent catalog, not the session header; resolve
     * them best-effort per parent and cache them on the entry. */
    async list(signal) {
      const pendingParents = new Set<string>()
      for (const entry of entries.values()) {
        if (entry.label === undefined && entry.parentSessionId) pendingParents.add(entry.parentSessionId)
      }
      if (deps.subagents && pendingParents.size) {
        await Promise.allSettled([...pendingParents].map(async parent => {
          const children = await deps.subagents!.listChildren(parent, signal)
          const labels = new Map(children.map(child => [child.id, child.label]))
          for (const entry of entries.values()) {
            if (entry.parentSessionId !== parent || entry.label !== undefined) continue
            const label = labels.get(entry.id)
            if (typeof label === 'string' && label.trim()) entry.label = label.trim()
          }
        }))
      }
      const snapshot = [...entries.values()]
        .map(entry => ({ ...entry, route: entry.route ? { ...entry.route } : undefined }))
        .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0) || a.id.localeCompare(b.id))
      return { revision, entries: snapshot }
    },
  }
}
