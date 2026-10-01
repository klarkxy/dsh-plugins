import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ZHIHU_RPC_CHANNEL } from './contracts.ts'
import { createZhihuClientState } from './client-state.ts'
import { buildOpenPlatformParams, createOpenPlatformForm, openPlatformNextOffset, openPlatformOffset,
  parseOpenPlatformResponse, requestOpenPlatform, ZhihuOpenPlatformSection } from './client-open-platform.tsx'
import type { ZhihuOpenPlatformOperation, ZhihuOpenPlatformResult } from './open-platform.ts'

const form = (values: Partial<ReturnType<typeof createOpenPlatformForm>> = {}) => ({ ...createOpenPlatformForm(), ...values })
const response = (operation: ZhihuOpenPlatformOperation, data: unknown = {}, paging?: unknown) => ({
  ok: true, value: { version: 1, operation, data, ...(paging === undefined ? {} : { paging }) },
})

describe('open platform client parameters', () => {
  it('builds all seven RPC payloads without credentials or OAuth overrides', () => {
    expect(buildOpenPlatformParams('question.recommendations', form())).toEqual({ count: 5 })
    expect(buildOpenPlatformParams('question.recommendations', form({ query: ' topic ' }))).toEqual({ query: 'topic', count: 5 })
    expect(buildOpenPlatformParams('question.answers', form({ questionUrl: 'https://www.zhihu.com/question/1', offset: '9007199254740993' })))
      .toEqual({ questionUrl: 'https://www.zhihu.com/question/1', offset: '9007199254740993', limit: 20 })
    expect(buildOpenPlatformParams('content.detail', form({ contentUrl: 'https://zhuanlan.zhihu.com/p/2' }))).toEqual({ contentUrl: 'https://zhuanlan.zhihu.com/p/2' })
    expect(buildOpenPlatformParams('content.comments', form({ contentUrl: 'https://www.zhihu.com/answer/2', order: 'ascending' })))
      .toEqual({ contentUrl: 'https://www.zhihu.com/answer/2', offset: '0', limit: 20, order: 'ascending' })
    expect(buildOpenPlatformParams('creator.account.stats', form())).toEqual({ contentType: 'all' })
    expect(buildOpenPlatformParams('creator.content.stats', form({ contentUrl: 'https://www.zhihu.com/pin/2', startDate: '2024-02-29', endDate: '2024-03-01' })))
      .toEqual({ contentUrl: 'https://www.zhihu.com/pin/2', startDate: '2024-02-29', endDate: '2024-03-01' })
    expect(buildOpenPlatformParams('quota', form())).toEqual({})
    expect(buildOpenPlatformParams('quota', form({ apiIds: ['creator', 'user_data', 'creator'] }))).toEqual({ apiIds: ['creator', 'user_data'] })
  })
  it.each(['0', '21', '-1', '1.5', '1e1', '', 'Infinity'])('rejects invalid count %s', count => {
    expect(() => buildOpenPlatformParams('question.recommendations', form({ count }))).toThrow(/count/)
  })
  it.each(['0', '51', '-1', '1.5', '1e1', ''])('rejects invalid limit %s', limit => {
    expect(() => buildOpenPlatformParams('question.answers', form({ questionUrl: 'https://www.zhihu.com/question/1', limit }))).toThrow(/limit/)
  })
  it('validates dates as a pair, including leap days and ordering', () => {
    for (const [startDate, endDate] of [['2023-02-29', '2023-03-01'], ['2024-01-01', ''], ['', '2024-01-01'], ['2024-03-01', '2024-02-29'], ['0000-01-01', '0000-01-02'], ['2024-02-30', '2024-03-01']]) {
      expect(() => buildOpenPlatformParams('creator.account.stats', form({ startDate, endDate }))).toThrow()
    }
  })
  it('rejects wrong URL kinds, schemes, hosts and hidden identity fields', () => {
    for (const questionUrl of ['https://www.zhihu.com/answer/1', 'http://www.zhihu.com/question/1', 'https://evil.example/question/1', 'https://u:p@www.zhihu.com/question/1', 'https://www.zhihu.com:444/question/1', 'https://www.zhihu.com/question/1\\']) {
      expect(() => buildOpenPlatformParams('question.answers', form({ questionUrl }))).toThrow()
    }
    expect(() => buildOpenPlatformParams('content.detail', form({ contentUrl: 'https://www.zhihu.com/question/1' }))).toThrow()
    const injected = { ...form(), token: 'secret', oauthToken: 'secret' }
    expect(buildOpenPlatformParams('quota', injected)).toEqual({})
    expect(() => buildOpenPlatformParams('quota', form({ apiIds: ['unknown'] }))).toThrow()
    expect(() => buildOpenPlatformParams('creator.account.stats', form({ contentType: 'unknown' }))).toThrow()
    expect(() => buildOpenPlatformParams('content.comments', form({ contentUrl: 'https://www.zhihu.com/answer/1', order: 'unknown' }))).toThrow()
  })
  it('keeps all nonnegative Int64 offsets as strings and rejects unsafe alternatives', () => {
    expect(openPlatformOffset('9223372036854775807')).toBe('9223372036854775807')
    expect(openPlatformOffset('0009007199254740993')).toBe('9007199254740993')
    for (const value of ['9223372036854775808', '-1', '1e3', '1.1', '', 'cursor', 9007199254740992, null]) expect(openPlatformOffset(value)).toBeNull()
  })
})

describe('open platform response and paging guards', () => {
  it('preserves original quota fields without computing balances or filling zeros', () => {
    const raw = response('quota', { Items: [{ APIID: 'creator', Used: '7', Unrecognized: null }, { id: 'user_data', custom: 2 }] })
    expect(parseOpenPlatformResponse('quota', raw).data).toBe(raw.value.data)
    expect(parseOpenPlatformResponse('quota', response('quota', {})).data).toEqual({})
  })
  it('rejects malformed envelopes, wrong operations, non-JSON data and malformed paging', () => {
    for (const raw of [null, [], { ok: true }, response('quota', []), response('quota', { n: NaN }), response('quota', { f: () => 1 }),
      { ok: true, value: { version: 2, operation: 'quota', data: {} } }, response('content.detail'), response('quota', {}, { canContinue: 'yes' }),
      response('quota', {}, { canContinue: true, warning: 3 }), response('quota', {}, { canContinue: false, isEnd: 'yes' })]) {
      expect(() => parseOpenPlatformResponse('quota', raw)).toThrow()
    }
    expect(() => parseOpenPlatformResponse('quota', { ok: false, error: { code: 'rate-limited', message: '不要立即重试' } })).toThrow('rate-limited：不要立即重试')
  })
  it('only enables explicit next page for an advancing valid Int64 string and canContinue=true', () => {
    const result = (paging: unknown) => parseOpenPlatformResponse('question.answers', response('question.answers', {}, paging))
    expect(openPlatformNextOffset(result({ canContinue: true, nextOffset: '9007199254740993' }), '9007199254740992')).toBe('9007199254740993')
    for (const paging of [{ canContinue: false, nextOffset: '2' }, { canContinue: true }, { canContinue: true, nextOffset: 2 },
      { canContinue: true, nextOffset: '9223372036854775808' }, { canContinue: true, nextOffset: '1' },
      { canContinue: true, nextOffset: '0' }, { canContinue: true, nextOffset: '2', isEnd: true }]) {
      expect(openPlatformNextOffset(result(paging), '1')).toBeNull()
    }
    expect(openPlatformNextOffset(null, '0')).toBeNull()
    expect(openPlatformNextOffset({ version: 1, operation: 'quota', data: {}, paging: { canContinue: true, nextOffset: '2' } }, '1')).toBeNull()
  })
})

describe('explicit client request lineage', () => {
  it('uses the contracts channel once, passes abort signal, and never retries', async () => {
    const call = vi.fn().mockResolvedValue({ ok: false, error: { code: 'rate-limited', message: 'wait' } })
    const publish = vi.fn()
    await requestOpenPlatform({ call }, createZhihuClientState(), 'quota', {}, publish)
    expect(call).toHaveBeenCalledTimes(1)
    expect(call.mock.calls[0].slice(0, 3)).toEqual([ZHIHU_RPC_CHANNEL, 'quota', {}])
    expect(call.mock.calls[0][3]).toBeInstanceOf(AbortSignal)
    expect(publish).toHaveBeenCalledWith({ error: 'rate-limited：wait' })
  })
  it.each(['edit', 'switch', 'cancel', 'unmount'] as const)('aborts and discards even ignored abort after %s', async action => {
    let resolve!: (value: unknown) => void
    const call = vi.fn(() => new Promise<unknown>(done => { resolve = done }))
    const publish = vi.fn(), state = createZhihuClientState()
    const pending = requestOpenPlatform({ call }, state, 'quota', {}, publish)
    if (action === 'edit' || action === 'switch') state.noteInput()
    else state.cancel()
    expect((call.mock.calls[0] as unknown as [string, string, unknown, AbortSignal])[3].aborted).toBe(true)
    resolve(response('quota'))
    await pending
    expect(publish).not.toHaveBeenCalled()
    expect(call).toHaveBeenCalledTimes(1)
  })
  it('drops superseded failures while publishing only the latest response', async () => {
    let reject!: (value: unknown) => void
    const call = vi.fn().mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail })).mockResolvedValueOnce(response('quota', { Original: 3 }))
    const publish = vi.fn(), state = createZhihuClientState()
    const first = requestOpenPlatform({ call }, state, 'quota', {}, publish)
    await requestOpenPlatform({ call }, state, 'quota', {}, publish)
    reject(new Error('late failure'))
    await first
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish.mock.calls[0][0].value.data).toEqual({ Original: 3 })
  })
})

describe('open platform initial SSR', () => {
  it('renders a standalone accessible form without calling RPC', () => {
    const call = vi.fn()
    const html = renderToStaticMarkup(<ZhihuOpenPlatformSection rpc={{ call }} />)
    expect(call).not.toHaveBeenCalled()
    // Labels are user copy; the API parameter name moved into the field hint.
    expect(html).toContain('主题关键词')
    expect(html).toContain('query · ')
    expect(html).toContain('推荐数量')
    expect(html).toContain('count · 1–20')
    expect(html).not.toContain('query：')
    expect(html).toContain('非全文')
    // The fine print (OAuth, own-content scope) is folded behind one disclosure row.
    expect(html).toContain('说明')
    expect(html).toContain('不自动翻页或重试')
    expect(html).not.toContain('下一页</button>')
  })
  it.each([
    ['question.recommendations', '主题关键词'],
    ['question.answers', '知乎问题链接'],
    ['content.detail', '本人内容链接'],
    ['content.comments', '评论排序'],
    ['creator.account.stats', '内容类型'],
    ['creator.content.stats', '开始日期'],
    ['quota', '额度项'],
  ] as const)('renders only the selected %s form without another selector or heading', (selectedOperation, field) => {
    const call = vi.fn()
    const html = renderToStaticMarkup(<ZhihuOpenPlatformSection rpc={{ call }} selectedOperation={selectedOperation} />)
    expect(call).not.toHaveBeenCalled()
    expect(html).toContain(field)
    expect(html).not.toMatch(/[a-zA-Z]+：/) // no "param：" label leaks
    expect(html).not.toContain('开放平台操作')
    expect(html).not.toContain('<h3>')
    expect(html).not.toContain('下一页</button>')
    if (selectedOperation !== 'question.recommendations') expect(html).not.toContain('主题关键词')
    if (selectedOperation !== 'question.answers') expect(html).not.toContain('知乎问题链接')
  })
  it('embeds quotaOnly with all official choices and no business operation selector or RPC', () => {
    const call = vi.fn()
    const html = renderToStaticMarkup(<ZhihuOpenPlatformSection rpc={{ call }} quotaOnly />)
    expect(call).not.toHaveBeenCalled()
    expect(html).toContain('官方每日额度')
    expect(html).toContain('全部额度项')
    expect(html).toContain('不推算余额')
    // The choice list is the official checkbox on a contract card, so it
    // inherits the host's own control and focus appearance.
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('dsh-ui-card--flat')
    expect(html).not.toContain('开放平台操作')
    expect(html).not.toContain('questionUrl')
    expect(html).not.toContain('<pre')
  })
})
