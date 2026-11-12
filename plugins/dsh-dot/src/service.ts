/**
 * dot's orchestration core: owns the ledger, the pending requests, the
 * wake-up batches and the chain of session segments dot's conversation runs
 * in, and implements every tool and RPC on top of {@link DotHost}. The plugin
 * entry wires host events into it; the preset child plugin exposes its
 * operations as model tools.
 */
import { mkdir } from 'node:fs/promises'
import { NoticeBatcher, formatNotices, type Notice, type Timer } from './batcher.ts'
import { ZERO_USAGE, addUsage, combineUsage, netSegmentUsage, usageFromEvents } from './context.ts'
import { PRESET_ID, TOOL, type BoardView, type DotContextUsage, type DotContextView, type MemoryView, type ModelChoice, type PendingKind, type PendingQuestionItem, type RolloverReason, type RuleConfig } from './contracts.ts'
import { SUMMARY_INSTRUCTION, SUMMARY_MAX_TOKENS, buildHandoff, type Handoff } from './handoff.ts'
import { READ_ROWS_DEFAULT, READ_ROWS_MAX, SEARCH_LIMIT_DEFAULT, SEARCH_LIMIT_MAX, SEARCH_SESSIONS_MAX, formatRead, formatSearch, historyRows, queryTerms, searchRows, windowRows, type SessionHits } from './history.ts'
import { FULL_ACCESS, type DotHost, type WorkspaceRow } from './host.ts'
import { clip } from './ledger.ts'
import { MEMORY_MAX_CHARS, MemoryError, MemoryNotes, addEntry, entriesOf, memorySection, removeEntry } from './memory.ts'
import { PendingHub, type PendingAnswer } from './pending.ts'
import { personaSection } from './persona.ts'
import { ReminderClock } from './reminders.ts'
import { routeInstruction, routeRequest, type Route } from './rules.ts'
import { ScheduleInputError, describeTiming, scheduleLines, type ScheduleInput } from './schedule.ts'
import { openingText, reasonAfterTurn, reasonBeforeDelivery, type Segment } from './segments.ts'
import type { DotStore } from './store.ts'
import { eventTier } from './tiers.ts'
import { TaskModelError, formatTaskModels, modelKey, pickTaskModel, type TaskModelCatalog } from './task-models.ts'
import { CONFIG_PRESET_ID, TaskPresetError, pickTaskPreset, type TaskPresetCatalog, type TaskPresetChoice } from './task-presets.ts'
import { openCardState, stamp, transcriptRows, type TranscriptRow } from './transcript.ts'
import { SelfSettings } from './self-settings.ts'

export interface DotServiceOptions {
  readonly host: DotHost
  /** Ledger and the human's settings: rules are read live from it. */
  readonly store: DotStore
  /** Working directory of dot's own session. */
  readonly homeDir: string
  /** dot's note file; defaults to memory.md in homeDir. */
  readonly notes?: NoteFile
  /** Fixed quiet window for tests; otherwise the settings decide. */
  readonly quietMs?: number
  readonly maxWaitMs?: number
  readonly timer?: Timer
  readonly now?: () => number
  readonly log?: (message: string) => void
}

/** Where dot's notes are kept; a missing file reads as empty. */
export interface NoteFile {
  readonly path: string
  read(): Promise<string>
  write(text: string): Promise<void>
}

/** The history tools themselves: their calls and results are not part of the record they read. */
const LOOKUP_TOOLS: ReadonlySet<string> = new Set([TOOL.searchHistory, TOOL.readHistory])

/** Sidebar title of dot's own workspace; the host keeps one title per workspace, so it is not translated. */
export const HOME_TITLE = 'Dorothy'

export class DotError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'DotError' }
}

export type RelayOutcome =
  | { readonly decided: 'pending'; readonly id: string; readonly settled: Promise<PendingAnswer | undefined>; readonly withdraw: () => void }
  | { readonly decided: 'allow' }
  | { readonly decided: 'deny' }
  | { readonly decided: 'skip' }

export class DotService {
  readonly pending: PendingHub
  readonly selfSettings: SelfSettings
  private readonly batcher: NoticeBatcher
  private readonly reminders: ReminderClock
  private ensuring: Promise<string> | undefined
  private homeRegistered = false
  private lane: Promise<unknown> = Promise.resolve()
  private readonly now: () => number
  private readonly notes: NoteFile
  /** Changes to the notes run one at a time, so two of them never start from the same text. */
  private notesLane: Promise<unknown> = Promise.resolve()
  /** Notes block as last read from the file; what a session without a segment record shows. */
  private notesBlock = ''
  private requestedSegment?: { focus?: string }

  constructor(private readonly options: DotServiceOptions) {
    this.now = options.now ?? Date.now
    this.notes = options.notes ?? new MemoryNotes(options.homeDir)
    this.pending = new PendingHub(this.now)
    this.selfSettings = new SelfSettings(this)
    this.pending.onChange(() => {
      this.batcher.dropWhere(item => item.requestId !== undefined && this.pending.get(item.requestId) === undefined)
      void this.store.syncPending(this.pending.list())
    })
    this.batcher = new NoticeBatcher(items => this.deliver(items), {
      // Update batching is an internal cadence, not a user setting.
      quietMs: options.quietMs ?? 15_000,
      maxWaitMs: options.maxWaitMs ?? 60_000,
      ...options.timer ? { timer: options.timer } : {},
    })
    this.reminders = new ReminderClock({
      store: options.store,
      now: this.now,
      deliver: text => this.remind(text),
      ...options.timer ? { timer: options.timer } : {},
      ...options.log ? { log: options.log } : {},
    })
  }

  get store(): DotStore { return this.options.store }
  get host(): DotHost { return this.options.host }
  get rules(): RuleConfig { return this.store.settings }
  get dotSessionId(): string | undefined { return this.store.dotSessionId }

  isDot(sessionId: string | undefined): boolean {
    return sessionId !== undefined && sessionId === this.store.dotSessionId
  }

  /**
   * Return dot's live session, resuming it after a restart and creating it on
   * first use. A stored session that cannot be reopened is followed by a new
   * segment that carries over what its log still gives. dot's sessions carry
   * the subagent origin, so the sidebar never lists them; the plugin's own
   * panel is their only chat.
   */
  ensureDot(): Promise<string> {
    this.ensuring ??= (async () => {
      try {
        // Registered once per run, so the workspace is in the sidebar from dot's first use on.
        if (!this.homeRegistered) {
          await this.homeWorkspace().then(() => { this.homeRegistered = true }, error => { this.options.log?.(`dsh-dot: dot's own workspace was not registered: ${messageOf(error)}`) })
        }
        const existing = this.store.dotSessionId
        if (existing === undefined) {
          await mkdir(this.options.homeDir, { recursive: true })
          const sessionId = await this.host.createDot(this.options.homeDir, PRESET_ID)
          await this.store.beginSegment({ sessionId, startedAt: this.now(), ...await this.frozen() })
          return sessionId
        }
        if (await this.host.resumeDot(existing, PRESET_ID)) {
          // A session from before segments existed gets its record on first use.
          if (!this.store.segment) await this.store.beginSegment({ sessionId: existing, startedAt: this.now(), ...await this.frozen() })
          return existing
        }
        await mkdir(this.options.homeDir, { recursive: true })
        return await this.rollover(existing, 'lost')
      } finally {
        this.ensuring = undefined
      }
    })()
    return this.ensuring
  }

  /** The human's message from dot's chat panel. */
  async say(text: string): Promise<void> {
    const body = text.trim()
    if (!body) throw new DotError('dot/invalid', 'message must be non-empty')
    await this.serial(async () => {
      const dot = await this.ready()
      // The human already wakes dot, so carried updates join the same message
      // instead of becoming a separate model turn of their own.
      const notices = this.liveNotices(this.batcher.take())
      try { await this.host.say(dot, body, notices.length > 0 ? formatNotices(notices) : undefined) } catch (error) {
        this.batcher.restore(this.liveNotices(notices))
        throw error
      }
    })
  }

  /**
   * The settings changed. A segment dot has not answered in takes the new
   * persona and model at once; any other keeps what it started with and is
   * left before the next delivery.
   */
  settingsChanged(): Promise<void> {
    return this.serial(async () => {
      const dot = this.store.dotSessionId
      if (!dot) return
      await this.dueBeforeDelivery(dot)
      this.applyModel(dot)
    }).catch(error => { this.options.log?.(`dsh-dot: settings not applied to dot's session: ${messageOf(error)}`) })
  }

  /**
   * dot went idle. A segment past the rollover line is left right away, while
   * its prompt is still cached and before the next message has to wait for it.
   */
  onDotIdle(sessionId: string): Promise<void> {
    if (!this.isDot(sessionId)) return Promise.resolve()
    return this.serial(async () => {
      if (!this.isDot(sessionId) || !this.store.segment || this.host.isRunning(sessionId)) return
      const requested = this.requestedSegment
      const reason: RolloverReason | undefined = requested ? 'dot-requested' : reasonAfterTurn(await this.host.dotContext(sessionId))
      if (!reason) return
      await this.rollover(sessionId, reason)
      this.requestedSegment = undefined
    }).catch(error => { this.options.log?.(`dsh-dot: segment check failed: ${messageOf(error)}`) })
  }

  async stop(): Promise<void> {
    const dot = this.store.dotSessionId
    if (dot) await this.host.stop(dot)
  }

  /** Context view of dot's live segment, with cumulative token totals across segments. */
  async contextView(): Promise<DotContextView> {
    const id = await this.ensureDot()
    const raw = await this.host.dotContext(id)
    if (!raw.live) return raw
    const segmentRaw = raw.usage ?? usageFromEvents(await this.host.readEvents(id).catch(() => []))
    return {
      ...raw,
      usage: combineUsage(segmentRaw, id, this.store.usageCarry, this.store.usageOffset),
    }
  }

  /** Zero cumulative token usage while keeping the current segment intact. */
  clearUsage(): Promise<DotContextView> {
    return this.serial(async () => {
      const id = await this.ensureDot()
      const raw = await this.host.dotContext(id)
      const segmentRaw = raw.usage ?? usageFromEvents(await this.host.readEvents(id).catch(() => []))
      await this.store.clearUsage(id, segmentRaw)
      return raw.live ? { ...raw, usage: ZERO_USAGE } : raw
    })
  }

  /** A model tool cannot release its own live session; move after the turn commits. */
  requestSegment(focus?: string): string {
    if (!this.store.dotSessionId) throw new DotError('dot/not-ready', 'your conversation is not ready yet')
    this.requestedSegment = { ...focus?.trim() ? { focus: focus.trim().slice(0, 1000) } : {} }
    return 'A fresh segment will start when this turn ends. Finish your reply normally; it will be carried into the handoff.'
  }

  /** Mechanical panel action: no model message, approval, or queued switch. */
  newSegment(): Promise<string> {
    return this.serial(async () => {
      const from = await this.ensureDot()
      if (this.host.isRunning(from)) throw new DotError('dot/running', 'stop the current turn before starting a new segment')
      const next = await this.rollover(from, 'manual')
      if (next === from) throw new DotError('dot/rollover-failed', 'a fresh session could not be started; the current segment is still active')
      return next
    })
  }

  /** Tool proposals and human decisions share the delivery/rollover lane. */
  serialSettings<T>(work: () => Promise<T>): Promise<T> { return this.serial(work) }

  board(): BoardView { return this.store.board(this.pending.list()) }

  /**
   * Let reminders come due. Called once dot's preset is registered: a reminder
   * that fires earlier could not reopen dot's session and would take it for lost.
   */
  startReminders(): void { this.reminders.start() }

  /** The human removed a reminder in the board. */
  removeSchedule(id: string): Promise<boolean> { return this.reminders.remove(id) }

  // ---- tool operations -------------------------------------------------

  async overview(signal: AbortSignal, limit = 30): Promise<string> {
    const rows = (await this.host.listSessions(signal))
      .filter(row => !row.subagent && !row.blank && !this.isDot(row.sessionId))
      .sort((a, b) => b.updatedAt - a.updatedAt)
    const shown = rows.filter(row => !row.archived).slice(0, limit)
    const titles = await this.host.titles(shown.map(row => row.sessionId), signal).catch(() => new Map<string, string>())
    const lines = [this.store.summary(this.pending.list(), this.now()), '', '[all sessions, newest first]']
    for (const row of shown) {
      const tracked = this.store.tracks(row.sessionId) ? ' · tracked' : ''
      lines.push(`- ${row.sessionId} ${row.running ? 'RUNNING' : 'idle'} "${titles.get(row.sessionId) ?? '(untitled)'}" cwd=${row.cwd ?? '?'}${tracked}`)
    }
    const hidden = rows.length - shown.length
    if (hidden > 0) lines.push(`(${hidden} more archived or older session(s) not shown)`)
    await this.store.markAllSeen()
    return lines.join('\n')
  }

  /**
   * dot's own workspace: the directory its sessions live in, registered with
   * the host so the human sees it in the sidebar and work that belongs to no
   * project has a place. The host reuses the record of a directory it already
   * knows, so this is asked again on every use and survives a removed record.
   */
  async homeWorkspace(): Promise<WorkspaceRow> {
    await mkdir(this.options.homeDir, { recursive: true })
    return this.host.createWorkspace(this.options.homeDir, HOME_TITLE)
  }

  async listWorkspaces(): Promise<string> {
    const home = await this.homeWorkspace().catch(error => { this.options.log?.(`dsh-dot: dot's own workspace is unavailable: ${messageOf(error)}`); return undefined })
    const rows = this.host.listWorkspaces()
    if (rows.length === 0) return 'No workspaces yet. Create one with dot_create_workspace.'
    return rows.map(row => `- ${row.id} "${row.title}" ${row.path} (${row.sessionCount} session(s))${row.id === home?.id ? ' · your own workspace' : ''}`).join('\n')
  }

  /** The models a task may run on, for dot to choose from. */
  async listModels(): Promise<string> {
    return formatTaskModels(this.store.settings.taskModels, await this.catalog())
  }

  private async catalog(): Promise<TaskModelCatalog> {
    try { return await this.host.listModels() } catch (error) {
      throw new DotError('dot/models-unavailable', `the host's model list could not be read: ${messageOf(error)}`)
    }
  }

  /** The model to select for a new task; undefined keeps the host default. The human's list is checked in code, not left to dot. */
  private async taskModel(requested?: string): Promise<ModelChoice | undefined> {
    const rule = this.store.settings.taskModels
    if (!requested?.trim() && rule.mode === 'all') return undefined
    try { return pickTaskModel(rule, await this.catalog(), requested) } catch (error) {
      if (error instanceof TaskModelError) throw new DotError(error.code, error.message)
      throw error
    }
  }

  /**
   * The preset a new task runs on. Leaving it out keeps the host default even
   * when the roster cannot be read; a named preset has to be on the roster.
   */
  private async taskPreset(requested?: string): Promise<TaskPresetChoice> {
    const named = requested?.trim() && requested.trim().toLowerCase() !== 'default'
    let catalog: TaskPresetCatalog
    try { catalog = await this.host.listPresets() } catch (error) {
      if (!named) return { named: false }
      throw new DotError('dot/presets-unavailable', `the host's preset list could not be read: ${messageOf(error)}. Leave preset out to start the task on the default.`)
    }
    try { return pickTaskPreset(catalog, requested) } catch (error) {
      if (error instanceof TaskPresetError) throw new DotError(error.code, error.message)
      throw error
    }
  }

  async createWorkspace(path: string, title?: string): Promise<string> {
    if (!path.trim()) throw new DotError('dot/invalid', 'path must be a non-empty absolute directory')
    await mkdir(path, { recursive: true })
    const row = await this.host.createWorkspace(path, title?.trim() || undefined)
    return `Workspace ${row.id} "${row.title}" at ${row.path}`
  }

  async startTask(input: { workspaceId?: string; cwd?: string; title: string; instruction: string; goal?: string; model?: string; preset?: string }, signal: AbortSignal): Promise<string> {
    const instruction = input.instruction.trim()
    if (!instruction) throw new DotError('dot/invalid', 'instruction must be non-empty')
    let workspaceId = input.workspaceId
    let cwd = input.cwd
    if (workspaceId) {
      const workspace = this.host.listWorkspaces().find(row => row.id === workspaceId)
      if (!workspace) throw new DotError('dot/unknown-workspace', `no workspace ${workspaceId}`)
      cwd = workspace.path
    } else if (!cwd) {
      // No project named: the task runs in dot's own workspace.
      const home = await this.homeWorkspace()
      workspaceId = home.id
      cwd = home.path
    }
    // Both settled before the session exists, so a refused preset or model leaves nothing behind.
    const preset = await this.taskPreset(input.preset)
    const model = await this.taskModel(input.model)
    const sessionId = await this.host.createSession({ ...workspaceId ? { workspaceId } : { cwd }, ...preset.named && preset.id ? { preset: preset.id } : {} })
    if (model) {
      try { await this.host.selectModel(sessionId, model) } catch (error) {
        throw new DotError('dot/model-failed', `session ${sessionId} was created but could not be put on ${modelKey(model)}, so nothing was sent to it: ${messageOf(error)}`)
      }
    }
    // Under `allow`, task sessions run with full access; under other modes they keep host approvals.
    // A session that can change the DSH installation never gets full access and asks the human unless denied.
    const guarded = preset.id === CONFIG_PRESET_ID
    const fullAccess = !guarded && this.store.settings.approvals === 'allow'
    const permitted = fullAccess ? await this.host.setPermission(sessionId, FULL_ACCESS) : false
    await this.store.track({ sessionId, origin: 'started', title: input.title, goal: input.goal ?? instruction, cwd, ...workspaceId ? { workspaceId } : {}, ...preset.id ? { preset: preset.id } : {}, at: this.now() })
    try {
      await this.host.prompt(sessionId, instruction, 'queue', signal)
    } catch (error) {
      await this.store.apply({ type: 'error', sessionId, at: this.now(), message: `first instruction not delivered: ${messageOf(error)}` }, this.pending.list())
      throw new DotError('dot/prompt-failed', `session ${sessionId} was created but the instruction was not delivered: ${messageOf(error)}`)
    }
    const access = guarded
      ? this.store.settings.approvals === 'deny'
        ? ' It can change the DSH installation, and approvals are set to deny all.'
        : ' It can change the DSH installation, so it runs under the default permissions and every approval it asks for goes to the human.'
      : !fullAccess ? '' : permitted ? ' It runs with full access.' : ' Full access could not be applied; it runs under the default permissions and its approvals are allowed automatically.'
    return `Started task ${sessionId} "${input.title}" in ${cwd}${preset.named && preset.id ? ` with the ${preset.id} preset` : ''}${model ? ` on ${modelKey(model)}` : ''}.${access}`
  }

  /** Agent-attributed delivery: the target sees dot as the sender, not the human. */
  async send(sessionId: string, text: string): Promise<string> {
    this.assertTarget(sessionId)
    if (!text.trim()) throw new DotError('dot/invalid', 'message must be non-empty')
    await this.host.relay(sessionId, this.store.dotSessionId ?? sessionId, text.trim())
    return `Delivered to ${sessionId}.`
  }

  async interrupt(sessionId: string): Promise<string> {
    this.assertTarget(sessionId)
    await this.host.cancel(sessionId)
    return `Stopped the current turn of ${sessionId}; queued messages stay.`
  }

  /**
   * dot archives only the sessions it started itself. A session the human
   * opened stays the human's to archive, also when dot watches it.
   */
  async archive(sessionId: string): Promise<string> {
    this.assertTarget(sessionId)
    if (this.store.task(sessionId)?.origin !== 'started') {
      throw new DotError('dot/not-yours', `you did not start ${sessionId}, so you cannot archive it. Only the human archives sessions they opened; tell them so when they asked for it`)
    }
    await this.host.archive(sessionId)
    for (const view of this.pending.forSession(sessionId)) this.pending.answer(view.id, view.kind === 'approval' ? { kind: 'approval', allow: false } : { kind: 'question', answers: (view.questions ?? []).map(q => ({ id: q.id, selected: [] })) })
    await this.store.apply({ type: 'archived', sessionId, at: this.now() }, this.pending.list())
    return `Archived ${sessionId}.`
  }

  async watch(sessionId: string, goal: string, title?: string): Promise<string> {
    this.assertTarget(sessionId)
    const cwd = (await this.host.cwdOf(sessionId)) ?? ''
    const task = await this.store.track({ sessionId, origin: 'watched', title: title ?? sessionId, goal, cwd, at: this.now() })
    return `Watching ${task.sessionId}.`
  }

  async read(sessionId: string, maxChars = 4000): Promise<string> {
    const reply = await this.host.latestReply(sessionId, Math.max(200, Math.min(maxChars, 20_000)))
    const task = this.store.task(sessionId)
    if (task) await this.store.markSeen(sessionId)
    const head = task ? `${task.status.toUpperCase()} "${task.title}" goal: ${task.goal}` : 'untracked session'
    return `${head}\n--- latest reply ---\n${reply ?? '(no reply yet)'}`
  }

  answer(id: string, answer: PendingAnswer): string {
    const view = this.pending.get(id)
    if (!view) throw new DotError('dot/unknown-request', `no waiting request ${id}; it may have been answered in its own session — stay silent unless another update needs the human`)
    if (!this.pending.answer(id, answer)) throw new DotError('dot/invalid-answer', answer.kind === 'question' ? 'answer every question id exactly once' : `request ${id} is a ${view.kind}`)
    return `Answered ${id} for ${view.sessionId}.`
  }

  async scheduleAdd(input: ScheduleInput): Promise<string> {
    try {
      const record = await this.reminders.add(input)
      return `Reminder ${record.id} "${record.title}" set (${describeTiming(record.timing)}); it first comes due ${stamp(record.nextAt)}.`
    } catch (error) {
      if (error instanceof ScheduleInputError) throw new DotError('dot/invalid', error.message)
      throw error
    }
  }

  scheduleList(): string { return scheduleLines(this.store.schedules) }

  async scheduleRemove(id: string): Promise<string> {
    const key = id.trim()
    if (!(await this.reminders.remove(key))) throw new DotError('dot/unknown-reminder', `no reminder ${key || '(empty id)'}; ${TOOL.scheduleList} shows the ones that are set`)
    return `Removed reminder ${key}.`
  }

  // ---- history: the record dot looks things up in ----------------------

  /** The sessions a search covers, newest first: dot's own segments, then the sessions on its ledger. */
  private historySessions(scope: 'all' | 'own' | 'tasks'): { sessionId: string; what: string; own: boolean }[] {
    const out: { sessionId: string; what: string; own: boolean }[] = []
    if (scope !== 'tasks') {
      const current = this.store.dotSessionId
      if (current) out.push({ sessionId: current, what: 'Your conversation, current session', own: true })
      for (const past of [...this.store.pastSegments].reverse()) {
        const span = past.startedAt > 0 ? ` (${stamp(past.startedAt)} to ${stamp(past.endedAt)})` : ` (until ${stamp(past.endedAt)})`
        out.push({ sessionId: past.sessionId, what: `Your conversation, earlier session${span}`, own: true })
      }
    }
    if (scope !== 'own') {
      for (const task of [...this.store.list()].sort((a, b) => b.updatedAt - a.updatedAt)) {
        out.push({ sessionId: task.sessionId, what: `Task "${task.title}"${task.status === 'archived' ? ' (archived)' : ''}`, own: false })
      }
    }
    return out
  }

  private describeSession(sessionId: string): { sessionId: string; what: string; own: boolean } {
    return this.historySessions('all').find(row => row.sessionId === sessionId) ?? { sessionId, what: 'Session not on your ledger', own: false }
  }

  /**
   * Find earlier messages. Every word of the query has to occur in one message;
   * the search reads the session logs themselves, so nothing has to be kept in step.
   */
  async searchHistory(input: { query: string; sessionId?: string; scope?: string; tools?: boolean; limit?: number }): Promise<string> {
    const terms = queryTerms(input.query)
    if (terms.length === 0) throw new DotError('dot/invalid', 'query must hold at least one word')
    const scope = input.scope === 'own' || input.scope === 'tasks' ? input.scope : 'all'
    const only = input.sessionId?.trim()
    const candidates = only ? [this.describeSession(only)] : this.historySessions(scope)
    const targets = candidates.slice(0, SEARCH_SESSIONS_MAX)
    const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? SEARCH_LIMIT_DEFAULT), SEARCH_LIMIT_MAX))
    const groups: SessionHits[] = []
    let failed = 0
    for (const target of targets) {
      let events
      try { events = await this.host.readEvents(target.sessionId) } catch (error) {
        if (only) throw new DotError('dot/unknown-session', `session ${only} could not be read: ${messageOf(error)}`)
        failed++
        continue
      }
      const hits = searchRows(historyRows(events, input.tools === true, LOOKUP_TOOLS), terms).reverse()
      if (hits.length > 0) groups.push({ ...target, hits })
    }
    groups.sort((a, b) => b.hits[0]!.at - a.hits[0]!.at)
    return formatSearch({ query: input.query.trim(), groups, limit, searched: targets.length - failed, skipped: candidates.length - targets.length, failed, readTool: TOOL.readHistory })
  }

  /** Read a stretch of one session word for word: around a position, or its last messages. */
  async readHistory(input: { sessionId: string; seq?: number; before?: number; after?: number; tools?: boolean }): Promise<string> {
    const sessionId = input.sessionId.trim()
    if (!sessionId) throw new DotError('dot/invalid', 'session_id must be non-empty')
    let events
    try { events = await this.host.readEvents(sessionId) } catch (error) {
      throw new DotError('dot/unknown-session', `session ${sessionId} could not be read: ${messageOf(error)}`)
    }
    const bound = (value: number | undefined) => Math.max(0, Math.min(Math.trunc(value ?? READ_ROWS_DEFAULT), READ_ROWS_MAX))
    const window = windowRows(historyRows(events, input.tools === true, LOOKUP_TOOLS), { ...input.seq === undefined ? {} : { seq: Math.trunc(input.seq) }, before: bound(input.before), after: bound(input.after) })
    return formatRead({ ...this.describeSession(sessionId), ...window })
  }

  // ---- notes: what dot knows in every conversation ---------------------

  /** Change the notes in one step and keep what they were, so the change can be taken back once. */
  private changeNotes(change: (text: string) => string, by: 'dot' | 'human'): Promise<{ before: string; after: string }> {
    const run = this.notesLane.then(async () => {
      const before = await this.notes.read()
      let after: string
      try { after = change(before) } catch (error) {
        if (error instanceof MemoryError) throw new DotError(error.code, error.message)
        throw error
      }
      if (after === before) return { before, after }
      await this.notes.write(after)
      await this.store.setMemoryUndo(before)
      this.notesBlock = memorySection(after)
      // dot knows its own change from the tool call. An edit of the human that it has not seen yet stays outstanding.
      const segment = this.store.segment
    if (by !== 'human' && segment && (segment.memorySeen ?? segment.memory ?? '') === memorySection(before)) await this.store.noteMemorySeen(this.notesBlock)
      return { before, after }
    })
    this.notesLane = run.catch(() => undefined)
    return run
  }

  async remember(text: string): Promise<string> {
    if (this.store.settings.locks?.memory) throw new DotError('dot/setting-locked', 'notes are locked by the human; use dot_propose_settings for the change you want')
    const { before, after } = await this.changeNotes(current => addEntry(current, text), 'dot')
    if (after === before) return 'That is already in your notes.'
    return `Noted. Your notes now hold ${entriesOf(after).length} entr${entriesOf(after).length === 1 ? 'y' : 'ies'}, ${after.trim().length} of ${MEMORY_MAX_CHARS} characters. The [your notes] block of this session still shows them as they were when it started; your next session shows the new one.`
  }

  async forget(text: string): Promise<string> {
    if (this.store.settings.locks?.memory) throw new DotError('dot/setting-locked', 'notes are locked by the human; use dot_propose_settings for the change you want')
    let removed = ''
    await this.changeNotes(current => { const result = removeEntry(current, text); removed = result.removed; return result.text }, 'dot')
    return `Removed from your notes: "${removed}".`
  }

  async memoryView(): Promise<MemoryView> {
    const text = await this.notes.read()
    const undo = this.store.memoryUndo
    return { text, path: this.notes.path, maxChars: MEMORY_MAX_CHARS, canUndo: undo !== undefined && undo !== text }
  }

  /** The human rewrote the notes in the settings view. */
  async setMemory(text: string, by: 'human' | 'dot-approved' = 'human'): Promise<MemoryView> {
    const next = text.replace(/\r\n/g, '\n')
    if (next.trim().length > MEMORY_MAX_CHARS) throw new DotError('dot/invalid', `the notes are at most ${MEMORY_MAX_CHARS} characters; these have ${next.trim().length}`)
    await this.changeNotes(() => next.trim() ? `${next.replace(/\s+$/, '')}\n` : '', by === 'human' ? 'human' : 'dot')
    return this.memoryView()
  }

  /** Put the notes back to what they were before their latest change, whoever made it. */
  async undoMemory(): Promise<MemoryView> {
    const undo = this.store.memoryUndo
    if (undo === undefined) throw new DotError('dot/nothing-to-undo', 'there is no earlier version of the notes')
    await this.changeNotes(() => undo, 'human')
    return this.memoryView()
  }

  // ---- host events -----------------------------------------------------

  onStatus(sessionId: string, status: 'running' | 'idle'): void {
    if (this.isDot(sessionId)) return
    void this.store.apply({ type: 'status', sessionId, status, at: this.now() }, this.pending.list())
  }

  async onTurnEnd(sessionId: string): Promise<void> {
    if (this.isDot(sessionId) || !this.store.tracks(sessionId)) return
    const reply = await this.host.latestReply(sessionId, 600).catch(() => undefined)
    const task = await this.store.apply({ type: 'turn-end', sessionId, at: this.now(), ...reply ? { note: reply } : {} }, this.pending.list())
    if (task) this.notify({ sessionId, kind: 'turn-end', text: `"${task.title}" finished a turn: ${clip(reply ?? '(no text)', 400)}`, at: this.now() })
  }

  onError(sessionId: string, error: unknown): void {
    if (this.isDot(sessionId) || !this.store.tracks(sessionId)) return
    const message = messageOf(error)
    void this.store.apply({ type: 'error', sessionId, at: this.now(), message }, this.pending.list())
    this.notify({ sessionId, kind: 'error', text: clip(message, 400), at: this.now() })
  }

  /**
   * Route one approval or question from another top-level session. dot itself
   * is skipped, and so are untracked sessions when the scope is `tracked` and
   * every request whose kind the settings leave to the host (`off`);
   * skipped requests reach their own answerer unchanged.
   */
  relayRequest(input: { kind: PendingKind; sessionId: string; subject: string; detail?: string; cwd?: string; questions?: readonly PendingQuestionItem[]; signal?: AbortSignal }): RelayOutcome {
    if (this.isDot(input.sessionId) || !this.store.dotSessionId) return { decided: 'skip' }
    const tracked = this.store.tracks(input.sessionId)
    if (!tracked && this.rules.scope === 'tracked') return { decided: 'skip' }
    const task = this.store.task(input.sessionId)
    // A task that can change the DSH installation never has its approvals auto-allowed or settled by dot:
    // unless approvals are denied across the board, they go to the human.
    const guarded = input.kind === 'approval' && task?.preset === CONFIG_PRESET_ID
    const routed = routeRequest(this.rules, input.kind)
    const route: Route = guarded && (routed.action === 'dot' || routed.action === 'allow') ? { action: 'human' } : routed
    if (route.action === 'skip' || route.action === 'allow' || route.action === 'deny') return { decided: route.action }
    const { cwd, ...request } = input
    const opened = this.pending.open(request)
    const where = task ? `task "${task.title}"` : `untracked session${cwd ? ` in ${cwd}` : ''}`
    const lines = [`${opened.id} · ${input.kind} from ${where} · "${input.subject}"`]
    if (input.detail) lines.push(`  detail: ${clip(input.detail, 600)}`)
    for (const q of input.questions ?? []) {
      lines.push(`  [${q.id}] ${q.question}${q.options?.length ? ' options: ' + q.options.map(o => o.label).join(' | ') : ''}${q.multiSelect ? ' (multi)' : ''}`)
    }
    lines.push(`  ${routeInstruction(route, this.rules.policy)}`)
    this.notify({ sessionId: input.sessionId, kind: input.kind, requestId: opened.id, text: lines.join('\n'), at: this.now() }, true)
    return { decided: 'pending', ...opened }
  }

  notify(notice: Notice, urgent = false): void {
    const tier = eventTier(notice.kind, this.store.task(notice.sessionId)?.origin)
    if (tier === 'hold') this.batcher.hold(notice)
    else if (tier === 'wake') this.batcher.push(notice, urgent)
  }

  flushNotices(): Promise<void> { return this.batcher.drain() }

  dispose(): void {
    this.batcher.dispose()
    this.reminders.dispose()
    this.pending.dispose()
  }

  /** Due reminders reach the segment dot is in now, whichever one they were set in. */
  private async remind(text: string): Promise<void> {
    return this.serial(async () => {
      const dot = await this.ready()
      const notices = this.liveNotices(this.batcher.take())
      // Keep the reminder head first so the panel still draws a reminder.
      const message = notices.length > 0 ? `${text}\n\n${formatNotices(notices)}` : text
      try { await this.host.relay(dot, dot, message) } catch (error) {
        this.batcher.restore(this.liveNotices(notices))
        throw error
      }
    })
  }

  private async deliver(items: readonly Notice[]): Promise<void> {
    if (!this.store.dotSessionId) return
    const initial = this.liveNotices(items)
    if (initial.length === 0) return
    await this.serial(async () => {
      if (this.liveNotices(initial).length === 0) return
      const dot = await this.ready()
      const live = this.liveNotices(initial)
      if (live.length === 0) return
      await this.host.relay(dot, live[0]!.sessionId, formatNotices(live))
    })
  }

  private liveNotices(items: readonly Notice[]): Notice[] {
    return items.filter(item => item.requestId === undefined || this.pending.get(item.requestId) !== undefined)
  }

  /** Deliveries and segment changes run one at a time, so a message never lands in a segment that is being left. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.lane.then(work)
    this.lane = run.catch(() => undefined)
    return run
  }

  /** dot's session for the next delivery: moved to a new segment first when one is due. */
  private async ready(): Promise<string> {
    const dot = await this.ensureDot()
    let reason: RolloverReason | undefined
    try { reason = await this.dueBeforeDelivery(dot) } catch (error) {
      this.options.log?.(`dsh-dot: segment check failed: ${messageOf(error)}`)
    }
    const current = reason ? await this.rollover(dot, reason) : dot
    this.applyModel(current)
    return current
  }

  /** A segment keeps the model it started with; one that still waits to be left is not switched under it. */
  private applyModel(dot: string): void {
    const frozen = this.store.segment?.model
    if (frozen === undefined || frozen === this.host.modelKey()) this.host.syncModel(dot)
  }

  /** Persona, model and notes as a segment starting now would freeze them. */
  private async frozen(): Promise<Pick<Segment, 'persona' | 'model' | 'memory'>> {
    const model = this.host.modelKey()
    const memory = await this.readNotesBlock()
    return { persona: personaSection(this.store.settings), ...model ? { model } : {}, ...memory ? { memory } : {} }
  }

  /** The notes block of the prompt as the file gives it now. An unreadable file keeps the block last read. */
  private async readNotesBlock(): Promise<string> {
    try { this.notesBlock = memorySection(await this.notes.read()) } catch (error) {
      this.options.log?.(`dsh-dot: dot's notes could not be read: ${messageOf(error)}`)
    }
    return this.notesBlock
  }

  /** Notes block for a prompt that no segment record covers yet. */
  currentNotesBlock(): string { return this.notesBlock }

  /**
   * Whether dot's segment has to end before the next message reaches it. A
   * running turn and a card that waits for the human both keep the segment.
   */
  private async dueBeforeDelivery(dot: string): Promise<RolloverReason | undefined> {
    const segment = this.store.segment
    if (!segment || segment.sessionId !== dot || this.host.isRunning(dot)) return undefined
    const events = await this.host.readEvents(dot)
    let replied = false
    let lastReplyAt: number | undefined
    for (const event of events) {
      if (event.type !== 'assistant/message') continue
      replied = true
      if (typeof event.time === 'number') lastReplyAt = event.time
    }
    if (this.requestedSegment) return 'dot-requested'
    const wanted = await this.frozen()
    const seenNotes = segment.memorySeen ?? segment.memory ?? ''
    if (!replied) {
      // No request of this segment is cached yet, so it simply takes the current settings and notes.
      if (segment.persona !== wanted.persona || segment.model !== wanted.model || (wanted.memory ?? '') !== seenNotes) await this.store.refreezeSegment(wanted)
      return undefined
    }
    const view = await this.host.dotContext(dot)
    return reasonBeforeDelivery({
      replied,
      now: this.now(),
      ...lastReplyAt === undefined ? {} : { lastReplyAt },
      ...view.usedTokens === undefined ? {} : { usedTokens: view.usedTokens },
      persona: wanted.persona,
      frozenPersona: segment.persona,
      ...wanted.model ? { model: wanted.model } : {},
      ...segment.model ? { frozenModel: segment.model } : {},
      notes: wanted.memory ?? '',
      seenNotes,
    }) ?? reasonAfterTurn(view)
  }

  /**
   * Move dot's conversation into a fresh session that opens with a handoff.
   * @returns the session dot is in afterwards: the old one when the move could not be made.
   */
  private async rollover(from: string, reason: RolloverReason): Promise<string> {
    const requestedFocus = reason === 'dot-requested' ? this.requestedSegment?.focus : undefined
    const live = reason !== 'lost'
    let events: Awaited<ReturnType<DotHost['readEvents']>> = []
    try { events = await this.host.readEvents(from) } catch (error) {
      this.options.log?.(`dsh-dot: reading the log of ${from} failed: ${messageOf(error)}`)
    }
    const fromContext = live ? await this.host.dotContext(from).catch(() => undefined) : undefined
    let summaryUsage: DotContextUsage | undefined
    const handoff = await this.handoffFrom(from, live, events, fromContext?.contextWindow, usage => {
      summaryUsage = addUsage(summaryUsage, usage)
    })
    // A turn that started while the note was being written keeps the segment; the next check moves it.
    if (live && this.host.isRunning(from)) return from
    let sessionId: string
    try {
      sessionId = await this.host.createDot(this.options.homeDir, PRESET_ID)
    } catch (error) {
      if (!live) throw error
      this.options.log?.(`dsh-dot: dot stays in ${from}; a new session could not be started: ${messageOf(error)}`)
      return from
    }
    const at = this.now()
    const reminders = this.store.schedules
    const cardState = openCardState(events)
    const openCard = cardState.openCard ?? (!cardState.hadUserMessage ? this.store.segment?.openCard : undefined)
    const handoffOpening = openingText({
      ...handoff ? { handoff } : {},
      reason,
      ledger: this.store.summary(this.pending.list(), at),
      ...reminders.length > 0 ? { reminders: scheduleLines(reminders) } : {},
      previous: from,
      ...openCard ? { openCard } : {},
      at,
    })
    const opening = requestedFocus ? `${handoffOpening}\n\nWhat you chose to focus on next: ${requestedFocus}` : handoffOpening
    const endedSegmentRaw = fromContext?.usage ?? usageFromEvents(events)
    const endedUsage = addUsage(netSegmentUsage(endedSegmentRaw, from, this.store.usageOffset), summaryUsage)
    this.host.handoffView?.(from, sessionId)
    await this.store.beginSegment({
      sessionId,
      startedAt: at,
      ...await this.frozen(),
      opening,
      ...openCard ? { openCard } : {},
      ...handoff ? { handoff } : {},
      reason,
    }, { reason }, endedUsage)
    this.applyModel(sessionId)
    await this.host.releaseDot(from).catch(error => { this.options.log?.(`dsh-dot: could not release ${from}: ${messageOf(error)}`) })
    this.options.log?.(`dsh-dot: dot continues in ${sessionId} (${reason}${handoff ? `, ${handoff.tier} handoff` : ''}); before it was ${from}`)
    return sessionId
  }

  /** What the ended segment hands on: its own conversation joined with what it had been handed itself. */
  private async handoffFrom(
    sessionId: string,
    live: boolean,
    events: readonly Awaited<ReturnType<DotHost['readEvents']>>[number][],
    contextWindow?: number,
    onUsage?: (usage: DotContextUsage) => void,
  ): Promise<Handoff | undefined> {
    const carried = this.store.segment?.handoff
    const failed = (what: string) => (error: unknown) => { this.options.log?.(`dsh-dot: ${what} of ${sessionId} failed: ${messageOf(error)}`) }
    const rows: TranscriptRow[] = transcriptRows(events)
    return buildHandoff({
      rows,
      ...carried ? { carried } : {},
      ...contextWindow === undefined ? {} : { contextWindow },
      ...live ? { summarize: () => this.host.summarize(sessionId, SUMMARY_INSTRUCTION, SUMMARY_MAX_TOKENS, onUsage) } : {},
      onError: failed('the handoff note'),
    })
  }

  private assertTarget(sessionId: string): void {
    if (!sessionId.trim()) throw new DotError('dot/invalid', 'session_id must be non-empty')
    if (this.isDot(sessionId)) throw new DotError('dot/invalid', 'that is dot itself')
  }
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown error'
}
