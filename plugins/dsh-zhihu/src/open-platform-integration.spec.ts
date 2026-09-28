import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import { apply as applyTools } from './tools.ts'
import { createZhihuService } from './index.ts'
import { createZhihuQuestionRecommendationsTool, ZHIHU_OPEN_PLATFORM_TOOL_FACTORIES } from './open-platform-tools.ts'
import { ZHIHU_OPEN_PLATFORM_APIS, type ZhihuOpenPlatformOperation, type ZhihuOpenPlatformResult } from './open-platform.ts'
import type { ZhihuClientOptions, ZhihuSearchExecuted, ZhihuSearchFetcher } from './zhihu-client.ts'
import type { ZhihuQuotaId } from './contracts.ts'

type Tool = {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute(args: unknown, context: { signal: AbortSignal }): Promise<ZhihuOpenPlatformResult>
  output: { render(args: unknown, value: unknown): Array<{ type: string; text: string }> }
}
const cases: Array<[ZhihuOpenPlatformOperation, string, Record<string, unknown>]> = [
  ['question.recommendations', 'zhihu_question_recommendations', {}],
  ['question.answers', 'zhihu_question_answers', { questionUrl: 'https://www.zhihu.com/question/1' }],
  ['content.detail', 'zhihu_user_content_detail', { contentUrl: 'https://www.zhihu.com/answer/1' }],
  ['content.comments', 'zhihu_user_content_comments', { contentUrl: 'https://www.zhihu.com/answer/1' }],
  ['creator.account.stats', 'zhihu_creator_account_stats', {}],
  ['creator.content.stats', 'zhihu_creator_content_stats', { contentUrl: 'https://www.zhihu.com/answer/1' }],
  ['quota', 'zhihu_quota', {}],
]
function fixture(fetcher?: ZhihuSearchFetcher) {
  const stored: Array<{ ok: boolean; results?: number; quotaId?: ZhihuQuotaId }> = []
  const emitted: ZhihuSearchExecuted[] = []
  const paths: string[] = []
  const options: ZhihuClientOptions = { env: { ZHIHU_ACCESS_TOKEN: 'integration-secret' }, fetcher: fetcher ?? (async url => {
    const path = new URL(url).pathname; paths.push(path)
    const data = path.endsWith('/content_detail') ? { Body: '<p>body</p>' }
      : path.endsWith('/creator_account_stats') ? { Metrics: { ViewCount: 1 } }
      : { Items: [{ Title: 'title' }], Paging: { IsEnd: true } }
    return { ok: true, status: 200, async text() { return JSON.stringify({ Code: 0, Data: data }) }, async json() { return { Code: 0, Data: data } } }
  }) }
  const service = createZhihuService(options, {
    async record(event) { await Promise.resolve(); stored.push(event) },
    async read() { return [] },
  }, event => emitted.push(event))
  const tools: Tool[] = []
  applyTools({ zhihu: service, tools: { register(tool: Tool) { tools.push(tool) } } } as unknown as Context)
  return { service, tools, stored, emitted, paths, options }
}
const signal = () => new AbortController().signal

describe('open platform real RPC and optional tool registration', () => {
  it('registers all 12 unique tools and preserves the five old names', async () => {
    const { service, tools } = fixture()
    assert.equal(tools.length, 12)
    assert.equal(new Set(tools.map(tool => tool.name)).size, 12)
    for (const name of ['zhihu_search', 'zhihu_global_search', 'zhihu_hot_list', 'zhihu_ask', 'zhihu_knowledge_search', ...cases.map(([, name]) => name)]) {
      assert.ok(tools.some(tool => tool.name === name), name)
    }
    await service.dispose()
  })
  for (const [operation, name, input] of cases) it(`${operation} has equivalent RPC/tool output and an actual executable route`, async () => {
    const { service, tools, paths, stored } = fixture()
    const rpc = await service.call(operation, input, signal())
    assert.equal(rpc.ok, true)
    if (!rpc.ok) throw new Error(rpc.error.message)
    const tool = tools.find(tool => tool.name === name)!
    const result = await tool.execute(input, { signal: signal() })
    assert.deepEqual(rpc.value, result)
    assert.deepEqual(paths, [ZHIHU_OPEN_PLATFORM_APIS[operation].path, ZHIHU_OPEN_PLATFORM_APIS[operation].path])
    assert.equal(tool.output.render(input, result)[0]?.type, 'text')
    assert.match(tool.description, /Access Secret.*OAuth/)
    assert.equal(Object.keys(tool.parameters).some(key => /token|secret|oauth/i.test(key)), false)
    await service.dispose()
    assert.equal(stored.length, operation === 'quota' ? 0 : 2)
  })
  it('serializes one event per concurrent tool/RPC operation, with the correct quota IDs', async () => {
    const { service, tools, stored, emitted } = fixture()
    await Promise.all(cases.flatMap(([operation, name, input]) => [
      service.call(operation.replaceAll('.', '_'), input, signal()),
      tools.find(tool => tool.name === name)!.execute(input, { signal: signal() }),
    ]))
    await service.dispose()
    assert.equal(stored.length, 12, 'six business operations through two entry points; quota is not metered')
    assert.deepEqual(stored, emitted)
    assert.equal(stored.filter(event => event.quotaId === 'creator').length, 10)
    assert.equal(stored.filter(event => event.quotaId === 'question_answers').length, 2)
    assert.ok(stored.every(event => event.ok && event.results === 1))
  })
  it('preserves risk-control metadata through RPC and meters a business failure once', async () => {
    let requests = 0
    const { service, stored } = fixture(async () => {
      requests++
      return { ok: false, status: 400, headers: new Headers({ 'Retry-After': '60' }), async text() { return '' }, async json() { return { Code: 30003, Message: 'risk rejection' } } }
    })
    const rpc = await service.call('question_recommendations', {}, signal())
    assert.equal(rpc.ok, false)
    if (rpc.ok) throw new Error('expected a failure')
    assert.equal(rpc.error.code, 'upstream-unavailable')
    assert.deepEqual(rpc.error.details, { status: 400, upstreamCode: 30003, retryable: false })
    assert.match(rpc.error.message, /不要立即重试/)
    await service.dispose()
    assert.equal(requests, 1)
    assert.deepEqual(stored, [{ ok: false, results: 0, quotaId: 'creator' }])
  })
  it('exposes Retry-After for actual rate limits through RPC', async () => {
    const { service } = fixture(async () => ({ ok: true, status: 200, headers: new Headers({ 'Retry-After': '9' }), async text() { return '' }, async json() { return { Code: 30002, Message: 'quota exhausted' } } }))
    const rpc = await service.call('question.answers', { questionUrl: 'https://www.zhihu.com/question/1' }, signal())
    assert.equal(rpc.ok, false)
    if (rpc.ok) throw new Error('expected a failure')
    assert.equal(rpc.error.code, 'rate-limited')
    assert.deepEqual(rpc.error.details, { status: 200, upstreamCode: 30002, retryAfter: 9, retryable: true })
    await service.dispose()
  })
  it('does not count even failed quota reads as business usage', async () => {
    const { service, tools, stored } = fixture(async () => { throw new Error('network unavailable') })
    assert.equal((await service.call('quota', {}, signal())).ok, false)
    await assert.rejects(tools.find(tool => tool.name === 'zhihu_quota')!.execute({}, { signal: signal() }))
    await service.dispose()
    assert.equal(stored.length, 0)
  })
  it('rejects OAuth switching through RPC before any HTTP request', async () => {
    const { service, paths, stored } = fixture()
    const result = await service.call('content.detail', { contentUrl: 'https://www.zhihu.com/answer/1', use_configured_oauth_user: true }, signal())
    assert.equal(result.ok, false)
    if (result.ok) throw new Error('expected validation failure')
    assert.equal(result.error.code, 'invalid-arguments')
    assert.equal(paths.length, 0)
    await service.dispose()
    assert.deepEqual(stored, [{ ok: false, results: 0, quotaId: 'creator' }])
  })
  it('keeps malformed RPC payloads distinct from omitted recommendation input', async () => {
    const { service, paths } = fixture()
    assert.equal((await service.call('question.recommendations', [], signal())).ok, false)
    assert.equal(paths.length, 0)
    assert.equal((await service.call('question.recommendations', undefined, signal())).ok, true)
    await service.dispose()
  })
  it('observer failures never turn successful tool results into errors', async () => {
    const { service, options } = fixture()
    const tool = createZhihuQuestionRecommendationsTool({ ...options, onExecuted() { throw new Error('observer') } }) as unknown as Tool
    const result = await tool.execute({}, { signal: signal() })
    assert.equal(result.operation, 'question.recommendations')
    await service.dispose()
  })
  it('counts a failed tool execution exactly once before rethrowing', async () => {
    const { service, tools, stored } = fixture(async () => { throw new Error('offline') })
    await assert.rejects(tools.find(tool => tool.name === 'zhihu_question_answers')!.execute({ questionUrl: 'https://www.zhihu.com/question/1' }, { signal: signal() }))
    await service.dispose()
    assert.deepEqual(stored, [{ ok: false, results: 0, quotaId: 'question_answers' }])
  })
  it('unload aborts active creator RPC/tools and flushes their failure events', async () => {
    let started = 0
    let ready!: () => void
    const waiting = new Promise<void>(resolve => { ready = resolve })
    const { service, tools, stored } = fixture(async () => {
      if (++started === 2) ready()
      return await new Promise(() => {})
    })
    const rpc = service.call('question.recommendations', {}, signal())
    const tool = tools.find(tool => tool.name === 'zhihu_creator_account_stats')!
    const execution = tool.execute({}, { signal: signal() }).then(() => undefined, error => error)
    await waiting
    await service.dispose()
    const rpcResult = await rpc
    assert.equal(rpcResult.ok, false)
    if (rpcResult.ok) throw new Error('expected cancellation')
    assert.equal(rpcResult.error.code, 'cancelled')
    assert.ok(await execution instanceof Error)
    assert.deepEqual(stored, [{ ok: false, results: 0, quotaId: 'creator' }, { ok: false, results: 0, quotaId: 'creator' }])
    await assert.rejects(tool.execute({}, { signal: signal() }))
    assert.equal(started, 2)
  })
  it('exports seven new factories without depending on an RPC-only wrapper', () => {
    assert.equal(ZHIHU_OPEN_PLATFORM_TOOL_FACTORIES.length, 7)
  })
})
