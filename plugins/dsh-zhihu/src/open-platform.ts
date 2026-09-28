/**
 * Contract source: klarkxy/zhihu-search@62fd3ce5, upstream/http_client.py.
 * Six question/creator APIs use the current Access Secret only, never OAuth.
 * This module has no DSH/UI dependencies; RPC and tools share these validators.
 */
import { zhihuFetchJson, ZhihuSearchError, type ZhihuClientOptions } from './zhihu-client.ts'
import { ZHIHU_QUOTA_IDS, type ZhihuQuotaId } from './contracts.ts'

export const ZHIHU_OPEN_PLATFORM_APIS = {
  'question.recommendations': { path: '/api/v1/user/question_recommendations', label: '适合回答的问题', quotaId: 'creator' },
  'question.answers': { path: '/api/v1/content/question_answers', label: '问题回答摘要', quotaId: 'question_answers' },
  'content.detail': { path: '/api/v1/user/content_detail', label: '本人创作全文', quotaId: 'creator' },
  'content.comments': { path: '/api/v1/user/content_comments', label: '本人创作评论', quotaId: 'creator' },
  'creator.account.stats': { path: '/api/v1/user/creator_account_stats', label: '账号创作数据', quotaId: 'creator' },
  'creator.content.stats': { path: '/api/v1/user/creator_content_stats', label: '单篇创作数据', quotaId: 'creator' },
  quota: { path: '/api/v1/quota', label: '官方每日额度', quotaId: undefined },
} as const
export type ZhihuOpenPlatformOperation = keyof typeof ZHIHU_OPEN_PLATFORM_APIS

const ENDPOINT_ALIASES: Record<string, ZhihuOpenPlatformOperation> = {
  question_recommendations: 'question.recommendations', question_answers: 'question.answers',
  content_detail: 'content.detail', user_content_detail: 'content.detail', 'user.content.detail': 'content.detail',
  content_comments: 'content.comments', user_content_comments: 'content.comments', 'user.content.comments': 'content.comments',
  creator_account_stats: 'creator.account.stats', creator_content_stats: 'creator.content.stats',
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
export type ZhihuOpenPlatformResult = {
  version: 1
  operation: ZhihuOpenPlatformOperation
  quotaId?: ZhihuQuotaId
  /** Original Data fields. Quota's top-level array is wrapped in { Items }. */
  data: Record<string, unknown>
  paging?: ZhihuPaging
}
export type ZhihuPageInput = { offset?: number | string; limit?: number }
export type ZhihuDateInput = { startDate?: string; endDate?: string }
export type ZhihuCreatorContentType = 'all' | 'answer' | 'article' | 'pin' | 'zvideo'
export type ZhihuCommentOrder = 'score' | 'reverse' | 'ascending'

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
function invalid(message: string): never { throw new ZhihuSearchError('INVALID_ARGUMENTS', message) }

function inputObject(input: unknown): Record<string, unknown> {
  if (!record(input)) return invalid('参数必须是对象。')
  // Reject misleading identity overrides, even over raw RPC. Credentials belong to the host.
  for (const key of ['token', 'accessSecret', 'access_secret', 'accessToken', 'access_token', 'oauthToken', 'oauth_token', 'useConfiguredOauthUser', 'use_configured_oauth_user']) {
    if (Object.hasOwn(input, key)) invalid('这些接口仅使用当前 Access Secret，不接受 token 参数或 OAuth 身份切换。')
  }
  return input
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

function zhihuUrl(value: unknown, question: boolean): string {
  if (typeof value !== 'string' || !value.trim()) return invalid(question ? 'questionUrl 不能为空。' : 'contentUrl 不能为空。')
  const cleaned = value.trim()
  if (/[\u0000-\u0020\u007f\\]/.test(cleaned)) return invalid('知乎链接不能包含空白、控制字符或反斜线。')
  let url: URL
  try { url = new URL(cleaned) } catch { return invalid('不是有效的知乎 URL。') }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return invalid('必须使用无账号密码、无非标准端口的 HTTPS 知乎链接。')
  const valid = question
    ? url.hostname === 'www.zhihu.com' && /^\/question\/\d+\/?$/.test(url.pathname)
    : (url.hostname === 'www.zhihu.com' && /^\/(?:answer\/\d+|question\/\d+\/answer\/\d+|pin\/\d+|zvideo\/\d+)\/?$/.test(url.pathname))
      || (url.hostname === 'zhuanlan.zhihu.com' && /^\/p\/\d+\/?$/.test(url.pathname))
  if (!valid) return invalid(question ? 'questionUrl 仅支持 https://www.zhihu.com/question/{id}。' : 'contentUrl 仅支持知乎回答、专栏文章、想法或视频链接。')
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
  } else if (operation === 'content.detail' || operation === 'content.comments' || operation === 'creator.content.stats') {
    params.ContentUrl = zhihuUrl(input.contentUrl, false)
  } else if (operation === 'creator.account.stats') {
    const type = input.contentType === undefined ? 'all' : input.contentType
    if (typeof type !== 'string' || !['all', 'answer', 'article', 'pin', 'zvideo'].includes(type)) invalid('contentType 必须是 all、answer、article、pin 或 zvideo。')
    params.ContentType = type
  } else if (operation === 'quota' && input.apiIds !== undefined) {
    if (!Array.isArray(input.apiIds) || input.apiIds.some(id => typeof id !== 'string' || !(ZHIHU_QUOTA_IDS as readonly string[]).includes(id))) invalid('apiIds 包含未知官方额度项。')
    if (input.apiIds.length) params.APIIDs = [...new Set(input.apiIds)].join(',')
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
  if (!record(data)) throw new ZhihuSearchError('BAD_RESPONSE', `${api.label}的 Data 必须是对象。`)
  return {
    version: 1, operation, data,
    ...(api.quotaId ? { quotaId: api.quotaId } : {}),
    ...(operation === 'question.answers' || operation === 'content.comments'
      ? { paging: normalizeZhihuPaging(data, params.Offset!) } : {}),
  }
}

// Typed client entry points. Authentication stays in ZhihuClientOptions, never input.
export const executeZhihuQuestionRecommendations = (args: { query?: string; count?: number } = {}, options?: ZhihuClientOptions) => executeZhihuOpenPlatform('question.recommendations', args, options)
export const executeZhihuQuestionAnswers = (args: { questionUrl: string } & ZhihuPageInput, options?: ZhihuClientOptions) => executeZhihuOpenPlatform('question.answers', args, options)
export const executeZhihuUserContentDetail = (args: { contentUrl: string }, options?: ZhihuClientOptions) => executeZhihuOpenPlatform('content.detail', args, options)
export const executeZhihuUserContentComments = (args: { contentUrl: string; order?: ZhihuCommentOrder } & ZhihuPageInput, options?: ZhihuClientOptions) => executeZhihuOpenPlatform('content.comments', args, options)
export const executeZhihuCreatorAccountStats = (args: { contentType?: ZhihuCreatorContentType } & ZhihuDateInput = {}, options?: ZhihuClientOptions) => executeZhihuOpenPlatform('creator.account.stats', args, options)
export const executeZhihuCreatorContentStats = (args: { contentUrl: string } & ZhihuDateInput, options?: ZhihuClientOptions) => executeZhihuOpenPlatform('creator.content.stats', args, options)
export const executeZhihuQuota = (args: { apiIds?: ZhihuQuotaId[] } = {}, options?: ZhihuClientOptions) => executeZhihuOpenPlatform('quota', args, options)

export function zhihuOpenPlatformResultCount(result: ZhihuOpenPlatformResult): number {
  if (result.operation === 'quota') return 0
  if (result.operation === 'content.detail') return typeof result.data.Body === 'string' && result.data.Body.trim() ? 1 : 0
  if (result.operation === 'creator.account.stats') return Object.keys(result.data).length ? 1 : 0
  return Array.isArray(result.data.Items) ? result.data.Items.filter(record).length : 0
}
