import { checkShownView } from './core/index.js'
import type { ShownView } from './contracts.ts'

export type TextPart = { kind: 'markdown' | 'view'; key: string; text: string; shown?: ShownView }
/**
 * Single-fence-body compile result. 'partial' means JSON parsing failed, which a
 * streaming caller may keep waiting on; 'invalid' means the JSON parsed and
 * checkShownView rejected it, a definitive failure for the same text.
 */
export type DeepUiCompile =
  | { state: 'complete'; shown: ShownView }
  | { state: 'invalid'; error: string }
  | { state: 'partial' }

/**
 * String-aware cleanup for closed model fences: strips `//` and block comments,
 * escapes raw literal control newlines/tabs inside JSON strings, and drops
 * trailing commas before `}` or `]`. Incomplete streaming prefixes keep their
 * unclosed brackets and still fail `JSON.parse`, preserving 'partial' state.
 */
export function sanitizeLenientJson(source: string): string {
  let out = ''
  let inString = false
  let index = 0
  while (index < source.length) {
    const ch = source[index]
    if (inString) {
      if (ch === '\\' && index + 1 < source.length) {
        out += ch + source[index + 1]
        index += 2
        continue
      }
      if (ch === '"') {
        inString = false
        out += ch
        index += 1
        continue
      }
      if (ch === '\n') { out += '\\n'; index += 1; continue }
      if (ch === '\r') { out += '\\r'; index += 1; continue }
      if (ch === '\t') { out += '\\t'; index += 1; continue }
      out += ch
      index += 1
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      index += 1
      continue
    }
    if (ch === '/' && source[index + 1] === '/') {
      index += 2
      while (index < source.length && source[index] !== '\n') index += 1
      continue
    }
    if (ch === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2)
      if (end === -1) return source
      index = end + 2
      continue
    }
    out += ch
    index += 1
  }
  if (inString) return source
  // Remove trailing commas outside string literals without disturbing strings.
  let cleaned = ''
  let quoted = false
  for (let i = 0; i < out.length; i += 1) {
    const c = out[i]
    if (quoted) {
      if (c === '\\' && i + 1 < out.length) { cleaned += c + out[i + 1]; i += 1; continue }
      if (c === '"') quoted = false
      cleaned += c
      continue
    }
    if (c === '"') { quoted = true; cleaned += c; continue }
    if (c === ',') {
      let lookahead = i + 1
      while (lookahead < out.length && /\s/.test(out[lookahead]!)) lookahead += 1
      if (out[lookahead] === '}' || out[lookahead] === ']') continue
    }
    cleaned += c
  }
  return cleaned
}

function parseJsonBody(body: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(body) }
  } catch {
    try {
      return { ok: true, value: JSON.parse(sanitizeLenientJson(body)) }
    } catch {
      return { ok: false }
    }
  }
}

/**
 * Compile one deepui/deep-view fence body: JSON.parse (with lenient fallback for
 * trailing commas/comments), then checkShownView on either {title, view} or a
 * bare ViewNode. Callers decide how to present 'partial' while streaming versus
 * after the fence is final.
 */
export function compileDeepUi(body: string): DeepUiCompile {
  const parsed = parseJsonBody(body)
  if (!parsed.ok) return { state: 'partial' }
  const payload = parsed.value
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
  return { at, marker: match[2], language: match[3].trim().split(/[ \t]/, 1)[0], contentStart: at + match[0].length - match[1].length }
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
    if (start.language !== 'deepui' && start.language !== 'deep-view') {
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
    const compiled = compileDeepUi(body)
    parts.push(compiled.state === 'complete'
      ? { kind: 'view', key: `v-${start.at}`, text: body, shown: compiled.shown }
      : { kind: 'markdown', key: `m-${start.at}`, text: source.slice(start.at, close.next) })
    offset = close.next
  }
  markdown(source.length)
  return parts
}
