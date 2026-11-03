export const PLUGIN_NAME = '@klarkxy/dsh-magpie'
export const PLUGIN_VERSION = '0.1.0'
export const RPC_CHANNEL = '/dsh-magpie'
/** Wire endpoint names; the host RPC transport only admits lowercase/dotted names. */
export const RPC_ENDPOINTS = {
  status: 'status',
  saveConnection: 'connection.save',
  test: 'test',
  sync: 'sync',
  setOptions: 'options.set',
  disconnect: 'disconnect',
} as const

/** The three llm-pi-ai provider routes, named exactly as `magpie dsh` writes them. */
export const ROUTES = {
  completions: 'magpie',
  responses: 'magpie-responses',
  anthropic: 'magpie-anthropic',
} as const
export type RouteKind = keyof typeof ROUTES
export type RouteName = (typeof ROUTES)[RouteKind]
export const ROUTE_NAMES: readonly RouteName[] = [ROUTES.completions, ROUTES.responses, ROUTES.anthropic]

/** Settings namespaces this plugin writes through `ctx.settings`. */
export const NS_LLM = 'llm-pi-ai'
export const NS_DEFAULT_MODEL = 'agent-default-model'
export const NS_WEB_SEARCH = 'web-search-deepseek'

export const DEFAULT_ADDRESS = 'http://127.0.0.1:3425'
export const DEFAULT_KEY_REF = 'MAGPIE_GATEWAY_KEY'
/** Placeholder bearer the local magpie accepts on loopback, matching magpie's own agent configs. */
export const LOOPBACK_PLACEHOLDER_KEY = 'magpie'
export const STREAM_IDLE_TIMEOUT_MS = 600000
export const GATEWAY_TIMEOUT_MS = 10000

export interface MagpieOptions {
  address: string
  apiKeyEnv: string
  syncOnStart: boolean
  defaultModel?: string
  webSearch: boolean
  webSearchModel?: string
}

export interface GatewayInfo {
  name: string
  version?: string
}

export interface SyncResult {
  at: string
  /** Models written per route, keyed by route name. */
  routes: Record<string, number>
  warnings: string[]
}

export interface StatusError {
  at: string
  message: string
}

/** One model currently present in one of the three llm-pi-ai routes. */
export interface RouteModel {
  id: string
  name?: string
  route: RouteName
}

export interface MagpieStatus {
  address: string
  apiKeyEnv: string
  keyConfigured: boolean
  keyWritable: boolean
  options: Omit<MagpieOptions, 'address' | 'apiKeyEnv'>
  /** Whether the active profile accepts settings writes. */
  writable: boolean
  gateway?: GatewayInfo
  syncing: boolean
  lastSync?: SyncResult
  lastError?: StatusError
  /** Models in the three magpie routes as stored in the active settings. */
  models: RouteModel[]
}

export interface SaveConnectionInput {
  address?: string
  apiKey?: string
  clearKey?: boolean
}

export interface SetOptionsInput {
  syncOnStart?: boolean
  defaultModel?: string | null
  webSearch?: boolean
  webSearchModel?: string | null
}

export interface TestResult {
  gateway: GatewayInfo
  models: number
}

export type RpcResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; details?: Record<string, unknown> } }
