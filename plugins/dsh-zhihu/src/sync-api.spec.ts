import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  publishZhihuSync,
  syncRequest,
  ZhihuSyncApiError,
  ZHIHU_SYNC_DEFAULT_BASE_URL,
  type ZhihuSyncTransportOptions,
} from './sync-api.ts'
import type { SyncPrepared } from './sync-types.ts'

const creds = { appKey: 'test-user-token', appSecret: 'test-secret' }
const transport = (fetcher?: typeof fetch): ZhihuSyncTransportOptions => ({
  resolveCredentials: async () => creds,
  fetcher,
  timeoutMs: 5_000,
})

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const sign = (key: string, ts: string, logId: string, extra: string, secret: string) =>
  createHmac('sha256', secret).update(`app_key:${key}|ts:${ts}|logid:${logId}|extra_info:${extra}`, 'utf8').digest('base64')

describe('syncRequest · URL allowlist', () => {
  it('accepts relative path on openapi.zhihu.com', async () => {
    const fetcher = vi.fn(async () => jsonResponse(200, { status: 0, data: { ok: 1 } })) as unknown as typeof fetch
    const r = await syncRequest('/openapi/publish', { method: 'POST', body: {} }, transport(fetcher))
    expect(r).toEqual({ ok: 1 })
    expect(fetcher).toHaveBeenCalledWith(`${ZHIHU_SYNC_DEFAULT_BASE_URL}/openapi/publish`, expect.any(Object))
  })
  it('rejects non-openapi origin absolute URL', async () => {
    await expect(syncRequest('https://evil.com/x', { method: 'GET' }, transport()))
      .rejects.toMatchObject({ code: 'INVALID_URL', definite: true })
  })
  it('rejects http:// absolute URL', async () => {
    await expect(syncRequest('http://openapi.zhihu.com/x', { method: 'GET' }, transport()))
      .rejects.toMatchObject({ code: 'INVALID_URL' })
  })
  it('accepts same-origin absolute URL (media commit_address)', async () => {
    const fetcher = vi.fn(async () => jsonResponse(200, { status: 0, data: {} })) as unknown as typeof fetch
    await syncRequest(`${ZHIHU_SYNC_DEFAULT_BASE_URL}/openapi/media/uploads/sk`, { method: 'PATCH', body: {} }, transport(fetcher))
    expect(fetcher).toHaveBeenCalledWith(`${ZHIHU_SYNC_DEFAULT_BASE_URL}/openapi/media/uploads/sk`, expect.any(Object))
  })
  it('rejects baseUrl other than official origin', async () => {
    await expect(syncRequest('/x', { method: 'GET' }, { ...transport(), baseUrl: 'https://mirror.example.com' }))
      .rejects.toMatchObject({ code: 'INVALID_URL' })
  })
})

describe('syncRequest · auth headers & signing', () => {
  it('sends all signed headers; X-Extra-Info empty still present', async () => {
    const fetcher = vi.fn(async () => jsonResponse(200, { status: 0, data: {} })) as unknown as typeof fetch
    await syncRequest('/openapi/publish', { method: 'POST', body: {} }, transport(fetcher))
    const headers = (fetcher as any).mock.calls[0][1].headers as Record<string, string>
    expect(headers['X-App-Key']).toBe(creds.appKey)
    expect(headers['X-Extra-Info']).toBe('')
    expect(headers['X-Log-Id']).toBeTruthy()
    const expected = sign(creds.appKey, headers['X-Timestamp'], headers['X-Log-Id'], '', creds.appSecret)
    expect(headers['X-Sign']).toBe(expected)
    expect(headers['Content-Type']).toBe('application/json')
  })
  it('custom extraInfo participates in signature', async () => {
    const fetcher = vi.fn(async () => jsonResponse(200, { status: 0, data: {} })) as unknown as typeof fetch
    await syncRequest('/openapi/publish', { method: 'POST', body: {}, extraInfo: 'v1' }, transport(fetcher))
    const headers = (fetcher as any).mock.calls[0][1].headers as Record<string, string>
    expect(headers['X-Extra-Info']).toBe('v1')
    expect(headers['X-Sign']).toBe(sign(creds.appKey, headers['X-Timestamp'], headers['X-Log-Id'], 'v1', creds.appSecret))
  })
  it('init.headers cannot override signed headers', async () => {
    await expect(syncRequest('/x', { method: 'GET', headers: { 'X-Sign': 'hack', 'X-App-Key': 'evil' } }, transport()))
      .rejects.toMatchObject({ code: 'INVALID_URL' })
    await expect(syncRequest('/x', { method: 'GET', headers: { 'Content-Type': 'text/plain' } }, transport()))
      .rejects.toMatchObject({ code: 'INVALID_URL' })
  })
  it('init.headers merges business headers (media scene/security)', async () => {
    const fetcher = vi.fn(async () => jsonResponse(200, { media_key: 'k' })) as unknown as typeof fetch
    await syncRequest('/openapi/media/uploads', {
      method: 'POST', body: {},
      headers: { 'X-Media-Scene-Name': 'article', 'X-Security-Token': 'tok', 'X-Upload-Content-Type': 'image/png' },
    }, transport(fetcher))
    const headers = (fetcher as any).mock.calls[0][1].headers as Record<string, string>
    expect(headers['X-Media-Scene-Name']).toBe('article')
    expect(headers['X-Security-Token']).toBe('tok')
    expect(headers['X-Upload-Content-Type']).toBe('image/png')
    expect(headers['X-Sign']).toBeTruthy()
  })
})

describe('syncRequest · envelope unwrapping', () => {
  it('publishes envelope status=0 → returns data', async () => {
    const fetcher = vi.fn(async () => jsonResponse(200, { status: 0, msg: 'success', data: { content_token: '42', url: 'https://zhuanlan.zhihu.com/p/42' } })) as unknown as typeof fetch
    const r = await syncRequest('/openapi/publish', { method: 'POST', body: {} }, transport(fetcher))
    expect(r).toEqual({ content_token: '42', url: 'https://zhuanlan.zhihu.com/p/42' })
  })
  it('envelope status!=0 → UPSTREAM_REJECTED definite, msg sanitized', async () => {
    const fetcher = vi.fn(async () => jsonResponse(200, { status: 1, msg: 'failed: ' + 'A'.repeat(200) })) as unknown as typeof fetch
    await expect(syncRequest('/x', { method: 'POST', body: {} }, transport(fetcher)))
      .rejects.toMatchObject({ code: 'UPSTREAM_REJECTED', definite: true, upstreamStatus: 1 })
  })
  it('media flat response (no status) returns body', async () => {
    const fetcher = vi.fn(async () => jsonResponse(200, { upload_state: 'UPLOADING', session_key: 'sk', upload_media: {} })) as unknown as typeof fetch
    const r = await syncRequest('/openapi/media/uploads', { method: 'POST', body: {} }, transport(fetcher)) as Record<string, unknown>
    expect(r.session_key).toBe('sk')
  })
  it('HTTP 401 → AUTH_REJECTED definite', async () => {
    const fetcher = vi.fn(async () => jsonResponse(401, {})) as unknown as typeof fetch
    await expect(syncRequest('/x', { method: 'GET' }, transport(fetcher)))
      .rejects.toMatchObject({ code: 'AUTH_REJECTED', definite: true, httpStatus: 401 })
  })
  it('HTTP 429 → RATE_LIMITED definite', async () => {
    const fetcher = vi.fn(async () => jsonResponse(429, {})) as unknown as typeof fetch
    await expect(syncRequest('/x', { method: 'GET' }, transport(fetcher)))
      .rejects.toMatchObject({ code: 'RATE_LIMITED', definite: true })
  })
  it('HTTP 500 → HTTP_ERROR non-definite', async () => {
    const fetcher = vi.fn(async () => jsonResponse(500, { msg: 'boom' })) as unknown as typeof fetch
    await expect(syncRequest('/x', { method: 'GET' }, transport(fetcher)))
      .rejects.toMatchObject({ code: 'HTTP_ERROR', definite: false, httpStatus: 500 })
  })
  it('HTTP 400 → HTTP_ERROR definite', async () => {
    const fetcher = vi.fn(async () => jsonResponse(400, {})) as unknown as typeof fetch
    await expect(syncRequest('/x', { method: 'GET' }, transport(fetcher)))
      .rejects.toMatchObject({ code: 'HTTP_ERROR', definite: true })
  })
  it('non-JSON body → BAD_RESPONSE non-definite on 200', async () => {
    const fetcher = vi.fn(async () => new Response('not json', { status: 200 })) as unknown as typeof fetch
    await expect(syncRequest('/x', { method: 'GET' }, transport(fetcher)))
      .rejects.toMatchObject({ code: 'BAD_RESPONSE', definite: false })
  })
  it('upstream msg with long secret-like strings is redacted', async () => {
    const fetcher = vi.fn(async () => jsonResponse(200, { status: 9, msg: 'bad creds: ' + 'A'.repeat(60) + '/' + 'B'.repeat(10) })) as unknown as typeof fetch
    try {
      await syncRequest('/x', { method: 'POST', body: {} }, transport(fetcher))
      expect.unreachable()
    } catch (e) {
      const err = e as ZhihuSyncApiError
      expect(err.message).not.toContain('A'.repeat(60))
      expect(err.message).toContain('<redacted>')
    }
  })
  it('upstream msg containing actual appKey is redacted (short secret)', async () => {
    const shortSecret = 'sk'
    const fetcher = vi.fn(async () => jsonResponse(200, { status: 9, msg: `token=${shortSecret} failed` })) as unknown as typeof fetch
    await expect(syncRequest('/x', { method: 'POST', body: {} }, {
      resolveCredentials: async () => ({ appKey: 'user-token', appSecret: shortSecret }),
      fetcher,
    })).rejects.toMatchObject({ code: 'UPSTREAM_REJECTED' })
    // Verify the actual error message doesn't leak the short secret.
    try {
      await syncRequest('/x', { method: 'POST', body: {} }, {
        resolveCredentials: async () => ({ appKey: 'user-token', appSecret: shortSecret }),
        fetcher,
      })
      expect.unreachable()
    } catch (e) {
      expect((e as Error).message).not.toContain(shortSecret)
      expect((e as Error).message).toContain('<redacted>')
    }
  })
  it('upstream msg containing appKey is redacted', async () => {
    const fetcher = vi.fn(async () => jsonResponse(200, { status: 9, msg: `invalid app_key: test-user-token` })) as unknown as typeof fetch
    try {
      await syncRequest('/x', { method: 'POST', body: {} }, transport(fetcher))
      expect.unreachable()
    } catch (e) {
      expect((e as Error).message).not.toContain('test-user-token')
      expect((e as Error).message).toContain('<redacted>')
    }
  })
  it('X-Sign in upstream msg is redacted', async () => {
    const calls: RequestInit[] = []
    const fetcher = vi.fn(async (_u: unknown, i?: RequestInit) => {
      calls.push(i!)
      return jsonResponse(200, { status: 9, msg: 'sig rejected: ' + i!.headers!['X-Sign'] })
    }) as unknown as typeof fetch
    try {
      await syncRequest('/x', { method: 'POST', body: {} }, transport(fetcher))
      expect.unreachable()
    } catch (e) {
      expect((e as Error).message).not.toContain(calls[0].headers!['X-Sign'])
    }
  })
  it('network error does not leak original message', async () => {
    const fetcher = vi.fn(async () => { throw new Error('ENOTFOUND secret-host.internal.com:8080 appKey=test-user-token') }) as unknown as typeof fetch
    try {
      await syncRequest('/x', { method: 'GET' }, transport(fetcher))
      expect.unreachable()
    } catch (e) {
      const err = e as ZhihuSyncApiError
      expect(err.code).toBe('NETWORK_ERROR')
      expect(err.message).not.toContain('secret-host')
      expect(err.message).not.toContain('appKey')
      expect(err.message).not.toContain('test-user-token')
    }
  })
  it('timeout covers body read not just headers', async () => {
    // fetcher resolves headers fast but body stalls → still TIMEOUT.
    // Mock Response.text() 必须监听 init.signal abort（Response 不自动继承 signal）。
    const fetcher = vi.fn(async (_u: unknown, init?: RequestInit) => {
      const res = new Response('', { status: 200 })
      Object.defineProperty(res, 'text', {
        value: () => new Promise<string>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
      })
      return res
    }) as unknown as typeof fetch
    await expect(syncRequest('/x', { method: 'GET' }, { ...transport(fetcher), timeoutMs: 50 }))
      .rejects.toMatchObject({ code: 'TIMEOUT' })
  })
  it('body read error → NETWORK_ERROR non-definite', async () => {
    const fetcher = vi.fn(async () => {
      const res = new Response('', { status: 200 })
      Object.defineProperty(res, 'text', { value: async () => { throw new Error('socket hangup') } })
      return res
    }) as unknown as typeof fetch
    await expect(syncRequest('/x', { method: 'GET' }, transport(fetcher)))
      .rejects.toMatchObject({ code: 'NETWORK_ERROR', definite: false })
  })
})

describe('syncRequest · timeout & cancellation', () => {
  it('classifies cancellation before dispatch as definitely not sent', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetcher = vi.fn() as unknown as typeof fetch
    await expect(syncRequest('/openapi/publish', { method: 'POST' }, transport(fetcher), controller.signal))
      .rejects.toMatchObject({ code: 'CANCELLED', definite: true })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('keeps a non-JSON server error uncertain', async () => {
    const fetcher = vi.fn(async () => new Response('<html>Unavailable</html>', { status: 503 })) as unknown as typeof fetch
    await expect(syncRequest('/openapi/publish', { method: 'POST' }, transport(fetcher)))
      .rejects.toMatchObject({ code: 'BAD_RESPONSE', definite: false })
  })
  it('timeout → TIMEOUT non-definite', async () => {
    const fetcher = vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })) as unknown as typeof fetch
    await expect(syncRequest('/x', { method: 'GET' }, { ...transport(fetcher), timeoutMs: 50 }))
      .rejects.toMatchObject({ code: 'TIMEOUT', definite: false })
  })
  it('caller abort → CANCELLED', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })) as unknown as typeof fetch
    const p = syncRequest('/x', { method: 'GET' }, transport(fetcher), controller.signal)
    controller.abort()
    await expect(p).rejects.toMatchObject({ code: 'CANCELLED' })
  })
  it('network failure → NETWORK_ERROR non-definite', async () => {
    const fetcher = vi.fn(async () => { throw new Error('dns fail') }) as unknown as typeof fetch
    await expect(syncRequest('/x', { method: 'GET' }, transport(fetcher)))
      .rejects.toMatchObject({ code: 'NETWORK_ERROR', definite: false })
  })
  it('missing credentials → TOKEN_MISSING', async () => {
    await expect(syncRequest('/x', { method: 'GET' }, { resolveCredentials: async () => ({ appKey: '', appSecret: '' }) }))
      .rejects.toMatchObject({ code: 'TOKEN_MISSING', definite: true })
  })
})

describe('publishZhihuSync', () => {
  const prepared: SyncPrepared = {
    draft: { type: 'article', title: 't', body: 'x'.repeat(20), format: 'markdown' },
    html: '<p>x</p>',
    issues: [],
    canPublish: true,
    counts: { titleChars: 1, bodyChars: 20, images: 0, topics: 0 },
  }
  it('sends publish envelope and returns url/contentToken/type', async () => {
    const fetcher = vi.fn(async () => jsonResponse(200, { status: 0, data: { content_token: '99', url: 'https://zhuanlan.zhihu.com/p/99', type: 'article' } })) as unknown as typeof fetch
    const r = await publishZhihuSync(prepared, transport(fetcher))
    expect(r).toEqual({ contentToken: '99', url: 'https://zhuanlan.zhihu.com/p/99', type: 'article' })
    const body = JSON.parse((fetcher as any).mock.calls[0][1].body)
    expect(body.type).toBe('article')
    expect(body.confirmed).toBe(true)
    expect(body.content.title).toBe('t')
  })
  it('missing content_token/url → BAD_RESPONSE', async () => {
    const fetcher = vi.fn(async () => jsonResponse(200, { status: 0, data: {} })) as unknown as typeof fetch
    await expect(publishZhihuSync(prepared, transport(fetcher))).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
  })
  it('upstream reject propagates', async () => {
    const fetcher = vi.fn(async () => jsonResponse(200, { status: 5, msg: 'quota' })) as unknown as typeof fetch
    await expect(publishZhihuSync(prepared, transport(fetcher))).rejects.toMatchObject({ code: 'UPSTREAM_REJECTED', definite: true })
  })
  it('status as string (malformed) → BAD_RESPONSE not UPSTREAM_REJECTED', async () => {
    const fetcher = vi.fn(async () => jsonResponse(200, { status: '0', data: { content_token: '1', url: 'https://zhuanlan.zhihu.com/p/1' } })) as unknown as typeof fetch
    await expect(publishZhihuSync(prepared, transport(fetcher))).rejects.toMatchObject({ code: 'BAD_RESPONSE', definite: false })
  })
  it('flat response without status → BAD_RESPONSE (not treated as publish success)', async () => {
    // publishZhihuSync 只接受 status===0 信封；{url,content_token} 裸响应不是合法成功。
    const fetcher = vi.fn(async () => jsonResponse(200, { url: 'https://zhuanlan.zhihu.com/p/1', content_token: '1' })) as unknown as typeof fetch
    await expect(publishZhihuSync(prepared, transport(fetcher))).rejects.toMatchObject({ code: 'BAD_RESPONSE', definite: false })
  })
  it('non-zhihu url → BAD_RESPONSE', async () => {
    const fetcher = vi.fn(async () => jsonResponse(200, { status: 0, data: { content_token: '1', url: 'https://evil.com/p/1', type: 'article' } })) as unknown as typeof fetch
    await expect(publishZhihuSync(prepared, transport(fetcher))).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
  })
  it('type mismatch → BAD_RESPONSE', async () => {
    const fetcher = vi.fn(async () => jsonResponse(200, { status: 0, data: { content_token: '1', url: 'https://zhuanlan.zhihu.com/p/1', type: 'question' } })) as unknown as typeof fetch
    await expect(publishZhihuSync(prepared, transport(fetcher))).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
  })
})
