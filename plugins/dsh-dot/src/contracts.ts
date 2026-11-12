/**
 * Shared identifiers and record shapes of dsh-dot.
 *
 * dot is one long-lived orchestration session: it talks to the human and
 * opens, steers and checks other sessions, but its own preset carries no
 * file or shell tools. Everything else in the package reads these types.
 */
export const PLUGIN_NAME = 'dsh-dot'
export const SERVICE_NAME = 'dot'
export const PRESET_ID = 'dot'
export const RPC_CHANNEL = '/dsh-dot'

export const TOOL = {
  overview: 'dot_overview',
  read: 'dot_read',
  workspace: 'dot_workspace',
  startTask: 'dot_start_task',
  listModels: 'dot_list_models',
  sendToSession: 'dot_send',
  interruptSession: 'dot_interrupt',
  archiveSession: 'dot_archive',
  watchSession: 'dot_watch',
  answerPending: 'dot_answer',
  schedule: 'dot_schedule',
  searchHistory: 'dot_search_history',
  readHistory: 'dot_read_history',
  agreement: 'dot_agreement',
  cognition: 'dot_cognition',
  newSegment: 'dot_new_segment',
  settings: 'dot_settings',
} as const

/** Settings Dorothy may propose changing; locks themselves are human-only. */
export const SETTING_FIELDS = ['model', 'approvals', 'questions', 'scope', 'taskModels', 'policy', 'persona', 'address', 'memory'] as const
export type SettingField = typeof SETTING_FIELDS[number]
export type SettingLocks = Readonly<Partial<Record<SettingField, boolean>>>

/** A durable human decision; approving writes the value captured in the proposal only if it is still current. */
export interface SettingProposal {
  readonly id: string
  readonly field: SettingField
  readonly before: unknown
  readonly after: unknown
  readonly reason: string
  readonly createdAt: number
}

// ---- dot's knowledge: agreements and cognition -------------------------

/** One earlier full text of dot's cognition, with the moment it was replaced. */
export interface CognitionVersion {
  readonly text: string
  /** Unique, monotonically increasing; used to ask for that version back. */
  readonly at: number
}

/** dot's agreements as the settings view shows them: the human's own standing requirements. */
export interface AgreementView {
  readonly text: string
  readonly maxChars: number
  /** Whether the change before the current text can be taken back. */
  readonly canUndo: boolean
}

/** dot's cognition as the settings view shows it: its own understanding, with the versions it can return to. */
export interface CognitionView {
  readonly text: string
  readonly maxChars: number
  /** Newest first; at most COGNITION_HISTORY_MAX. The empty text is a version too. */
  readonly history: readonly CognitionVersion[]
}

/** Both prompt blocks that are not the fixed persona or the handoff. */
export interface KnowledgeView {
  readonly agreements: AgreementView
  readonly cognition: CognitionView
}

/** Sizes of the two prompt blocks; the tools and the panel refuse to grow them past this. */
export const AGREEMENTS_MAX_CHARS = 4000
export const AGREEMENT_ENTRY_MAX_CHARS = 400
export const COGNITION_MAX_CHARS = 4000
/** How many earlier cognition texts are kept for rollback. */
export const COGNITION_HISTORY_MAX = 10

// ---- dot's reminders ---------------------------------------------------

/** First words of the message that delivers due reminders to dot; the chat draws those messages as reminders. */
export const REMINDER_HEAD = '[dot reminder]'

/** When a reminder is due. Wall-clock times are in the host's local zone. */
export type ScheduleTiming =
  | { readonly kind: 'once'; readonly at: number }
  /** Every `minutes`, counted from `anchor`. */
  | { readonly kind: 'every'; readonly minutes: number; readonly anchor: number }
  /** At `time` (HH:mm) every day, or only on the given weekdays: Monday 1 to Sunday 7. */
  | { readonly kind: 'daily'; readonly time: string; readonly weekdays?: readonly number[] }

/** A reminder dot set for itself. It belongs to dot, not to one of its session segments. */
export interface ScheduleRecord {
  readonly id: string
  readonly title: string
  /** What dot reads when the reminder is due. */
  readonly prompt: string
  readonly timing: ScheduleTiming
  readonly createdAt: number
  /** When it is due next. */
  readonly nextAt: number
  readonly lastFiredAt?: number
}

/** Where a tracked session came from: dot started it, or the human asked dot to watch it. */
export type TaskOrigin = 'started' | 'watched'

/** Coarse lifecycle the board and the ledger summary show. */
export type TaskStatus = 'running' | 'idle' | 'blocked' | 'error' | 'archived'

export interface TaskRecord {
  readonly sessionId: string
  readonly origin: TaskOrigin
  readonly title: string
  readonly goal: string
  readonly cwd: string
  readonly workspaceId?: string
  /** Agent preset the session was started on, when dot started it and the host named one. */
  readonly preset?: string
  readonly status: TaskStatus
  readonly createdAt: number
  readonly updatedAt: number
  /** Last noteworthy line shown on the board: a finished turn, an error, a waiting request. */
  readonly lastNote?: string
  /** Turns that ended since dot last looked at this task. */
  readonly unseenTurns: number
}

export type PendingKind = 'approval' | 'question'

/** One request from another session that waits for dot or the human. */
export interface PendingView {
  readonly id: string
  readonly kind: PendingKind
  readonly sessionId: string
  readonly createdAt: number
  /** approval: tool name; question: the first question text. */
  readonly subject: string
  readonly detail?: string
  readonly questions?: readonly PendingQuestionItem[]
}

export interface PendingQuestionItem {
  readonly id: string
  readonly question: string
  readonly detail?: string
  readonly options?: readonly { readonly label: string; readonly description?: string }[]
  readonly multiSelect?: boolean
}

/** Board snapshot the client renders. */
export interface BoardView {
  readonly dotSessionId?: string
  readonly tasks: readonly TaskRecord[]
  readonly pending: readonly PendingView[]
  /** dot's reminders, the one due first on top. */
  readonly schedules: readonly ScheduleRecord[]
}

/**
 * Unified permission policy across sessions in scope and tasks dot starts.
 * dot: host default sandbox + dot screens prompts; human: host default + relay to human;
 * deny: host default + reject prompts automatically; allow: full access on new tasks + auto-allow prompts (cordis tasks still ask the human).
 */
export type ApprovalMode = 'dot' | 'human' | 'deny' | 'allow'

/** dot: dot settles what it can and asks the human the rest; human: dot relays every one; off: the host's own card handles it. */
export type TakeoverMode = 'dot' | 'human' | 'off'

export interface ModelChoice { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }

/**
 * Which models dot may put a task on. all: every model of the host catalog;
 * allow: only the listed ones; deny: every one except the listed ones.
 * Entries are `provider/model` keys. dot's own model is not affected.
 */
export interface TaskModelRule { readonly mode: 'all' | 'allow' | 'deny'; readonly list: readonly string[] }
export const TASK_MODEL_LIST_MAX = 500

/** Everything the human tunes in dot's settings view; stored with dot's state. */
export interface DotSettings {
  /** dot's own model; absent follows the host default model. */
  readonly model?: ModelChoice
  readonly approvals: ApprovalMode
  readonly questions: TakeoverMode
  /** all: every top-level session; tracked: only sessions on dot's board. */
  readonly scope: 'all' | 'tracked'
  /** Models dot may start tasks on. */
  readonly taskModels: TaskModelRule
  /** The human's own rules for settling requests, in their words; they take precedence over dot's defaults. */
  readonly policy: string
  /** The human's own persona text for dot; absent uses the default persona. */
  readonly persona?: string
  /** How dot addresses the human; absent uses the default. */
  readonly address?: string
  /** Missing and false both mean unlocked: existing installs opt in to self-management. */
  readonly locks?: SettingLocks
}

export const POLICY_MAX_CHARS = 2000

export const DEFAULT_SETTINGS: DotSettings = {
  approvals: 'dot',
  questions: 'dot',
  scope: 'all',
  taskModels: { mode: 'all', list: [] },
  policy: '',
}

/** The part of the settings that routes an incoming request. */
export type RuleConfig = Pick<DotSettings, 'approvals' | 'questions' | 'scope' | 'policy'>

export const DEFAULT_RULES: RuleConfig = DEFAULT_SETTINGS

// ---- dot's own context, shown in the settings view ---------------------

/**
 * Why dot's conversation moved to a fresh session segment: the context grew
 * past the rollover line, the segment sat idle, the model or the persona
 * changed, or the previous session could not be reopened.
 */
export type RolloverReason = 'context-full' | 'idle-expired' | 'model-switch' | 'prompt-changed' | 'lost' | 'manual' | 'dot-requested'

/** Once a finished turn leaves this share of the usable window occupied, the next message starts a new segment. */
export const ROLLOVER_POLICY = { ratio: 0.7 } as const

/**
 * Compaction policy of dot's preset; the context page draws its line from the
 * same numbers. Segments normally roll over first, so in-place compaction only
 * catches a single turn that outgrows the window.
 */
export const COMPACTION_POLICY = { thresholdRatio: 0.9, headroomTokens: 16_384 } as const

export type DotContextCategory = 'system' | 'tools' | 'user' | 'inject' | 'skill' | 'assistant' | 'tool'
export type DotContextParts = Record<DotContextCategory, number>

/** One actual item in the current prompt, expandable in the context browser. */
export interface DotContextNode {
  readonly id: string
  readonly seq: number
  readonly at: number
  readonly category: DotContextCategory
  readonly tokens: number
  readonly text: string
  readonly name?: string
  readonly status?: 'error'
  readonly clipped?: boolean
}

export interface DotContextSurface {
  readonly parts: DotContextParts
  readonly nodes: readonly DotContextNode[]
}

export interface DotContextUsage {
  readonly input: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly output: number
}

/** Usage baseline recorded when the human clears cumulative totals mid-segment. */
export interface DotUsageOffset extends DotContextUsage {
  readonly sessionId: string
}

/** The frozen prompt blocks of the current segment; live values before a segment exists. */
export interface DotContextSections {
  readonly persona: string
  readonly agreements: string
  readonly cognition: string
  readonly handoff: string
}

export interface DotContextView {
  /** Whether dot's session is live in this process. */
  readonly live: boolean
  readonly provider?: string
  readonly model?: string
  readonly contextWindow?: number
  /** Prompt size the next request is expected to carry. */
  readonly usedTokens?: number
  /** Prompt size at which dot's preset compacts before the next step. */
  readonly compactAt?: number
  /** Prompt size past which a finished turn moves the conversation to a new segment. */
  readonly rolloverAt?: number
  /** Output tokens reserved by the latest request, drawn by the upstream reserve masks. */
  readonly reservedOutput?: number
  /** Heuristic composition of the current context. */
  readonly breakdown?: { readonly system: number; readonly tools: number; readonly messages: number }
  /** Detailed live categories and their actual content, folded from dot's session log. */
  readonly surface?: DotContextSurface
  /** Actual frozen prompt blocks of the current segment (live text before one exists). */
  readonly sections?: DotContextSections
  /** Provider-reported cumulative totals across segments since the latest clear. */
  readonly usage?: DotContextUsage
  readonly compactions: number
  readonly lastCompactionAt?: number
}

// ---- dot's trajectory, drawn by the plugin -----------------------------

export interface TrajUsage { readonly input: number; readonly output: number; readonly cacheRead: number }

/** One row inside a step, in log order. */
export type TrajRecord =
  | { readonly kind: 'input'; readonly seq: number; readonly at: number; readonly source: 'user' | 'answer' | 'relay' | 'context' | 'notice'; readonly text: string; readonly clipped?: boolean }
  | { readonly kind: 'reasoning'; readonly seq: number; readonly at: number; readonly text: string; readonly clipped?: boolean }
  | { readonly kind: 'text'; readonly seq: number; readonly at: number; readonly text: string; readonly clipped?: boolean }
  | { readonly kind: 'call'; readonly seq: number; readonly at: number; readonly callId: string; readonly name: string; readonly args: string; readonly argsClipped?: boolean; readonly status: 'running' | 'done' | 'error'; readonly result?: string; readonly resultClipped?: boolean; readonly endedAt?: number }
  /** A compaction summary; shadowed is the estimated size of what it replaced. */
  | { readonly kind: 'compaction'; readonly seq: number; readonly at: number; readonly text: string; readonly clipped?: boolean; readonly shadowed?: number }

export interface TrajStep {
  readonly step: number
  readonly startedAt: number
  readonly endedAt?: number
  /** Time of the first streamed token, when the stream recorded one. */
  readonly firstTokenAt?: number
  readonly model?: string
  readonly usage?: TrajUsage
  readonly failed?: string
  readonly records: readonly TrajRecord[]
}

export interface TrajTurn {
  readonly turn: number
  readonly startedAt: number
  readonly endedAt?: number
  /** completed, error, cancelled… as the host logged it; absent while the turn runs. */
  readonly end?: string
  readonly error?: string
  /** Inputs that arrived before the turn's first step. */
  readonly records: readonly TrajRecord[]
  readonly steps: readonly TrajStep[]
}

export interface TrajectoryView {
  readonly sessionId?: string
  readonly turns: readonly TrajTurn[]
  /** Turns left out before the shown window. */
  readonly earlier: number
}

// ---- dot's own chat, drawn by the plugin -------------------------------

export type ChatItem =
  | { readonly kind: 'user'; readonly key: string; readonly text: string; readonly at: number }
  /** The human's answer to one of dot's cards. */
  | { readonly kind: 'answer'; readonly key: string; readonly text: string; readonly at: number }
  /** A batch of task updates the host delivered to dot. */
  | { readonly kind: 'notice'; readonly key: string; readonly text: string; readonly at: number }
  | { readonly kind: 'bot'; readonly key: string; readonly text: string; readonly at: number }
  | { readonly kind: 'tool'; readonly key: string; readonly name: string; readonly status: 'running' | 'done' | 'error'; readonly args?: Readonly<Record<string, unknown>>; readonly detail?: string; readonly at: number }
  /** A show_view card; presentation is filled once its result commits. */
  | { readonly kind: 'view'; readonly key: string; readonly title?: unknown; readonly view?: unknown; readonly presentation?: Record<string, unknown>; readonly failed?: boolean; readonly at: number }
  | { readonly kind: 'error'; readonly key: string; readonly text: string; readonly at: number }
  /** The conversation continued in a new session segment here. */
  | { readonly kind: 'segment'; readonly key: string; readonly reason?: RolloverReason; readonly at: number }

export interface ChatSnapshot {
  readonly sessionId: string
  readonly running: boolean
  /** Reply text streaming right now, before its message commits. */
  readonly streaming: string
  /** Changes on every update; the client long-polls with the last one it saw. */
  readonly rev: number
  /** Changes when the item list changes; items are sent only when it moved past the client's. */
  readonly itemsRev: number
  readonly items?: readonly ChatItem[]
  /** Answers to dot's cards by view id, for cards already answered. */
  readonly answers?: Readonly<Record<string, { readonly action: string; readonly values: Record<string, unknown> }>>
}
