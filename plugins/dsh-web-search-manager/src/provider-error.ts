import { WebError } from '@deepseek-ai/dsh-web'

/** Preserve diagnostics, removing known credential values and common authentication fields only. */
export function redactDescription(text: string, secrets: readonly string[] = []): string {
  let result = text
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
    for (const value of new Set([secret, encodeURIComponent(secret)])) result = result.split(value).join('[REDACTED]')
  }
  result = result
    .replace(/(https?:\/\/)[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]')
    .replace(/([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|key)=)[^&#\s]*/gi, '$1[REDACTED]')
    .replace(/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization|cookie|set-cookie)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1[REDACTED]')
  return result.slice(0, 1000)
}

export class HttpStatusError extends WebError {
  readonly status: number
  constructor(status: number) {
    const safe = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0
    super(safe ? `供应商请求失败（HTTP ${safe}）。` : '供应商请求失败。', 'WEB_PROVIDER_ERROR')
    this.status = safe
  }
}

/** Keep upstream code and descriptions, not the error object, stack, response or headers. */
export function providerError(error: unknown, secrets: readonly string[] = []): WebError {
  const seen = new Set<unknown>()
  const descriptions: string[] = []
  let code: string | undefined
  let current = error
  for (let depth = 0; depth < 3 && current && typeof current === 'object' && !seen.has(current); depth++) {
    seen.add(current)
    const item = current as { code?: unknown; message?: unknown; description?: unknown; cause?: unknown }
    if (!code && typeof item.code === 'string' && item.code) code = item.code
    const description = typeof item.description === 'string' && item.description.trim() ? item.description : item.message
    if (typeof description === 'string' && description.trim() && !descriptions.includes(description)) descriptions.push(description)
    current = item.cause
  }
  if (typeof error === 'string' && error.trim()) descriptions.push(error)
  return new WebError(
    redactDescription(descriptions.join('；') || '供应商未提供错误描述。', secrets),
    redactDescription(code || 'WEB_PROVIDER_ERROR', secrets),
  )
}
