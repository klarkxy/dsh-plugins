import type { WebFetchProvider, WebSearchProvider } from '@deepseek-ai/dsh-web'
import type { DshWebManagementDescriptor } from '@klarkxy/dsh-plugin-kit/contracts'

export const WEB_SEARCH_RPC_CHANNEL = '/web-search-manager'
export type RpcResult<T = unknown> = { ok: true; value: T } | {
  ok: false; error: { code: string; message: string; details: Record<string, unknown> }
}
export type ProviderKind = 'search' | 'fetch'
export type SearchMode = 'fusion' | 'failover' | 'single'
export type FetchMode = 'waterfall' | 'single'
/** Management metadata only. Field contract lives in plugin-kit; execution stays with ctx.web. */
export interface ProviderDescriptor extends DshWebManagementDescriptor {}
export const WEB_MANAGER_OWNER = '@klarkxy/dsh-web-search-manager'
export type LocalizedProviderText = string | Readonly<Record<string, string | undefined>>
/** Optional display & readiness metadata on a provider registered directly with ctx.web. */
export type DiscoverableSearchProvider = WebSearchProvider & {
  readonly title?: string
  readonly description?: LocalizedProviderText
  readonly ready?: (llmProvider?: string) => Promise<boolean>
  readonly dshWebManagement?: ProviderDescriptor
}
export type DiscoverableFetchProvider = WebFetchProvider & {
  readonly title?: string
  readonly description?: LocalizedProviderText
  readonly ready?: (llmProvider?: string) => Promise<boolean>
  readonly dshWebManagement?: ProviderDescriptor
}
export interface ProviderOptions {
  readonly apiKey?: string
  readonly baseURL?: string
  readonly timeoutMs: number
  readonly maxFetchChars: number
}
export type SearchProviderFactory = (options: ProviderOptions) => WebSearchProvider
export type FetchProviderFactory = (options: ProviderOptions) => WebFetchProvider
/** Never store credential values here. Keys are resolved by reference per call. */
export interface WebSettings {
  revision: number
  searchEnabled: boolean
  fetchEnabled: boolean
  searchMode: SearchMode
  fetchMode: FetchMode
  maxParallelSearch: number
  multiSourceOptIn: string[]
  searchProvider: string
  fetchProvider: string
  searchOrder: string[]
  fetchOrder: string[]
  maxResults: number
  maxQueries: number
  timeoutMs: number
  maxFetchChars: number
  endpoints: Record<string, string>
}
export const DEFAULT_SEARCH_ORDER = ['ddg'] as const
export const OFFICIAL_FREE_SEARCH_PRIORITY = ['deepseek-search-api', 'deepseek-official', 'deepseek-managed', 'ddg'] as const
export const OFFICIAL_FREE_FETCH_PRIORITY = ['deepseek-fetch-api', 'jina', 'http', 'http-managed'] as const

const AUTO_MULTISOURCE_HOST_IDS = new Set([
  'ddg', 'jina', 'http', 'http-managed',
  'deepseek-search-api', 'deepseek-fetch-api', 'deepseek-official', 'deepseek-managed',
])

export const defaultSettings = (): WebSettings => ({
  revision: 0,
  searchEnabled: true,
  fetchEnabled: true,
  searchMode: 'fusion',
  fetchMode: 'waterfall',
  maxParallelSearch: 3,
  multiSourceOptIn: [],
  searchProvider: 'ddg',
  fetchProvider: 'http',
  searchOrder: [...DEFAULT_SEARCH_ORDER],
  fetchOrder: ['http'],
  maxResults: 10,
  maxQueries: 10,
  timeoutMs: 30_000,
  maxFetchChars: 100_000,
  endpoints: {},
})

/** True when a provider may incur per-call charges or comes from an unclassified third-party plugin. */
export function requiresMultiSourceOptIn(
  descriptor: Pick<ProviderDescriptor, 'id' | 'billing'>,
): boolean {
  if (AUTO_MULTISOURCE_HOST_IDS.has(descriptor.id)) return false
  return descriptor.billing !== 'none' && descriptor.billing !== 'model-and-tools'
}

export function canJoinMultiSource(
  descriptor: Pick<ProviderDescriptor, 'id' | 'billing'>,
  kind: ProviderKind,
  multiSourceOptIn: readonly string[],
): boolean {
  if (!requiresMultiSourceOptIn(descriptor)) return true
  return multiSourceOptIn.includes(providerKey(kind, descriptor.id))
}

/** Keyed backends first, keyless last — same idea as OpenClaw auto-detect. */
export function defaultSearchOrder(ids: readonly string[], keyed: (id: string) => boolean): string[] {
  return [...ids.filter(keyed), ...ids.filter(id => !keyed(id))]
}

export function migrateSearchOrder(settings: { searchOrder?: string[]; searchProvider?: string }): string[] {
  return settings.searchOrder ?? (settings.searchProvider ? [settings.searchProvider] : [...DEFAULT_SEARCH_ORDER])
}

/** Missing order is a legacy single selection; an empty selection never opts in. */
export function migrateFetchOrder(settings: { fetchOrder?: string[]; fetchProvider?: string }): string[] {
  return settings.fetchOrder ?? (settings.fetchProvider ? [settings.fetchProvider] : [])
}

export function resolveSearchOrder(
  knownIds: readonly string[],
  settings: Pick<WebSettings, 'searchOrder' | 'searchProvider'>,
  _keyed: (id: string) => boolean,
): string[] {
  return [...new Set(settings.searchOrder.filter(id => knownIds.includes(id)))]
}

export function pickActiveSearch(order: readonly string[], configured: (id: string) => boolean): string {
  return order.find(configured) ?? ''
}
export interface ProviderView extends ProviderDescriptor {
  kind: ProviderKind
  configured: boolean
  /** True only for configuration explicitly owned by this manager bundle. */
  configurationOwned?: boolean
  /** Optional English description supplied by a native localized provider. */
  englishDescription?: string
  baseURL?: string
  calls: number
  failures: number
}
export interface WebStatus {
  settings: WebSettings
  providers: ProviderView[]
  searchActive: boolean
  fetchActive: boolean
  storageFailed: boolean
}
export function providerKey(kind: ProviderKind, id: string): string { return `${kind}:${id}` }
export function safeConfigurationUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || /[\u0000-\u0020\\]/.test(value)) return
  try {
    const url = new URL(value, 'https://dsh.invalid')
    if (url.username || url.password) return
    if ((value.startsWith('/') && !value.startsWith('//')) || value.startsWith('#')) {
      return url.origin === 'https://dsh.invalid' ? value : undefined
    }
    return /^https:\/\//i.test(value) && url.protocol === 'https:' ? value : undefined
  } catch { return }
}
export function validateBaseURL(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('供应商地址必须是 HTTPS，且不能包含用户名、密码、查询参数或片段。')
  }
  return url.href.replace(/\/+$/, '')
}
