import { WebError, type WebSearchProvider, type WebSearchRequest, type WebSearchResult, type WebSearchSource } from '@deepseek-ai/dsh-web'
import { HttpStatusError, providerError } from './provider-error.ts'
import { httpsEndpoint, readJSON, record, sourceFrom } from './http-json.ts'
export interface TavilyOptions { apiKey: string; baseURL?: string; fetch?: typeof fetch }
/** Direct REST adapter. No auxiliary LLM, retries, anonymous fallback or auto-depth. */
export class TavilySearchProvider implements WebSearchProvider {
  readonly id = 'tavily'
  constructor(private readonly options: TavilyOptions) {}
  available(): boolean {
    try { httpsEndpoint(this.options.baseURL ?? 'https://api.tavily.com', '/search'); return Boolean(this.options.apiKey.trim()) }
    catch { return false }
  }
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    if (!this.available()) throw new WebError('Tavily 配置不可用。', 'WEB_CREDENTIAL_MISSING')
    if (!request.query?.trim() || request.query.length > 4000) throw new WebError('查询无效。', 'WEB_INVALID_REQUEST')
    const count = request.maxResults ?? 5
    if (!Number.isInteger(count) || count < 1 || count > 20) throw new WebError('结果数须为 1 至 20。', 'WEB_INVALID_REQUEST')
    try {
      signal?.throwIfAborted()
      const response = await (this.options.fetch ?? fetch)(httpsEndpoint(this.options.baseURL ?? 'https://api.tavily.com', '/search'), {
        method: 'POST', redirect: 'error', signal,
        headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          query: request.query.trim(), max_results: count, search_depth: 'basic', topic: 'general',
          auto_parameters: false, include_answer: false, include_raw_content: false, include_images: false,
        }),
      })
      if (!response.ok) {
        await response.body?.cancel().catch(() => {})
        throw new HttpStatusError(response.status)
      }
      const payload = record(await readJSON(response, signal))
      if (!Array.isArray(payload?.results)) throw new Error('Invalid response shape')
      const sources: WebSearchSource[] = []
      for (const raw of payload.results) {
        const row = record(raw)
        const source = sourceFrom(row, 'url', 'title', 'content')
        if (!source || !row) continue
        sources.push({
          ...source,
          // Tavily preserves present empty strings; the shared helper omits them.
          ...(row.title === '' ? { title: '' } : {}),
          ...(row.content === '' ? { snippet: '' } : {}),
          ...(typeof row.published_date === 'string' && Number.isFinite(Date.parse(row.published_date))
            ? { publishedAt: new Date(row.published_date).toISOString() } : {}),
        })
      }
      return { sources: sources.slice(0, count), truncated: sources.length > count }
    } catch (error) {
      if (signal?.aborted) throw new WebError('Tavily 搜索已取消。', 'WEB_ABORTED')
      throw providerError(error, [this.options.apiKey])
    }
  }
}
