/** One host catalog row. Classification comes from the summary, never from cwd. */
export interface ListedSession {
  readonly id: string
  readonly displayTitle: string
  readonly title?: string
  readonly classification?: 'ordinary' | 'free'
  readonly origin?: 'subagent'
  readonly running: boolean
  readonly updatedAt: number
  readonly parentId?: string
  readonly cwd?: string
}

export interface SessionListError {
  readonly code: string
  readonly message?: string
}

/** Host catalog. `error` is a real read failure and is not an empty ready list. */
export interface SessionListSnapshot {
  readonly ids: readonly string[]
  readonly byId: Readonly<Record<string, ListedSession | undefined>>
  readonly phase: 'pending' | 'ready' | 'error'
  readonly error?: SessionListError
}

/**
 * User-visible free chats. Host list membership is `ids` only.
 * Owned subagents stay out; an independent fork with classification free stays in.
 */
export function freeChatRows(snapshot: SessionListSnapshot): ListedSession[] {
  const rows: ListedSession[] = []
  for (const id of snapshot.ids) {
    const row = snapshot.byId[id]
    if (row === undefined || row.classification !== 'free' || row.origin === 'subagent') continue
    rows.push(row)
  }
  return rows
}

/** Match the visible title or id. Directory text is not a class and is not searched. */
export function matchFreeRows(rows: readonly ListedSession[], query: string): ListedSession[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...rows]
  return rows.filter(row => row.displayTitle.toLowerCase().includes(needle) || row.id.toLowerCase().includes(needle))
}

/** Quiet clock: time when it is today, month and day otherwise. */
export function formatQuietTime(updatedAt: number, locale: 'zh' | 'en', now = Date.now()): string {
  if (!Number.isFinite(updatedAt)) return ''
  const date = new Date(updatedAt)
  const today = new Date(now)
  const sameDay = date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate()
  const tag = locale === 'zh' ? 'zh-CN' : 'en'
  if (sameDay) return new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit' }).format(date)
  return new Intl.DateTimeFormat(tag, { month: 'short', day: 'numeric' }).format(date)
}
