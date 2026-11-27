import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { mkdtemp, readFile, writeFile, mkdir, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withZhihuCallPolicy, resolveZhihuCallPolicy, zhihuQuotaGroup, releaseLock } from './call-policy.ts'
import { zhihuFetchJson, type ZhihuSearchFetcher } from './zhihu-client.ts'
import { ZhihuResponseCache } from './response-cache.ts'
import { createZhihuService } from './index.ts'
import { createZhihuResearchTool } from './tool-definitions.ts'
import { createZhihuWebSearchProvider, registerZhihuGlobalSearchProvider } from './web-search-provider.ts'
import { executeZhihuOpenPlatform } from './open-platform.ts'
import { executeZhihuStudy } from './study.ts'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { ZhihuCallPolicySection, ZhihuCallPolicySummary } from './client-call-policy.tsx'

let directory: string
const quota = async (group: string) => [{ APIID: group, RemainingQuota: 10 }]
const business = '/api/v1/content/zhihu_search'
const signal = () => new AbortController().signal
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'zhihu-policy-')) })
afterEach(async () => { vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }) })
const options = () => ({ directory, env: {}, lockTimeoutMs: 500 })
const ledger = async () => JSON.parse(await readFile(join(directory, 'daily.json'), 'utf8'))

describe('actual default call protection', () => {
  it('shares atomic reservations across independent options and checks quota every time', async () => {
    const events: string[] = []
    const outcomes = await Promise.allSettled(Array.from({ length: 5 }, () => withZhihuCallPolicy(business, undefined,
      async group => { events.push('quota'); return [{ APIID: group, RemainingQuota: 2 }] },
      async () => { events.push('business'); return 'ok' }, options())))
    expect(outcomes.filter(v => v.status === 'fulfilled')).toHaveLength(2)
    expect(events).toEqual(['quota', 'business', 'quota', 'business', 'quota', 'quota', 'quota'])
    expect((await ledger()).calls).toBe(2)
  })
  it.each([[], null, {}, [{ APIID: 'zhihu_search', RemainingQuota: 0 }], [{ APIID: 'zhihu_search', RemainingQuota: '10' }], [{ APIID: 'zhihu_search', RemainingQuota: true }], [{ APIID: 'zhihu_search', RemainingQuota: -1 }], [{ APIID: 'zhihu_search', RemainingQuota: Number.MAX_SAFE_INTEGER + 1 }], [{ APIID: 'zhihu_search', RemainingQuota: 10 }, { APIID: 'zhihu_search', RemainingQuota: 10 }]])('blocks unusable free quota: %j', async rows => {
    let sent = 0
    await expect(withZhihuCallPolicy(business, undefined, async () => rows, async () => ++sent, options())).rejects.toThrow()
    expect(sent).toBe(0)
    await expect(readFile(join(directory, 'daily.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('blocks failed preflight without dispatch/count and never retries', async () => {
    let checks = 0
    await expect(withZhihuCallPolicy(business, undefined, async () => { checks++; throw new Error('offline') }, async () => { throw new Error('must not send') }, options())).rejects.toThrow('预查失败')
    expect(checks).toBe(1)
  })
  it('paid mode requires explicit opt-in and does not enable unpriced capabilities', async () => {
    let checks = 0
    const paid = { ...options(), allowPaid: true }
    expect(await withZhihuCallPolicy(business, undefined, async () => { checks++; return [] }, async () => 'ok', paid)).toBe('ok')
    expect(await withZhihuCallPolicy(business, undefined, async () => { checks++; return [] }, async () => 'ok', paid)).toBe('ok')
    expect(checks).toBe(0)
    for (const [path, body] of [['/api/v1/user/question_recommendations', undefined], ['/v1/chat/completions', { model: 'zhida-thinking-1p5' }], ['/v1/chat/completions', { model: 'zhida-fast-1p5' }], ['/api/v1/pdf-parse/tasks', {}], ['/unknown', {}]] as const) {
      await expect(withZhihuCallPolicy(path, body, quota, async () => 'bad', paid)).rejects.toThrow('未确认')
    }
    expect(zhihuQuotaGroup('/v1/chat/completions', { model: 'zhida-agent' })).toBe('zhida_openai')
  })
  it('retains uncertain dispatch after failure, reserving remaining free capacity', async () => {
    await expect(withZhihuCallPolicy(business, undefined, quota, async () => { throw new Error('lost response') }, options())).rejects.toThrow('lost response')
    expect(await ledger()).toMatchObject({ calls: 1, uncertain: { zhihu_search: 1 } })
    await expect(withZhihuCallPolicy(business, undefined, async group => [{ APIID: group, RemainingQuota: 1 }], async () => 'bad', options())).rejects.toThrow('结果未知')
  })
  it('cancels waiting/preflight without consuming a slot or removing another lock', async () => {
    await mkdir(join(directory, 'request.lock'))
    const controller = new AbortController()
    const pending = withZhihuCallPolicy(business, undefined, quota, async () => 'bad', { ...options(), signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toThrow()
    await expect(mkdir(join(directory, 'request.lock'))).rejects.toMatchObject({ code: 'EEXIST' })
    await rm(join(directory, 'request.lock'), { recursive: true })
    const preflight = new AbortController()
    await expect(withZhihuCallPolicy(business, undefined, async () => { preflight.abort(); return quota('zhihu_search') }, async () => 'bad', { ...options(), signal: preflight.signal })).rejects.toThrow()
    await expect(readFile(join(directory, 'daily.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('fails closed for damaged storage and stale locks', async () => {
    await writeFile(join(directory, 'daily.json'), 'broken')
    await expect(withZhihuCallPolicy(business, undefined, quota, async () => 'bad', options())).rejects.toThrow('记录不可读')
    await mkdir(join(directory, 'request.lock'))
    await expect(withZhihuCallPolicy(business, undefined, quota, async () => 'bad', { ...options(), lockTimeoutMs: 0 })).rejects.toThrow('保护锁忙')
  })
  it('resets calls, uncertain, free and checked on Beijing rollover while preserving unknown keys', async () => {
    await writeFile(join(directory, 'daily.json'), JSON.stringify({ version: 1, day: '2020-01-01', calls: 100, uncertain: { hot_list: 2 }, free: { hot_list: 30 }, checked: { hot_list: 1 }, futureUnknown: { kept: true } }))
    await withZhihuCallPolicy(business, undefined, quota, async () => true, { ...options(), allowPaid: true })
    expect(await ledger()).toMatchObject({ calls: 1, free: {}, checked: {}, futureUnknown: { kept: true } })
    expect((await ledger()).uncertain.hot_list).toBeUndefined()
  })
  it('rejects invalid paid-call settings and ignores retired daily-limit settings', () => {
    expect(() => resolveZhihuCallPolicy({ ZHIHU_ALLOW_PAID: 'yes' })).toThrow()
    expect(() => resolveZhihuCallPolicy({}, { allowPaid: 'yes' as never })).toThrow()
    for (const value of ['0', '1', '100', 'Infinity', '100001']) {
      expect(resolveZhihuCallPolicy({ ZHIHU_DAILY_CALL_LIMIT: value })).toEqual({ allowPaid: false })
    }
    expect(resolveZhihuCallPolicy({})).toEqual({ allowPaid: false })
  })
  it.each([100, 1000])('uses official quota after %i local calls, including old persisted settings', async calls => {
    const row = { version: 1, day: new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10), calls, uncertain: {}, free: { global_search: 4900 } }
    await writeFile(join(directory, 'daily.json'), JSON.stringify(row))
    const legacyOptions = { ...options(), dailyCallLimit: 1, env: { ZHIHU_DAILY_CALL_LIMIT: '1' } }
    let checked = 0, sent = 0
    expect(await withZhihuCallPolicy('/api/v1/content/global_search', {}, async group => {
      checked++
      expect(group).toBe('global_search')
      return [{ APIID: group, RemainingQuota: 4900 }]
    }, async () => ++sent, legacyOptions)).toBe(1)
    expect(checked).toBe(1)
    expect(sent).toBe(1)
    expect(await ledger()).toMatchObject({ calls: calls + 1, free: { global_search: 4899 } })
  })
})

function fixture(count = 1) {
  const paths: string[] = []
  const fetcher: ZhihuSearchFetcher = async url => {
    const parsed = new URL(url); paths.push(parsed.pathname)
    const body = { Code: 0, Data: parsed.pathname === '/api/v1/quota' ? [{ APIID: parsed.searchParams.get('APIIDs'), RemainingQuota: count }] : { Items: [] } }
    return { ok: true, status: 200, async text() { return JSON.stringify(body) }, async json() { return body } }
  }
  const client = { fetcher, env: { ZHIHU_ACCESS_TOKEN: 'fixture-only-token' }, resolveCredential: async () => 'fixture-only-token', callPolicy: { directory } }
  const service = createZhihuService(client, { async record() {}, async read() { return [] } })
  return { paths, client, service }
}

describe('actual protection across public DSH entries', () => {
  it('RPC, tools and native web use each API allowance independently', async () => {
    const { paths, client, service } = fixture()
    expect((await service.call('search', { query: '普通资料' }, signal())).ok).toBe(true)
    const tool = createZhihuResearchTool(service.toolOptions)
    await expect(tool.execute({ action: 'search', query: '另一份资料', count: 1 }, { signal: signal() } as never)).rejects.toMatchObject({ code: 'CALL_BLOCKED' })
    await expect(zhihuFetchJson(business, {}, '搜索', client)).rejects.toMatchObject({ code: 'CALL_BLOCKED' })
    await expect(zhihuFetchJson('/api/v1/content/hot_list', {}, '热榜', client)).resolves.toBeDefined()
    const provider = createZhihuWebSearchProvider({ ...client, apiKey: 'fixture-only-token' })
    await expect(provider.search({ query: '普通资料' }, signal())).resolves.toMatchObject({ sources: [] })
    await expect(provider.search({ query: '普通资料' }, signal())).rejects.toMatchObject({ code: 'CALL_BLOCKED' })
    let native: { search(request: { query: string }, signal?: AbortSignal): Promise<unknown> } | undefined
    registerZhihuGlobalSearchProvider({ registerSearchProvider(value) { native = value; return () => {} } }, service, () => true)
    await expect(native!.search({ query: '普通资料' }, signal())).rejects.toMatchObject({ code: 'CALL_BLOCKED' })
    expect(paths.filter(path => path !== '/api/v1/quota')).toEqual([business, '/api/v1/content/hot_list', '/api/v1/content/global_search'])
    expect(paths.filter(path => path === '/api/v1/quota')).toHaveLength(7)
    await service.dispose()
  })
  it('quota itself is not guarded, counted or recursively preflighted; legacy ID is normalized', async () => {
    const { paths, client, service } = fixture()
    const result = await executeZhihuOpenPlatform('quota', { apiIds: ['question_answers', 'question_discovery'] }, client)
    expect((result.data.Items as Array<{ APIID: string }>)[0].APIID).toBe('question_discovery')
    expect(paths).toEqual(['/api/v1/quota'])
    await expect(readFile(join(directory, 'daily.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await service.dispose()
  })
  it('quota failure/exhaustion stops the business request through RPC', async () => {
    const { paths, service } = fixture(0)
    expect(await service.call('search', { query: '普通资料' }, signal())).toMatchObject({ ok: false, error: { code: 'call-blocked' } })
    expect(paths).toEqual(['/api/v1/quota'])
    await service.dispose()
  })
  it('abort during dispatched fetch keeps conservative reservation and releases the lock', async () => {
    const { client, service } = fixture()
    let started!: () => void
    const ready = new Promise<void>(resolve => { started = resolve })
    const original = client.fetcher
    client.fetcher = async (url, init) => {
      if (new URL(url).pathname === '/api/v1/quota') return original(url, init)
      started()
      return await new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
    }
    const controller = new AbortController()
    const pending = zhihuFetchJson(business, {}, '搜索', { ...client, signal: controller.signal })
    await ready; controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
    // Cleanup belongs to the guarded operation, which can finish just after cancellation.
    expect(await ledger()).toMatchObject({ calls: 1, uncertain: { zhihu_search: 1 } })
    await mkdir(join(directory, 'request.lock'))
    await service.dispose()
  })
  it('cancels a request waiting for the policy lock without leaking an abort rejection', async () => {
    await mkdir(join(directory, 'request.lock'))
    const controller = new AbortController()
    const connected = Promise.withResolvers<void>()
    const addListener = controller.signal.addEventListener.bind(controller.signal)
    vi.spyOn(controller.signal, 'addEventListener').mockImplementation((type, listener, options) => {
      addListener(type, listener, options)
      if (type === 'abort') connected.resolve()
    })
    const { paths, client, service } = fixture()
    const pending = zhihuFetchJson(business, {}, '搜索', { ...client, signal: controller.signal }).catch(error => error)
    await connected.promise
    controller.abort(new Error('another search reached its local limit'))
    expect(await pending).toMatchObject({ code: 'CANCELLED' })
    // Give Node a turn to report detached rejections; Vitest fails the run if any escape.
    await nextTurn()
    expect(paths).toEqual([])
    await expect(mkdir(join(directory, 'request.lock'))).rejects.toMatchObject({ code: 'EEXIST' })
    await expect(readFile(join(directory, 'daily.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await service.dispose()
  })
  it('times out while waiting for the policy lock without leaking a rejection or removing the lock', async () => {
    await mkdir(join(directory, 'request.lock'))
    const { paths, client, service } = fixture()
    await expect(zhihuFetchJson(business, {}, '搜索', { ...client, timeoutMs: 10 })).rejects.toMatchObject({ code: 'TIMEOUT' })
    await nextTurn()
    expect(paths).toEqual([])
    await expect(mkdir(join(directory, 'request.lock'))).rejects.toMatchObject({ code: 'EEXIST' })
    await expect(readFile(join(directory, 'daily.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await service.dispose()
  })
  it('settles parallel searches cancelled by exhausted official quota without sending business requests', async () => {
    const row = { version: 1, day: new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10), calls: 1, uncertain: {}, free: { global_search: 4900 } }
    await writeFile(join(directory, 'daily.json'), JSON.stringify(row))
    const { paths, client, service } = fixture(0)
    const provider = createZhihuWebSearchProvider({ ...client, apiKey: 'fixture-only-token' })
    const controller = new AbortController()
    let first: unknown
    const searches = ['资料甲', '资料乙', '资料丙'].map(async query => {
      try { return await provider.search({ query }, controller.signal) }
      catch (error) {
        first ??= error
        controller.abort(first)
        throw error
      }
    })
    const outcomes = await Promise.allSettled(searches)
    await nextTurn()
    expect(first).toMatchObject({ code: 'CALL_BLOCKED' })
    expect((first as Error).message).toContain('免费额度不足')
    expect(outcomes.every(outcome => outcome.status === 'rejected')).toBe(true)
    expect(paths).toEqual(['/api/v1/quota'])
    expect(await ledger()).toEqual(row)
    await mkdir(join(directory, 'request.lock'))
    await service.dispose()
  })
  it('shows explicit protection limits without pretending to know wallet balances', () => {
    const html = renderToStaticMarkup(createElement(ZhihuCallPolicySection, { rpc: { async call() { throw new Error('SSR must not fetch') } } }))
    expect(html).toContain('调用统计不是账单')
    expect(html).toContain('付费须在插件配置显式启用')
    expect(html).not.toContain('充值余额：')
  })
})


it.each([
  ['/v1/chat/completions', { model: 'zhida-fast-1p5' }, 'zhida_openai'],
  ['/v1/chat/completions', { model: 'zhida-thinking-1p5' }, 'zhida_openai'],
  ['/api/v1/user/question_recommendations', undefined, 'question_discovery'],
  ['/api/v1/pdf-parse/tasks', {}, 'tools'],
] as const)('uses confirmed free quota without guessing a price: %s', async (path, body, group) => {
  expect(await withZhihuCallPolicy(path, body, async value => { expect(value).toBe(group); return quota(value) }, async () => 'free', options())).toBe('free')
  await expect(withZhihuCallPolicy(path, body, quota, async () => 'bad', { ...options(), allowPaid: true })).rejects.toThrow('计费未确认')
})


it('reports the applied server policy without reading official quota or billing', async () => {
  const { paths, service } = fixture()
  expect(await service.call('policy.status', {}, signal())).toMatchObject({ ok: true, value: { allowPaid: false } })
  expect(paths).toEqual([])
  for (const allowPaid of [false, true]) {
    const html = renderToStaticMarkup(createElement(ZhihuCallPolicySummary, { policy: { allowPaid } }))
    expect(html).toContain(allowPaid ? '已显式允许付费' : '按各接口官方免费额度调用')
    expect(html).not.toContain('每日上限')
  }
  await service.dispose()
})


it('lets a study spend one free allowance per upstream call and keeps a blocked call visible', async () => {
  const paths: string[] = []
  const fetcher: ZhihuSearchFetcher = async url => {
    const parsed = new URL(url)
    paths.push(parsed.pathname)
    const body = { Code: 0, Data: parsed.pathname === '/api/v1/quota'
      ? [{ APIID: parsed.searchParams.get('APIIDs'), RemainingQuota: 1 }]
      : { Items: [{ Title: '一条', Url: 'https://example.com/a', ContentText: '摘录', AuthorityLevel: '2' }], HasMore: false } }
    return { ok: true, status: 200, async text() { return JSON.stringify(body) }, async json() { return body } }
  }
  const result = await executeZhihuStudy({
    mode: 'deep', question: '普通资料', queries: ['第一问', '第二问'], sources: ['zhihu'], maxCalls: 2,
  }, { fetcher, env: { ZHIHU_ACCESS_TOKEN: 'fixture-only-token' }, resolveCredential: async () => 'fixture-only-token', callPolicy: { directory } })
  expect(result.finishedReport).toBe(false)
  expect(result.status).not.toBe('empty')
  expect(result.failures).toEqual([expect.objectContaining({ code: 'CALL_BLOCKED', retried: false })])
  expect(result.evidence.length).toBe(1)
  expect(paths).toEqual(['/api/v1/quota', '/api/v1/content/zhihu_search', '/api/v1/quota'])
  expect(paths.some(path => path.includes('chat/completions'))).toBe(false)
})

it('never reuses an unchanged official free-remaining value across our clients', async () => {
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => withZhihuCallPolicy(business, undefined, async group => [{ APIID: group, RemainingQuota: 1 }], async () => 'ok', options())))
  expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1)
  expect((await ledger()).free.zhihu_search).toBe(0)
})


it('overlaps concurrent requests in execute instead of holding the lock over HTTP', async () => {
  const firstInside = Promise.withResolvers<void>()
  const secondInside = Promise.withResolvers<void>()
  const quota10 = async (group: string) => [{ APIID: group, RemainingQuota: 10 }]
  const first = withZhihuCallPolicy(business, undefined, quota10, async () => {
    firstInside.resolve()
    await secondInside.promise
    return 'first'
  }, options())
  const second = withZhihuCallPolicy(business, undefined, quota10, async () => {
    secondInside.resolve()
    await firstInside.promise
    return 'second'
  }, options())
  const timeout = new Promise((_resolve, reject) => setTimeout(() => reject(new Error('execute serialization deadlock')), 1000))
  await expect(Promise.race([Promise.all([first, second]), timeout])).resolves.toHaveLength(2)
})


it('caches official quota checks for five minutes only while at least 20 remain', async () => {
  vi.useFakeTimers()
  try {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    let checks = 0
    const quota100 = async (group: string) => { checks++; return [{ APIID: group, RemainingQuota: 100 }] }
    const run = () => withZhihuCallPolicy(business, undefined, quota100, async () => 'ok', options())
    await run(); await run()
    expect(checks).toBe(1)
    vi.setSystemTime(new Date('2026-01-01T00:05:01Z'))
    await run()
    expect(checks).toBe(2)

    let lowChecks = 0
    const lowDirectory = join(directory, 'low')
    const quota19 = async (group: string) => { lowChecks++; return [{ APIID: group, RemainingQuota: 19 }] }
    const lowOptions = { ...options(), directory: lowDirectory }
    await withZhihuCallPolicy(business, undefined, quota19, async () => 'ok', lowOptions)
    await withZhihuCallPolicy(business, undefined, quota19, async () => 'ok', lowOptions)
    expect(lowChecks).toBe(2)
  } finally {
    vi.useRealTimers()
  }
})


it('reclaims a stale lock by age and keeps a fresh lock busy with automatic-recovery wording', async () => {
  const lock = join(directory, 'request.lock')
  await mkdir(lock)
  const old = new Date(Date.now() - 120_000)
  await utimes(lock, old, old)
  await expect(withZhihuCallPolicy(business, undefined, quota, async () => 'ok', options())).resolves.toBe('ok')
  await expect(readFile(join(directory, 'request.lock.owner.json'))).rejects.toMatchObject({ code: 'ENOENT' })

  await mkdir(lock)
  await expect(withZhihuCallPolicy(business, undefined, quota, async () => 'bad', { ...options(), lockTimeoutMs: 0 })).rejects.toThrow('60 秒后自动恢复')
  await rm(lock, { recursive: true, force: true })
})


it('release does not remove a lock whose owner token differs', async () => {
  const lock = join(directory, 'request.lock')
  const owner = join(directory, 'request.lock.owner.json')
  await mkdir(lock)
  await writeFile(owner, JSON.stringify({ token: 'actual', pid: 1, acquiredAt: Date.now() }))
  await releaseLock(directory, 'different')
  await expect(mkdir(lock)).rejects.toMatchObject({ code: 'EEXIST' })
  expect(JSON.parse(await readFile(owner, 'utf8')).token).toBe('actual')
  await releaseLock(directory, 'actual')
  await mkdir(lock)
  await rm(lock, { recursive: true })
})


it('reads the cross-language checked ledger literally and uses the quota cache', async () => {
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
  const nowS = Math.floor(Date.now() / 1000)
  await writeFile(join(directory, 'daily.json'), JSON.stringify({ version: 1, day: today, calls: 3, uncertain: { zhihu_search: 1 }, free: { zhihu_search: 50 }, checked: { zhihu_search: nowS - 10 } }))
  let checks = 0
  const result = await withZhihuCallPolicy(business, undefined, async group => { checks++; return [{ APIID: group, RemainingQuota: 100 }] }, async () => 'ok', options())
  expect(result).toBe('ok')
  expect(checks).toBe(0)
  expect(await ledger()).toMatchObject({ calls: 4, free: { zhihu_search: 49 }, uncertain: { zhihu_search: 1 }, checked: { zhihu_search: nowS - 10 } })
})


it('phase-2 lock failure does not fail a successful call', async () => {
  const result = await withZhihuCallPolicy(business, undefined, quota, async () => {
    await mkdir(join(directory, 'request.lock'))
    return 'ok'
  }, { ...options(), lockTimeoutMs: 0 })
  expect(result).toBe('ok')
  expect((await ledger()).uncertain.zhihu_search).toBe(1)
  await rm(join(directory, 'request.lock'), { recursive: true, force: true })
})


function cachedFetch(responseBody: () => unknown, failures = { count: 0 }) {
  const paths: string[] = []
  const fetcher: ZhihuSearchFetcher = async url => {
    const parsed = new URL(url)
    if (parsed.pathname !== '/api/v1/quota') paths.push(`${parsed.pathname}?${parsed.searchParams}`)
    if (failures.count > 0 && parsed.pathname === business) {
      failures.count--
      return { ok: false, status: 500, async text() { return '' }, async json() { return null } }
    }
    const body = responseBody()
    return { ok: true, status: 200, async text() { return JSON.stringify(body) }, async json() { return body } }
  }
  return { paths, fetcher }
}


it('response cache reuses successful GETs by params and secret until TTL expiry', async () => {
  let now = 1_000_000
  const responseCache = new ZhihuResponseCache(() => now)
  const { paths, fetcher } = cachedFetch(() => ({ Code: 0, Data: { Items: [{ Title: '条目' }] } }))
  const base = { fetcher, responseCache, callPolicy: { directory, allowPaid: true }, resolveCredential: async () => 'secret-one' }
  const first = await zhihuFetchJson(business, { params: { Query: 'RAG', Count: '5' } }, '搜索', base) as { Data: { Items: unknown[] } }
  first.Data.Items.push({ Title: '调用方修改' })
  const second = await zhihuFetchJson(business, { params: { Query: 'RAG', Count: '5' } }, '搜索', base) as { Data: { Items: unknown[] } }
  expect(second.Data.Items).toHaveLength(1)
  await zhihuFetchJson(business, { params: { Query: 'RAG', Count: '6' } }, '搜索', base)
  await zhihuFetchJson(business, { params: { Query: 'RAG', Count: '5' } }, '搜索', { ...base, resolveCredential: async () => 'secret-two' })
  now += 601_000
  await zhihuFetchJson(business, { params: { Query: 'RAG', Count: '5' } }, '搜索', base)
  expect(paths.filter(value => value.startsWith(business))).toHaveLength(4)
  expect((await ledger()).calls).toBe(4)
})


it('response cache never caches errors', async () => {
  const responseCache = new ZhihuResponseCache()
  const { paths, fetcher } = cachedFetch(() => ({ Code: 0, Data: { Items: [] } }), { count: 1 })
  const client = { fetcher, responseCache, callPolicy: { directory, allowPaid: true }, resolveCredential: async () => 'secret-one' }
  await expect(zhihuFetchJson(business, { params: { Query: 'RAG' } }, '搜索', client)).rejects.toMatchObject({ code: 'HTTP_ERROR' })
  await expect(zhihuFetchJson(business, { params: { Query: 'RAG' } }, '搜索', client)).resolves.toBeDefined()
  expect(paths.filter(value => value.startsWith(business))).toHaveLength(2)
})


it('omits credential when unset for cross-language compatibility and resets quota state on credential switch', async () => {
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
  await withZhihuCallPolicy(business, undefined, async group => [{ APIID: group, RemainingQuota: 25 }], async () => 'ok', options())
  const unkeyed = await ledger()
  expect(Object.hasOwn(unkeyed, 'credential')).toBe(false)
  expect(unkeyed).toEqual({
    version: 1,
    day: today,
    calls: 1,
    uncertain: { zhihu_search: 0 },
    free: { zhihu_search: 24 },
    checked: { zhihu_search: expect.any(Number) },
  })

  // Exhaust quota under credential A, then switch to credential B: B must re-check official quota instead of staying locked at free=0.
  await writeFile(join(directory, 'daily.json'), JSON.stringify({
    version: 1,
    day: today,
    calls: 5,
    uncertain: { zhihu_search: 1 },
    free: { zhihu_search: 0 },
    checked: { zhihu_search: Math.floor(Date.now() / 1000) },
    credential: 'aaaaaaaa00000000',
  }))
  let bChecks = 0
  const result = await zhihuFetchJson(business, { params: { Query: '切换密钥' } }, '搜索', {
    env: {},
    resolveCredential: async () => 'second-valid-access-secret',
    callPolicy: { directory },
    fetcher: async url => {
      const parsed = new URL(url)
      if (parsed.pathname === '/api/v1/quota') {
        bChecks++
        const body = { Code: 0, Data: [{ APIID: 'zhihu_search', RemainingQuota: 30 }] }
        return { ok: true, status: 200, async text() { return JSON.stringify(body) }, async json() { return body } }
      }
      const body = { Code: 0, Data: { Items: [] } }
      return { ok: true, status: 200, async text() { return JSON.stringify(body) }, async json() { return body } }
    },
  })
  expect(result).toBeDefined()
  expect(bChecks).toBe(1)
  const switched = await ledger()
  expect(switched.calls).toBe(6)
  expect(switched.free.zhihu_search).toBe(29)
  expect(switched.uncertain.zhihu_search).toBe(0)
  expect(switched.credential).toMatch(/^[0-9a-f]{16}$/)
  expect(switched.credential).not.toBe('aaaaaaaa00000000')
})


it('does not permanently double-subtract transient in-flight uncertain from free floor', async () => {
  const firstExecute = Promise.withResolvers<void>()
  const releaseFirst = Promise.withResolvers<void>()
  let serverRemaining = 10
  const first = withZhihuCallPolicy(business, undefined, async group => [{ APIID: group, RemainingQuota: serverRemaining }], async () => {
    // Simulate upstream having already counted the first request before the second checks quota.
    serverRemaining = 9
    firstExecute.resolve()
    await releaseFirst.promise
    return 'first'
  }, options())
  await firstExecute.promise
  const second = await withZhihuCallPolicy(business, undefined, async group => [{ APIID: group, RemainingQuota: serverRemaining }], async () => {
    serverRemaining = 8
    return 'second'
  }, options())
  releaseFirst.resolve()
  await expect(first).resolves.toBe('first')
  expect(second).toBe('second')
  const saved = await ledger()
  expect(saved.uncertain.zhihu_search).toBe(0)
  expect(saved.free.zhihu_search).toBe(8)
})


it('settles reservation with an independent timeout after a near-deadline HTTP response', async () => {
  let holdLock!: () => Promise<void>
  const fetcher: ZhihuSearchFetcher = async url => {
    const parsed = new URL(url)
    if (parsed.pathname === '/api/v1/quota') {
      const body = { Code: 0, Data: [{ APIID: 'zhihu_search', RemainingQuota: 10 }] }
      return { ok: true, status: 200, async text() { return JSON.stringify(body) }, async json() { return body } }
    }
    await new Promise(resolve => setTimeout(resolve, 25))
    await holdLock()
    const body = { Code: 0, Data: { Items: [] } }
    return { ok: true, status: 200, async text() { return JSON.stringify(body) }, async json() { return body } }
  }
  const lock = join(directory, 'request.lock')
  holdLock = async () => {
    await mkdir(lock)
    setTimeout(() => { void rm(lock, { recursive: true, force: true }) }, 30)
  }
  await expect(zhihuFetchJson(business, { params: { Query: '临界超时' } }, '搜索', {
    fetcher,
    env: {},
    resolveCredential: async () => 'near-deadline-secret',
    timeoutMs: 45,
    callPolicy: { directory },
  })).resolves.toBeDefined()
  expect((await ledger()).uncertain.zhihu_search).toBe(0)
})


it('reclaims non-empty stale lock directories and tolerates small owner-file mtime skew', async () => {
  const lock = join(directory, 'request.lock')
  const owner = join(directory, 'request.lock.owner.json')
  await mkdir(lock)
  await writeFile(join(lock, 'stray.tmp'), 'leftover')
  const old = new Date(Date.now() - 120_000)
  await utimes(lock, old, old)
  await expect(withZhihuCallPolicy(business, undefined, quota, async () => 'ok', options())).resolves.toBe('ok')

  // Sub-50ms filesystem mtime skew on owner.json must still honor a fresh acquiredAt timestamp.
  await mkdir(lock)
  const now = Date.now()
  await writeFile(owner, JSON.stringify({ token: 'live-owner', pid: process.pid, acquiredAt: now }))
  const lockTime = new Date(now)
  const slightlyEarlier = new Date(now - 20)
  await utimes(lock, lockTime, lockTime)
  await utimes(owner, slightlyEarlier, slightlyEarlier)
  await expect(withZhihuCallPolicy(business, undefined, quota, async () => 'bad', { ...options(), lockTimeoutMs: 0 })).rejects.toThrow('保护锁忙')
  expect(JSON.parse(await readFile(owner, 'utf8')).token).toBe('live-owner')
  await rm(lock, { recursive: true, force: true })
  await rm(owner, { force: true })
})
