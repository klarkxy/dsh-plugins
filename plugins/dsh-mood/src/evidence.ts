export interface SessionEventLike { seq: number; type: string; data?: unknown }

export function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter(block => block && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text).join('\n')
}

export function messageSource(value: unknown): { kind?: string } | undefined {
  if (!value || typeof value !== 'object') return undefined
  const row = value as { source?: { kind?: string }; message?: { source?: { kind?: string } } }
  return row.source ?? row.message?.source
}
