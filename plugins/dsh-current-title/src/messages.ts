import { normalizeSessionTitle } from './output.ts'
import type { TitleMessage } from './contracts.ts'

export interface SessionEventLike {
  readonly type: string
  readonly seq: number
  readonly time?: number
  readonly data?: {
    readonly source?: { readonly kind?: string; readonly plugin?: string; readonly provider?: string }
    readonly content?: ReadonlyArray<{ readonly type?: string; readonly text?: string }>
    readonly title?: string
    readonly messageSeqs?: readonly number[]
  }
}

export interface SessionLike {
  readonly id: string
  readonly seq?: number
  snapshotEvents(): readonly SessionEventLike[]
  append?(type: string, data: unknown): unknown
}

function textFromContent(content: ReadonlyArray<{ readonly type?: string; readonly text?: string }> | undefined): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => block && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n')
}

/** Eligible human prompts only. Plugin/tool/model user-role rows are excluded. */
export function collectHumanMessages(events: readonly SessionEventLike[], throughSeq?: number): TitleMessage[] {
  const messages: TitleMessage[] = []
  for (const event of events) {
    if (throughSeq !== undefined && event.seq > throughSeq) break
    if (event.type !== 'user/message') continue
    if (event.data?.source?.kind !== 'user') continue
    const text = textFromContent(event.data.content)
    if (normalizeSessionTitle(text, Number.MAX_SAFE_INTEGER).length === 0) continue
    messages.push({ seq: event.seq, text })
  }
  return messages
}

export function sourceVersionOf(sessionId: string, messages: readonly TitleMessage[]): string {
  const last = messages.at(-1)
  return `${sessionId}:${last?.seq ?? -1}:${messages.length}`
}
