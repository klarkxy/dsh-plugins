import { describe, expect, it, vi } from 'vitest'
import { uploadZhihuSyncMedia, ZhihuSyncMediaError, type ZhihuSyncMediaOptions } from './sync-media.ts'

type SyncRequest = NonNullable<ZhihuSyncMediaOptions['syncRequest']>

// ── 测试图片字节夹具（真实文件头，可嗅探出宽高）────────────────────────────────

function pngBytes(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const dv = new DataView(b.buffer)
  dv.setUint32(8, 13)                       // IHDR length
  b.set([0x49, 0x48, 0x44, 0x52], 12)       // 'IHDR'
  dv.setUint32(16, w); dv.setUint32(20, h)  // width / height
  b[24] = 8; b[25] = 2                      // bit depth, color type
  return b
}
function gifBytes(w: number, h: number): Uint8Array {
  const b = new Uint8Array(13)
  b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  b[6] = w & 0xff; b[7] = (w >> 8) & 0xff
  b[8] = h & 0xff; b[9] = (h >> 8) & 0xff
  return b
}
function jpegBytes(w: number, h: number): Uint8Array {
  const b = new Uint8Array(20)
  b.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, (h >> 8) & 0xff, h & 0xff, (w >> 8) & 0xff, w & 0xff, 0x03])
  return b
}
function webpBytes(w: number, h: number): Uint8Array {
  const b = new Uint8Array(30)
  b.set([0x52, 0x49, 0x46, 0x46])
  b.set([0x57, 0x45, 0x42, 0x50], 8)
  b.set([0x56, 0x50, 0x38, 0x20], 12)       // 'VP8 '
  b.set([0x9d, 0x01, 0x2a], 23)             // start code
  const dv = new DataView(b.buffer)
  dv.setUint16(26, w, true); dv.setUint16(28, h, true)
  return b
}
function heicBytes(): Uint8Array {
  const b = new Uint8Array(12)
  b.set([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]) // ftyp heic
  return b
}
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64')

// ── 传输与 OSS 夹具 ───────────────────────────────────────────────────────────

const SECRET_STS = { access_key_id: 'STS.AKIDSECRET', secret_access_key: 'SKSECRET', security_token: 'STS-TOKEN-SECRET', expiration: 0 }
const APPLY_UPLOADING = {
  upload_state: 'UPLOADING', session_key: 'sess-1',
  upload_config: {
    vendor_code: 'ali',
    address: { endpoint: 'oss-cn-test.aliyuncs.com', bucket_name: 'bucket-x', object_name: 'img/o.png', is_cname: false },
  },
  upload_auth: SECRET_STS,
  upload_media: { key: 'obj-key-1', processes: 'proc-1' },
}
const COMMIT_OK = {
  upload_results: 'UPLOAD_SUCCESS', media_key: 'k-commit',
  media_meta: { width: 640, height: 480, format: 'png', size: 1234 },
  media_url: { primary: 'https://pic1.zhimg.com/orig.png', backups: [] },
}

type Call = { path: string; method: string; headers?: Record<string, string>; body?: unknown }

function transport(routes: Record<string, (call: Call) => unknown>) {
  const calls: Call[] = []
  const syncRequest: SyncRequest = async (path, init) => {
    calls.push({ path, method: init.method, headers: init.headers, body: init.body })
    const key = `${init.method} ${path.split('?')[0]}`
    const handler = routes[key]
    if (!handler) throw new ZhihuSyncMediaError('BAD_RESPONSE', `unmocked ${key}`)
    const out = handler({ path, method: init.method, headers: init.headers, body: init.body })
    return out
  }
  return { syncRequest, calls }
}

function options(partial: Partial<ZhihuSyncMediaOptions> = {}): ZhihuSyncMediaOptions {
  return {
    resolveCredentials: async () => ({ appKey: 'app-key-1234', appSecret: 'app-secret-abcd' }),
    timeoutMs: 1000,
    ...partial,
  }
}
const pngInput = (over: Record<string, unknown> = {}) => ({
  fileName: 'a.png', contentBase64: b64(pngBytes(4, 3)), scene: 'article' as const, ...over,
})

// ── 用例 ─────────────────────────────────────────────────────────────────────

describe('uploadZhihuSyncMedia', () => {
  it('秒传：apply UPLOAD_SUCCESS 直接完成，不走 OSS/commit', async () => {
    const { syncRequest, calls } = transport({
      [`POST /openapi/media/uploads`]: () => ({
        upload_state: 'UPLOAD_SUCCESS', session_key: 's-9',
        upload_media: { key: 'k1' },
        extra_params: { width: 800, height: 600, url: { primary: 'https://pic1.zhimg.com/instant.png', backups: [] } },
      }),
      'GET /openapi/media/images/s-9/watermark': () => ({
        state: 'success', watermark_image_token: 'v2-different', watermark_image_url: { primary: 'https://pic1.zhimg.com/wm.png' },
      }),
    })
    const res = await uploadZhihuSyncMedia(pngInput(), options({ syncRequest, fetcher: vi.fn() }), new AbortController().signal)
    expect(res.kind).toBe('image')
    expect(res.watermark).toBe(true)
    expect(res.url).toBe('https://pic1.zhimg.com/wm.png')
    expect(res.originalUrl).toBe('https://pic1.zhimg.com/instant.png')
    expect(res.mediaId).toBe('v2-different')
    expect(res.width).toBe(800)
    expect(calls.filter(c => c.method !== 'GET')).toHaveLength(1)
  })

  it('完整流程：apply→OSS PUT→commit→水印成功换 key', async () => {
    let ossCalls = 0
    const fetcher = vi.fn(async (url: string | URL, init?: RequestInit) => {
      ossCalls++
      expect(String(url)).toBe('https://bucket-x.oss-cn-test.aliyuncs.com/img/o.png')
      expect(init?.method).toBe('PUT')
      const h = init?.headers as Record<string, string>
      expect(h['x-oss-security-token']).toBe(SECRET_STS.security_token)
      expect(h.Authorization).toMatch(/^OSS STS\.AKIDSECRET:/)
      expect(h['Content-MD5']).toBeTruthy()
      expect(init?.redirect).toBe('error')
      return new Response('', { status: 200 })
    }) as unknown as typeof fetch
    const { syncRequest, calls } = transport({
      'POST /openapi/media/uploads': () => APPLY_UPLOADING,
      'PATCH /openapi/media/uploads/sess-1': () => COMMIT_OK,
      'GET /openapi/media/images/sess-1/watermark': () => ({
        state: 'success', watermark_image_token: 'wm-token-2', watermark_image_url: { primary: 'https://pic1.zhimg.com/wm2.png' },
      }),
    })
    const res = await uploadZhihuSyncMedia(pngInput(), options({ syncRequest, fetcher }), new AbortController().signal)
    expect(ossCalls).toBe(1)
    const apply = calls.find(c => c.method === 'POST')!
    expect(apply.headers?.['X-Media-Scene-Name']).toBe('article')
    expect(apply.headers?.['X-Upload-Content-Hash']).toMatch(/^[0-9a-f]{32}$/)
    const commit = calls.find(c => c.method === 'PATCH')!
    expect(commit.headers?.['X-Security-Token']).toBe(SECRET_STS.security_token)
    expect((commit.body as Record<string, unknown>).client_upload_state).toBe('UPLOAD_SUCCESS')
    expect((commit.body as Record<string, unknown>).processes).toBe('proc-1')
    expect(res.url).toBe('https://pic1.zhimg.com/wm2.png')
    expect(res.mediaId).toBe('wm-token-2')
    expect(res.watermark).toBe(true)
    expect(res.originalUrl).toBe('https://pic1.zhimg.com/orig.png')
  })

  it('水印 token 与原图 key 相同时降级为原图并告警', async () => {
    // pngBytes(4,3) 的 md5 = d13034383376ad93ec71af525931dbef → 原 key v2-{md5}；token 相同视为未真实水印。
    const { syncRequest } = transport({
      'POST /openapi/media/uploads': () => APPLY_UPLOADING,
      'PATCH /openapi/media/uploads/sess-1': () => COMMIT_OK,
      'GET /openapi/media/images/sess-1/watermark': () => ({
        state: 'success', watermark_image_token: 'v2-d13034383376ad93ec71af525931dbef', watermark_image_url: { primary: 'https://pic1.zhimg.com/wm.png' },
      }),
    })
    const fetcher = vi.fn(async () => new Response('', { status: 200 })) as unknown as typeof fetch
    const res = await uploadZhihuSyncMedia(pngInput(), options({ syncRequest, fetcher }), new AbortController().signal)
    expect(res.watermark).toBe(false)
    expect(res.url).toBe('https://pic1.zhimg.com/orig.png')
    expect(res.warnings).toContain('水印处理未完成，已使用未加水印的原图 URL。')
  })

  it('水印 URL 缺失时不自拼，降级为原图', async () => {
    const { syncRequest } = transport({
      'POST /openapi/media/uploads': () => APPLY_UPLOADING,
      'PATCH /openapi/media/uploads/sess-1': () => COMMIT_OK,
      'GET /openapi/media/images/sess-1/watermark': () => ({
        state: 'success', watermark_image_token: 'v2-different', watermark_image_url: {},
      }),
    })
    const fetcher = vi.fn(async () => new Response('', { status: 200 })) as unknown as typeof fetch
    const res = await uploadZhihuSyncMedia(pngInput(), options({ syncRequest, fetcher }), new AbortController().signal)
    expect(res.watermark).toBe(false)
    expect(res.url).toBe('https://pic1.zhimg.com/orig.png')
  })

  it('水印轮询超时降级原图', async () => {
    let polls = 0
    const { syncRequest } = transport({
      'POST /openapi/media/uploads': () => APPLY_UPLOADING,
      'PATCH /openapi/media/uploads/sess-1': () => COMMIT_OK,
      'GET /openapi/media/images/sess-1/watermark': () => { polls++; return { state: 'processing' } },
    })
    const fetcher = vi.fn(async () => new Response('', { status: 200 })) as unknown as typeof fetch
    const res = await uploadZhihuSyncMedia(pngInput(), options({
      syncRequest, fetcher,
      watermarkPoll: { intervalMs: 1, timeoutMs: 15 },
    }), new AbortController().signal)
    expect(polls).toBeGreaterThan(1)
    expect(res.watermark).toBe(false)
    expect(res.url).toBe('https://pic1.zhimg.com/orig.png')
    expect(res.warnings).toContain('水印处理未完成，已使用未加水印的原图 URL。')
  })

  it('OSS 凭证过期码刷新 apply 并重试一次', async () => {
    let applyCount = 0
    let putCount = 0
    const refreshed = JSON.parse(JSON.stringify(APPLY_UPLOADING)) as typeof APPLY_UPLOADING
    refreshed.upload_auth = { ...SECRET_STS, security_token: 'STS-TOKEN-2' }
    refreshed.upload_media = { key: 'obj-key-2', processes: 'proc-2' }
    const { syncRequest, calls } = transport({
      'POST /openapi/media/uploads': (c) => {
        applyCount++
        const body = c.body as Record<string, unknown>
        return applyCount === 1 ? APPLY_UPLOADING
          : (expect(body.session_key).toBe('sess-1'), refreshed)
      },
      'PATCH /openapi/media/uploads/sess-1': () => COMMIT_OK,
      'GET /openapi/media/images/sess-1/watermark': () => ({ state: 'failed' }),
    })
    const fetcher = vi.fn(async (_u: string | URL, init?: RequestInit) => {
      putCount++
      if (putCount === 1) {
        return new Response('<Error><Code>SecurityTokenExpired</Code></Error>', { status: 403 })
      }
      const h = init?.headers as Record<string, string>
      expect(h['x-oss-security-token']).toBe('STS-TOKEN-2')
      return new Response('', { status: 200 })
    }) as unknown as typeof fetch
    const res = await uploadZhihuSyncMedia(pngInput(), options({ syncRequest, fetcher }), new AbortController().signal)
    expect(applyCount).toBe(2)
    expect(putCount).toBe(2)
    expect(res.url).toBe('https://pic1.zhimg.com/orig.png')
    const commit = calls.find(c => c.method === 'PATCH')!
    expect((commit.body as Record<string, unknown>).client_upload_state).toBe('UPLOAD_SUCCESS')
  })

  it('OSS 二次失败仍 commit UPLOAD_FAIL 且抛错', async () => {
    const { syncRequest, calls } = transport({
      'POST /openapi/media/uploads': () => APPLY_UPLOADING,
      'PATCH /openapi/media/uploads/sess-1': () => COMMIT_OK,
      'GET /openapi/media/images/sess-1/watermark': () => ({ state: 'failed' }),
    })
    const fetcher = vi.fn(async () => new Response('<Error><Code>InvalidAccessKeyId</Code></Error>', { status: 403 })) as unknown as typeof fetch
    await expect(uploadZhihuSyncMedia(pngInput(), options({ syncRequest, fetcher }), new AbortController().signal))
      .rejects.toMatchObject({ code: 'OSS_ERROR' })
    const commit = calls.find(c => c.method === 'PATCH')!
    expect((commit.body as Record<string, unknown>).client_upload_state).toBe('UPLOAD_FAIL')
  })

  it('apply 凭证缺失时抛 BAD_RESPONSE', async () => {
    const missing = JSON.parse(JSON.stringify(APPLY_UPLOADING)) as typeof APPLY_UPLOADING
    delete (missing as Record<string, unknown>).upload_auth
    const { syncRequest } = transport({ 'POST /openapi/media/uploads': () => missing })
    await expect(uploadZhihuSyncMedia(pngInput(), options({ syncRequest, fetcher: vi.fn() }), new AbortController().signal))
      .rejects.toMatchObject({ code: 'BAD_RESPONSE' })
  })

  it('vendor_code 非 ali 时明确拒绝不假实现', async () => {
    const tx = JSON.parse(JSON.stringify(APPLY_UPLOADING)) as typeof APPLY_UPLOADING
    tx.upload_config.vendor_code = 'tx'
    const { syncRequest } = transport({ 'POST /openapi/media/uploads': () => tx })
    await expect(uploadZhihuSyncMedia(pngInput(), options({ syncRequest, fetcher: vi.fn() }), new AbortController().signal))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_VENDOR', vendorCode: 'tx' })
  })

  it('OSS endpoint 非 aliyuncs.com 时拒绝', async () => {
    const evil = JSON.parse(JSON.stringify(APPLY_UPLOADING)) as typeof APPLY_UPLOADING
    evil.upload_config.address.endpoint = 'evil.example.com'
    const { syncRequest } = transport({ 'POST /openapi/media/uploads': () => evil })
    const fetcher = vi.fn()
    await expect(uploadZhihuSyncMedia(pngInput(), options({ syncRequest, fetcher: fetcher as unknown as typeof fetch }), new AbortController().signal))
      .rejects.toMatchObject({ code: 'OSS_ERROR' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('kind:video 明确拒绝', async () => {
    const { syncRequest } = transport({})
    await expect(uploadZhihuSyncMedia(pngInput({ kind: 'video' }), options({ syncRequest }), new AbortController().signal))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' })
  })

  it('HEIC 报 NEEDS_TRANSCODE', async () => {
    const { syncRequest } = transport({})
    await expect(uploadZhihuSyncMedia({ fileName: 'a.heic', contentBase64: b64(heicBytes()), scene: 'pin' }, options({ syncRequest }), new AbortController().signal))
      .rejects.toMatchObject({ code: 'NEEDS_TRANSCODE' })
  })

  it('GIF/JPEG/WebP 可嗅探；未知格式与坏 base64 拒绝', async () => {
    // GIF 嗅探成功后会进入 apply 阶段；未 mock 路由时抛 BAD_RESPONSE 而非 UNSUPPORTED_TYPE。
    for (const [name, bytes] of [['gif', gifBytes(5, 6)], ['jpeg', jpegBytes(9, 7)], ['webp', webpBytes(9, 7)]] as const) {
      const { syncRequest } = transport({})
      const err = await uploadZhihuSyncMedia(pngInput({ fileName: `a.${name}`, contentBase64: b64(bytes) }), options({ syncRequest }), new AbortController().signal)
        .then(() => null, (e: ZhihuSyncMediaError) => e)
      expect(err?.code, name).toBe('BAD_RESPONSE')
      expect(err?.message, name).toContain('unmocked')
    }
    const { syncRequest } = transport({})
    const unknown = new Uint8Array(20); unknown.fill(0x11)
    await expect(uploadZhihuSyncMedia(pngInput({ contentBase64: b64(unknown) }), options({ syncRequest }), new AbortController().signal))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' })
    for (const bad of ['!!!', 'AAAA!', 'a=b', 'AAAA=BB']) {
      await expect(uploadZhihuSyncMedia(pngInput({ contentBase64: bad }), options({ syncRequest }), new AbortController().signal))
        .rejects.toMatchObject({ code: 'INVALID_INPUT' })
    }
    expect(jpegBytes(9, 7).length).toBe(20)
    expect(webpBytes(9, 7).length).toBe(30)
  })

  it('尺寸超限拒绝：长边与总像素', async () => {
    const { syncRequest } = transport({})
    await expect(uploadZhihuSyncMedia(pngInput({ contentBase64: b64(pngBytes(20000, 10)) }), options({ syncRequest }), new AbortController().signal))
      .rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    await expect(uploadZhihuSyncMedia(pngInput({ contentBase64: b64(pngBytes(16000, 14000)) }), options({ syncRequest }), new AbortController().signal))
      .rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })

  it('后续阶段的错误消息不泄露已下发的 STS 凭据', async () => {
    const { syncRequest } = transport({
      'POST /openapi/media/uploads': () => APPLY_UPLOADING,
      'PATCH /openapi/media/uploads/sess-1': () => {
        // 上游错误回显了刚下发的 STS——本模块必须抹掉。
        throw new Error(`upstream echoed ${SECRET_STS.access_key_id} / ${SECRET_STS.security_token} / ${SECRET_STS.secret_access_key}`)
      },
    })
    const fetcher = vi.fn(async () => new Response('', { status: 200 })) as unknown as typeof fetch
    await expect(uploadZhihuSyncMedia(pngInput(), options({ syncRequest, fetcher }), new AbortController().signal))
      .rejects.toSatisfy((e: Error) => {
        expect(e.message).not.toContain('STS.AKIDSECRET')
        expect(e.message).not.toContain('STS-TOKEN-SECRET')
        expect(e.message).not.toContain('SKSECRET')
        return true
      })
  })

  it('apply 阶段异常中的 app 凭据回显也脱敏', async () => {
    const { syncRequest } = transport({
      'POST /openapi/media/uploads': () => {
        throw new ZhihuSyncMediaError('AUTH_ERROR', 'upstream echoed app-key-1234 / app-secret-abcd verbatim')
      },
    })
    await expect(uploadZhihuSyncMedia(pngInput(), options({ syncRequest }), new AbortController().signal))
      .rejects.toSatisfy((e: Error) => {
        expect(e.message).not.toContain('app-key-1234')
        expect(e.message).not.toContain('app-secret-abcd')
        return true
      })
  })

  it('取消信号终止且不伪成功', async () => {
    const controller = new AbortController()
    controller.abort()
    const { syncRequest } = transport({})
    await expect(uploadZhihuSyncMedia(pngInput(), options({ syncRequest }), controller.signal))
      .rejects.toMatchObject({ code: 'CANCELLED' })
  })

  it('OSS 重定向被拒绝（redirect:error）', async () => {
    const { syncRequest } = transport({
      'POST /openapi/media/uploads': () => APPLY_UPLOADING,
      'PATCH /openapi/media/uploads/sess-1': () => COMMIT_OK,
      'GET /openapi/media/images/sess-1/watermark': () => ({ state: 'failed' }),
    })
    const fetcher = vi.fn(async (_u: string | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe('error')
      throw new TypeError('redirect mode is set to error')
    }) as unknown as typeof fetch
    await expect(uploadZhihuSyncMedia(pngInput(), options({ syncRequest, fetcher }), new AbortController().signal))
      .rejects.toMatchObject({ code: 'OSS_ERROR' })
  })
})
