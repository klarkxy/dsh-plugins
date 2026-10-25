import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createZhihuSyncService, type SyncDraftRecord } from './sync-service.ts'
import { publishZhihuSync, ZhihuSyncApiError } from './sync-api.ts'
vi.mock('./sync-api.ts', async importOriginal => ({ ...await importOriginal<typeof import('./sync-api.ts')>(), publishZhihuSync: vi.fn() }))
vi.mock('./sync-media.ts', () => ({ uploadZhihuSyncMedia: vi.fn() }))
const draft = { type: 'article', title: '同步测试', body: '这是一篇足够长的测试文章正文。', format: 'markdown' }
const signal = () => new AbortController().signal
function fixture() {
  const rows = new Map<string, SyncDraftRecord>()
  const table = { get: (id: string) => structuredClone(rows.get(id)), entries: () => rows.entries(), put: async (id: string, record: SyncDraftRecord) => { rows.set(id, structuredClone(record)) } }
  const resolveCredentials = vi.fn(async () => ({ appKey: 'test-member', appSecret: 'test-only-secret' }))
  const service = createZhihuSyncService(table, { resolveCredentials })
  const call = (endpoint: string, input: unknown, caller: 'ui' | 'tool' = 'ui') => service.call(`sync.${endpoint}`, input, signal(), caller) as Promise<any>
  return { rows, table, service, call, resolveCredentials }
}
beforeEach(() => { vi.mocked(publishZhihuSync).mockReset() })
describe('saved sync drafts and review boundary', () => {
  it('preserves invalid drafts but cannot issue a publishing ticket', async () => {
    const { call } = fixture()
    const record = await call('save', { draft: { ...draft, title: '', body: '' } })
    expect(record.draft.title).toBe('')
    const prepared = await call('prepare', { id: record.id, expectedRevision: 1 })
    expect(prepared.prepared.canPublish).toBe(false)
    expect(prepared.reviewToken).toBe('')
  })
  it('keeps older drafts reachable through bounded pagination', async () => {
    const { call, rows } = fixture()
    for (let i = 0; i < 103; i++) rows.set(String(i), { id: String(i), revision: 1, updatedAt: String(i).padStart(4, '0'), draft: draft as SyncDraftRecord['draft'] })
    const first = await call('list', {})
    expect(first.drafts).toHaveLength(100)
    expect(first.nextOffset).toBe(100)
    const last = await call('list', { offset: first.nextOffset })
    expect(last.drafts).toHaveLength(3)
    expect(last.nextOffset).toBeUndefined()
    expect(first.drafts[0]).not.toHaveProperty('draft')
  })
  it('rejects malformed fields instead of losing their errors during save', async () => {
    const { call, rows } = fixture()
    for (const invalid of [{ ...draft, type: 'answer' }, { ...draft, images: [null] }, { ...draft, settings: { topics: [123] } }]) {
      await expect(call('save', { draft: invalid })).rejects.toMatchObject({ code: 'bad-request' })
    }
    expect(rows.size).toBe(0)
  })
  it('rejects stale writes and does not overwrite newer content', async () => {
    const { call } = fixture()
    const record = await call('save', { draft })
    await call('save', { id: record.id, expectedRevision: 1, draft: { ...draft, title: '已更新' } })
    await expect(call('save', { id: record.id, expectedRevision: 1, draft })).rejects.toMatchObject({ code: 'conflict' })
    expect((await call('get', { id: record.id })).draft.title).toBe('已更新')
  })
  it('never grants tool callers a review token or publishing authority', async () => {
    const { call } = fixture()
    const record = await call('save', { draft }, 'tool')
    const prepared = await call('prepare', { id: record.id, expectedRevision: 1 }, 'tool')
    expect(prepared).not.toHaveProperty('reviewToken')
    await expect(call('publish', { id: record.id, expectedRevision: 1, confirmed: true }, 'tool')).rejects.toMatchObject({ code: 'confirmation-required' })
    expect(publishZhihuSync).not.toHaveBeenCalled()
  })
  it('invalidates review after edits and requires the current revision', async () => {
    const { call } = fixture()
    const record = await call('save', { draft })
    const review = await call('prepare', { id: record.id, expectedRevision: 1 })
    await call('save', { id: record.id, expectedRevision: 1, draft: { ...draft, title: '修改后的标题' } })
    await expect(call('publish', { id: record.id, expectedRevision: 2, reviewToken: review.reviewToken, confirmed: true })).rejects.toMatchObject({ code: 'confirmation-required' })
    expect(publishZhihuSync).not.toHaveBeenCalled()
  })
  it('serializes duplicate publishes and persists intent before sending', async () => {
    const { call, rows } = fixture()
    const record = await call('save', { draft })
    const review = await call('prepare', { id: record.id, expectedRevision: 1 })
    vi.mocked(publishZhihuSync).mockImplementation(async () => {
      expect(rows.get(record.id)?.publishState).toBe('publishing')
      return { type: 'article', url: 'https://zhuanlan.zhihu.com/p/123', contentToken: '123' }
    })
    const input = { id: record.id, expectedRevision: 1, reviewToken: review.reviewToken, confirmed: true }
    const results = await Promise.allSettled([call('publish', input), call('publish', input)])
    expect(results[0]).toMatchObject({ status: 'fulfilled', value: { publishState: 'published' } })
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'publish-locked' } })
    expect(publishZhihuSync).toHaveBeenCalledTimes(1)
  })
  it('keeps an uncertain result locked even after restarting the service', async () => {
    const { call, table, resolveCredentials } = fixture()
    const record = await call('save', { draft })
    const review = await call('prepare', { id: record.id, expectedRevision: 1 })
    vi.mocked(publishZhihuSync).mockRejectedValue(new Error('network secret must not escape'))
    const result = await call('publish', { id: record.id, expectedRevision: 1, reviewToken: review.reviewToken, confirmed: true })
    expect(result.publishState).toBe('uncertain')
    expect(JSON.stringify(result)).not.toContain('secret')
    const reopened = createZhihuSyncService(table, { resolveCredentials })
    await expect(reopened.call('sync.prepare', { id: record.id, expectedRevision: 1 }, signal())).rejects.toMatchObject({ code: 'publish-locked' })
  })
  it('reports definite upstream rejection and requires another preview before retrying', async () => {
    const { call } = fixture()
    const record = await call('save', { draft })
    const review = await call('prepare', { id: record.id, expectedRevision: 1 })
    vi.mocked(publishZhihuSync).mockRejectedValue(new ZhihuSyncApiError('AUTH_REJECTED', '鉴权失败', true, 401))
    const input = { id: record.id, expectedRevision: 1, reviewToken: review.reviewToken, confirmed: true }
    const result = await call('publish', input)
    expect(result.publishState).toBeUndefined()
    expect(result.lastError).toBe('鉴权失败')
    await expect(call('publish', input)).rejects.toMatchObject({ code: 'confirmation-required' })
  })
  it('does not consume a draft when credentials are missing before sending', async () => {
    const { call, resolveCredentials } = fixture()
    const record = await call('save', { draft })
    const review = await call('prepare', { id: record.id, expectedRevision: 1 })
    resolveCredentials.mockRejectedValue(new Error('missing credential'))
    await expect(call('publish', { id: record.id, expectedRevision: 1, reviewToken: review.reviewToken, confirmed: true })).rejects.toThrow('missing credential')
    expect((await call('get', { id: record.id })).publishState).toBeUndefined()
    expect(publishZhihuSync).not.toHaveBeenCalled()
  })
})
