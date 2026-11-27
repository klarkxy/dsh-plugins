import { describe, expect, it, vi } from 'vitest'
import { createZhihuSyncService, zhihuSyncDomainSpec, type SyncDraftRecord } from './sync-service.ts'

vi.mock('./sync-media.ts', () => ({ uploadZhihuSyncMedia: vi.fn() }))
const draft = { type: 'article', title: '同步测试', body: '这是一篇足够长的测试文章正文。', format: 'markdown' } as const
const signal = () => new AbortController().signal
function fixture() {
  const rows = new Map<string, SyncDraftRecord>()
  const table = { get: (id: string) => structuredClone(rows.get(id)), entries: () => rows.entries(), put: async (id: string, record: SyncDraftRecord) => { rows.set(id, structuredClone(record)) } }
  const resolveCredentials = vi.fn(async () => ({ appKey: 'test-member', appSecret: 'test-only-secret' }))
  const service = createZhihuSyncService(table, { resolveCredentials })
  const call = (endpoint: string, input: unknown, caller: 'ui' | 'tool' = 'ui') => service.call(`sync.${endpoint}`, input, signal(), caller) as Promise<any>
  return { rows, table, service, call, resolveCredentials }
}

describe('saved sync drafts', () => {
  it('preserves invalid drafts while prepare reports validation issues for both callers', async () => {
    const { call } = fixture()
    const record = await call('save', { draft: { ...draft, title: '', body: '' } })
    expect(record.draft.title).toBe('')
    const prepared = await call('prepare', { id: record.id, expectedRevision: 1 })
    expect(prepared.prepared.canPublish).toBe(false)
    expect(prepared).not.toHaveProperty('reviewToken')
    const toolPrepared = await call('prepare', { id: record.id, expectedRevision: 1 }, 'tool')
    expect(toolPrepared).toEqual(prepared)
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

  it('has no publish operation even for tool callers', async () => {
    const { call } = fixture()
    const record = await call('save', { draft }, 'tool')
    const prepared = await call('prepare', { id: record.id, expectedRevision: 1 }, 'tool')
    expect(prepared).not.toHaveProperty('reviewToken')
    await expect(call('publish', { id: record.id, expectedRevision: 1, confirmed: true }, 'tool')).rejects.toMatchObject({ code: 'bad-request' })
  })

  it('still parses stored publish-state records and keeps them publish-locked', async () => {
    const { call, rows } = fixture()
    const stored: SyncDraftRecord = {
      id: 'old', revision: 3, updatedAt: new Date().toISOString(), draft: draft as SyncDraftRecord['draft'],
      publishState: 'uncertain',
      published: { url: 'https://zhuanlan.zhihu.com/p/123', contentToken: '123', type: 'article' },
      lastError: '未能确认发布结果',
    }
    expect(() => zhihuSyncDomainSpec.tables.drafts.valueSchema.parse(stored)).not.toThrow()
    rows.set(stored.id, stored)
    await expect(call('prepare', { id: stored.id, expectedRevision: 3 })).rejects.toMatchObject({ code: 'publish-locked' })
    await expect(call('save', { id: stored.id, expectedRevision: 3, draft })).rejects.toMatchObject({ code: 'publish-locked' })
    expect((await call('get', { id: stored.id })).publishState).toBe('uncertain')
  })
})
