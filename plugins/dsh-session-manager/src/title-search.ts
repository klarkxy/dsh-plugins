import type { SessionQueryEngine, SessionResultFilter } from '@deepseek-ai/dsh-session-query'
import { corpusStamp } from './cursor.ts'

/** Search the latest log-backed titles using the standard host corpus, without a second index. */
export async function findTitleMatches(
  host: Pick<SessionQueryEngine, 'filterSessions' | 'readTitleSnapshots'>,
  filters: readonly SessionResultFilter[], text: string, callerCwd: string | undefined, signal?: AbortSignal,
) {
  const records = await host.filterSessions(filters, signal)
  signal?.throwIfAborted()
  const titles = new Map<string, string>()
  // Bound each projection batch while allowing the host to own read concurrency.
  for (let offset = 0; offset < records.length; offset += 100) {
    const rows = await host.readTitleSnapshots(records.slice(offset, offset + 100).map(record => record.header.id), signal)
    signal?.throwIfAborted()
    for (const row of rows) {
      if (row.status === 'rejected') throw row.reason
      if (row.value.title !== undefined) titles.set(row.sessionId, row.value.title.title)
    }
  }
  const needle = text.toLowerCase()
  const items = records.flatMap(record => {
    const title = titles.get(record.header.id)
    if (title === undefined || !title.toLowerCase().includes(needle)) return []
    return [{
      sessionId: record.header.id, title, cwd: record.header.cwd ?? null,
      live: record.live, persisted: record.persisted,
      sameCwd: callerCwd !== undefined && record.header.cwd === callerCwd,
      matchedBy: 'title' as const, titleMatch: title.trim().toLowerCase() === needle ? 'exact' as const : 'partial' as const,
      snippet: title,
    }]
  })
  // Host order supplies deterministic newest-first ties; complete title matches outrank partial ones.
  items.sort((a, b) => Number(b.titleMatch === 'exact') - Number(a.titleMatch === 'exact') || Number(b.sameCwd) - Number(a.sameCwd))
  return { items, stamp: corpusStamp(JSON.stringify(items)) }
}
