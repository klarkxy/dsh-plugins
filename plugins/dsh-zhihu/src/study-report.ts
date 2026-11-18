/**
 * Validate a host-written study and write a local Markdown report, JSON, and
 * one self-contained HTML file. The page script only evaluates declared formulas.
 * Untrusted titles, excerpts and URLs are escaped and never executed.
 */
import { randomBytes } from 'node:crypto'
import { mkdir, realpath, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, sep } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ZHIHU_STUDY_REPORT_TOOL_NAME } from './contracts.ts'
import { ZHIHU_GLOBAL_AUTHORITY_LEGEND, ZHIHU_STUDY_MAX_WINDOW_DAYS } from './study.ts'
import { ZhihuSearchError } from './zhihu-client.ts'

export const STUDY_REPORT_DISCLAIMERS = {
  deep: '交互结果只按页面上的公式和滑杆计算。每个输入都标了来源或假设。本页不提供默认的性能、价格或寿命。',
  observation: '下面是本次检索样本里的说法并列，不是知乎全体用户的共识。作者、赞同数只在来源实际带回时显示。',
  briefing: '已确认事件的日期必须能在来源摘录里找到。条目时间戳是发布或更新时间，不是事件发生时间。缺日期的条目不在已确认事件里。发布时间过滤也不能证明事件发生在窗口内。',
} as const

const ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

type Source = {
  id: string
  title: string
  url: string
  excerpt: string
  author?: string
  votes?: number
  authority?: string
  authorityMeaning?: string
  editTime?: string
  editTimeMeaning?: 'publish_or_update' | 'last_edit'
}
type Cited = { text: string; sourceIds: string[] }
type InputProvenance = { kind: 'source'; sourceId: string } | { kind: 'assumption'; text: string }
type InteractiveInput = {
  id: string
  label: string
  min: number
  max: number
  step: number
  value: number
  unit?: string
  provenance: InputProvenance
}
type InteractiveBlock = {
  id: string
  title: string
  inputs: InteractiveInput[]
  formula: string
  outputLabel: string
  outputUnit?: string
  initialResult: number
}
type ConfirmedEvent = { id: string; title: string; sourceIds: string[]; eventOn: string; eventQuote: string }
export type ValidatedStudyReport = {
  mode: 'deep' | 'observation' | 'briefing'
  title: string
  question: string
  limitations: string[]
  sources: Source[]
  deep?: { findings: Cited[]; assumptions: { text: string }[]; disputes: Cited[]; interactive: InteractiveBlock[]; unansweredReason?: string }
  observation?: { currentState: Cited[]; progress: Cited[]; viewpoints: Array<Cited & { id: string }>; openQuestions: { text: string }[] }
  briefing?: {
    windowDays: number
    windowStart: string
    windowEnd: string
    confirmedEvents: ConfirmedEvent[]
    publicationUpdates: Array<{ id: string; title: string; sourceIds: string[] }>
    undated: Array<{ id: string; title: string; sourceIds: string[] }>
    nextChecks: { text: string }[]
  }
}

type Token = { kind: 'num' | 'id' | 'op' | 'lp' | 'rp'; text: string }

export function tokenizeStudyFormula(formula: string): Token[] {
  if (typeof formula !== 'string' || formula.length === 0 || formula.length > 200) throw new Error('公式无效')
  const tokens: Token[] = []
  let index = 0
  while (index < formula.length) {
    const char = formula[index]!
    if (char === ' ' || char === '\t') { index += 1; continue }
    if ('+-*/'.includes(char)) { tokens.push({ kind: 'op', text: char }); index += 1; continue }
    if (char === '(') { tokens.push({ kind: 'lp', text: char }); index += 1; continue }
    if (char === ')') { tokens.push({ kind: 'rp', text: char }); index += 1; continue }
    if (char >= '0' && char <= '9') {
      const match = /^\d+(?:\.\d+)?/.exec(formula.slice(index))
      if (!match) throw new Error('公式数字无效')
      tokens.push({ kind: 'num', text: match[0] }); index += match[0].length; continue
    }
    if (/[A-Za-z_]/.test(char)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(formula.slice(index))
      if (!match) throw new Error('公式无效')
      tokens.push({ kind: 'id', text: match[0] }); index += match[0].length; continue
    }
    throw new Error('公式含有不允许的字符')
  }
  return tokens
}

export function evaluateStudyFormula(formula: string, values: Readonly<Record<string, number>>): number {
  const tokens = tokenizeStudyFormula(formula)
  let index = 0
  const peek = () => tokens[index]
  const eat = (kind?: Token['kind']) => {
    const token = tokens[index]
    if (!token || (kind && token.kind !== kind)) throw new Error('公式无效')
    index += 1
    return token
  }
  const parseFactor = (): number => {
    const token = peek()
    if (!token) throw new Error('公式无效')
    if (token.kind === 'op' && token.text === '-') { eat(); return -parseFactor() }
    if (token.kind === 'num') { eat(); return Number(token.text) }
    if (token.kind === 'id') {
      const name = eat().text
      if (!Object.hasOwn(values, name) || !Number.isFinite(values[name])) throw new Error('公式引用了未知输入')
      return values[name]!
    }
    if (token.kind === 'lp') { eat(); const value = parseExpr(); eat('rp'); return value }
    throw new Error('公式无效')
  }
  const parseTerm = (): number => {
    let value = parseFactor()
    while (peek()?.kind === 'op' && (peek()?.text === '*' || peek()?.text === '/')) {
      const op = eat().text
      const right = parseFactor()
      if (op === '/' && right === 0) throw new Error('除数为零')
      value = op === '*' ? value * right : value / right
    }
    return value
  }
  const parseExpr = (): number => {
    let value = parseTerm()
    while (peek()?.kind === 'op' && (peek()?.text === '+' || peek()?.text === '-')) {
      const op = eat().text
      const right = parseTerm()
      value = op === '+' ? value + right : value - right
    }
    return value
  }
  const value = parseExpr()
  if (index !== tokens.length || !Number.isFinite(value)) throw new Error('公式无效')
  return value
}

function invalid(message: string): never {
  throw new ZhihuSearchError('INVALID_ARGUMENTS', message)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label}必须是对象。`)
  return value as Record<string, unknown>
}

function known(value: Record<string, unknown>, allowed: readonly string[]) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(`不能识别的字段 ${key}。`)
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') invalid(`${label}必须是字符串。`)
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(trimmed)) invalid(`${label}无效。`)
  return trimmed
}

function idOf(value: unknown, label: string): string {
  const id = text(value, label, 32)
  if (!ID_PATTERN.test(id)) invalid(`${label}只能使用小写字母、数字和连字符。`)
  return id
}

function httpUrl(value: unknown): string {
  const raw = text(value, '来源链接', 2000)
  let url: URL
  try { url = new URL(raw) } catch { invalid('来源链接必须是 http 或 https。') }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) invalid('来源链接必须是不带账号的 http 或 https。')
  return url.href
}

function sourceIds(value: unknown, sources: Map<string, Source>, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) invalid(`${label}至少要有一个来源。`)
  const ids = value.map(item => idOf(item, label))
  if (ids.some(item => !sources.has(item))) invalid(`${label}指向了不存在的来源。`)
  return [...new Set(ids)]
}

function cited(value: unknown, sources: Map<string, Source>, label: string): Cited {
  const row = record(value, label)
  known(row, ['text', 'sourceIds'])
  return { text: text(row.text, label, 2000), sourceIds: sourceIds(row.sourceIds, sources, label) }
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(`${label}必须是有限数字。`)
  return value
}

function provenance(value: unknown, sources: Map<string, Source>): InputProvenance {
  const row = record(value, '数值依据')
  known(row, ['kind', 'sourceId', 'text'])
  if (row.kind === 'source') {
    if (row.text !== undefined) invalid('来源依据不能同时写假设。')
    return { kind: 'source', sourceId: sourceIds([row.sourceId], sources, '数值依据')[0]! }
  }
  if (row.kind === 'assumption') {
    if (row.sourceId !== undefined) invalid('假设不能伪装成来源。')
    return { kind: 'assumption', text: text(row.text, '假设', 200) }
  }
  invalid('数值依据必须是 source 或 assumption。')
}

function interactive(value: unknown, sources: Map<string, Source>): InteractiveBlock {
  const row = record(value, '交互块')
  known(row, ['id', 'title', 'inputs', 'formula', 'outputLabel', 'outputUnit'])
  if (!Array.isArray(row.inputs) || row.inputs.length < 1 || row.inputs.length > 4) invalid('交互块需要 1 到 4 个输入。')
  const inputs = row.inputs.map(item => {
    const input = record(item, '交互输入')
    known(input, ['id', 'label', 'min', 'max', 'step', 'value', 'unit', 'provenance'])
    const min = finiteNumber(input.min, '最小值')
    const max = finiteNumber(input.max, '最大值')
    const step = finiteNumber(input.step, '步长')
    const initial = finiteNumber(input.value, '初始值')
    if (!(min < max) || !(step > 0) || initial < min || initial > max) invalid('交互输入的范围或初始值无效。')
    const unit = input.unit === undefined ? undefined : text(input.unit, '单位', 16)
    return {
      id: idOf(input.id, '输入编号'), label: text(input.label, '输入名称', 80),
      min, max, step, value: initial, ...(unit ? { unit } : {}), provenance: provenance(input.provenance, sources),
    }
  })
  if (inputs.some(item => !/^[a-z][a-z0-9]*$/.test(item.id))) invalid('输入编号只能是小写字母和数字，以便写进公式。')
  if (new Set(inputs.map(item => item.id)).size !== inputs.length) invalid('交互输入编号重复。')
  const formula = text(row.formula, '公式', 200)
  const values = Object.fromEntries(inputs.map(item => [item.id, item.value]))
  let initialResult: number
  try { initialResult = evaluateStudyFormula(formula, values) }
  catch (error) { invalid(error instanceof Error ? error.message : '公式无效') }
  const names = new Set(tokenizeStudyFormula(formula).filter(token => token.kind === 'id').map(token => token.text))
  if ([...names].some(name => !inputs.some(item => item.id === name))) invalid('公式引用了未声明的输入。')
  const outputUnit = row.outputUnit === undefined ? undefined : text(row.outputUnit, '结果单位', 16)
  return {
    id: idOf(row.id, '交互块编号'), title: text(row.title, '交互块标题', 120), inputs, formula,
    outputLabel: text(row.outputLabel, '结果名称', 80), ...(outputUnit ? { outputUnit } : {}), initialResult,
  }
}

function dateForms(iso: string): string[] {
  const match = DATE_PATTERN.exec(iso)
  if (!match) return []
  const [, year, month, day] = match
  const shortMonth = String(Number(month))
  const shortDay = String(Number(day))
  return [iso, `${year}/${shortMonth}/${shortDay}`, `${year}/${month}/${day}`, `${year}年${shortMonth}月${shortDay}日`, `${year}年${month}月${day}日`]
}

function realDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value)
  if (!match) return false
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function parseSources(value: unknown): Map<string, Source> {
  if (!Array.isArray(value) || value.length === 0 || value.length > 40) invalid('sources 必须是 1 到 40 条来源。')
  const sources = new Map<string, Source>()
  for (const item of value) {
    const row = record(item, '来源')
    known(row, ['id', 'title', 'url', 'excerpt', 'author', 'votes', 'authority', 'authorityMeaning', 'editTime', 'editTimeMeaning'])
    const source: Source = {
      id: idOf(row.id, '来源编号'), title: text(row.title, '来源标题', 200), url: httpUrl(row.url), excerpt: text(row.excerpt, '来源摘录', 2000),
    }
    if (row.author !== undefined) source.author = text(row.author, '作者', 80)
    if (row.votes !== undefined) {
      if (typeof row.votes !== 'number' || !Number.isSafeInteger(row.votes) || row.votes < 0) invalid('赞同数必须是上游返回的非负整数。')
      source.votes = row.votes
    }
    if (row.authority !== undefined) source.authority = text(row.authority, '权威原值', 32)
    if (row.authorityMeaning !== undefined) {
      const meaning = text(row.authorityMeaning, '权威含义', 16)
      if (!source.authority || ZHIHU_GLOBAL_AUTHORITY_LEGEND[source.authority] !== meaning) invalid('权威含义必须与全网 1 到 4 的官方说明一致，不能自造。')
      source.authorityMeaning = meaning
    }
    if (row.editTime !== undefined) {
      const editTime = text(row.editTime, '条目时间', 20)
      if (!/^\d+$/.test(editTime)) invalid('条目时间必须是 Unix 秒。')
      source.editTime = editTime
    }
    if (row.editTimeMeaning !== undefined) {
      if (row.editTimeMeaning !== 'publish_or_update' && row.editTimeMeaning !== 'last_edit') invalid('条目时间含义无效。')
      source.editTimeMeaning = row.editTimeMeaning
    }
    if (sources.has(source.id)) invalid('来源编号重复。')
    sources.set(source.id, source)
  }
  return sources
}

export function validateZhihuStudyReport(input: unknown, options: { now?: number } = {}): ValidatedStudyReport {
  const body = record(input, '报告')
  if (body.phase === 'evidence' || body.finishedReport === false) invalid('证据清单不是成品报告。请先综合，再提交报告结构。')
  known(body, ['mode', 'title', 'question', 'limitations', 'sources', 'deep', 'observation', 'briefing'])
  if (body.mode !== 'deep' && body.mode !== 'observation' && body.mode !== 'briefing') invalid('报告 mode 无效。')
  const sources = parseSources(body.sources)
  const limitations = body.limitations === undefined ? [] : Array.isArray(body.limitations)
    ? body.limitations.map(item => text(item, '局限', 500))
    : invalid('limitations 必须是字符串数组。')
  const report: ValidatedStudyReport = {
    mode: body.mode, title: text(body.title, '标题', 120), question: text(body.question, '问题', 4000),
    limitations, sources: [...sources.values()],
  }
  if (body.mode === 'deep') {
    const deep = record(body.deep, '深度研究')
    known(deep, ['findings', 'assumptions', 'disputes', 'interactive', 'unansweredReason'])
    if (body.observation !== undefined || body.briefing !== undefined) invalid('报告段落与 mode 不一致。')
    const findings = Array.isArray(deep.findings) ? deep.findings.map(item => cited(item, sources, '发现')) : invalid('findings 必须是数组。')
    const assumptions = Array.isArray(deep.assumptions) ? deep.assumptions.map(item => {
      const row = record(item, '假设')
      known(row, ['text'])
      return { text: text(row.text, '假设', 500) }
    }) : invalid('assumptions 必须是数组。')
    const disputes = Array.isArray(deep.disputes) ? deep.disputes.map(item => cited(item, sources, '争议')) : invalid('disputes 必须是数组。')
    const blocks = Array.isArray(deep.interactive) ? deep.interactive.map(item => interactive(item, sources)) : invalid('interactive 必须是数组。')
    if (blocks.length > 3) invalid('交互块最多 3 个。')
    if (new Set(blocks.map(item => item.id)).size !== blocks.length) invalid('交互块编号重复。')
    const unansweredReason = deep.unansweredReason === undefined ? undefined : text(deep.unansweredReason, '未回答原因', 500)
    if (findings.length === 0 && !unansweredReason) invalid('没有发现时必须写明未回答原因，不能导出空白结论。')
    report.deep = { findings, assumptions, disputes, interactive: blocks, ...(unansweredReason ? { unansweredReason } : {}) }
  } else if (body.mode === 'observation') {
    const observation = record(body.observation, '知乎观察')
    known(observation, ['currentState', 'progress', 'viewpoints', 'openQuestions'])
    if (body.deep !== undefined || body.briefing !== undefined) invalid('报告段落与 mode 不一致。')
    const viewpoints = Array.isArray(observation.viewpoints) ? observation.viewpoints.map(item => {
      const row = record(item, '观点')
      known(row, ['id', 'text', 'sourceIds'])
      return { id: idOf(row.id, '观点编号'), text: text(row.text, '观点', 2000), sourceIds: sourceIds(row.sourceIds, sources, '观点') }
    }) : invalid('viewpoints 必须是数组。')
    if (viewpoints.length < 2) invalid('并列观点至少要有两条，不能把单条样本写成各方看法。')
    const citedIds = new Set(viewpoints.flatMap(item => item.sourceIds))
    if (citedIds.size < 2) invalid('并列观点必须追到至少两个不同来源。')
    report.observation = {
      currentState: Array.isArray(observation.currentState) ? observation.currentState.map(item => cited(item, sources, '现状')) : invalid('currentState 必须是数组。'),
      progress: Array.isArray(observation.progress) ? observation.progress.map(item => cited(item, sources, '进展')) : invalid('progress 必须是数组。'),
      viewpoints,
      openQuestions: Array.isArray(observation.openQuestions) ? observation.openQuestions.map(item => {
        const row = record(item, '未决问题')
        known(row, ['text'])
        return { text: text(row.text, '未决问题', 500) }
      }) : invalid('openQuestions 必须是数组。'),
    }
  } else {
    const briefing = record(body.briefing, '近况速览')
    known(briefing, ['windowDays', 'confirmedEvents', 'publicationUpdates', 'undated', 'nextChecks'])
    if (body.deep !== undefined || body.observation !== undefined) invalid('报告段落与 mode 不一致。')
    const windowDays = briefing.windowDays === undefined ? 30 : briefing.windowDays
    if (typeof windowDays !== 'number' || !Number.isSafeInteger(windowDays) || windowDays < 1 || windowDays > ZHIHU_STUDY_MAX_WINDOW_DAYS) {
      invalid(`windowDays 必须是 1 到 ${ZHIHU_STUDY_MAX_WINDOW_DAYS}。`)
    }
    const now = options.now ?? Date.now()
    const start = now - windowDays * 86_400_000
    const eventRows = Array.isArray(briefing.confirmedEvents) ? briefing.confirmedEvents : invalid('confirmedEvents 必须是数组。')
    const confirmedEvents = eventRows.map(item => {
      const row = record(item, '已确认事件')
      known(row, ['id', 'title', 'sourceIds', 'eventOn', 'eventQuote'])
      const sourceList = sourceIds(row.sourceIds, sources, '已确认事件')
      const eventOn = text(row.eventOn, '事件日期', 10)
      const eventQuote = text(row.eventQuote, '事件引文', 500)
      if (!realDate(eventOn)) invalid('事件日期必须是真实的 YYYY-MM-DD。')
      const eventMs = Date.parse(`${eventOn}T00:00:00+08:00`)
      if (eventMs < start || eventMs > now) invalid('事件日期不在滚动窗口内，不能写入已确认时间线。')
      const quoted = sourceList.map(itemId => sources.get(itemId)!).find(source => source.excerpt.includes(eventQuote))
      if (!quoted || !dateForms(eventOn).some(form => eventQuote.includes(form))) invalid('事件日期必须出现在所引来源摘录中，不能补写。')
      return { id: idOf(row.id, '事件编号'), title: text(row.title, '事件标题', 120), sourceIds: sourceList, eventOn, eventQuote }
    })
    const seen = new Set<string>()
    for (const event of confirmedEvents) {
      const key = `${event.title}\n${event.eventOn}`
      if (seen.has(key)) invalid('相同标题和日期的事件需要先合并，不能重复列入时间线。')
      seen.add(key)
    }
    const publicationUpdates = (Array.isArray(briefing.publicationUpdates) ? briefing.publicationUpdates : invalid('publicationUpdates 必须是数组。')).map(item => {
      const row = record(item, '发布或更新')
      known(row, ['id', 'title', 'sourceIds'])
      const ids = sourceIds(row.sourceIds, sources, '发布或更新')
      for (const itemId of ids) {
        const source = sources.get(itemId)!
        const seconds = source.editTime ? Number(source.editTime) : Number.NaN
        if (!source.editTime || !Number.isSafeInteger(seconds) || seconds * 1000 < start || seconds * 1000 > now) {
          invalid('没有窗口内条目时间的来源不能写入发布或更新列表。')
        }
      }
      return { id: idOf(row.id, '更新编号'), title: text(row.title, '更新标题', 120), sourceIds: ids }
    })
    const undated = (Array.isArray(briefing.undated) ? briefing.undated : invalid('undated 必须是数组。')).map(item => {
      const row = record(item, '日期不确定')
      known(row, ['id', 'title', 'sourceIds'])
      return { id: idOf(row.id, '不确定编号'), title: text(row.title, '不确定标题', 120), sourceIds: sourceIds(row.sourceIds, sources, '日期不确定') }
    })
    report.briefing = {
      windowDays, windowStart: new Date(start).toISOString(), windowEnd: new Date(now).toISOString(),
      confirmedEvents, publicationUpdates, undated,
      nextChecks: (Array.isArray(briefing.nextChecks) ? briefing.nextChecks : invalid('nextChecks 必须是数组。')).map(item => {
        const row = record(item, '后续核对')
        known(row, ['text'])
        return { text: text(row.text, '后续核对', 500) }
      }),
    }
  }
  return report
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function escapeMd(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\[\]]/g, '')
}

function mdLink(url: string, label: string): string {
  return `[${escapeMd(label)}](${url})`
}

function htmlLink(url: string, label: string): string {
  return `<a href="${escapeHtml(url)}" rel="noopener noreferrer">${escapeHtml(label)}</a>`
}

function sourceLine(source: Source): string {
  const bits = [mdLink(source.url, source.title)]
  if (source.author) bits.push(`作者 ${escapeMd(source.author)}`)
  if (source.votes !== undefined) bits.push(`赞同 ${source.votes}`)
  if (source.authority) bits.push(`权威原值 ${escapeMd(source.authority)}${source.authorityMeaning ? `（${escapeMd(source.authorityMeaning)}）` : ''}`)
  if (source.editTime) bits.push(`条目时间 ${source.editTime}${source.editTimeMeaning ? `（${source.editTimeMeaning}）` : ''}`)
  return `- ${source.id}：${bits.join('；')}\n  摘录：${escapeMd(source.excerpt)}`
}

function provenanceText(input: InteractiveInput, sources: Source[]): string {
  const provenance = input.provenance
  if (provenance.kind === 'assumption') return `假设：${provenance.text}`
  const source = sources.find(item => item.id === provenance.sourceId)
  return `来源：${source ? mdLink(source.url, source.title) : provenance.sourceId}`
}

export function renderStudyMarkdown(report: ValidatedStudyReport): string {
  const lines = [`# ${escapeMd(report.title)}`, '', escapeMd(report.question), '', `> ${STUDY_REPORT_DISCLAIMERS[report.mode]}`, '']
  if (report.mode === 'deep' && report.deep) {
    if (report.deep.unansweredReason) lines.push(`未回答：${escapeMd(report.deep.unansweredReason)}`, '')
    lines.push('## 发现', '')
    for (const finding of report.deep.findings) lines.push(`- ${escapeMd(finding.text)}（${finding.sourceIds.join(', ')}）`)
    lines.push('', '## 假设', '')
    for (const assumption of report.deep.assumptions) lines.push(`- ${escapeMd(assumption.text)}`)
    lines.push('', '## 争议', '')
    for (const dispute of report.deep.disputes) lines.push(`- ${escapeMd(dispute.text)}（${dispute.sourceIds.join(', ')}）`)
    lines.push('', '## 交互计算', '')
    for (const block of report.deep.interactive) {
      lines.push(`### ${escapeMd(block.title)}`, '', `\`${block.formula}\` → ${escapeMd(block.outputLabel)}，初始结果 ${block.initialResult}`, '')
      for (const input of block.inputs) lines.push(`- ${escapeMd(input.label)}：${input.value}${input.unit ? ` ${escapeMd(input.unit)}` : ''}（${provenanceText(input, report.sources)}）`)
      lines.push('')
    }
  }
  if (report.mode === 'observation' && report.observation) {
    lines.push('## 现状', '')
    for (const item of report.observation.currentState) lines.push(`- ${escapeMd(item.text)}（${item.sourceIds.join(', ')}）`)
    lines.push('', '## 进展', '')
    for (const item of report.observation.progress) lines.push(`- ${escapeMd(item.text)}（${item.sourceIds.join(', ')}）`)
    lines.push('', '## 并列观点', '')
    for (const item of report.observation.viewpoints) {
      const citedSources = item.sourceIds.map(id => report.sources.find(source => source.id === id)).filter((source): source is Source => !!source)
      const author = citedSources.length === 1 ? citedSources[0].author : undefined
      const votes = citedSources.length === 1 ? citedSources[0].votes : undefined
      lines.push(`### ${item.id}`, '', escapeMd(item.text), '')
      if (author) lines.push(`作者：${escapeMd(author)}`)
      if (votes !== undefined) lines.push(`赞同：${votes}`)
      for (const source of citedSources) lines.push(`- ${mdLink(source.url, source.title)}`)
      lines.push('')
    }
    lines.push('## 未决问题', '')
    for (const item of report.observation.openQuestions) lines.push(`- ${escapeMd(item.text)}`)
    lines.push('')
  }
  if (report.mode === 'briefing' && report.briefing) {
    lines.push(`窗口：滚动 ${report.briefing.windowDays} 天（${report.briefing.windowStart} 至 ${report.briefing.windowEnd}）`, '', '## 已确认事件', '')
    for (const event of report.briefing.confirmedEvents) lines.push(`- ${event.eventOn} ${escapeMd(event.title)}（${event.sourceIds.join(', ')}）`, `  引文：${escapeMd(event.eventQuote)}`)
    lines.push('', '## 发布或更新（不是事件发生）', '')
    for (const item of report.briefing.publicationUpdates) lines.push(`- ${escapeMd(item.title)}（${item.sourceIds.join(', ')}）`)
    lines.push('', '## 日期不确定', '')
    for (const item of report.briefing.undated) lines.push(`- ${escapeMd(item.title)}（${item.sourceIds.join(', ')}）`)
    lines.push('', '## 后续核对', '')
    for (const item of report.briefing.nextChecks) lines.push(`- ${escapeMd(item.text)}`)
    lines.push('')
  }
  if (report.limitations.length > 0) {
    lines.push('## 局限', '')
    for (const limitation of report.limitations) lines.push(`- ${escapeMd(limitation)}`)
    lines.push('')
  }
  lines.push('## 来源', '')
  for (const source of report.sources) lines.push(sourceLine(source))
  lines.push('', '测试验证的是校验、转义和文件契约，不是模型综合质量。')
  return lines.join('\n')
}

export const STUDY_PAGE_SCRIPT = `function zhihuStudyEvaluate(formula, values) {
  var index = 0;
  var tokens = [];
  var i = 0;
  while (i < formula.length) {
    var char = formula.charAt(i);
    if (char === ' ' || char === '\\t') { i += 1; continue; }
    if ('+-*/'.indexOf(char) >= 0) { tokens.push({ kind: 'op', text: char }); i += 1; continue; }
    if (char === '(') { tokens.push({ kind: 'lp', text: char }); i += 1; continue; }
    if (char === ')') { tokens.push({ kind: 'rp', text: char }); i += 1; continue; }
    var number = /^\\d+(?:\\.\\d+)?/.exec(formula.slice(i));
    if (number) { tokens.push({ kind: 'num', text: number[0] }); i += number[0].length; continue; }
    var name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(formula.slice(i));
    if (name) { tokens.push({ kind: 'id', text: name[0] }); i += name[0].length; continue; }
    return null;
  }
  function peek() { return tokens[index]; }
  function eat(kind) {
    var token = tokens[index];
    if (!token || (kind && token.kind !== kind)) throw new Error('bad');
    index += 1;
    return token;
  }
  function factor() {
    var token = peek();
    if (!token) throw new Error('bad');
    if (token.kind === 'op' && token.text === '-') { eat(); return -factor(); }
    if (token.kind === 'num') return Number(eat().text);
    if (token.kind === 'id') {
      var id = eat().text;
      if (!Object.prototype.hasOwnProperty.call(values, id)) throw new Error('bad');
      return values[id];
    }
    if (token.kind === 'lp') { eat(); var value = expr(); eat('rp'); return value; }
    throw new Error('bad');
  }
  function term() {
    var value = factor();
    while (peek() && peek().kind === 'op' && (peek().text === '*' || peek().text === '/')) {
      var op = eat().text;
      var right = factor();
      if (op === '/' && right === 0) throw new Error('zero');
      value = op === '*' ? value * right : value / right;
    }
    return value;
  }
  function expr() {
    var value = term();
    while (peek() && peek().kind === 'op' && (peek().text === '+' || peek().text === '-')) {
      var op = eat().text;
      var right = term();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  }
  try {
    var value = expr();
    if (index !== tokens.length || !isFinite(value)) return null;
    return Math.round(value * 1000) / 1000;
  } catch (error) { return null; }
}
function zhihuStudyBind() {
  if (typeof document === 'undefined') return;
  var node = document.getElementById('zs-data');
  if (!node) return;
  var data = JSON.parse(node.textContent || '{"blocks":[]}');
  function paint(block) {
    var values = {};
    block.inputs.forEach(function (input) {
      var control = document.querySelector('[data-zs-input="' + block.id + ':' + input.id + '"]');
      values[input.id] = control ? Number(control.value) : input.value;
      var current = document.querySelector('[data-zs-value="' + block.id + ':' + input.id + '"]');
      if (current) current.textContent = String(values[input.id]) + (input.unit ? ' ' + input.unit : '');
    });
    var result = zhihuStudyEvaluate(block.formula, values);
    var target = document.querySelector('[data-zs-result="' + block.id + '"]');
    if (target) target.textContent = result === null ? '无法计算' : String(result) + (block.outputUnit ? ' ' + block.outputUnit : '');
  }
  (data.blocks || []).forEach(function (block) {
    paint(block);
    block.inputs.forEach(function (input) {
      var control = document.querySelector('[data-zs-input="' + block.id + ':' + input.id + '"]');
      if (control) control.addEventListener('input', function () { paint(block); });
    });
  });
}
zhihuStudyBind();
`

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

function htmlSources(report: ValidatedStudyReport): string {
  return report.sources.map(source => `<li><span class="zs-id">${escapeHtml(source.id)}</span> ${htmlLink(source.url, source.title)}${source.author ? ` · ${escapeHtml(source.author)}` : ''}${source.votes !== undefined ? ` · 赞同 ${source.votes}` : ''}<blockquote>${escapeHtml(source.excerpt)}</blockquote></li>`).join('')
}

export function renderStudyHtml(report: ValidatedStudyReport): string {
  const blocks = report.deep?.interactive ?? []
  const data = safeJson({
    blocks: blocks.map(block => ({
      id: block.id,
      formula: block.formula,
      outputUnit: block.outputUnit ?? '',
      inputs: block.inputs.map(input => ({ id: input.id, value: input.value, unit: input.unit ?? '' })),
    })),
  })
  const interactive = blocks.map(block => `<section class="zs-block">
    <h3>${escapeHtml(block.title)}</h3>
    <p class="zs-formula"><code>${escapeHtml(block.formula)}</code></p>
    ${block.inputs.map(input => {
      const provenance = input.provenance
      const cited = provenance.kind === 'source' ? report.sources.find(source => source.id === provenance.sourceId) : undefined
      const basis = provenance.kind === 'assumption'
        ? `假设：${escapeHtml(provenance.text)}`
        : `来源：${htmlLink(cited?.url ?? '', cited?.title ?? provenance.sourceId)}`
      return `<label class="zs-slider">${escapeHtml(input.label)}
        <input type="range" min="${input.min}" max="${input.max}" step="${input.step}" value="${input.value}" data-zs-input="${escapeHtml(`${block.id}:${input.id}`)}">
        <output data-zs-value="${escapeHtml(`${block.id}:${input.id}`)}">${escapeHtml(String(input.value))}${input.unit ? ` ${escapeHtml(input.unit)}` : ''}</output>
        <small>${basis}</small>
      </label>`
    }).join('')}
    <p>${escapeHtml(block.outputLabel)} <output data-zs-result="${escapeHtml(block.id)}">${escapeHtml(String(Math.round(block.initialResult * 1000) / 1000))}${block.outputUnit ? ` ${escapeHtml(block.outputUnit)}` : ''}</output></p>
    <p class="zs-note">结果由本页公式计算，不是新的外部数据。</p>
  </section>`).join('')
  const body = report.mode === 'deep' && report.deep ? `
    ${report.deep.unansweredReason ? `<p>${escapeHtml(report.deep.unansweredReason)}</p>` : ''}
    <h2>发现</h2><ul>${report.deep.findings.map(item => `<li>${escapeHtml(item.text)} <span class="zs-id">${escapeHtml(item.sourceIds.join(', '))}</span></li>`).join('')}</ul>
    <h2>假设</h2><ul>${report.deep.assumptions.map(item => `<li>${escapeHtml(item.text)}</li>`).join('')}</ul>
    <h2>争议</h2><ul>${report.deep.disputes.map(item => `<li>${escapeHtml(item.text)} <span class="zs-id">${escapeHtml(item.sourceIds.join(', '))}</span></li>`).join('')}</ul>
    <h2>交互计算</h2>${interactive || '<p>这次没有可计算的输入。</p>'}`
    : report.mode === 'observation' && report.observation ? `
    <h2>现状</h2><ul>${report.observation.currentState.map(item => `<li>${escapeHtml(item.text)}</li>`).join('')}</ul>
    <h2>进展</h2><ul>${report.observation.progress.map(item => `<li>${escapeHtml(item.text)}</li>`).join('')}</ul>
    <h2>并列观点</h2><div class="zs-views">${report.observation.viewpoints.map(item => {
      const citedSources = item.sourceIds.map(id => report.sources.find(source => source.id === id)).filter((source): source is Source => !!source)
      const only = citedSources.length === 1 ? citedSources[0] : undefined
      return `<article><h3>${escapeHtml(item.id)}</h3><p>${escapeHtml(item.text)}</p>${only?.author ? `<p>作者：${escapeHtml(only.author)}</p>` : ''}${only?.votes !== undefined ? `<p>赞同：${only.votes}</p>` : ''}<ul>${citedSources.map(source => `<li>${htmlLink(source.url, source.title)}</li>`).join('')}</ul></article>`
    }).join('')}</div>
    <h2>未决问题</h2><ul>${report.observation.openQuestions.map(item => `<li>${escapeHtml(item.text)}</li>`).join('')}</ul>`
    : report.briefing ? `
    <p>窗口：滚动 ${report.briefing.windowDays} 天，${escapeHtml(report.briefing.windowStart)} 至 ${escapeHtml(report.briefing.windowEnd)}。</p>
    <h2>已确认事件</h2><ol class="zs-time">${report.briefing.confirmedEvents.map(event => `<li><time datetime="${escapeHtml(event.eventOn)}">${escapeHtml(event.eventOn)}</time> ${escapeHtml(event.title)}<blockquote>${escapeHtml(event.eventQuote)}</blockquote></li>`).join('') || '<li>窗口内没有可从摘录确认的事件。</li>'}</ol>
    <h2>发布或更新，不是事件发生</h2><ul>${report.briefing.publicationUpdates.map(item => `<li>${escapeHtml(item.title)}</li>`).join('') || '<li>无</li>'}</ul>
    <h2>日期不确定</h2><ul>${report.briefing.undated.map(item => `<li>${escapeHtml(item.title)}</li>`).join('') || '<li>无</li>'}</ul>
    <h2>后续核对</h2><ul>${report.briefing.nextChecks.map(item => `<li>${escapeHtml(item.text)}</li>`).join('')}</ul>`
    : ''
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(report.title)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0 auto; max-width: 46rem; padding: 2rem 1.25rem 4rem; font: 16px/1.6 "Iowan Old Style", Palatino, "Palatino Linotype", "Songti SC", serif; color: #241c15; background: #f6f1e7; }
  h1, h2, h3 { font-family: "Avenir Next", "Segoe UI", "PingFang SC", sans-serif; line-height: 1.25; }
  a { color: #0f5c56; }
  blockquote, .zs-note, small { color: #5c5146; }
  .zs-banner { padding: 0.75rem 1rem; background: #efe4d2; border-left: 4px solid #0f5c56; }
  .zs-views { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 0.75rem; }
  .zs-views article, .zs-block { background: #fffdf8; border: 1px solid #e2d5c3; padding: 0.75rem 1rem; }
  .zs-time { list-style: none; padding: 0; border-left: 3px solid #0f5c56; }
  .zs-time li { padding: 0 0 0.8rem 1rem; }
  .zs-slider { display: grid; gap: 0.2rem; margin: 0.8rem 0; }
  .zs-id { font-family: ui-monospace, monospace; font-size: 0.85em; }
  code { font-family: ui-monospace, monospace; }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(report.title)}</h1>
<p>${escapeHtml(report.question)}</p>
<p class="zs-banner">${escapeHtml(STUDY_REPORT_DISCLAIMERS[report.mode])}</p>
${body}
<h2>来源</h2>
<ol>${htmlSources(report)}</ol>
${report.limitations.length ? `<h2>局限</h2><ul>${report.limitations.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
<p class="zs-note">这份页面由本地插件生成。它不加载外部资源。测试验证的是校验和转义，不是模型综合质量。</p>
</main>
<script id="zs-data" type="application/json">${data}</script>
<script>${STUDY_PAGE_SCRIPT}</script>
</body>
</html>`
}

export async function writeZhihuStudyReport(directory: unknown, report: unknown, options: { now?: number } = {}): Promise<{
  directory: string
  markdown: string
  json: string
  html: string
  report: ValidatedStudyReport
}> {
  if (typeof directory !== 'string' || !isAbsolute(directory) || directory.includes('\0')) invalid('directory 必须是已存在的绝对路径。')
  const validated = validateZhihuStudyReport(report, options)
  const root = await realpath(directory).catch(() => invalid('directory 必须是已存在的绝对路径。'))
  const info = await stat(root)
  if (!info.isDirectory()) invalid('directory 必须是目录。')
  const folder = join(root, `zhihu-study-${randomBytes(8).toString('hex')}`)
  await mkdir(folder)
  const markdownText = renderStudyMarkdown(validated)
  const htmlText = renderStudyHtml(validated)
  const jsonText = `${JSON.stringify({ version: 1, renderer: 'dsh-zhihu-study', generatedAt: new Date(options.now ?? Date.now()).toISOString(), report: validated }, null, 2)}\n`
  const files = { markdown: join(folder, 'report.md'), json: join(folder, 'report.json'), html: join(folder, 'report.html') }
  await writeFile(files.markdown, markdownText, { encoding: 'utf8', flag: 'wx' })
  await writeFile(files.json, jsonText, { encoding: 'utf8', flag: 'wx' })
  await writeFile(files.html, htmlText, { encoding: 'utf8', flag: 'wx' })
  for (const file of Object.values(files)) {
    const actual = await realpath(file)
    if (actual !== file || !actual.startsWith(root.endsWith(sep) ? root : root + sep)) invalid('报告路径越出了指定目录。')
  }
  return { directory: folder, ...files, report: validated }
}

export function renderZhihuStudyReportResult(result: { html: string }): string {
  return `已写好可打开的本地报告。请打开这个 HTML 文件：${result.html}\n同目录还有 report.md 和 report.json。页面不加载外部资源。这是宿主综合之后的导出，测试并不证明模型结论正确。`
}

export function createZhihuStudyReportTool() {
  return defineTool({
    name: ZHIHU_STUDY_REPORT_TOOL_NAME,
    description:
      '把宿主综合后的研究结构写成 report.md、report.json 和单文件 report.html，并返回可打开的 HTML 路径。' +
      '不发起知乎请求，不能打开付费，也不能把 zhihu_study 的证据清单直接当成成品。' +
      '数字必须有来源或明确假设；观点必须追到来源；近况默认 30 天，事件日期必须能在摘录里找到，缺日期不能进已确认时间线。',
    parameters: {
      directory: { type: 'string', required: true, description: '用户能打开的现有绝对目录。插件会在其中新建 zhihu-study-* 文件夹。' },
      report: { type: 'object', required: true, description: '综合后的报告。mode 为 deep、observation 或 briefing，并带 sources 与对应段落。', additionalProperties: true },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render(_args, value) { return [{ type: 'text' as const, text: renderZhihuStudyReportResult(value as { html: string }) }] },
    },
    isConcurrencySafe() { return false },
    async execute(args) {
      const input = args as { directory?: unknown; report?: unknown }
      const written = await writeZhihuStudyReport(input.directory, input.report)
      return { phase: 'report' as const, finishedReport: true, directory: written.directory, markdown: written.markdown, json: written.json, html: written.html }
    },
  })
}
