/**
 * Validate a host-written study and write a local Markdown report, JSON, and
 * one self-contained HTML file. The page script only evaluates declared formulas.
 * Untrusted titles, excerpts and URLs are escaped and never executed.
 */
import { randomBytes } from 'node:crypto'
import { lstat, mkdir, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ZHIHU_STUDY_REPORT_TOOL_NAME } from './contracts.ts'
import { ZHIHU_GLOBAL_AUTHORITY_LEGEND, ZHIHU_STUDY_MAX_CALLS, ZHIHU_STUDY_MAX_WINDOW_DAYS, shanghaiDate, zhihuStudyWindow, type ZhihuStudyWindow } from './study.ts'
import { ZhihuSearchError } from './zhihu-client.ts'

export const STUDY_REPORT_DISCLAIMERS = {
  deep: '交互结果仅按页面声明的公式与滑杆实时计算。标为来源（source）的数值均在对应引文中同时包含量名、数字与紧邻单位，单位换算（conversion）与未在摘录中出现的值均已明确标为假设（如 20 平方米 ÷ 2 元 = 10 平方米/元）。所有测算参数与综合结论均出自本次报告内容。',
  observation: '以下内容基于本次检索样本中的多方观点并列整理，作者与赞同数仅展示来源实际返回的字段。',
  briefing: '已确认事件的日期均可在对应摘录引文中找到；发布或更新时间按条目时间戳单独归类，缺日期或窗口外条目另列于 undated。',
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
type InputProvenance =
  | { kind: 'source'; sourceId: string; quote: string }
  | { kind: 'assumption'; text: string }
  | { kind: 'conversion'; sourceId: string; quote: string; original: number; originalUnit: string; factor: number; note: string }
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

function numberPattern(value: number): RegExp {
  const raw = Object.is(value, -0) ? '0' : String(value)
  return new RegExp(`(?<![\\d.])${raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\d.])`, 'g')
}

/** The token glued to a numeral. This is a bounded string check, not a claim that the sentence was understood. */
function adjacentUnit(quote: string, index: number, length: number): string {
  return /^\s*([A-Za-z\u4e00-\u9fff%㎡²³·/]{1,16})/.exec(quote.slice(index + length))?.[1] ?? ''
}

function citedQuantity(quote: string, value: number, unit: string | undefined, label?: string): boolean {
  if (label !== undefined && !quote.includes(label)) return false
  for (const match of quote.matchAll(numberPattern(value))) {
    const attached = adjacentUnit(quote, match.index ?? 0, match[0].length)
    if (unit ? attached === unit : attached === '') return true
  }
  return false
}

function provenance(value: unknown, sources: Map<string, Source>, label: string, unit: string | undefined, initial: number): InputProvenance {
  const row = record(value, '数值依据')
  known(row, ['kind', 'sourceId', 'quote', 'text', 'original', 'originalUnit', 'factor', 'note'])
  if (row.kind === 'source') {
    const sourceId = sourceIds([row.sourceId], sources, '数值依据')[0]!
    const quote = text(row.quote, '数值引文', 200)
    const cited = sources.get(sourceId)
    if (!cited?.excerpt.includes(quote) || !citedQuantity(quote, initial, unit, label)) {
      invalid('标为来源的数量必须在摘录引文里同时出现量名、数字和紧挨着的单位。无关数字请改成假设。')
    }
    return { kind: 'source', sourceId, quote }
  }
  if (row.kind === 'assumption') {
    if (row.sourceId !== undefined || row.quote !== undefined) invalid('假设不能伪装成来源。')
    return { kind: 'assumption', text: text(row.text, '假设', 200) }
  }
  if (row.kind === 'conversion') {
    const sourceId = sourceIds([row.sourceId], sources, '换算依据')[0]!
    const quote = text(row.quote, '换算引文', 200)
    const original = finiteNumber(row.original, '原文数值')
    const originalUnit = text(row.originalUnit, '原文单位', 16)
    const factor = finiteNumber(row.factor, '换算系数')
    const note = text(row.note, '换算说明', 200)
    const cited = sources.get(sourceId)
    if (!cited?.excerpt.includes(quote) || !citedQuantity(quote, original, originalUnit)) {
      invalid('换算必须引用摘录里紧挨着的原数字和原单位，并写明这是换算假设。')
    }
    if (!Number.isFinite(original * factor) || Math.abs(original * factor - initial) > 1e-9 * Math.max(1, Math.abs(initial))) {
      invalid('换算结果必须等于原文数值乘以写明的系数。')
    }
    return { kind: 'conversion', sourceId, quote, original, originalUnit, factor, note }
  }
  invalid('数值依据必须是 source、assumption 或 conversion。')
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
      min, max, step, value: initial, ...(unit ? { unit } : {}), provenance: provenance(input.provenance, sources, text(input.label, '输入名称', 80), unit, initial),
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
  const composed = composeUnit(formula, Object.fromEntries(inputs.map(input => [input.id, input.unit ?? ''])))
  const declared = row.outputUnit === undefined ? undefined : text(row.outputUnit, '结果单位', 32)
  if (declared !== undefined && declared !== composed) invalid(`结果单位与输入单位的运算不一致：应为 ${composed || '无单位'}，不能写成 ${declared}。`)
  const outputUnit = declared ?? (composed || undefined)
  return {
    id: idOf(row.id, '交互块编号'), title: text(row.title, '交互块标题', 120), inputs, formula,
    outputLabel: text(row.outputLabel, '结果名称', 80), ...(outputUnit ? { outputUnit } : {}), initialResult,
  }
}

function composeUnit(formula: string, units: Record<string, string>): string {
  const tokens = tokenizeStudyFormula(formula)
  let index = 0
  const peek = () => tokens[index]
  const eat = () => tokens[index++]
  const factor = (): string => {
    const token = peek()
    if (!token) invalid('公式无效')
    if (token.kind === 'op' && token.text === '-') { eat(); return factor() }
    if (token.kind === 'num') { eat(); return '' }
    if (token.kind === 'id') { eat(); return units[token.text] ?? '' }
    if (token.kind === 'lp') { eat(); const value = expr(); if (peek()?.kind !== 'rp') invalid('公式无效'); eat(); return value }
    invalid('公式无效')
  }
  const term = (): string => {
    let value = factor()
    while (peek()?.kind === 'op' && (peek()?.text === '*' || peek()?.text === '/')) {
      const op = eat().text
      const right = factor()
      if (op === '*') value = !value ? right : !right ? value : `${value}·${right}`
      else value = !right ? value : !value ? `1/${right}` : `${value}/${right}`
    }
    return value
  }
  const expr = (): string => {
    let value = term()
    while (peek()?.kind === 'op' && (peek()?.text === '+' || peek()?.text === '-')) {
      eat()
      const right = term()
      if (value !== right) invalid('加减两边的单位不一致，不能合成一个结果单位。')
    }
    return value
  }
  const unit = expr()
  if (index !== tokens.length) invalid('公式无效')
  return unit
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

function bounded(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value)) invalid(`${label}必须是数组。`)
  if (value.length > max) invalid(`${label}不能超过 ${max} 条。`)
  return value
}

type BoundEvidence = {
  id: string
  url: string
  excerpts: string[]
  author?: string
  votes?: number
  authority?: string
  authorityMeaning?: string
  editTime?: string
  editTimeMeaning?: 'publish_or_update' | 'last_edit' | 'mixed' | 'unavailable'
}

function readEvidence(value: unknown, mode: string, question: string): { items: Map<string, BoundEvidence>; window?: ZhihuStudyWindow } {
  const row = record(value, '取证结果')
  if (row.phase !== 'evidence' || row.finishedReport !== false || row.version !== 1) invalid('报告必须附上同一次 zhihu_study 取证结果。')
  if (row.mode !== mode || row.question !== question) invalid('报告的模式和问题必须与取证结果一致。')
  const stop = record(row.stop, '取证预算')
  if (typeof stop.budgetApplied !== 'number' || !Number.isSafeInteger(stop.budgetApplied) || stop.budgetApplied < 1 || stop.budgetApplied > ZHIHU_STUDY_MAX_CALLS) {
    invalid('取证预算超出单次上限。')
  }
  if (typeof stop.callsUsed !== 'number' || !Number.isSafeInteger(stop.callsUsed) || stop.callsUsed < 0 || stop.callsUsed > stop.budgetApplied) {
    invalid('取证调用次数与预算不一致。')
  }
  const items = new Map<string, BoundEvidence>()
  for (const item of bounded(row.evidence, '取证条目', 40)) {
    const entry = record(item, '取证条目')
    const id = typeof entry.id === 'string' ? entry.id : invalid('取证编号无效。')
    if (!ID_PATTERN.test(id) || items.has(id)) invalid('取证编号无效或重复。')
    const excerpts = Array.isArray(entry.excerpts) ? entry.excerpts.filter((part): part is string => typeof part === 'string' && part.length > 0) : []
    const meaning = entry.editTimeMeaning
    items.set(id, {
      id, url: typeof entry.url === 'string' ? entry.url : '', excerpts,
      ...(typeof entry.author === 'string' ? { author: entry.author } : {}),
      ...(typeof entry.votes === 'number' ? { votes: entry.votes } : {}),
      ...(typeof entry.authority === 'string' ? { authority: entry.authority } : {}),
      ...(typeof entry.authorityMeaning === 'string' ? { authorityMeaning: entry.authorityMeaning } : {}),
      ...(typeof entry.editTime === 'string' ? { editTime: entry.editTime } : {}),
      ...(meaning === 'publish_or_update' || meaning === 'last_edit' || meaning === 'mixed' || meaning === 'unavailable' ? { editTimeMeaning: meaning } : {}),
    })
  }
  if (mode !== 'briefing') return { items }
  return { items, window: canonicalStudyWindow(row.window) }
}

/** Accept only the window `zhihuStudyWindow(end, days)` would have frozen. Contradictory fields are not printed. */
function canonicalStudyWindow(value: unknown): ZhihuStudyWindow {
  const raw = record(value, '取证窗口')
  known(raw, ['days', 'basis', 'startDate', 'endDate', 'start', 'end'])
  if (raw.basis !== 'shanghai_calendar_day') invalid('近况窗口必须使用上海日历日。')
  if (typeof raw.days !== 'number' || !Number.isSafeInteger(raw.days) || raw.days < 1 || raw.days > ZHIHU_STUDY_MAX_WINDOW_DAYS) {
    invalid('取证窗口天数无效。')
  }
  if (typeof raw.end !== 'string' || !Number.isFinite(Date.parse(raw.end))) invalid('取证窗口的结束时刻无效。')
  const endMs = Date.parse(raw.end)
  if (shanghaiDate(endMs) !== raw.endDate || !realDate(String(raw.endDate)) || !realDate(String(raw.startDate))) {
    invalid('取证窗口的日期和结束时刻不一致。')
  }
  const expected = zhihuStudyWindow(endMs, raw.days)
  const actual = {
    days: raw.days, basis: raw.basis, startDate: raw.startDate, endDate: raw.endDate,
    start: raw.start, end: new Date(endMs).toISOString(),
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) invalid('取证窗口的天数、起止日期和起止时刻必须来自同一次取证时钟，不能互相矛盾。')
  return expected
}

function sameOrCopy<T>(host: T | undefined, evidence: T | undefined, label: string): T | undefined {
  if (host !== undefined && host !== evidence) invalid(`${label}必须与取证结果一致。`)
  return evidence
}

function parseSources(value: unknown, evidence: Map<string, BoundEvidence>): Map<string, Source> {
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
    const bound = evidence.get(source.id)
    if (!bound) invalid(`来源 ${source.id} 不在这次取证结果里。`)
    if (source.url !== bound.url) invalid('来源链接必须与取证结果一致。')
    if (!bound.excerpts.some(excerpt => excerpt.includes(source.excerpt))) invalid('来源摘录必须出自取证结果，不能另写。')
    source.author = sameOrCopy(source.author, bound.author, '作者')
    source.votes = sameOrCopy(source.votes, bound.votes, '赞同数')
    source.authority = sameOrCopy(source.authority, bound.authority, '权威原值')
    source.authorityMeaning = sameOrCopy(source.authorityMeaning, bound.authorityMeaning, '权威含义')
    source.editTime = sameOrCopy(source.editTime, bound.editTime, '条目时间')
    source.editTimeMeaning = sameOrCopy(source.editTimeMeaning, bound.editTimeMeaning === 'mixed' || bound.editTimeMeaning === 'unavailable' ? undefined : bound.editTimeMeaning, '条目时间含义')
    sources.set(source.id, source)
  }
  return sources
}

export function validateZhihuStudyReport(input: unknown): ValidatedStudyReport {
  const body = record(input, '报告')
  if (body.phase === 'evidence' || body.finishedReport === false) invalid('证据清单不是成品报告。请先综合，再提交报告结构。')
  known(body, ['mode', 'title', 'question', 'limitations', 'sources', 'deep', 'observation', 'briefing', 'evidence'])
  if (body.mode !== 'deep' && body.mode !== 'observation' && body.mode !== 'briefing') invalid('报告 mode 无效。')
  const question = text(body.question, '问题', 4000)
  if (body.evidence === undefined) invalid('报告必须附上同一次取证结果，不能另填来源。')
  const evidence = readEvidence(body.evidence, body.mode, question)
  const sources = parseSources(body.sources, evidence.items)
  const limitations = body.limitations === undefined ? [] : bounded(body.limitations, '局限', 20)
    .map(item => text(item, '局限', 500))
  const report: ValidatedStudyReport = {
    mode: body.mode, title: text(body.title, '标题', 120), question,
    limitations, sources: [...sources.values()],
  }
  if (body.mode === 'deep') {
    const deep = record(body.deep, '深度研究')
    known(deep, ['findings', 'assumptions', 'disputes', 'interactive', 'unansweredReason'])
    if (body.observation !== undefined || body.briefing !== undefined) invalid('报告段落与 mode 不一致。')
    const findings = bounded(deep.findings, '发现', 20).map(item => cited(item, sources, '发现'))
    const assumptions = bounded(deep.assumptions, '假设', 20).map(item => {
      const row = record(item, '假设')
      known(row, ['text'])
      return { text: text(row.text, '假设', 500) }
    })
    const disputes = bounded(deep.disputes, '争议', 20).map(item => cited(item, sources, '争议'))
    const blocks = bounded(deep.interactive, '交互块', 3).map(item => interactive(item, sources))
    if (new Set(blocks.map(item => item.id)).size !== blocks.length) invalid('交互块编号重复。')
    const unansweredReason = deep.unansweredReason === undefined ? undefined : text(deep.unansweredReason, '未回答原因', 500)
    if (findings.length === 0 && !unansweredReason) invalid('没有发现时必须写明未回答原因，不能导出空白结论。')
    report.deep = { findings, assumptions, disputes, interactive: blocks, ...(unansweredReason ? { unansweredReason } : {}) }
  } else if (body.mode === 'observation') {
    const observation = record(body.observation, '知乎观察')
    known(observation, ['currentState', 'progress', 'viewpoints', 'openQuestions'])
    if (body.deep !== undefined || body.briefing !== undefined) invalid('报告段落与 mode 不一致。')
    const viewpoints = bounded(observation.viewpoints, '观点', 12).map(item => {
      const row = record(item, '观点')
      known(row, ['id', 'text', 'sourceIds'])
      return { id: idOf(row.id, '观点编号'), text: text(row.text, '观点', 2000), sourceIds: sourceIds(row.sourceIds, sources, '观点') }
    })
    if (viewpoints.length < 2) invalid('并列观点至少要有两条，不能把单条样本写成各方看法。')
    const citedIds = new Set(viewpoints.flatMap(item => item.sourceIds))
    if (citedIds.size < 2) invalid('并列观点必须追到至少两个不同来源。')
    report.observation = {
      currentState: bounded(observation.currentState, '现状', 20).map(item => cited(item, sources, '现状')),
      progress: bounded(observation.progress, '进展', 20).map(item => cited(item, sources, '进展')),
      viewpoints,
      openQuestions: bounded(observation.openQuestions, '未决问题', 20).map(item => {
        const row = record(item, '未决问题')
        known(row, ['text'])
        return { text: text(row.text, '未决问题', 500) }
      }),
    }
  } else {
    const briefing = record(body.briefing, '近况速览')
    known(briefing, ['confirmedEvents', 'publicationUpdates', 'undated', 'nextChecks'])
    if (body.deep !== undefined || body.observation !== undefined) invalid('报告段落与 mode 不一致。')
    const window = evidence.window
    if (!window) invalid('近况报告必须沿用取证时固定的上海日历窗口。')
    const eventRows = bounded(briefing.confirmedEvents, '已确认事件', 20)
    const confirmedEvents = eventRows.map(item => {
      const row = record(item, '已确认事件')
      known(row, ['id', 'title', 'sourceIds', 'eventOn', 'eventQuote'])
      const sourceList = sourceIds(row.sourceIds, sources, '已确认事件')
      const eventOn = text(row.eventOn, '事件日期', 10)
      const eventQuote = text(row.eventQuote, '事件引文', 500)
      if (!realDate(eventOn)) invalid('事件日期必须是真实的 YYYY-MM-DD。')
      if (eventOn < window.startDate || eventOn > window.endDate) invalid('事件日期不在取证窗口内，不能写入已确认时间线。')
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
    const publicationUpdates = bounded(briefing.publicationUpdates, '发布或更新', 20).map(item => {
      const row = record(item, '发布或更新')
      known(row, ['id', 'title', 'sourceIds'])
      const ids = sourceIds(row.sourceIds, sources, '发布或更新')
      for (const itemId of ids) {
        const source = sources.get(itemId)!
        const seconds = source.editTime ? Number(source.editTime) : Number.NaN
        const date = Number.isSafeInteger(seconds) ? shanghaiDate(seconds * 1000) : ''
        if (!source.editTime || date < window.startDate || date > window.endDate) {
          invalid('没有窗口内条目时间的来源不能写入发布或更新列表。')
        }
      }
      return { id: idOf(row.id, '更新编号'), title: text(row.title, '更新标题', 120), sourceIds: ids }
    })
    const undated = bounded(briefing.undated, '日期不确定', 20).map(item => {
      const row = record(item, '日期不确定')
      known(row, ['id', 'title', 'sourceIds'])
      return { id: idOf(row.id, '不确定编号'), title: text(row.title, '不确定标题', 120), sourceIds: sourceIds(row.sourceIds, sources, '日期不确定') }
    })
    report.briefing = {
      windowDays: window.days, windowStart: window.start, windowEnd: window.end,
      confirmedEvents, publicationUpdates, undated,
      nextChecks: bounded(briefing.nextChecks, '后续核对', 10).map(item => {
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
  const link = source ? mdLink(source.url, source.title) : provenance.sourceId
  if (provenance.kind === 'conversion') return `换算假设：${provenance.note}（原文 ${provenance.original} ${provenance.originalUnit}，见 ${link}）`
  return `来源引文：${provenance.quote}（${link}）`
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

/** Standalone report sheet. Every selector stays under .zs-page so it is not a host rule. */
export const STUDY_REPORT_CSS = `
.zs-page { margin: 0 auto; max-width: 46rem; padding: 2rem 1.25rem 4rem; font: 16px/1.6 Palatino, "Palatino Linotype", "Songti SC", serif; color: #241c15; background: #f6f1e7; color-scheme: light; }
.zs-page h1, .zs-page h2, .zs-page h3 { font-family: "Avenir Next", "Segoe UI", "PingFang SC", sans-serif; line-height: 1.25; }
.zs-page a { color: #0f5c56; }
.zs-page blockquote, .zs-page .zs-note, .zs-page small { color: #5c5146; }
.zs-page .zs-banner { padding: 0.75rem 1rem; background: #efe4d2; border-left: 4px solid #0f5c56; }
.zs-page .zs-views { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 0.75rem; }
.zs-page .zs-views article, .zs-page .zs-block { background: #fffdf8; border: 1px solid #e2d5c3; padding: 0.75rem 1rem; }
.zs-page .zs-time { list-style: none; padding: 0; border-left: 3px solid #0f5c56; }
.zs-page .zs-time li { padding: 0 0 0.8rem 1rem; }
.zs-page .zs-slider { display: grid; gap: 0.2rem; margin: 0.8rem 0; }
.zs-page .zs-id, .zs-page code { font-family: ui-monospace, monospace; }
.zs-page .zs-id { font-size: 0.85em; }
`.trim()

export const STUDY_PAGE_SCRIPT = `function zhihuStudyEvaluate(formula, values) {
  var index = 0;
  var tokens = [];
  var i = 0;
  function pushToken(kind, text) {
    var item = {};
    item.kind = kind;
    item.text = text;
    tokens.push(item);
  }
  while (i < formula.length) {
    var char = formula.charAt(i);
    if (char === ' ' || char === '\\t') { i += 1; continue; }
    if ('+-*/'.indexOf(char) >= 0) { pushToken('op', char); i += 1; continue; }
    if (char === '(') { pushToken('lp', char); i += 1; continue; }
    if (char === ')') { pushToken('rp', char); i += 1; continue; }
    var number = /^\\d+(?:\\.\\d+)?/.exec(formula.slice(i));
    if (number) { pushToken('num', number[0]); i += number[0].length; continue; }
    var name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(formula.slice(i));
    if (name) { pushToken('id', name[0]); i += name[0].length; continue; }
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
  var data = JSON.parse(node.textContent || 'null');
  if (!data) data = {};
  if (!data.blocks) data.blocks = [];
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
      const cited = provenance.kind === 'assumption' ? undefined : report.sources.find(source => source.id === provenance.sourceId)
      const link = provenance.kind === 'assumption' ? '' : htmlLink(cited?.url ?? '', cited?.title ?? provenance.sourceId)
      const basis = provenance.kind === 'assumption'
        ? `假设：${escapeHtml(provenance.text)}`
        : provenance.kind === 'conversion'
          ? `换算假设：${escapeHtml(provenance.note)}（原文 ${escapeHtml(String(provenance.original))} ${escapeHtml(provenance.originalUnit)}）${link}`
          : `来源引文：${escapeHtml(provenance.quote)} ${link}`
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
<style>${STUDY_REPORT_CSS}</style>
</head>
<body class="zs-page">
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

async function rejectSymlink(path: string, missingOk = false) {
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink()) invalid('导出路径不能经过符号链接。')
    return info
  } catch (error) {
    if (missingOk && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export async function writeZhihuStudyReport(report: unknown, target: { workspaceRoot: string; readOnly?: boolean }): Promise<{
  directory: string
  markdown: string
  json: string
  html: string
  report: ValidatedStudyReport
  sideEffect: { action: 'create'; workspaceRoot: string; symlinkPolicy: 'reject'; overwritten: false }
}> {
  if (target.readOnly) invalid('当前会话是只读的，不能写入研究报告。')
  if (typeof target.workspaceRoot !== 'string' || !isAbsolute(target.workspaceRoot) || target.workspaceRoot.includes('\0')) {
    invalid('导出需要宿主给出的工作区目录。')
  }
  const rootInfo = await lstat(target.workspaceRoot).catch(() => invalid('工作区目录不存在。'))
  if (!rootInfo || rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) invalid('工作区必须是不含符号链接的真实目录。')
  const root = resolve(target.workspaceRoot)
  const validated = validateZhihuStudyReport(report)
  const payload = JSON.stringify(validated)
  if (payload.length > 200_000) invalid('报告正文超过 20 万字符。')
  const folder = join(root, 'zhihu-study', randomBytes(8).toString('hex'))
  const relativeFolder = relative(root, folder)
  if (relativeFolder.startsWith('..') || isAbsolute(relativeFolder)) invalid('导出目录必须在工作区内。')
  let cursor = root
  for (const part of relativeFolder.split(sep)) {
    cursor = join(cursor, part)
    const info = await rejectSymlink(cursor, true)
    if (info && !info.isDirectory() && cursor !== folder) invalid('导出路径被已有文件挡住。')
  }
  const markdownText = renderStudyMarkdown(validated)
  const htmlText = renderStudyHtml(validated)
  const jsonText = `${JSON.stringify({ version: 1, renderer: 'dsh-zhihu-study', ...(validated.briefing ? { generatedAt: validated.briefing.windowEnd } : {}), report: validated }, null, 2)}\n`
  const files = { markdown: join(folder, 'report.md'), json: join(folder, 'report.json'), html: join(folder, 'report.html') }
  await mkdir(folder, { recursive: true })
  try {
    const created = await lstat(folder)
    if (created.isSymbolicLink() || !created.isDirectory()) invalid('导出目录不能是符号链接。')
    await writeFile(files.markdown, markdownText, { encoding: 'utf8', flag: 'wx' })
    await writeFile(files.json, jsonText, { encoding: 'utf8', flag: 'wx' })
    await writeFile(files.html, htmlText, { encoding: 'utf8', flag: 'wx' })
    for (const file of Object.values(files)) {
      const info = await lstat(file)
      if (info.isSymbolicLink() || !info.isFile()) invalid('导出文件必须是新的普通文件。')
    }
  } catch (error) {
    await rm(folder, { recursive: true, force: true })
    throw error
  }
  return {
    directory: folder, ...files, report: validated,
    sideEffect: { action: 'create', workspaceRoot: root, symlinkPolicy: 'reject', overwritten: false },
  }
}

export function renderZhihuStudyReportResult(result: { html: string }): string {
  return `已生成本地报告，请打开 HTML 查看：${result.html}\n同目录已同步生成 report.md 与 report.json；页面完全离线自包含，所有结论均出自本次模型综合。`
}

const WRITABLE_SANDBOX_MODES = new Set(['workspace-write', 'danger-full-access'])

export function createZhihuStudyReportTool(resolveWorkspace?: (session: unknown) => { workspaceRoot?: string; mode?: string } | undefined) {
  return defineTool({
    name: ZHIHU_STUDY_REPORT_TOOL_NAME,
    description:
      '将包含同一次 zhihu_study 原始 evidence 的综合报告写入当前可写工作区的 zhihu-study 目录，生成本地自包含的 report.html、report.md 与 report.json。' +
      '所有来源字段与 source 数值须与取证结果严格对应，推算与假设单独标明；全程仅执行本地校验与写入。',
    parameters: {
      report: { type: 'object', required: true, description: '综合报告对象，须原样包含同一次 zhihu_study 返回的 evidence 以及引用其中编号的 sources。', additionalProperties: true },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render(_args, value) { return [{ type: 'text' as const, text: renderZhihuStudyReportResult(value as { html: string }) }] },
    },
    isConcurrencySafe() { return false },
    async execute(args, exec) {
      let policy: { workspaceRoot?: string; mode?: string } | undefined
      try { policy = resolveWorkspace?.(exec.agent?.session) } catch { policy = undefined }
      if (!policy?.workspaceRoot || !policy.mode || !WRITABLE_SANDBOX_MODES.has(policy.mode)) {
        throw new ZhihuSearchError('CALL_BLOCKED', '导出需要宿主当前的可写工作区授权；服务缺失、只读或未知模式都不能写文件。')
      }
      const written = await writeZhihuStudyReport((args as { report?: unknown }).report, { workspaceRoot: policy.workspaceRoot })
      return {
        phase: 'report' as const, finishedReport: true, directory: written.directory,
        markdown: written.markdown, json: written.json, html: written.html, sideEffect: written.sideEffect,
      }
    },
  })
}
