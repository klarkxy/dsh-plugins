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
}

export interface ResolvedConfig {
  readonly pageChars: number
  readonly listLimit: number
  readonly searchLimit: number
}

export function resolveConfig(config: Config = {}): ResolvedConfig {
  return {
    pageChars: boundInteger(config.pageChars, DEFAULT_PAGE_CHARS, MIN_PAGE_CHARS, MAX_PAGE_CHARS, 'pageChars'),
    listLimit: boundInteger(config.listLimit, DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT, 'listLimit'),
    searchLimit: boundInteger(config.searchLimit, DEFAULT_SEARCH_LIMIT, 1, MAX_SEARCH_LIMIT, 'searchLimit'),
  }
}

function boundInteger(value: number | undefined, fallback: number, min: number, max: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
    throw new TypeError(`${PLUGIN_NAME}: ${name} must be an integer from ${min} to ${max}`)
  }
  return resolved
}
