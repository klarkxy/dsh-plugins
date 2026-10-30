import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

const retryRecordSchema = z.object({
  requestId: z.string().uuid(),
  source: z.string().min(1),
  messageId: z.string().min(1),
  text: z.string().optional(),
  expectedRevision: z.number().int().nonnegative(),
  expectedInputRevision: z.string(),
  forkSeq: z.number().int().nonnegative(),
  title: z.string().optional(),
  forkStarted: z.boolean(),
  childId: z.string().min(1).optional(),
  renamed: z.boolean().optional(),
  prompted: z.boolean(),
  result: z.object({
    sessionId: z.string().min(1),
    sourceSessionId: z.string().min(1),
    archived: z.boolean(),
  }).strict().optional(),
}).strict().refine(row => (!row.childId || row.forkStarted)
  && (!row.prompted || Boolean(row.childId))
  && (!row.result || (row.prompted && row.result.sessionId === row.childId && row.result.sourceSessionId === row.source)))

export type RetryRecord = z.infer<typeof retryRecordSchema>

/** Separate from preferences: unreadable retry evidence must never become an empty ledger. */
export const retryDomain = defineDomain({
  name: 'dsh_session_manager_retries',
  version: 1,
  layout: 'per-record',
  tables: { requests: domainTable<string, RetryRecord>(retryRecordSchema) },
})

export interface RetryDomainHandle {
  table(name: 'requests'): {
    entries(): IterableIterator<[unknown, unknown]>
    put(key: string, value: RetryRecord): Promise<void>
  }
  close(): Promise<void>
}

export class RetryJournalError extends Error {
  constructor(readonly code: 'session-manager/busy' | 'session-manager/unavailable' | 'session/retry-pending' | 'session/retry-uncertain', message: string) {
    super(message)
  }
}

/** Owns one profile's request identities and drains active commits before releasing storage. */
export class RetryJournal {
  private readonly records = new Map<string, RetryRecord>()
  private readonly running = new Map<string, Promise<unknown>>()
  private readonly runningIds = new Set<string>()
  private closing?: Promise<void>
  private closed = false

  constructor(private readonly domain: RetryDomainHandle) {
    for (const [key, value] of domain.table('requests').entries()) {
      const row = retryRecordSchema.parse(value)
      if (key !== row.requestId) throw new Error('Retry record identity mismatch')
      this.records.set(row.requestId, row)
    }
  }

  get(requestId: string): RetryRecord | undefined { return this.records.get(requestId) }

  async put(row: RetryRecord): Promise<void> {
    const stored = retryRecordSchema.parse(row)
    await this.domain.table('requests').put(row.requestId, stored)
    // Keep the live object: if a later save fails after fork returned, this
    // owner still knows the child and must not create another on retry.
    this.records.set(row.requestId, row)
  }

  run<T>(source: string, requestId: string, action: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new RetryJournalError('session-manager/unavailable', 'retry storage is closing'))
    if (this.runningIds.has(requestId)) return Promise.reject(new RetryJournalError('session/retry-pending', 'this retry is still running'))
    if (this.running.has(source)) return Promise.reject(new RetryJournalError('session-manager/busy', 'another retry is running'))
    for (const row of this.records.values()) {
      if (row.source === source && row.requestId !== requestId && row.forkStarted && !row.result) {
        return Promise.reject(new RetryJournalError('session/retry-uncertain', 'an earlier resend must be resolved first'))
      }
    }
    const work = Promise.resolve().then(action).finally(() => {
      this.running.delete(source)
      this.runningIds.delete(requestId)
    })
    this.running.set(source, work)
    this.runningIds.add(requestId)
    return work
  }

  close(): Promise<void> {
    this.closed = true
    return this.closing ??= Promise.allSettled([...this.running.values()]).then(() => this.domain.close())
  }
}
