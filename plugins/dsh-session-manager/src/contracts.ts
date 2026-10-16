/** Shared names and bounds for cross-session discovery. */

export const PLUGIN_NAME = '@klarkxy/dsh-session-manager'
export const COPY_THREAD_MENU_ID = '@klarkxy/dsh-session-manager.copy-thread-id'
export const COPY_THREAD_SHORTCUT_ID = 'session-manager.copy-thread-id'
/** After the shipped pin/rename/fork/archive rows (100–400). */
export const COPY_THREAD_MENU_ORDER = 500
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

/** Endpoints on the shared TEMP_WORKSPACE_CHANNEL beyond temporary-directory allocation. */
export const WELCOME_BACK_PREPARE_ENDPOINT = 'welcomeback.prepare'
export const WELCOME_BACK_COMPACT_ENDPOINT = 'welcomeback.compact'
export const CONTINUE_SUGGEST_ENDPOINT = 'continue.suggest'
export const CONFIG_READ_ENDPOINT = 'config.read'
export const CONFIG_WRITE_ENDPOINT = 'config.write'
/** Card entry id in the chat flow; the recap renders at the latest completed turn's tail. */
export const WELCOME_BACK_CARD_ID = '@klarkxy/dsh-session-manager.welcome-back'
export const WELCOME_BACK_CARD_SLOT = 'conversation.chat.turnTail'
export const CONTINUE_GHOST_ID = '@klarkxy/dsh-session-manager.continue-ghost'
export const CONTINUE_GHOST_SLOT = 'conversation.input.overlay'

export const DEFAULT_RECAP_MINUTES = 15
export const DEFAULT_COMPACT_MINUTES = 60
/** Idle thresholds accept one week at most; 0 disables the feature. */
export const MAX_IDLE_MINUTES = 10_080
export const MAX_CONTINUE_TEXT_CHARS = 200
/** Cap every model-written recap section and the auto ghost suggestion shown in the UI. */
export const MAX_RECAP_SECTION_CHARS = 600
export const MAX_SUGGESTION_CHARS = 120
export type ContinueMode = 'fixed' | 'auto'
export const CONTINUE_MODES: readonly ContinueMode[] = ['fixed', 'auto']

/** Model-written welcome-back recap; an empty section means not established. */
export interface RecapPayload {
  readonly summary: string
  readonly progress: string
  readonly nextStep: string
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
  /** Null means the client falls back to its localized default continuation. */
  readonly text: string | null
  /** Active-branch sequence this text belongs to; absent for fixed text and the client default. */
  readonly seq?: number
}

/** The user-facing presence settings view served to the bundle config page. */
export interface ConfigView {
  readonly recapMinutes: number
  readonly compactMinutes: number
  readonly continueText: string
  readonly continueMode: ContinueMode
  /** Plugin-owned welcome-back recap model; null follows the conversation / host default model. */
  readonly model: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string } | null
  /** Plugin-owned ghost model; null follows the conversation / host default model. */
  readonly ghostModel: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string } | null
}

/** Sparse settings patch from the bundle config page; every key optional. */
export interface ConfigPatch {
  readonly recapMinutes?: number
  readonly compactMinutes?: number
  readonly continueText?: string
  readonly continueMode?: ContinueMode
  /** Null resumes following the conversation / host default model. */
  readonly model?: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string } | null
  /** Null resumes following the conversation / host default model for the ghost. */
  readonly ghostModel?: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string } | null
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
}

export interface ResolvedConfig {
  readonly pageChars: number
  readonly listLimit: number
  readonly searchLimit: number
  readonly recapMinutes: number
  readonly compactMinutes: number
  readonly continueText: string
  readonly continueMode: ContinueMode
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
  }
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
