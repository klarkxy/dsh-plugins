import type { WebFetchProvider, WebSearchProvider } from '@deepseek-ai/dsh-web'
import type { DshWebManagementDescriptor } from '@klarkxy/dsh-plugin-kit/contracts'

export const WEB_SEARCH_RPC_CHANNEL = '/web-search-manager'
export type RpcResult<T = unknown> = { ok: true; value: T } | {
  ok: false; error: { code: string; message: string; details: Record<string, unknown> }
}
export type ProviderKind = 'search' | 'fetch'
/** Management metadata only. Field contract lives in plugin-kit; execution stays with ctx.web. */
export interface ProviderDescriptor extends DshWebManagementDescriptor {}
export const WEB_MANAGER_OWNER = '@klarkxy/dsh-web-search-manager'
/** Optional display metadata on a provider registered directly with ctx.web. */
export type DiscoverableSearchProvider = WebSearchProvider & { readonly dshWebManagement?: ProviderDescriptor }
export type DiscoverableFetchProvider = WebFetchProvider & { readonly dshWebManagement?: ProviderDescriptor }
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

export const defaultSettings = (): WebSettings => ({
  revision: 0, searchEnabled: true, fetchEnabled: true,
  searchProvider: 'ddg', fetchProvider: 'http', searchOrder: [...DEFAULT_SEARCH_ORDER], fetchOrder: ['http'],
  maxResults: 5, maxQueries: 1,
  timeoutMs: 30_000, maxFetchChars: 100_000, endpoints: {},
})

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
