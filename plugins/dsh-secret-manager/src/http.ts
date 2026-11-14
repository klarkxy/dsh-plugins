/**
 * The bounded HTTP call a `secret_http` request makes after the human approved
 * one exact origin.
 *
 * Every rule here exists to keep the approved scope true: HTTPS only, the
 * request's origin must equal the approved origin before and after the exchange,
 * redirects are errors (a redirect would move the credential to an origin nobody
 * approved), userinfo is refused, and an oversized response is refused whole
 * instead of being cut — a cut can fall inside a credential or inside a UTF-8
 * sequence, and returning no body at all is the only boundary that cannot leak
 * a prefix.
 *
 * Failures are reported as a small fixed vocabulary. A raw `Error` can carry a
 * URL, a header echo or an environment detail, so it is never surfaced or
 * logged.
 */
import {
  DEFAULT_AUTH_HEADER,
  FORBIDDEN_AUTH_HEADERS,
  MAX_HTTP_HEADERS,
  MAX_HTTP_REQUEST_BYTES,
  MAX_HTTP_RESPONSE_BYTES,
  isAuthHeaderName,
  isAuthPrefix,
  isCanonicalOrigin,
  originOfUrl,
} from './contracts.ts'
import { maskValues } from './redact.ts'

/** Methods that name an operation rather than a tunnel or an echo. */
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])

/** The approved HTTP scope for one call. */
export interface HttpScope {
  origin: string
  authHeader: string
  authPrefix: string
}

export type DenialReason =
  | 'scheme' | 'origin' | 'userinfo' | 'redirect' | 'method'
  | 'request-too-large' | 'response-too-large' | 'headers' | 'auth-header'

export type HttpOutcome =
  | { kind: 'ok'; status: number; contentType?: string; body: string; truncated: boolean }
  | { kind: 'denied'; reason: DenialReason }
  | { kind: 'error'; reason: 'network' | 'timeout' | 'tls' | 'unknown' }
  | { kind: 'cancelled' }

export interface HttpRequestInput {
  url: string
  method: string
  headers?: Record<string, string>
  body?: string
}

export interface HttpDeps {
  fetch: typeof fetch
  signal: AbortSignal
  now?: () => number
}

/** `${prefix}${value}`, used verbatim; the prefix owns any separator space. */
export function authHeaderValue(prefix: string, value: string): string {
  return `${prefix}${value}`
}

function normalizeHeaders(input: Record<string, string> | undefined, authHeader: string): Record<string, string> | undefined {
  if (input === undefined) return {}
  const entries = Object.entries(input)
  if (entries.length > MAX_HTTP_HEADERS) return undefined
  const out: Record<string, string> = {}
  for (const [name, value] of entries) {
    if (typeof name !== 'string' || typeof value !== 'string') return undefined
    if (!isAuthHeaderName(name)) return undefined
    if (/[\u0000\r\n]/.test(value)) return undefined
    // Two credentials for one request would make the approved scope ambiguous.
    if (name.toLowerCase() === authHeader.toLowerCase()) return undefined
    if (FORBIDDEN_AUTH_HEADERS.includes(name.toLowerCase())) return undefined
    out[name] = value
  }
  return out
}

export async function performHttpRequest(
  input: HttpRequestInput,
  scope: HttpScope,
  secret: string,
  deps: HttpDeps,
): Promise<HttpOutcome> {
  const method = input.method.toUpperCase()
  if (!ALLOWED_METHODS.has(method)) return { kind: 'denied', reason: 'method' }

  const origin = originOfUrl(input.url)
  if (origin === undefined) {
    // Distinguish the two refusals a caller can fix: a non-HTTPS URL and a URL
    // that carries userinfo.
    let parsed: URL | undefined
    try { parsed = new URL(input.url) } catch { return { kind: 'denied', reason: 'scheme' } }
    if (parsed.protocol !== 'https:') return { kind: 'denied', reason: 'scheme' }
    return { kind: 'denied', reason: 'userinfo' }
  }
  if (!isCanonicalOrigin(scope.origin)) return { kind: 'denied', reason: 'origin' }
  if (origin !== scope.origin) return { kind: 'denied', reason: 'origin' }
  if (!isAuthHeaderName(scope.authHeader)) return { kind: 'denied', reason: 'auth-header' }
  if (!isAuthPrefix(scope.authPrefix)) return { kind: 'denied', reason: 'auth-header' }

  const headers = normalizeHeaders(input.headers, scope.authHeader)
  if (headers === undefined) return { kind: 'denied', reason: 'headers' }

  let body: string | undefined
  if (input.body !== undefined) {
    if (method === 'GET' || method === 'HEAD') return { kind: 'denied', reason: 'method' }
    // The bound is bytes; `String.length` counts UTF-16 units and would let a
    // multi-byte body through.
    if (byteLength(input.body) > MAX_HTTP_REQUEST_BYTES) return { kind: 'denied', reason: 'request-too-large' }
    body = input.body
  }

  const requestHeaders: Record<string, string> = {
    ...headers,
    [scope.authHeader || DEFAULT_AUTH_HEADER]: authHeaderValue(scope.authPrefix, secret),
  }

  let response: Response
  try {
    response = await deps.fetch(input.url, {
      method,
      headers: requestHeaders,
      ...(body === undefined ? {} : { body }),
      // A redirect would carry the credential to an origin nobody approved.
      redirect: 'error',
      credentials: 'omit',
      signal: deps.signal,
    })
  } catch (error) {
    // A caller-initiated abort is a cancellation; anything else is generalized
    // because a raw fetch error can echo the request and its headers.
    if (deps.signal.aborted) return { kind: 'cancelled' }
    return { kind: 'error', reason: classifyError(error) }
  }

  // Even with `redirect: 'error'`, compare where the response actually came
  // from: an adapter or proxy could rewrite the URL without a redirect status.
  const finalOrigin = originOfUrl(response.url || input.url)
  if (finalOrigin !== scope.origin) {
    await release(response)
    return { kind: 'denied', reason: 'redirect' }
  }

  const read = await readBounded(response, deps.signal)
  if (read.kind !== 'ok') return read

  const masked = maskValues(read.text, [secret])
  const clamped = clampBytes(masked, MAX_HTTP_RESPONSE_BYTES)
  // A response header can echo the credential too; a masked content type is
  // dropped rather than shown, and anything outside a media type is dropped.
  const rawContentType = response.headers.get('content-type') ?? undefined
  const safeContentType = rawContentType === undefined ? undefined : safeContentTypeOf(rawContentType, secret)
  return {
    kind: 'ok',
    status: response.status,
    ...(safeContentType ? { contentType: safeContentType } : {}),
    body: clamped.text,
    truncated: clamped.truncated,
  }
}

type ReadResult =
  | { kind: 'ok'; text: string }
  | { kind: 'error'; reason: 'network' | 'timeout' | 'tls' | 'unknown' }
  | { kind: 'cancelled' }
  | { kind: 'denied'; reason: 'response-too-large' }

async function readBounded(response: Response, signal: AbortSignal): Promise<ReadResult> {
  const limit = MAX_HTTP_RESPONSE_BYTES
  if (!response.body) {
    try {
      const text = await response.text()
      return byteLength(text) > limit ? { kind: 'denied', reason: 'response-too-large' } : { kind: 'ok', text }
    } catch (error) {
      return signal.aborted ? { kind: 'cancelled' } : { kind: 'error', reason: classifyError(error) }
    }
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      if (bytes + value.byteLength > limit) {
        // Refuse the whole response: a cut could split a credential or a UTF-8
        // sequence, and a partial body has no safe boundary to hand out.
        return { kind: 'denied', reason: 'response-too-large' }
      }
      chunks.push(decoder.decode(value, { stream: true }))
      bytes += value.byteLength
    }
    chunks.push(decoder.decode())
    return { kind: 'ok', text: chunks.join('') }
  } catch (error) {
    return signal.aborted ? { kind: 'cancelled' } : { kind: 'error', reason: classifyError(error) }
  } finally {
    // Release the socket without waiting for the rest of a body nobody wants.
    try { await reader.cancel() } catch { /* already closed */ }
  }
}

/** Cut on code-point boundaries, counted in UTF-8 bytes. */
function clampBytes(text: string, max: number): { text: string; truncated: boolean } {
  const encoder = new TextEncoder()
  if (encoder.encode(text).byteLength <= max) return { text, truncated: false }
  let out = ''
  let bytes = 0
  for (const char of text) {
    const size = encoder.encode(char).byteLength
    if (bytes + size > max) return { text: out, truncated: true }
    out += char
    bytes += size
  }
  return { text: out, truncated: true }
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

function safeContentTypeOf(value: string, secret: string): string | undefined {
  const base = value.split(';')[0]?.trim().toLowerCase() ?? ''
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(base)) return undefined
  // Never echo a header that happens to contain the credential.
  return maskValues(base, [secret]) === base ? base : undefined
}

async function release(response: Response): Promise<void> {
  try { await response.body?.cancel() } catch { /* already closed */ }
}

function classifyError(error: unknown): 'network' | 'timeout' | 'tls' | 'unknown' {
  const name = error instanceof Error ? error.name : ''
  if (name === 'AbortError') return 'timeout'
  if (name === 'TimeoutError') return 'timeout'
  if (name === 'TypeError') return 'network'
  return 'unknown'
}
