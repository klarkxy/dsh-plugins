/** Shared names and bounds for cross-session discovery. */

export const PLUGIN_NAME = '@klarkxy/dsh-session-manager'
/** Temporary-workspace row inside the New Session workspace picker (host list slot). */
export const TEMP_WORKSPACE_ITEM_ID = '@klarkxy/dsh-session-manager.temp-workspace'
export const TEMP_WORKSPACE_CHANNEL = '/dsh-session-manager'
export const TEMP_WORKSPACE_FLOW_SLOT = 'session-manager.workspace.directoryFlow'
export const USER_ACTIONS_SLOT = 'conversation.chat.user-actions'
export const USER_ACTIONS_ID = '@klarkxy/dsh-session-manager.user-actions'
export const DELETE_DIALOG_ID = '@klarkxy/dsh-session-manager.delete-chat'

export const LIST_TOOL = 'list_sessions'
export const SEARCH_TOOL = 'search_sessions'
export const READ_TOOL = 'read_session'
export const FORK_TOOL = 'fork_session'
export const SEND_TOOL = 'send_session_message'
/**
 * Durable message-source kind shared with the host's adjacent-agent delivery
 * (dsh-subagent/continuation-messages): `form: 'relay'` plus the sender's
 * session id. Agent tools must never stamp `kind: 'user'` — the session
 * prompt endpoint's user-rpc source is the only path that may claim it.
 */
export const AGENT_MESSAGE_KIND = 'agent-message'

/** Endpoints on the shared TEMP_WORKSPACE_CHANNEL beyond temporary-directory allocation. */
export const WELCOME_BACK_PREPARE_ENDPOINT = 'welcomeback.prepare'
export const WELCOME_BACK_COMPACT_ENDPOINT = 'welcomeback.compact'
export const CONTINUE_SUGGEST_ENDPOINT = 'continue.suggest'
export const EDIT_PREPARE_ENDPOINT = 'edit.prepare'
export const EDIT_FILE_ENDPOINT = 'edit.file'
export const CONFIG_READ_ENDPOINT = 'config.read'
export const CONFIG_WRITE_ENDPOINT = 'config.write'
export const AUTO_CONTINUE_STATUS_ENDPOINT = 'autocontinue.status'
export const AUTO_CONTINUE_UPDATE_ENDPOINT = 'autocontinue.update'
/** This plugin's rows inside the shared Session Management settings list. */
export const SESSION_SETTINGS_ITEMS = [
  { id: 'session-manager.composer', order: 60 },
  { id: 'session-manager.auto-continue', order: 62 },
  { id: 'session-manager.return', order: 64 },
  { id: 'session-manager.handoff', order: 66 },
  { id: 'session-manager.agent-actions', order: 68 },
] as const

/**
 * Stable feature ids stamped on `callLlmText` requests: each generated call is
 * attributed to its own per-session × feature context. The ghost bucket is
 * never shared with the judge — see buildAuxiliaryUserText in the kit.
 */
export const FEATURE_RECAP = 'session-manager.recap'
export const FEATURE_GHOST = 'session-manager.ghost'
export const FEATURE_JUDGE = 'session-manager.judge'
export const FEATURE_HANDOFF = 'session-manager.handoff'

/** Card entry id in the chat flow; the recap renders at the latest completed turn's tail. */
export const WELCOME_BACK_CARD_ID = '@klarkxy/dsh-session-manager.welcome-back'
export const TURN_TAIL_SLOT = 'conversation.chat.turnTail'
export const CONTINUE_GHOST_ID = '@klarkxy/dsh-session-manager.continue-ghost'
export const CONTINUE_GHOST_SLOT = 'conversation.input.overlay'

export const DEFAULT_RECAP_MINUTES = 15
export const DEFAULT_COMPACT_MINUTES = 60
/** Idle thresholds accept one week at most; 0 disables the feature. */
export const MAX_IDLE_MINUTES = 10_080
export const MAX_CONTINUE_TEXT_CHARS = 200
/** Cap every model-written recap section shown in the UI. */
export const MAX_RECAP_SECTION_CHARS = 600
export type ContinueMode = 'fixed' | 'auto'
export const CONTINUE_MODES: readonly ContinueMode[] = ['fixed', 'auto']
/** Per-session automatic continuation stance; 'off' never sends one. */
export type AutoContinueMode = 'off' | 'cautious' | 'bold'
export const AUTO_CONTINUE_MODES: readonly AutoContinueMode[] = ['off', 'cautious', 'bold']
export const DEFAULT_AUTO_CONTINUE_MAX = 3
export const MIN_AUTO_CONTINUE_MAX = 1
export const MAX_AUTO_CONTINUE_MAX = 10

/** The per-session auto-continue row as the hero option sees it. */
export interface AutoContinueStatus {
  readonly sessionId: string
  /** 'executor' for subagent threads: they never carry their own option. */
  readonly role: 'coordinator' | 'executor'
  /** The locked mode; 'off' when the session has no record yet. */
  readonly mode: AutoContinueMode
  /** Automatic continuations allowed after each human message. */
  readonly max: number
  /** The session record's revision; 0 when the session has no record yet. */
  readonly revision: number
  /** No edit is allowed once the first turn starts, or while the session is cold. */
  readonly locked: boolean
}

/** Model-written welcome-back recap; an empty section means not established. */
export interface RecapPayload {
  readonly summary: string
  readonly progress: string
  readonly nextStep: string
}

export interface EditPrepareRequest {
  readonly sessionId: string
  readonly promptSeq: number
}

export type EditContent = { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly attachmentId: string }
  | { readonly type: 'file'; readonly attachmentId: string; readonly name: string; readonly bytes: number }

export interface EditPrepareValue {
  readonly sessionId: string
  readonly promptSeq: number
  readonly text: string
  /** Original order; images are read through the source Session's authorized endpoint. */
  readonly content?: readonly EditContent[]
  /** The host recorded later file changes after this prompt. */
  readonly modified: boolean
}

export interface WelcomeBackPrepareRequest {
  readonly sessionId: string
  /**
   * The lastResponseAt the client already answered for this session. The host
   * skips the recap model call when the mark is unchanged, so a dismissed
   * card costs one cheap observation instead of a model call.
   */
  readonly knownLastResponseAt?: number
}

export type WelcomeBackPrepareValue =
  | { readonly show: false }
  | {
    readonly show: true
    readonly sessionId: string
    readonly lastResponseAt: number
    readonly idleMinutes: number
    /** Null when the recap model was unavailable or failed; a compact suggestion still shows. */
    readonly recap: RecapPayload | null
    readonly compactSuggested: boolean
    readonly compactAvailable: boolean
    /** Host-resolved compaction threshold in minutes; 0 means the suggestion is disabled. */
    readonly compactMinutes: number
  }

export interface WelcomeBackCompactRequest {
  readonly sessionId: string
  readonly requestId: string
}

export type WelcomeBackCompactValue =
  | { readonly compacted: true; readonly shadowedTokens: number | null }
  | { readonly compacted: false; readonly reason: 'busy' | 'unavailable' | 'nothing' }

export interface ContinueSuggestRequest {
  readonly sessionId: string
  /**
   * Last event sequence the client already cached a suggestion for. When it
   * still matches the active branch, the host returns the stored line and
   * skips another model call.
   */
  readonly knownSeq?: number
}

export interface ContinueSuggestValue {
  /** Null means there is no continuation to show. */
  readonly text: string | null
  /** Active-branch sequence this text belongs to; absent while a turn is still open. */
  readonly seq?: number
  /** True while the latest turn has not ended, so the composer keeps its own placeholder. */
  readonly pending?: true
  /** Empty fixed text uses the localized default once a turn has ended. */
  readonly fallback?: true
}

/** The user-facing presence settings view served to the bundle config page. */
export interface ConfigView {
  readonly recapMinutes: number
  readonly compactMinutes: number
  readonly continueText: string
  readonly continueMode: ContinueMode
  /** Plugin-owned welcome-back recap model; null follows the default auxiliary model. */
  readonly model: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string } | null
  /** Plugin-owned ghost model; null follows the default auxiliary model. */
  readonly ghostModel: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string } | null
  /** Plugin-owned auto-continue judge model; null follows the default auxiliary model. */
  readonly judgeModel: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string } | null
  /** Plugin-owned read_session handoff model; null follows the default auxiliary model. */
  readonly handoffModel: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string } | null
  /** Initial auto-continue mode for sessions created later. */
  readonly autoContinueMode: AutoContinueMode
  /** Automatic continuations allowed after each human message in an auto-continue session. */
  readonly autoContinueMax: number
  /** Whether the agent may fork its own session without per-call approval. */
  readonly allowSelfFork: boolean
  /** Whether the agent may message other unarchived sessions without per-call approval. */
  readonly allowSendMessage: boolean
}

/** Sparse settings patch from the bundle config page; every key optional. */
export interface ConfigPatch {
  readonly recapMinutes?: number
  readonly compactMinutes?: number
  readonly continueText?: string
  readonly continueMode?: ContinueMode
  /** Null resumes following the default auxiliary model. */
  readonly model?: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string } | null
  /** Null resumes following the default auxiliary model for the ghost. */
  readonly ghostModel?: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string } | null
  /** Null resumes following the default auxiliary model for the auto-continue judge. */
  readonly judgeModel?: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string } | null
  /** Null resumes following the default auxiliary model for read_session handoff summaries. */
  readonly handoffModel?: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string } | null
  readonly autoContinueMode?: AutoContinueMode
  readonly autoContinueMax?: number
  readonly allowSelfFork?: boolean
  readonly allowSendMessage?: boolean
}

export interface ConfigWriteRequest {
  readonly patch: ConfigPatch
}

export const DEFAULT_PAGE_CHARS = 4_000
export const MIN_PAGE_CHARS = 200
export const MAX_PAGE_CHARS = 16_000
export const DEFAULT_LIST_LIMIT = 20
export const MAX_LIST_LIMIT = 100
export const DEFAULT_SEARCH_LIMIT = 20
export const MAX_SEARCH_LIMIT = 50
export const TOOL_SUMMARY_CHARS = 160

/** Conversation reading pages by turn count, never by output size. */
export const DEFAULT_TURN_LIMIT = 5
export const MAX_TURN_LIMIT = 20
/** Deterministic preview caps in Unicode code points; full text stays in details mode. */
export const PREVIEW_REQUEST_CHARS = 256
export const PREVIEW_CONTEXT_CHARS = 128
export const PREVIEW_RESPONSE_CHARS = 512

export interface Config {
  /** Maximum serialized UTF-8 bytes of one read_session details/handoff page, including item metadata. Conversation turn previews do not use this budget. */
  pageChars?: number
  /** Maximum sessions returned by one list_sessions page. */
  listLimit?: number
  /** Maximum sessions returned by one search_sessions page. */
  searchLimit?: number
  /** Idle minutes since the last response before the welcome-back recap card may appear; 0 disables it. */
  recapMinutes?: number
  /** Idle minutes since the last response before the card also suggests context compaction; 0 disables it. */
  compactMinutes?: number
  /** Fixed ghost continuation text; empty falls back to the localized default ("继续"/"Continue"). */
  continueText?: string
  /** fixed: send continueText; auto: generate the ghost once after the previous turn ends and cache it in the session. */
  continueMode?: ContinueMode
  /** Initial auto-continue mode for sessions created later. */
  autoContinueMode?: AutoContinueMode
  /** Automatic continuations allowed after each human message in an auto-continue session. */
  autoContinueMax?: number
  /** Register the fork_session tool: one-call forks of the calling session, approved once by the toggle. */
  allowSelfFork?: boolean
  /** Register the send_session_message tool: agent-attributed messages to other unarchived sessions, approved once by the toggle. */
  allowSendMessage?: boolean
}

export interface ResolvedConfig {
  readonly pageChars: number
  readonly listLimit: number
  readonly searchLimit: number
  readonly recapMinutes: number
  readonly compactMinutes: number
  readonly continueText: string
  readonly continueMode: ContinueMode
  readonly autoContinueMode: AutoContinueMode
  readonly autoContinueMax: number
  readonly allowSelfFork: boolean
  readonly allowSendMessage: boolean
}

export function resolveConfig(config: Config = {}): ResolvedConfig {
  return {
    pageChars: boundInteger(config.pageChars, DEFAULT_PAGE_CHARS, MIN_PAGE_CHARS, MAX_PAGE_CHARS, 'pageChars'),
    listLimit: boundInteger(config.listLimit, DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT, 'listLimit'),
    searchLimit: boundInteger(config.searchLimit, DEFAULT_SEARCH_LIMIT, 1, MAX_SEARCH_LIMIT, 'searchLimit'),
    recapMinutes: boundInteger(config.recapMinutes, DEFAULT_RECAP_MINUTES, 0, MAX_IDLE_MINUTES, 'recapMinutes'),
    compactMinutes: boundInteger(config.compactMinutes, DEFAULT_COMPACT_MINUTES, 0, MAX_IDLE_MINUTES, 'compactMinutes'),
    continueText: boundText(config.continueText, MAX_CONTINUE_TEXT_CHARS, 'continueText'),
    continueMode: boundMode(config.continueMode, 'continueMode'),
    autoContinueMode: boundAutoContinueMode(config.autoContinueMode, 'autoContinueMode'),
    autoContinueMax: boundInteger(config.autoContinueMax, DEFAULT_AUTO_CONTINUE_MAX, MIN_AUTO_CONTINUE_MAX, MAX_AUTO_CONTINUE_MAX, 'autoContinueMax'),
    allowSelfFork: boundFlag(config.allowSelfFork, 'allowSelfFork'),
    allowSendMessage: boundFlag(config.allowSendMessage, 'allowSendMessage'),
  }
}

function boundFlag(value: boolean | undefined, name: string): boolean {
  const resolved = value ?? false
  if (typeof resolved !== 'boolean') {
    throw new TypeError(`${PLUGIN_NAME}: ${name} must be a boolean`)
  }
  return resolved
}

function boundInteger(value: number | undefined, fallback: number, min: number, max: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
    throw new TypeError(`${PLUGIN_NAME}: ${name} must be an integer from ${min} to ${max}`)
  }
  return resolved
}

function boundText(value: string | undefined, maxChars: number, name: string): string {
  const resolved = value?.trim() ?? ''
  if (Array.from(resolved).length > maxChars) {
    throw new TypeError(`${PLUGIN_NAME}: ${name} must be at most ${maxChars} characters`)
  }
  return resolved
}

function boundMode(value: ContinueMode | undefined, name: string): ContinueMode {
  const resolved = value ?? 'fixed'
  if (!CONTINUE_MODES.includes(resolved)) {
    throw new TypeError(`${PLUGIN_NAME}: ${name} must be one of ${CONTINUE_MODES.join(', ')}`)
  }
  return resolved
}

function boundAutoContinueMode(value: AutoContinueMode | undefined, name: string): AutoContinueMode {
  const resolved = value ?? 'off'
  if (!AUTO_CONTINUE_MODES.includes(resolved)) {
    throw new TypeError(`${PLUGIN_NAME}: ${name} must be one of ${AUTO_CONTINUE_MODES.join(', ')}`)
  }
  return resolved
}
