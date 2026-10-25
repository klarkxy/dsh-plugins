import { randomUUID } from 'node:crypto'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { prepareZhihuSyncDraft } from './sync-content.ts'
import { publishZhihuSync, ZhihuSyncApiError, type ZhihuSyncTransportOptions } from './sync-api.ts'
import { uploadZhihuSyncMedia } from './sync-media.ts'
import type { SyncDraft } from './sync-types.ts'

export const ZHIHU_SYNC_CREDENTIAL_REFS = ['ZHIHU_OPENAPI_APP_KEY', 'ZHIHU_OPENAPI_APP_SECRET'] as const

export type SyncDraftRecord = {
  id: string
  revision: number
  updatedAt: string
  draft: SyncDraft
  publishState?: 'publishing' | 'published' | 'uncertain'
  published?: { url: string; contentToken: string; type: string }
  lastError?: string
}

const draftSchema = z.object({
  type: z.enum(['article', 'question', 'pin']), title: z.string().max(10_000),
  body: z.string().max(2_000_000), format: z.enum(['markdown', 'html']),
  images: z.array(z.object({
    url: z.string(), originalUrl: z.string().optional(), width: z.number().positive().optional(),
    height: z.number().positive().optional(), watermark: z.boolean().optional(), mediaId: z.string().optional(),
  }).strict()).max(200).optional(),
  linkCard: z.object({
    url: z.string(), title: z.string().optional(), cover: z.string().optional(),
    contentType: z.string().optional(), contentId: z.string().optional(), isFromForward: z.boolean().optional(),
  }).strict().nullable().optional(),
  settings: z.object({
    commentPermission: z.enum(['all', 'nobody', 'followee', 'censor', 'follower', 'follower_n_days']).optional(),
    creationStatement: z.enum(['spoiler', 'medical_advice', 'fictional_creation', 'contain_finance', 'ai_creation']).optional(),
    tableOfContentsEnabled: z.boolean().optional(), topics: z.array(z.string()).max(100).optional(), ring: z.string().optional(),
  }).strict().optional(),
}).strict()

const recordSchema = z.object({
  id: z.string(), revision: z.number().int().positive(), updatedAt: z.string(),
  draft: draftSchema,
  publishState: z.enum(['publishing', 'published', 'uncertain']).optional(),
  published: z.object({ url: z.string(), contentToken: z.string(), type: z.string() }).optional(),
  lastError: z.string().optional(),
})

export const zhihuSyncDomainSpec = defineDomain({
  name: 'dsh_zhihu_sync', version: 1,
  tables: { drafts: domainTable<string, SyncDraftRecord>(recordSchema) },
})

export interface SyncDraftTable {
  get(id: string): SyncDraftRecord | undefined
  entries(): IterableIterator<[string, SyncDraftRecord]>
  put(id: string, record: SyncDraftRecord): Promise<void>
}

export class ZhihuSyncServiceError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ZhihuSyncServiceError('bad-request', '请求参数必须为对象。')
  return value as Record<string, unknown>
}

/** Review tickets bind an exact saved revision. Only the human UI receives them;
 * model tools can prepare content but cannot grant publishing authority. */
export function createZhihuSyncService(table: SyncDraftTable, options: ZhihuSyncTransportOptions) {
  const reviews = new Map<string, { revision: number; token: string; expires: number }>()
  const locks = new Map<string, Promise<unknown>>()
  async function locked<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = locks.get(id) ?? Promise.resolve()
    const current = previous.catch(() => {}).then(operation)
    locks.set(id, current)
    try { return await current } finally { if (locks.get(id) === current) locks.delete(id) }
  }
  function get(id: unknown) {
    if (typeof id !== 'string' || !id) throw new ZhihuSyncServiceError('bad-request', '缺少草稿 ID。')
    const record = table.get(id)
    if (!record) throw new ZhihuSyncServiceError('not-found', '草稿不存在。')
    return structuredClone(record)
  }
  function revision(record: SyncDraftRecord, expected: unknown) {
    if (record.revision !== expected) throw new ZhihuSyncServiceError('conflict', '草稿已更新，请重新载入后再操作。')
  }
  function editable(record: SyncDraftRecord) {
    if (record.publishState) throw new ZhihuSyncServiceError('publish-locked', '此草稿已提交发布。请先检查知乎发布结果；修改内容请保存为新草稿。')
  }
  return {
    async call(endpoint: string, payload: unknown, signal: AbortSignal, caller: 'ui' | 'tool' = 'ui'): Promise<unknown> {
      signal.throwIfAborted()
      const body = object(payload)
      if (endpoint === 'sync.list') {
        const drafts = [...table.entries()].map(([, value]) => ({
          id: value.id, revision: value.revision, updatedAt: value.updatedAt,
          title: value.draft.title, type: value.draft.type, publishState: value.publishState,
          published: value.published,
        })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        const offset = body.offset === undefined ? 0 : body.offset
        if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) throw new ZhihuSyncServiceError('bad-request', '草稿分页位置无效。')
        const page = drafts.slice(offset, offset + 100)
        return { drafts: page, total: drafts.length, ...(offset + page.length < drafts.length ? { nextOffset: offset + page.length } : {}) }
      }
      if (endpoint === 'sync.get') return get(body.id)
      if (endpoint === 'sync.media.upload') {
        return uploadZhihuSyncMedia(body as Parameters<typeof uploadZhihuSyncMedia>[0], options, signal)
      }
      if (endpoint === 'sync.publish' && caller !== 'ui') throw new ZhihuSyncServiceError('confirmation-required', 'Publishing requires a human-confirmed UI review; the agent tool can only save and validate drafts.')
      if (!['sync.save', 'sync.prepare', 'sync.publish'].includes(endpoint)) throw new ZhihuSyncServiceError('bad-request', '未知同步操作。')
      const id = endpoint === 'sync.save' && body.id === undefined ? randomUUID() : body.id
      if (typeof id !== 'string' || !id) throw new ZhihuSyncServiceError('bad-request', '缺少草稿 ID。')
      return locked(id, async () => {
        signal.throwIfAborted()
        if (endpoint === 'sync.save') {
          const old = table.get(id)
          if (body.id !== undefined) {
            if (!old) throw new ZhihuSyncServiceError('not-found', '草稿不存在。')
            revision(old, body.expectedRevision)
            editable(old)
          }
          // Saving invalid content is allowed; only the publish boundary requires
          // all checks to pass. No truncation or semantic rewriting occurs here.
          const parsed = draftSchema.safeParse(body.draft)
          if (!parsed.success) throw new ZhihuSyncServiceError('bad-request', '草稿字段格式无效或内容过大，请检查类型、正文、图片与发布设置。')
          const record: SyncDraftRecord = {
            id, revision: (old?.revision ?? 0) + 1, updatedAt: new Date().toISOString(),
            draft: parsed.data,
          }
          await table.put(id, record)
          reviews.delete(id)
          return structuredClone(record)
        }
        const record = get(id)
        revision(record, body.expectedRevision)
        editable(record)
        const prepared = prepareZhihuSyncDraft(record.draft)
        if (endpoint === 'sync.prepare') {
          if (caller === 'tool') return { record, prepared }
          // One bounded, short-lived ticket per draft. Preparing again replaces it.
          for (const [key, review] of reviews) if (review.expires < Date.now()) reviews.delete(key)
          const reviewToken = randomUUID()
          if (prepared.canPublish) reviews.set(id, { revision: record.revision, token: reviewToken, expires: Date.now() + 30 * 60_000 })
          return { record, prepared, reviewToken: prepared.canPublish ? reviewToken : '' }
        }
        const review = reviews.get(id)
        if (body.confirmed !== true || !review || review.token !== body.reviewToken
          || review.revision !== record.revision || review.expires < Date.now()) {
          throw new ZhihuSyncServiceError('confirmation-required', '请重新预览当前草稿并确认发布。')
        }
        if (!prepared.canPublish) throw new ZhihuSyncServiceError('validation-failed', '请先修正校验错误。')
        // Check configuration before recording a possibly sent request. Pin this
        // credential pair for this single operation, never across operations.
        const credentials = await options.resolveCredentials()
        signal.throwIfAborted()
        record.publishState = 'publishing'
        record.updatedAt = new Date().toISOString()
        await table.put(id, record)
        reviews.delete(id)
        // Persist intent before the network call: after process loss it must never
        // look like an unsent draft. There is no upstream idempotency contract.
        try {
          record.published = await publishZhihuSync(prepared, { ...options, resolveCredentials: async () => credentials }, signal)
          record.publishState = 'published'
        } catch (error) {
          if (error instanceof ZhihuSyncApiError && error.definite) {
            delete record.publishState
            record.lastError = error.message
          } else {
            record.publishState = 'uncertain'
            record.lastError = '未能确认发布结果，请检查知乎主页，避免重复发布。'
          }
        }
        record.updatedAt = new Date().toISOString()
        await table.put(id, record)
        return structuredClone(record)
      })
    },
  }
}
