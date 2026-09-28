import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import {
  executeZhihuOpenPlatform, normalizeZhihuOffset, normalizeZhihuPaging,
  resolveZhihuOpenPlatformOperation, ZHIHU_OPEN_PLATFORM_APIS,
  type ZhihuOpenPlatformOperation,
} from './open-platform.ts'
import { renderZhihuOpenPlatform, plainZhihuText } from './open-platform-render.ts'
import { zhihuFetchJson, parseZhihuEnvelope, parseZhihuRetryAfter, ZhihuSearchError, type ZhihuClientOptions, type ZhihuSearchFetcher } from './zhihu-client.ts'

const SECRET = 'test-access-secret-only'
const QUESTION = 'https://www.zhihu.com/question/123'
const CONTENT = 'https://www.zhihu.com/question/123/answer/456'
function response(body: unknown, status = 200, headers: Record<string, string> = {}): Awaited<ReturnType<ZhihuSearchFetcher>> {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), async text() { return JSON.stringify(body) }, async json() { return body } }
}
function fixture(data: unknown = { Items: [] }, code: unknown = 0, status = 200, headers: Record<string, string> = {}) {
  const calls: Array<{ url: URL; init: Parameters<ZhihuSearchFetcher>[1] }> = []
  const options: ZhihuClientOptions = {
    env: { ZHIHU_ACCESS_TOKEN: SECRET, ZHIHU_OAUTH_TOKEN: 'must-not-be-sent' },
    fetcher: async (url, init) => {
      calls.push({ url: new URL(url), init })
      return response({ Code: code, Message: 'upstream message', Data: data }, status, headers)
    },
  }
  return { options, calls }
}
const CASES: Array<[ZhihuOpenPlatformOperation, Record<string, unknown>, Record<string, string>]> = [
  ['question.recommendations', {}, { Count: '5' }],
  ['question.answers', { questionUrl: QUESTION }, { QuestionUrl: QUESTION, Offset: '0', Limit: '20' }],
  ['content.detail', { contentUrl: CONTENT }, { ContentUrl: CONTENT }],
  ['content.comments', { contentUrl: CONTENT }, { ContentUrl: CONTENT, Offset: '0', Limit: '20', Order: 'score' }],
  ['creator.account.stats', {}, { ContentType: 'all' }],
  ['creator.content.stats', { contentUrl: CONTENT }, { ContentUrl: CONTENT }],
  ['quota', {}, {}],
]

describe('question/creator request contracts', () => {
  for (const [operation, input, params] of CASES) it(`${operation}: GET, exact defaults, Access Secret only, quota classification`, async () => {
    const { options, calls } = fixture()
    const result = await executeZhihuOpenPlatform(operation, input, options)
    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.url.pathname, ZHIHU_OPEN_PLATFORM_APIS[operation].path)
    assert.deepEqual(Object.fromEntries(calls[0]!.url.searchParams), params)
    assert.equal(calls[0]!.init?.method, 'GET')
    assert.equal(calls[0]!.init?.headers?.Authorization, `Bearer ${SECRET}`)
    assert.match(calls[0]!.init?.headers?.['X-Request-Timestamp'] ?? '', /^\d+$/)
    assert.equal(calls[0]!.init?.headers?.['X-OAuth-Token'], undefined)
    assert.equal(result.quotaId, ZHIHU_OPEN_PLATFORM_APIS[operation].quotaId)
    assert.equal(result.version, 1)
    assert.equal(result.operation, operation)
  })
  it('trims a theme without imposing the unrelated search-query length limit', async () => {
    const { options, calls } = fixture()
    await executeZhihuOpenPlatform('question.recommendations', { query: '  文  ', count: 20 }, options)
    assert.equal(calls[0]!.url.searchParams.get('Query'), '文')
    assert.equal(calls[0]!.url.searchParams.get('Count'), '20')
  })
  it('sends paired calendar dates and leaves absent optional metrics untouched', async () => {
    const data = { Metrics: { ClickRate: 0.125, ViewCount: 0 }, Followers: { ActiveRatio: null } }
    const { options, calls } = fixture(data)
    const result = await executeZhihuOpenPlatform('creator.account.stats', { contentType: 'article', startDate: '2024-02-29', endDate: '2024-03-01' }, options)
    assert.deepEqual(Object.fromEntries(calls[0]!.url.searchParams), { ContentType: 'article', StartDate: '2024-02-29', EndDate: '2024-03-01' })
    assert.deepEqual(result.data, data)
    assert.equal(Object.hasOwn(result.data.Metrics as object, 'LikeCount'), false)
  })
  it('preserves content stats Items and passes the content URL and date pair', async () => {
    const data = { Items: [{ ContentToken: '456', Metrics: { ViewCount: 0, ReadFinishedRate: 0.13 } }] }
    const { options, calls } = fixture(data)
    const result = await executeZhihuOpenPlatform('creator.content.stats', { contentUrl: CONTENT, startDate: '2026-09-01', endDate: '2026-09-28' }, options)
    assert.deepEqual(result.data, data)
    assert.equal(calls[0]!.url.searchParams.get('StartDate'), '2026-09-01')
    assert.equal(calls[0]!.url.searchParams.get('EndDate'), '2026-09-28')
  })
  for (const url of [CONTENT, 'https://www.zhihu.com/answer/1', 'https://zhuanlan.zhihu.com/p/2', 'https://www.zhihu.com/pin/3', 'https://www.zhihu.com/zvideo/4']) {
    it(`accepts documented creator content URL ${url}`, async () => {
      const { options, calls } = fixture({ Body: '<p>body</p>' })
      await executeZhihuOpenPlatform('content.detail', { contentUrl: ` ${url} ` }, options)
      assert.equal(calls[0]!.url.searchParams.get('ContentUrl'), url)
    })
  }
  it('sends comment order and an exact Int64 string offset', async () => {
    const { options, calls } = fixture()
    await executeZhihuOpenPlatform('content.comments', { contentUrl: CONTENT, order: 'ascending', limit: 50, offset: '9223372036854775807' }, options)
    assert.equal(calls[0]!.url.searchParams.get('Offset'), '9223372036854775807')
    assert.equal(calls[0]!.url.searchParams.get('Order'), 'ascending')
    assert.equal(calls[0]!.url.searchParams.get('Limit'), '50')
  })
  it('accepts numeric offsets and preserves a question URL trailing slash', async () => {
    const { options, calls } = fixture()
    await executeZhihuOpenPlatform('question.answers', { questionUrl: `${QUESTION}/`, offset: 20, limit: 10 }, options)
    assert.equal(calls[0]!.url.searchParams.get('QuestionUrl'), `${QUESTION}/`)
    assert.equal(calls[0]!.url.searchParams.get('Offset'), '20')
  })
  it('queries official categories in first-seen order and wraps a top-level quota list', async () => {
    const data = [{ APIID: 'creator', RemainingQuota: 4 }]
    const { options, calls } = fixture(data)
    const result = await executeZhihuOpenPlatform('quota', { apiIds: ['creator', 'question_answers', 'creator'] }, options)
    assert.equal(calls[0]!.url.searchParams.get('APIIDs'), 'creator,question_answers')
    assert.deepEqual(result.data, { Items: data })
    assert.equal(result.quotaId, undefined)
  })
  it('an empty quota filter requests all categories without APIIDs', async () => {
    const { options, calls } = fixture()
    await executeZhihuOpenPlatform('quota', { apiIds: [] }, options)
    assert.equal(calls[0]!.url.searchParams.has('APIIDs'), false)
  })
  it('resolves endpoint aliases without exposing Object.prototype', () => {
    assert.equal(resolveZhihuOpenPlatformOperation('question_recommendations'), 'question.recommendations')
    assert.equal(resolveZhihuOpenPlatformOperation('user_content_detail'), 'content.detail')
    assert.equal(resolveZhihuOpenPlatformOperation('content_comments'), 'content.comments')
    assert.equal(resolveZhihuOpenPlatformOperation('creator_account_stats'), 'creator.account.stats')
    assert.equal(resolveZhihuOpenPlatformOperation('creator_content_stats'), 'creator.content.stats')
    assert.equal(resolveZhihuOpenPlatformOperation('question_answers'), 'question.answers')
    assert.equal(resolveZhihuOpenPlatformOperation('constructor'), undefined)
  })
})

const INVALID_INPUTS: Array<[ZhihuOpenPlatformOperation, unknown]> = [
  ...['', '  ', null, false].map(query => ['question.recommendations', { query }] as [ZhihuOpenPlatformOperation, unknown]),
  ...[0, 21, 1.5, '5', null, Infinity, NaN].map(count => ['question.recommendations', { count }] as [ZhihuOpenPlatformOperation, unknown]),
  ...['http://www.zhihu.com/question/1', CONTENT, 'https://example.com/question/1', 'https://www.zhihu.com.evil.test/question/1', '', 'https://user:pass@www.zhihu.com/question/1', 'https://www.zhihu.com:8443/question/1'].map(questionUrl => ['question.answers', { questionUrl }] as [ZhihuOpenPlatformOperation, unknown]),
  ...[QUESTION, 'https://example.com/p/1', 'http://zhuanlan.zhihu.com/p/1'].map(contentUrl => ['content.detail', { contentUrl }] as [ZhihuOpenPlatformOperation, unknown]),
  ...[-1, 1.5, false, '', 'cursor_abc', '-1', '1.5', '9223372036854775808', Number.MAX_SAFE_INTEGER + 1].map(offset => ['question.answers', { questionUrl: QUESTION, offset }] as [ZhihuOpenPlatformOperation, unknown]),
  ['content.comments', { contentUrl: CONTENT, order: 'recent' }],
  ['content.comments', { contentUrl: CONTENT, limit: 51 }],
  ['question.answers', { questionUrl: QUESTION, limit: 0 }],
  ['creator.account.stats', { contentType: 'question' }],
  ['creator.account.stats', { startDate: '2026-01-01' }],
  ['creator.account.stats', { endDate: '2026-01-01' }],
  ['creator.account.stats', { startDate: '2026-01-02', endDate: '2026-01-01' }],
  ['creator.account.stats', { startDate: '2026-02-29', endDate: '2026-03-01' }],
  ['creator.account.stats', { startDate: '2026-9-01', endDate: '2026-09-02' }],
  ['creator.account.stats', { startDate: '0000-01-01', endDate: '0000-02-01' }],
  ['creator.content.stats', { contentUrl: CONTENT, startDate: null, endDate: null }],
  ['quota', { apiIds: ['unknown'] }], ['quota', { apiIds: 'creator' }], ['quota', { apiIds: null }],
  ['question.recommendations', { oauth_token: 'do-not-send' }],
  ['question.recommendations', { use_configured_oauth_user: true }],
  ['content.detail', { contentUrl: CONTENT, accessSecret: 'do-not-send' }],
  ['question.recommendations', []], ['question.recommendations', null],
]
describe('local validation before credentials or HTTP', () => {
  INVALID_INPUTS.forEach(([operation, input], index) => it(`rejects invalid input ${index + 1} for ${operation}`, async () => {
    const { options, calls } = fixture()
    let resolved = false
    options.resolveCredential = async () => { resolved = true; return SECRET }
    await assert.rejects(executeZhihuOpenPlatform(operation, input, options), { code: 'INVALID_ARGUMENTS' })
    assert.equal(resolved, false)
    assert.equal(calls.length, 0)
  }))
  it('normalizes leading zeros and all valid Int64 boundaries without rounding', () => {
    assert.equal(normalizeZhihuOffset('00020'), '20')
    assert.equal(normalizeZhihuOffset(0), '0')
    assert.equal(normalizeZhihuOffset(Number.MAX_SAFE_INTEGER), String(Number.MAX_SAFE_INTEGER))
    assert.equal(normalizeZhihuOffset('9223372036854775807'), '9223372036854775807')
  })
})

describe('explicit pagination, including filtered and empty pages', () => {
  for (const next of [20, '20', '9223372036854775807']) it(`continues an empty page using only NextOffset ${next}`, async () => {
    const { options, calls } = fixture({ Items: [], Paging: { IsEnd: false, NextOffset: next, Totals: 500 } })
    const result = await executeZhihuOpenPlatform('question.answers', { questionUrl: QUESTION }, options)
    assert.deepEqual(result.paging, { isEnd: false, canContinue: true, nextOffset: String(next) })
    assert.equal(calls.length, 1, 'the client never auto-paginates')
  })
  for (const next of [undefined, null, '', 'opaque', -1, 0, 20, Number.MAX_SAFE_INTEGER + 1]) it(`stops missing/invalid/non-advancing NextOffset ${next}`, () => {
    const result = normalizeZhihuPaging({ Paging: { IsEnd: false, NextOffset: next } }, '20')
    assert.equal(result.canContinue, false)
    assert.equal(result.nextOffset, undefined)
    assert.match(result.warning ?? '', /停止翻页/)
  })
  it('IsEnd overrides an obsolete next offset', () => {
    assert.deepEqual(normalizeZhihuPaging({ Paging: { IsEnd: true, NextOffset: 40 } }, '20'), { isEnd: true, canContinue: false })
  })
  it('missing Paging is visible rather than guessed', () => {
    assert.equal(normalizeZhihuPaging({ Items: [] }, '0').canContinue, false)
    assert.match(normalizeZhihuPaging({ Items: [] }, '0').warning ?? '', /不完整/)
  })
  it('comments retain Children and use the same pagination contract', async () => {
    const data = { Items: [{ Comment: { Content: '<p>root</p>' }, Children: [{ Content: '<b>child</b>' }] }], Paging: { IsEnd: false, NextOffset: 50 } }
    const { options } = fixture(data)
    const result = await executeZhihuOpenPlatform('content.comments', { contentUrl: CONTENT }, options)
    assert.deepEqual(result.data, data)
    assert.equal(result.paging?.nextOffset, '50')
  })
})

describe('official envelope errors and transport lifecycle', () => {
  for (const [code, kind] of [[10001, 'INVALID_ARGUMENTS'], [20001, 'TOKEN_INVALID'], [30001, 'RATE_LIMITED'], [30002, 'RATE_LIMITED'], [40001, 'INVALID_ARGUMENTS'], [40002, 'INVALID_ARGUMENTS'], [40003, 'RATE_LIMITED'], [40004, 'INVALID_ARGUMENTS'], [40005, 'INVALID_ARGUMENTS'], [40006, 'INVALID_ARGUMENTS'], [50002, 'UPSTREAM_UNAVAILABLE'], [90001, 'UPSTREAM_UNAVAILABLE'], [99999, 'UPSTREAM_UNAVAILABLE']] as const) {
    it(`maps ${code} even with HTTP 400 and never retries`, async () => {
      const { options, calls } = fixture({}, code, 400, { 'Retry-After': '12' })
      await assert.rejects(executeZhihuOpenPlatform('question.recommendations', {}, options), { code: kind, upstreamCode: code, status: 400, ...(kind === 'RATE_LIMITED' ? { retryAfter: 12 } : {}) })
      assert.equal(calls.length, 1)
    })
  }
  for (const status of [200, 400, 429]) it(`30003 is a non-retryable risk denial, not rate limiting (HTTP ${status})`, async () => {
    const { options, calls } = fixture({}, 30003, status, { 'Retry-After': '30' })
    await assert.rejects(executeZhihuOpenPlatform('question.recommendations', {}, options), (error: unknown) => {
      assert.ok(error instanceof ZhihuSearchError)
      assert.equal(error.code, 'UPSTREAM_UNAVAILABLE')
      assert.equal(error.upstreamCode, 30003)
      assert.equal(error.retryable, false)
      assert.equal(error.retryAfter, undefined)
      assert.match(error.message, /upstream message.*不要立即重试/)
      return true
    })
    assert.equal(calls.length, 1)
  })
  for (const Code of [undefined, null, false, true, '', [], {}, 'bad', 0.5]) it(`does not coerce malformed Code ${JSON.stringify(Code)} into success`, async () => {
    const { options } = fixture()
    options.fetcher = async () => response({ Code, Data: {} })
    await assert.rejects(executeZhihuOpenPlatform('quota', {}, options), { code: 'BAD_RESPONSE' })
  })
  it('accepts the documented numeric string success code', () => { assert.deepEqual(parseZhihuEnvelope({ Code: '0', Data: { Items: [] } }), { Items: [] }) })
  it('rejects malformed Data for a creator API instead of returning successful empty results', async () => {
    const { options } = fixture([])
    await assert.rejects(executeZhihuOpenPlatform('creator.account.stats', {}, options), { code: 'BAD_RESPONSE' })
  })
  it('rejects non-JSON values at the tool output boundary', async () => {
    for (const invalid of [undefined, NaN, Infinity, 1n, () => {}]) {
      const { options } = fixture({ Metrics: { Value: invalid } })
      await assert.rejects(executeZhihuOpenPlatform('creator.account.stats', {}, options), { code: 'BAD_RESPONSE' })
    }
  })
  for (const [status, code] of [[401, 'TOKEN_INVALID'], [403, 'TOKEN_INVALID'], [429, 'RATE_LIMITED'], [503, 'HTTP_ERROR']] as const) it(`maps bare HTTP ${status}`, async () => {
    const { options } = fixture()
    options.fetcher = async () => response(null, status, { 'Retry-After': '7' })
    // The bare status must not be obscured by a missing envelope.
    await assert.rejects(executeZhihuOpenPlatform('quota', {}, options), { code, status })
  })
  it('reports non-JSON HTTP 200 as BAD_RESPONSE', async () => {
    const { options } = fixture()
    options.fetcher = async () => ({ ...response(null), async json() { throw new SyntaxError('bad JSON') } })
    await assert.rejects(executeZhihuOpenPlatform('quota', {}, options), { code: 'BAD_RESPONSE' })
  })
  it('does not resolve credentials or make a request after pre-cancellation', async () => {
    const controller = new AbortController(); controller.abort()
    const { options, calls } = fixture()
    let resolved = false
    options.resolveCredential = async () => { resolved = true; return SECRET }
    await assert.rejects(executeZhihuOpenPlatform('quota', {}, { ...options, signal: controller.signal }), { code: 'CANCELLED' })
    assert.equal(resolved, false); assert.equal(calls.length, 0)
  })
  it('does not request after cancellation during credential resolution', async () => {
    const controller = new AbortController()
    const { options, calls } = fixture()
    options.resolveCredential = async () => { controller.abort(); return SECRET }
    await assert.rejects(executeZhihuOpenPlatform('quota', {}, { ...options, signal: controller.signal }), { code: 'CANCELLED' })
    assert.equal(calls.length, 0)
  })
  it('times out a stalled body, not just the response headers', async () => {
    let requestSignal: AbortSignal | undefined
    const { options } = fixture()
    options.fetcher = async (_url, init) => {
      requestSignal = init?.signal
      return { ...response(null), async json() { return await new Promise(() => {}) } }
    }
    await assert.rejects(executeZhihuOpenPlatform('quota', {}, { ...options, timeoutMs: 10 }), { code: 'TIMEOUT' })
    assert.equal(requestSignal?.aborted, true)
  })
  it('propagates user cancellation during body reading without retry', async () => {
    const controller = new AbortController()
    let reads = 0
    const { options } = fixture()
    options.fetcher = async () => ({ ...response(null), async json() { reads++; controller.abort(); return await new Promise(() => {}) } })
    await assert.rejects(executeZhihuOpenPlatform('quota', {}, { ...options, signal: controller.signal }), { code: 'CANCELLED' })
    assert.equal(reads, 1)
  })
  it('keeps legacy bare HTTP and chat return contracts', async () => {
    const options = { env: { ZHIHU_ACCESS_TOKEN: SECRET }, fetcher: async () => response(null, 401) }
    await assert.rejects(zhihuFetchJson('/api/v1/content/zhihu_search', {}, 'search', options), { code: 'HTTP_ERROR', status: 401 })
    const chat = { choices: [{ message: { content: 'answer' } }] }
    assert.deepEqual(await zhihuFetchJson('/v1/chat/completions', { body: {} }, 'ask', { ...options, fetcher: async () => response(chat) }), chat)
    await assert.rejects(zhihuFetchJson('/api/v1/content/zhihu_search', {}, 'search', { ...options, fetcher: async () => response({ Code: 40101, Message: 'token expired' }) }), { code: 'HTTP_ERROR' })
  })
  it('redacts an accidentally echoed Access Secret in errors', async () => {
    const { options } = fixture()
    options.fetcher = async () => response({ Code: 10001, Message: `bad ${SECRET}` })
    await assert.rejects(executeZhihuOpenPlatform('quota', {}, options), (error: unknown) => {
      assert.ok(error instanceof Error); assert.equal(error.message.includes(SECRET), false); return true
    })
  })
  it('rejects foreign request origins before credentials are attached', async () => {
    const { options, calls } = fixture()
    await assert.rejects(zhihuFetchJson('https://example.com/api', {}, 'test', options), { code: 'INVALID_ARGUMENTS' })
    assert.equal(calls.length, 0)
  })
  it('parses retry seconds and HTTP dates without guessing invalid or negative values', () => {
    assert.equal(parseZhihuRetryAfter('12'), 12)
    assert.equal(parseZhihuRetryAfter('0'), 0)
    assert.equal(parseZhihuRetryAfter('Wed, 01 Jan 2025 00:00:10 GMT', Date.parse('2025-01-01T00:00:00Z')), 10)
    assert.equal(parseZhihuRetryAfter('-10'), undefined)
    assert.equal(parseZhihuRetryAfter('no date'), undefined)
  })
})

describe('untrusted presentation and raw result preservation', () => {
  it('cleans nested comments and full text only in the rendered view', async () => {
    const raw = { Body: '<p>Hello &amp; world</p><script>evil()</script>', Items: [{ Comment: { Content: '<b>root</b>' }, Children: [{ Content: '<style>hidden</style>child' }] }] }
    const { options } = fixture(raw)
    const result = await executeZhihuOpenPlatform('content.detail', { contentUrl: CONTENT }, options)
    const rendered = renderZhihuOpenPlatform(result)
    assert.deepEqual(result.data, raw)
    assert.equal(rendered.includes('<script>'), false)
    assert.equal(rendered.includes('evil()'), false)
    assert.equal(rendered.includes('hidden'), false)
    assert.match(rendered, /Hello & world/)
    assert.match(rendered, /child/)
  })
  it('keeps missing metrics missing and fractional metrics fractional', () => {
    const text = renderZhihuOpenPlatform({ version: 1, operation: 'creator.account.stats', data: { Metrics: { ClickRate: 0.125, ViewCount: 0 } } })
    assert.match(text, /"ClickRate": 0.125/)
    assert.equal(text.includes('12.5%'), false)
    assert.equal(text.includes('LikeCount'), false)
  })
  it('warns on missing or empty full text', () => {
    for (const data of [{}, { Body: '' }, { Body: '<script>only script</script>' }]) {
      assert.match(renderZhihuOpenPlatform({ version: 1, operation: 'content.detail', data }), /不能视为全文/)
    }
  })
  it('neutralizes encoded HTML and Markdown fence breakouts in display', () => {
    assert.equal(plainZhihuText('&lt;script&gt;bad&lt;/script&gt;<p>&#x4f60;&#22909;</p>'), '你好')
    const text = renderZhihuOpenPlatform({ version: 1, operation: 'content.detail', data: { Body: '```\n![tracking](https://example.com)\n```' } })
    assert.match(text, /````json/)
    assert.equal(text.endsWith('````'), true)
  })
})
