import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebFetchProvider, WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web'
import { JinaFirstFetchProvider } from './jina-fetch.ts'

const target = 'https://example.com/article?lang=zh&n=2'
const markdown = 'Title: Example\n\nURL Source: ' + target + '\n\nMarkdown Content:\n# Example\n\nReadable content.'
function result(content: string, statusCode = 200): WebFetchResult {
  return { url: target, statusCode, body: { kind: 'text', content }, truncated: false }
}
function setup(readerTimeoutMs = 15_000) {
  const read = vi.fn(async (_request: WebFetchRequest, _signal?: AbortSignal): Promise<WebFetchResult> => result(markdown))
  const direct = vi.fn(async (_request: WebFetchRequest, _signal?: AbortSignal): Promise<WebFetchResult> => result('Direct body'))
  const provider = new JinaFirstFetchProvider({
    reader: { id: 'reader', available: () => true, fetch: read },
    direct: { id: 'http', available: () => true, fetch: direct },
    readerTimeoutMs,
  })
  return { provider, read, direct }
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('anonymous Jina-first page fetch', () => {
  it('keeps the managed identity and performs no work during construction/availability checks', () => {
    const { provider, read, direct } = setup()
    expect(provider.id).toBe('http')
    expect(provider.available()).toBe(true)
    expect(read).not.toHaveBeenCalled()
    expect(direct).not.toHaveBeenCalled()
  })

  it('prefers Reader without credentials and reports the original URL rather than the proxy', async () => {
    const { provider, read, direct } = setup()
    read.mockResolvedValueOnce({ ...result(markdown), url: 'https://r.jina.ai/' + target, truncated: true })
    const fetched = await provider.fetch({ url: target })
    expect(read).toHaveBeenCalledOnce()
    expect(read.mock.calls[0]?.[0]).toEqual({ url: 'https://r.jina.ai/' + target })
    expect(read.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal)
    expect(fetched).toEqual({ ...result(markdown), truncated: true })
    expect(direct).not.toHaveBeenCalled()
  })

  it.each([
    { code: 200, status: 20000, data: { url: target, title: 'Example', content: '# JSON page' } },
    { url: target, title: 'Example', content: '# JSON page' },
  ])('accepts negotiated JSON and extracts only the page content', async payload => {
    const { provider, read, direct } = setup()
    read.mockResolvedValueOnce(result(JSON.stringify(payload)))
    expect(await provider.fetch({ url: target })).toEqual(result('# JSON page'))
    expect(direct).not.toHaveBeenCalled()
  })

  it('accepts CRLF envelopes and does not mistake warnings inside the article for metadata', async () => {
    const { provider, read, direct } = setup()
    read.mockResolvedValueOnce(result('Title: Example\r\n\r\nMarkdown Content:\r\nWarning: this is part of the article.'))
    await provider.fetch({ url: target })
    expect(direct).not.toHaveBeenCalled()
  })

  it.each([301, 401, 402, 403, 404, 429, 500, 503])('falls back once on Reader HTTP %s', async status => {
    const { provider, read, direct } = setup()
    const request = { url: target }
    const signal = new AbortController().signal
    read.mockResolvedValueOnce(result(markdown, status))
    expect(await provider.fetch(request, signal)).toEqual(result('Direct body'))
    expect(read).toHaveBeenCalledOnce()
    expect(direct).toHaveBeenCalledOnce()
    expect(direct).toHaveBeenCalledWith(request, signal)
  })

  it.each([
    '{invalid json', '{\"code\":200,\"data\":{\"content\":\"   \"}}',
    JSON.stringify({ code: 200, data: { content: 'Forbidden', warning: 'Target returned 403' } }),
    JSON.stringify({ code: 429, data: { content: 'Quota exceeded' } }),
    '', '   ', 'Title: Example\n\nMarkdown Content:\n   ',
    '{"code":429,"message":"Rate limited"}', '<html>Gateway error</html>',
    'Title: Example\nWarning: Target URL returned error 403\n\nMarkdown Content:\nForbidden',
  ])('rejects unusable Reader content: %s', async content => {
    const { provider, read, direct } = setup()
    read.mockResolvedValueOnce(result(content))
    await provider.fetch({ url: target })
    expect(direct).toHaveBeenCalledOnce()
  })

  it('rejects an HTML error response even if it includes a Markdown marker', async () => {
    const { provider, read, direct } = setup()
    read.mockResolvedValueOnce({ ...result(markdown), body: { kind: 'html', content: markdown } })
    await provider.fetch({ url: target })
    expect(direct).toHaveBeenCalledOnce()
  })

  it('falls back after network/stream errors and returns the original direct result unchanged', async () => {
    const { provider, read, direct } = setup()
    const fallback: WebFetchResult = { ...result('<h1>Direct</h1>', 404), body: { kind: 'html', content: '<h1>Direct</h1>' }, truncated: true }
    read.mockRejectedValueOnce(new Error('socket reset'))
    direct.mockResolvedValueOnce(fallback)
    expect(await provider.fetch({ url: target })).toBe(fallback)
  })

  it('propagates the direct failure without retrying either stage', async () => {
    const { provider, read, direct } = setup()
    const failure = new Error('direct failed')
    read.mockRejectedValueOnce(new Error('reader failed'))
    direct.mockRejectedValueOnce(failure)
    await expect(provider.fetch({ url: target })).rejects.toBe(failure)
    expect(read).toHaveBeenCalledOnce()
    expect(direct).toHaveBeenCalledOnce()
  })

  it('reserves time for direct fetch even when Reader ignores its abort signal', async () => {
    vi.useFakeTimers()
    const { provider, read, direct } = setup(15)
    read.mockImplementationOnce(() => new Promise(() => {}))
    const signal = new AbortController().signal
    const pending = provider.fetch({ url: target }, signal)
    await vi.advanceTimersByTimeAsync(15)
    expect(await pending).toEqual(result('Direct body'))
    expect(read.mock.calls[0]?.[1]?.aborted).toBe(true)
    expect(signal.aborted).toBe(false)
    expect(direct).toHaveBeenCalledOnce()
    expect(direct).toHaveBeenCalledWith({ url: target }, signal)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not start either stage when already cancelled', async () => {
    const { provider, read, direct } = setup()
    await expect(provider.fetch({ url: target }, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' })
    expect(read).not.toHaveBeenCalled()
    expect(direct).not.toHaveBeenCalled()
  })

  it('cancels in-flight Reader without falling back, even when Reader ignores cancellation', async () => {
    const { provider, read, direct } = setup()
    const controller = new AbortController()
    read.mockImplementationOnce(() => new Promise(() => {}))
    const pending = provider.fetch({ url: target }, controller.signal).catch(error => error)
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
    controller.abort()
    expect(await pending).toMatchObject({ name: 'AbortError' })
    expect(direct).not.toHaveBeenCalled()
  })

  it.each([
    'not a URL', 'file:///etc/passwd', 'ftp://example.com/file',
    'https://user:password@example.com/private', 'http://localhost:3080',
    'http://host.local/', 'http://host.internal/', 'http://host.lan/',
    'http://127.0.0.1/', 'http://2130706433/', 'http://192.168.1.1/',
    'http://[::1]/', 'http://[::ffff:127.0.0.1]/',
    'https://r.jina.ai/https://example.com',
  ])('leaves %s to the original HTTP policy without forwarding it to Reader', async url => {
    const { provider, read, direct } = setup()
    await provider.fetch({ url })
    expect(read).not.toHaveBeenCalled()
    expect(direct).toHaveBeenCalledOnce()
    expect(direct).toHaveBeenCalledWith({ url }, undefined)
  })

  it('uses direct fetch when Reader is locally unavailable', async () => {
    const { read, direct } = setup()
    const reader: WebFetchProvider = { id: 'reader', available: () => false, fetch: read }
    const provider = new JinaFirstFetchProvider({ reader,
      direct: { id: 'http', available: () => true, fetch: direct }, readerTimeoutMs: 15_000 })
    await provider.fetch({ url: target })
    expect(read).not.toHaveBeenCalled()
    expect(direct).toHaveBeenCalledOnce()
  })
})
