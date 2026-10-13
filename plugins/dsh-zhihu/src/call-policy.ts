import { mkdir, open, readFile, rename, unlink, rmdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

/** Compatible with zhihu-search/call_policy.py; never contains credentials. */
export type ZhihuCallPolicyOptions = { allowPaid?: boolean; dailyCallLimit?: number; directory?: string; lockTimeoutMs?: number }
export class ZhihuCallPolicyError extends Error {}
const blocked = (message: string): never => { throw new ZhihuCallPolicyError(message) }
const GROUPS: Record<string, string> = {
  '/api/v1/content/zhihu_search': 'zhihu_search', '/api/v1/content/global_search': 'global_search',
  '/api/v1/content/hot_list': 'hot_list', '/api/v1/content/question_answers': 'question_discovery',
  '/api/v1/user/contents': 'user_data', '/api/v1/user/followees': 'user_data',
  '/api/v1/user/collections': 'user_data', '/api/v1/user/favlists': 'user_data', '/api/v1/user/favlist_contents': 'user_data',
  '/api/v1/user/content_detail': 'creator', '/api/v1/user/content_comments': 'creator',
  '/api/v1/user/creator_account_stats': 'creator', '/api/v1/user/creator_content_stats': 'creator',
  '/api/v1/knowledge/bases': 'knowledge', '/api/v1/knowledge/files': 'knowledge', '/api/v1/knowledge/search': 'knowledge',
}
const PRICED_PATHS = new Set(Object.keys(GROUPS))
GROUPS['/api/v1/user/question_recommendations'] = 'question_discovery'
export function zhihuQuotaGroup(path: string, body: unknown): string {
  if (path === '/v1/chat/completions' && body && typeof body === 'object' && ['zhida-agent', 'zhida-fast-1p5', 'zhida-thinking-1p5'].includes(String((body as { model?: unknown }).model))) return 'zhida_openai'
  if (/^\/api\/v1\/knowledge\/bases\/[^/]+\/items$/.test(path)) return 'knowledge'
  if (/^\/api\/v1\/(?:pdf-parse|ppt-generation)\/tasks(?:\/[^/]+)?$/.test(path)) return 'tools'
  return GROUPS[path] ?? blocked('调用已阻止：该能力的官方额度映射未确认；不能擅自套价。')
}
export function resolveZhihuCallPolicy(env: NodeJS.ProcessEnv = process.env, options: ZhihuCallPolicyOptions = {}) {
  const raw = (env.ZHIHU_ALLOW_PAID ?? 'false').toLowerCase()
  if (options.allowPaid === undefined && !['true', 'false', '1', '0'].includes(raw)) blocked('ZHIHU_ALLOW_PAID 必须是 true/false 或 1/0。')
  const allowPaid = options.allowPaid ?? ['true', '1'].includes(raw)
  const capText = env.ZHIHU_DAILY_CALL_LIMIT ?? '100'
  if (options.dailyCallLimit === undefined && !/^\d+$/.test(capText)) blocked('每日调用上限必须是 1-100000 的整数。')
  const dailyCallLimit = options.dailyCallLimit ?? Number(capText)
  if (typeof allowPaid !== 'boolean' || !Number.isInteger(dailyCallLimit) || dailyCallLimit < 1 || dailyCallLimit > 100000) blocked('付费开关必须是布尔值，每日调用上限必须是 1-100000 的整数。')
  return { allowPaid, dailyCallLimit }
}
type Ledger = { version: 1; day: string; calls: number; uncertain: Record<string, number>; free: Record<string, number> }
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const day = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
const code = (error: unknown) => (error as NodeJS.ErrnoException)?.code
async function readLedger(directory: string): Promise<Ledger> {
  let value: unknown
  try { value = JSON.parse(await readFile(join(directory, 'daily.json'), 'utf8')) }
  catch (error) {
    if (code(error) === 'ENOENT') return { version: 1, day: day(), calls: 0, uncertain: {}, free: {} }
    return blocked('本地调用记录不可读；已阻止请求，请检查 call-policy/daily.json。')
  }
  const row = value as Ledger
  if (!row || row.version !== 1 || typeof row.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.day) || !integer(row.calls) || !row.uncertain || Array.isArray(row.uncertain) || typeof row.uncertain !== 'object' || !Object.values(row.uncertain).every(integer)) blocked('本地调用记录无效；已阻止请求，不能自动清零。')
  if (row.free === undefined) row.free = {} // Backward-compatible version-1 ledger.
  if (!row.free || Array.isArray(row.free) || typeof row.free !== 'object' || !Object.values(row.free).every(integer)) blocked('本地免费预留记录无效；已阻止请求。')
  if (row.day !== day()) { row.day = day(); row.calls = 0; row.free = {} }
  return row
}
async function writeLedger(directory: string, row: Ledger) {
  const temporary = join(directory, `daily-${randomUUID()}.tmp`)
  try {
    const file = await open(temporary, 'wx')
    try { await file.writeFile(JSON.stringify(row), 'utf8'); await file.sync() } finally { await file.close() }
    await rename(temporary, join(directory, 'daily.json'))
  } catch { blocked('本地调用记录保存失败；已阻止请求。') }
  finally { await unlink(temporary).catch(error => { if (code(error) !== 'ENOENT') throw error }) }
}
export async function withZhihuCallPolicy<T>(path: string, body: unknown, quota: (group: string) => Promise<unknown>, execute: () => Promise<T>, options: ZhihuCallPolicyOptions & { env?: NodeJS.ProcessEnv; signal?: AbortSignal } = {}): Promise<T> {
  const group = zhihuQuotaGroup(path, body)
  const env = options.env ?? process.env
  const policy = resolveZhihuCallPolicy(env, options)
  const priced = PRICED_PATHS.has(path) || /^\/api\/v1\/knowledge\/bases\/[^/]+\/items$/.test(path) || (path === '/v1/chat/completions' && body && typeof body === 'object' && (body as { model?: unknown }).model === 'zhida-agent')
  if (policy.allowPaid && !priced) blocked('付费调用已阻止：该能力的官方计费未确认；请使用免费保护模式。')
  const directory = options.directory ?? env.ZHIHU_CALL_POLICY_DIR ?? join(env.ZHIHU_SEARCH_HOME ?? join(homedir(), '.config', 'zhihu-search'), 'call-policy')
  const lock = join(directory, 'request.lock')
  let acquired = false
  const deadline = Date.now() + (options.lockTimeoutMs ?? 30_000)
  try {
    options.signal?.throwIfAborted()
    await mkdir(directory, { recursive: true })
    while (!acquired) {
      options.signal?.throwIfAborted()
      try { await mkdir(lock); acquired = true }
      catch (error) {
        if (code(error) !== 'EEXIST') throw error
        if (Date.now() >= deadline) blocked('本地保护锁忙或遗留；已阻止请求。确认两个客户端均无在途请求后再移除 call-policy/request.lock。')
        await delay(50, undefined, { signal: options.signal })
      }
    }
    options.signal?.throwIfAborted()
    const row = await readLedger(directory)
    if (row.calls >= policy.dailyCallLimit) blocked('已达到本地北京时间每日业务调用上限；额度查询仍可使用。')
    if (!policy.allowPaid) {
      let rows: unknown
      try { rows = await quota(group) }
      catch { options.signal?.throwIfAborted(); blocked('免费额度预查失败；未发送业务请求，请稍后手动查询官方额度。') }
      options.signal?.throwIfAborted()
      const matches = Array.isArray(rows) ? rows.filter(value => value && typeof value === 'object' && value.APIID === group) : []
      if (matches.length !== 1 || !integer(matches[0].RemainingQuota)) blocked('官方未返回有效的免费剩余额度；未发送业务请求。')
      const available = Math.min(matches[0].RemainingQuota - (row.uncertain[group] ?? 0), row.free[group] ?? matches[0].RemainingQuota)
      if (available <= 0) blocked('免费额度不足，或有结果未知的已发送请求；未发送业务请求。')
      row.free[group] = available - 1
    } else if (row.free[group] !== undefined) row.free[group] = Math.max(0, row.free[group] - 1)
    options.signal?.throwIfAborted()
    // Count reservations before dispatch; cancellation/unknown results are not refunded.
    row.calls++
    row.uncertain[group] = (row.uncertain[group] ?? 0) + 1
    await writeLedger(directory, row)
    options.signal?.throwIfAborted()
    const result = await execute()
    row.uncertain[group]--
    await writeLedger(directory, row)
    return result
  } catch (error) {
    options.signal?.throwIfAborted()
    if (error instanceof ZhihuCallPolicyError) throw error
    if (['EACCES', 'EPERM', 'ENOSPC', 'EIO', 'EROFS', 'ENOENT', 'ENOTDIR'].includes(String(code(error)))) blocked('本地保护存储不可用；已阻止业务请求。')
    throw error
  } finally { if (acquired) await rmdir(lock) }
}
