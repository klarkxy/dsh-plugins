import { isIP } from 'node:net'
import type { WebFetchProvider, WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web'

export interface JinaFirstFetchOptions {
  readonly reader: WebFetchProvider
  readonly direct: WebFetchProvider
  readonly readerTimeoutMs: number
}

/** Do not send obvious local addresses, credentials, or nested Reader URLs to a third party. */
function readerUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || isIP(host) || !host.includes('.') || host === 'r.jina.ai'
      || /\.(?:localhost|local|internal|lan|home|test|invalid)$/.test(host)) return undefined
    return `https://r.jina.ai/${url.href}`
  } catch { return undefined }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

/** Accept Reader's text envelope or negotiated JSON, but not error/empty responses. */
function readerContent(result: WebFetchResult): string | undefined {
  if (result.statusCode < 200 || result.statusCode >= 300 || result.body.kind !== 'text') return undefined
  const content = result.body.content
  if (content.trimStart().startsWith('{')) {
    try {
      const envelope = object(JSON.parse(content))
      if (!envelope || (envelope.code !== undefined && envelope.code !== 200)) return undefined
      const page = object(envelope.data) ?? envelope
      return typeof page.content === 'string' && page.content.trim() && !page.warning
        ? page.content : undefined
    } catch { return undefined }
  }
  const marker = /^Markdown Content:[\t ]*\r?$/m.exec(content)
  if (!marker || /^Warning:/im.test(content.slice(0, marker.index))) return undefined
  return content.slice(marker.index + marker[0].length).trim() ? content : undefined
}

/** Bound the Reader stage even if a provider fails to honour its cooperative signal. */
async function readWithTimeout(
  read: (signal: AbortSignal) => Promise<WebFetchResult>, timeoutMs: number, parent?: AbortSignal,
): Promise<WebFetchResult> {
  parent?.throwIfAborted()
  const controller = new AbortController()
  const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let off = () => {}
  const aborted = new Promise<never>((_, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    off = () => signal.removeEventListener('abort', onAbort)
  })
  try {
    return await Promise.race([
      Promise.resolve().then(() => { signal.throwIfAborted(); return read(signal) }),
      aborted,
    ])
  } finally {
    clearTimeout(timer)
    off()
  }
}

/** One managed fetch route: anonymous Jina Reader first, existing safe HTTP transport second. */
export class JinaFirstFetchProvider implements WebFetchProvider {
  // Preserve stored settings, environment overrides, and the managed registry identity.
  readonly id = 'http'
  private readonly options: JinaFirstFetchOptions

  constructor(options: JinaFirstFetchOptions) {
    if (!Number.isInteger(options.readerTimeoutMs) || options.readerTimeoutMs < 1
      || options.readerTimeoutMs > 2_147_483_647) throw new Error('Invalid Reader timeout')
    this.options = options
  }

  available(): boolean { return this.options.direct.available() }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    signal?.throwIfAborted()
    const url = readerUrl(request.url)
    if (url && this.options.reader.available()) {
      try {
        // Only the URL is forwarded. No account, API key, cookie, or caller headers are added.
        const result = await readWithTimeout(
          combined => this.options.reader.fetch({ url }, combined), this.options.readerTimeoutMs, signal,
        )
        signal?.throwIfAborted()
        const content = readerContent(result)
        if (content !== undefined) return { ...result, url: request.url, body: { kind: 'text', content } }
      } catch {
        // A Reader timeout/failure permits fallback; caller cancellation or the total deadline does not.
        signal?.throwIfAborted()
      }
    }
    signal?.throwIfAborted()
    // Keep the original request, cancellation/deadline, URL policy, redirects, and error semantics.
    return this.options.direct.fetch(request, signal)
  }
}
