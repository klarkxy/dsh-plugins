/**
 * 知乎开放平台共享请求层:Access Secret 解析、超时封装、信封解析与执行计量。
 *
 * 端点规范（来源：github.com/klarkxy/zhihu-search，src/zhihu_search/upstream/http_client.py）：
 *   - Base URL: https://developer.zhihu.com
 *   - 公共 Headers: Authorization: Bearer <access_secret>、X-Request-Timestamp、Accept
 *   - 除直答外的 REST 接口返回 {Code, Message, Data} 信封,Code 非 0 表示业务错误。
 *
 * Token 解析顺序（按契约,**不**把 token 放进 schema 参数）：
 *   1. 可选的 credential 解析器（应用设置界面写入 `ZHIHU_ACCESS_TOKEN` 后,
 *      通过 `ctx.credentials.resolve` 取回）;命中即返回,source 标记为 `credential`。
 *   2. 环境变量 ZHIHU_ACCESS_TOKEN
 *   3. 环境变量 ZHIHU_ACCESS_SECRET（zhihu-search CLI 同名变量）
 *   4. ~/.config/zhihu-search/credentials.json 的 access_secret 字段
 * 都没有则抛出带中文配置指引的 TOKEN_MISSING。
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ZhihuQuotaId } from './quota.ts'

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
  /** Resolve the Access Secret via host-managed credentials (e.g. the settings UI). */
  resolveCredential?: () => Promise<string | undefined>
}

export async function resolveZhihuToken(
  env: NodeJS.ProcessEnv = process.env,
  options: ZhihuSearchResolveOptions = {},
): Promise<ZhihuSearchToken> {
  if (options.resolveCredential) {
    const fromCredential = (await options.resolveCredential())?.trim()
    if (fromCredential && looksLikeToken(fromCredential)) {
      return { token: fromCredential, source: 'credential' }
    }
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

export class ZhihuSearchError extends Error {
  readonly code: 'TOKEN_MISSING' | 'TOKEN_INVALID' | 'HTTP_ERROR' | 'TIMEOUT' | 'CANCELLED' | 'BAD_RESPONSE' | 'INVALID_ARGUMENTS' | 'RATE_LIMITED' | 'RISK_CONTROL' | 'UPSTREAM_UNAVAILABLE'
  readonly status?: number
  readonly apiCode?: number
  readonly retryAfter?: string
  constructor(code: ZhihuSearchError['code'], message: string, status?: number, details: { apiCode?: number; retryAfter?: string } = {}) {
    super(message)
    this.name = 'ZhihuSearchError'
    this.code = code
    if (status !== undefined) this.status = status
    this.apiCode = details.apiCode
    this.retryAfter = details.retryAfter
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

/**
 * 发起一次带鉴权与超时的知乎请求,返回解析后的 JSON 原文(信封由调用方处理)。
 * `label` 用于中文错误文案,如「知乎搜索」「知乎热榜」。
 */
export async function zhihuFetchJson(
  path: string,
  init: { method?: 'GET' | 'POST'; params?: Record<string, string>; body?: unknown; formData?: FormData; preserveInt64?: boolean },
  label: string,
  options: ZhihuClientOptions = {},
): Promise<unknown> {
  const token = await resolveZhihuToken(options.env, { resolveCredential: options.resolveCredential })
  const fetcher = options.fetcher ?? globalFetch
  if (!fetcher) throw new ZhihuSearchError('BAD_RESPONSE', '当前环境没有可用的 fetch。')

  const url = new URL(path, ZHIHU_BASE_URL)
  for (const [key, value] of Object.entries(init.params ?? {})) url.searchParams.set(key, value)

  const method = init.method ?? (init.formData || init.body !== undefined ? 'POST' : 'GET')
  const timeout = options.timeoutMs ?? ZHIHU_DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const linked = options.signal
  const onAbort = () => controller.abort(linked?.reason)
  if (linked) {
    if (linked.aborted) controller.abort(linked.reason)
    else linked.addEventListener('abort', onAbort, { once: true })
  }
  const timer = setTimeout(() => controller.abort(new Error('zhihu request timeout')), timeout)
  let response: Awaited<ReturnType<ZhihuSearchFetcher>>
  try {
    controller.signal.throwIfAborted()
    response = await fetcher(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${token.token}`,
        'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
        Accept: 'application/json',
        // multipart 的 Content-Type(含 boundary)由 fetch 自动生成,不能手写。
        ...(method === 'POST' && !init.formData ? { 'Content-Type': 'application/json' } : {}),
      },
      signal: controller.signal,
      ...(init.formData ? { body: init.formData } : init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    })
    if (linked?.aborted) throw new ZhihuSearchError('CANCELLED', '请求已取消。')
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new ZhihuSearchError('TOKEN_INVALID', '知乎 Access Secret 无效或无权访问，请检查凭据。', response.status)
      }
      if (response.status === 429) {
        throw new ZhihuSearchError('RATE_LIMITED', `${label}被限流（HTTP 429）。`, response.status, { retryAfter: response.headers?.get('Retry-After') ?? undefined })
      }
      // Some parameter/risk failures arrive as envelopes on HTTP 4xx.
      if (response.status < 500) {
        let body: unknown
        try { body = await response.json() } catch (error) { if (controller.signal.aborted) throw error }
        if (body && typeof body === 'object' && 'Code' in body) parseZhihuEnvelope(body, { status: response.status, retryAfter: response.headers?.get('Retry-After') ?? undefined })
      }
      throw new ZhihuSearchError('HTTP_ERROR', `${label}返回 HTTP ${response.status}。`, response.status)
    }
    let body: unknown
    try {
      body = init.preserveInt64
        ? JSON.parse(await response.text(), (_key: string, value: unknown, context?: { source?: string }) => {
            // Node >=22 supplies the original number token. Never round Int64 cursors or IDs.
            if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
              if (context?.source && /^-?\d+$/.test(context.source)) return context.source
              throw new Error('无法无损读取 Int64；请升级 Node.js')
            }
            return value
          })
        : await response.json()
      if (controller.signal.aborted) controller.signal.throwIfAborted()
    } catch (error) {
      if (controller.signal.aborted) throw error
      throw new ZhihuSearchError('BAD_RESPONSE', `${label}响应不是合法 JSON：${error instanceof Error ? error.message : String(error)}`)
    }
    if (body && typeof body === 'object' && 'Code' in body && Number(body.Code) !== 0) {
      parseZhihuEnvelope(body, { status: response.status, retryAfter: response.headers?.get('Retry-After') ?? undefined })
    }
    return body
  } catch (error) {
    if (linked?.aborted) throw new ZhihuSearchError('CANCELLED', '请求已取消。')
    if (error instanceof ZhihuSearchError) throw error
    if (isAbortError(error) || controller.signal.aborted) {
      throw new ZhihuSearchError('TIMEOUT', `${label}超时（${Math.round(timeout / 1000)} 秒），请稍后再试。`)
    }
    throw new ZhihuSearchError('BAD_RESPONSE', `${label}失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timer)
    if (linked) linked.removeEventListener('abort', onAbort)
  }
}

/** 解析信封，按主库分类鉴权、参数、限流和风控错误；返回 Data（缺省为 {}）。 */
export function parseZhihuEnvelope(body: unknown, transport: { status?: number; retryAfter?: string } = {}): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ZhihuSearchError('BAD_RESPONSE', '知乎响应缺少 {Code,Message,Data} 信封。')
  }
  const envelope = body as { Code?: unknown; Message?: unknown; Data?: unknown }
  if (!(typeof envelope.Code === 'number' && Number.isInteger(envelope.Code))
    && !(typeof envelope.Code === 'string' && /^\d+$/.test(envelope.Code))) {
    throw new ZhihuSearchError('BAD_RESPONSE', '知乎响应缺少有效的 Code 字段。')
  }
  const code = Number(envelope.Code)
  if (code !== 0) {
    const msg = typeof envelope.Message === 'string' ? envelope.Message : '未知错误'
    if (code === 30003) throw new ZhihuSearchError('RISK_CONTROL', `知乎请求被风控拒绝：${msg}。请不要立即重试。`, transport.status, { apiCode: code })
    if ([30001, 30002, 40003].includes(code)) throw new ZhihuSearchError('RATE_LIMITED', `知乎频率或额度限制：${msg}`, transport.status, { apiCode: code, retryAfter: transport.retryAfter })
    if (code === 20001) throw new ZhihuSearchError('TOKEN_INVALID', '知乎 Access Secret 无效或无权访问，请检查凭据。', transport.status, { apiCode: code })
    if ([10001, 40001, 40002, 40004, 40005, 40006].includes(code)) throw new ZhihuSearchError('INVALID_ARGUMENTS', `知乎参数错误：${msg}`, transport.status, { apiCode: code })
    if ([50002, 90001].includes(code)) throw new ZhihuSearchError('UPSTREAM_UNAVAILABLE', `知乎上游服务不可用：${msg}`, transport.status, { apiCode: code })
    throw new ZhihuSearchError('HTTP_ERROR', `知乎开放平台返回错误（code=${envelope.Code ?? '?'}）：${msg}`, transport.status, { apiCode: code })
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
