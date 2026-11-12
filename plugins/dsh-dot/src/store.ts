/**
 * In-memory ledger mirrored to the storage domain. Writes are serialized so
 * the durable copy follows the in-memory order; reads never wait on disk.
 */
import type { BoardView, CognitionVersion, DotContextUsage, DotSettings, DotUsageOffset, PendingView, ScheduleRecord, SettingProposal, TaskRecord } from './contracts.ts'
import { COGNITION_HISTORY_MAX } from './contracts.ts'
import { ZERO_USAGE, addUsage } from './context.ts'
import { applyEvent, createTask, ledgerSummary, markSeen, sortTasks, withPending, type LedgerEvent, type NewTask } from './ledger.ts'
import { MAX_PAST_SEGMENTS, type PastSegment, type Segment } from './segments.ts'
import { parseSettings } from './settings.ts'
import { STATE_KEY, parseScheduleRecord, parseSettingProposal, parseState, parseTask, type DotState } from './storage.ts'

type TableName = 'state' | 'tasks' | 'schedules' | 'proposals'

export interface DotTable {
  entries(): IterableIterator<[unknown, unknown]>
  get(key: string): unknown
  put(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<unknown>
}

export interface DotDomainHandle {
  table(name: TableName): DotTable
  close(): Promise<void>
}

/** Ledger cap: the oldest archived tasks are forgotten past this size. */
export const MAX_TASKS = 300

export class DotStore {
  private state: DotState
  private current: DotSettings
  private readonly tasks = new Map<string, TaskRecord>()
  private readonly reminders = new Map<string, ScheduleRecord>()
  private readonly proposals = new Map<string, SettingProposal>()
  private tail: Promise<unknown> = Promise.resolve()
  private readonly listeners = new Set<() => void>()

  constructor(private readonly domain: DotDomainHandle | undefined) {
    this.state = domain ? parseState(domain.table('state').get(STATE_KEY)) : {}
    this.current = parseSettings(this.state.settings)
    if (domain) {
      for (const [key, value] of domain.table('tasks').entries()) {
        const task = parseTask(value)
        if (task && task.sessionId === key) this.tasks.set(task.sessionId, task)
      }
      for (const [key, value] of domain.table('schedules').entries()) {
        const record = parseScheduleRecord(value)
        if (record && record.id === key) this.reminders.set(record.id, record)
      }
      for (const [key, value] of domain.table('proposals').entries()) {
        const proposal = parseSettingProposal(value)
        if (proposal && proposal.id === key) this.proposals.set(proposal.id, proposal)
      }
    }
  }

  get cards(): readonly import('./card-state.ts').DotCardRecord[] { return this.state.cards ?? [] }
  get cardSequence(): number { return this.cards.reduce((max, card) => Math.max(max, card.number), this.state.cardSequence ?? 0) }
  get lastReplyAt(): number | undefined { return this.state.lastReplyAt }
  get lastConversationAt(): number | undefined { return this.state.lastConversationAt }

  addCard(card: import('./card-state.ts').DotCardRecord): Promise<void> {
    return this.setDot({ cardSequence: card.number, cards: [...this.cards.map(row => row.answer ? row : { ...row, expired: true }), card] })
  }

  expireCards(keepId?: string): Promise<void> {
    if (!this.cards.some(card => !card.expired && !card.answer && card.id !== keepId)) return Promise.resolve()
    return this.setDot({ cards: this.cards.map(card => card.answer || card.id === keepId ? card : { ...card, expired: true }) })
  }

  setCardAnswer(id: string, answer: NonNullable<import('./card-state.ts').DotCardRecord['answer']>): Promise<void> {
    return this.setDot({ cards: this.cards.map(card => card.id === id ? { ...card, answer } : card) })
  }

  noteConversation(at: number, replied = false): Promise<void> {
    return this.setDot({ lastConversationAt: Math.max(this.lastConversationAt ?? 0, at), ...replied ? { lastReplyAt: Math.max(this.lastReplyAt ?? 0, at) } : {} })
  }

  get dotSessionId(): string | undefined { return this.state.dotSessionId }
  get dotWorkspaceId(): string | undefined { return this.state.dotWorkspaceId }

  /** The record of the segment dot is in; undefined until one is written for the current session. */
  get segment(): Segment | undefined {
    const segment = this.state.segment
    return segment && segment.sessionId === this.state.dotSessionId ? segment : undefined
  }

  get pastSegments(): readonly PastSegment[] { return this.state.pastSegments ?? [] }
  get usageCarry(): DotContextUsage | undefined { return this.state.usageCarry }
  get usageOffset(): DotUsageOffset | undefined { return this.state.usageOffset }

  /** Make `next` dot's session; a different previous session joins the past segments. */
  beginSegment(next: Segment, ended?: Pick<PastSegment, 'reason'>, endedUsage?: DotContextUsage): Promise<void> {
    const previous = this.state.dotSessionId
    const moved = previous !== undefined && previous !== next.sessionId
    const past = !moved
      ? this.pastSegments
      : [...this.pastSegments, {
          sessionId: previous,
          startedAt: this.segment?.startedAt ?? 0,
          endedAt: next.startedAt,
          ...ended?.reason ? { reason: ended.reason } : {},
        }].slice(-MAX_PAST_SEGMENTS)
    const { usageOffset: _offset, ...rest } = this.state
    const carry = moved && endedUsage ? addUsage(this.state.usageCarry, endedUsage) : this.state.usageCarry
    this.state = {
      ...rest,
      ...(!moved && this.state.usageOffset ? { usageOffset: this.state.usageOffset } : {}),
      ...(carry ? { usageCarry: carry } : {}),
      dotSessionId: next.sessionId,
      segment: next,
      pastSegments: past,
      ...(moved ? { cards: this.cards.map(card => card.answer ? card : { ...card, expired: true }) } : {}),
    }
    this.changed()
    return this.write('state', STATE_KEY, this.state)
  }

  /** Zero cumulative usage now; any usage already accrued in the active segment is subtracted via usageOffset. */
  clearUsage(sessionId: string | undefined, currentRaw: DotContextUsage | undefined): Promise<void> {
    const { usageOffset: _old, ...rest } = this.state
    const hasRaw = Boolean(sessionId && currentRaw && (currentRaw.input > 0 || currentRaw.cacheRead > 0 || currentRaw.cacheWrite > 0 || currentRaw.output > 0))
    this.state = {
      ...rest,
      usageCarry: ZERO_USAGE,
      ...(hasRaw && sessionId && currentRaw ? { usageOffset: { sessionId, ...currentRaw } } : {}),
    }
    this.changed()
    return this.write('state', STATE_KEY, this.state)
  }

  /** Refresh the frozen inputs of a segment dot has not replied in yet. */
  refreezeSegment(patch: Pick<Segment, 'persona' | 'model' | 'agreements' | 'cognition'>): Promise<void> {
    const segment = this.segment
    if (!segment) return Promise.resolve()
    const { model: _model, agreements: _agreements, agreementsSeen: _aseen, cognition: _cognition, cognitionSeen: _cseen, ...rest } = segment
    return this.setDot({ segment: {
      ...rest,
      persona: patch.persona,
      ...patch.model !== undefined ? { model: patch.model } : {},
      ...patch.agreements !== undefined ? { agreements: patch.agreements } : {},
      ...patch.cognition !== undefined ? { cognition: patch.cognition } : {},
    } })
  }

  /** dot changed its own agreements in the current segment: the conversation accounts for them as they read now. */
  noteAgreementsSeen(section: string): Promise<void> {
    const segment = this.segment
    if (!segment) return Promise.resolve()
    return this.setDot({ segment: { ...segment, agreementsSeen: section } })
  }

  /** dot rewrote its own cognition in the current segment: the conversation accounts for it as it reads now. */
  noteCognitionSeen(section: string): Promise<void> {
    const segment = this.segment
    if (!segment) return Promise.resolve()
    return this.setDot({ segment: { ...segment, cognitionSeen: section } })
  }

  // ---- agreements and cognition (DotStore is the authority) --------------

  get agreements(): string { return this.state.agreements ?? '' }
  get agreementsUndo(): string | undefined { return this.state.agreementsUndo }
  get cognition(): string { return this.state.cognition ?? '' }
  get cognitionHistory(): readonly CognitionVersion[] { return this.state.cognitionHistory ?? [] }
  /** Whether the one-time legacy import already ran; cleared content is never re-imported after it. */
  get knowledgeMigrated(): boolean { return this.state.knowledgeMigrated !== undefined }
  /** Legacy note text from old state rows; only migration reads it. */
  get legacyMemory(): string | undefined { return this.state.memory }
  get legacyMemoryUndo(): string | undefined { return this.state.memoryUndo }

  /** Replace the agreements; the text before them is what one undo restores. */
  setAgreements(text: string): Promise<void> {
    const before = this.agreements
    if (text === before) return Promise.resolve()
    return this.setDot({ agreements: text, agreementsUndo: before })
  }

  /** Swap the agreements with the text the latest change replaced. @returns false when there is nothing to take back. */
  undoAgreements(): Promise<boolean> {
    const undo = this.state.agreementsUndo
    if (undo === undefined) return Promise.resolve(false)
    const current = this.agreements
    return this.setDot({ agreements: undo, agreementsUndo: current }).then(() => true)
  }

  /** Replace cognition, pushing the text it replaces onto the rollback history (newest first, capped). */
  setCognition(text: string, now = Date.now()): Promise<void> {
    const before = this.cognition
    if (text === before) return Promise.resolve()
    const history = this.cognitionHistory
    const latest = history[0]?.at ?? 0
    // Strictly increasing timestamps keep every version addressable for restore.
    const at = Math.max(Math.trunc(now), latest + 1)
    const next = [{ text: before, at }, ...history].slice(0, COGNITION_HISTORY_MAX)
    return this.setDot({ cognition: text, cognitionHistory: next })
  }

  /** Put an earlier cognition text back; the text it replaces joins the history too. @returns false for an unknown version. */
  restoreCognition(at: number, now = Date.now()): Promise<boolean> {
    const version = this.cognitionHistory.find(entry => entry.at === at)
    if (!version) return Promise.resolve(false)
    return this.setCognition(version.text, now).then(() => true)
  }

  /**
   * Commit the one-time legacy import. Unlike {@link setDot}, the in-memory state
   * (including the migration marker) is updated only after the write is durable,
   * so a failed import is retried instead of being silently marked done.
   */
  commitKnowledgeMigration(patch: Partial<Pick<DotState, 'agreements' | 'agreementsUndo' | 'cognition' | 'cognitionHistory' | 'knowledgeMigrated'>>): Promise<void> {
    // The one-time import may seed an initial cognition rollback version, but it must
    // never replace history the store already holds; drop the key so the state spread
    // keeps the existing history instead of overwriting it.
    const effective = { ...patch }
    if (effective.cognitionHistory !== undefined && (this.state.cognitionHistory?.length ?? 0) > 0) delete effective.cognitionHistory
    const domain = this.domain
    if (domain === undefined) {
      this.state = { ...this.state, ...effective }
      this.changed()
      return Promise.resolve()
    }
    const op = this.tail.then(async () => {
      const next = { ...this.state, ...effective }
      await domain.table('state').put(STATE_KEY, next)
      // Merge onto the latest memory state so concurrent settings/segment fields survive;
      // the state write that landed meanwhile is re-issued with the latest snapshot below.
      this.state = { ...this.state, ...effective }
      this.changed()
    })
    this.tail = op.catch(() => undefined)
    return op
  }

  get settings(): DotSettings { return this.current }

  setSettings(next: DotSettings): Promise<void> {
    this.current = next
    return this.setDot({ settings: { ...next } as Record<string, unknown> })
  }

  setDot(next: DotState): Promise<void> {
    this.state = { ...this.state, ...next }
    this.changed()
    return this.write('state', STATE_KEY, this.state)
  }

  task(sessionId: string): TaskRecord | undefined { return this.tasks.get(sessionId) }
  list(): TaskRecord[] { return sortTasks([...this.tasks.values()]) }
  tracks(sessionId: string): boolean { return this.tasks.has(sessionId) }

  /** Track a session; tracking an existing one keeps its history and refreshes the goal. */
  track(input: NewTask): Promise<TaskRecord> {
    const existing = this.tasks.get(input.sessionId)
    const task = existing
      ? { ...existing, goal: input.goal || existing.goal, status: existing.status === 'archived' ? 'idle' as const : existing.status, updatedAt: input.at }
      : createTask(input)
    return this.put(task).then(() => task)
  }

  apply(event: LedgerEvent, pending: readonly PendingView[]): Promise<TaskRecord | undefined> {
    const current = this.tasks.get(event.sessionId)
    const blocked = pending.some(item => item.sessionId === event.sessionId)
    const next = applyEvent(current, event, blocked)
    if (next === undefined || next === current) return Promise.resolve(next)
    return this.put(next).then(() => next)
  }

  /** Re-derive blocked flags after the pending set changed. */
  syncPending(pending: readonly PendingView[]): Promise<void> {
    const writes: Promise<void>[] = []
    for (const task of this.tasks.values()) {
      const next = withPending(task, pending)
      if (next !== task) writes.push(this.put(next))
    }
    return Promise.all(writes).then(() => undefined)
  }

  /** dot looked at the ledger: clear unread counters. */
  markAllSeen(): Promise<void> {
    const writes: Promise<void>[] = []
    for (const task of this.tasks.values()) {
      const next = markSeen(task)
      if (next !== task) writes.push(this.put(next))
    }
    return Promise.all(writes).then(() => undefined)
  }

  /** dot read one task: clear its unread counter. */
  markSeen(sessionId: string): Promise<void> {
    const task = this.tasks.get(sessionId)
    if (!task) return Promise.resolve()
    const next = markSeen(task)
    return next === task ? Promise.resolve() : this.put(next)
  }

  /** dot's reminders, the one due first on top. */
  get schedules(): readonly ScheduleRecord[] {
    return [...this.reminders.values()].sort((a, b) => a.nextAt - b.nextAt || a.createdAt - b.createdAt)
  }

  get settingProposals(): readonly SettingProposal[] {
    return [...this.proposals.values()].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
  }

  settingProposal(id: string): SettingProposal | undefined { return this.proposals.get(id) }

  putSettingProposal(record: SettingProposal): Promise<void> {
    this.proposals.set(record.id, record)
    this.changed()
    return this.write('proposals', record.id, record)
  }

  deleteSettingProposal(id: string): Promise<boolean> {
    if (!this.proposals.delete(id)) return Promise.resolve(false)
    this.changed()
    const domain = this.domain
    if (!domain) return Promise.resolve(true)
    const op = this.tail.then(() => domain.table('proposals').delete(id))
    this.tail = op.catch(() => undefined)
    return op.then(() => true)
  }

  schedule(id: string): ScheduleRecord | undefined { return this.reminders.get(id) }

  putSchedule(record: ScheduleRecord): Promise<void> {
    this.reminders.set(record.id, record)
    this.changed()
    return this.write('schedules', record.id, record)
  }

  /** @returns false when no reminder has that id. */
  deleteSchedule(id: string): Promise<boolean> {
    if (!this.reminders.delete(id)) return Promise.resolve(false)
    this.changed()
    const domain = this.domain
    if (domain === undefined) return Promise.resolve(true)
    const op = this.tail.then(() => domain.table('schedules').delete(id))
    this.tail = op.catch(() => undefined)
    return op.then(() => true)
  }

  summary(pending: readonly PendingView[], now = Date.now()): string {
    return ledgerSummary([...this.tasks.values()], pending, now)
  }

  board(pending: readonly PendingView[]): BoardView {
    return {
      ...this.state.dotSessionId === undefined ? {} : { dotSessionId: this.state.dotSessionId },
      tasks: this.list(),
      pending,
      schedules: this.schedules,
    }
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Wait for queued writes; used on shutdown and in tests. */
  flush(): Promise<void> { return this.tail.then(() => undefined, () => undefined) }

  private put(task: TaskRecord): Promise<void> {
    this.tasks.set(task.sessionId, task)
    this.prune()
    this.changed()
    return this.write('tasks', task.sessionId, task)
  }

  private prune(): void {
    if (this.tasks.size <= MAX_TASKS) return
    const archived = [...this.tasks.values()].filter(task => task.status === 'archived').sort((a, b) => a.updatedAt - b.updatedAt)
    // Pruned rows leave the memory view only; the domain has no delete and the
    // stale row is skipped again on the next load by the same cap.
    for (const task of archived.slice(0, this.tasks.size - MAX_TASKS)) this.tasks.delete(task.sessionId)
  }

  private write(table: TableName, key: string, value: unknown): Promise<void> {
    const domain = this.domain
    if (domain === undefined) return Promise.resolve()
    // State is a single document: read the latest in-memory state when the queued
    // slot actually runs, so an older queued snapshot cannot overwrite a change that
    // landed in the meantime (e.g. the migration marker merged into it).
    const op = this.tail.then(() => domain.table(table).put(key, table === 'state' ? this.state : value))
    this.tail = op.catch(() => undefined)
    return op
  }

  private changed(): void {
    for (const listener of this.listeners) {
      try { listener() } catch { /* listeners are observers */ }
    }
  }
}
