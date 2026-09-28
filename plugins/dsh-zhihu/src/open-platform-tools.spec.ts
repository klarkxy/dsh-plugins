import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from './tools.ts'
import { createZhihuService } from './index.ts'
import { createZhihuUsageRecorder, mergeZhihuUsage, ZHIHU_QUOTA_IDS, type ZhihuUsageTableLike } from './usage.ts'
import type { ZhihuSearchFetcher } from './zhihu-client.ts'

type Tool = {
  name: string
  parameters: { properties?: Record<string, unknown> }
  output: { schema: unknown; render(args: unknown, value: unknown): Array<{ text: string }> }
  execute(args: unknown, exec: { signal: AbortSignal }): Promise<unknown>
}
const signal = () => new AbortController().signal
const questionUrl = 'https://www.zhihu.com/question/123'
const contentUrl = 'https://zhuanlan.zhihu.com/p/456'
const cases = [
  { endpoint: 'question.recommendations', tool: 'zhihu_question_recommendations', args: {}, path: '/api/v1/user/question_recommendations', quota: 'creator' },
  { endpoint: 'question.answers', tool: 'zhihu_question_answers', args: { questionUrl }, path: '/api/v1/content/question_answers', quota: 'question_answers' },
  { endpoint: 'content.detail', tool: 'zhihu_content_detail', args: { contentUrl }, path: '/api/v1/user/content_detail', quota: 'creator' },
  { endpoint: 'content.comments', tool: 'zhihu_content_comments', args: { contentUrl }, path: '/api/v1/user/content_comments', quota: 'creator' },
  { endpoint: 'creator.account.stats', tool: 'zhihu_creator_account_stats', args: {}, path: '/api/v1/user/creator_account_stats', quota: 'creator' },
  { endpoint: 'creator.content.stats', tool: 'zhihu_creator_content_stats', args: { contentUrl }, path: '/api/v1/user/creator_content_stats', quota: 'creator' },
] as const
function setup(code = 0) {
  const rows = new Map<string, ReturnType<ZhihuUsageTableLike['get']>>()
  const calls: Array<{ url: string; headers?: Record<string, string> }> = []
  const fetcher: ZhihuSearchFetcher = async (url, init) => {
    calls.push({ url, headers: init?.headers })
    const body = { Code: code, Data: { Items: [{ Title: '测试', Body: '<p>正文</p>' }], Paging: { IsEnd: true } } }
    return { ok: true, status: 200, async json() { return body }, async text() { return JSON.stringify(body) } }
  }
  const service = createZhihuService({ env: { ZHIHU_ACCESS_SECRET: 'secret-for-tests' }, fetcher }, createZhihuUsageRecorder({ get: key => rows.get(key), async put(key, row) { rows.set(key, row) } }))
  const tools: Tool[] = []
  apply({ zhihu: service, tools: { register: (tool: Tool) => tools.push(tool) } } as unknown as Context)
  return { service, tools, calls }
}

describe('DSH registrations, RPC and quota accounting', () => {
  it('registers exactly the original five plus six new tools', async () => {
    const { service, tools } = setup()
    expect(tools.map(tool => tool.name).sort()).toEqual(['zhihu_search', 'zhihu_global_search', 'zhihu_hot_list', 'zhihu_ask', 'zhihu_knowledge_search', ...cases.map(c => c.tool)].sort())
    for (const entry of cases) {
      const schema = JSON.stringify(tools.find(tool => tool.name === entry.tool)!.parameters)
      expect(schema).not.toMatch(/oauth|accessSecret|userId|token/i)
    }
    await service.dispose()
  })
  it.each(cases)('$tool and $endpoint reach the same API and each count exactly once', async entry => {
    const { service, tools, calls } = setup()
    const tool = tools.find(tool => tool.name === entry.tool)!
    const [rpc, result] = await Promise.all([
      service.call(entry.endpoint, entry.args, signal()),
      tool.execute(entry.args, { signal: signal() }),
    ])
    expect(rpc).toEqual({ ok: true, value: result })
    expect(calls).toHaveLength(2)
    expect(calls.map(call => new URL(call.url).pathname)).toEqual([entry.path, entry.path])
    expect(calls.every(call => !Object.keys(call.headers ?? {}).some(key => /oauth/i.test(key)))).toBe(true)
    expect(tool.output.render(entry.args, result)[0].text).toBeTruthy()
    expect((await service.usageSummary(1)).days).toEqual([expect.objectContaining({ calls: 2, failures: 0, results: 2, quotas: { [entry.quota]: { calls: 2, failures: 0, results: 2 } } })])
    await service.dispose()
  })
  it.each(cases)('$tool and $endpoint preserve risk errors and failed quota counts', async entry => {
    const { service, tools, calls } = setup(30003)
    const tool = tools.find(tool => tool.name === entry.tool)!
    expect(await service.call(entry.endpoint, entry.args, signal())).toMatchObject({ ok: false, error: { code: 'risk-control', details: { apiCode: 30003 }, message: expect.stringContaining('不要立即重试') } })
    await expect(tool.execute(entry.args, { signal: signal() })).rejects.toMatchObject({ code: 'RISK_CONTROL' })
    expect(calls).toHaveLength(2)
    expect((await service.usageSummary(1)).days).toEqual([expect.objectContaining({ calls: 2, failures: 2, quotas: { [entry.quota]: { calls: 2, failures: 2, results: 0 } } })])
    await service.dispose()
  })
  it('keeps creator and question_answers categories distinct across concurrent tools/RPC', async () => {
    const { service, tools } = setup()
    await Promise.all(cases.flatMap(entry => [service.call(entry.endpoint, entry.args, signal()), tools.find(t => t.name === entry.tool)!.execute(entry.args, { signal: signal() })]))
    expect((await service.usageSummary(1)).days).toEqual([expect.objectContaining({ calls: 12, failures: 0, quotas: { creator: { calls: 10, failures: 0, results: 10 }, question_answers: { calls: 2, failures: 0, results: 2 } } })])
    await service.dispose()
  })
  it('rejects invalid RPC inputs before requesting and counts failures only once', async () => {
    const { service, calls } = setup()
    expect(await service.call('question.recommendations', { query: '   ' }, signal())).toMatchObject({ ok: false, error: { code: 'invalid-arguments' } })
    expect(await service.call('creator.account.stats', { oauthToken: 'other-user' }, signal())).toMatchObject({ ok: false, error: { code: 'invalid-arguments' } })
    expect(calls).toHaveLength(0)
    expect((await service.usageSummary(1)).days).toEqual([expect.objectContaining({ calls: 2, failures: 2, quotas: { creator: { calls: 2, failures: 2, results: 0 } } })])
    await service.dispose()
  })
  it('keeps persisted pre-category rows intact and never invents historical breakdowns', () => {
    const old = { date: '2026-09-28', calls: 10, failures: 1, results: 20 }
    const next = mergeZhihuUsage(old, { ok: true, results: 2, quotaId: 'creator' })
    expect(next).toEqual({ ...old, calls: 11, results: 22, quotas: { creator: { calls: 1, failures: 0, results: 2 } } })
    expect(old).toEqual({ date: '2026-09-28', calls: 10, failures: 1, results: 20 })
    expect(ZHIHU_QUOTA_IDS).toContain('question_answers')
    expect(ZHIHU_QUOTA_IDS).toContain('creator')
  })
  it('categorizes existing registered tools without double counting', async () => {
    const { service, tools } = setup()
    await tools.find(t => t.name === 'zhihu_global_search')!.execute({ query: '查询' }, { signal: signal() })
    expect((await service.usageSummary(1)).days).toEqual([expect.objectContaining({ calls: 1, quotas: { global_search: { calls: 1, failures: 0, results: 1 } } })])
    await service.dispose()
  })
})
