/**
 * Holds approval and question requests from other sessions until dot or the
 * human settles them. The host listener races this against the original
 * session's own answerer, so whichever answers first wins and the loser's
 * late answer is dropped.
 *
 * A bounded record of recent settlements lets a late `dot_answer` tell
 * "already settled" apart from "never known", and say why it settled.
 */
import type { PendingKind, PendingQuestionItem, PendingView } from './contracts.ts'

export type PendingAnswer =
  | { readonly kind: 'approval'; readonly allow: boolean }
  | { readonly kind: 'question'; readonly answers: readonly { readonly id: string; readonly selected: readonly string[]; readonly custom?: string }[] }

export interface PendingInput {
  readonly kind: PendingKind
  readonly sessionId: string
  readonly subject: string
  readonly detail?: string
  readonly questions?: readonly PendingQuestionItem[]
  readonly signal?: AbortSignal
}

/** How a recent request ended. */
export interface Settlement {
  readonly sessionId: string
  readonly kind: PendingKind
  readonly reason: 'answered' | 'withdrawn'
}

/** Recent settlements kept for late callers; older ones fall out in insertion order. */
export const SETTLEMENT_LIMIT = 500

interface Entry {
  readonly view: PendingView
  readonly resolve: (answer: PendingAnswer | undefined) => void
  /** Detaches the abort listener once the request ends, whichever way it ends. */
  cleanup?: () => void
}

export class PendingHub {
  private readonly entries = new Map<string, Entry>()
  private readonly settled = new Map<string, Settlement>()
  private counter = 0
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly now: () => number = Date.now,
    private readonly settlementLimit: number = SETTLEMENT_LIMIT,
  ) {}

  /** Open a request. The promise resolves with dot's answer, or undefined when withdrawn. */
  open(input: PendingInput): { readonly id: string; readonly settled: Promise<PendingAnswer | undefined>; readonly withdraw: () => void } {
    const id = `${input.kind === 'approval' ? 'ap' : 'q'}-${++this.counter}`
    let finish!: (answer: PendingAnswer | undefined) => void
    const settled = new Promise<PendingAnswer | undefined>(resolve => { finish = resolve })
    const view: PendingView = {
      id,
      kind: input.kind,
      sessionId: input.sessionId,
      createdAt: this.now(),
      subject: input.subject,
      ...input.detail === undefined ? {} : { detail: input.detail },
      ...input.questions === undefined ? {} : { questions: input.questions },
    }
    const withdraw = () => { this.settle(id, undefined) }
    const entry: Entry = { view, resolve: finish }
    this.entries.set(id, entry)
    if (input.signal?.aborted) {
      withdraw()
    } else if (input.signal) {
      const signal = input.signal
      const onAbort = () => { withdraw() }
      signal.addEventListener('abort', onAbort, { once: true })
      entry.cleanup = () => { signal.removeEventListener('abort', onAbort) }
    }
    // An already-aborted signal settled above and already notified listeners.
    if (this.entries.has(id)) this.changed()
    return { id, settled, withdraw }
  }

  /** Settle one request; false when it is unknown or of another kind. */
  answer(id: string, answer: PendingAnswer): boolean {
    const entry = this.entries.get(id)
    if (entry === undefined || entry.view.kind !== answer.kind) return false
    if (answer.kind === 'question' && !coversQuestions(entry.view, answer)) return false
    return this.settle(id, answer)
  }

  get(id: string): PendingView | undefined { return this.entries.get(id)?.view }

  /** Why a recent request ended; undefined for an open or never-known id. */
  settlement(id: string): Settlement | undefined { return this.settled.get(id) }

  list(): PendingView[] { return [...this.entries.values()].map(entry => entry.view) }

  forSession(sessionId: string): PendingView[] { return this.list().filter(view => view.sessionId === sessionId) }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  dispose(): void {
    for (const id of [...this.entries.keys()]) this.settle(id, undefined)
    this.listeners.clear()
  }

  private settle(id: string, answer: PendingAnswer | undefined): boolean {
    const entry = this.entries.get(id)
    if (entry === undefined) return false
    this.entries.delete(id)
    entry.cleanup?.()
    entry.resolve(answer)
    this.remember(entry.view, answer === undefined ? 'withdrawn' : 'answered')
    this.changed()
    return true
  }

  private remember(view: PendingView, reason: Settlement['reason']): void {
    this.settled.set(view.id, { sessionId: view.sessionId, kind: view.kind, reason })
    while (this.settled.size > this.settlementLimit) {
      const oldest = this.settled.keys().next().value
      if (oldest === undefined) break
      this.settled.delete(oldest)
    }
  }

  private changed(): void {
    for (const listener of this.listeners) {
      try { listener() } catch { /* a broken listener must not block settlement */ }
    }
  }
}

/** A question answer must name each question of the request exactly once. */
export function coversQuestions(view: PendingView, answer: Extract<PendingAnswer, { kind: 'question' }>): boolean {
  const ids = (view.questions ?? []).map(item => item.id)
  const given = answer.answers.map(item => item.id)
  return ids.length === given.length && new Set(given).size === given.length && ids.every(id => given.includes(id))
}
