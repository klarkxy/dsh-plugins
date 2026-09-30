import { expect, it } from 'vitest'
import { WebError } from '@deepseek-ai/dsh-web'
import { HttpStatusError, providerError, redactDescription } from './provider-error.ts'
import { SearchEngineProvider } from './search-engine.ts'
import { BraveSearchProvider } from './rest-search.ts'
import { TavilySearchProvider } from './tavily.ts'

const secret = 'fixture-private-key'
function redacted(error: WebError) {
  expect(String(error)).not.toContain(secret)
  expect(JSON.stringify(error)).not.toContain(secret)
  expect(error.cause).toBeUndefined()
}
it.each(['WEB_BLOCKED_URL', 'WEB_REDIRECT_BLOCKED', 'WEB_FETCH_TIMEOUT', 'UPSTREAM_CUSTOM_ERROR'])(
  'preserves upstream %s and diagnostic description', code => {
    const error = providerError(new WebError(`upstream detail: example.com 198.18.0.1 ${secret}`, code), [secret])
    expect(error.code).toBe(code)
    expect(error.message).toBe('upstream detail: example.com 198.18.0.1 [REDACTED]')
    redacted(error)
  },
)
it.each(['ENOTFOUND', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT', 'CERT_HAS_EXPIRED'])(
  'retains nested upstream %s, not our classification', code => {
    const error = providerError(new TypeError('fetch failed', { cause: Object.assign(new Error(`upstream ${secret}`), { code }) }), [secret])
    expect(error.code).toBe(code)
    expect(error.message).toBe('fetch failed；upstream [REDACTED]')
    redacted(error)
  },
)
it('uses description without copying stack, headers or response objects', () => {
  const error = providerError({ code: 'CUSTOM', description: 'upstream description', message: 'other message', headers: { key: secret }, response: secret, stack: secret })
  expect(error.code).toBe('CUSTOM')
  expect(error.message).toBe('upstream description')
  redacted(error)
})
it('redacts credentials while keeping status, hostname and IP diagnostics', () => {
  const text = `HTTP 403 https://user:pass@proxy.example:7890/path?api_key=abc&x=1 Bearer abc.def password="abc" {"authorization":"abc"} ENOTFOUND example.com 198.18.0.1`
  const safe = redactDescription(text)
  expect(safe).not.toContain('user:pass')
  expect(safe).not.toContain('abc')
  expect(safe).toContain('HTTP 403')
  expect(safe).toContain('proxy.example:7890')
  expect(safe).toContain('ENOTFOUND example.com 198.18.0.1')
})
it('redacts exact and URL-encoded secrets before truncation', () => {
  const key = 'key+/='
  expect(redactDescription(`${key} ${encodeURIComponent(key)}`, [key])).toBe('[REDACTED] [REDACTED]')
  expect(redactDescription('x'.repeat(2000))).toHaveLength(1000)
})
it('preserves ordinary messages and SyntaxError diagnostics', () => {
  expect(providerError(new Error('HTTP 401 at example.com')).message).toBe('HTTP 401 at example.com')
  const error = providerError(new SyntaxError(`Invalid JSON near ${secret}`), [secret])
  expect(error.message).toBe('Invalid JSON near [REDACTED]')
  redacted(error)
})
it('handles cycles, strings and missing descriptions', () => {
  const input: { cause?: unknown } = {}; input.cause = input
  expect(providerError(input).code).toBe('WEB_PROVIDER_ERROR')
  expect(providerError('upstream string').message).toBe('upstream string')
  expect(providerError(new HttpStatusError(429)).message).toContain('HTTP 429')
})
const factories = [
  ['ddg', (fetch: typeof globalThis.fetch) => new SearchEngineProvider({ fetch })],
  ['brave', (fetch: typeof globalThis.fetch) => new BraveSearchProvider({ apiKey: secret, fetch })],
  ['tavily', (fetch: typeof globalThis.fetch) => new TavilySearchProvider({ apiKey: secret, fetch })],
] as const
it.each(factories)('%s retains HTTP status without copying response body', async (_id, factory) => {
  const error = await factory(async () => new Response(secret, { status: 403 })).search({ query: 'fixture' }).catch(error => error)
  expect(error.code).toBe('WEB_PROVIDER_ERROR')
  expect(error.message).toContain('HTTP 403')
  redacted(error)
})
it.each(factories)('%s retains upstream transport code and message', async (id, factory) => {
  const error = await factory(async () => { throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND', message: `getaddrinfo ENOTFOUND example.com ${id === 'ddg' ? '' : secret}` } }) }).search({ query: 'fixture' }).catch(error => error)
  expect(error.code).toBe('ENOTFOUND')
  expect(error.message).toContain('getaddrinfo ENOTFOUND example.com')
  redacted(error)
})
