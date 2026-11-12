/**
 * Thin adapters over the host services dot drives. Everything the service
 * needs from DSH goes through {@link DotHost}, so the orchestration logic is
 * tested against a fake and the host surface stays in one file.
 *
 * Host contracts (DSH 0.2.2-rc.1 type declarations):
 * - sessionController: create / prompt / cancel / list / resolveAgent for task
 *   sessions, modelCatalog / selectModel for the model a task runs on
 *   (@deepseek-ai/dsh-api-session-controller)
 * - agents: create / resume / get for dot's own session, which carries the
 *   subagent origin so the sidebar leaves it out (@deepseek-ai/dsh-agent)
 * - workspaceRegistry: create / list / archiveSession (@deepseek-ai/dsh-workspace)
 * - sessionQuery: readSession + extractSessionEventText for the latest reply,
 *   and the stored log of dot's earlier segments
 * - permissionPresets: set (@deepseek-ai/dsh-permission-presets)
 * - llm: stream, for the note dot writes when its conversation moves to a new
 *   segment; the request replays the segment's own prefix the way
 *   dsh-compaction-basic's summarizer does, so the provider cache is reused
 */
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { assembleContextFor, installModelSelection } from '@deepseek-ai/dsh-agent'
import { BlockAssembler, createUserMessage, type MessageSource } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { extractSessionEventText } from '@deepseek-ai/dsh-session-query'
import type { RawEvent } from './chat.ts'
import { contextView, EMPTY_SCAN, foldScan, type ContextScan, type PreTurnContext, type ProjectionValues } from './context.ts'
import { assembledSurface, type AssembledPromptInput } from './context-surface.ts'
import type { DotContextUsage, DotContextView, ModelChoice, TrajectoryView } from './contracts.ts'
import type { CatalogModel, TaskModelCatalog } from './task-models.ts'
import type { CatalogPreset, TaskPresetCatalog } from './task-presets.ts'
import { foldTrajectory } from './trajectory.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'agent-message': { kind: 'agent-message'; form: 'relay'; senderSessionId: SessionId }
  }
}

export const FULL_ACCESS = 'danger-full-access'

export interface WorkspaceRow { readonly id: string; readonly path: string; readonly title: string; readonly sessionCount: number }
export interface SessionRow {
  readonly sessionId: string
  readonly cwd?: string
  readonly running: boolean
  readonly updatedAt: number
  readonly blank: boolean
  readonly subagent: boolean
  readonly archived: boolean
}

export interface DotHost {
  listWorkspaces(): WorkspaceRow[]
  createWorkspace(path: string, title?: string): Promise<WorkspaceRow>
  listSessions(signal: AbortSignal): Promise<SessionRow[]>
  titles(sessionIds: readonly string[], signal: AbortSignal): Promise<Map<string, string>>
  /** Open a top-level session; without a preset it runs on the host's default one. */
  createSession(place: { workspaceId?: string; cwd?: string; preset?: string }): Promise<string>
  /** Agent presets a session can run on, with the one a new session gets by default. */
  listPresets(): Promise<TaskPresetCatalog>
  /** Models a session can run on, with the one a new session gets by default. */
  listModels(): Promise<TaskModelCatalog>
  /** Put a task session on a model; called before its first prompt. */
  selectModel(sessionId: string, choice: ModelChoice): Promise<void>
  /** Switch a live task session to a permission preset; failures are reported, never thrown. */
  setPermission(sessionId: string, preset: string): Promise<boolean>
  /** Deliver as the human's own prompt; used for a task's first instruction. */
  prompt(sessionId: string, text: string, mode: 'queue' | 'steer', signal: AbortSignal): Promise<void>
  /** Deliver as an agent-attributed message and wake the target. */
  relay(targetId: string, senderId: string, text: string): Promise<void>
  cancel(sessionId: string): Promise<void>
  archive(sessionId: string): Promise<void>
  /** Text of the latest assistant output, or undefined when none is readable. */
  latestReply(sessionId: string, maxChars: number): Promise<string | undefined>
  cwdOf(sessionId: string): Promise<string | undefined>

  // ---- dot's own session --------------------------------------------------
  /** Create dot's session under the subagent origin, running the given preset. */
  createDot(cwd: string, preset: string): Promise<string>
  /** Make dot's session live again. @returns false when it cannot serve as dot any more. */
  resumeDot(sessionId: string, preset: string): Promise<boolean>
  /** Transfer any open interactive `show_view` card from an ending segment to the new segment. */
  handoffView?(fromSessionId: string, toSessionId: string): boolean
  /** Let go of a segment dot has left; its log stays readable. */
  releaseDot(sessionId: string): Promise<void>
  /** The whole log of one of dot's segments, live or stored, oldest first. */
  readEvents(sessionId: string): Promise<RawEvent[]>
  /**
   * Ask dot's live session for a text answer to one instruction, outside its
   * log: the request is the session's own prompt and history plus the
   * instruction. Rejects when no answer came back.
   */
  summarize(sessionId: string, instruction: string, maxTokens: number, onUsage?: (usage: DotContextUsage) => void): Promise<string>
  /** The model dot's next segment would run on, as `provider/model@effort`; undefined when none is known. */
  modelKey(): string | undefined
  /** The human's message to dot, optionally carrying notices into the same turn; steers a running turn, starts one when idle. */
  say(sessionId: string, text: string, carriedNotices?: string): Promise<void>
  /** Stop dot's current turn; queued messages stay. */
  stop(sessionId: string): Promise<void>
  /**
   * Point dot's next step at the chosen model, or at the current default when
   * none is chosen. A session remembers the last model it used, so this runs
   * before a delivery to a segment that keeps its model.
   */
  syncModel(sessionId: string): void
  /** Latest events of dot's live session, oldest first. */
  dotEvents(sessionId: string, limit: number): RawEvent[]
  /** Occupancy, composition, usage and compactions of dot's live session. */
  dotContext(sessionId: string): Promise<DotContextView>
  /** dot's session log grouped into turns and steps. */
  dotTrajectory(sessionId: string): TrajectoryView
  isRunning(sessionId: string): boolean
  /** Stop the agents this host created or resumed for dot. */
  dispose(): Promise<void>
}

type Get = (name: string) => unknown

interface Controller {
  create(request: Record<string, unknown>): Promise<{ sessionId: string }>
  prompt(request: Record<string, unknown>, signal: AbortSignal): Promise<unknown>
  cancel(request: { sessionId: string }): unknown
  list(request: Record<string, never>, signal: AbortSignal): Promise<{ items: readonly Record<string, unknown>[] }>
  resolveAgent(sessionId: string): Promise<{ agent?: LiveAgent; error?: { message?: unknown } }>
  selectModel(request: { sessionId: string; provider: string; model: string }): Promise<unknown>
  modelCatalog(): Promise<{
    readonly default?: { readonly provider?: unknown; readonly model?: unknown }
    readonly groups?: readonly { readonly id?: unknown; readonly models?: readonly { readonly id?: unknown; readonly name?: unknown }[] }[]
  }>
}

interface LiveSession {
  readonly id?: string
  readonly header?: { readonly origin?: string; readonly cwd?: string }
  readonly seq?: number
  eventAt?(seq: number): RawEvent | undefined
  requestHeader?(): { readonly config?: { readonly provider?: string; readonly model?: string }; readonly tools?: readonly unknown[] } | undefined
  deriveMessages?(): unknown[]
  toolHistory?(): unknown
}

interface LiveAgent {
  readonly id?: string
  readonly status?: string
  readonly model?: { current(): { provider?: string; model?: string; reasoningEffort?: string } | undefined; select(selection: { provider: string; model: string; reasoningEffort?: string }): void }
  readonly session?: LiveSession
  followup?(message: unknown): void
  steer?(message: unknown): void
  cancel?(cause: { kind: 'user' }, options?: { keepInbox?: boolean }): void
}

interface AgentHandle { readonly agent: LiveAgent; dispose(): Promise<void> }

interface Agents {
  get(id: string): LiveAgent | undefined
  create(options: Record<string, unknown>): Promise<AgentHandle>
  resume(options: Record<string, unknown>): Promise<AgentHandle>
}

interface PresetRegistry {
  resolve(id?: string): Promise<{ id: string }>
  mount(ctx: unknown, id?: string): Promise<unknown>
  /** Default preset of a session created without one. */
  readonly defaultId?: string
  list?(): Promise<readonly { readonly id?: unknown; readonly name?: unknown; readonly description?: unknown; readonly broken?: unknown }[]>
}

interface DefaultModel { currentSelection(): { provider?: unknown; model?: unknown; reasoningEffort?: unknown } }

interface Registry {
  create(path: string, title?: string): Promise<{ id: string; path: string; title: string; sessionIds: readonly string[] }>
  list(): { id: string; path: string; title: string; sessionIds: readonly string[] }[]
  archiveSession(sessionId: string, options?: { stopActivity?: boolean }): Promise<void>
  readonly archivedSessionIds?: readonly string[]
}

interface Query {
  readSession(sessionId: string): Promise<{ session: { cwd?: string }; events: readonly { type?: string; seq?: number; time?: number; data?: unknown }[] }>
  readTitleSnapshots?(ids: readonly string[], signal?: AbortSignal): Promise<readonly ({ status: 'fulfilled'; value: { title?: { title?: string } } } | { status: 'rejected' })[]>
}

interface Permissions { set(session: unknown, name: string): void }

interface Projections { snapshot(session: unknown, keys?: readonly string[]): { values: ProjectionValues } }
interface Llm {
  resolveModelInfo(provider: string, model: string): Promise<{ context?: { contextWindow?: number } }>
  stream?(options: Record<string, unknown>): AsyncIterable<unknown>
}
interface ToolSetLike { dispose(): void }
interface ToolsService {
  resolve?(context: Record<string, unknown>): Promise<ToolSetLike>
  schemas?(scope?: unknown, toolSet?: unknown): unknown[]
}
interface SystemPromptService {
  assemble?(context?: Record<string, unknown>): Promise<AssembledPromptInput>
}
interface DeepViewService {
  handoffSession?(fromSessionId: string, toSessionId: string): boolean
}

const CONTEXT_KEYS = ['contextPressure', 'contextBreakdown', 'tokenUsage'] as const
/** A handoff note that takes longer than this is given up. */
const SUMMARY_TIMEOUT_MS = 120_000

export class HostUnavailable extends Error {
  constructor(what: string) { super(`${what} is unavailable on this host`); this.name = 'HostUnavailable' }
}

/** @param modelOf - dot's chosen model, read on every model call; undefined follows the host default. */
export function bindHost(get: Get, log?: (message: string) => void, modelOf?: () => ModelChoice | undefined): DotHost {
  const need = <T,>(name: string): T => {
    const value = get(name) as T | undefined
    if (!value) throw new HostUnavailable(name)
    return value
  }
  const controller = () => need<Controller>('sessionController')
  const registry = () => need<Registry>('workspaceRegistry')
  const query = () => need<Query>('sessionQuery')
  const agents = () => need<Agents>('agents')
  const handles = new Map<string, AgentHandle>()
  /** Incremental log scans of dot's sessions, so the context page reads only new events. */
  const scans = new Map<string, ContextScan>()
  const windows = new Map<string, number>()

  /** Live agent of any session: dot's is read straight from the registry, since the controller refuses subagent-origin sessions. */
  const liveAgent = async (sessionId: string): Promise<LiveAgent> => {
    const live = agents().get(sessionId)
    if (live) return live
    const resolved = await controller().resolveAgent(sessionId)
    if (!resolved.agent) throw new Error(typeof resolved.error?.message === 'string' ? resolved.error.message : `session ${sessionId} has no live agent`)
    return resolved.agent
  }
  const agentOptions = () => {
    const defaults = need<DefaultModel>('agentDefaultModel')
    return {
      get provider() { return modelOf?.()?.provider ?? defaults.currentSelection().provider },
      get model() { return modelOf?.()?.model ?? defaults.currentSelection().model },
      get reasoningEffort() {
        const chosen = modelOf?.()
        return chosen ? chosen.reasoningEffort : defaults.currentSelection().reasoningEffort
      },
    }
  }
  // Same composition the controller uses for its own sessions: model selection, then the preset.
  const setupFor = async (preset: string) => {
    const presets = need<PresetRegistry>('agentPresets')
    const id = (await presets.resolve(preset)).id
    return { id, setup: async (agentCtx: unknown) => { installModelSelection(agentCtx as never); await presets.mount(agentCtx, id) } }
  }
  const permit = (session: unknown, preset: string): boolean => {
    const permissions = get('permissionPresets') as Permissions | undefined
    if (!permissions || session === undefined) return false
    try { permissions.set(session, preset); return true } catch (error) {
      log?.(`dsh-dot: permission preset ${preset} not applied: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }
  const toRow = (w: { id: string; path: string; title: string; sessionIds: readonly string[] }): WorkspaceRow =>
    ({ id: w.id, path: w.path, title: w.title, sessionCount: w.sessionIds.length })
  /** dot's chosen model, or the host default it follows. */
  const wantedModel = (): { provider: string; model: string; reasoningEffort?: string } | undefined => {
    const chosen = modelOf?.()
    const fallback = (get('agentDefaultModel') as DefaultModel | undefined)?.currentSelection()
    const provider = chosen?.provider ?? (typeof fallback?.provider === 'string' ? fallback.provider : undefined)
    const model = chosen?.model ?? (typeof fallback?.model === 'string' ? fallback.model : undefined)
    if (!provider || !model) return undefined
    const effort = chosen ? chosen.reasoningEffort : typeof fallback?.reasoningEffort === 'string' ? fallback.reasoningEffort : undefined
    return { provider, model, ...effort ? { reasoningEffort: effort } : {} }
  }

  return {
    listWorkspaces: () => registry().list().map(toRow),
    createWorkspace: async (path, title) => toRow(await registry().create(path, title)),
    async listSessions(signal) {
      const archived = new Set(registry().archivedSessionIds ?? [])
      const { items } = await controller().list({}, signal)
      return items.map(item => ({
        sessionId: String(item.sessionId),
        ...typeof item.cwd === 'string' ? { cwd: item.cwd } : {},
        running: item.running === true,
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : 0,
        blank: item.blank === true,
        subagent: item.origin === 'subagent' || typeof item.parentSessionId === 'string',
        archived: archived.has(String(item.sessionId)),
      }))
    },
    async titles(sessionIds, signal) {
      const out = new Map<string, string>()
      const read = query().readTitleSnapshots
      if (typeof read !== 'function' || sessionIds.length === 0) return out
      const results = await read.call(query(), sessionIds, signal)
      results.forEach((result, index) => {
        const title = result.status === 'fulfilled' ? result.value.title?.title : undefined
        if (title) out.set(sessionIds[index]!, title)
      })
      return out
    },
    async createSession(place) {
      const created = await controller().create({ ...place.workspaceId ? { workspaceId: place.workspaceId } : { cwd: place.cwd }, ...place.preset ? { agentPreset: place.preset } : {} })
      return created.sessionId
    },
    async listPresets() {
      const registry = need<PresetRegistry>('agentPresets')
      if (typeof registry.list !== 'function') throw new HostUnavailable('agentPresets.list')
      const presets: CatalogPreset[] = []
      for (const entry of await registry.list()) {
        if (typeof entry.id !== 'string' || !entry.id) continue
        presets.push({
          id: entry.id,
          ...typeof entry.name === 'string' && entry.name ? { name: entry.name } : {},
          ...typeof entry.description === 'string' && entry.description ? { description: entry.description } : {},
          ...typeof entry.broken === 'string' && entry.broken ? { broken: entry.broken } : {},
        })
      }
      const fallback = registry.defaultId
      return { presets, ...typeof fallback === 'string' && fallback ? { fallback } : {} }
    },
    async listModels() {
      const catalog = await controller().modelCatalog()
      const models: CatalogModel[] = []
      for (const group of catalog.groups ?? []) {
        if (typeof group.id !== 'string' || !group.id) continue
        for (const entry of group.models ?? []) {
          if (typeof entry.id !== 'string' || !entry.id) continue
          models.push({ provider: group.id, model: entry.id, name: typeof entry.name === 'string' && entry.name ? entry.name : entry.id })
        }
      }
      const fallback = catalog.default
      return {
        models,
        ...typeof fallback?.provider === 'string' && fallback.provider && typeof fallback.model === 'string' && fallback.model ? { fallback: { provider: fallback.provider, model: fallback.model } } : {},
      }
    },
    async selectModel(sessionId, choice) {
      await controller().selectModel({ sessionId, provider: choice.provider, model: choice.model })
    },
    async setPermission(sessionId, preset) {
      try { return permit((await liveAgent(sessionId)).session, preset) } catch { return false }
    },
    async prompt(sessionId, text, mode, signal) {
      await controller().prompt({ requestId: randomUUID(), sessionId, mode, content: [{ type: 'text', text }] }, signal)
    },
    async relay(targetId, senderId, text) {
      const agent = await liveAgent(targetId)
      if (typeof agent.followup !== 'function') throw new Error('target session has no live agent')
      const source = { kind: 'agent-message', form: 'relay', senderSessionId: senderId as SessionId } as MessageSource
      agent.followup(createUserMessage({ content: [{ type: 'text' as const, text }], source }))
    },
    async cancel(sessionId) { await controller().cancel({ sessionId }) },
    async archive(sessionId) { await registry().archiveSession(sessionId, { stopActivity: true }) },
    async latestReply(sessionId, maxChars) {
      const log = await query().readSession(sessionId)
      for (let index = log.events.length - 1; index >= 0; index--) {
        const event = log.events[index]!
        if (event.type !== 'assistant/message') continue
        const text = extractSessionEventText(event as Parameters<typeof extractSessionEventText>[0]).trim()
        if (text) return text.length > maxChars ? text.slice(-maxChars) : text
      }
      return undefined
    },
    async cwdOf(sessionId) {
      try { return (await query().readSession(sessionId)).session.cwd } catch { return undefined }
    },

    async createDot(cwd, preset) {
      await mkdir(cwd, { recursive: true })
      const { id, setup } = await setupFor(preset)
      const sessionId = `session-${randomUUID()}`
      const handle = await agents().create({ sessionId, agentOptions: agentOptions(), meta: { cwd, origin: 'subagent', agentPreset: id }, setup })
      handles.set(sessionId, handle)
      // dot has no file or shell tools; its own calls never need a human approval.
      permit(handle.agent.session, FULL_ACCESS)
      return sessionId
    },
    async resumeDot(sessionId, preset) {
      const live = agents().get(sessionId)
      if (live) return live.session?.header?.origin === 'subagent'
      try {
        const { setup } = await setupFor(preset)
        const handle = await agents().resume({ resumeSessionId: sessionId, agentOptions: agentOptions(), setup })
        handles.set(sessionId, handle)
        if (handle.agent.session?.header?.origin === 'subagent') return true
        // An earlier build kept dot in an ordinary session; hand that one back to the host.
        handles.delete(sessionId)
        await handle.dispose().catch(() => {})
        return false
      } catch (error) {
        log?.(`dsh-dot: could not resume dot's session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`)
        return false
      }
    },
    async say(sessionId, text, carriedNotices) {
      const agent = await liveAgent(sessionId)
      const content = carriedNotices ? `${carriedNotices}\n\n${text}` : text
      // The character count lets the panel and history split the carried notices
      // back out without storing a second copy of their text in the source.
      const source = { kind: 'user', ...carriedNotices ? { dshDot: { carriedChars: carriedNotices.length } } : {} } as MessageSource
      const message = createUserMessage({ content: [{ type: 'text' as const, text: content }], source })
      if (agent.status === 'idle' || typeof agent.steer !== 'function') agent.followup?.(message)
      else agent.steer(message)
    },
    async stop(sessionId) {
      (await liveAgent(sessionId)).cancel?.({ kind: 'user' }, { keepInbox: true })
    },
    handoffView(fromSessionId, toSessionId) {
      try {
        return (get('dshDeepView') as DeepViewService | undefined)?.handoffSession?.(fromSessionId, toSessionId) ?? false
      } catch {
        return false
      }
    },
    async releaseDot(sessionId) {
      scans.delete(sessionId)
      const handle = handles.get(sessionId)
      if (!handle) return
      handles.delete(sessionId)
      await handle.dispose()
    },
    async readEvents(sessionId) {
      const session = agents().get(sessionId)?.session
      if (session && typeof session.seq === 'number' && typeof session.eventAt === 'function') {
        const out: RawEvent[] = []
        for (let seq = 0; seq < session.seq; seq++) {
          const event = session.eventAt(seq)
          if (event) out.push(event)
        }
        return out
      }
      const stored = await query().readSession(sessionId)
      return stored.events.filter((event): event is RawEvent => typeof event.type === 'string')
    },
    async summarize(sessionId, instruction, maxTokens, onUsage) {
      const session = agents().get(sessionId)?.session
      const llm = get('llm') as Llm | undefined
      if (!session || typeof session.requestHeader !== 'function' || typeof session.deriveMessages !== 'function') throw new Error('the session is not live')
      if (typeof llm?.stream !== 'function') throw new HostUnavailable('llm')
      const header = session.requestHeader()
      const config = header?.config
      if (!config?.provider || !config.model) throw new Error('the session has not made a model request yet')
      const assembler = new BlockAssembler()
      const stream = llm.stream({
        provider: config.provider,
        model: config.model,
        messages: [...session.deriveMessages(), { role: 'user', content: [{ type: 'text', text: instruction }] }],
        ...typeof session.toolHistory === 'function' ? { toolHistory: session.toolHistory() } : {},
        ...header?.tools ? { tools: [...header.tools] } : {},
        maxTokens,
        sessionId: session.id ?? sessionId,
        purpose: 'compaction',
        signal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS),
      })
      for await (const chunk of stream) assembler.push(chunk as Parameters<BlockAssembler['push']>[0])
      const finish = assembler.finish as { kind: string; failure?: { message?: string } }
      if (finish.kind === 'error' || finish.kind === 'aborted') throw new Error(finish.failure?.message ?? `the request ended with ${finish.kind}`)
      const usage = assembler.usage as { inputTokens?: unknown; cacheReadTokens?: unknown; cacheWriteTokens?: unknown; outputTokens?: unknown } | undefined
      const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
      if (usage && (typeof usage.inputTokens === 'number' || typeof usage.outputTokens === 'number')) {
        onUsage?.({
          input: num(usage.inputTokens),
          cacheRead: num(usage.cacheReadTokens),
          cacheWrite: num(usage.cacheWriteTokens),
          output: num(usage.outputTokens),
        })
      }
      const text = assembler.blocks().map(block => { const row = block as { type?: string; text?: unknown }; return row.type === 'text' && typeof row.text === 'string' ? row.text : '' }).join('').trim()
      if (!text) throw new Error('the model returned no text')
      return text
    },
    modelKey() {
      const wanted = wantedModel()
      return wanted ? `${wanted.provider}/${wanted.model}@${wanted.reasoningEffort ?? ''}` : undefined
    },
    syncModel(sessionId) {
      const model = agents().get(sessionId)?.model
      const wanted = wantedModel()
      if (!model || !wanted) return
      const current = model.current()
      if (current?.provider === wanted.provider && current.model === wanted.model && current.reasoningEffort === wanted.reasoningEffort) return
      try { model.select(wanted) } catch (error) {
        log?.(`dsh-dot: could not switch dot's model: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
    dotEvents(sessionId, limit) {
      const session = agents().get(sessionId)?.session
      if (!session || typeof session.seq !== 'number' || typeof session.eventAt !== 'function') return []
      const out: RawEvent[] = []
      for (let seq = Math.max(0, session.seq - limit); seq < session.seq; seq++) {
        const event = session.eventAt(seq)
        if (event) out.push(event)
      }
      return out
    },
    async dotContext(sessionId) {
      const agent = agents().get(sessionId)
      const session = agent?.session
      if (!session || typeof session.seq !== 'number' || typeof session.eventAt !== 'function') return { live: false, compactions: 0 }
      let scan = scans.get(sessionId) ?? EMPTY_SCAN
      if (scan.seq > session.seq) scan = EMPTY_SCAN
      if (scan.seq < session.seq) {
        const from = scan.seq
        const events = function* () { for (let seq = from; seq < session.seq!; seq++) { const event = session.eventAt!(seq); if (event) yield event } }
        scan = foldScan(scan, events(), session.seq)
        scans.set(sessionId, scan)
      }
      // Before dot's first request the log names no model yet; the selected one stands in.
      const selected = agent?.model?.current() ?? wantedModel()
      if ((!scan.provider || !scan.model) && selected?.provider && selected.model) {
        scan = { ...scan, provider: selected.provider, model: selected.model }
      }
      let values: ProjectionValues = {}
      try { values = (get('sessionProjections') as Projections | undefined)?.snapshot(session, CONTEXT_KEYS).values ?? {} } catch (error) {
        log?.(`dsh-dot: context projections unavailable: ${error instanceof Error ? error.message : String(error)}`)
      }
      // Before step 1 writes `system/message` and `request/header`, assemble the live prompt and tools so a fresh segment never appears empty.
      let preTurn: PreTurnContext | undefined
      if (!scan.surface?.nodes.some(node => node.category === 'system' || node.category === 'tools')) {
        const systemPrompt = get('systemPrompt') as SystemPromptService | undefined
        const toolsService = get('tools') as ToolsService | undefined
        if (systemPrompt?.assemble || toolsService?.schemas) {
          const signal = AbortSignal.timeout(5_000)
          const modelSelection = selected?.provider && selected.model
            ? { provider: selected.provider, model: selected.model, ...(selected.reasoningEffort ? { reasoningEffort: selected.reasoningEffort } : {}) }
            : undefined
          let toolSet: ToolSetLike | undefined
          try {
            if (typeof toolsService?.resolve === 'function') {
              toolSet = await toolsService.resolve({ agent, ...(modelSelection ? { modelSelection } : {}), signal })
            }
            const assembled = typeof systemPrompt?.assemble === 'function'
              ? await systemPrompt.assemble({
                  ...assembleContextFor(agent as never, signal),
                  ...(modelSelection ? { modelSelection } : {}),
                  ...(toolSet ? { toolSet } : {}),
                })
              : undefined
            const tools = assembled?.tools && assembled.tools.length > 0
              ? assembled.tools
              : typeof toolsService?.schemas === 'function' ? toolsService.schemas(agent, toolSet) : []
            preTurn = assembledSurface({ ...assembled, tools })
          } catch (error) {
            log?.(`dsh-dot: pre-turn context assembly unavailable: ${error instanceof Error ? error.message : String(error)}`)
          } finally {
            try { toolSet?.dispose() } catch { /* best-effort cleanup */ }
          }
        }
      }
      // Before the first request records its window, ask the model adapter.
      let fallback: number | undefined
      const pressure = values.contextPressure as { contextWindow?: unknown } | undefined
      if (typeof pressure?.contextWindow !== 'number' && scan.provider && scan.model) {
        const key = `${scan.provider}/${scan.model}`
        fallback = windows.get(key)
        const llm = get('llm') as Llm | undefined
        if (fallback === undefined && llm) {
          try {
            const window = (await llm.resolveModelInfo(scan.provider, scan.model)).context?.contextWindow
            if (typeof window === 'number') { fallback = window; windows.set(key, window) }
          } catch { /* the page shows occupancy without a window */ }
        }
      }
      return contextView(scan, values, fallback, preTurn)
    },
    dotTrajectory(sessionId) {
      const session = agents().get(sessionId)?.session
      if (!session || typeof session.seq !== 'number' || typeof session.eventAt !== 'function') return { sessionId, turns: [], earlier: 0 }
      const events = function* () { for (let seq = 0; seq < session.seq!; seq++) { const event = session.eventAt!(seq); if (event) yield event } }
      return { sessionId, ...foldTrajectory(events()) }
    },
    isRunning(sessionId) {
      const status = agents().get(sessionId)?.status
      return status !== undefined && status !== 'idle'
    },
    async dispose() {
      const owned = [...handles.values()]
      handles.clear()
      await Promise.allSettled(owned.map(handle => handle.dispose()))
    },
  }
}
