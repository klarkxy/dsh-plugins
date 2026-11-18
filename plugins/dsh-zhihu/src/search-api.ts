/**
 * 知乎开放平台站内搜索工具。
 *
 * 端点调研结论（来源：github.com/klarkxy/zhihu-search，src/zhihu_search/upstream/http_client.py）：
 *   - 知乎站内搜索：GET /api/v1/content/zhihu_search?Query=<q>&Count=<n>
 *   - count 上限 10
 *   - 响应信封：{ Code, Message, Data }；Code 非 0 表示业务错误。
 *   - Data.Items: 每条 { Title, ContentType, Url, ContentText, VoteUpCount,
 *     CommentCount, AuthorName, AuthorityLevel, EditTime }。
 *
 * 鉴权、超时、信封解析与计量走 ./zhihu-client.ts 的共享实现；此处只保留
 * 站内搜索的参数收敛、结果规整与工具定义。
 */
import {
  normalizeSearchItem,
  parseZhihuEnvelope,
  zhihuFetchJson,
  ZhihuSearchError,
  type ZhihuClientOptions,
  type ZhihuSearchItem,
} from './zhihu-client.ts'

export { ZHIHU_RESEARCH_TOOL_NAME } from './contracts.ts'
export {
  resolveZhihuToken,
  ZhihuSearchError,
  type ZhihuSearchExecuted,
  type ZhihuSearchFetcher,
  type ZhihuSearchItem,
  type ZhihuSearchResolveOptions,
  type ZhihuSearchToken,
} from './zhihu-client.ts'
export const ZHIHU_SEARCH_VERSION = 1
export const ZHIHU_SEARCH_DEFAULT_COUNT = 5
export const ZHIHU_SEARCH_MAX_COUNT = 10
export const ZHIHU_SEARCH_TIMEOUT_MS = 15_000
export const ZHIHU_SUMMARY_MAX_CHARS = 200

const ZHIHU_SEARCH_PATH = '/api/v1/content/zhihu_search'

export type ZhihuSearchResult = {
  version: typeof ZHIHU_SEARCH_VERSION
  query: string
  count: number
  items: ZhihuSearchItem[]
  emptyReason?: string
  /** Present only when upstream returns a boolean. The documented value is fixed false; there is no cursor. */
  hasMore?: boolean
  sortBy?: string
}

const SORT_FIELDS = ['CommentCount', 'VoteUpCount', 'EditTime', 'CreateTime'] as const
const SORT_DIRECTIONS = ['asc', 'desc', 'none'] as const
export type ZhihuSortField = (typeof SORT_FIELDS)[number]
export type ZhihuSortDirection = (typeof SORT_DIRECTIONS)[number]

/** Build the documented SortBy value. Bounds are inclusive unix seconds or counts, not event dates. */
export function compileZhihuSortBy(field: ZhihuSortField, direction: ZhihuSortDirection = 'desc', min?: number, max?: number): string {
  if (!(SORT_FIELDS as readonly string[]).includes(field)) throw new ZhihuSearchError('INVALID_ARGUMENTS', 'SortBy 字段无效。')
  if (!(SORT_DIRECTIONS as readonly string[]).includes(direction)) throw new ZhihuSearchError('INVALID_ARGUMENTS', 'SortBy 方向无效。')
  const bound = (value: number | undefined, label: string) => {
    if (value === undefined) return
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      throw new ZhihuSearchError('INVALID_ARGUMENTS', `${label} 必须是非负整数。`)
    }
  }
  bound(min, 'SortBy 下界')
  bound(max, 'SortBy 上界')
  if (min !== undefined && max !== undefined && min > max) throw new ZhihuSearchError('INVALID_ARGUMENTS', 'SortBy 下界不能大于上界。')
  const range = min === undefined && max === undefined ? '' : `:(${min ?? ''},${max ?? ''})`
  return `${field}:${direction}${range}`
}

export type ZhihuSearchExecuteOptions = ZhihuClientOptions

function clampCount(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : ZHIHU_SEARCH_DEFAULT_COUNT
  if (n < 1) return 1
  if (n > ZHIHU_SEARCH_MAX_COUNT) return ZHIHU_SEARCH_MAX_COUNT
  return n
}

function filterItems(data: unknown): { items: Record<string, unknown>[]; emptyReason?: string } {
  const row = (data ?? {}) as { Items?: unknown; EmptyReason?: unknown }
  const items = Array.isArray(row.Items) ? row.Items.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item)) : []
  const emptyReason = typeof row.EmptyReason === 'string' ? row.EmptyReason : undefined
  return { items, emptyReason }
}

export async function fetchZhihuSearchData(
  query: string,
  count: number,
  options: ZhihuSearchExecuteOptions = {},
  sortBy?: string,
): Promise<{ query: string; count: number; sortBy?: string; data: unknown }> {
  const trimmed = query.trim()
  if (!trimmed) throw new ZhihuSearchError('BAD_RESPONSE', '搜索词不能为空。')
  const resolvedCount = clampCount(count)
  const params: Record<string, string> = { Query: trimmed, Count: String(resolvedCount) }
  if (sortBy) params.SortBy = sortBy
  const body = await zhihuFetchJson(ZHIHU_SEARCH_PATH, { params }, '知乎搜索', options)
  return { query: trimmed, count: resolvedCount, ...(sortBy ? { sortBy } : {}), data: parseZhihuEnvelope(body) }
}

export async function executeZhihuSearch(
  query: string,
  count: number,
  options: ZhihuSearchExecuteOptions = {},
): Promise<ZhihuSearchResult> {
  const fetched = await fetchZhihuSearchData(query, count, options)
  const data = fetched.data as { HasMore?: unknown }
  const { items, emptyReason } = filterItems(fetched.data)
  return {
    version: ZHIHU_SEARCH_VERSION,
    query: fetched.query,
    count: fetched.count,
    items: items.map(normalizeSearchItem),
    ...(emptyReason !== undefined ? { emptyReason } : {}),
    ...(typeof data.HasMore === 'boolean' ? { hasMore: data.HasMore } : {}),
  }
}

export function renderZhihuSearch(result: ZhihuSearchResult): string {
  if (result.items.length === 0) {
    return `知乎站内搜索「${result.query}」无结果${result.emptyReason ? `（${result.emptyReason}）` : ''}。`
  }
  const lines: string[] = [`知乎站内搜索「${result.query}」共 ${result.items.length} 条：`, '']
  result.items.forEach((item, index) => {
    lines.push(`${index + 1}. [${item.title}](${item.url || '（无链接）'})`)
    lines.push(`   - 类型：${item.type}　作者：${item.author}　权威：${item.authority}`)
    if (item.editTime) lines.push(`   - 时间：${item.editTime}`)
    lines.push(`   - 赞同 ${item.votes}　评论 ${item.comments}`)
    if (item.summary) lines.push(`   - 摘要：${item.summary}`)
    lines.push('')
  })
  return lines.join('\n').trimEnd()
}

