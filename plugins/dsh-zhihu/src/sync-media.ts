/**
 * 知乎官方媒体上传（仅图片）。协议来源：只读参考
 * zhihu-mediacloud-uploader v0.1.4（mediacloud_uploader/api.py、client.py、cloud/ali.py、
 * watermark_poller.py、image_validator.py），移植为 Node TypeScript 原生 fetch。
 *
 * 流程：本地校验 → ApplyUpload（POST /openapi/media/uploads）→ 阿里 OSS PutObject
 * （自建 HTTPS 直传，OSS v1 签名）→ CommitUpload（PATCH）→ 水印轮询
 * （GET /openapi/media/images/{id}/watermark）。秒传（UPLOAD_SUCCESS）跳过云直传。
 *
 * 安全约束：重定向拒绝；OSS 目的主机仅允许 https 且 *.aliyuncs.com；
 * 凭据、STS、签名绝不进入返回值或错误消息（统一脱敏）。
 */
import { createHash, createHmac } from 'node:crypto'
import { syncRequest, type ZhihuSyncTransportOptions } from './sync-api.ts'

export type ZhihuSyncMediaOptions = ZhihuSyncTransportOptions & {
  /** 测试注入点；缺省用 ./sync-api.ts 的共享签名传输。 */
  syncRequest?: typeof syncRequest
  /** 水印轮询节奏（测试可调快）。 */
  watermarkPoll?: {
    intervalMs?: number
    timeoutMs?: number
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  }
}

export type ZhihuSyncMediaInput = {
  fileName: string
  contentBase64: string
  scene: 'article' | 'question' | 'pin'
  kind?: 'image' | 'video'
}

export type ZhihuSyncMediaResult = {
  kind: 'image'
  /** 最终可公开 URL（水印成功时为水印图 URL）。 */
  url: string
  /** 水印前原图 URL（仅水印成功时有值）。 */
  originalUrl?: string
  /** 最终媒资 token：水印成功为服务端 watermark_image_token，否则为 v2-{md5}。 */
  mediaId?: string
  width?: number
  height?: number
  /** 仅当服务端确认返回了不同的水印图 key 时为 true；绝不自拼 URL 伪造。 */
  watermark?: boolean
  warnings?: string[]
}

// ── 错误 ───────────────────────────────────────────────────────────────────────

export type ZhihuSyncMediaErrorCode =
  | 'INVALID_INPUT' | 'UNSUPPORTED_TYPE' | 'NEEDS_TRANSCODE' | 'LIMIT_EXCEEDED'
  | 'API_ERROR' | 'AUTH_ERROR' | 'OSS_ERROR'
  | 'UNSUPPORTED_VENDOR' | 'SESSION_EXPIRED' | 'CANCELLED' | 'TIMEOUT' | 'BAD_RESPONSE'

export class ZhihuSyncMediaError extends Error {
  readonly code: ZhihuSyncMediaErrorCode
  readonly httpStatus?: number
  readonly vendorCode?: string
  constructor(code: ZhihuSyncMediaErrorCode, message: string, extra: { httpStatus?: number; vendorCode?: string } = {}) {
    super(message)
    this.name = 'ZhihuSyncMediaError'
    this.code = code
    if (extra.httpStatus !== undefined) this.httpStatus = extra.httpStatus
    if (extra.vendorCode !== undefined) this.vendorCode = extra.vendorCode
  }
}

// ── 常量 ───────────────────────────────────────────────────────────────────────

const PATH_APPLY_UPLOAD = '/openapi/media/uploads'
const PATH_COMMIT_UPLOAD = (sessionKey: string) => `/openapi/media/uploads/${sessionKey}`
const PATH_IMAGE_WATERMARK = (imageId: string) => `/openapi/media/images/${imageId}/watermark`

const TEMPLATE_IMAGE = 'image-upload-default'
const MEDIA_TYPE_IMAGE = 'image'
const PLATFORM_WEB = 'web'

const UPLOADING = 'UPLOADING'
const UPLOAD_SUCCESS = 'UPLOAD_SUCCESS'
const UPLOAD_FAIL = 'UPLOAD_FAIL'

const SIZE_LIMIT_GIF = 15 * 1024 * 1024
const SIZE_LIMIT_OTHER = 30 * 1024 * 1024
const MAX_LONG_SIDE = 4 * 4096
const MAX_TOTAL_PIXELS = 200_000_000

const WATERMARK_INTERVAL_MS = 500
const WATERMARK_TIMEOUT_MS = 30_000
const OSS_TIMEOUT_MS = 120_000

const VENDOR_ALI = 'ali'

const OSS_EXPIRED_CODES = new Set(['InvalidAccessKeyId', 'SecurityTokenExpired', 'AccessDenied', 'InvalidSecurityToken'])

// ── 工具 ───────────────────────────────────────────────────────────────────────

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** 从待抛出消息中抹除一切已知敏感串（STS、对象名等不参与签名但属临时授权信息）。 */
function redact(message: string, secrets: readonly string[]): string {
  let out = message
  for (const s of secrets) {
    if (s && s.length >= 4) out = out.split(s).join('[REDACTED]')
  }
  return out
}

function throwAborted(signal: AbortSignal): never {
  throw new ZhihuSyncMediaError('CANCELLED', '上传已取消。')
}

type MediaUrl = { primary: string; backups: string[] }
function parseMediaUrl(raw: unknown): MediaUrl | undefined {
  if (!record(raw)) return undefined
  const backups = Array.isArray(raw.backups) ? raw.backups.filter((b): b is string => typeof b === 'string') : []
  const primary = str(raw.primary) || backups[0] || ''
  return { primary, backups }
}
// 可公开图片 URL 只接受知乎真实图片域的 HTTPS 地址——上游若回内网/他域地址，
// 前端 preview 会变成 SSRF 通道。域名策略与 sync-content 图片引用一致。
const PUBLIC_IMAGE_HOST_RE = /^(?:[a-z0-9-]+\.)*(zhimg\.com|zhihu\.com)$/i
function publicImageUrl(u: MediaUrl | undefined): string {
  for (const candidate of [u?.primary, ...(u?.backups ?? [])]) {
    if (!candidate) continue
    try {
      const url = new URL(candidate)
      if (url.protocol !== 'https:' || url.username || url.password) continue
      if (!PUBLIC_IMAGE_HOST_RE.test(url.hostname)) continue
      return candidate
    } catch { continue }
  }
  return ''
}
const firstUrl = publicImageUrl // 兼容命名：语义即「首个合法可公开 URL」

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new ZhihuSyncMediaError('CANCELLED', '上传已取消。'))
    const timer = setTimeout(() => { cleanup(); resolve() }, ms)
    const onAbort = () => { cleanup(); reject(new ZhihuSyncMediaError('CANCELLED', '上传已取消。')) }
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', onAbort) }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

// ── 图片嗅探（只读文件头；不支持的格式明确报错，不静默改写）─────────────────────

type SniffedImage = { format: string; ext: string; contentType: string; width: number; height: number; gif: boolean }

function sniffImage(buf: Uint8Array): SniffedImage {
  const bad = () => new ZhihuSyncMediaError('UNSUPPORTED_TYPE',
    '无法识别图片格式，仅支持 JPEG / PNG / GIF / WebP / BMP；HEIC / AVIF / TIFF 等请先转换为上述格式。')
  if (buf.byteLength < 12) throw bad()

  // HEIC / HEIF / AVIF（ISOBMFF ftyp 品牌）——参考实现需转码，这里明确报错。
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) { // 'ftyp'
    const brand = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]).toLowerCase()
    if (/^(heic|heix|hevc|hevx|mif1|msf1|avif|avis)$/.test(brand)) {
      throw new ZhihuSyncMediaError('NEEDS_TRANSCODE',
        `检测到 ${brand.toUpperCase()} 格式，当前不内置转码，请先转换为 JPEG / PNG / WebP 后再上传。`)
    }
    throw bad()
  }

  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) {
    if (buf.byteLength < 24) throw bad()
    const w = (buf[16]! << 24 | buf[17]! << 16 | buf[18]! << 8 | buf[19]!) >>> 0
    const h = (buf[20]! << 24 | buf[21]! << 16 | buf[22]! << 8 | buf[23]!) >>> 0
    if (!w || !h) throw bad()
    return { format: 'PNG', ext: '.png', contentType: 'image/png', width: w, height: h, gif: false }
  }

  // GIF
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    if (buf.byteLength < 10) throw bad()
    const w = buf[6]! | (buf[7]! << 8)
    const h = buf[8]! | (buf[9]! << 8)
    if (!w || !h) throw bad()
    return { format: 'GIF', ext: '.gif', contentType: 'image/gif', width: w, height: h, gif: true }
  }

  // BMP
  if (buf[0] === 0x42 && buf[1] === 0x4d) { // 'BM'
    if (buf.byteLength < 26) throw bad()
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    if (dv.getUint32(14, true) < 40) throw bad()
    const w = Math.abs(dv.getInt32(18, true))
    const h = Math.abs(dv.getInt32(22, true))
    if (!w || !h) throw bad()
    return { format: 'BMP', ext: '.bmp', contentType: 'image/bmp', width: w, height: h, gif: false }
  }

  // WebP: RIFF....WEBP + VP8 / VP8L / VP8X chunk
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
    && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
    if (buf.byteLength < 30) throw bad()
    const four = String.fromCharCode(buf[12], buf[13], buf[14], buf[15])
    if (four === 'VP8X') {
      const w = (buf[24]! | (buf[25]! << 8) | (buf[26]! << 16)) + 1
      const h = (buf[27]! | (buf[28]! << 8) | (buf[29]! << 16)) + 1
      return { format: 'WEBP', ext: '.webp', contentType: 'image/webp', width: w, height: h, gif: false }
    }
    if (four === 'VP8L') {
      const bits = buf[21]! | (buf[22]! << 8) | (buf[23]! << 16) | (buf[24]! << 24)
      return { format: 'WEBP', ext: '.webp', contentType: 'image/webp',
        width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, gif: false }
    }
    if (four === 'VP8 ') {
      if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) throw bad()
      const w = (buf[26]! | (buf[27]! << 8)) & 0x3fff
      const h = (buf[28]! | (buf[29]! << 8)) & 0x3fff
      if (!w || !h) throw bad()
      return { format: 'WEBP', ext: '.webp', contentType: 'image/webp', width: w, height: h, gif: false }
    }
    throw bad()
  }

  // JPEG: FF D8 + SOF marker
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2
    while (off + 9 < buf.byteLength) {
      if (buf[off] !== 0xff) { off++; continue }
      let marker = buf[off + 1]!
      while (marker === 0xff && off + 2 < buf.byteLength) { off++; marker = buf[off + 1]! }
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { off += 2; continue }
      if (off + 3 >= buf.byteLength) break
      const len = (buf[off + 2]! << 8) | buf[off + 3]!
      if (len < 2) break
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isSof && off + 8 < buf.byteLength) {
        const h = (buf[off + 5]! << 8) | buf[off + 6]!
        const w = (buf[off + 7]! << 8) | buf[off + 8]!
        if (!w || !h) throw bad()
        return { format: 'JPEG', ext: '.jpg', contentType: 'image/jpeg', width: w, height: h, gif: false }
      }
      off += 2 + len
    }
    throw bad()
  }

  throw bad()
}

function validateImage(meta: SniffedImage, sizeBytes: number): void {
  const limit = meta.gif ? SIZE_LIMIT_GIF : SIZE_LIMIT_OTHER
  if (sizeBytes > limit) {
    throw new ZhihuSyncMediaError('LIMIT_EXCEEDED',
      `图片大小超限（${(sizeBytes / 1048576).toFixed(1)} MB），上限 ${limit / 1048576} MB${meta.gif ? '（GIF）' : ''}，请压缩后重试。`)
  }
  const longSide = Math.max(meta.width, meta.height)
  if (longSide > MAX_LONG_SIDE) {
    throw new ZhihuSyncMediaError('LIMIT_EXCEEDED',
      `图片长边 ${longSide}px 超限，上限 ${MAX_LONG_SIDE}px。`)
  }
  if (meta.width * meta.height > MAX_TOTAL_PIXELS) {
    throw new ZhihuSyncMediaError('LIMIT_EXCEEDED', '图片总像素数超限（上限 2 亿像素）。')
  }
}

// ── 服务端下发数据解析 ─────────────────────────────────────────────────────────

type ApplyResponse = {
  state: string
  sessionKey: string
  vendorCode: string
  commitAddress: string
  objectKey: string
  processes: string
  extraParams: Record<string, unknown>
  auth?: { accessKeyId: string; secretAccessKey: string; securityToken: string; expiration: number }
  address?: { endpoint: string; bucketName: string; objectName: string; isCname: boolean }
}

function parseApply(data: unknown): ApplyResponse {
  if (!record(data)) throw new ZhihuSyncMediaError('BAD_RESPONSE', 'ApplyUpload 响应不是对象。')
  const config = record(data.upload_config) ? data.upload_config : {}
  const addressRaw = record(config.address) ? config.address : undefined
  const authRaw = record(data.upload_auth) ? data.upload_auth : undefined
  const media = record(data.upload_media) ? data.upload_media : {}
  return {
    state: str(data.upload_state),
    sessionKey: str(data.session_key),
    vendorCode: str(config.vendor_code),
    commitAddress: str(media.commit_address),
    objectKey: str(media.key),
    processes: str(media.processes),
    extraParams: record(data.extra_params) ? data.extra_params : {},
    auth: authRaw ? {
      accessKeyId: str(authRaw.access_key_id),
      secretAccessKey: str(authRaw.secret_access_key),
      securityToken: str(authRaw.security_token),
      expiration: num(authRaw.expiration),
    } : undefined,
    address: addressRaw ? {
      endpoint: str(addressRaw.endpoint),
      bucketName: str(addressRaw.bucket_name),
      objectName: str(addressRaw.object_name),
      isCname: addressRaw.is_cname === true,
    } : undefined,
  }
}

type CommitResponse = {
  result: string
  mediaKey: string
  mediaUrl?: MediaUrl
  width?: number
  height?: number
}

function parseCommit(data: unknown): CommitResponse {
  if (!record(data)) throw new ZhihuSyncMediaError('BAD_RESPONSE', 'CommitUpload 响应不是对象。')
  const meta = record(data.media_meta) ? data.media_meta : undefined
  return {
    result: str(data.upload_results),
    mediaKey: str(data.media_key),
    mediaUrl: parseMediaUrl(data.media_url),
    width: meta ? num(meta.width) || undefined : undefined,
    height: meta ? num(meta.height) || undefined : undefined,
  }
}

// ── 阿里 OSS PutObject（v1 签名，等价 oss2 StsAuth + Bucket.put_object）─────────

// OSS 主机与 bucket 的最小校验。只接受 aliyuncs.com 下的主机名与合法 bucket 名：
// 路径、端口、账号密码、反斜杠都可能把直传请求改投到别的主机上，而请求头里带着 STS 凭据。
const OSS_HOST_RE = /^(?:[a-z0-9-]+\.)*aliyuncs\.com$/
const OSS_BUCKET_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/

function ossEndpointHost(endpoint: string): string {
  const text = endpoint.trim()
  if (!text) throw new ZhihuSyncMediaError('BAD_RESPONSE', 'OSS endpoint 为空。')
  if (/^http:\/\//i.test(text)) throw new ZhihuSyncMediaError('OSS_ERROR', 'OSS endpoint 必须使用 HTTPS。')
  // 只接受裸主机名或 https://主机名。
  const host = text.replace(/^https:\/\//i, '').replace(/\/+$/, '').toLowerCase()
  if (!OSS_HOST_RE.test(host)) {
    throw new ZhihuSyncMediaError('OSS_ERROR', 'OSS endpoint 必须是不带路径、端口与账号密码的 aliyuncs.com 主机名。')
  }
  return host
}

/**
 * 拼出直传地址，并校验最终 URL：主机名必须与预期的合规主机完全一致，且不得带账号密码。
 * 返回的就是实际发出去的那个 URL——校验与请求必须是同一个地址。
 */
function ossTargetUrl(bucket: string, host: string, encodedKey: string, isCname: boolean): string {
  if (!OSS_BUCKET_RE.test(bucket)) {
    throw new ZhihuSyncMediaError('BAD_RESPONSE', 'OSS bucket 名称不合法。')
  }
  const requestHost = isCname ? host : `${bucket}.${host}`
  let target: URL
  try {
    target = new URL(`https://${requestHost}/${encodedKey}`)
  } catch {
    throw new ZhihuSyncMediaError('OSS_ERROR', 'OSS 目标地址不合法。')
  }
  if (target.protocol !== 'https:' || target.username || target.password || target.hostname !== requestHost) {
    throw new ZhihuSyncMediaError('OSS_ERROR', 'OSS 目标地址不合法。')
  }
  return target.toString()
}

function encodeObjectName(name: string): string {
  return name.split('/').map(seg => encodeURIComponent(seg)).join('/')
}

type OssCredentials = { accessKeyId: string; secretAccessKey: string; securityToken: string }

/**
 * OSS v1 header 签名：
 * StringToSign = VERB \n Content-MD5 \n Content-Type \n Date \n x-oss-* \n CanonicalizedResource
 */
function ossAuthorization(verb: string, contentMd5B64: string, contentType: string, date: string,
  auth: OssCredentials, bucket: string, encodedKey: string): string {
  const canonicalHeaders = `x-oss-security-token:${auth.securityToken}\n`
  const canonicalResource = `/${bucket}/${encodedKey}`
  const toSign = `${verb}\n${contentMd5B64}\n${contentType}\n${date}\n${canonicalHeaders}${canonicalResource}`
  const sig = createHmac('sha1', auth.secretAccessKey).update(toSign, 'utf8').digest('base64')
  return `OSS ${auth.accessKeyId}:${sig}`
}

function parseOssErrorCode(xml: string): string {
  const m = /<Code>([^<]+)<\/Code>/i.exec(xml)
  return m ? m[1]!.trim() : ''
}

async function ossPutObject(
  fetcher: typeof fetch,
  auth: OssCredentials,
  address: NonNullable<ApplyResponse['address']>,
  body: Uint8Array,
  contentType: string,
  md5B64: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<{ ok: true } | { ok: false; ossCode: string; status: number }> {
  const host = ossEndpointHost(address.endpoint)
  const encodedKey = encodeObjectName(address.objectName)
  const url = ossTargetUrl(address.bucketName, host, encodedKey, address.isCname)
  const date = new Date().toUTCString()
  const authorization = ossAuthorization('PUT', md5B64, contentType, date, auth, address.bucketName, encodedKey)

  const controller = new AbortController()
  const onAbort = () => controller.abort(signal.reason)
  if (signal.aborted) onAbort()
  else signal.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('oss put timeout')), timeoutMs)
  try {
    const res = await fetcher(url, {
      method: 'PUT',
      redirect: 'error',
      headers: {
        Date: date,
        'Content-Type': contentType,
        'Content-MD5': md5B64,
        'x-oss-security-token': auth.securityToken,
        Authorization: authorization,
      },
      body: body as unknown as BodyInit,
      signal: controller.signal,
    })
    if (res.ok) return { ok: true }
    const text = await res.text().catch(() => '')
    return { ok: false, ossCode: parseOssErrorCode(text), status: res.status }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}

function resolveSyncRequest(options: ZhihuSyncMediaOptions): typeof syncRequest {
  return options.syncRequest ?? syncRequest
}

// ── 主入口 ─────────────────────────────────────────────────────────────────────

export async function uploadZhihuSyncMedia(
  input: ZhihuSyncMediaInput,
  options: ZhihuSyncMediaOptions,
  signal: AbortSignal,
): Promise<ZhihuSyncMediaResult> {
  const secrets: string[] = []
  try {
    return await uploadImpl(input, options, signal, secrets)
  } catch (error) {
    if (error instanceof ZhihuSyncMediaError) {
      error.message = redact(error.message, secrets)
      throw error
    }
    throw new ZhihuSyncMediaError('API_ERROR', redact(
      `媒体上传失败：${error instanceof Error ? error.message : String(error)}`, secrets))
  }
}

async function uploadImpl(
  input: ZhihuSyncMediaInput,
  options: ZhihuSyncMediaOptions,
  signal: AbortSignal,
  secrets: string[],
): Promise<ZhihuSyncMediaResult> {
  if (signal.aborted) throwAborted(signal)
  if (input.kind !== undefined && input.kind !== 'image') {
    throw new ZhihuSyncMediaError('UNSUPPORTED_TYPE', '当前仅支持图片上传；视频与对象文件未接入。')
  }
  const scene = input.scene
  if (scene !== 'article' && scene !== 'question' && scene !== 'pin') {
    throw new ZhihuSyncMediaError('INVALID_INPUT', `scene 必须是 article / question / pin，收到 ${String(scene)}。`)
  }
  const fileName = (input.fileName.trim().split(/[\\/]/).pop() ?? '').trim()
  if (!fileName || [...fileName].some(ch => (ch.codePointAt(0) ?? 0) < 32 || ch.codePointAt(0) === 127)) {
    throw new ZhihuSyncMediaError('INVALID_INPUT', 'fileName 不能为空且不能包含控制字符。')
  }
  const b64 = input.contentBase64.trim()
  // Buffer.from 对非法字符静默跳过，必须先严格校验，避免混入内容被当图片上传。
  if (!b64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 !== 0) {
    throw new ZhihuSyncMediaError('INVALID_INPUT', 'contentBase64 不是合法 base64。')
  }
  const bytes = new Uint8Array(Buffer.from(b64, 'base64'))
  if (!bytes.byteLength) throw new ZhihuSyncMediaError('INVALID_INPUT', '图片内容为空。')

  const meta = sniffImage(bytes)
  validateImage(meta, bytes.byteLength)

  const md5Hex = createHash('md5').update(bytes).digest('hex')
  const md5B64 = createHash('md5').update(bytes).digest('base64')
  const syncRequest = resolveSyncRequest(options)
  // 提前登记 app 凭据用于错误消息脱敏（transport 会再解析一次，失败由其报错）。
  try {
    const creds = await options.resolveCredentials()
    if (creds?.appKey) secrets.push(creds.appKey)
    if (creds?.appSecret) secrets.push(creds.appSecret)
  } catch { /* 凭据解析失败由 syncRequest 统一报错 */ }
  if (signal.aborted) throwAborted(signal)

  const warnings: string[] = []
  const applyBody: Record<string, unknown> = {
    template_name: TEMPLATE_IMAGE,
    media_type: MEDIA_TYPE_IMAGE,
    file_name: fileName,
    file_extension: meta.ext,
    file_size: bytes.byteLength,
  }
  const applyHeaders = {
    'X-Media-Scene-Name': scene,
    'X-Media-Upload-Platform': PLATFORM_WEB,
    'X-Upload-Content-Type': meta.contentType,
    'X-Upload-Content-Hash': md5Hex,
  }

  let apply = parseApply(await syncRequest(PATH_APPLY_UPLOAD, { method: 'POST', headers: applyHeaders, body: applyBody }, options, signal))
  if (apply.auth) secrets.push(apply.auth.accessKeyId, apply.auth.secretAccessKey, apply.auth.securityToken)
  if (signal.aborted) throwAborted(signal)

  let mediaKey = ''
  let mediaUrl: MediaUrl | undefined
  let width = meta.width
  let height = meta.height

  if (apply.state === UPLOAD_SUCCESS) {
    // 秒传：apply 阶段即完成，extra_params 内嵌 meta 与 url。
    const ep = apply.extraParams
    mediaUrl = parseMediaUrl(ep.url)
    mediaKey = apply.objectKey
    width = num(ep.width) || width
    height = num(ep.height) || height
  } else if (apply.state === UPLOADING) {
    if (apply.vendorCode !== VENDOR_ALI) {
      throw new ZhihuSyncMediaError('UNSUPPORTED_VENDOR',
        `服务端下发未实现的云厂商 ${apply.vendorCode || '(空)'}；当前仅支持阿里 OSS。`,
        { vendorCode: apply.vendorCode || undefined })
    }
    if (!apply.auth || !apply.address || !apply.auth.accessKeyId || !apply.auth.secretAccessKey
      || !apply.auth.securityToken || !apply.address.endpoint || !apply.address.bucketName || !apply.address.objectName) {
      throw new ZhihuSyncMediaError('BAD_RESPONSE', 'ApplyUpload 缺少 OSS 凭证或地址，无法直传。')
    }

    const fetcher = options.fetcher ?? (typeof fetch === 'function' ? fetch : undefined)
    if (!fetcher) throw new ZhihuSyncMediaError('BAD_RESPONSE', '当前环境没有可用的 fetch。')

    // OSS 直传；凭证过期码时携带 session_key 重调 apply 刷新一次。
    let oss = await ossPut(fetcher, apply, bytes, meta.contentType, md5B64, signal, options.timeoutMs)
    if (!oss.ok && OSS_EXPIRED_CODES.has(oss.ossCode)) {
      const refreshed = parseApply(await syncRequest(PATH_APPLY_UPLOAD, {
        method: 'POST', headers: applyHeaders,
        body: { template_name: TEMPLATE_IMAGE, media_type: MEDIA_TYPE_IMAGE, session_key: apply.sessionKey },
      }, options, signal))
      if (refreshed.state === UPLOAD_FAIL || !refreshed.sessionKey) {
        throw new ZhihuSyncMediaError('SESSION_EXPIRED', '上传会话已过期，刷新凭证被拒绝。')
      }
      apply = refreshed
      if (apply.auth) secrets.push(apply.auth.accessKeyId, apply.auth.secretAccessKey, apply.auth.securityToken)
      if (!apply.auth || !apply.address) {
        throw new ZhihuSyncMediaError('BAD_RESPONSE', '刷新后的 ApplyUpload 缺少 OSS 凭证或地址。')
      }
      oss = await ossPut(fetcher, apply, bytes, meta.contentType, md5B64, signal, options.timeoutMs)
    }

    let ossError = ''
    if (!oss.ok) ossError = `OSS PutObject HTTP ${oss.status}${oss.ossCode ? ` code=${oss.ossCode}` : ''}`

    // 无论成败都 CommitUpload，保持服务端状态一致。
    const commitBody: Record<string, unknown> = {
      media_type: MEDIA_TYPE_IMAGE,
      client_upload_state: oss.ok ? UPLOAD_SUCCESS : UPLOAD_FAIL,
    }
    if (ossError) commitBody.error_log = ossError
    if (apply.processes) commitBody.processes = apply.processes
    const commit = parseCommit(await syncRequest(apply.commitAddress || PATH_COMMIT_UPLOAD(apply.sessionKey), {
      method: 'PATCH',
      headers: {
        'X-Media-Scene-Name': scene,
        'X-Media-Upload-Platform': PLATFORM_WEB,
        'X-Security-Token': apply.auth?.securityToken ?? '',
      },
      body: commitBody,
    }, options, signal))

    if (!oss.ok) throw new ZhihuSyncMediaError('OSS_ERROR', `云端直传失败：${ossError}`, { httpStatus: oss.status })
    if (commit.result !== UPLOAD_SUCCESS) {
      throw new ZhihuSyncMediaError('API_ERROR', `CommitUpload 未成功：${commit.result || '(空结果)'}。`)
    }
    mediaKey = commit.mediaKey || apply.objectKey
    mediaUrl = commit.mediaUrl
    width = commit.width ?? width
    height = commit.height ?? height
  } else {
    throw new ZhihuSyncMediaError('API_ERROR',
      `ApplyUpload 返回 ${apply.state || '(空状态)'}${apply.state === UPLOAD_FAIL ? '，会话被拒绝' : ''}。`)
  }

  // 图片成功：媒资 token 与 pier SDK 一致为 v2-{md5}。
  const originalKey = `v2-${md5Hex}`
  if (!mediaUrl || !firstUrl(mediaUrl)) {
    throw new ZhihuSyncMediaError('BAD_RESPONSE', '上传成功但服务端未返回可访问图片 URL。')
  }
  const originalUrl = firstUrl(mediaUrl)

  // ── 水印轮询：失败/超时降级原图；仅当 watermark key 与原 key 实际不同才算成功。
  const watermark = await pollWatermark(syncRequest, apply.sessionKey, scene, originalKey, options, signal, warnings)
  if (watermark) {
    return {
      kind: 'image',
      url: firstUrl(watermark.url),
      originalUrl,
      mediaId: watermark.token,
      width, height,
      watermark: true,
      ...(warnings.length ? { warnings } : {}),
    }
  }
  return {
    kind: 'image',
    url: originalUrl,
    mediaId: mediaKey && mediaKey !== apply.objectKey ? mediaKey : originalKey,
    width, height,
    watermark: false,
    ...(warnings.length ? { warnings } : {}),
  }
}

async function ossPut(
  fetcher: typeof fetch,
  apply: ApplyResponse,
  bytes: Uint8Array,
  contentType: string,
  md5B64: string,
  signal: AbortSignal,
  timeoutMs: number | undefined,
): Promise<{ ok: true } | { ok: false; ossCode: string; status: number }> {
  const auth = apply.auth!
  const address = apply.address!
  try {
    return await ossPutObject(fetcher, auth, address, bytes, contentType, md5B64, signal,
      timeoutMs && timeoutMs > 0 ? Math.max(timeoutMs, OSS_TIMEOUT_MS / 4) : OSS_TIMEOUT_MS)
  } catch (error) {
    if (error instanceof ZhihuSyncMediaError) throw error
    const name = (error as { name?: unknown })?.name
    if (name === 'AbortError') {
      if (signal.aborted) throwAborted(signal)
      throw new ZhihuSyncMediaError('TIMEOUT', '云端直传超时。')
    }
    return { ok: false, ossCode: '', status: 0 }
  }
}

type WatermarkOk = { token: string; url: MediaUrl }

async function pollWatermark(
  request: typeof syncRequest,
  imageId: string,
  scene: string,
  originalKey: string,
  options: ZhihuSyncMediaOptions,
  signal: AbortSignal,
  warnings: string[],
): Promise<WatermarkOk | undefined> {
  if (!imageId) return undefined
  const interval = options.watermarkPoll?.intervalMs ?? WATERMARK_INTERVAL_MS
  const timeout = options.watermarkPoll?.timeoutMs ?? WATERMARK_TIMEOUT_MS
  const doSleep = options.watermarkPoll?.sleep ?? sleep
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    if (signal.aborted) throwAborted(signal)
    let data: unknown
    try {
      // 单次请求超时不超过剩余轮询预算，避免多次 30s transport 超时放大总等待。
      const remaining = deadline - Date.now()
      const scoped = { ...options, timeoutMs: Math.max(1, Math.min(options.timeoutMs ?? 30_000, remaining)) }
      data = await request(PATH_IMAGE_WATERMARK(imageId), {
        method: 'GET', headers: { 'X-Media-Scene-Name': scene },
      }, scoped, signal)
    } catch (error) {
      if (signal.aborted) throwAborted(signal)
      const status = (error as { httpStatus?: unknown; status?: unknown })?.httpStatus
        ?? (error as { status?: unknown })?.status
      if (typeof status === 'number' && status >= 400 && status < 500) break // 永久错误：降级
      await doSleep(Math.min(interval, Math.max(0, deadline - Date.now())), signal)
      continue
    }
    if (!record(data)) break
    const state = str(data.state)
    if (state === 'success') {
      const token = str(data.watermark_image_token)
      const url = parseMediaUrl(data.watermark_image_url)
      // 水印必须返回不同的服务端 key 与真实 URL；相同或缺失一律降级，绝不自拼。
      if (url && firstUrl(url) && token && token !== originalKey) {
        if (!url.primary && url.backups[0]) warnings.push('水印图主 URL 为空，已使用备用 URL。')
        return { token, url }
      }
      break
    }
    if (state === 'failed') break
    await doSleep(Math.min(interval, Math.max(0, deadline - Date.now())), signal)
  }
  warnings.push('水印处理未完成，已使用未加水印的原图 URL。')
  return undefined
}
