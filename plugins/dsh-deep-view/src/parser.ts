import { checkShownView } from './core/index.js'
import type { ShownView } from './contracts.ts'

export type TextPart = { kind: 'markdown' | 'view'; key: string; text: string; shown?: ShownView }
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
    try {
      const payload: unknown = JSON.parse(body)
      const record = payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : undefined
      const sent = record && Object.hasOwn(record, 'view') ? record.view : payload
      const title = record && Object.hasOwn(record, 'view') && typeof record.title === 'string' ? record.title : undefined
      const shown = checkShownView(title, sent) as ShownView | { error: string }
      parts.push('error' in shown
        ? { kind: 'markdown', key: `m-${start.at}`, text: source.slice(start.at, close.next) }
        : { kind: 'view', key: `v-${start.at}`, text: body, shown })
    } catch {
      parts.push({ kind: 'markdown', key: `m-${start.at}`, text: source.slice(start.at, close.next) })
    }
    offset = close.next
  }
  markdown(source.length)
  return parts
}
