/**
 * 知乎 OpenAPI 发布/媒体上传共享 HTTP 层（HMAC-SHA256 签名）。
 *
 * 契约来源（只读镜像 H:\Reference\zhihu-sync-full_v0.1.4，MIT / author zhihu）：
 *   zhihu-sync/zhihu-publish/reference/publish-openapi.md — POST /openapi/publish
 *   zhihu-mediacloud-uploader/mediacloud_uploader/api.py  — /openapi/media/* 上传三步
 *
 * 签名：
 *   sign_string = app_key:{X-App-Key}|ts:{X-Timestamp}|logid:{X-Log-Id}|extra_info:{X-Extra-Info}
 *   X-Sign      = Base64(HMAC-SHA256(sign_string, app_secret))
 *
 * 边界：
 *   - 请求目标 origin 固定为 openapi.zhihu.com。baseUrl 仅用于同源等价地址
 *     （如企业内部镜像）；任何非该 origin 的相对/绝对地址一律拒绝——媒体上传
 *     commit_address 等同源绝对 URL 也走同一校验。
 *   - 不跟随重定向（redirect:'error'）。
 *   - appSecret / X-Sign / 上游 msg 中的长 base64 串永不进入返回值、错误或日志；
 *     错误消息统一过 sanitizeMessage。
 *   - init.headers 只能「添加」业务头（媒体场景名/安全 token/内容 hash 等），
 *     不能覆盖 Content-Type 与任何 X-* 签名头；冲突时抛 INVALID_URL。
 *   - 信封解包：body 带 status 字段按发布信封（status!==0 → UPSTREAM_REJECTED，
 *     definite）；媒体 Apply/Commit 返回扁平 JSON（无 status）时原样返回。
 */
import { createHmac, randomUUID } from 'node:crypto'
import { buildZhihuPublishRequest } from './sync-content.ts'

export const ZHIHU_SYNC_DEFAULT_BASE_URL = 'https://openapi.zhihu.com'
export const ZHIHU_SYNC_PUBLISH_PATH = '/openapi/publish'
export const ZHIHU_SYNC_DEFAULT_TIMEOUT_MS = 30_000
export const ZHIHU_SYNC_ALLOWED_ORIGIN = 'https://openapi.zhihu.com'

export type ZhihuSyncErrorCode =
  | 'TOKEN_MISSING'
  | 'INVALID_URL'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'AUTH_REJECTED'
  | 'RATE_LIMITED'
  | 'UPSTREAM_REJECTED'
  | 'HTTP_ERROR'
  | 'BAD_RESPONSE'

/**
 * 发布/媒体调用错误。definite === true 表示已确定「这次请求没有成功」
 * （上游业务拒绝 / 鉴权拒绝 / 限流 / 参数错误 / URL 非法），可安全重试；
 * definite === false 表示结果不确定（超时 / 网络错 / 5xx / 异常响应），
 * service 必须保留 publishing 意图并提示用户核对，避免重复发送。
 */
export class ZhihuSyncApiError extends Error {
  constructor(
    readonly code: ZhihuSyncErrorCode,
    message: string,
    readonly definite: boolean,
    readonly httpStatus?: number,
    readonly upstreamStatus?: number,
    readonly upstreamMsg?: string,
  ) {
    super(message)
    this.name = 'ZhihuSyncApiError'
  }
}

export type ZhihuSyncTransportOptions = {
  /** 由调用方解析凭证；本层不持久化也不输出。 */
  resolveCredentials: () => Promise<{ appKey: string; appSecret: string }>
  /** 默认 globalThis.fetch；测试注入假 fetcher 验证请求。 */
  fetcher?: typeof fetch
  /** 单次请求超时（毫秒），默认 30s。 */
  timeoutMs?: number
  /**
   * 允许的请求 origin。即使显式传入，也仍要求与请求目标一致且为 HTTPS；
   * 推荐保持缺省 https://openapi.zhihu.com，测试用 fetcher 即可拦截。
   */
  baseUrl?: string
}

export type ZhihuSyncRequestInit = {
  method: 'GET' | 'POST' | 'PATCH'
  /** JSON body；自动 stringify 一次。 */
  body?: unknown
  /**
   * 附加业务头（媒体场景名 X-Media-Scene-Name、X-Security-Token、
   * X-Upload-Content-Type / -Hash 等）。不允许覆盖签名/内容类型头。
   */
  headers?: Record<string, string>
  /** 参与签名的 X-Extra-Info；缺省空字符串，即使为空也必须发送该头。 */
  extraInfo?: string
}

const SIGNED_HEADER_NAMES = new Set([
  'content-type',
  'x-app-key',
  'x-timestamp',
  'x-log-id',
  'x-extra-info',
  'x-sign',
])

/**
 * 上游错误消息脱敏。secrets 可能以任意长度/形态出现在上游 msg、HTTP body 或
 * 网络错误 message 中——只做长 base64/hex 替换不足以保护短 secret 或 appKey，
 * 因此对「当前凭据」与「签名值」做精确字符串替换，其余仍按长度折叠。
 */
function sanitizeMessage(value: unknown, secrets: readonly string[] = []): string {
  if (typeof value !== 'string' || !value) return ''
  let out = value
  for (const s of secrets) {
    if (s) out = out.split(s).join('<redacted>')
  }
  return out
    .replace(/[A-Za-z0-9+/=]{24,}/g, '<redacted>')
    .replace(/[0-9a-f]{32,}/gi, '<redacted>')
    .slice(0, 400)
}

function resolveBase(options: ZhihuSyncTransportOptions): URL {
  const raw = options.baseUrl ?? ZHIHU_SYNC_DEFAULT_BASE_URL
  let base: URL
  try {
    base = new URL(raw)
  } catch {
    throw new ZhihuSyncApiError('INVALID_URL', `无效的 baseUrl：${sanitizeMessage(raw)}`, true)
  }
  // 即使显式传入也只允许官方源；测试应注入 fetcher 而不是放宽目标主机。
  if (base.protocol !== 'https:' || base.origin !== ZHIHU_SYNC_ALLOWED_ORIGIN) {
    throw new ZhihuSyncApiError(
      'INVALID_URL',
      `OpenAPI baseUrl 必须等于 ${ZHIHU_SYNC_ALLOWED_ORIGIN}。`,
      true,
    )
  }
  return base
}

function syncUrl(pathOrUrl: string, base: URL): string {
  let url: URL
  if (/^https?:\/\//i.test(pathOrUrl)) {
    try {
      url = new URL(pathOrUrl)
    } catch {
      throw new ZhihuSyncApiError('INVALID_URL', `无效的请求地址：${sanitizeMessage(pathOrUrl)}`, true)
    }
  } else {
    try {
      url = new URL(pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`, base.origin + '/')
    } catch {
      throw new ZhihuSyncApiError('INVALID_URL', `无效的请求路径：${sanitizeMessage(pathOrUrl)}`, true)
    }
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new ZhihuSyncApiError('INVALID_URL', '请求地址必须为无账号密码的 HTTPS。', true)
  }
  if (url.origin !== base.origin) {
    throw new ZhihuSyncApiError(
      'INVALID_URL',
      `拒绝向非 OpenAPI 源发起请求：${url.origin}（允许 ${base.origin}）。`,
      true,
    )
  }
  return url.toString()
}

function sign(appKey: string, timestamp: string, logId: string, extraInfo: string, secret: string): string {
  const signString = `app_key:${appKey}|ts:${timestamp}|logid:${logId}|extra_info:${extraInfo}`
  return createHmac('sha256', secret).update(signString, 'utf8').digest('base64')
}

function buildHeaders(
  appKey: string,
  timestamp: string,
  logId: string,
  extraInfo: string,
  appSecret: string,
  extraHeaders: Record<string, string> | undefined,
): Record<string, string> {
  const signed: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-App-Key': appKey,
    'X-Timestamp': timestamp,
    'X-Log-Id': logId,
    'X-Extra-Info': extraInfo,
    'X-Sign': sign(appKey, timestamp, logId, extraInfo, appSecret),
  }
  for (const [name, value] of Object.entries(extraHeaders ?? {})) {
    const lower = name.toLowerCase()
    if (SIGNED_HEADER_NAMES.has(lower)) {
      throw new ZhihuSyncApiError(
        'INVALID_URL',
        `init.headers 不允许覆盖签名或内容类型头：${name}。`,
        true,
      )
    }
    signed[name] = value
  }
  return signed
}

/**
 * 发起一次签名 OpenAPI 请求并解包响应。
 *
 * 返回规则：
 *   - body 是对象且带 status 字段（发布信封）：status===0 → 返回 body.data；
 *     其余 → UPSTREAM_REJECTED（definite，消息含 status / 已脱敏 msg）。
 *   - body 不带 status（媒体 Apply/Commit 扁平响应）：原样返回 body。
 *   - 非 2xx：401→AUTH_REJECTED、429→RATE_LIMITED、5xx→HTTP_ERROR(不确定)、
 *     其他 4xx→HTTP_ERROR(definite)；若 body 是可解析信封仍按信封处理。
 */
export async function syncRequest(
  pathOrUrl: string,
  init: ZhihuSyncRequestInit,
  options: ZhihuSyncTransportOptions,
  signal?: AbortSignal,
): Promise<unknown> {
  const base = resolveBase(options)
  const url = syncUrl(pathOrUrl, base)
  const credentials = await options.resolveCredentials()
  const appKey = credentials.appKey?.trim()
  const appSecret = credentials.appSecret?.trim()
  if (!appKey || !appSecret) {
    throw new ZhihuSyncApiError('TOKEN_MISSING', '缺少知乎 OpenAPI 凭证（app key / app secret）。', true)
  }

  const timestamp = String(Math.floor(Date.now() / 1000))
  const logId = randomUUID().replace(/-/g, '')
  const extraInfo = init.extraInfo ?? ''
  const headers = buildHeaders(appKey, timestamp, logId, extraInfo, appSecret, init.headers)

  const fetcher = options.fetcher ?? globalThis.fetch
  if (!fetcher) throw new ZhihuSyncApiError('NETWORK_ERROR', '当前环境没有可用的 fetch。', false)

  // 参与脱敏的机密集合：凭据与本次签名值（X-Sign）。
  const secrets = [appKey, appSecret, headers['X-Sign']].filter(Boolean) as string[]

  const timeout = options.timeoutMs ?? ZHIHU_SYNC_DEFAULT_TIMEOUT_MS
  const timeoutController = new AbortController()
  const timer = setTimeout(() => timeoutController.abort(), timeout)
  const combined = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal

  let response: Response
  let text: string
  let body: unknown
  try {
    // pre-fetch abort（用户主动取消）是确定行为；fetch 已发出后 abort 结果不定。
    if (signal?.aborted) throw new ZhihuSyncApiError('CANCELLED', '请求已取消。', true)
    combined.throwIfAborted()
    response = await fetcher(url, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: 'error',
      signal: combined,
    })
    // 超时覆盖整个请求：headers 返回不代表结束，body 读取同样计入。
    // response.text() 不接收 abort signal——手动 race 超时；finally 移除监听防泄漏。
    let abortReject!: (e: unknown) => void
    const abortPromise = new Promise<never>((_, reject) => {
      abortReject = () => reject(new DOMException('aborted', 'AbortError'))
      combined.addEventListener('abort', abortReject, { once: true })
    })
    // 未决 reject 被 GC 前无害：race 已结束后 abort 触发只产生未消费拒绝。
    abortPromise.catch(() => {})
    try {
      text = await Promise.race([response.text(), abortPromise])
    } finally {
      combined.removeEventListener('abort', abortReject)
    }
    if (text) body = JSON.parse(text)
  } catch (error) {
    if (error instanceof ZhihuSyncApiError) throw error
    if (signal?.aborted) throw new ZhihuSyncApiError('CANCELLED', '请求已取消。', false)
    if (timeoutController.signal.aborted) {
      throw new ZhihuSyncApiError('TIMEOUT', `请求超时（${Math.round(timeout / 1000)}s）。`, false)
    }
    // JSON 解析失败（body 非 JSON）→ BAD_RESPONSE；其余 fetch/body 错误 → NETWORK_ERROR。
    // 非 JSON 响应结果不定（可能是代理/网关截断），始终非 definite——
    // 上游返回 5xx 时 body 可能是 HTML，同样不能当确定失败。
    if (error instanceof SyntaxError) {
      throw new ZhihuSyncApiError(
        'BAD_RESPONSE',
        `响应不是合法 JSON（HTTP ${response!.status}）。`,
        false,
        response!.status,
      )
    }
    // 网络错误不透传原始 message——可能含目标主机/凭据线索；统一脱敏。
    throw new ZhihuSyncApiError(
      'NETWORK_ERROR',
      '网络请求失败，请检查连接后重试。',
      false,
    )
  } finally {
    clearTimeout(timer)
  }

  const envelope = body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : undefined
  const hasStatus = envelope !== undefined && 'status' in envelope

  if (!response.ok) {
    if (hasStatus && typeof envelope!.status === 'number' && envelope!.status !== 0) {
      throw new ZhihuSyncApiError(
        'UPSTREAM_REJECTED',
        `发布被服务端拒绝（status=${envelope!.status}）：${sanitizeMessage(envelope!.msg, secrets)}`,
        true,
        response.status,
        envelope!.status,
        sanitizeMessage(envelope!.msg, secrets),
      )
    }
    if (hasStatus && typeof envelope!.status !== 'number') {
      throw new ZhihuSyncApiError(
        'BAD_RESPONSE',
        `发布响应 status 不是数字（收到 ${typeof envelope!.status}）。`,
        false,
        response.status,
      )
    }
    if (response.status === 401) {
      throw new ZhihuSyncApiError('AUTH_REJECTED', '鉴权失败（HTTP 401）。请检查 app key / app secret。', true, 401)
    }
    if (response.status === 429) {
      throw new ZhihuSyncApiError('RATE_LIMITED', '发布频率超限（每人每天最多 50 次）。', true, 429)
    }
    throw new ZhihuSyncApiError(
      'HTTP_ERROR',
      `HTTP ${response.status}：${sanitizeMessage(envelope?.msg, secrets) || '请求失败'}`,
      response.status >= 400 && response.status < 500,
      response.status,
      undefined,
      sanitizeMessage(envelope?.msg, secrets),
    )
  }

  if (hasStatus) {
    if (typeof envelope!.status === 'number' && envelope!.status === 0) {
      return envelope!.data
    }
    // status 非 0 数字 → 确定的业务拒绝；status 非数字（字符串/其他类型）→ 畸形响应。
    if (typeof envelope!.status === 'number') {
      throw new ZhihuSyncApiError(
        'UPSTREAM_REJECTED',
        `发布被服务端拒绝（status=${envelope!.status}）：${sanitizeMessage(envelope!.msg, secrets)}`,
        true,
        response.status,
        envelope!.status,
        sanitizeMessage(envelope!.msg, secrets),
      )
    }
    throw new ZhihuSyncApiError(
      'BAD_RESPONSE',
      `发布响应 status 不是数字（收到 ${typeof envelope!.status}）。`,
      false,
      response.status,
    )
  }
  return body
}

/** 知乎发布成功 URL：必须是 https 且属于知乎域（与 content 的 ZHIHU_DOMAIN_RE 一致）。 */
const ZHIHU_PUBLISH_DOMAIN_RE = /^([a-z0-9-]+\.)*(zhimg\.com|zhihu\.com)$/i
function isValidPublishUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'https:' && !u.username && !u.password && ZHIHU_PUBLISH_DOMAIN_RE.test(u.hostname)
  } catch { return false }
}

/**
 * 将 prepareZhihuSyncDraft 的结果组装并发送到 /openapi/publish。
 *
 * 发送前不做内容字段二次校验（发布字段唯一事实源是 SyncPrepared）；
 * 上层负责：预览确认、持久化 publishing 意图、按 definite 标记结果。
 */
export async function publishZhihuSync(
  prepared: unknown,
  options: ZhihuSyncTransportOptions,
  signal?: AbortSignal,
): Promise<{ url: string; contentToken: string; type: string }> {
  const request = buildZhihuPublishRequest(prepared)
  const data = await syncRequest(ZHIHU_SYNC_PUBLISH_PATH, { method: 'POST', body: request }, options, signal)
  // syncRequest 只在上游 status===0 时返回 data；扁平 {url,content_token} 无 status
  // 不会被当成成功（publish-openapi.md：成功判断 = status===0）。
  const row = (data ?? {}) as Record<string, unknown>
  const contentToken =
    typeof row.content_token === 'string' || typeof row.content_token === 'number'
      ? String(row.content_token)
      : ''
  const url = typeof row.url === 'string' ? row.url : ''
  const type = typeof row.type === 'string' ? row.type : ''
  if (!contentToken || !url) {
    throw new ZhihuSyncApiError('BAD_RESPONSE', '发布成功响应缺少 content_token 或 url。', false)
  }
  if (!isValidPublishUrl(url)) {
    throw new ZhihuSyncApiError('BAD_RESPONSE', `发布成功响应返回了无效的 url：${sanitizeMessage(url, [])}`, false)
  }
  if (type !== request.type) {
    throw new ZhihuSyncApiError('BAD_RESPONSE', `发布响应 type 与请求不一致：${String(type)} ≠ ${request.type}。`, false)
  }
  return { url, contentToken, type }
}
