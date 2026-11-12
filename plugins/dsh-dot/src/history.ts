/**
 * Looking things up in what was already said. dot keeps no separate store of
 * facts: its own earlier segments and the sessions on its ledger are the
 * record, and these functions search and read them. The same two operations
 * let a new segment read back what its handoff only summarized.
 */
import { splitCarriedNotice, textOf, type RawEvent } from './chat.ts'
import { stamp } from './transcript.ts'

export type HistoryRole = 'human' | 'notice' | 'dot' | 'tool-call' | 'tool-result'

export interface HistoryRow {
  /** Position in the session log; what a read is anchored on. */
  readonly seq: number
  readonly at: number
  readonly role: HistoryRole
  readonly text: string
}

export interface HistoryHit extends HistoryRow {
  /** The matched text with some of what surrounds it. */
  readonly snippet: string
}

/** Hits listed for one session; the rest is counted. */
export const HITS_PER_SESSION = 5
export const SEARCH_LIMIT_DEFAULT = 12
export const SEARCH_LIMIT_MAX = 40
/** Sessions one search reads at most, newest first. */
export const SEARCH_SESSIONS_MAX = 120
const SNIPPET_BEFORE = 60
const SNIPPET_AFTER = 160
export const READ_ROWS_DEFAULT = 4
export const READ_ROWS_MAX = 30
/** Characters of one row in a read, and of a whole read. */
export const READ_ROW_MAX_CHARS = 3000
export const READ_MAX_CHARS = 14_000

type Rec = Record<string, unknown>
const rec = (value: unknown): Rec | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Rec : undefined

/**
 * The searchable rows of a session log, oldest first. Without `tools` these
 * are the conversation alone: what the human said, notices, and replies.
 * Calls of the tools named in `skip` are left out together with their results:
 * a lookup repeats its own query and quotes what it found, so reading those
 * back would make every search find itself.
 */
export function historyRows(events: Iterable<RawEvent>, tools = false, skip: ReadonlySet<string> = new Set()): HistoryRow[] {
  const rows: HistoryRow[] = []
  const skipped = new Set<string>()
  let index = 0
  for (const event of events) {
    const seq = typeof event.seq === 'number' ? event.seq : index
    index++
    const data = rec(event.data) ?? {}
    const at = typeof event.time === 'number' ? event.time : 0
    const push = (role: HistoryRole, text: string) => { if (text.trim()) rows.push({ seq, at, role, text: text.trim() }) }
    if (event.type === 'user/message') {
      const kind = rec(data.source)?.kind
      if (kind === 'user') {
        const parts = splitCarriedNotice(data.source, data.content)
        if (parts.notice) push('notice', parts.notice)
        push('human', parts.text)
      } else if (kind === 'agent-message') push('notice', textOf(data.content))
    } else if (event.type === 'assistant/message') {
      push('dot', textOf(rec(data.message)?.content))
    } else if (tools && event.type === 'tool/call') {
      const name = typeof data.name === 'string' ? data.name : 'tool'
      if (skip.has(name)) {
        if (typeof data.callId === 'string') skipped.add(data.callId)
        continue
      }
      const args = typeof data.arguments === 'string' ? data.arguments : JSON.stringify(data.arguments ?? {})
      push('tool-call', `${name} ${args}`)
    } else if (tools && event.type === 'tool/result') {
      const message = rec(data.message)
      if (typeof message?.toolCallId === 'string' && skipped.has(message.toolCallId)) continue
      push('tool-result', textOf(message?.content))
    }
  }
  return rows
}

/** The words of a query: every one has to occur in a row, in any order and any letter case. */
export function queryTerms(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))]
}

/** Rows that hold every term, with the text around the first one. */
export function searchRows(rows: readonly HistoryRow[], terms: readonly string[]): HistoryHit[] {
  if (terms.length === 0) return []
  const hits: HistoryHit[] = []
  for (const row of rows) {
    const lower = row.text.toLowerCase()
    if (!terms.every(term => lower.includes(term))) continue
    const at = lower.indexOf(terms[0]!)
    const from = Math.max(0, at - SNIPPET_BEFORE)
    const to = Math.min(row.text.length, at + terms[0]!.length + SNIPPET_AFTER)
    hits.push({ ...row, snippet: `${from > 0 ? '…' : ''}${row.text.slice(from, to).replace(/\s+/g, ' ')}${to < row.text.length ? '…' : ''}` })
  }
  return hits
}

const LABEL: Record<HistoryRole, string> = { human: 'Human', notice: 'Notice', dot: 'Assistant', 'tool-call': 'Tool call', 'tool-result': 'Tool result' }
/** In dot's own segments its replies read as its own. */
const label = (role: HistoryRole, own: boolean): string => role === 'dot' && own ? 'You' : LABEL[role]
const when = (at: number): string => at > 0 ? stamp(at) : 'no time'

export interface SessionHits {
  readonly sessionId: string
  /** What the session is, in words the model can use: its own conversation, or a task and its title. */
  readonly what: string
  readonly own: boolean
  /** Newest first. */
  readonly hits: readonly HistoryHit[]
}

/** Model-facing answer of a search. */
export function formatSearch(input: { readonly query: string; readonly groups: readonly SessionHits[]; readonly limit: number; readonly searched: number; readonly skipped: number; readonly failed: number; readonly readTool: string }): string {
  const groups = input.groups.filter(group => group.hits.length > 0)
  const total = groups.reduce((sum, group) => sum + group.hits.length, 0)
  const scope = `${input.searched} session(s) searched${input.skipped > 0 ? `, ${input.skipped} older one(s) left out` : ''}${input.failed > 0 ? `, ${input.failed} could not be read` : ''}`
  if (total === 0) return `Nothing found for "${input.query}" (${scope}). Every word has to occur in one message; try fewer or different words.`
  const lines = [`${total} match(es) for "${input.query}" (${scope}), newest first. Read around one with ${input.readTool} (session_id and seq).`]
  let left = input.limit
  let listed = 0
  for (const group of groups) {
    if (left <= 0) break
    const shown = group.hits.slice(0, Math.min(HITS_PER_SESSION, left))
    left -= shown.length
    listed++
    lines.push('', `${group.what} · ${group.sessionId}`)
    for (const hit of shown) lines.push(`- seq ${hit.seq} [${when(hit.at)}] ${label(hit.role, group.own)}: ${hit.snippet}`)
    if (group.hits.length > shown.length) lines.push(`  (${group.hits.length - shown.length} more match(es) in this session; search it alone with session_id to see them)`)
  }
  if (groups.length > listed) lines.push('', `(${groups.length - listed} more session(s) with matches not listed; raise limit or narrow the words)`)
  return lines.join('\n')
}

/**
 * The rows a read returns. With `seq` they are the rows around that position;
 * without it they are the last rows of the session.
 */
export function windowRows(rows: readonly HistoryRow[], input: { readonly seq?: number; readonly before: number; readonly after: number }): { readonly rows: readonly HistoryRow[]; readonly earlier: number; readonly later: number } {
  if (rows.length === 0) return { rows: [], earlier: 0, later: 0 }
  let from: number
  let to: number
  if (input.seq === undefined) {
    to = rows.length
    from = Math.max(0, to - (input.before + input.after + 1))
  } else {
    const found = rows.findIndex(row => row.seq >= input.seq!)
    const anchor = found < 0 ? rows.length - 1 : found
    from = Math.max(0, anchor - input.before)
    to = Math.min(rows.length, anchor + input.after + 1)
  }
  return { rows: rows.slice(from, to), earlier: from, later: rows.length - to }
}

/** Model-facing answer of a read. */
export function formatRead(input: { readonly sessionId: string; readonly what: string; readonly own: boolean; readonly rows: readonly HistoryRow[]; readonly earlier: number; readonly later: number }): string {
  if (input.rows.length === 0) return `${input.what} · ${input.sessionId} holds no conversation to read.`
  const lines = [`${input.what} · ${input.sessionId}, seq ${input.rows[0]!.seq} to ${input.rows.at(-1)!.seq}:`]
  let used = 0
  let shown = 0
  for (const row of input.rows) {
    const text = row.text.length > READ_ROW_MAX_CHARS ? `${row.text.slice(0, READ_ROW_MAX_CHARS)}… (${row.text.length - READ_ROW_MAX_CHARS} more characters cut)` : row.text
    if (shown > 0 && used + text.length > READ_MAX_CHARS) break
    lines.push('', `seq ${row.seq} [${when(row.at)}] ${label(row.role, input.own)}: ${text}`)
    used += text.length
    shown++
  }
  const notes: string[] = []
  const cut = input.rows.length - shown
  if (cut > 0) notes.push(`${cut} row(s) after seq ${input.rows[shown - 1]!.seq} left out for length; read on from seq ${input.rows[shown]!.seq}`)
  if (input.earlier > 0) notes.push(`${input.earlier} earlier row(s) before seq ${input.rows[0]!.seq}`)
  if (input.later > 0 && cut === 0) notes.push(`${input.later} later row(s) after seq ${input.rows.at(-1)!.seq}`)
  if (notes.length > 0) lines.push('', `(${notes.join('; ')})`)
  return lines.join('\n')
}
