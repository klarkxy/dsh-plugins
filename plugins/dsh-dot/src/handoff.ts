/**
 * What dot carries from one session segment into the next. A short segment
 * moves over word for word; a long one becomes a note dot writes for itself
 * plus its last exchanges; when that note cannot be written, the most recent
 * messages move over alone. The shape follows the partner-conversation design
 * of dsh-editor.
 */
import { clipTokens, estimateTokens, exchanges, formatRows, type TranscriptRow } from './transcript.ts'

/** Up to this size the conversation is carried word for word. */
export const VERBATIM_MAX_TOKENS = 16_384
/** Exchanges kept word for word next to a note, and their size cap. */
export const TAIL_EXCHANGES = 3
export const TAIL_MAX_TOKENS = 6_000
/** Size of the word-for-word tail when no note could be written. */
export const FALLBACK_TAIL_TOKENS = 16_384
export const FALLBACK_TAIL_RATIO = 0.3
/** Output cap of the note request. */
export const SUMMARY_MAX_TOKENS = 4_096

export type HandoffTier = 'verbatim' | 'summary' | 'tail'

export interface Handoff {
  readonly tier: HandoffTier
  /** dot's own note; under `verbatim` and `tail` it is older than the rows. */
  readonly summary?: string
  readonly rows: readonly TranscriptRow[]
}

/** Appended after the segment's own prompt prefix, so the request reuses the provider cache. */
export const SUMMARY_INSTRUCTION = [
  '[handoff request from the host, not a message from the human]',
  'This conversation is about to continue in a fresh session. Only the note you write now and the last few messages are carried over. Write that note for yourself. Do not call tools and do not address the human.',
  '',
  'Cover, in this order and only where there is something to say:',
  '1. What the human wants overall and what they asked for most recently.',
  '2. Decisions made and the reasons that still matter, including anything you promised or were told to do later.',
  '3. Each task or session still in play: its session id, goal, current state and what you are waiting for.',
  '4. Open questions and requests that wait on the human or on you.',
  '5. Facts, names, paths and numbers you would otherwise have to ask for again.',
  'When your instructions already hold a handoff note from an earlier segment, fold in what is still relevant.',
  '',
  'Plain text in the language the human uses, no preamble, at most about 600 words. Leave out small talk and work that is finished and reported.',
].join('\n')

export interface HandoffInput {
  /** Conversation of the segment that ends. */
  readonly rows: readonly TranscriptRow[]
  /** The handoff that segment itself started with. */
  readonly carried?: Handoff
  readonly contextWindow?: number
  /** Ask dot for its note; absent or failing falls back to the tail. */
  readonly summarize?: () => Promise<string>
  readonly onError?: (error: unknown) => void
}

const sizeOf = (summary: string | undefined, rows: readonly TranscriptRow[]): number =>
  estimateTokens(summary ?? '') + (rows.length ? estimateTokens(formatRows(rows)) : 0)

/** Latest rows that fit the budget; one oversized row is cut instead of dropped. */
export function tailRows(rows: readonly TranscriptRow[], budget: number): TranscriptRow[] {
  const out: TranscriptRow[] = []
  let used = 0
  for (let index = rows.length - 1; index >= 0; index--) {
    const size = estimateTokens(formatRows([rows[index]!]))
    if (used + size > budget) break
    out.unshift(rows[index]!)
    used += size
  }
  const last = rows.at(-1)
  if (out.length === 0 && last && budget > 0) out.push({ ...last, text: clipTokens(last.text, budget) })
  return out
}

/** The last exchanges within the budget, dropping whole exchanges from the old end first. */
export function tailExchanges(rows: readonly TranscriptRow[], count: number, budget: number): TranscriptRow[] {
  const kept = exchanges(rows).slice(-count)
  while (kept.length > 1 && estimateTokens(formatRows(kept.flat())) > budget) kept.shift()
  const flat = kept.flat()
  return estimateTokens(formatRows(flat)) > budget ? tailRows(flat, budget) : flat
}

/** @returns undefined when there is nothing to carry. */
export async function buildHandoff(input: HandoffInput): Promise<Handoff | undefined> {
  const rows = [...input.carried?.rows ?? [], ...input.rows]
  const earlier = input.carried?.summary
  if (rows.length === 0 && !earlier) return undefined
  if (sizeOf(earlier, rows) <= VERBATIM_MAX_TOKENS) return { tier: 'verbatim', ...earlier ? { summary: earlier } : {}, rows }
  if (input.summarize) {
    try {
      const summary = (await input.summarize()).trim()
      if (summary) return { tier: 'summary', summary, rows: tailExchanges(rows, TAIL_EXCHANGES, TAIL_MAX_TOKENS) }
      input.onError?.(new Error('the handoff note came back empty'))
    } catch (error) {
      input.onError?.(error)
    }
  }
  const budget = input.contextWindow && input.contextWindow > 0
    ? Math.min(FALLBACK_TAIL_TOKENS, Math.floor(input.contextWindow * FALLBACK_TAIL_RATIO))
    : FALLBACK_TAIL_TOKENS
  const kept = earlier ? clipTokens(earlier, Math.floor(budget / 4)) : undefined
  return { tier: 'tail', ...kept ? { summary: kept } : {}, rows: tailRows(rows, budget - estimateTokens(kept ?? '')) }
}

const ROWS_HEAD: Record<HandoffTier, string> = {
  verbatim: 'The conversation before this session, word for word:',
  summary: 'The last messages before this session, word for word:',
  tail: 'The earlier conversation was too long to carry over and could not be condensed. Its most recent messages, word for word:',
}

/** Model-facing body of a handoff. */
export function handoffText(handoff: Handoff): string {
  const parts: string[] = []
  if (handoff.summary) {
    parts.push(`${handoff.tier === 'summary' ? 'Your own note on the conversation so far:' : 'Your own note from an earlier handoff; it is older than the messages below:'}\n${handoff.summary}`)
  }
  if (handoff.rows.length) parts.push(`${ROWS_HEAD[handoff.tier]}\n${formatRows(handoff.rows)}`)
  return parts.join('\n\n')
}
