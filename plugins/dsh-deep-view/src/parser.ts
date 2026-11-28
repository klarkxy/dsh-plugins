import { jsonrepair } from 'jsonrepair'
import { checkShownView, VIEW_BYTE_LIMIT } from './core/index.js'
import type { ShownView } from './contracts.ts'

/** Canonical Markdown fence language tags routed to Deep View in both Host/reply parsing and Web Client slots. */
export const DEEP_VIEW_FENCE_LANGUAGES = [
  'deepui',
  'deep-ui',
  'deep_ui',
  'deepview',
  'deep-view',
  'deep_view',
] as const

export type DeepViewFenceLanguage = (typeof DEEP_VIEW_FENCE_LANGUAGES)[number]

/**
 * Check whether a raw Markdown fence info string names a Deep View fence in
 * standalone `parseDeepUi` text scanning. Host Markdown fence slots split on
 * the first whitespace token and strictly route the 6 single-token aliases in
 * `DEEP_VIEW_FENCE_LANGUAGES`.
 */
export function isDeepViewFenceLanguage(language: string): boolean {
  return /^deep[-_\s]*(?:ui|view)(?:\s|$)/i.test(language.trim())
}

export type TextPart = { kind: 'markdown' | 'view'; key: string; text: string; shown?: ShownView }
/**
 * Single-fence-body compile result. 'partial' means strict JSON parsing failed
 * on a non-final body, which a streaming caller may keep waiting on; 'invalid'
 * means a final body could not be recovered or checkShownView rejected the
 * parsed payload, a definitive failure for the same text.
 */
export type DeepUiCompile =
  | { state: 'complete'; shown: ShownView }
  | { state: 'invalid'; error: string }
  | { state: 'partial' }

/**
 * Compile one deepui/deep-view fence body: JSON.parse, then checkShownView on
 * either {title, view} or a bare ViewNode. The default `final = false` never
 * repairs — use it for streaming bodies (jsonrepair auto-closes truncated JSON
 * and would mount half-written cards) and for callers that require strict JSON
 * (prompt examples). Only a final body is repaired before giving up.
 */
export function compileDeepUi(body: string, final = false): DeepUiCompile {
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch (error) {
    if (!final) return { state: 'partial' }
    if (body.length > 4 * VIEW_BYTE_LIMIT) return { state: 'invalid', error: 'JSON: the body is too large to repair' }
    try {
      payload = JSON.parse(jsonrepair(body))
    } catch {
      // Discard the repair error on purpose: the original JSON.parse position
      // is the one the user can act on.
      const message = error instanceof Error ? error.message : String(error)
      return { state: 'invalid', error: `JSON: ${message}` }
    }
  }
  const record = payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : undefined
  const sent = record && Object.hasOwn(record, 'view') ? record.view : payload
  const title = record && Object.hasOwn(record, 'view') ? record.title : undefined
  const shown = checkShownView(title, sent) as ShownView | { error: string }
  return 'error' in shown ? { state: 'invalid', error: shown.error } : { state: 'complete', shown }
}
type Fence = { at: number; marker: string; language: string; contentStart: number }
const OPEN = /(^|\n)(`{3,}|~{3,})([^\r\n`~]*)(?:\n|$)/g
function closeFence(source: string, from: number, marker: string): { at: number; next: number } | undefined {
  const pattern = new RegExp(`(^|\\n)${marker[0]}{${marker.length},}[ \\t]*(?:\\n|$)`, 'g')
  pattern.lastIndex = from
  const match = pattern.exec(source)
  if (!match) return undefined
  return { at: match.index + match[1].length, next: pattern.lastIndex }
}
function nextFence(source: string, from: number): Fence | undefined {
  OPEN.lastIndex = from
  const match = OPEN.exec(source)
  if (!match) return undefined
  const at = match.index + match[1].length
  return { at, marker: match[2], language: match[3].trim(), contentStart: at + match[0].length - match[1].length }
}
function plainFence(source: string, start: Fence): Fence {
  const closed = closeFence(source, start.contentStart, start.marker)
  return closed ? nextFence(source, closed.next) ?? { at: source.length, marker: '', language: '', contentStart: source.length } : { at: source.length, marker: '', language: '', contentStart: source.length }
}

/**
 * Scan all top-level fences, not just Deep View ones. This prevents a nested
 * ```deepui example inside an ordinary fence from becoming a live component.
 * Unknown, malformed and unfinished fences remain verbatim Markdown.
 */
export function parseDeepUi(source: string): TextPart[] {
  const parts: TextPart[] = []
  let offset = 0
  const markdown = (end: number) => {
    if (end <= offset) return
    parts.push({ kind: 'markdown', key: `m-${offset}`, text: source.slice(offset, end) })
  }
  while (offset < source.length) {
    const start = nextFence(source, offset)
    if (!start || start.at >= source.length) break
    if (!isDeepViewFenceLanguage(start.language)) {
      const next = plainFence(source, start)
      if (next.at >= source.length) break
      offset = next.at
      continue
    }
    markdown(start.at)
    const close = closeFence(source, start.contentStart, start.marker)
    if (!close) {
      parts.push({ kind: 'markdown', key: `m-${start.at}`, text: source.slice(start.at) })
      return parts
    }
    const body = source.slice(start.contentStart, close.at)
    // A closed fence's compile result is final here: 'partial' and 'invalid'
    // alike fall back to verbatim Markdown, only 'complete' becomes a view.
    const compiled = compileDeepUi(body, true)
    parts.push(compiled.state === 'complete'
      ? { kind: 'view', key: `v-${start.at}`, text: body, shown: compiled.shown }
      : { kind: 'markdown', key: `m-${start.at}`, text: source.slice(start.at, close.next) })
    offset = close.next
  }
  markdown(source.length)
  return parts
}
