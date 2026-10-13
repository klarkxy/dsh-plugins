import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withZhihuCallPolicy, resolveZhihuCallPolicy, zhihuQuotaGroup } from './call-policy.ts'
import { zhihuFetchJson, type ZhihuSearchFetcher } from './zhihu-client.ts'
import { createZhihuService } from './index.ts'
import { createZhihuSearchTool } from './tool-definitions.ts'
import { createZhihuWebSearchProvider, registerZhihuGlobalSearchProvider } from './web-search-provider.ts'
import { executeZhihuOpenPlatform } from './open-platform.ts'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { ZhihuCallPolicySection, ZhihuCallPolicySummary } from './client-call-policy.tsx'

let directory: string
const quota = async (group: string) => [{ APIID: group, RemainingQuota: 10 }]
const business = '/api/v1/content/zhihu_search'
const signal = () => new AbortController().signal
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'zhihu-policy-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })
const options = () => ({ directory, env: {}, lockTimeoutMs: 500 })
const ledger = async () => JSON.parse(await readFile(join(directory, 'daily.json'), 'utf8'))

describe('actual default call protection', () => {
  it('shares atomic reservations across independent options and checks quota every time', async () => {
    const events: string[] = []
    const outcomes = await Promise.allSettled(Array.from({ length: 5 }, () => withZhihuCallPolicy(business, undefined,
      async group => { events.push('quota'); return quota(group) },
      async () => { events.push('business'); return 'ok' }, { ...options(), dailyCallLimit: 2 })))
    expect(outcomes.filter(v => v.status === 'fulfilled')).toHaveLength(2)
    expect(events).toEqual(['quota', 'business', 'quota', 'business'])
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
  it('paid mode requires explicit opt-in, stays capped and does not enable unpriced capabilities', async () => {
    let checks = 0
    const paid = { ...options(), allowPaid: true, dailyCallLimit: 1 }
    expect(await withZhihuCallPolicy(business, undefined, async () => { checks++; return [] }, async () => 'ok', paid)).toBe('ok')
    await expect(withZhihuCallPolicy(business, undefined, quota, async () => 'bad', paid)).rejects.toThrow('每日业务调用上限')
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
    await expect(withZhihuCallPolicy(business, undefined, quota, async () => 'bad', { ...options(), lockTimeoutMs: 0 })).rejects.toThrow('保护锁忙或遗留')
  })
  it('resets daily count on Beijing rollover but retains uncertain outcomes', async () => {
    await writeFile(join(directory, 'daily.json'), JSON.stringify({ version: 1, day: '2020-01-01', calls: 100, uncertain: { hot_list: 2 } }))
    await withZhihuCallPolicy(business, undefined, quota, async () => true, options())
    expect(await ledger()).toMatchObject({ calls: 1, uncertain: { hot_list: 2 } })
  })
  it('rejects invalid config rather than enabling paid calls or dropping limits', () => {
    for (const env of [{ ZHIHU_ALLOW_PAID: 'yes' }, { ZHIHU_DAILY_CALL_LIMIT: '0' }, { ZHIHU_DAILY_CALL_LIMIT: 'Infinity' }, { ZHIHU_DAILY_CALL_LIMIT: '100001' }]) expect(() => resolveZhihuCallPolicy(env)).toThrow()
    expect(resolveZhihuCallPolicy({})).toEqual({ allowPaid: false, dailyCallLimit: 100 })
  })
})

function fixture(count = 10) {
  const paths: string[] = []
  const fetcher: ZhihuSearchFetcher = async url => {
    const parsed = new URL(url); paths.push(parsed.pathname)
    const body = { Code: 0, Data: parsed.pathname === '/api/v1/quota' ? [{ APIID: parsed.searchParams.get('APIIDs'), RemainingQuota: count }] : { Items: [] } }
    return { ok: true, status: 200, async text() { return JSON.stringify(body) }, async json() { return body } }
  }
  const client = { fetcher, env: { ZHIHU_ACCESS_TOKEN: 'fixture-only-token' }, resolveCredential: async () => 'fixture-only-token', callPolicy: { directory, dailyCallLimit: 1 } }
  const service = createZhihuService(client, { async record() {}, async read() { return [] } })
  return { paths, client, service }
}

describe('actual protection across public DSH entries', () => {
  it('RPC, optional tool, direct client and native web share the same daily cap', async () => {
    const { paths, client, service } = fixture()
    expect((await service.call('search', { query: '普通资料' }, signal())).ok).toBe(true)
    const tool = createZhihuSearchTool(service.toolOptions)
    await expect(tool.execute({ query: '普通资料', count: 1 }, { signal: signal() } as never)).rejects.toMatchObject({ code: 'CALL_BLOCKED' })
    await expect(zhihuFetchJson('/api/v1/content/hot_list', {}, '热榜', client)).rejects.toMatchObject({ code: 'CALL_BLOCKED' })
    const provider = createZhihuWebSearchProvider({ ...client, apiKey: 'fixture-only-token' })
    await expect(provider.search({ query: '普通资料' }, signal())).rejects.toMatchObject({ code: 'CALL_BLOCKED' })
    let native: { search(request: { query: string }, signal?: AbortSignal): Promise<unknown> } | undefined
    registerZhihuGlobalSearchProvider({ registerSearchProvider(value) { native = value; return () => {} } }, service, () => true)
    await expect(native!.search({ query: '普通资料' }, signal())).rejects.toMatchObject({ code: 'CALL_BLOCKED' })
    expect(paths).toEqual(['/api/v1/quota', business])
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
  expect(await service.call('policy.status', {}, signal())).toMatchObject({ ok: true, value: { allowPaid: false, dailyCallLimit: 1 } })
  expect(paths).toEqual([])
  for (const allowPaid of [false, true]) {
    const html = renderToStaticMarkup(createElement(ZhihuCallPolicySummary, { policy: { allowPaid, dailyCallLimit: 50 } }))
    expect(html).toContain(allowPaid ? '已显式允许付费' : '仅使用免费额度')
    expect(html).toContain('每日上限 50 次（北京时间）')
  }
  await service.dispose()
})


it('never reuses an unchanged official free-remaining value across our clients', async () => {
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => withZhihuCallPolicy(business, undefined, async group => [{ APIID: group, RemainingQuota: 1 }], async () => 'ok', options())))
  expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1)
  expect((await ledger()).free.zhihu_search).toBe(0)
})
