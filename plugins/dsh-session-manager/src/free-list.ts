/** One host catalog row. Classification comes from the summary, never from cwd. */
export interface ListedSession {
  readonly id: string
  readonly retainedBy?: Readonly<Record<string, number>>
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
