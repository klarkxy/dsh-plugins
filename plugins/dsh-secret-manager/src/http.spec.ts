import { describe, expect, it } from 'vitest'
import { MAX_HTTP_RESPONSE_BYTES } from './contracts.ts'
import { authHeaderValue, performHttpRequest, type HttpScope } from './http.ts'

const scope = (overrides: Partial<HttpScope> = {}): HttpScope => ({
  origin: 'https://api.example.com',
  authHeader: 'Authorization',
  authPrefix: 'Bearer ',
  ...overrides,
})

function respond(body: string, init: { status?: number; contentType?: string; url?: string; onCancel?: () => void } = {}) {
  const response = new Response(body, {
    status: init.status ?? 200,
    headers: init.contentType ? { 'content-type': init.contentType } : undefined,
  })
  Object.defineProperty(response, 'url', { value: init.url ?? 'https://api.example.com/v1' })
  return response
}

function deps(fetchImpl: typeof fetch, signal = new AbortController().signal) {
  return { fetch: fetchImpl, signal }
}

const SECRET = 'dummy-secret-value'

describe('authHeaderValue', () => {
  it('uses the prefix verbatim', () => {
    expect(authHeaderValue('Bearer ', SECRET)).toBe(`Bearer ${SECRET}`)
    expect(authHeaderValue('', SECRET)).toBe(SECRET)
    expect(authHeaderValue('Token ', SECRET)).toBe(`Token ${SECRET}`)
  })
})

describe('performHttpRequest', () => {
  it('attaches the approved header and returns the body', async () => {
    let seen: RequestInit | undefined
    const outcome = await performHttpRequest(
      { url: 'https://api.example.com/v1/items', method: 'GET' },
      scope(),
      SECRET,
      deps(async (_url, init) => { seen = init; return respond('{"ok":true}', { contentType: 'application/json; charset=utf-8' }) }),
    )
    expect(outcome).toMatchObject({ kind: 'ok', status: 200, body: '{"ok":true}', contentType: 'application/json', truncated: false })
    const headers = seen?.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${SECRET}`)
    expect(seen?.redirect).toBe('error')
    expect(seen?.credentials).toBe('omit')
  })

  it('refuses a different origin before sending anything', async () => {
    let called = false
    const outcome = await performHttpRequest(
      { url: 'https://evil.example.net/v1', method: 'GET' },
      scope(),
      SECRET,
      deps(async () => { called = true; return respond('') }),
    )
    expect(outcome).toEqual({ kind: 'denied', reason: 'origin' })
    expect(called).toBe(false)
  })

  it('refuses plain http and a URL carrying credentials', async () => {
    const https = await performHttpRequest(
      { url: 'http://api.example.com/v1', method: 'GET' }, scope(), SECRET, deps(async () => respond('')),
    )
    expect(https).toEqual({ kind: 'denied', reason: 'scheme' })
    const userinfo = await performHttpRequest(
      { url: 'https://user:x@api.example.com/v1', method: 'GET' }, scope(), SECRET, deps(async () => respond('')),
    )
    expect(userinfo).toEqual({ kind: 'denied', reason: 'userinfo' })
  })

  it('refuses a response that came from somewhere else', async () => {
    const outcome = await performHttpRequest(
      { url: 'https://api.example.com/v1', method: 'GET' },
      scope(),
      SECRET,
      deps(async () => respond('moved', { url: 'https://other.example.com/v1' })),
    )
    expect(outcome).toEqual({ kind: 'denied', reason: 'redirect' })
  })

  it('refuses transport control headers and a second credential header', async () => {
    for (const headers of [{ host: 'evil' }, { 'content-length': '1' }, { cookie: 'a=b' }, { authorization: 'raw' }]) {
      const outcome = await performHttpRequest(
        { url: 'https://api.example.com/v1', method: 'POST', headers, body: '{}' },
        scope(),
        SECRET,
        deps(async () => respond('')),
      )
      expect(outcome, JSON.stringify(headers)).toEqual({ kind: 'denied', reason: 'headers' })
    }
  })

  it('refuses CONNECT and TRACE and a body on GET', async () => {
    for (const method of ['CONNECT', 'TRACE', 'TRACK']) {
      expect(await performHttpRequest({ url: 'https://api.example.com/v1', method }, scope(), SECRET, deps(async () => respond(''))))
        .toEqual({ kind: 'denied', reason: 'method' })
    }
    expect(await performHttpRequest(
      { url: 'https://api.example.com/v1', method: 'GET', body: 'x' }, scope(), SECRET, deps(async () => respond('')),
    )).toEqual({ kind: 'denied', reason: 'method' })
  })

  it('generalizes a network failure without echoing the request', async () => {
    const outcome = await performHttpRequest(
      { url: 'https://api.example.com/v1', method: 'GET' },
      scope(),
      SECRET,
      deps(async () => { throw new TypeError(`fetch failed for Bearer ${SECRET}`) }),
    )
    expect(outcome).toEqual({ kind: 'error', reason: 'network' })
    expect(JSON.stringify(outcome)).not.toContain(SECRET)
  })

  it('redacts the credential in a body that fits', async () => {
    const outcome = await performHttpRequest(
      { url: 'https://api.example.com/v1', method: 'GET' },
      scope(),
      SECRET,
      deps(async () => respond(`value=${SECRET}`)),
    )
    if (outcome.kind !== 'ok') throw new Error('expected ok')
    expect(outcome.body).toBe('value=[redacted]')
    expect(outcome.truncated).toBe(false)
  })

  it('redacts a short credential echoed in a response body', async () => {
    // Masking has no minimum length, so a seven-character value stored without
    // any strength policy is still removed from what the model reads.
    const short = 'demo123'
    const outcome = await performHttpRequest(
      { url: 'https://api.example.com/v1', method: 'GET' },
      scope(),
      short,
      deps(async () => respond(`token=${short}`, { contentType: `application/${short}` })),
    )
    if (outcome.kind !== 'ok') throw new Error('expected ok')
    expect(outcome.body).toBe('token=[redacted]')
    expect(outcome.contentType).toBeUndefined()
  })

  it('refuses an oversized body whole instead of cutting it', async () => {
    // The credential straddles where a cut would fall; returning no body is the
    // only boundary that cannot leak a prefix.
    const body = `${'a'.repeat(MAX_HTTP_RESPONSE_BYTES - 4)}${SECRET}${'b'.repeat(64)}`
    const outcome = await performHttpRequest(
      { url: 'https://api.example.com/v1', method: 'GET' },
      scope(),
      SECRET,
      deps(async () => respond(body)),
    )
    expect(outcome).toEqual({ kind: 'denied', reason: 'response-too-large' })
  })

  it('drops a content type that echoes the credential', async () => {
    const outcome = await performHttpRequest(
      { url: 'https://api.example.com/v1', method: 'GET' },
      scope(),
      SECRET,
      deps(async () => respond('ok', { contentType: `application/${SECRET}` })),
    )
    if (outcome.kind !== 'ok') throw new Error('expected ok')
    expect(outcome.contentType).toBeUndefined()
  })

  it('bounds the read and releases the stream', async () => {
    let cancelled = false
    let pulled = 0
    const overLimit = MAX_HTTP_RESPONSE_BYTES + 4_096
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled > overLimit) { controller.close(); return }
        pulled += 1_024
        controller.enqueue(new TextEncoder().encode('c'.repeat(1_024)))
      },
      cancel() { cancelled = true },
    })
    const response = new Response(stream, { status: 200 })
    Object.defineProperty(response, 'url', { value: 'https://api.example.com/v1' })
    const outcome = await performHttpRequest(
      { url: 'https://api.example.com/v1', method: 'GET' }, scope(), SECRET, deps(async () => response),
    )
    expect(outcome).toEqual({ kind: 'denied', reason: 'response-too-large' })
    expect(cancelled).toBe(true)
    expect(pulled).toBeLessThan(overLimit)
  })

  it('reports a caller abort as cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const outcome = await performHttpRequest(
      { url: 'https://api.example.com/v1', method: 'GET' },
      scope(),
      SECRET,
      deps(async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }) }, controller.signal),
    )
    expect(outcome).toEqual({ kind: 'cancelled' })
  })
})
