/**
 * 知乎开放平台共享请求层:Access Secret 解析、超时封装、信封解析与执行计量。
 *
 * 端点规范（来源：github.com/klarkxy/zhihu-search，src/zhihu_search/upstream/http_client.py）：
 *   - Base URL: https://developer.zhihu.com
 *   - 公共 Headers: Authorization: Bearer <access_secret>、X-Request-Timestamp、Accept
 *   - 除直答外的 REST 接口返回 {Code, Message, Data} 信封,Code 非 0 表示业务错误。
 *
 * Token 解析（按契约,**不**把 token 放进 schema 参数）：
 *   - 提供 credential 解析器时只使用它，缺失或无效时抛出 TOKEN_MISSING。
 *     宿主通过 `ctx.credentials.resolve` 统一管理凭据来源和清除操作。
 *   - 未提供解析器的独立客户端依次兼容 ZHIHU_ACCESS_TOKEN、
 *     ZHIHU_ACCESS_SECRET 和 ~/.config/zhihu-search/credentials.json。
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ZhihuQuotaId } from './contracts.ts'

export const ZHIHU_BASE_URL = 'https://developer.zhihu.com'
export const ZHIHU_DEFAULT_TIMEOUT_MS = 15_000
export const ZHIHU_SUMMARY_MAX_CHARS = 200

const ZHIHU_CREDENTIALS_PRIMARY = 'ZHIHU_ACCESS_TOKEN'
const ZHIHU_CREDENTIALS_FALLBACK = 'ZHIHU_ACCESS_SECRET'
const ZHIHU_CREDENTIALS_FILE = join(homedir(), '.config', 'zhihu-search', 'credentials.json')

type TokenSource = 'credential' | 'env-primary' | 'env-fallback' | 'file'

export type ZhihuSearchToken = { token: string; source: TokenSource }

export type ZhihuSearchFetcher = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string | FormData; signal?: AbortSignal }) => Promise<{
  ok: boolean
  status: number
  headers?: { get(name: string): string | null }
  text(): Promise<string>
  json(): Promise<unknown>
}>

const globalFetch: ZhihuSearchFetcher | undefined = typeof globalThis !== 'undefined' && typeof (globalThis as { fetch?: unknown }).fetch === 'function'
  ? (input, init) => {
      const f = (globalThis as { fetch: typeof globalThis.fetch }).fetch
      return f(input as Parameters<typeof f>[0], init as Parameters<typeof f>[1] | undefined) as unknown as ReturnType<ZhihuSearchFetcher>
    }
  : undefined

function looksLikeToken(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length >= 8 && trimmed.length <= 256
}

async function readCredentialsFile(path: string): Promise<string | undefined> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as { access_secret?: unknown } | null
    if (parsed && typeof parsed === 'object' && typeof parsed.access_secret === 'string' && looksLikeToken(parsed.access_secret)) {
      return parsed.access_secret.trim()
    }
  } catch {
    // 文件不存在或 JSON 解析失败都不算硬错误，让上层回退到 isError 提示
  }
  return undefined
}

export type ZhihuSearchResolveOptions = {
  /** Authoritative Access Secret resolver; absence/invalid values never fall back to env or CLI files. */
  resolveCredential?: () => Promise<string | undefined>
}

export async function resolveZhihuToken(
  env: NodeJS.ProcessEnv = process.env,
  options: ZhihuSearchResolveOptions = {},
): Promise<ZhihuSearchToken> {
  if (options.resolveCredential) {
    const value = await options.resolveCredential()
    const fromCredential = typeof value === 'string' ? value.trim() : undefined
    if (fromCredential && looksLikeToken(fromCredential)) {
      return { token: fromCredential, source: 'credential' }
    }
    throw new ZhihuSearchError('TOKEN_MISSING', '未配置有效的知乎 Access Secret。请在「插件 → 知乎 → 设置」中填写。')
  }
  const primary = env[ZHIHU_CREDENTIALS_PRIMARY]?.trim()
  if (primary && looksLikeToken(primary)) return { token: primary, source: 'env-primary' }
  const fallback = env[ZHIHU_CREDENTIALS_FALLBACK]?.trim()
  if (fallback && looksLikeToken(fallback)) return { token: fallback, source: 'env-fallback' }
  const fromFile = await readCredentialsFile(ZHIHU_CREDENTIALS_FILE)
  if (fromFile) return { token: fromFile, source: 'file' }
  throw new ZhihuSearchError('TOKEN_MISSING', [
    '未找到知乎 Access Secret。请在「设置 → 知乎」中填写；',
    `也可设置环境变量 ${ZHIHU_CREDENTIALS_PRIMARY} 或写入 ~/.config/zhihu-search/credentials.json。`,
  ].join(''))
}

export type ZhihuErrorDetails = {
  upstreamCode?: number
  retryAfter?: number
  retryable?: boolean
}

export class ZhihuSearchError extends Error {
  readonly code: 'TOKEN_MISSING' | 'HTTP_ERROR' | 'TIMEOUT' | 'BAD_RESPONSE'
    | 'INVALID_ARGUMENTS' | 'TOKEN_INVALID' | 'RATE_LIMITED' | 'UPSTREAM_UNAVAILABLE' | 'CANCELLED'
  readonly status?: number
  readonly upstreamCode?: number
  readonly retryAfter?: number
  readonly retryable?: boolean
  constructor(code: ZhihuSearchError['code'], message: string, status?: number, details: ZhihuErrorDetails = {}) {
    super(message)
    this.name = 'ZhihuSearchError'
    this.code = code
    if (status !== undefined) this.status = status
    if (details.upstreamCode !== undefined) this.upstreamCode = details.upstreamCode
    if (details.retryAfter !== undefined) this.retryAfter = details.retryAfter
    if (details.retryable !== undefined) this.retryable = details.retryable
  }
}

/** Metering payload emitted after each zhihu tool execution. */
export type ZhihuSearchExecuted = { ok: boolean; results: number; quotaId?: ZhihuQuotaId }

/** Metering must never break the tool itself. */
export function reportExecuted(hook: ((event: ZhihuSearchExecuted) => void) | undefined, event: ZhihuSearchExecuted): void {
  if (!hook) return
  try {
    hook(event)
  } catch {
    // Best-effort metering; swallow hook failures.
  }
}

export type ZhihuClientOptions = ZhihuSearchResolveOptions & {
  fetcher?: ZhihuSearchFetcher
  /** Allows tests to bypass process env; defaults to process.env. */
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
  /** Override the request timeout in ms. Defaults to {@link ZHIHU_DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number
}

function isAbortError(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') return true
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
}

/** Parse Retry-After seconds or an HTTP date; never invent a quota reset time. */
export function parseZhihuRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value?.trim()) return undefined
  const text = value.trim()
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const seconds = Number(text)
    return Number.isFinite(seconds) ? Math.ceil(seconds) : undefined
  }
  // Do not let Date.parse interpret negative numbers as calendar dates.
  if (!/[a-z]/i.test(text)) return undefined
  const date = Date.parse(text)
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - now) / 1000)) : undefined
}

/**
 * Shared authenticated request. envelope=true opts into official error semantics
 * and returns Data. Legacy callers still receive the full JSON / chat response.
 * The timeout and cancellation cover BOTH headers and response-body consumption.
 * No requests are retried, including 429, exhausted quota, or risk-control denial.
 */
export async function zhihuFetchJson(
  path: string,
  init: { method?: 'GET' | 'POST'; params?: Record<string, string>; body?: unknown; formData?: FormData; envelope?: boolean },
  label: string,
  options: ZhihuClientOptions = {},
): Promise<unknown> {
  const linked = options.signal
  if (linked?.aborted) throw new ZhihuSearchError('CANCELLED', '请求已取消')
  const url = new URL(path, ZHIHU_BASE_URL)
  if (url.origin !== ZHIHU_BASE_URL || url.username || url.password) {
    throw new ZhihuSearchError('INVALID_ARGUMENTS', '只允许请求知乎开放平台。')
  }
  for (const [key, value] of Object.entries(init.params ?? {})) url.searchParams.set(key, value)
  const token = await resolveZhihuToken(options.env, { resolveCredential: options.resolveCredential })
  if (linked?.aborted) throw new ZhihuSearchError('CANCELLED', '请求已取消')
  const fetcher = options.fetcher ?? globalFetch
  if (!fetcher) throw new ZhihuSearchError('BAD_RESPONSE', '当前环境没有可用的 fetch。')
  const method = init.method ?? (init.formData || init.body !== undefined ? 'POST' : 'GET')
  const timeout = options.timeoutMs !== undefined && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs : ZHIHU_DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const onAbort = () => controller.abort(linked?.reason)
  if (linked?.aborted) onAbort()
  else linked?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('zhihu request timeout')), timeout)
  let stopWaiting = () => {}
  const aborted = new Promise<never>((_resolve, reject) => {
    const rejectAbort = () => reject(controller.signal.reason)
    if (controller.signal.aborted) rejectAbort()
    else {
      controller.signal.addEventListener('abort', rejectAbort, { once: true })
      stopWaiting = () => controller.signal.removeEventListener('abort', rejectAbort)
    }
  })
  try {
    const request = async () => {
      controller.signal.throwIfAborted()
      const response = await fetcher(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${token.token}`,
          'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
          Accept: 'application/json',
          // Let fetch supply the multipart boundary.
          ...(method === 'POST' && !init.formData ? { 'Content-Type': 'application/json' } : {}),
        },
        signal: controller.signal,
        ...(init.formData ? { body: init.formData } : init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      })
      const retryAfter = parseZhihuRetryAfter(response.headers?.get('Retry-After'))
      const httpError = () => {
        const code = response.status === 429 ? 'RATE_LIMITED'
          : init.envelope && (response.status === 401 || response.status === 403) ? 'TOKEN_INVALID'
          : 'HTTP_ERROR'
        return new ZhihuSearchError(code, `${label}返回 HTTP ${response.status}。`, response.status,
          code === 'RATE_LIMITED' ? { retryAfter, retryable: true } : {})
      }
      let body: unknown
      try { body = await response.json() }
      catch (error) {
        if (controller.signal.aborted) throw error
        if (!response.ok) throw httpError()
        throw new ZhihuSearchError('BAD_RESPONSE', `${label}响应不是合法 JSON。`)
      }
      controller.signal.throwIfAborted()
      // A business error remains meaningful even when the HTTP status is 400.
      const isEnvelope = body !== null && typeof body === 'object' && !Array.isArray(body) && 'Code' in body
      if (!response.ok && !isEnvelope) throw httpError()
      if (init.envelope || (isEnvelope && (body as { Code: unknown }).Code !== 0 && (body as { Code: unknown }).Code !== '0')) {
        const data = parseZhihuEnvelope(body, { status: response.status, retryAfter, officialErrors: init.envelope })
        if (!response.ok) throw httpError()
        if (init.envelope) return data
      }
      if (!response.ok) throw httpError()
      return body
    }
    return await Promise.race([request(), aborted])
  } catch (error) {
    if (linked?.aborted) throw new ZhihuSearchError('CANCELLED', '请求已取消')
    if (controller.signal.aborted || isAbortError(error)) {
      throw new ZhihuSearchError('TIMEOUT', `${label}超时（${Math.round(timeout / 1000)} 秒），请稍后再试。`)
    }
    if (error instanceof ZhihuSearchError) {
      error.message = error.message.replaceAll(token.token, '[REDACTED]')
      throw error
    }
    const message = (error instanceof Error ? error.message : String(error)).replaceAll(token.token, '[REDACTED]')
    throw new ZhihuSearchError('BAD_RESPONSE', `${label}失败：${message}`)
  } finally {
    clearTimeout(timer)
    stopWaiting()
    linked?.removeEventListener('abort', onAbort)
  }
}

const ZHIHU_BUSINESS_ERRORS: Record<number, ZhihuSearchError['code']> = {
  10001: 'INVALID_ARGUMENTS', 20001: 'TOKEN_INVALID',
  30001: 'RATE_LIMITED', 30002: 'RATE_LIMITED',
  40001: 'INVALID_ARGUMENTS', 40002: 'INVALID_ARGUMENTS', 40003: 'RATE_LIMITED',
  40004: 'INVALID_ARGUMENTS', 40005: 'INVALID_ARGUMENTS', 40006: 'INVALID_ARGUMENTS',
  50002: 'UPSTREAM_UNAVAILABLE', 90001: 'UPSTREAM_UNAVAILABLE',
}

/** Parse the official envelope without coercing null/false/empty Code into success. */
export function parseZhihuEnvelope(body: unknown, meta: { status?: number; retryAfter?: number; officialErrors?: boolean } = {}): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ZhihuSearchError('BAD_RESPONSE', '知乎响应缺少 {Code,Message,Data} 信封。', meta.status)
  }
  const envelope = body as { Code?: unknown; Message?: unknown; Data?: unknown }
  const rawCode = envelope.Code
  if (!((typeof rawCode === 'number' && Number.isSafeInteger(rawCode))
    || (typeof rawCode === 'string' && /^\d+$/.test(rawCode) && Number.isSafeInteger(Number(rawCode))))) {
    throw new ZhihuSearchError('BAD_RESPONSE', '知乎响应缺少有效的 Code 字段。', meta.status)
  }
  const code = Number(rawCode)
  if (code !== 0) {
    const message = typeof envelope.Message === 'string' && envelope.Message ? envelope.Message : '未知错误'
    if (code === 30003) {
      throw new ZhihuSearchError('UPSTREAM_UNAVAILABLE', `知乎开放平台被风控拒绝：${message}。请不要立即重试。`,
        meta.status, { upstreamCode: code, retryable: false })
    }
    const kind = ZHIHU_BUSINESS_ERRORS[code] ?? (meta.officialErrors ? 'UPSTREAM_UNAVAILABLE' : 'HTTP_ERROR')
    throw new ZhihuSearchError(kind, `知乎开放平台返回错误（code=${code}）：${message}`, meta.status,
      { upstreamCode: code, ...(kind === 'RATE_LIMITED' ? { retryAfter: meta.retryAfter, retryable: true } : {}) })
  }
  return envelope.Data ?? {}
}

function truncateSummary(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}…`
}

/** 搜索类接口（站内/全网）共用的条目结构。 */
export type ZhihuSearchItem = {
  title: string
  type: string
  url: string
  summary: string
  votes: number
  comments: number
  author: string
  authority: string
  editTime: string
}

export function normalizeSearchItem(raw: Record<string, unknown>): ZhihuSearchItem {
  const summary = typeof raw.ContentText === 'string' ? raw.ContentText : ''
  return {
    title: typeof raw.Title === 'string' && raw.Title.length > 0 ? raw.Title : '(无标题)',
    type: typeof raw.ContentType === 'string' && raw.ContentType.length > 0 ? raw.ContentType : '内容',
    url: typeof raw.Url === 'string' ? raw.Url : '',
    summary: truncateSummary(summary.trim(), ZHIHU_SUMMARY_MAX_CHARS),
    votes: typeof raw.VoteUpCount === 'number' ? raw.VoteUpCount : 0,
    comments: typeof raw.CommentCount === 'number' ? raw.CommentCount : 0,
    author: typeof raw.AuthorName === 'string' && raw.AuthorName.length > 0 ? raw.AuthorName : '匿名',
    authority: typeof raw.AuthorityLevel === 'string' && raw.AuthorityLevel.length > 0 ? raw.AuthorityLevel : '?',
    editTime: typeof raw.EditTime === 'number' ? String(raw.EditTime) : '',
  }
}
