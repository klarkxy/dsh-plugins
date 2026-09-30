import { useEffect, useRef, useState } from 'react'
import { Checkbox } from '@deepseek-ai/dsh-client-ui-primitives'
import { ZHIHU_QUOTA_IDS, ZHIHU_RPC_CHANNEL } from './contracts.ts'
import { createZhihuClientState, type ZhihuClientState } from './client-state.ts'
import { renderInput, renderSelect, ZhihuButton, ZhihuDetails, type HostButton, type HostInput, type HostSelect } from './client-host-ui.tsx'
import type { ZhihuOpenPlatformOperation, ZhihuOpenPlatformResult } from './open-platform.ts'
import { translator, useT, type Translate } from './client-locale.ts'

export type ZhihuOpenPlatformRpc = {
  call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown>
}
const OPERATION_COPY = [
  { value: 'question.recommendations', zh: '适合回答的问题', en: 'Questions to answer' },
  { value: 'question.answers', zh: '问题回答摘要（非全文）', en: 'Answer summaries (not full text)' },
  { value: 'content.detail', zh: '本人创作全文', en: 'My content (full text)' },
  { value: 'content.comments', zh: '本人创作评论', en: 'Comments on my content' },
  { value: 'creator.account.stats', zh: '账号创作数据', en: 'Account creator stats' },
  { value: 'creator.content.stats', zh: '单篇创作数据', en: 'Per-post creator stats' },
  { value: 'quota', zh: '官方每日额度', en: 'Official daily quota' },
] as const
type OperationValue = (typeof OPERATION_COPY)[number]['value']

export function openPlatformOptions(t: Translate = translator()): { value: OperationValue; label: string }[] {
  return OPERATION_COPY.map(option => ({ value: option.value, label: t(option.zh, option.en) }))
}
export const OPEN_PLATFORM_OPTIONS = openPlatformOptions()
export type OpenPlatformForm = {
  query: string; count: string; questionUrl: string; contentUrl: string
  offset: string; limit: string; order: string; contentType: string
  startDate: string; endDate: string; apiIds: string[]
}
export const createOpenPlatformForm = (): OpenPlatformForm => ({
  query: '', count: '5', questionUrl: '', contentUrl: '', offset: '0', limit: '20',
  order: 'score', contentType: 'all', startDate: '', endDate: '', apiIds: [],
})
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/** Int64 stays decimal text throughout the browser; never round-trip through Number. */
export function openPlatformOffset(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  const decimal = value.replace(/^0+(?=\d)/, '')
  return decimal.length < 19 || (decimal.length === 19 && decimal <= '9223372036854775807') ? decimal : null
}
/** `field` is the user-facing name; `param` stays in the message so a log still maps to the API. */
function integer(value: string, maximum: number, field: string, param: string, t: Translate): number {
  const message = t(`${field}（${param}）必须是 1–${maximum} 的整数。`, `${field} (${param}) must be a whole number from 1 to ${maximum}.`)
  if (!/^\d+$/.test(value.trim())) throw new Error(message)
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > maximum) throw new Error(message)
  return n
}
function contentUrl(value: string, question: boolean, t: Translate): string {
  const clean = value.trim()
  const invalid = t('请填写有效的 HTTPS 知乎链接。', 'Enter a valid HTTPS Zhihu link.')
  if (!clean || /[\u0000-\u0020\u007f\\]/.test(clean)) throw new Error(invalid)
  let url: URL
  try { url = new URL(clean) } catch { throw new Error(invalid) }
  const pathOk = question
    ? url.hostname === 'www.zhihu.com' && /^\/question\/\d+\/?$/.test(url.pathname)
    : (url.hostname === 'www.zhihu.com' && /^\/(?:answer\/\d+|question\/\d+\/answer\/\d+|pin\/\d+|zvideo\/\d+)\/?$/.test(url.pathname))
      || (url.hostname === 'zhuanlan.zhihu.com' && /^\/p\/\d+\/?$/.test(url.pathname))
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !pathOk) {
    throw new Error(question
      ? t('问题链接须为 https://www.zhihu.com/question/{id}。', 'The question link must be https://www.zhihu.com/question/{id}.')
      : t('内容链接须为知乎回答、文章、想法或视频链接。', 'The content link must be a Zhihu answer, article, pin or video.'))
  }
  return clean
}
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** Browser-only validation; authoritative validation remains with the existing RPC. */
export function buildOpenPlatformParams(operation: ZhihuOpenPlatformOperation, form: OpenPlatformForm, t: Translate = translator()): Record<string, unknown> {
  if (!OPERATION_COPY.some(option => option.value === operation)) throw new Error(t('未知操作。', 'Unknown operation.'))
  const params: Record<string, unknown> = {}
  if (operation === 'question.recommendations') {
    if (form.query.trim()) params.query = form.query.trim()
    params.count = integer(form.count, 20, t('数量', 'Count'), 'count', t)
  }
  if (operation === 'question.answers') params.questionUrl = contentUrl(form.questionUrl, true, t)
  if (['content.detail', 'content.comments', 'creator.content.stats'].includes(operation)) params.contentUrl = contentUrl(form.contentUrl, false, t)
  if (operation === 'question.answers' || operation === 'content.comments') {
    const offset = openPlatformOffset(form.offset.trim())
    if (offset === null) throw new Error(t('起始位置（offset）必须是非负整数。', 'Start position (offset) must be a non-negative whole number.'))
    params.offset = offset
    params.limit = integer(form.limit, 50, t('每页数量', 'Page size'), 'limit', t)
  }
  if (operation === 'content.comments') {
    if (!['score', 'reverse', 'ascending'].includes(form.order)) throw new Error(t('请选择有效的评论排序。', 'Choose a valid comment order.'))
    params.order = form.order
  }
  if (operation === 'creator.account.stats') {
    if (!['all', 'answer', 'article', 'pin', 'zvideo'].includes(form.contentType)) throw new Error(t('请选择有效的内容类型。', 'Choose a valid content type.'))
    params.contentType = form.contentType
  }
  if (operation === 'creator.account.stats' || operation === 'creator.content.stats') {
    const start = form.startDate.trim(), end = form.endDate.trim()
    if (start || end) {
      if (!validDate(start) || !validDate(end)) throw new Error(t('开始和结束日期须同时填写有效的 YYYY-MM-DD 日期，或同时留空。', 'Fill both start and end dates as YYYY-MM-DD, or leave both empty.'))
      if (end < start) throw new Error(t('结束日期不得早于开始日期。', 'The end date cannot be before the start date.'))
      params.startDate = start; params.endDate = end
    }
  }
  if (operation === 'quota') {
    if (!Array.isArray(form.apiIds) || form.apiIds.some(id => !(ZHIHU_QUOTA_IDS as readonly string[]).includes(id))) throw new Error(t('包含未知官方额度项。', 'Contains an unknown quota item.'))
    if (form.apiIds.length) params.apiIds = [...new Set(form.apiIds)]
  }
  return params
}
function jsonValue(value: unknown, depth = 0): boolean {
  if (depth > 64) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(item => jsonValue(item, depth + 1))
  return isRecord(value) && Object.values(value).every(item => jsonValue(item, depth + 1))
}
export function parseOpenPlatformResponse(operation: ZhihuOpenPlatformOperation, raw: unknown): ZhihuOpenPlatformResult {
  if (!isRecord(raw) || raw.ok !== true) {
    if (isRecord(raw) && raw.ok === false && isRecord(raw.error) && typeof raw.error.message === 'string') {
      throw new Error(`${typeof raw.error.code === 'string' ? raw.error.code + '：' : ''}${raw.error.message}`)
    }
    throw new Error('RPC 返回格式无效。')
  }
  const value = raw.value
  if (!isRecord(value) || value.version !== 1 || value.operation !== operation || !isRecord(value.data) || !jsonValue(value.data)) throw new Error('开放平台响应格式无效。')
  if (value.quotaId !== undefined && !(ZHIHU_QUOTA_IDS as readonly unknown[]).includes(value.quotaId)) throw new Error('响应额度项无效。')
  if (value.paging !== undefined && (!isRecord(value.paging) || typeof value.paging.canContinue !== 'boolean'
    || (value.paging.isEnd !== undefined && typeof value.paging.isEnd !== 'boolean')
    || (value.paging.warning !== undefined && typeof value.paging.warning !== 'string'))) throw new Error('分页响应格式无效。')
  return value as unknown as ZhihuOpenPlatformResult
}
export function openPlatformNextOffset(result: ZhihuOpenPlatformResult | null, currentOffset: string): string | null {
  if (!result || !['question.answers', 'content.comments'].includes(result.operation) || result.paging?.canContinue !== true || result.paging.isEnd === true) return null
  const next = openPlatformOffset(result.paging.nextOffset), current = openPlatformOffset(currentOffset)
  if (next === null || current === null) return null
  return next.length > current.length || (next.length === current.length && next > current) ? next : null
}

/** Shared lineage executor, also testable without a DOM. Cancelled/superseded replies never publish. */
export async function requestOpenPlatform(rpc: ZhihuOpenPlatformRpc, state: ZhihuClientState,
  operation: ZhihuOpenPlatformOperation, params: Record<string, unknown>,
  publish: (result: { value: ZhihuOpenPlatformResult } | { error: string }) => void): Promise<void> {
  const { ticket, signal } = state.begin()
  try {
    const raw = await rpc.call(ZHIHU_RPC_CHANNEL, operation, params, signal)
    if (!state.isCurrent(ticket)) return
    publish({ value: parseOpenPlatformResponse(operation, raw) })
  } catch (error) {
    if (state.isCurrent(ticket)) publish({ error: error instanceof Error ? error.message : String(error) })
  }
}

export function ZhihuOpenPlatformSection({ rpc, Button, Input, Select, quotaOnly = false, selectedOperation }: {
  rpc: ZhihuOpenPlatformRpc; Button?: HostButton; Input?: HostInput; Select?: HostSelect; quotaOnly?: boolean
  /** Controlled by the unified test selector; omit the standalone heading and selector. */
  selectedOperation?: ZhihuOpenPlatformOperation
}) {
  const t = useT()
  const [operation, setOperation] = useState<ZhihuOpenPlatformOperation>(quotaOnly ? 'quota' : 'question.recommendations')
  const [form, setForm] = useState(createOpenPlatformForm)
  const [result, setResult] = useState<ZhihuOpenPlatformResult | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // A result stays visible after an edit but is marked stale, like the search section.
  const [stale, setStale] = useState(false)
  const state = useRef(createZhihuClientState()).current
  const activeOperation = quotaOnly ? 'quota' : selectedOperation ?? operation
  /** Switching operation or transport: the old result no longer belongs here. */
  const reset = () => { state.noteInput(); setLoading(false); setResult(null); setStale(false); setError('') }
  /** Editing a field: abort in flight, keep the last result, flag it stale. */
  const edited = () => { state.noteInput(); setLoading(false); setError(''); setStale(true) }
  useEffect(() => { reset(); return () => state.cancel() }, [rpc, quotaOnly, selectedOperation, state])
  const change = (key: keyof OpenPlatformForm, value: string | string[]) => { edited(); setForm(previous => ({ ...previous, [key]: value })) }
  /** Label is user copy; the API parameter name rides in the hint for people cross-checking the docs. */
  const field = (key: Exclude<keyof OpenPlatformForm, 'apiIds'>, label: string, hint: string, placeholder?: string) => {
    const hintId = `zhihu-op-${key}-hint`
    return <label key={key} className="dsh-ui-field">
      <span className="dsh-ui-label">{label}</span>
      {renderInput(Input, { value: form[key], onChange: value => change(key, value), 'aria-label': label, 'aria-describedby': hintId, placeholder, className: 'zhihu-input' })}
      <span className="dsh-ui-hint" id={hintId}>{hint}</span>
    </label>
  }
  const select = (key: 'order' | 'contentType', label: string, hint: string, options: readonly { value: string; label: string }[]) => <label className="dsh-ui-field">
    <span className="dsh-ui-label">{label}</span>{renderSelect(Select, { value: form[key], onChange: value => change(key, value), 'aria-label': label, options }, 'dsh-ui-select')}
    <span className="dsh-ui-hint">{hint}</span>
  </label>
  const run = (offset?: string) => {
    let params: Record<string, unknown>
    const nextForm = offset === undefined ? form : { ...form, offset }
    try { params = buildOpenPlatformParams(activeOperation, nextForm, t) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return }
    if (offset !== undefined) setForm(nextForm)
    setLoading(true); setError('')
    void requestOpenPlatform(rpc, state, activeOperation, params, outcome => {
      setLoading(false)
      if ('value' in outcome) { setResult(outcome.value); setStale(false) } else setError(outcome.error)
    })
  }
  const nextOffset = stale ? null : openPlatformNextOffset(result, form.offset.trim())
  const paged = activeOperation === 'question.answers' || activeOperation === 'content.comments'
  const dated = activeOperation === 'creator.account.stats' || activeOperation === 'creator.content.stats'
  const options = openPlatformOptions(t)
  const title = quotaOnly ? t('官方每日额度', 'Official daily quota') : t('问题与创作', 'Questions and creator')
  return <section className="zhihu-open-platform dsh-ui-stack" aria-label={title}>
    {selectedOperation === undefined && <h3 className="dsh-ui-heading">{title}</h3>}
    <p className="dsh-ui-help">{quotaOnly
      ? t('查询知乎返回的官方额度，不推算余额。', 'Shows the quota Zhihu reports; no balance is inferred.')
      : t('点击后才请求，不会自动翻页或重试。', 'Runs only when you click; never pages or retries automatically.')}</p>
    {!quotaOnly && selectedOperation === undefined && renderSelect(Select, { value: activeOperation, options, 'aria-label': t('开放平台操作', 'Open Platform operation'), onChange: value => {
      if (options.some(option => option.value === value)) { reset(); setOperation(value as ZhihuOpenPlatformOperation) }
    } }, 'dsh-ui-select')}
    <OpenPlatformDetails quotaOnly={quotaOnly} />
    <div className="dsh-ui-stack">
      {activeOperation === 'question.recommendations' && <>
        {field('query', t('主题关键词', 'Topic keywords'), t('query · 留空则按账号画像推荐', 'query · leave empty to recommend from your profile'))}
        {field('count', t('推荐数量', 'Number of questions'), t('count · 1–20', 'count · 1–20'))}
      </>}
      {activeOperation === 'question.answers' && field('questionUrl', t('知乎问题链接', 'Zhihu question link'), 'questionUrl', 'https://www.zhihu.com/question/123')}
      {['content.detail', 'content.comments', 'creator.content.stats'].includes(activeOperation) && field('contentUrl', t('本人内容链接', 'Link to your content'), t('contentUrl · 回答、文章、想法或视频', 'contentUrl · answer, article, pin or video'), 'https://www.zhihu.com/answer/123')}
      {paged && <>
        {field('offset', t('起始位置', 'Start position'), t('offset · 非负整数，从 0 开始', 'offset · non-negative whole number, starting at 0'))}
        {field('limit', t('每页数量', 'Page size'), t('limit · 1–50', 'limit · 1–50'))}
      </>}
      {activeOperation === 'content.comments' && select('order', t('评论排序', 'Comment order'), 'order', [
        { value: 'score', label: t('热度', 'Top') }, { value: 'reverse', label: t('最新', 'Newest') }, { value: 'ascending', label: t('最早', 'Oldest') },
      ])}
      {activeOperation === 'creator.account.stats' && select('contentType', t('内容类型', 'Content type'), 'contentType', [
        { value: 'all', label: t('全部', 'All') }, { value: 'answer', label: t('回答', 'Answers') }, { value: 'article', label: t('文章', 'Articles') },
        { value: 'pin', label: t('想法', 'Pins') }, { value: 'zvideo', label: t('视频', 'Videos') },
      ])}
      {dated && <>
        {field('startDate', t('开始日期', 'Start date'), t('startDate · YYYY-MM-DD，与结束日期成对填写', 'startDate · YYYY-MM-DD, set together with the end date'))}
        {field('endDate', t('结束日期', 'End date'), t('endDate · YYYY-MM-DD，不早于开始日期', 'endDate · YYYY-MM-DD, not before the start date'))}
      </>}
      {activeOperation === 'quota' && <fieldset className="zhihu-open-platform-quota dsh-ui-card dsh-ui-card--flat">
        <legend className="dsh-ui-label">{t('额度项', 'Quota items')}</legend>
        <span className="dsh-ui-hint">{t('apiIds · 不选表示全部', 'apiIds · none selected means all')}</span>
        <Checkbox checked={form.apiIds.length === 0} onChange={() => change('apiIds', [])} label={t('全部额度项', 'All quota items')} />
        {ZHIHU_QUOTA_IDS.map(id => <Checkbox key={id} checked={form.apiIds.includes(id)} onChange={next => change('apiIds', next ? [...form.apiIds, id] : form.apiIds.filter(value => value !== id))} label={id} />)}
      </fieldset>}
    </div>
    <div className="dsh-ui-actions">
      <ZhihuButton host={Button} variant="primary" disabled={loading} onClick={() => run()}>
        {activeOperation === 'quota' ? t('查询官方额度', 'Check quota') : t('执行请求', 'Run request')}
      </ZhihuButton>
      {loading && <ZhihuButton host={Button} onClick={() => { state.cancel(); setLoading(false); setError(t('已取消；晚到的结果将被丢弃。', 'Cancelled; a late response will be discarded.')) }}>{t('取消请求', 'Cancel')}</ZhihuButton>}
      {nextOffset !== null && !loading && <ZhihuButton host={Button} onClick={() => run(nextOffset)}>{t('下一页', 'Next page')}</ZhihuButton>}
    </div>
    {/* The single live region for this section. */}
    <p className={loading ? 'dsh-ui-loading' : 'dsh-ui-hint'} role="status">{loading ? t('等待响应…', 'Waiting for response…') : ''}</p>
    {error && <p className="dsh-ui-error" role="alert">{error}</p>}
    {result && <div className="dsh-ui-stack">
      {stale && <p className="dsh-ui-banner">{t('参数已变化，以下结果对应旧参数，请重新请求。', 'Parameters changed; these results are for the previous request. Run it again.')}</p>}
      <h4 className="dsh-ui-heading">{activeOperation === 'quota' ? t('官方原始额度字段', 'Raw quota fields') : t('返回数据', 'Response data')}</h4>
      {result.paging?.warning && <p className="dsh-ui-banner">{result.paging.warning}</p>}
      {!stale && paged && result.paging?.canContinue && nextOffset === null && <p className="dsh-ui-banner">{t('下一页位置缺失或未前进，已停止翻页。', 'The next page position is missing or did not advance; paging stopped.')}</p>}
      {activeOperation === 'content.detail' && (typeof result.data.Body !== 'string' || !result.data.Body.trim()) && <p className="dsh-ui-banner dsh-ui-banner--danger">{t('响应缺少正文（Body），未取得全文。', 'The response has no body (Body); full text was not retrieved.')}</p>}
      <pre className="zhihu-open-platform-data dsh-ui-code">{JSON.stringify(result.data, null, 2)}</pre>
    </div>}
  </section>
}

/** The fine print, folded: one line stays in the flow, the rest sits here. */
function OpenPlatformDetails({ quotaOnly }: { quotaOnly: boolean }) {
  const t = useT()
  return <ZhihuDetails title={t('说明', 'Details')}>
        <li>{t('只使用当前 Access Secret，不使用 OAuth，也不切换身份。', 'Uses the current Access Secret only; no OAuth or identity switching.')}</li>
        {!quotaOnly && <li>{t('问题回答仅提供摘要，非全文；本人创作全文、评论和数据仅限当前凭据对应的本人内容。', 'Answer results are summaries, not full text. Your content, comments and stats are limited to the account behind this key.')}</li>}
        <li>{t('业务请求可能消耗官方额度或产生费用，以知乎控制台为准；本地调用计数不是账单。', 'Requests may consume official quota or incur cost; the Zhihu console is authoritative. Local counts are not billing.')}</li>
        <li>{t('额度查询不计入本地调用次数，不推算余额，不为缺失字段补零。', 'Quota checks are not counted locally; no balance is inferred and missing fields are not zero-filled.')}</li>
  </ZhihuDetails>
}
