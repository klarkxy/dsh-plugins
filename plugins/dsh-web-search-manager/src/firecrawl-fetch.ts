import { WebError, type WebFetchProvider, type WebFetchRequest, type WebFetchResult } from '@deepseek-ai/dsh-web'
import { httpsEndpoint, readJSON, record } from './http-json.ts'
import { HttpStatusError, providerError } from './provider-error.ts'
import type { RestSearchOptions } from './rest-search.ts'

function pageURL(value: unknown): string {
  if (typeof value !== 'string') throw new WebError('Firecrawl 未返回最终网页地址。', 'WEB_PROVIDER_ERROR')
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new WebError('网页地址无效。', 'WEB_INVALID_URL')
  return url.href
}

/** https://docs.firecrawl.dev/api-reference/endpoint/scrape — API HTTP status is not the page status. */
export class FirecrawlFetchProvider implements WebFetchProvider {
  readonly id = 'firecrawl'
  constructor(private readonly options: RestSearchOptions & { maxFetchChars?: number }) {}
  available(): boolean {
    try { httpsEndpoint(this.options.baseURL ?? 'https://api.firecrawl.dev', '/v2/scrape'); return Boolean(this.options.apiKey.trim()) }
    catch { return false }
  }
  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    if (!this.available()) throw new WebError('Firecrawl 配置不可用。', 'WEB_CREDENTIAL_MISSING')
    try {
      signal?.throwIfAborted()
      const url = pageURL(request.url)
      const response = await (this.options.fetch ?? fetch)(httpsEndpoint(this.options.baseURL ?? 'https://api.firecrawl.dev', '/v2/scrape'), {
        method: 'POST', redirect: 'error', signal,
        headers: { accept: 'application/json', authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' },
        // Markdown only; no LLM cleanup, actions or extra extraction features. Disable TLS bypass.
        body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true, skipTlsVerification: false }),
      })
      if (!response.ok) {
        await response.body?.cancel().catch(() => {})
        throw new HttpStatusError(response.status)
      }
      const payload = record(await readJSON(response, signal))
      signal?.throwIfAborted()
      const data = record(payload?.data), metadata = record(data?.metadata)
      const statusCode = metadata?.statusCode
      if (payload?.success !== true || typeof data?.markdown !== 'string'
        || typeof statusCode !== 'number' || !Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
        throw new WebError('Firecrawl 未返回正文和真实网页状态码。', 'WEB_PROVIDER_ERROR')
      }
      const finalURL = pageURL(metadata?.url)
      const limit = this.options.maxFetchChars ?? 100_000
      return { url: finalURL, statusCode, body: { kind: 'text', content: data.markdown.slice(0, limit) }, truncated: data.markdown.length > limit }
    } catch (error) {
      if (signal?.aborted) throw new WebError('网页读取已取消。', 'WEB_ABORTED')
      throw providerError(error, [this.options.apiKey])
    }
  }
}
