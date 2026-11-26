import { mkdir, open, readFile, rename, unlink, rmdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

/** Ledger format is shared with zhihu-search/call_policy.py; counters are not limits. */
export type ZhihuCallPolicyOptions = {
  allowPaid?: boolean
  directory?: string
  lockTimeoutMs?: number
  /** Best-effort observer for settlement failures; hooks must not affect requests. */
  onPhase2Error?: (error: unknown) => void
}
export class ZhihuCallPolicyError extends Error {}
const blocked = (message: string): never => { throw new ZhihuCallPolicyError(message) }
export const QUOTA_CHECK_TTL = 300
export const QUOTA_CHECK_MIN_REMAINING = 20
export const LOCK_STALE_AFTER = 60
export const LOCK_WAIT_TIMEOUT = 75
const LOCK_STALE_AFTER_MS = LOCK_STALE_AFTER * 1000
const LOCK_WAIT_TIMEOUT_MS = LOCK_WAIT_TIMEOUT * 1000
const OWNER_CLOCK_TOLERANCE_MS = 2

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
  if (typeof allowPaid !== 'boolean') blocked('付费开关必须是布尔值。')
  return { allowPaid }
}
type Ledger = {
  version: 1
  day: string
  calls: number
  uncertain: Record<string, number>
  free: Record<string, number>
  checked: Record<string, number>
  [key: string]: unknown
}
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const day = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
const code = (error: unknown) => (error as NodeJS.ErrnoException)?.code
async function readLedger(directory: string): Promise<Ledger> {
  let value: unknown
  try { value = JSON.parse(await readFile(join(directory, 'daily.json'), 'utf8')) }
  catch (error) {
    if (code(error) === 'ENOENT') return { version: 1, day: day(), calls: 0, uncertain: {}, free: {}, checked: {} }
    return blocked('本地调用记录不可读；已阻止请求，请检查 call-policy/daily.json。')
  }
  const row = value as Ledger
  if (!row || row.version !== 1 || typeof row.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.day) || !integer(row.calls) || !row.uncertain || Array.isArray(row.uncertain) || typeof row.uncertain !== 'object' || !Object.values(row.uncertain).every(integer)) blocked('本地调用记录无效；已阻止请求，不能自动清零。')
  if (row.free === undefined) row.free = {} // Backward-compatible version-1 ledger.
  if (!row.free || Array.isArray(row.free) || typeof row.free !== 'object' || !Object.values(row.free).every(integer)) blocked('本地免费预留记录无效；已阻止请求。')
  if (row.checked === undefined) row.checked = {} // Backward-compatible version-1 ledger.
  if (!row.checked || Array.isArray(row.checked) || typeof row.checked !== 'object' || !Object.values(row.checked).every(integer)) blocked('本地额度预查记录无效；已阻止请求。')
  if (row.day !== day()) { row.day = day(); row.calls = 0; row.uncertain = {}; row.free = {}; row.checked = {} }
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

const lockPath = (directory: string) => join(directory, 'request.lock')
const ownerPath = (directory: string) => join(directory, 'request.lock.owner.json')

async function writeOwner(directory: string, token: string) {
  const temporary = join(directory, `owner-${randomUUID()}.tmp`)
  try {
    const file = await open(temporary, 'wx')
    try {
      await file.writeFile(JSON.stringify({ token, pid: process.pid, acquiredAt: Date.now() }), 'utf8')
      await file.sync()
    } finally { await file.close() }
    await rename(temporary, ownerPath(directory))
  } finally {
    await unlink(temporary).catch(error => { if (code(error) !== 'ENOENT') throw error })
  }
}

async function lockAgeMs(directory: string): Promise<number | undefined> {
  let lockStat
  try { lockStat = await stat(lockPath(directory)) }
  catch (error) {
    if (code(error) === 'ENOENT') return undefined
    throw error
  }
  let basis = lockStat.mtimeMs
  try {
    const [ownerStat, raw] = await Promise.all([stat(ownerPath(directory)), readFile(ownerPath(directory), 'utf8')])
    const owner = JSON.parse(raw) as { acquiredAt?: unknown }
    if (typeof owner.acquiredAt === 'number' && Number.isFinite(owner.acquiredAt)
      && ownerStat.mtimeMs >= lockStat.mtimeMs - OWNER_CLOCK_TOLERANCE_MS
      && owner.acquiredAt >= lockStat.mtimeMs - OWNER_CLOCK_TOLERANCE_MS) {
      basis = owner.acquiredAt
    }
  } catch {
    // Missing or corrupt ownership data falls back to the lock directory's age.
  }
  return Date.now() - basis
}

async function reclaimStaleLock(directory: string): Promise<boolean> {
  const reclaim = join(directory, 'request.lock.reclaim')
  let holdsReclaim = false
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(reclaim)
      holdsReclaim = true
      break
    } catch (error) {
      if (code(error) !== 'EEXIST') throw error
      try {
        const reclaimStat = await stat(reclaim)
        if (!reclaimStat.isDirectory() || Date.now() - reclaimStat.mtimeMs <= LOCK_STALE_AFTER_MS) return false
        await rmdir(reclaim).catch(() => {})
      } catch (statError) {
        if (code(statError) === 'ENOENT') continue
        throw statError
      }
    }
  }
  if (!holdsReclaim) return false
  try {
    const age = await lockAgeMs(directory)
    if (age === undefined || age <= LOCK_STALE_AFTER_MS) return false
    const lockStat = await stat(lockPath(directory)).catch(error => {
      if (code(error) === 'ENOENT') return undefined
      throw error
    })
    if (!lockStat?.isDirectory()) return false
    // Remove the old owner before renaming. While request.lock exists no new
    // owner can be created; this avoids deleting a successor's owner file.
    await unlink(ownerPath(directory)).catch(() => {})
    const stale = join(directory, `request.lock.stale-${randomUUID()}`)
    try {
      await rename(lockPath(directory), stale)
    } catch {
      return false
    }
    await rmdir(stale).catch(() => {})
    return true
  } finally {
    await rmdir(reclaim).catch(() => {})
  }
}

async function acquireLock(directory: string, options: { lockTimeoutMs?: number; signal?: AbortSignal }): Promise<string> {
  const token = randomUUID()
  const deadline = Date.now() + (options.lockTimeoutMs ?? LOCK_WAIT_TIMEOUT_MS)
  await mkdir(directory, { recursive: true })
  for (;;) {
    options.signal?.throwIfAborted()
    try {
      await mkdir(lockPath(directory))
    } catch (error) {
      if (code(error) !== 'EEXIST') throw error
      const age = await lockAgeMs(directory)
      if (age !== undefined && age > LOCK_STALE_AFTER_MS && await reclaimStaleLock(directory)) continue
      if (Date.now() >= deadline) blocked('本地保护锁忙；已阻止请求。遗留锁会在 60 秒后自动恢复。')
      await delay(50, undefined, { signal: options.signal })
      continue
    }
    try {
      await writeOwner(directory, token)
    } catch (error) {
      await rmdir(lockPath(directory)).catch(() => {})
      throw error
    }
    return token
  }
}

export async function releaseLock(directory: string, token: string): Promise<void> {
  try {
    let owner: { token?: unknown }
    try {
      owner = JSON.parse(await readFile(ownerPath(directory), 'utf8')) as { token?: unknown }
    } catch {
      return
    }
    if (owner.token !== token) return
    try {
      await unlink(ownerPath(directory))
    } catch (error) {
      if (code(error) !== 'ENOENT') return
    }
    await rmdir(lockPath(directory)).catch(() => {})
  } catch {
    // Release is deliberately best-effort; stale ownership is recovered by age.
  }
}

function reportPhase2Error(options: ZhihuCallPolicyOptions, error: unknown): void {
  if (!options.onPhase2Error) return
  try { options.onPhase2Error(error) } catch { /* observers never affect requests */ }
}

async function settleReservation(directory: string, group: string, options: ZhihuCallPolicyOptions & { signal?: AbortSignal }): Promise<void> {
  let token: string | undefined
  try {
    token = await acquireLock(directory, options)
    try {
      const row = await readLedger(directory)
      row.uncertain[group] = Math.max(0, (row.uncertain[group] ?? 0) - 1)
      await writeLedger(directory, row)
    } finally {
      await releaseLock(directory, token)
    }
  } catch (error) {
    reportPhase2Error(options, error)
  }
}

export async function withZhihuCallPolicy<T>(path: string, body: unknown, quota: (group: string) => Promise<unknown>, execute: () => Promise<T>, options: ZhihuCallPolicyOptions & { env?: NodeJS.ProcessEnv; signal?: AbortSignal } = {}): Promise<T> {
  const group = zhihuQuotaGroup(path, body)
  const env = options.env ?? process.env
  const policy = resolveZhihuCallPolicy(env, options)
  const priced = PRICED_PATHS.has(path) || /^\/api\/v1\/knowledge\/bases\/[^/]+\/items$/.test(path) || (path === '/v1/chat/completions' && body && typeof body === 'object' && (body as { model?: unknown }).model === 'zhida-agent')
  if (policy.allowPaid && !priced) blocked('付费调用已阻止：该能力的官方计费未确认；请使用免费保护模式。')
  const directory = options.directory ?? env.ZHIHU_CALL_POLICY_DIR ?? join(env.ZHIHU_SEARCH_HOME ?? join(homedir(), '.config', 'zhihu-search'), 'call-policy')
  try {
    options.signal?.throwIfAborted()
    const token = await acquireLock(directory, options)
    try {
      options.signal?.throwIfAborted()
      const row = await readLedger(directory)
      if (!policy.allowPaid) {
        const nowSeconds = Math.floor(Date.now() / 1000)
        const checked = row.checked[group]
        const floor = row.free[group]
        const cached = checked !== undefined && nowSeconds - checked < QUOTA_CHECK_TTL && floor !== undefined && floor >= QUOTA_CHECK_MIN_REMAINING
        let available: number
        if (cached) {
          available = floor
        } else {
          let rows: unknown
          try { rows = await quota(group) }
          catch { options.signal?.throwIfAborted(); blocked('免费额度预查失败；未发送业务请求，请稍后手动查询官方额度。') }
          options.signal?.throwIfAborted()
          const matches = Array.isArray(rows) ? rows.filter(value => value && typeof value === 'object' && value.APIID === group) : []
          if (matches.length !== 1 || !integer(matches[0].RemainingQuota)) blocked('官方未返回有效的免费剩余额度；未发送业务请求。')
          row.checked[group] = nowSeconds
          available = Math.min(matches[0].RemainingQuota - (row.uncertain[group] ?? 0), row.free[group] ?? matches[0].RemainingQuota)
        }
        if (available <= 0) blocked('免费额度不足，或有结果未知的已发送请求；未发送业务请求。')
        row.free[group] = available - 1
      } else if (row.free[group] !== undefined) row.free[group] = Math.max(0, row.free[group] - 1)
      options.signal?.throwIfAborted()
      // Count reservations before dispatch; cancellation/unknown results are not refunded.
      row.calls++
      row.uncertain[group] = (row.uncertain[group] ?? 0) + 1
      await writeLedger(directory, row)
    } finally {
      await releaseLock(directory, token)
    }
    options.signal?.throwIfAborted()
    const result = await execute()
    // Settlement is best-effort: a local lock/IO failure must not turn an
    // already successful upstream response into a failed tool call.
    await settleReservation(directory, group, options)
    return result
  } catch (error) {
    options.signal?.throwIfAborted()
    if (error instanceof ZhihuCallPolicyError) throw error
    if (['EACCES', 'EPERM', 'ENOSPC', 'EIO', 'EROFS', 'ENOENT', 'ENOTDIR'].includes(String(code(error)))) blocked('本地保护存储不可用；已阻止业务请求。')
    throw error
  }
}
