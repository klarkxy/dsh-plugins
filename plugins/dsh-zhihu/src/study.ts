/**
 * Bounded evidence collection for three host-written workflows.
 * This module does not write a finished report and does not call Zhida.
 * Official docs confirm there is no deep-research, observer, or briefing endpoint.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ZHIHU_STUDY_TOOL_NAME } from './contracts.ts'
import { reportExecuted, ZhihuSearchError, type ZhihuClientOptions } from './zhihu-client.ts'
import { fetchZhihuSearchData, compileZhihuSortBy } from './search-api.ts'
import {
  fetchZhihuGlobalSearchData, executeZhihuKnowledgeSearch,
  type ZhihuGlobalSearchDb, type ZhihuRecallScope,
} from './operations.ts'

export const ZHIHU_STUDY_VERSION = 1
export const ZHIHU_STUDY_MAX_CALLS = 6
export const ZHIHU_STUDY_DEFAULT_CALLS = 4
export const ZHIHU_STUDY_MAX_QUERIES = 4
export const ZHIHU_STUDY_DEFAULT_WINDOW_DAYS = 30
export const ZHIHU_STUDY_MAX_WINDOW_DAYS = 30
const EXCERPT_MAX = 500
const EARLIEST_UNIX = 946_684_800

export const ZHIHU_STUDY_MODES = ['deep', 'observation', 'briefing'] as const
export const ZHIHU_STUDY_SOURCES = ['zhihu', 'web', 'knowledge'] as const
export type ZhihuStudyMode = (typeof ZHIHU_STUDY_MODES)[number]
export type ZhihuStudySource = (typeof ZHIHU_STUDY_SOURCES)[number]
export type ZhihuStudyStatus = 'complete' | 'partial' | 'insufficient_sources' | 'insufficient_dates' | 'budget_exhausted' | 'failed' | 'empty' | 'cancelled'

/** Documented for global search only. Do not apply this legend to Zhihu site search. */
export const ZHIHU_GLOBAL_AUTHORITY_LEGEND: Record<string, string> = {
  '1': '低权威', '2': '中权威', '3': '高权威', '4': '超高权威',
}

export type ZhihuStudyCall = {
  source: ZhihuStudySource
  query: string
  state: 'completed' | 'failed' | 'skipped'
  searchDb?: ZhihuGlobalSearchDb
  filter?: string
  sortBy?: string
  hasMore?: boolean
  emptyReason?: string
  resultCount?: number
  code?: string
}

export type ZhihuStudyFailure = {
  source: ZhihuStudySource
  query: string
  code: string
  message: string
  retried: false
}

export type ZhihuStudyEvidence = {
  id: string
  sources: ZhihuStudySource[]
  queries: string[]
  title: string
  url: string
  excerpts: string[]
  excerptKind: 'snippet'
  fullText: false
  author?: string
  authorConflict?: boolean
  authorBadgeText?: string
  votes?: number
  comments?: number
  authority?: string
  authorityMeaning?: string
  authorityConflict?: boolean
  rankingScore?: number
  rankingScoreDocumented: boolean
  contentId?: string
  editTime?: string
  editTimes: string[]
  editTimeStatus: 'present' | 'missing' | 'unparseable' | 'conflict'
  editTimeMeaning: 'publish_or_update' | 'last_edit' | 'mixed' | 'unavailable'
  createTime?: string
  eventTimeStatus: 'unverified'
  inWindow: boolean | null
  novelty: 'after_since' | 'in_window_before_since' | 'not_compared' | 'unknown'
  passedPublishFilter: boolean
  sourceConflict: boolean
}

export type ZhihuStudyResult = {
  version: typeof ZHIHU_STUDY_VERSION
  phase: 'evidence'
  finishedReport: false
  askUsed: false
  mode: ZhihuStudyMode
  question: string
  status: ZhihuStudyStatus
  stop: {
    reason: 'plan_complete' | 'budget_exhausted' | 'cancelled'
    callsUsed: number
    callsPlanned: number
    budgetApplied: number
    budgetRequested: number | null
  }
  coverage: { decomposition: 'host_queries' | 'question_only'; multiAngle: boolean }
  calls: ZhihuStudyCall[]
  failures: ZhihuStudyFailure[]
  limitations: string[]
  evidence: ZhihuStudyEvidence[]
  groups?: { publicationOrUpdate: string[]; outsideWindow: string[]; undated: string[] }
  sample: { zhihu: number; web: number; knowledge: number; notPopulation: true }
  window?: { days: number; start: string; end: string; basis: 'rolling_hours' }
  hasMore: boolean
  figures: { extracted: []; policy: string }
  hostSynthesis: {
    nextTool: 'zhihu_study_report'
    mayClaimFinishedResearch: false
    mayInventNumbers: false
    mayClaimConsensus: false
    mayTreatEditTimeAsEvent: false
    mayUseAskAsSource: false
    mayRaiseBudget: false
    mayEnablePaid: false
  }
}

type Hit = {
  source: ZhihuStudySource
  query: string
  title: string
  url: string
  excerpt: string
  author?: string
  authorBadgeText?: string
  votes?: number
  comments?: number
  authority?: string
  rankingScore?: number
  contentId?: string
  editTime?: number
  editTimeUnparseable?: boolean
  createTime?: number
  passedPublishFilter: boolean
}

const FIGURE_POLICY = '检索不解析、不计算、也不补全性能、价格或寿命。交互数值必须由宿主在报告里逐项标来源或假设。'
const HOST_SYNTHESIS: ZhihuStudyResult['hostSynthesis'] = {
  nextTool: 'zhihu_study_report',
  mayClaimFinishedResearch: false,
  mayInventNumbers: false,
  mayClaimConsensus: false,
  mayTreatEditTimeAsEvent: false,
  mayUseAskAsSource: false,
  mayRaiseBudget: false,
  mayEnablePaid: false,
}

function invalid(message: string): never {
  throw new ZhihuSearchError('INVALID_ARGUMENTS', message)
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('研究参数必须是对象。')
  return value as Record<string, unknown>
}

function cleanText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') invalid(`${label}必须是字符串。`)
  const text = value.trim()
  if (!text) invalid(`${label}不能为空。`)
  if (text.length > max) invalid(`${label}不能超过 ${max} 个字符。`)
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) invalid(`${label}含有控制字符。`)
  return text
}

function safeHttpUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return ''
  try {
    const url = new URL(value.trim())
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return ''
    return url.href
  } catch {
    return ''
  }
}

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value)
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_')) url.searchParams.delete(key)
    }
    url.hostname = url.hostname.toLowerCase()
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) url.pathname = url.pathname.slice(0, -1)
    return url.toString()
  } catch {
    return ''
  }
}

function plainExcerpt(value: unknown): string {
  if (typeof value !== 'string') return ''
  const text = value.replace(/<\/?em>/gi, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length > EXCERPT_MAX ? `${text.slice(0, EXCERPT_MAX)}…` : text
}

function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function textField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function itemsOf(data: unknown): Record<string, unknown>[] {
  const row = (data ?? {}) as { Items?: unknown }
  return Array.isArray(row.Items)
    ? row.Items.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    : []
}

function envelopeBits(data: unknown): { hasMore?: boolean; emptyReason?: string } {
  const row = (data ?? {}) as { HasMore?: unknown; EmptyReason?: unknown }
  return {
    ...(typeof row.HasMore === 'boolean' ? { hasMore: row.HasMore } : {}),
    ...(typeof row.EmptyReason === 'string' ? { emptyReason: row.EmptyReason } : {}),
  }
}

function hitFromSearch(raw: Record<string, unknown>, source: ZhihuStudySource, query: string, passedPublishFilter: boolean): Hit {
  const edit = integer(raw.EditTime)
  const editTimeUnparseable = raw.EditTime !== undefined && raw.EditTime !== null && edit === undefined
  return {
    source, query, passedPublishFilter,
    title: textField(raw.Title) ?? '(无标题)',
    url: safeHttpUrl(raw.Url),
    excerpt: plainExcerpt(raw.ContentText),
    ...(textField(raw.AuthorName) ? { author: textField(raw.AuthorName) } : {}),
    ...(textField(raw.AuthorBadgeText) ? { authorBadgeText: textField(raw.AuthorBadgeText) } : {}),
    ...(integer(raw.VoteUpCount) !== undefined ? { votes: integer(raw.VoteUpCount) } : {}),
    ...(integer(raw.CommentCount) !== undefined ? { comments: integer(raw.CommentCount) } : {}),
    ...(textField(raw.AuthorityLevel) ? { authority: textField(raw.AuthorityLevel) } : {}),
    ...(source === 'zhihu' && finite(raw.RankingScore) !== undefined ? { rankingScore: finite(raw.RankingScore) } : {}),
    ...(textField(raw.ContentID) ? { contentId: textField(raw.ContentID) } : {}),
    ...(edit !== undefined ? { editTime: edit } : {}),
    ...(editTimeUnparseable ? { editTimeUnparseable: true } : {}),
    ...(source === 'zhihu' && integer(raw.CreateTime) !== undefined ? { createTime: integer(raw.CreateTime) } : {}),
  }
}

type ParsedRequest = {
  mode: ZhihuStudyMode
  question: string
  queries: string[]
  querySource: 'host_queries' | 'question_only'
  sources: ZhihuStudySource[]
  recallScopes: ZhihuRecallScope[]
  budget: number
  budgetRequested: number | null
  windowDays: number
  since?: number
}

function parseRequest(input: unknown, now: number): ParsedRequest {
  const body = asRecord(input)
  if (!ZHIHU_STUDY_MODES.includes(body.mode as ZhihuStudyMode)) invalid('mode 必须是 deep、observation 或 briefing。')
  const mode = body.mode as ZhihuStudyMode
  const question = cleanText(body.question, '研究问题', 4000)
  let queries: string[]
  let querySource: ParsedRequest['querySource'] = 'question_only'
  if (body.queries === undefined) queries = [question.slice(0, 200)]
  else {
    if (!Array.isArray(body.queries) || body.queries.length === 0 || body.queries.length > ZHIHU_STUDY_MAX_QUERIES) {
      invalid(`queries 必须是 1 到 ${ZHIHU_STUDY_MAX_QUERIES} 条子问题。`)
    }
    queries = body.queries.map(query => cleanText(query, '子问题', 200))
    if (new Set(queries).size !== queries.length) invalid('queries 含有重复子问题。')
    querySource = 'host_queries'
  }
  if (body.includeKnowledge !== undefined && typeof body.includeKnowledge !== 'boolean') invalid('includeKnowledge 必须是布尔值。')
  let sources: ZhihuStudySource[]
  if (body.sources === undefined) {
    sources = ['zhihu', 'web']
    if (body.includeKnowledge === true) sources.push('knowledge')
  } else {
    if (!Array.isArray(body.sources) || body.sources.length === 0) invalid('sources 必须是非空数组。')
    sources = []
    for (const source of body.sources) {
      if (!ZHIHU_STUDY_SOURCES.includes(source as ZhihuStudySource)) invalid('sources 含有未确认的来源。')
      if (!sources.includes(source as ZhihuStudySource)) sources.push(source as ZhihuStudySource)
    }
    if (body.includeKnowledge === true && !sources.includes('knowledge')) invalid('includeKnowledge 与 sources 冲突。')
    if (body.includeKnowledge === false && sources.includes('knowledge')) invalid('includeKnowledge 与 sources 冲突。')
  }
  if (body.recallScopes !== undefined && !sources.includes('knowledge')) invalid('未检索知识库时不能传 recallScopes。')
  let recallScopes: ZhihuRecallScope[] = ['public']
  if (body.recallScopes !== undefined) {
    if (!Array.isArray(body.recallScopes) || body.recallScopes.length === 0) invalid('recallScopes 必须是非空数组。')
    recallScopes = []
    for (const scope of body.recallScopes) {
      if (scope !== 'personal' && scope !== 'subscription' && scope !== 'public') invalid('recallScopes 含有未确认的召回范围。')
      if (!recallScopes.includes(scope)) recallScopes.push(scope)
    }
  }
  let budgetRequested: number | null = null
  if (body.maxCalls !== undefined) {
    if (typeof body.maxCalls !== 'number' || !Number.isSafeInteger(body.maxCalls) || body.maxCalls < 1 || body.maxCalls > ZHIHU_STUDY_MAX_CALLS) {
      invalid(`maxCalls 必须是 1 到 ${ZHIHU_STUDY_MAX_CALLS} 的整数，不能提高上限。`)
    }
    budgetRequested = body.maxCalls
  }
  if (body.windowDays !== undefined && mode !== 'briefing') invalid('windowDays 只适用于 briefing。')
  let windowDays = ZHIHU_STUDY_DEFAULT_WINDOW_DAYS
  if (mode === 'briefing' && body.windowDays !== undefined) {
    if (typeof body.windowDays !== 'number' || !Number.isSafeInteger(body.windowDays) || body.windowDays < 1 || body.windowDays > ZHIHU_STUDY_MAX_WINDOW_DAYS) {
      invalid(`windowDays 必须是 1 到 ${ZHIHU_STUDY_MAX_WINDOW_DAYS} 的整数。`)
    }
    windowDays = body.windowDays
  }
  let since: number | undefined
  if (body.since !== undefined) {
    if (mode !== 'briefing') invalid('since 只适用于 briefing。')
    if (typeof body.since !== 'string' || !Number.isFinite(Date.parse(body.since))) invalid('since 必须是可解析的时间。')
    const parsed = Date.parse(body.since)
    if (parsed > now + 86_400_000) invalid('since 不能晚于当前时间一天以上。')
    since = parsed
  }
  if (body.allowPaid !== undefined || body.token !== undefined || body.accessSecret !== undefined) {
    invalid('研究工具不能接收付费开关或凭据。')
  }
  return {
    mode, question, queries, querySource, sources, recallScopes,
    budget: budgetRequested ?? ZHIHU_STUDY_DEFAULT_CALLS,
    budgetRequested, windowDays, ...(since !== undefined ? { since } : {}),
  }
}

function inWindowOf(presentEdits: number[], briefing: boolean, windowStart: number | undefined, now: number): boolean | null {
  if (!briefing || windowStart === undefined || presentEdits.length === 0) return null
  return presentEdits.every(value => value * 1000 >= windowStart && value * 1000 <= now)
}

function timeState(seconds: number | undefined, unparseable: boolean, nowSeconds: number): 'present' | 'missing' | 'unparseable' {
  if (unparseable) return 'unparseable'
  if (seconds === undefined) return 'missing'
  if (seconds < EARLIEST_UNIX || seconds > nowSeconds + 86_400) return 'unparseable'
  return 'present'
}

function meaningOf(sources: ZhihuStudySource[]): ZhihuStudyEvidence['editTimeMeaning'] {
  const timed = sources.filter(source => source === 'zhihu' || source === 'web')
  if (timed.length === 0) return 'unavailable'
  if (timed.every(source => source === 'zhihu')) return 'publish_or_update'
  if (timed.every(source => source === 'web')) return 'last_edit'
  return 'mixed'
}

function mergeHits(hits: Hit[], now: number, windowStart: number | undefined, since: number | undefined, briefing: boolean): ZhihuStudyEvidence[] {
  const groups: Array<{ key: string; hits: Hit[] }> = []
  for (const hit of hits) {
    const key = canonicalUrl(hit.url)
    const existing = key ? groups.find(group => group.key === key) : undefined
    if (existing) existing.hits.push(hit)
    else groups.push({ key: key || `solo-${groups.length}`, hits: [hit] })
  }
  const nowSeconds = Math.floor(now / 1000)
  return groups.map((group, index) => {
    const first = group.hits[0]!
    const sources = [...new Set(group.hits.map(hit => hit.source))]
    const excerpts = [...new Set(group.hits.map(hit => hit.excerpt).filter(excerpt => excerpt.length > 0))]
    const authors = [...new Set(group.hits.map(hit => hit.author).filter((author): author is string => !!author))]
    const badges = [...new Set(group.hits.map(hit => hit.authorBadgeText).filter((badge): badge is string => !!badge))]
    const authorities = [...new Set(group.hits.map(hit => hit.authority).filter((value): value is string => !!value))]
    const scores = [...new Set(group.hits.flatMap(hit => hit.rankingScore !== undefined ? [hit.rankingScore] : []))]
    const editValues = group.hits.flatMap(hit => hit.editTime !== undefined ? [hit.editTime] : [])
    const unparseable = group.hits.some(hit => hit.editTimeUnparseable)
    const uniqueEdits = [...new Set(editValues)]
    const presentEdits = uniqueEdits.filter(value => timeState(value, false, nowSeconds) === 'present')
    const editStatus: ZhihuStudyEvidence['editTimeStatus'] = presentEdits.length > 1
      ? 'conflict'
      : presentEdits.length === 1
        ? 'present'
        : unparseable || uniqueEdits.length > 0
          ? 'unparseable'
          : 'missing'
    const inWindow = inWindowOf(presentEdits, briefing, windowStart, now)
    const newest = presentEdits.length > 0 ? Math.max(...presentEdits) : undefined
    let novelty: ZhihuStudyEvidence['novelty'] = 'not_compared'
    if (since !== undefined) {
      novelty = newest === undefined || inWindow !== true ? 'unknown' : newest * 1000 >= since ? 'after_since' : 'in_window_before_since'
    } else if (briefing && newest === undefined) novelty = 'unknown'
    const webOnly = sources.every(source => source === 'web')
    const authorityMeaning = !webOnly || authorities.length !== 1 ? undefined : ZHIHU_GLOBAL_AUTHORITY_LEGEND[authorities[0]!]
    const createTimes = [...new Set(group.hits.flatMap(hit => hit.createTime !== undefined ? [hit.createTime] : []))]
    return {
      id: `e${index + 1}`,
      sources,
      queries: [...new Set(group.hits.map(hit => hit.query))],
      title: first.title,
      url: first.url,
      excerpts,
      excerptKind: 'snippet',
      fullText: false,
      ...(authors.length === 1 ? { author: authors[0] } : {}),
      ...(authors.length > 1 ? { authorConflict: true } : {}),
      ...(badges.length === 1 ? { authorBadgeText: badges[0] } : {}),
      ...(first.votes !== undefined && group.hits.every(hit => hit.votes === first.votes) ? { votes: first.votes } : {}),
      ...(first.comments !== undefined && group.hits.every(hit => hit.comments === first.comments) ? { comments: first.comments } : {}),
      ...(authorities.length === 1 ? { authority: authorities[0] } : {}),
      ...(authorityMeaning ? { authorityMeaning } : {}),
      ...(authorities.length > 1 ? { authorityConflict: true } : {}),
      ...(sources.includes('zhihu') && scores.length === 1 ? { rankingScore: scores[0] } : {}),
      rankingScoreDocumented: sources.includes('zhihu') && scores.length === 1,
      ...(textField(first.contentId) ? { contentId: first.contentId } : {}),
      ...(newest !== undefined ? { editTime: String(newest) } : {}),
      editTimes: uniqueEdits.map(String),
      editTimeStatus: editStatus,
      editTimeMeaning: meaningOf(sources),
      ...(createTimes.length === 1 ? { createTime: String(createTimes[0]) } : {}),
      eventTimeStatus: 'unverified',
      inWindow,
      novelty,
      passedPublishFilter: group.hits.some(hit => hit.passedPublishFilter),
      sourceConflict: excerpts.length > 1,
    }
  })
}

function statusOf(input: {
  mode: ZhihuStudyMode
  cancelled: boolean
  budgetExhausted: boolean
  failures: ZhihuStudyFailure[]
  completed: number
  evidence: ZhihuStudyEvidence[]
  briefing: boolean
}): ZhihuStudyStatus {
  if (input.cancelled) return 'cancelled'
  if (input.completed === 0 && input.failures.length > 0) return 'failed'
  if (input.budgetExhausted) return 'budget_exhausted'
  const zhihuCount = input.evidence.filter(item => item.sources.includes('zhihu')).length
  if (input.mode === 'observation' && zhihuCount < 2) return input.evidence.length === 0 && input.failures.length === 0 ? 'empty' : 'insufficient_sources'
  if (input.briefing) {
    const dated = input.evidence.filter(item => item.inWindow === true && item.editTimeStatus === 'present')
    if (dated.length === 0) return input.evidence.length === 0 && input.failures.length === 0 ? 'empty' : 'insufficient_dates'
  }
  if (input.evidence.length === 0 && input.failures.length === 0) return 'empty'
  if (input.failures.length > 0) return 'partial'
  return 'complete'
}

export async function executeZhihuStudy(input: unknown, options: ZhihuClientOptions & { now?: number } = {}): Promise<ZhihuStudyResult> {
  const now = options.now ?? Date.now()
  const request = parseRequest(input, now)
  if (options.signal?.aborted) throw new ZhihuSearchError('CANCELLED', '请求已取消')
  const briefingRank: ZhihuStudySource[] = ['web', 'zhihu', 'knowledge']
  const orderedSources = request.mode === 'briefing'
    ? [...request.sources].sort((left, right) => briefingRank.indexOf(left) - briefingRank.indexOf(right))
    : request.sources
  const ordered = request.queries.flatMap(query => orderedSources.map(source => ({ source, query })))
  const windowStart = request.mode === 'briefing' ? now - request.windowDays * 86_400_000 : undefined
  const calls: ZhihuStudyCall[] = []
  const failures: ZhihuStudyFailure[] = []
  const hits: Hit[] = []
  let cancelled = false
  let budgetExhausted = false
  let hasMore = false
  const runOne = async (source: ZhihuStudySource, query: string): Promise<void> => {
    const call: ZhihuStudyCall = { source, query, state: 'completed' }
    if (source === 'web') {
      const searchDb: ZhihuGlobalSearchDb = request.mode === 'briefing' ? 'realtime' : 'all'
      const filter = request.mode === 'briefing' && windowStart !== undefined
        ? { publishTime: Math.floor(windowStart / 1000), publishTimeOperator: 'gte' as const }
        : undefined
      call.searchDb = searchDb
      const fetched = await fetchZhihuGlobalSearchData(query, 8, searchDb, options, filter)
      if (fetched.filter) call.filter = fetched.filter
      const bits = envelopeBits(fetched.data)
      if (bits.hasMore) { call.hasMore = true; hasMore = true }
      if (bits.emptyReason) call.emptyReason = bits.emptyReason
      const found = itemsOf(fetched.data).map(item => hitFromSearch(item, 'web', query, Boolean(filter)))
      call.resultCount = found.length
      hits.push(...found)
    } else if (source === 'zhihu') {
      const sortBy = request.mode === 'briefing' && windowStart !== undefined
        ? compileZhihuSortBy('EditTime', 'none', Math.floor(windowStart / 1000))
        : undefined
      if (sortBy) call.sortBy = sortBy
      const fetched = await fetchZhihuSearchData(query, 5, options, sortBy)
      const bits = envelopeBits(fetched.data)
      if (bits.hasMore) { call.hasMore = true; hasMore = true }
      if (bits.emptyReason) call.emptyReason = bits.emptyReason
      const found = itemsOf(fetched.data).map(item => hitFromSearch(item, 'zhihu', query, false))
      call.resultCount = found.length
      hits.push(...found)
    } else {
      const result = await executeZhihuKnowledgeSearch(query, 3, request.recallScopes, options)
      const found: Hit[] = result.items.map(item => ({
        source: 'knowledge', query, passedPublishFilter: false,
        title: item.docName, url: safeHttpUrl(item.originUrl), excerpt: plainExcerpt(item.snippets.join('\n')),
      }))
      call.resultCount = found.length
      hits.push(...found)
    }
    calls.push(call)
  }
  for (let index = 0; index < ordered.length; index += 1) {
    const step = ordered[index]!
    if (options.signal?.aborted) {
      cancelled = true
      for (const rest of ordered.slice(index)) calls.push({ ...rest, state: 'skipped' })
      break
    }
    if (calls.filter(call => call.state !== 'skipped').length >= request.budget) {
      budgetExhausted = true
      for (const rest of ordered.slice(index)) calls.push({ ...rest, state: 'skipped' })
      break
    }
    try {
      await runOne(step.source, step.query)
    } catch (error) {
      const aborted = options.signal?.aborted || (error instanceof ZhihuSearchError && error.code === 'CANCELLED')
      const code = error instanceof ZhihuSearchError ? error.code : 'BAD_RESPONSE'
      const message = error instanceof Error ? error.message : '知乎研究检索失败'
      calls.push({ source: step.source, query: step.query, state: 'failed', code })
      failures.push({ source: step.source, query: step.query, code, message, retried: false })
      if (aborted) {
        cancelled = true
        for (const rest of ordered.slice(index + 1)) calls.push({ ...rest, state: 'skipped' })
        break
      }
    }
  }
  const evidence = mergeHits(hits, now, windowStart, request.since, request.mode === 'briefing')
  const completed = calls.filter(call => call.state === 'completed').length
  const status = statusOf({ mode: request.mode, cancelled, budgetExhausted, failures, completed, evidence, briefing: request.mode === 'briefing' })
  const limitations = [
    '返回的是摘录，不是全文。需要准确理解时应打开原始链接。',
    '本次检索不是该主题的完整样本，也不是知乎全体用户的共识。',
    '知乎直答没有用作原始来源。',
    '事件发生时间未被上游提供，不能把 EditTime 写成事件日期。',
    '全网权威等级 1 到 4 的文字含义只标注在全网结果上；知乎站内等级只保留原文字段。',
  ]
  if (request.querySource === 'question_only') limitations.push('宿主没有提供拆解后的子问题，本次只检索原问题，不能写成已经完成多角度拆解。')
  if (request.querySource === 'question_only' && request.question.length > 200) limitations.push('原问题超过 200 字，单次检索词只使用前 200 字。')
  if (request.mode === 'briefing') limitations.push('全网 publish_time 过滤和知乎 EditTime 过滤都不是事件发生证明。缺时间或无法核实的条目不能进入已确认时间线。')
  if (!request.sources.includes('knowledge')) limitations.push('本次没有检索知识库。已有知识库需要宿主显式加入 sources。')
  if (hasMore) limitations.push('上游 HasMore 为真，但公开文档没有翻页参数，不能把本次结果当成剩余全部。')
  if (failures.length > 0) limitations.push('有检索失败。失败不是空结果，没有自动重试。')
  if (budgetExhausted) limitations.push('调用预算已用尽，未执行的检索不能当成没有资料。')
  if (request.since === undefined && request.mode === 'briefing') limitations.push('没有提供 since，不能判断相对上一次阅读的新增。')
  const zhihu = evidence.filter(item => item.sources.includes('zhihu')).length
  const web = evidence.filter(item => item.sources.includes('web')).length
  const knowledge = evidence.filter(item => item.sources.includes('knowledge')).length
  const groups = request.mode === 'briefing' ? {
    publicationOrUpdate: evidence.filter(item => item.inWindow === true && item.editTimeStatus === 'present').map(item => item.id),
    outsideWindow: evidence.filter(item => item.editTimeStatus === 'present' && item.inWindow === false).map(item => item.id),
    undated: evidence.filter(item => item.editTimeStatus !== 'present').map(item => item.id),
  } : undefined
  return {
    version: ZHIHU_STUDY_VERSION,
    phase: 'evidence',
    finishedReport: false,
    askUsed: false,
    mode: request.mode,
    question: request.question,
    status,
    stop: {
      reason: cancelled ? 'cancelled' : budgetExhausted ? 'budget_exhausted' : 'plan_complete',
      callsUsed: calls.filter(call => call.state !== 'skipped').length,
      callsPlanned: ordered.length,
      budgetApplied: request.budget,
      budgetRequested: request.budgetRequested,
    },
    coverage: { decomposition: request.querySource, multiAngle: request.querySource === 'host_queries' && request.queries.length > 1 },
    calls, failures, limitations, evidence,
    ...(groups ? { groups } : {}),
    sample: { zhihu, web, knowledge, notPopulation: true },
    ...(request.mode === 'briefing' ? { window: { days: request.windowDays, start: new Date(windowStart!).toISOString(), end: new Date(now).toISOString(), basis: 'rolling_hours' as const } } : {}),
    hasMore,
    figures: { extracted: [], policy: FIGURE_POLICY },
    hostSynthesis: HOST_SYNTHESIS,
  }
}

const STATUS_LABEL: Record<ZhihuStudyStatus, string> = {
  complete: '检索完成',
  partial: '部分完成',
  insufficient_sources: '来源不足',
  insufficient_dates: '窗口内缺少可核实时间',
  budget_exhausted: '预算用尽',
  failed: '检索失败',
  empty: '上游没有返回条目',
  cancelled: '已取消',
}

export function renderZhihuStudy(result: ZhihuStudyResult): string {
  const lines = [
    '知乎研究证据（不是成品报告）',
    `模式：${result.mode}　状态：${STATUS_LABEL[result.status]}（${result.status}）`,
    `问题：${result.question}`,
    `调用：${result.stop.callsUsed}/${result.stop.callsPlanned}，预算 ${result.stop.budgetApplied}，停止原因 ${result.stop.reason}`,
    'finishedReport：false。综合证据后再调用 zhihu_study_report。不要把本结果写成已完成研究。',
    '',
  ]
  if (result.failures.length > 0) {
    lines.push('失败（不是空结果，没有重试）：')
    for (const failure of result.failures) lines.push(`- ${failure.source} / ${failure.query} / ${failure.code} / ${failure.message}`)
    lines.push('')
  }
  if (result.status === 'empty') lines.push('检索已完成，上游没有返回匹配条目。这与检索失败不同。', '')
  if (result.evidence.length > 0) {
    lines.push('证据摘录：')
    for (const item of result.evidence) {
      lines.push(`- ${item.id} ${item.title}${item.url ? ` ${item.url}` : ''}`)
      lines.push(`  来源：${item.sources.join(', ')}；全文：否；事件时间：未核实`)
      if (item.authority) lines.push(`  权威原值：${item.authority}${item.authorityMeaning ? `（全网含义：${item.authorityMeaning}）` : '（未套用全网四档含义）'}`)
      if (item.rankingScore !== undefined) lines.push(`  排序分：${item.rankingScore}（仅因上游返回而保留）`)
      if (item.editTime) lines.push(`  条目时间：${item.editTime}，含义 ${item.editTimeMeaning}${item.inWindow === null ? '' : `，窗口内 ${item.inWindow}`}`)
      else lines.push(`  条目时间：${item.editTimeStatus}`)
      for (const excerpt of item.excerpts) lines.push(`  摘录：${excerpt}`)
    }
    lines.push('')
  }
  if (result.groups) {
    lines.push(`发布或更新（不是事件）：${result.groups.publicationOrUpdate.join(', ') || '无'}`)
    lines.push(`窗口外：${result.groups.outsideWindow.join(', ') || '无'}`)
    lines.push(`缺日期或时间冲突，不能进入已确认时间线：${result.groups.undated.join(', ') || '无'}`)
    lines.push('')
  }
  lines.push('局限：')
  for (const limitation of result.limitations) lines.push(`- ${limitation}`)
  return lines.join('\n')
}

export function createZhihuStudyTool(options: ZhihuClientOptions & { onExecuted?: (event: { ok: boolean; results: number }) => void } = {}) {
  const { onExecuted, ...client } = options
  return defineTool({
    name: ZHIHU_STUDY_TOOL_NAME,
    description:
      '有预算的知乎研究取证，不是成品报告，也没有单独的深度研究接口。' +
      'mode：deep 拆开检索知乎和全网；observation 并列观点样本；briefing 默认滚动 30 天，全网用 realtime 和 publish_time 过滤，再看知乎。' +
      '失败、预算用尽、缺日期和来源不足都会显式返回，不能当成空结果。不要用直答代替来源。综合后调用 zhihu_study_report。',
    parameters: {
      mode: { type: 'string', enum: [...ZHIHU_STUDY_MODES], required: true },
      question: { type: 'string', required: true, description: '用户的原问题，1 到 4000 字符。' },
      queries: { type: 'array', items: { type: 'string' }, description: 'deep 应提供 2 到 4 条拆解后的子问题。省略时只检索原问题，并标明没有拆解。' },
      sources: { type: 'array', items: { type: 'string', enum: [...ZHIHU_STUDY_SOURCES] }, description: '默认 zhihu 与 web。knowledge 只在要检索已有知识库时加入。未知来源会拒绝。' },
      includeKnowledge: { type: 'boolean', description: '与 sources 同时使用时必须一致。' },
      recallScopes: { type: 'array', items: { type: 'string', enum: ['personal', 'subscription', 'public'] }, description: '仅知识库检索可传。未知范围会拒绝。' },
      maxCalls: { type: 'integer', description: `1 到 ${ZHIHU_STUDY_MAX_CALLS}，默认 ${ZHIHU_STUDY_DEFAULT_CALLS}。超过上限会拒绝，不能提高。` },
      windowDays: { type: 'integer', description: `仅 briefing。1 到 ${ZHIHU_STUDY_MAX_WINDOW_DAYS}，默认 ${ZHIHU_STUDY_DEFAULT_WINDOW_DAYS}。` },
      since: { type: 'string', description: '仅 briefing。可选 ISO 时间，只标记窗口内新旧，不扩大窗口。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render(_args, value) { return [{ type: 'text' as const, text: renderZhihuStudy(value as ZhihuStudyResult) }] },
    },
    isConcurrencySafe() { return true },
    async execute(args, exec) {
      try {
        const result = await executeZhihuStudy(args, { ...client, signal: exec.signal })
        reportExecuted(onExecuted, { ok: result.status !== 'failed' && result.status !== 'cancelled', results: result.evidence.length })
        return result
      } catch (error) {
        reportExecuted(onExecuted, { ok: false, results: 0 })
        throw error
      }
    },
  })
}
