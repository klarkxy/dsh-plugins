/**
 * The readable part of one of dot's session segments: what the human said,
 * the notices the host delivered and dot's replies. Tool calls, reasoning and
 * compaction checkpoints stay out, so a handoff carries the conversation and
 * not the machinery around it.
 */
import { splitCarriedNotice, textOf, type RawEvent } from './chat.ts'

export type TranscriptRole = 'human' | 'notice' | 'dot'

export interface TranscriptRow {
  readonly role: TranscriptRole
  readonly text: string
  readonly at: number
}

type Rec = Record<string, unknown>
const rec = (value: unknown): Rec | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Rec : undefined

const CJK = /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/g

/** Rough token count without a tokenizer: one per CJK character, one per four other characters. */
export function estimateTokens(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0
  return cjk + Math.ceil((text.length - cjk) / 4)
}

/** Cut a text to about `budget` tokens, keeping its beginning. */
export function clipTokens(text: string, budget: number): string {
  const tokens = estimateTokens(text)
  if (tokens <= budget) return text
  if (budget <= 0) return ''
  return text.slice(0, Math.max(1, Math.floor(text.length * budget / tokens))) + '…'
}

/** Conversation rows of a session log, oldest first. */
export function transcriptRows(events: Iterable<RawEvent>): TranscriptRow[] {
  const rows: TranscriptRow[] = []
  for (const event of events) {
    const data = rec(event.data) ?? {}
    const at = typeof event.time === 'number' ? event.time : 0
    if (event.type === 'user/message') {
      const kind = rec(data.source)?.kind
      if (kind === 'user') {
        const parts = splitCarriedNotice(data.source, data.content)
        if (parts.notice) rows.push({ role: 'notice', text: parts.notice.trim(), at })
        if (parts.text.trim()) rows.push({ role: 'human', text: parts.text.trim(), at })
      } else if (kind === 'agent-message') {
        const text = textOf(data.content).trim()
        if (text) rows.push({ role: 'notice', text, at })
      }
    } else if (event.type === 'assistant/message') {
      const text = textOf(rec(data.message)?.content).trim()
      if (text) rows.push({ role: 'dot', text, at })
    }
  }
  return rows
}

/** Group rows into exchanges: each starts with what came in and ends with dot's replies to it. */
export function exchanges(rows: readonly TranscriptRow[]): TranscriptRow[][] {
  const out: TranscriptRow[][] = []
  let previous: TranscriptRole | undefined
  for (const row of rows) {
    if (out.length === 0 || (row.role !== 'dot' && previous === 'dot')) out.push([])
    out.at(-1)!.push(row)
    previous = row.role
  }
  return out
}

const LABEL: Record<TranscriptRole, string> = { human: 'Human', notice: 'Notice', dot: 'You' }
const two = (value: number) => String(value).padStart(2, '0')

/** Local wall-clock stamp for model-facing text. */
export function stamp(at: number): string {
  const date = new Date(at)
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}

/** Model-facing rendering of rows; dot reads its own replies as "You". */
export function formatRows(rows: readonly TranscriptRow[]): string {
  return rows.map(row => `${row.at > 0 ? `[${stamp(row.at)}] ` : ''}${LABEL[row.role]}: ${row.text}`).join('\n\n')
}

/**
 * Inspect whether the segment's latest interactive `show_view` card is still
 * waiting for a human reply, and whether any human message arrived in this log.
 */
export function openCardState(events: Iterable<RawEvent>): { readonly openCard?: string; readonly hadUserMessage: boolean } {
  const callTitles = new Map<string, string>()
  let openCard: string | undefined
  let hadUserMessage = false
  for (const event of events) {
    const data = rec(event.data)
    if (event.type === 'tool/call' && data?.name === 'show_view' && typeof data.callId === 'string') {
      let title = ''
      if (typeof data.arguments === 'string') {
        try { title = typeof rec(JSON.parse(data.arguments))?.title === 'string' ? String(rec(JSON.parse(data.arguments))!.title).trim() : '' } catch { /* partial or non-json */ }
      } else {
        const args = rec(data.arguments)
        if (typeof args?.title === 'string') title = args.title.trim()
      }
      if (title) callTitles.set(data.callId, title)
    } else if (event.type === 'tool/result') {
      const meta = rec(data?.meta)
      if (meta?.awaitReply === true) {
        const callId = typeof rec(data?.message)?.toolCallId === 'string' ? String(rec(data?.message)!.toolCallId) : undefined
        const title = typeof meta.title === 'string' && meta.title.trim()
          ? meta.title.trim()
          : (callId ? callTitles.get(callId) : undefined) ?? 'Deep View'
        openCard = title.slice(0, 160)
      }
    } else if (event.type === 'user/message' && rec(data?.source)?.kind === 'user') {
      hadUserMessage = true
      openCard = undefined
    }
  }
  return { ...(openCard ? { openCard } : {}), hadUserMessage }
}

export function awaitingReply(events: Iterable<RawEvent>): boolean {
  return openCardState(events).openCard !== undefined
}
