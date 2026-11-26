/**
 * Contract source: klarkxy/zhihu-search@62fd3ce5, upstream/http_client.py.
 * Six question/creator APIs use the current Access Secret only, never OAuth.
 * This module has no DSH/UI dependencies; RPC and tools share these validators.
 */
import { zhihuFetchJson, ZhihuSearchError, type ZhihuClientOptions } from './zhihu-client.ts'
import { ZHIHU_QUOTA_IDS, normalizeZhihuQuotaId, type ZhihuQuotaId } from './contracts.ts'

export const ZHIHU_OPEN_PLATFORM_APIS = {
  'question.recommendations': { path: '/api/v1/user/question_recommendations', label: '适合回答的问题', quotaId: 'question_discovery' },
  'question.answers': { path: '/api/v1/content/question_answers', label: '问题回答摘要', quotaId: 'question_discovery' },
  'user.contents': { path: '/api/v1/user/contents', label: '本人创作列表', quotaId: 'user_data' },
  'user.followees': { path: '/api/v1/user/followees', label: '本人关注', quotaId: 'user_data' },
  'user.collections': { path: '/api/v1/user/collections', label: '近期收藏', quotaId: 'user_data' },
  'user.favlists': { path: '/api/v1/user/favlists', label: '收藏夹列表', quotaId: 'user_data' },
  'favlist.contents': { path: '/api/v1/user/favlist_contents', label: '收藏夹内容', quotaId: 'user_data' },
  'content.detail': { path: '/api/v1/user/content_detail', label: '本人创作全文', quotaId: 'creator' },
  'content.comments': { path: '/api/v1/user/content_comments', label: '本人创作评论', quotaId: 'creator' },
  'creator.account.stats': { path: '/api/v1/user/creator_account_stats', label: '账号创作数据', quotaId: 'creator' },
  'creator.content.stats': { path: '/api/v1/user/creator_content_stats', label: '单篇创作数据', quotaId: 'creator' },
  quota: { path: '/api/v1/quota', label: '官方每日额度', quotaId: undefined },
} as const
export type ZhihuOpenPlatformOperation = keyof typeof ZHIHU_OPEN_PLATFORM_APIS
const CURSOR_PAGED_OPERATIONS = new Set<ZhihuOpenPlatformOperation>(['user.contents', 'user.followees', 'favlist.contents'])

const ENDPOINT_ALIASES: Record<string, ZhihuOpenPlatformOperation> = {
  question_recommendations: 'question.recommendations', question_answers: 'question.answers',
  content_detail: 'content.detail', user_content_detail: 'content.detail', 'user.content.detail': 'content.detail',
  content_comments: 'content.comments', user_content_comments: 'content.comments', 'user.content.comments': 'content.comments',
  creator_account_stats: 'creator.account.stats', creator_content_stats: 'creator.content.stats',
  user_contents: 'user.contents', user_followees: 'user.followees', user_collections: 'user.collections',
  user_favlists: 'user.favlists', favlist_contents: 'favlist.contents',
}
export function resolveZhihuOpenPlatformOperation(endpoint: string): ZhihuOpenPlatformOperation | undefined {
  if (Object.hasOwn(ZHIHU_OPEN_PLATFORM_APIS, endpoint)) return endpoint as ZhihuOpenPlatformOperation
  return Object.hasOwn(ENDPOINT_ALIASES, endpoint) ? ENDPOINT_ALIASES[endpoint] : undefined
}

export type ZhihuPaging = {
  canContinue: boolean
  isEnd?: boolean
  /** Decimal Int64 string. Never synthesize this from the number of items. */
  nextOffset?: string
  warning?: string
}
export type ZhihuJsonValue = string | number | boolean | null | ZhihuJsonValue[] | { [key: string]: ZhihuJsonValue }
export type ZhihuOpenPlatformResult = {
  version: 1
  operation: ZhihuOpenPlatformOperation
  quotaId?: ZhihuQuotaId
  /** Original Data fields. Quota's top-level array is wrapped in { Items }. */
  data: Record<string, ZhihuJsonValue>
  paging?: ZhihuPaging
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
// Keep the free-form tool result compatible with the SDK's JSON value contract.
function jsonValue(value: unknown): value is ZhihuJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(jsonValue)
  return record(value) && Object.values(value).every(jsonValue)
}
function jsonRecord(value: unknown): value is Record<string, ZhihuJsonValue> {
  return record(value) && Object.values(value).every(jsonValue)
}
function invalid(message: string): never { throw new ZhihuSearchError('INVALID_ARGUMENTS', message) }

function inputObject(input: unknown): Record<string, unknown> {
  if (!record(input)) return invalid('参数必须是对象。')
  // Reject misleading identity overrides, even over raw RPC. Credentials belong to the host.
  for (const key of ['token', 'accessSecret', 'access_secret', 'accessToken', 'access_token', 'oauthToken', 'oauth_token', 'useConfiguredOauthUser', 'use_configured_oauth_user']) {
    if (Object.hasOwn(input, key)) invalid('这些接口仅使用当前 Access Secret，不接受 token 参数或 OAuth 身份切换。')
  }
  return { ...input }
}
function limit(value: unknown, fallback: number, maximum: number, name = 'limit'): string {
  const count = value === undefined ? fallback : value
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > maximum) {
    return invalid(`${name} 必须是 1-${maximum} 的整数。`)
  }
  return String(count)
}

/** Accept all nonnegative Int64 values as strings, but never accept an unsafe JS number. */
export function normalizeZhihuOffset(value: unknown): string {
  let decimal: string
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) decimal = String(value)
  else if (typeof value === 'string' && /^\d+$/.test(value)) decimal = value.replace(/^0+(?=\d)/, '')
  else return invalid('offset 必须是非负 Int64 整数；超过 JavaScript 安全整数范围时请用十进制字符串，不能使用不透明游标。')
  if (decimal.length > 19 || BigInt(decimal) > 9223372036854775807n) return invalid('offset 超出 Int64 范围。')
  return decimal
}

/** User-data offsets are opaque cursors, unlike the Int64 question/comment offsets. */
export function normalizeZhihuCursorOffset(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value)
  if (typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\s\u0000-\u001f\u007f-\u009f]/u.test(value)) return value
  return invalid('offset 必须是非负整数或不透明游标字符串；游标不超过 256 字符，且不能包含空白或控制字符。')
}

function positiveInteger(value: unknown, name: string): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) return invalid(`${name} 必须是正整数。`)
  return String(value)
}

function zhihuUrl(value: unknown, question: boolean): string {
  if (typeof value !== 'string' || !value.trim()) return invalid(question ? 'questionUrl 不能为空。' : 'contentUrl 不能为空。')
  const cleaned = value.trim()
  if (/[\u0000-\u0020\u007f\\]/.test(cleaned)) return invalid('知乎链接不能包含空白、控制字符或反斜线。')
  let url: URL
  try { url = new URL(cleaned) } catch { return invalid('不是有效的知乎 URL。') }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return invalid('必须使用无账号密码、无非标准端口的 HTTPS 知乎链接。')
  if (question) {
    const questionMatch = url.hostname === 'www.zhihu.com' ? /^\/question\/(\d+)\/?$/.exec(url.pathname) : null
    if (questionMatch) return cleaned
    const answerMatch = url.hostname === 'www.zhihu.com' ? /^\/question\/(\d+)\/answer\/\d+\/?$/.exec(url.pathname) : null
    if (answerMatch) return `https://www.zhihu.com/question/${answerMatch[1]}`
    return invalid('questionUrl 仅支持 https://www.zhihu.com/question/{id} 或其下的 /answer/{aid} 回答链接。')
  }
  const valid = (url.hostname === 'www.zhihu.com' && /^\/(?:answer\/\d+|question\/\d+\/answer\/\d+|pin\/\d+|zvideo\/\d+)\/?$/.test(url.pathname))
    || (url.hostname === 'zhuanlan.zhihu.com' && /^\/p\/\d+\/?$/.test(url.pathname))
  if (!valid) return invalid('contentUrl 仅支持知乎回答、专栏文章、想法或视频链接。')
  return cleaned
}

function dates(input: Record<string, unknown>, params: Record<string, string>): void {
  const { startDate, endDate } = input
  if (startDate === undefined && endDate === undefined) return
  if (startDate === undefined || endDate === undefined) invalid('startDate 与 endDate 必须同时提供或同时省略。')
  for (const [key, value] of [['StartDate', startDate], ['EndDate', endDate]] as const) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 4) === '0000') invalid(`${key} 必须是有效的 YYYY-MM-DD 公历日期。`)
    const time = new Date(`${value}T00:00:00Z`)
    if (!Number.isFinite(time.getTime()) || time.toISOString().slice(0, 10) !== value) invalid(`${key} 不是有效公历日期。`)
    params[key] = value
  }
  if (params.EndDate! < params.StartDate!) invalid('endDate 不得早于 startDate。')
}

function paramsFor(operation: ZhihuOpenPlatformOperation, input: Record<string, unknown>): Record<string, string> {
  const params: Record<string, string> = {}
  if (operation === 'question.recommendations') {
    // Explicit null/blank is not the same as omitting Query.
    if (input.query !== undefined) {
      if (typeof input.query !== 'string' || !input.query.trim()) invalid('主题关键词不能为空；省略 query 才会按画像推荐。')
      params.Query = input.query.trim()
    }
    params.Count = limit(input.count, 5, 20, 'count')
  } else if (operation === 'question.answers') {
    params.QuestionUrl = zhihuUrl(input.questionUrl, true)
  } else if (operation === 'user.contents') {
    const type = input.contentType === undefined ? 'all' : input.contentType
    if (typeof type !== 'string' || !['all', 'answer', 'article', 'zvideo', 'pin', 'question'].includes(type)) invalid('user_contents 的 contentType 必须是 all、answer、article、zvideo、pin 或 question。')
    const sortField = input.sortField === undefined ? 'ts' : input.sortField
    if (typeof sortField !== 'string' || !['like_count', 'ts'].includes(sortField)) invalid('sortField 必须是 like_count 或 ts。')
    const sortOrder = input.sortOrder === undefined ? 'desc' : input.sortOrder
    if (typeof sortOrder !== 'string' || !['asc', 'desc'].includes(sortOrder)) invalid('sortOrder 必须是 asc 或 desc。')
    params.ContentType = type
    params.SortField = sortField
    params.SortOrder = sortOrder
  } else if (operation === 'favlist.contents') {
    const hasUrlToken = input.favlistUrlToken !== undefined
    const hasId = input.favlistId !== undefined
    if (hasUrlToken === hasId) invalid('favlistUrlToken 与 favlistId 必须且只能提供一个。')
    if (hasUrlToken) params.FavlistUrlToken = positiveInteger(input.favlistUrlToken, 'favlistUrlToken')
    else params.FavlistId = positiveInteger(input.favlistId, 'favlistId')
  } else if (operation === 'content.detail' || operation === 'content.comments' || operation === 'creator.content.stats') {
    params.ContentUrl = zhihuUrl(input.contentUrl, false)
  } else if (operation === 'creator.account.stats') {
    const type = input.contentType === undefined ? 'all' : input.contentType
    if (typeof type !== 'string' || !['all', 'answer', 'article', 'pin', 'zvideo'].includes(type)) invalid('contentType 必须是 all、answer、article、pin 或 zvideo。')
    params.ContentType = type
  } else if (operation === 'quota' && input.apiIds !== undefined) {
    if (Array.isArray(input.apiIds)) input.apiIds = input.apiIds.map(normalizeZhihuQuotaId)
    if (!Array.isArray(input.apiIds) || input.apiIds.some(id => typeof id !== 'string' || !(ZHIHU_QUOTA_IDS as readonly string[]).includes(id))) invalid('apiIds 包含未知官方额度项。')
    if (input.apiIds.length) params.APIIDs = [...new Set(input.apiIds)].join(',')
  }
  if (operation === 'user.contents' || operation === 'user.followees' || operation === 'favlist.contents') {
    params.Offset = normalizeZhihuCursorOffset(input.offset === undefined ? '0' : input.offset)
    params.Limit = limit(input.limit, 20, 50)
  }
  if (operation === 'user.collections' || operation === 'user.favlists') {
    params.Limit = limit(input.limit, 20, 50)
  }
  if (operation === 'question.answers' || operation === 'content.comments') {
    params.Offset = normalizeZhihuOffset(input.offset === undefined ? 0 : input.offset)
    params.Limit = limit(input.limit, 20, 50)
  }
  if (operation === 'content.comments') {
    const order = input.order === undefined ? 'score' : input.order
    if (typeof order !== 'string' || !['score', 'reverse', 'ascending'].includes(order)) invalid('order 必须是 score、reverse 或 ascending。')
    params.Order = order
  }
  if (operation === 'creator.account.stats' || operation === 'creator.content.stats') dates(input, params)
  return params
}

export function normalizeZhihuPaging(data: Record<string, unknown>, offset: string): ZhihuPaging {
  const paging = data.Paging
  if (!record(paging) || typeof paging.IsEnd !== 'boolean') {
    return { canContinue: false, warning: '分页信息不完整：缺少有效的 Paging.IsEnd，请停止翻页。' }
  }
  if (paging.IsEnd) return { isEnd: true, canContinue: false }
  try {
    const nextOffset = normalizeZhihuOffset(paging.NextOffset)
    if (BigInt(nextOffset) <= BigInt(offset)) throw new Error('non-advancing offset')
    return { isEnd: false, canContinue: true, nextOffset }
  } catch {
    return { isEnd: false, canContinue: false, warning: '分页信息不完整：NextOffset 缺失、无效或未前进，请停止翻页；不要按条数计算偏移。' }
  }
}

/** Opaque cursor paging for user-data lists; never compare cursors numerically. */
export function normalizeZhihuCursorPaging(data: Record<string, unknown>, offset: string): ZhihuPaging {
  const paging = data.Paging
  if (!record(paging) || typeof paging.IsEnd !== 'boolean') {
    return { canContinue: false, warning: '分页信息不完整：缺少有效的 Paging.IsEnd，请停止翻页。' }
  }
  if (paging.IsEnd) return { isEnd: true, canContinue: false }
  const next = paging.NextOffset
  const nextOffset = typeof next === 'string' && next.length > 0 ? next
    : typeof next === 'number' && Number.isSafeInteger(next) && next >= 0 ? String(next)
    : undefined
  if (nextOffset !== undefined && nextOffset !== offset) return { isEnd: false, canContinue: true, nextOffset }
  return { isEnd: false, canContinue: false, warning: '分页信息不完整：NextOffset 缺失、无效或未变化，请停止翻页；不要按条数计算偏移。' }
}

export async function executeZhihuOpenPlatform(
  operation: ZhihuOpenPlatformOperation,
  input: unknown = {},
  options: ZhihuClientOptions = {},
): Promise<ZhihuOpenPlatformResult> {
  const args = inputObject(input)
  const params = paramsFor(operation, args)
  const api = ZHIHU_OPEN_PLATFORM_APIS[operation]
  const raw = await zhihuFetchJson(api.path, { params, envelope: true }, api.label, options)
  const data = operation === 'quota' && Array.isArray(raw) ? { Items: raw } : raw
  if (!jsonRecord(data)) throw new ZhihuSearchError('BAD_RESPONSE', `${api.label}的 Data 必须是 JSON 对象。`)
  return {
    version: 1, operation, data,
    ...(api.quotaId ? { quotaId: api.quotaId } : {}),
    ...(operation === 'question.answers' || operation === 'content.comments'
      ? { paging: normalizeZhihuPaging(data, params.Offset!) } : {}),
    ...(CURSOR_PAGED_OPERATIONS.has(operation)
      ? { paging: normalizeZhihuCursorPaging(data, params.Offset!) } : {}),
  }
}

export function zhihuOpenPlatformResultCount(result: ZhihuOpenPlatformResult): number {
  if (result.operation === 'quota') return 0
  if (result.operation === 'content.detail') return typeof result.data.Body === 'string' && result.data.Body.trim() ? 1 : 0
  if (result.operation === 'creator.account.stats') return Object.keys(result.data).length ? 1 : 0
  return Array.isArray(result.data.Items) ? result.data.Items.filter(record).length : 0
}
