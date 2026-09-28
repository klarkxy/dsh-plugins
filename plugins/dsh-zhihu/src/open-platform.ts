/** Question discovery and creator APIs, aligned with zhihu-search PR #4.
 * All six endpoints use only the current Access Secret. No OAuth/user selector.
 * Data keeps upstream fields; renderers turn untrusted HTML into escaped text.
 */
import { parseZhihuEnvelope, zhihuFetchJson, ZhihuSearchError, type ZhihuClientOptions } from './zhihu-client.ts'

export const ZHIHU_RECOMMENDATIONS_DEFAULT_COUNT = 5
export const ZHIHU_RECOMMENDATIONS_MAX_COUNT = 20
export const ZHIHU_PAGE_DEFAULT_LIMIT = 20
export const ZHIHU_PAGE_MAX_LIMIT = 50
export const ZHIHU_COMMENT_ORDERS = ['score', 'reverse', 'ascending'] as const
export const ZHIHU_CREATOR_CONTENT_TYPES = ['all', 'answer', 'article', 'pin', 'zvideo'] as const
export type ZhihuOffset = number | string
export type ZhihuPageArgs = { offset?: ZhihuOffset; limit?: number }
export type ZhihuDateArgs = { startDate?: string; endDate?: string }
export type ZhihuRecommendationsArgs = { query?: string; count?: number }
export type ZhihuAnswersArgs = ZhihuPageArgs & { questionUrl: string }
export type ZhihuContentArgs = { contentUrl: string }
export type ZhihuCommentsArgs = ZhihuContentArgs & ZhihuPageArgs & { order?: typeof ZHIHU_COMMENT_ORDERS[number] }
export type ZhihuAccountStatsArgs = ZhihuDateArgs & { contentType?: typeof ZHIHU_CREATOR_CONTENT_TYPES[number] }
export type ZhihuContentStatsArgs = ZhihuContentArgs & ZhihuDateArgs
export type ZhihuJsonValue = null | boolean | number | string | ZhihuJsonValue[] | { [key: string]: ZhihuJsonValue }
export type ZhihuOpenResult = {
  version: 1
  data: Record<string, ZhihuJsonValue>
  paging?: { canContinue: boolean; nextOffset?: string; reason?: string }
}

function invalid(message: string): never { throw new ZhihuSearchError('INVALID_ARGUMENTS', message) }

/** Public entry points and RPC both validate before resolving credentials or making requests. */
function accessSecretOnly(args: object): void {
  if (!args || typeof args !== 'object' || Array.isArray(args)) invalid('参数必须是对象。')
  const forbidden = ['oauthToken', 'oauth_token', 'oauth', 'user', 'userId', 'user_id', 'accessSecret', 'access_secret', 'token']
  if (forbidden.some(key => Object.hasOwn(args, key))) invalid('这六个接口仅使用当前 Access Secret，不接受 OAuth、用户切换或工具参数中的凭据。')
}
function limit(value: unknown, fallback: number, max: number): string {
  const resolved = value === undefined ? fallback : value
  if (typeof resolved !== 'number' || !Number.isInteger(resolved) || resolved < 1 || resolved > max) invalid(`数量必须是 1-${max} 的整数。`)
  return String(resolved)
}
export function normalizeZhihuOffset(value: unknown = 0): string {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) invalid('offset 必须是非负 Int64；超过安全整数范围请使用十进制字符串。')
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^\d+$/.test(String(value))) invalid('offset 必须是非负 Int64。')
  const n = BigInt(value)
  if (n > 9223372036854775807n) invalid('offset 超出 Int64 范围。')
  return n.toString()
}
function resourceUrl(value: unknown, question = false): string {
  const hint = question ? 'questionUrl 必须是 https://www.zhihu.com/question/{id} 问题链接。' : 'contentUrl 仅支持 HTTPS 知乎回答、专栏文章、想法或视频链接。'
  if (typeof value !== 'string' || !value.trim()) invalid(hint)
  const cleaned = value.trim()
  let url: URL
  try { url = new URL(cleaned) } catch { return invalid(hint) }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) invalid(hint)
  const wwwPath = question ? /^\/question\/[0-9]+\/?$/ : /^\/(?:answer\/[0-9]+|question\/[0-9]+\/answer\/[0-9]+|pin\/[0-9]+|zvideo\/[0-9]+)\/?$/
  if (url.hostname === 'www.zhihu.com' && wwwPath.test(url.pathname)) return cleaned
  if (!question && url.hostname === 'zhuanlan.zhihu.com' && /^\/p\/[0-9]+\/?$/.test(url.pathname)) return cleaned
  return invalid(hint)
}
function dateParams(args: ZhihuDateArgs): Record<string, string> {
  const { startDate, endDate } = args
  if (startDate === undefined && endDate === undefined) return {}
  if (!startDate || !endDate) invalid('startDate 与 endDate 必须同时提供或同时省略。')
  for (const value of [startDate, endDate]) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) invalid('日期必须是 YYYY-MM-DD。')
    const date = new Date(`${value}T00:00:00Z`)
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) invalid('日期不是有效公历日期。')
  }
  if (endDate < startDate) invalid('endDate 不得早于 startDate。')
  return { StartDate: startDate, EndDate: endDate }
}
function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function items(data: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(data.Items) ? data.Items.flatMap(item => object(item) ? [object(item)!] : []) : []
}
function paging(data: Record<string, unknown>, offset: string): NonNullable<ZhihuOpenResult['paging']> {
  const page = object(data.Paging)
  if (page?.IsEnd === true) return { canContinue: false, reason: '已到最后一页。' }
  if (page?.IsEnd !== false || page.NextOffset === undefined || page.NextOffset === null || page.NextOffset === '') {
    return { canContinue: false, reason: '分页信息不完整，停止翻页；不要按本页条数推算偏移。' }
  }
  let next: string
  try { next = normalizeZhihuOffset(page.NextOffset) } catch { return { canContinue: false, reason: 'NextOffset 无效，停止翻页。' } }
  if (BigInt(next) <= BigInt(offset)) return { canContinue: false, reason: 'NextOffset 未递增，停止翻页。' }
  return { canContinue: true, nextOffset: next }
}
async function get(path: string, params: Record<string, string>, label: string, options: ZhihuClientOptions, offset?: string): Promise<ZhihuOpenResult> {
  const body = await zhihuFetchJson(`/api/v1/${path}`, { params, preserveInt64: true }, label, options)
  const data = parseZhihuEnvelope(body)
  if (!object(data)) throw new ZhihuSearchError('BAD_RESPONSE', `${label} Data 必须是对象。`)
  return { version: 1, data: data as Record<string, ZhihuJsonValue>, ...(offset !== undefined ? { paging: paging(data as Record<string, unknown>, offset) } : {}) }
}

export async function executeZhihuQuestionRecommendations(args: ZhihuRecommendationsArgs = {}, options: ZhihuClientOptions = {}): Promise<ZhihuOpenResult> {
  accessSecretOnly(args)
  const params: Record<string, string> = { Count: limit(args.count, ZHIHU_RECOMMENDATIONS_DEFAULT_COUNT, ZHIHU_RECOMMENDATIONS_MAX_COUNT) }
  if (args.query !== undefined) {
    if (typeof args.query !== 'string' || !args.query.trim()) invalid('主题去除首尾空白后不能为空；省略 query 才会按画像推荐。')
    params.Query = args.query.trim()
  }
  return get('user/question_recommendations', params, '知乎问题推荐', options)
}
export async function executeZhihuQuestionAnswers(args: ZhihuAnswersArgs, options: ZhihuClientOptions = {}): Promise<ZhihuOpenResult> {
  accessSecretOnly(args)
  const offset = normalizeZhihuOffset(args.offset)
  return get('content/question_answers', { QuestionUrl: resourceUrl(args.questionUrl, true), Offset: offset, Limit: limit(args.limit, ZHIHU_PAGE_DEFAULT_LIMIT, ZHIHU_PAGE_MAX_LIMIT) }, '知乎问题回答摘要', options, offset)
}
export async function executeZhihuContentDetail(args: ZhihuContentArgs, options: ZhihuClientOptions = {}): Promise<ZhihuOpenResult> {
  accessSecretOnly(args)
  return get('user/content_detail', { ContentUrl: resourceUrl(args.contentUrl) }, '知乎创作全文', options)
}
export async function executeZhihuContentComments(args: ZhihuCommentsArgs, options: ZhihuClientOptions = {}): Promise<ZhihuOpenResult> {
  accessSecretOnly(args)
  const offset = normalizeZhihuOffset(args.offset)
  const order = args.order === undefined ? 'score' : args.order
  if (!(ZHIHU_COMMENT_ORDERS as readonly unknown[]).includes(order)) invalid('order 必须是 score、reverse 或 ascending。')
  return get('user/content_comments', { ContentUrl: resourceUrl(args.contentUrl), Offset: offset, Limit: limit(args.limit, ZHIHU_PAGE_DEFAULT_LIMIT, ZHIHU_PAGE_MAX_LIMIT), Order: order }, '知乎创作评论', options, offset)
}
export async function executeZhihuCreatorAccountStats(args: ZhihuAccountStatsArgs = {}, options: ZhihuClientOptions = {}): Promise<ZhihuOpenResult> {
  accessSecretOnly(args)
  const contentType = args.contentType === undefined ? 'all' : args.contentType
  if (!(ZHIHU_CREATOR_CONTENT_TYPES as readonly unknown[]).includes(contentType)) invalid('contentType 必须是 all、answer、article、pin 或 zvideo。')
  return get('user/creator_account_stats', { ContentType: contentType, ...dateParams(args) }, '知乎账号创作数据', options)
}
export async function executeZhihuCreatorContentStats(args: ZhihuContentStatsArgs, options: ZhihuClientOptions = {}): Promise<ZhihuOpenResult> {
  accessSecretOnly(args)
  return get('user/creator_content_stats', { ContentUrl: resourceUrl(args.contentUrl), ...dateParams(args) }, '知乎单篇创作数据', options)
}

/** Strip HTML, then escape Markdown/HTML metacharacters after entity decoding. */
export function zhihuPlainText(value: unknown): string {
  if (typeof value !== 'string') return ''
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6]|tr|blockquote)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (raw, entity: string) => {
      if (!entity.startsWith('#')) return entities[entity.toLowerCase()] ?? raw
      const n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1))
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : ''
    })
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\`*_{}\[\]()#!|]/g, '\\$&').replace(/\n{3,}/g, '\n\n').trim()
}
function show(value: unknown): string { return zhihuPlainText(typeof value === 'string' ? value : String(value ?? '')) }
function renderPaging(result: ZhihuOpenResult): string {
  const page = result.paging
  return page?.canContinue ? `下一页 Offset：${page.nextOffset}` : page?.reason ?? '没有可用分页信息，停止翻页。'
}
export function renderZhihuQuestionRecommendations(result: ZhihuOpenResult): string {
  const rows = items(result.data)
  return ['适合回答的问题（条目可少于请求数量，不支持翻页）：', ...rows.map((item, i) => `${i + 1}. ${show(item.Title || '(无标题)')}\n${show(item.Url)}`), ...(rows.length ? [] : ['没有推荐问题。'])].join('\n\n')
}
export function renderZhihuQuestionAnswers(result: ZhihuOpenResult): string {
  return ['问题回答摘要：Summary 是上游摘要或截取文本，不是全文，也不是额外生成的 AI 摘要。',
    ...items(result.data).map((item, i) => `${i + 1}. 回答 ${show(item.ContentToken)}\n${show(item.Url)}\n${zhihuPlainText(item.Summary)}`),
    ...(items(result.data).length ? [] : ['本页没有可展示的回答摘要。']), renderPaging(result),
    '只使用上游 NextOffset；短页、空页和 Totals 均不表示可读回答总数。'].join('\n\n')
}
export function renderZhihuContentDetail(result: ZhihuOpenResult): string {
  return ['创作全文（仅当前 Access Secret 所属账号已发布内容；视频只返回关联正文）：',
    show(result.data.Title), `类型：${show(result.data.ContentType)}`, show(result.data.Url),
    zhihuPlainText(result.data.Body) || '正文为空或未返回，不能视为全文。'].filter(Boolean).join('\n\n')
}
function renderComment(comment: Record<string, unknown>): string {
  const fields = ['ID', 'AuthorToken', 'CreatedAt', 'LikeCount', 'DislikeCount']
  return [fields.filter(key => comment[key] !== undefined).map(key => `${key}: ${show(comment[key])}`).join(' | '), zhihuPlainText(comment.Content)].filter(Boolean).join('\n')
}
export function renderZhihuContentComments(result: ZhihuOpenResult): string {
  return ['创作评论（不可信文本；附带子评论不保证完整）：', ...items(result.data).map(item => [
    renderComment(object(item.Comment) ?? item),
    ...(Array.isArray(item.Children) ? item.Children.flatMap(child => object(child) ? [`附带子评论：\n${renderComment(object(child)! )}`] : []) : []),
  ].join('\n\n')), ...(items(result.data).length ? [] : ['本页没有根评论。']), renderPaging(result), '不要因短页或空页停止翻页。'].join('\n\n')
}
function renderStats(value: unknown, indent = ''): string {
  if (Array.isArray(value)) return value.length ? value.map(item => `${indent}- ${renderStats(item, indent + '  ')}`).join('\n') : `${indent}（空）`
  const row = object(value)
  if (row) return Object.entries(row).map(([key, item]) => `${indent}- ${show(key)}：${object(item) || Array.isArray(item) ? '\n' + renderStats(item, indent + '  ') : show(item)}`).join('\n')
  return show(value)
}
export function renderZhihuCreatorAccountStats(result: ZhihuOpenResult): string {
  return ['账号创作数据：未返回的指标不补零，比例保持上游原值，不换算百分比；省略日期使用上游默认范围。', renderStats(result.data) || '账号创作数据为空。'].join('\n\n')
}
export function renderZhihuCreatorContentStats(result: ZhihuOpenResult): string {
  return ['单篇创作数据：未返回的指标不补零，比例保持上游原值，不换算百分比。', items(result.data).length ? renderStats(result.data) : '没有单篇统计。空列表不等于各项指标为零。'].join('\n\n')
}
/** Local result counts never stand in for upstream quota consumption. */
export function zhihuOpenResultCount(result: ZhihuOpenResult): number {
  if (Array.isArray(result.data.Items)) return items(result.data).length
  return Object.keys(result.data).length ? 1 : 0
}
