/**
 * Human-facing parsers and formatters for Dorothy's chat rows.
 *
 * Session logs store the exact model-facing wake-up prompts and tool results so
 * Dorothy's own reasoning stays deterministic. This module strips prompt-only
 * routing instructions and turns raw notices, tool arguments and tool outcomes
 * into structured data for the browser panel.
 */
import { REMINDER_HEAD, TOOL, type ChatItem } from './contracts.ts'
import { t, toolLabel, type CopyLocale, type TextKey } from './ui-copy.ts'

export interface KnownTaskMeta {
  readonly title: string
  readonly cwd?: string
}

export type TaskLookup = ReadonlyMap<string, KnownTaskMeta>

export interface SessionBadge {
  readonly sessionId: string
  readonly label: string
  readonly tooltip: string
}

export interface QuestionRow {
  readonly id: string
  readonly question: string
  readonly options?: readonly string[]
  readonly multiSelect?: boolean
}

export type NoticeEntry =
  | {
      readonly kind: 'approval' | 'question' | 'turn-end' | 'error' | 'archived'
      readonly sessionId: string
      readonly requestId?: string
      readonly subject?: string
      readonly taskTitle?: string
      readonly cwd?: string
      readonly viaSubagent?: boolean
      readonly permission?: string
      readonly reason?: string
      readonly description?: string
      readonly command?: string
      readonly extraArgs?: readonly { readonly key: string; readonly value: string }[]
      readonly questions?: readonly QuestionRow[]
      readonly summary?: string
    }
  | {
      readonly kind: 'reminder'
      readonly id: string
      readonly title: string
      readonly prompt: string
      readonly due?: string
      readonly next?: string
      readonly once?: boolean
      readonly late?: boolean
    }

export interface ParsedNotice {
  readonly isReminder: boolean
  readonly entries: readonly NoticeEntry[]
  readonly fallback?: string
}

const NOTICE_HEAD = /^\[dot notice\]/i
const REMINDER_PREFIX = /^\[dot reminder\]/i
const MODEL_FOOTER = /^(?:Report what matters to the human,|Do what each one asks now\.)/
const ROUTE_LINE = /^(?:Decide it yourself with dot_answer:|Answer it yourself (?:silently )?with dot_answer\b|Ask the human in this chat\b|The human's own rules, which take precedence\b)/
const SESSION_BULLET = /^- (approval|question|turn-end|error|archived)\s*·\s*([^:]+):\s*(.*)$/
const REMINDER_BULLET = /^- (\S+)\s+"([^"]+)"\s*\(([^)]*)\):\s*(.*)$/
const REQUEST_HEAD = /^(\S+)\s*·\s*(?:approval|question) from (?:task "(.+?)"|untracked session(?: in (.+?))?)\s*·\s*"(.*)"$/
const TURN_END_HEAD = /^"(.+?)" finished a turn:\s*(.*)$/
const QUESTION_LINE = /^\[([^\]]+)\]\s*(.*)$/
const ESCALATE_PREFIX = /^escalate sandbox to ([a-z0-9_-]+)(?::\s*(.*))?$/i

const IGNORED_SHELL_KEYS = new Set([
  'command', 'cmd', 'description', 'justification', 'sandbox_permissions',
  'workdir', 'cwd', 'login', 'shell', 'tty', 'yield_time_ms', 'max_output_tokens', 'prefix_rule',
  'path', 'file_path', 'url',
])

/** Last segment of a Windows or POSIX directory path. */
export function folderName(path: string | undefined): string | undefined {
  const clean = path?.trim()
  if (!clean) return undefined
  const trimmed = clean.replace(/[\\/]+$/, '')
  if (!trimmed || /^[a-zA-Z]:$/.test(trimmed)) return clean
  const parts = trimmed.split(/[\\/]/)
  return parts.at(-1) || clean
}

export function shortSessionId(sessionId: string): string {
  const clean = sessionId.trim()
  if (clean.startsWith('session-') && clean.length > 16) return `#${clean.slice(8, 14)}`
  return clean.length > 14 ? `#${clean.slice(0, 6)}` : clean
}

export function resolveSessionBadge(
  sessionId: string,
  tasks: TaskLookup,
  hints?: { readonly taskTitle?: string; readonly cwd?: string },
): SessionBadge {
  const known = tasks.get(sessionId)
  const title = hints?.taskTitle?.trim() || known?.title?.trim()
  const cwd = hints?.cwd?.trim() || known?.cwd?.trim()
  if (title && title !== sessionId) {
    return { sessionId, label: title, tooltip: cwd ? `${title} · ${cwd}` : title }
  }
  const folder = folderName(cwd)
  if (folder) {
    return { sessionId, label: folder, tooltip: cwd! }
  }
  return { sessionId, label: shortSessionId(sessionId), tooltip: sessionId }
}

export function permissionLabel(locale: CopyLocale, raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const norm = raw.trim().toLowerCase()
  if (norm === 'danger-full-access' || norm === 'full-access' || norm === 'require_escalated') return t(locale, 'permFullAccess')
  if (norm === 'workspace-write') return t(locale, 'permWorkspaceWrite')
  if (norm === 'read-only') return t(locale, 'permReadOnly')
  if (norm === 'use_default' || norm === 'default' || norm === 'inherit') return undefined
  return raw
}

/** Unescape a JSON string body, tolerating a string cut off by `clip()` at the end. */
function unescapeJsonString(raw: string): string {
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!
    if (ch !== '\\' || i + 1 >= raw.length) { out += ch; continue }
    const next = raw[++i]!
    if (next === 'n') out += '\n'
    else if (next === 'r') out += '\r'
    else if (next === 't') out += '\t'
    else if (next === '"' || next === '\\' || next === '/') out += next
    else if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(raw.slice(i + 1, i + 5))) {
      out += String.fromCharCode(parseInt(raw.slice(i + 1, i + 5), 16))
      i += 4
    } else out += next
  }
  return out
}

/** Parse JSON arguments, salvaging top-level fields even when `clip()` truncated the tail. */
export function extractJsonFields(raw: string): Record<string, unknown> | undefined {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{')) return undefined
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch { /* fall through to tolerant field scan */ }

  const out: Record<string, unknown> = {}
  const keyRe = /"((?:\\.|[^"\\])*)"\s*:\s*/g
  let match: RegExpExecArray | null
  while ((match = keyRe.exec(trimmed)) !== null) {
    const key = unescapeJsonString(match[1]!)
    let pos = keyRe.lastIndex
    while (pos < trimmed.length && /\s/.test(trimmed[pos]!)) pos++
    const lead = trimmed[pos]
    if (lead === '"') {
      let end = pos + 1
      while (end < trimmed.length) {
        if (trimmed[end] === '\\') { end += 2; continue }
        if (trimmed[end] === '"') break
        end++
      }
      out[key] = unescapeJsonString(trimmed.slice(pos + 1, end))
      keyRe.lastIndex = Math.min(trimmed.length, end + 1)
    } else {
      const prim = /^(true|false|null|-?\d+(?:\.\d+)?)/.exec(trimmed.slice(pos))
      if (!prim) continue
      const token = prim[1]!
      out[key] = token === 'true' ? true : token === 'false' ? false : token === 'null' ? null : Number(token)
      keyRe.lastIndex = pos + token.length
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function strOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function mergeReason(primary: string | undefined, secondary: string | undefined): string | undefined {
  const a = primary?.trim()
  const b = secondary?.trim()
  if (!a) return b
  if (!b) return a
  const normA = a.replace(/[。.!！\s]+$/g, '')
  const normB = b.replace(/[。.!！\s]+$/g, '')
  if (normA === normB || normA.includes(normB)) return a
  if (normB.includes(normA)) return b
  return `${a} — ${b}`
}

function parseApprovalDetail(rawDetail: string): {
  viaSubagent?: boolean
  permission?: string
  reason?: string
  description?: string
  command?: string
  cwd?: string
  extraArgs?: readonly { readonly key: string; readonly value: string }[]
  fallback?: string
} {
  let rest = rawDetail.trim()
  let argsText: string | undefined
  const argsMatch = /^(.*?)(?:^|\s)arguments:\s*(\{[\s\S]*)$/i.exec(rest)
  if (argsMatch) {
    rest = argsMatch[1]!.trim()
    argsText = argsMatch[2]!.trim()
  }

  let viaSubagent = false
  rest = rest.replace(/\basked by subagent\s+\S+/gi, () => { viaSubagent = true; return '' }).trim()

  let permission: string | undefined
  let cleanReason: string | undefined
  const reasonMatch = /^reason:\s*([\s\S]+)$/i.exec(rest)
  if (reasonMatch) {
    const body = reasonMatch[1]!.trim()
    const esc = ESCALATE_PREFIX.exec(body)
    if (esc) {
      permission = esc[1]
      cleanReason = esc[2]?.trim() || undefined
    } else {
      cleanReason = body
    }
  } else if (rest) {
    cleanReason = rest
  }

  const parsedArgs = argsText ? extractJsonFields(argsText) : undefined
  if (!parsedArgs) {
    return {
      ...viaSubagent ? { viaSubagent: true } : {},
      ...permission ? { permission } : {},
      ...cleanReason ? { reason: cleanReason } : {},
      ...argsText && !cleanReason ? { fallback: argsText } : {},
    }
  }

  const argPerm = strOf(parsedArgs.sandbox_permissions)
  if (argPerm) permission = argPerm
  const justification = strOf(parsedArgs.justification)
  const reason = mergeReason(cleanReason, justification)
  const command = strOf(parsedArgs.command) ?? strOf(parsedArgs.cmd) ?? strOf(parsedArgs.path) ?? strOf(parsedArgs.file_path) ?? strOf(parsedArgs.url)
  const rawDesc = strOf(parsedArgs.description)
  const description = rawDesc && rawDesc !== reason && rawDesc !== command ? rawDesc : undefined
  const cwd = strOf(parsedArgs.workdir) ?? strOf(parsedArgs.cwd)

  const extra: { key: string; value: string }[] = []
  for (const [key, value] of Object.entries(parsedArgs)) {
    if (IGNORED_SHELL_KEYS.has(key) || value === undefined || value === null || value === '') continue
    const formatted = typeof value === 'string' ? value : JSON.stringify(value)
    if (formatted) extra.push({ key, value: formatted.length > 120 ? formatted.slice(0, 120) + '…' : formatted })
  }

  return {
    ...viaSubagent ? { viaSubagent: true } : {},
    ...permission ? { permission } : {},
    ...reason ? { reason } : {},
    ...description ? { description } : {},
    ...command ? { command } : {},
    ...cwd ? { cwd } : {},
    ...extra.length > 0 ? { extraArgs: extra } : {},
  }
}

function parseQuestionLine(line: string): QuestionRow | undefined {
  const match = QUESTION_LINE.exec(line.trim())
  if (!match) return undefined
  const id = match[1]!.trim()
  let rest = match[2]!.trim()
  let multiSelect = false
  if (rest.endsWith('(multi)')) {
    multiSelect = true
    rest = rest.slice(0, -'(multi)'.length).trim()
  }
  let options: string[] | undefined
  const optIdx = rest.indexOf(' options: ')
  if (optIdx >= 0) {
    const rawOpts = rest.slice(optIdx + ' options: '.length).trim()
    rest = rest.slice(0, optIdx).trim()
    options = rawOpts.split('|').map(item => item.trim()).filter(Boolean)
  }
  return {
    id,
    question: rest,
    ...options && options.length > 0 ? { options } : {},
    ...multiSelect ? { multiSelect: true } : {},
  }
}

function shortStamp(stamp: string): string {
  // "2026-11-11 21:30" -> "21:30" or keep compact text as-is.
  const m = /^\d{4}-(\d{2}-\d{2})\s+(\d{2}:\d{2})$/.exec(stamp.trim())
  return m ? m[2]! : stamp.trim()
}

function parseReminderFacts(facts: string): { due?: string; next?: string; once?: boolean; late?: boolean } {
  const parts = facts.split(';').map(part => part.trim()).filter(Boolean)
  let due: string | undefined
  let next: string | undefined
  let once = false
  let late = false
  for (const part of parts) {
    if (part === 'once' || part === 'now removed') once = true
    else if (part.startsWith('due ')) {
      const lateFlag = part.includes('delivered late')
      if (lateFlag) late = true
      due = shortStamp(part.slice(4).replace(/,\s*delivered late/i, ''))
    } else if (part.startsWith('next ')) {
      next = shortStamp(part.slice(5))
    }
  }
  return { ...due ? { due } : {}, ...next ? { next } : {}, ...once ? { once: true } : {}, ...late ? { late: true } : {} }
}

/** Parse a logged `[dot notice]` or `[dot reminder]` message into UI entries. */
export function parseNotice(text: string): ParsedNotice {
  const isReminder = text.trimStart().startsWith(REMINDER_HEAD)
  const lines = text.split(/\r?\n/)
  let section: 'notice' | 'reminder' = isReminder ? 'reminder' : 'notice'
  const rawItems: { section: 'notice' | 'reminder'; head: string; sublines: string[] }[] = []
  const stray: string[] = []
  let skippingPolicy = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) { skippingPolicy = false; continue }
    if (NOTICE_HEAD.test(trimmed)) {
      section = 'notice'
      skippingPolicy = false
      const inline = trimmed.replace(/^\[dot notice\]\s*(?:Updates from other sessions:)?\s*/i, '').trim()
      if (inline) stray.push(inline)
      continue
    }
    if (REMINDER_PREFIX.test(trimmed)) {
      section = 'reminder'
      skippingPolicy = false
      const inline = trimmed.replace(/^\[dot reminder\]\s*(?:Reminders you set for yourself are due:)?\s*/i, '').trim()
      if (inline) stray.push(inline)
      continue
    }
    if (MODEL_FOOTER.test(trimmed)) { skippingPolicy = false; continue }
    if (line.startsWith('- ')) {
      skippingPolicy = false
      rawItems.push({ section, head: line, sublines: [] })
      continue
    }
    if (line.startsWith('  ') && rawItems.length > 0) {
      if (skippingPolicy && trimmed.startsWith('>')) continue
      skippingPolicy = false
      if (ROUTE_LINE.test(trimmed)) {
        if (trimmed.startsWith("The human's own rules")) skippingPolicy = true
        continue
      }
      rawItems.at(-1)!.sublines.push(line.slice(2))
      continue
    }
    stray.push(trimmed)
  }

  const entries: NoticeEntry[] = []
  for (const item of rawItems) {
    if (item.section === 'reminder') {
      const m = REMINDER_BULLET.exec(item.head)
      if (m) {
        const promptLines = [m[4]!, ...item.sublines].join('\n').trim()
        entries.push({
          kind: 'reminder',
          id: m[1]!,
          title: m[2]!,
          prompt: promptLines,
          ...parseReminderFacts(m[3]!),
        })
        continue
      }
    }
    const sm = SESSION_BULLET.exec(item.head)
    if (!sm) {
      stray.push([item.head.replace(/^- /, ''), ...item.sublines].join('\n').trim())
      continue
    }
    const kind = sm[1] as 'approval' | 'question' | 'turn-end' | 'error' | 'archived'
    const sessionId = sm[2]!.trim()
    const headline = sm[3]!.trim()

    if (kind === 'approval' || kind === 'question') {
      const req = REQUEST_HEAD.exec(headline)
      const requestId = req?.[1]
      const taskTitle = req?.[2]
      const whereCwd = req?.[3]
      const subject = req?.[4] ?? headline

      let detailInfo: ReturnType<typeof parseApprovalDetail> = {}
      const questions: QuestionRow[] = []
      for (const sub of item.sublines) {
        const subTrim = sub.trim()
        if (subTrim.startsWith('detail:')) {
          detailInfo = parseApprovalDetail(subTrim.slice('detail:'.length))
        } else if (subTrim.startsWith('[')) {
          const q = parseQuestionLine(subTrim)
          if (q) questions.push(q)
        }
      }
      const cwd = whereCwd ?? detailInfo.cwd
      entries.push({
        kind,
        sessionId,
        ...requestId ? { requestId } : {},
        subject,
        ...taskTitle ? { taskTitle } : {},
        ...cwd ? { cwd } : {},
        ...detailInfo.viaSubagent ? { viaSubagent: true } : {},
        ...detailInfo.permission ? { permission: detailInfo.permission } : {},
        ...detailInfo.reason ? { reason: detailInfo.reason } : {},
        ...detailInfo.description ? { description: detailInfo.description } : {},
        ...detailInfo.command ? { command: detailInfo.command } : {},
        ...detailInfo.extraArgs ? { extraArgs: detailInfo.extraArgs } : {},
        ...questions.length > 0 ? { questions } : {},
        ...detailInfo.fallback ? { summary: detailInfo.fallback } : {},
      })
      continue
    }

    if (kind === 'turn-end') {
      const tm = TURN_END_HEAD.exec(headline)
      if (tm) {
        entries.push({ kind, sessionId, taskTitle: tm[1]!, summary: tm[2]!.trim() })
      } else {
        entries.push({ kind, sessionId, summary: headline })
      }
      continue
    }

    entries.push({ kind, sessionId, summary: headline })
  }

  const fallback = entries.length === 0 ? (stray.join('\n').trim() || text.trim()) : undefined
  return { isReminder, entries, ...fallback ? { fallback } : {} }
}

/** One-line collapsed preview beside "收到会话动态" / "提醒到点". */
export function summarizeNotice(parsed: ParsedNotice, locale: CopyLocale, tasks: TaskLookup): string | undefined {
  const first = parsed.entries[0]
  if (!first) return parsed.fallback ? clipInline(parsed.fallback, 48) : undefined
  let lead: string
  if (first.kind === 'reminder') {
    lead = first.title
  } else {
    const badge = resolveSessionBadge(first.sessionId, tasks, {
      ...first.taskTitle ? { taskTitle: first.taskTitle } : {},
      ...first.cwd ? { cwd: first.cwd } : {},
    })
    if (first.kind === 'approval') {
      lead = [t(locale, 'approval'), first.subject, badge.label].filter(Boolean).join(' · ')
    } else if (first.kind === 'question') {
      lead = [t(locale, 'question'), badge.label].filter(Boolean).join(' · ')
    } else if (first.kind === 'turn-end') {
      lead = `${badge.label} · ${t(locale, 'turnEnd')}`
    } else if (first.kind === 'error') {
      lead = `${badge.label} · ${t(locale, 'error')}`
    } else {
      lead = `${badge.label} · ${t(locale, 'archived')}`
    }
  }
  if (parsed.entries.length > 1) {
    return `${lead} · ${t(locale, 'moreUpdates').replace('{n}', String(parsed.entries.length))}`
  }
  return lead
}

function clipInline(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : flat.slice(0, max - 1) + '…'
}

type ToolItem = Extract<ChatItem, { kind: 'tool' }>

const UNKNOWN_REQ_RE = /^Error \[dot\/unknown-request\]:\s*no waiting request (\S+)/
const GENERIC_ERR_RE = /^Error \[([^\]]+)\]:\s*([\s\S]*)$/
const ANSWERED_RE = /^Answered (\S+) for ([^.\s]+)\.?$/
const DELIVERED_RE = /^Delivered to ([^.\s]+)\.?$/
const WATCHING_RE = /^Watching ([^.\s]+)\.?$/
const ARCHIVED_RE = /^Archived ([^.\s]+)\.?$/
const STOPPED_RE = /^Stopped the current turn of ([^;\s]+);/
const STARTED_TASK_RE = /^Started task (\S+)\s+"([^"]+)"(?:\s+in\s+([^\s.]+))?/
const OVERVIEW_ROW_RE = /^- (\S+)\s+(RUNNING|idle)\s+"([^"]*)"\s+cwd=(.*?)(?:\s+·\s+tracked)?$/gm
const WORKSPACE_ROW_RE = /^- (\S+)\s+"([^"]+)"\s+(\S+)\s+\((\d+)\s+session\(s\)\)/gm
const DOT_READ_RE = /^([\s\S]*?)\r?\n-{2,3}\s*latest reply\s*-{2,3}\r?\n([\s\S]*)$/
const DOT_READ_HEAD_RE = /^(RUNNING|IDLE|BLOCKED|ERROR|ARCHIVED)\s+"([\s\S]+?)"(?:\s+goal:\s*[\s\S]*)?$/i
const AGENT_HINT_CLAUSE_RE = /;\s*(?:omit\b|pass\b|leave\b|reuse\b|use\b|dot_\w+|only the human\b|tell them\b|ask the human\b)[\s\S]*$/i
const TOOL_CALL_DUMP_RE = /^([a-z][a-z0-9_]{1,63})\r?\n(\{[\s\S]*)$/

export interface ToolCallSummary {
  readonly summary?: string
  readonly tone?: 'normal' | 'muted' | 'error'
  readonly sessionId?: string
}

function cleanErrorText(raw: string): string {
  const stripped = raw.trim().replace(AGENT_HINT_CLAUSE_RE, '').trim()
  return stripped || raw.trim()
}

function extractFailureMessage(detail: string): { readonly message: string; readonly muted?: boolean } | undefined {
  if (!detail) return undefined
  if (UNKNOWN_REQ_RE.test(detail)) return undefined
  const err = GENERIC_ERR_RE.exec(detail)
  if (err) return { message: cleanErrorText(err[2] || detail) }
  if (detail.startsWith('{')) {
    const fields = extractJsonFields(detail)
    if (fields && (fields.status === 'failed' || fields.status === 'error' || fields.status === 'disabled' || fields.ok === false)) {
      const msg = strOf(fields.message) ?? strOf(fields.error) ?? strOf(fields.code) ?? detail
      return { message: cleanErrorText(msg), ...fields.status === 'disabled' ? { muted: true } : {} }
    }
  }
  return undefined
}

interface ParsedSessionItem {
  readonly sessionId?: string
  readonly title?: string
  readonly cwd?: string
  readonly live?: boolean
}

/** Parse `{status:'ok', items:[...]}` from session-manager tools, salvaging items even when clipped. */
function parseSessionListOutcome(raw: string): { readonly items: readonly ParsedSessionItem[]; readonly hasMore: boolean } | undefined {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{')) return undefined
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    if (parsed.status === 'ok' && Array.isArray(parsed.items)) {
      const items = parsed.items
        .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
        .map(row => ({
          ...strOf(row.sessionId) ? { sessionId: strOf(row.sessionId)! } : {},
          ...strOf(row.title) ? { title: strOf(row.title)! } : {},
          ...strOf(row.cwd) ? { cwd: strOf(row.cwd)! } : {},
          ...typeof row.live === 'boolean' ? { live: row.live } : {},
        }))
      return { items, hasMore: Boolean(parsed.nextCursor) }
    }
  } catch { /* fall through to tolerant scan for clipped JSON */ }

  const head = /"items"\s*:\s*\[/.exec(trimmed)
  if (!head) return undefined
  const items: ParsedSessionItem[] = []
  let pos = head.index + head[0].length
  let hasMore = trimmed.endsWith('…')
  while (pos < trimmed.length) {
    while (pos < trimmed.length && /[\s,]/.test(trimmed[pos]!)) pos++
    if (pos >= trimmed.length || trimmed[pos] === ']') break
    if (trimmed[pos] !== '{') { hasMore = true; break }
    let depth = 0
    let inStr = false
    let end = pos
    for (; end < trimmed.length; end++) {
      const ch = trimmed[end]!
      if (inStr) {
        if (ch === '\\') { end++; continue }
        if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') inStr = true
      else if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) { end++; break }
      }
    }
    const fields = extractJsonFields(trimmed.slice(pos, end))
    if (fields) {
      items.push({
        ...strOf(fields.sessionId) ? { sessionId: strOf(fields.sessionId)! } : {},
        ...strOf(fields.title) ? { title: strOf(fields.title)! } : {},
        ...strOf(fields.cwd) ? { cwd: strOf(fields.cwd)! } : {},
        ...typeof fields.live === 'boolean' ? { live: fields.live } : {},
      })
    }
    if (depth !== 0) { hasMore = true; break }
    pos = end
  }
  if (/"nextCursor"\s*:\s*"/.test(trimmed)) hasMore = true
  return { items, hasMore }
}

function parseDotRead(raw: string): { readonly taskTitle?: string; readonly reply: string; readonly noReply: boolean } | undefined {
  const m = DOT_READ_RE.exec(raw.trim())
  if (!m) return undefined
  const head = m[1]!.trim()
  const reply = m[2]!.trim()
  const headMatch = DOT_READ_HEAD_RE.exec(head)
  const taskTitle = headMatch?.[2]?.trim()
  const noReply = !reply || reply === '(no reply yet)'
  return { ...taskTitle ? { taskTitle } : {}, reply: noReply ? '' : reply, noReply }
}

function formatEmbeddedToolReply(reply: string, locale: CopyLocale): string | undefined {
  const m = TOOL_CALL_DUMP_RE.exec(reply)
  if (!m) return undefined
  const label = toolLabel(locale, m[1]!)
  const fields = extractJsonFields(m[2]!)
  if (!fields) return label
  const concise = Object.entries(fields)
    .filter(([k, v]) => v !== null && v !== undefined && !k.endsWith('_id') && k !== 'id' && k !== 'sessionId')
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${String(v)}`)
  return concise.length > 0 ? `${label}（${concise.join(', ')}）` : label
}

/** Concise target/argument summary shown beside a tool call's name. */
export function summarizeToolCall(item: ToolItem, locale: CopyLocale, tasks: TaskLookup): ToolCallSummary {
  const args = item.args ?? {}
  const detail = item.detail?.trim() ?? ''
  const failure = extractFailureMessage(detail)
  if (failure) {
    return {
      summary: clipInline(failure.message, 48),
      tone: failure.muted ? 'muted' : 'error',
    }
  }
  if (item.status === 'error' && detail) {
    return { summary: clipInline(cleanErrorText(detail), 48), tone: 'error' }
  }

  switch (item.name) {
    case TOOL.answerPending: {
      const race = UNKNOWN_REQ_RE.exec(detail)
      const answered = ANSWERED_RE.exec(detail)
      const id = strOf(args.id) ?? race?.[1] ?? answered?.[1]
      if (race) return { summary: [id, t(locale, 'alreadyHandled')].filter(Boolean).join(' · '), tone: 'muted' }
      if (typeof args.allow === 'boolean') {
        return { summary: [id, t(locale, args.allow ? 'decisionApprove' : 'decisionDecline')].filter(Boolean).join(' · ') }
      }
      if (Array.isArray(args.answers)) {
        return { summary: [id, t(locale, 'decisionAnswer')].filter(Boolean).join(' · ') }
      }
      return id ? { summary: id } : {}
    }
    case TOOL.startTask: {
      const title = strOf(args.title)
      return title ? { summary: clipInline(title, 44) } : {}
    }
    case TOOL.read: {
      const sid = strOf(args.session_id)
      const parsed = detail ? parseDotRead(detail) : undefined
      const badge = sid
        ? resolveSessionBadge(sid, tasks, parsed?.taskTitle ? { taskTitle: parsed.taskTitle } : undefined)
        : undefined
      if (parsed?.noReply) {
        const parts = [badge?.label, t(locale, 'noReplyYet')].filter(Boolean)
        return { summary: parts.join(' · '), tone: 'muted', ...sid ? { sessionId: sid } : {} }
      }
      if (parsed?.reply && !TOOL_CALL_DUMP_RE.test(parsed.reply) && !parsed.reply.startsWith('{')) {
        const firstLine = parsed.reply.split(/\r?\n/).find(line => line.trim())?.trim()
        if (firstLine) {
          const parts = [badge?.label, clipInline(firstLine, 32)].filter(Boolean)
          return { summary: parts.join(' · '), ...sid ? { sessionId: sid } : {} }
        }
      }
      return badge ? { summary: badge.label, sessionId: sid! } : {}
    }
    case TOOL.interruptSession:
    case TOOL.archiveSession:
    case TOOL.readHistory:
    case 'read_session':
    case 'send_session_message': {
      const sid = strOf(args.session_id)
      if (!sid) return {}
      const label = resolveSessionBadge(sid, tasks).label
      if (item.name === 'send_session_message') {
        const msg = strOf(args.message)
        return { summary: [label, msg ? clipInline(msg, 28) : undefined].filter(Boolean).join(' · '), sessionId: sid }
      }
      return { summary: label, sessionId: sid }
    }
    case 'list_sessions':
    case 'search_sessions': {
      const query = strOf(args.query)
      const folder = folderName(strOf(args.cwd))
      const scopeHint = query ? clipInline(query, 24) : folder
      const parsed = detail ? parseSessionListOutcome(detail) : undefined
      if (!parsed) return scopeHint ? { summary: scopeHint } : {}
      if (parsed.items.length === 0 && !parsed.hasMore) {
        return {
          summary: [scopeHint, t(locale, 'noSessionsFound')].filter(Boolean).join(' · '),
          tone: 'muted',
        }
      }
      const countText = t(locale, parsed.hasMore ? 'sessionsFoundMore' : 'sessionsFound')
        .replace('{n}', String(parsed.items.length))
      return { summary: [scopeHint, countText].filter(Boolean).join(' · ') }
    }
    case 'fork_session': {
      const prompt = strOf(args.prompt)
      return prompt ? { summary: clipInline(prompt, 42) } : {}
    }
    case TOOL.overview: {
      if (!detail) return {}
      const matches = [...detail.matchAll(OVERVIEW_ROW_RE)]
      if (matches.length > 0) {
        return { summary: t(locale, 'activeSessionsCount').replace('{n}', String(matches.length)) }
      }
      if (detail.includes('[all sessions')) {
        return { summary: t(locale, 'noActiveSessions'), tone: 'muted' }
      }
      return {}
    }
    case TOOL.workspace: {
      const action = strOf(args.action)
      if (action === 'create') {
        const label = strOf(args.title) ?? folderName(strOf(args.path))
        return label ? { summary: clipInline(label, 40) } : {}
      }
      // list
      if (!detail) return {}
      const matches = [...detail.matchAll(WORKSPACE_ROW_RE)]
      if (matches.length > 0) {
        return { summary: t(locale, 'workspacesCount').replace('{n}', String(matches.length)) }
      }
      if (/^No workspaces yet\b/i.test(detail)) {
        return { summary: t(locale, 'noWorkspaces'), tone: 'muted' }
      }
      return {}
    }
    case TOOL.watchSession: {
      const sid = strOf(args.session_id)
      const title = strOf(args.title)
      if (title) return { summary: clipInline(title, 44), ...sid ? { sessionId: sid } : {} }
      if (sid) return { summary: resolveSessionBadge(sid, tasks).label, sessionId: sid }
      return {}
    }
    case TOOL.sendToSession: {
      const sid = strOf(args.session_id)
      const msg = strOf(args.message)
      const target = sid ? resolveSessionBadge(sid, tasks).label : undefined
      const parts = [target, msg ? clipInline(msg, 32) : undefined].filter(Boolean)
      return { ...parts.length > 0 ? { summary: parts.join(' · ') } : {}, ...sid ? { sessionId: sid } : {} }
    }
    case TOOL.schedule: {
      const action = strOf(args.action)
      if (action === 'add') {
        const title = strOf(args.title)
        return title ? { summary: clipInline(title, 40) } : {}
      }
      if (action === 'remove') {
        const id = strOf(args.id)
        return id ? { summary: id } : {}
      }
      return {}
    }
    case TOOL.searchHistory:
    case 'dsh_docs':
    case 'dsh_plugins':
    case 'zhihu_research': {
      const q = strOf(args.query) ?? strOf(args.q) ?? strOf(args.pattern)
      return q ? { summary: clipInline(q, 42) } : {}
    }
    case TOOL.remember:
    case TOOL.forget: {
      const text = strOf(args.text)
      return text ? { summary: clipInline(text, 42) } : {}
    }
    case TOOL.newSegment: {
      const focus = strOf(args.focus)
      return focus ? { summary: clipInline(focus, 42) } : {}
    }
    case TOOL.proposeSettings: {
      const field = strOf(args.field)
      if (!field) return {}
      const key = `field_${field}` as TextKey
      const label = key.startsWith('field_') ? (() => { try { return t(locale, key) } catch { return field } })() : field
      return { summary: label || field }
    }
    default:
      return {}
  }
}

/** Collapsed preview for a group of multiple tool calls. */
export function summarizeToolGroup(items: readonly ToolItem[], locale: CopyLocale, tasks: TaskLookup): string | undefined {
  if (items.length === 0) return undefined
  if (items.length === 1) return summarizeToolCall(items[0]!, locale, tasks).summary
  const allSame = items.every(item => item.name === items[0]!.name)
  if (allSame) {
    const parts = items.map(item => summarizeToolCall(item, locale, tasks).summary).filter((v): v is string => Boolean(v))
    return parts.length > 0 ? clipInline(parts.join(', '), 56) : undefined
  }
  const names: string[] = []
  for (const item of items) {
    const label = toolLabel(locale, item.name)
    if (names.at(-1) !== label) names.push(label)
  }
  return clipInline(names.join(' → '), 56)
}

export interface FormattedToolDetail {
  readonly tone: 'normal' | 'muted' | 'error'
  readonly text: string
  readonly session?: SessionBadge
  readonly multiline?: boolean
}

/** Turn a tool's raw result string into human copy without exposing internal prefixes or UUIDs. */
export function formatToolDetail(item: ToolItem, locale: CopyLocale, tasks: TaskLookup): FormattedToolDetail | undefined {
  const raw = item.detail?.trim()
  if (!raw) return undefined
  if (UNKNOWN_REQ_RE.test(raw)) {
    return { tone: 'muted', text: t(locale, 'alreadyHandledDetail') }
  }
  const failure = extractFailureMessage(raw)
  if (failure) {
    return { tone: failure.muted ? 'muted' : 'error', text: failure.message }
  }
  const answered = ANSWERED_RE.exec(raw)
  if (answered) {
    const badge = resolveSessionBadge(answered[2]!, tasks)
    return {
      tone: 'normal',
      text: t(locale, 'toolAnswered').replace('{id}', answered[1]!).replace('{target}', badge.label),
      session: badge,
    }
  }
  const singleSession: readonly [RegExp, 'toolDelivered' | 'toolWatching' | 'toolArchived' | 'toolInterrupted'][] = [
    [DELIVERED_RE, 'toolDelivered'],
    [WATCHING_RE, 'toolWatching'],
    [ARCHIVED_RE, 'toolArchived'],
    [STOPPED_RE, 'toolInterrupted'],
  ]
  for (const [re, key] of singleSession) {
    const m = re.exec(raw)
    if (m) {
      const badge = resolveSessionBadge(m[1]!, tasks)
      return { tone: 'normal', text: t(locale, key).replace('{target}', badge.label), session: badge }
    }
  }
  const started = STARTED_TASK_RE.exec(raw)
  if (started) {
    const sid = started[1]!
    const title = started[2]!
    const cwd = started[3]
    const badge = resolveSessionBadge(sid, tasks, { taskTitle: title, ...cwd ? { cwd } : {} })
    const folder = folderName(cwd)
    const text = [t(locale, 'toolStartedTask').replace('{title}', title), folder].filter(Boolean).join(' · ')
    return { tone: 'normal', text, session: badge }
  }
  if (/^A fresh segment will start when this turn ends\b/.test(raw)) {
    return { tone: 'normal', text: t(locale, 'segmentScheduled') }
  }
  if (item.name === TOOL.read) {
    const parsed = parseDotRead(raw)
    if (parsed) {
      const sid = strOf(item.args?.session_id)
      const session = sid
        ? resolveSessionBadge(sid, tasks, parsed.taskTitle ? { taskTitle: parsed.taskTitle } : undefined)
        : undefined
      if (parsed.noReply) {
        return { tone: 'muted', text: t(locale, 'noReplyYet'), ...session ? { session } : {} }
      }
      const embeddedTool = formatEmbeddedToolReply(parsed.reply, locale)
      const text = embeddedTool ?? parsed.reply
      return {
        tone: 'normal',
        text,
        ...session ? { session } : {},
        ...text.includes('\n') || text.length > 96 ? { multiline: true } : {},
      }
    }
  }
  if (item.name === 'list_sessions' || item.name === 'search_sessions') {
    const parsed = parseSessionListOutcome(raw)
    if (parsed) {
      if (parsed.items.length === 0 && !parsed.hasMore) {
        return { tone: 'muted', text: t(locale, 'noSessionsFound') }
      }
      const lines = parsed.items.map(entry => {
        const title = entry.title ? clipInline(entry.title, 72) : entry.sessionId ? shortSessionId(entry.sessionId) : t(locale, 'untitledSession')
        const folder = folderName(entry.cwd)
        return folder ? `• ${title}（${folder}）` : `• ${title}`
      })
      const text = lines.join('\n')
      return { tone: 'normal', text, ...lines.length > 1 ? { multiline: true } : {} }
    }
  }
  if (item.name === TOOL.overview) {
    const matches = [...raw.matchAll(OVERVIEW_ROW_RE)]
    if (matches.length > 0) {
      const lines = matches.map(m => {
        const running = m[2] === 'RUNNING'
        const title = m[3]?.trim() || shortSessionId(m[1]!)
        const folder = folderName(m[4]?.trim() === '?' ? undefined : m[4]?.trim())
        const parts = [title, folder, running ? t(locale, 'running') : undefined].filter(Boolean)
        return `• ${parts.join(' · ')}`
      })
      return { tone: 'normal', text: lines.join('\n'), ...lines.length > 1 ? { multiline: true } : {} }
    }
    if (raw.includes('[all sessions')) {
      return { tone: 'muted', text: t(locale, 'noActiveSessions') }
    }
  }
  if (item.name === TOOL.workspace) {
    if (strOf(item.args?.action) !== 'list') {
      // create result handled by generic formatter above
    } else if (/^No workspaces yet\b/i.test(raw)) {
      return { tone: 'muted', text: t(locale, 'noWorkspaces') }
    } else {
      const matches = [...raw.matchAll(WORKSPACE_ROW_RE)]
      if (matches.length > 0) {
        const lines = matches.map(m => `• ${m[2]!} · ${m[3]!}`)
        return { tone: 'normal', text: lines.join('\n'), ...lines.length > 1 ? { multiline: true } : {} }
      }
    }
  }
  if (raw.startsWith('{')) {
    const formatted = formatGenericJsonOutcome(raw, item, locale, tasks)
    if (formatted) return formatted
  }
  return {
    tone: item.status === 'error' ? 'error' : 'normal',
    text: raw,
    ...raw.includes('\n') || raw.length > 96 ? { multiline: true } : {},
  }
}

function formatGenericJsonOutcome(raw: string, item: ToolItem, locale: CopyLocale, tasks: TaskLookup): FormattedToolDetail | undefined {
  const sid = strOf(item.args?.session_id)
  const session = sid ? resolveSessionBadge(sid, tasks) : undefined
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    if (item.name === 'send_session_message' && parsed.status === 'ok' && session) {
      return { tone: 'normal', text: t(locale, 'toolDelivered').replace('{target}', session.label), session }
    }
    if (item.name === 'read_session' && parsed.status === 'ok') {
      const summary = strOf(parsed.summary)
      if (summary) return { tone: 'normal', text: summary, ...session ? { session } : {}, multiline: summary.includes('\n') || summary.length > 96 }
      if (Array.isArray(parsed.turns)) {
        const lines = parsed.turns
          .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
          .map(turn => {
            const req = strOf(turn.request)
            const res = strOf(turn.response)
            return [req ? `› ${clipInline(req, 80)}` : undefined, res ? `  ${clipInline(res, 100)}` : undefined].filter(Boolean).join('\n')
          })
          .filter(Boolean)
        const text = lines.length > 0 ? lines.join('\n') : t(locale, 'turnsRead').replace('{n}', String(parsed.turns.length))
        return { tone: 'normal', text, ...session ? { session } : {}, ...lines.length > 0 ? { multiline: true } : {} }
      }
    }
    const summaryText = strOf(parsed.summary) ?? strOf(parsed.message)
    if (summaryText) {
      return { tone: 'normal', text: summaryText, ...session ? { session } : {}, ...summaryText.includes('\n') ? { multiline: true } : {} }
    }
  } catch { /* clipped JSON falls through to field salvage */ }

  const fields = extractJsonFields(raw)
  if (!fields) return undefined
  const summaryText = strOf(fields.summary) ?? strOf(fields.message)
  if (summaryText) {
    return { tone: item.status === 'error' ? 'error' : 'normal', text: summaryText, ...session ? { session } : {} }
  }
  const lines = Object.entries(fields)
    .filter(([k, v]) => v !== null && v !== undefined && k !== 'status' && k !== 'nextCursor' && k !== 'cursor')
    .slice(0, 6)
    .map(([k, v]) => `${k}: ${String(v)}`)
  if (lines.length > 0) {
    return { tone: item.status === 'error' ? 'error' : 'normal', text: lines.join('\n'), ...session ? { session } : {}, ...lines.length > 1 ? { multiline: true } : {} }
  }
  return undefined
}
