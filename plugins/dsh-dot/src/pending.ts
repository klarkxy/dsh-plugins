/**
 * Holds approval and question requests from other sessions until dot or the
 * human settles them. The host listener races this against the original
 * session's own answerer, so whichever answers first wins and the loser's
 * late answer is dropped.
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

interface Entry {
  readonly view: PendingView
  readonly resolve: (answer: PendingAnswer | undefined) => void
}

export class PendingHub {
  private readonly entries = new Map<string, Entry>()
  private counter = 0
  private readonly listeners = new Set<() => void>()

  constructor(private readonly now: () => number = Date.now) {}

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
    const withdraw = () => this.settle(id, undefined)
    this.entries.set(id, { view, resolve: finish })
    if (input.signal?.aborted) withdraw()
    else input.signal?.addEventListener('abort', withdraw, { once: true })
    this.changed()
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
    entry.resolve(answer)
    this.changed()
    return true
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
