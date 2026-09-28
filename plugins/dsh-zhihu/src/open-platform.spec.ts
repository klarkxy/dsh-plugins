import { describe, expect, it, vi } from 'vitest'
import {
  executeZhihuQuestionRecommendations as recommendations, executeZhihuQuestionAnswers as answers,
  executeZhihuContentDetail as detail, executeZhihuContentComments as comments,
  executeZhihuCreatorAccountStats as accountStats, executeZhihuCreatorContentStats as contentStats,
  normalizeZhihuOffset, renderZhihuQuestionAnswers, renderZhihuContentDetail,
  renderZhihuContentComments, renderZhihuCreatorAccountStats, renderZhihuCreatorContentStats,
  type ZhihuOpenResult,
} from './open-platform.ts'
import { parseZhihuEnvelope, type ZhihuClientOptions, type ZhihuSearchFetcher } from './zhihu-client.ts'

const questionUrl = 'https://www.zhihu.com/question/123/'
const contentUrl = 'https://www.zhihu.com/question/123/answer/456'
const env = { ZHIHU_ACCESS_TOKEN: 'test-access-secret' }
function response(data: unknown = {}, code = 0, status = 200): Awaited<ReturnType<ZhihuSearchFetcher>> {
  const body = { Code: code, Message: 'upstream message', Data: data }
  return { ok: status < 400, status, headers: { get: key => key === 'Retry-After' ? '60' : null },
    async text() { return JSON.stringify(body) }, async json() { return body } }
}
function fixture(data: unknown = {}) {
  const fetcher = vi.fn<ZhihuSearchFetcher>(async () => response(data))
  return { fetcher, options: { env, fetcher } }
}
const cases: Array<{ name: string; run: (o: ZhihuClientOptions) => Promise<ZhihuOpenResult>; path: string; params: Record<string, string> }> = [
  { name: 'recommendations', run: o => recommendations({}, o), path: '/user/question_recommendations', params: { Count: '5' } },
  { name: 'answers', run: o => answers({ questionUrl }, o), path: '/content/question_answers', params: { QuestionUrl: questionUrl, Offset: '0', Limit: '20' } },
  { name: 'detail', run: o => detail({ contentUrl }, o), path: '/user/content_detail', params: { ContentUrl: contentUrl } },
  { name: 'comments', run: o => comments({ contentUrl }, o), path: '/user/content_comments', params: { ContentUrl: contentUrl, Offset: '0', Limit: '20', Order: 'score' } },
  { name: 'account stats', run: o => accountStats({}, o), path: '/user/creator_account_stats', params: { ContentType: 'all' } },
  { name: 'content stats', run: o => contentStats({ contentUrl }, o), path: '/user/creator_content_stats', params: { ContentUrl: contentUrl } },
]

describe('six Access Secret API contracts', () => {
  it.each(cases)('$name uses the exact GET route, defaults and only Access Secret headers', async ({ run, path, params }) => {
    const { fetcher, options } = fixture({ Items: [] })
    await run({ ...options, resolveCredential: async () => 'host-access-secret' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [input, init] = fetcher.mock.calls[0]
    const url = new URL(input)
    expect(url.origin).toBe('https://developer.zhihu.com')
    expect(url.pathname).toBe(`/api/v1${path}`)
    expect(Object.fromEntries(url.searchParams)).toEqual(params)
    expect(init?.method).toBe('GET')
    expect(init?.body).toBeUndefined()
    expect(init?.headers).toEqual({ Authorization: 'Bearer host-access-secret', Accept: 'application/json', 'X-Request-Timestamp': expect.stringMatching(/^\d+$/) })
  })
  it('distinguishes omitted recommendation themes from blank themes', async () => {
    const { fetcher, options } = fixture()
    await recommendations({ query: '  AI Agent  ', count: 20 }, options)
    expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('Query')).toBe('AI Agent')
    await expect(recommendations({ query: '  ' }, options)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS', message: expect.stringContaining('画像推荐') })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each([0, -1, 21, 1.5, NaN, '5', null, true])('rejects invalid recommendation count %s before networking', async count => {
    const { fetcher, options } = fixture()
    await expect(recommendations({ count } as never, options)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([0, -1, 51, 1.5, NaN, '20', null, true])('rejects invalid page limit %s', async limit => {
    const { fetcher, options } = fixture()
    await expect(answers({ questionUrl, limit } as never, options)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' })
    await expect(comments({ contentUrl, limit } as never, options)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['http://www.zhihu.com/question/1', 'https://example.com/question/1', contentUrl, '', 'https://www.zhihu.com/question/abc'])('rejects non-question URLs %s', async questionUrl => {
    const { fetcher, options } = fixture()
    await expect(answers({ questionUrl }, options)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([contentUrl, 'https://www.zhihu.com/answer/9', 'https://zhuanlan.zhihu.com/p/1/', 'https://www.zhihu.com/pin/9', 'https://www.zhihu.com/zvideo/9'])('accepts documented creator URL %s', async contentUrl => {
    const { fetcher, options } = fixture()
    await detail({ contentUrl: ` ${contentUrl} ` }, options)
    await comments({ contentUrl, limit: 50, order: 'ascending' }, options)
    await contentStats({ contentUrl }, options)
    expect(fetcher.mock.calls.every(([input]) => new URL(input).searchParams.get('ContentUrl') === contentUrl)).toBe(true)
    expect(new URL(fetcher.mock.calls[1][0]).searchParams.get('Order')).toBe('ascending')
  })
  it.each([questionUrl, 'https://www.zhihu.com/p/123', 'http://www.zhihu.com/answer/1', 'https://www.zhihu.com.evil.test/answer/1', 'https://user:password@www.zhihu.com/answer/1'])('rejects unsupported creator URL %s', async contentUrl => {
    const { fetcher, options } = fixture()
    await expect(detail({ contentUrl }, options)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' })
    await expect(comments({ contentUrl }, options)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' })
    await expect(contentStats({ contentUrl }, options)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('rejects invalid order and content type without substituting defaults', async () => {
    const { fetcher, options } = fixture()
    await expect(comments({ contentUrl, order: 'latest' } as never, options)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' })
    await expect(accountStats({ contentType: 'question' } as never, options)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([
    { startDate: '2026-09-01' }, { endDate: '2026-09-01' },
    { startDate: '2026-09-08', endDate: '2026-09-01' },
    { startDate: '2026-02-29', endDate: '2026-03-01' },
    { startDate: '2026-2-01', endDate: '2026-03-01' },
    { startDate: '', endDate: '' }, { startDate: '2026-04-31', endDate: '2026-05-01' },
  ])('rejects invalid date pair %j', async dates => {
    const { fetcher, options } = fixture()
    await expect(accountStats(dates, options)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' })
    await expect(contentStats({ contentUrl, ...dates }, options)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('sends paired dates exactly and accepts leap days and same-day ranges', async () => {
    const { fetcher, options } = fixture()
    await accountStats({ contentType: 'article', startDate: '2024-02-29', endDate: '2024-02-29' }, options)
    await contentStats({ contentUrl, startDate: '2026-09-01', endDate: '2026-09-08' }, options)
    expect(Object.fromEntries(new URL(fetcher.mock.calls[0][0]).searchParams)).toEqual({ ContentType: 'article', StartDate: '2024-02-29', EndDate: '2024-02-29' })
    expect(new URL(fetcher.mock.calls[1][0]).searchParams.get('EndDate')).toBe('2026-09-08')
  })
  it('rejects attempted OAuth or user switching on every entry point', async () => {
    const { fetcher, options } = fixture()
    for (const selector of [{ oauthToken: 'other-token' }, { userId: 'someone-else' }]) {
      await expect(recommendations(selector as never, options)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' })
      await expect(answers({ questionUrl, ...selector }, options)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' })
      await expect(detail({ contentUrl, ...selector }, options)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' })
      await expect(comments({ contentUrl, ...selector }, options)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' })
      await expect(accountStats(selector as never, options)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' })
      await expect(contentStats({ contentUrl, ...selector }, options)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' })
    }
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('lossless one-page pagination', () => {
  it.each([-1, '-1', 1.5, '1.5', true, null, '', '1e3', 9007199254740992, '9223372036854775808'])('rejects invalid offset %s', value => {
    expect(() => normalizeZhihuOffset(value)).toThrow()
  })
  it.each(['0', '9007199254740993', '9223372036854775807'])('sends Int64 %s without rounding', async offset => {
    const { fetcher, options } = fixture()
    await answers({ questionUrl, offset }, options)
    expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('Offset')).toBe(offset)
  })
  it('preserves raw JSON Int64 NextOffset and uses it on the next request', async () => {
    const raw = '{"Code":0,"Data":{"Items":[],"Paging":{"IsEnd":false,"NextOffset":9223372036854775807}}}'
    const fetcher = vi.fn<ZhihuSearchFetcher>(async () => ({ ...response(), async text() { return raw } }))
    const result = await answers({ questionUrl }, { env, fetcher })
    expect(result.data.Paging).toEqual({ IsEnd: false, NextOffset: '9223372036854775807' })
    expect(result.paging).toEqual({ canContinue: true, nextOffset: '9223372036854775807' })
    await answers({ questionUrl, offset: result.paging!.nextOffset }, { env, fetcher })
    expect(new URL(fetcher.mock.calls[1][0]).searchParams.get('Offset')).toBe('9223372036854775807')
  })
  it.each([
    [{ IsEnd: false, NextOffset: 40 }, true], [{ IsEnd: false }, false], [{ IsEnd: true, NextOffset: 40 }, false],
    [{ IsEnd: false, NextOffset: 20 }, false], [{ IsEnd: false, NextOffset: 10 }, false],
    [{ IsEnd: false, NextOffset: -1 }, false], [{ NextOffset: 40 }, false], [undefined, false],
  ])('uses Paging %j even when the page is empty', async (Paging, canContinue) => {
    const { fetcher, options } = fixture({ Items: [], Paging })
    const a = await answers({ questionUrl, offset: 20 }, options)
    const c = await comments({ contentUrl, offset: '20' }, options)
    expect(a.paging?.canContinue).toBe(canContinue)
    expect(c.paging?.canContinue).toBe(canContinue)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})

describe('upstream errors and display semantics', () => {
  it.each([[10001, 'INVALID_ARGUMENTS'], [20001, 'TOKEN_INVALID'], [30001, 'RATE_LIMITED'], [30002, 'RATE_LIMITED'], [30003, 'RISK_CONTROL'], [90001, 'UPSTREAM_UNAVAILABLE']])('maps business code %s to %s', async (code, expected) => {
    const fetcher = vi.fn<ZhihuSearchFetcher>(async () => response({}, Number(code)))
    await expect(recommendations({}, { env, fetcher })).rejects.toMatchObject({ code: expected, apiCode: code })
    expect(fetcher).toHaveBeenCalledTimes(1)
    if (code === 30003) await expect(recommendations({}, { env, fetcher })).rejects.toMatchObject({ retryAfter: undefined, message: expect.stringContaining('不要立即重试') })
  })
  it.each([[401, 'TOKEN_INVALID'], [403, 'TOKEN_INVALID'], [429, 'RATE_LIMITED'], [503, 'HTTP_ERROR']])('handles HTTP %s as %s', async (status, expected) => {
    const fetcher: ZhihuSearchFetcher = async () => response({}, 0, Number(status))
    await expect(recommendations({}, { env, fetcher })).rejects.toMatchObject({ code: expected, status })
    if (status === 429) await expect(recommendations({}, { env, fetcher })).rejects.toMatchObject({ retryAfter: '60' })
  })
  it('recognizes risk control in an HTTP 400 envelope', async () => {
    await expect(recommendations({}, { env, fetcher: async () => response({}, 30003, 400) })).rejects.toMatchObject({ code: 'RISK_CONTROL' })
  })
  it('preserves Retry-After for envelope limits, but never attaches it to risk refusal', async () => {
    await expect(recommendations({}, { env, fetcher: async () => response({}, 30002) })).rejects.toMatchObject({ code: 'RATE_LIMITED', apiCode: 30002, retryAfter: '60' })
    await expect(recommendations({}, { env, fetcher: async () => response({}, 30003) })).rejects.toMatchObject({ code: 'RISK_CONTROL', apiCode: 30003, retryAfter: undefined })
  })
  it.each([{}, { Code: null }, { Code: false }, { Code: '' }, { Code: 'garbage' }, []])('rejects malformed envelope %j', body => {
    expect(() => parseZhihuEnvelope(body)).toThrow()
  })
  it('rejects invalid JSON and non-object Data', async () => {
    await expect(recommendations({}, { env, fetcher: async () => ({ ...response(), async text() { return 'not json' } }) })).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
    await expect(recommendations({}, fixture([]).options)).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
  })
  it('handles cancellation before networking and while reading the response body', async () => {
    const controller = new AbortController()
    controller.abort()
    const { fetcher, options } = fixture()
    await expect(recommendations({}, { ...options, signal: controller.signal })).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(fetcher).not.toHaveBeenCalled()
    const active = new AbortController()
    await expect(recommendations({}, { env, signal: active.signal, fetcher: async () => ({ ...response(), async text() { active.abort(); throw new DOMException('abort', 'AbortError') } }) })).rejects.toMatchObject({ code: 'CANCELLED' })
  })
  it('keeps timeout active until the body has been read', async () => {
    const fetcher: ZhihuSearchFetcher = async (_url, init) => ({ ...response(), text: () => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')), { once: true })) })
    await expect(recommendations({}, { env, fetcher, timeoutMs: 10 })).rejects.toMatchObject({ code: 'TIMEOUT' })
  })
  it('renders bodies, summaries and child comments as escaped text', async () => {
    const html = '<p>正文 &amp; 文本</p><script>alert(1)</script><style>bad{}</style>&lt;img src=x onerror=evil&gt;'
    const d = await detail({ contentUrl }, fixture({ Body: html }).options)
    const c = await comments({ contentUrl }, fixture({ Items: [{ Comment: { ID: '1', Content: html }, Children: [{ ID: '2', Content: '<p>子评论</p>' }] }], Paging: { IsEnd: false } }).options)
    const a = await answers({ questionUrl }, fixture({ Items: [{ Summary: html }], Paging: { IsEnd: false } }).options)
    for (const text of [renderZhihuContentDetail(d), renderZhihuContentComments(c), renderZhihuQuestionAnswers(a)]) {
      expect(text).toContain('正文 &amp; 文本')
      expect(text).not.toMatch(/<script|<img|<p>|alert\(1\)|bad\{/)
    }
    expect(renderZhihuContentComments(c)).toContain('子评论')
    expect(renderZhihuContentComments(c)).toContain('停止翻页')
    expect(renderZhihuQuestionAnswers(a)).toContain('不是全文')
    expect(renderZhihuContentDetail({ version: 1, data: { ContentType: 'zvideo', Body: '' } })).toContain('不能视为全文')
  })
  it('preserves missing statistics, zero values and upstream ratios', async () => {
    const data = { Metrics: { ReadCount: 0, Rate: 0.25 }, Audience: { UnknownField: 7 } }
    const result = await accountStats({}, fixture(data).options)
    expect(result.data).toEqual(data)
    const text = renderZhihuCreatorAccountStats(result)
    expect(text).toContain('ReadCount：0')
    expect(text).toContain('Rate：0.25')
    expect(text).not.toContain('25%')
    expect(text).not.toContain('LikeCount')
    expect(renderZhihuCreatorContentStats({ version: 1, data: { Items: [] } })).toContain('不等于各项指标为零')
  })
})
