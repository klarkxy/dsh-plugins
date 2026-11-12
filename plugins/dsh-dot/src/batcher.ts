/**
 * Coalesces noteworthy task events into one wake-up for dot.
 *
 * Each wake-up costs dot a model turn, so events arriving within `quietMs`
 * of each other merge, and a steady stream still flushes after `maxWaitMs`.
 * Held events set no timer: they join the next wake-up, a human message or a
 * reminder, and a full held queue flushes once. The flush callback decides
 * delivery; a failed delivery puts its items back.
 */
export interface Notice {
  readonly sessionId: string
  readonly kind: 'turn-end' | 'error' | 'approval' | 'question' | 'archived'
  readonly text: string
  readonly at: number
  /** Pending request id (`ap-N` / `q-N`); dropped if settled before delivery. */
  readonly requestId?: string
}

export interface Timer {
  set(callback: () => void, ms: number): unknown
  clear(handle: unknown): void
  now(): number
}

export const realTimer: Timer = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
}

/** A full held queue wakes dot once instead of growing without a bound. */
export const HOLD_LIMIT = 20

interface QueuedNotice {
  readonly notice: Notice
  readonly urgent: boolean
}

export class NoticeBatcher {
  private items: QueuedNotice[] = []
  private held: Notice[] = []
  private handle: unknown
  private firstAt: number | undefined
  private disposed = false
  private urgent = false

  constructor(
    private readonly flush: (items: readonly Notice[]) => Promise<void>,
    private readonly options: { readonly quietMs: number; readonly maxWaitMs: number; readonly urgentMs?: number; readonly holdLimit?: number; readonly timer?: Timer },
  ) {}

  private get timer(): Timer { return this.options.timer ?? realTimer }
  private get holdLimit(): number { return Math.max(1, Math.trunc(this.options.holdLimit ?? HOLD_LIMIT)) }

  /** @param urgent - a session is blocked on this notice: flush after the short urgent window. */
  push(notice: Notice, urgent = false): void {
    if (this.disposed) return
    // Held notices arrived first, so they precede this wake-up in the batch.
    if (this.held.length > 0) {
      this.items.push(...this.held.splice(0).map(held => ({ notice: held, urgent: false })))
    }
    this.items.push({ notice, urgent })
    this.arm(urgent)
  }

  /** Keep a routine update until another delivery wakes dot; no timer is set. */
  hold(notice: Notice): void {
    if (this.disposed) return
    this.held.push(notice)
    if (this.held.length < this.holdLimit) return
    this.items.push(...this.held.splice(0).map(held => ({ notice: held, urgent: false })))
    this.arm(false)
  }

  /** Drop pending notices that no longer need delivery (such as requests settled in their own session). */
  dropWhere(predicate: (notice: Notice) => boolean): void {
    if (this.disposed) return
    const before = this.items.length
    this.items = this.items.filter(entry => !predicate(entry.notice))
    this.held = this.held.filter(notice => !predicate(notice))
    if (this.items.length === before) return
    if (this.items.length === 0) {
      if (this.handle !== undefined) { this.timer.clear(this.handle); this.handle = undefined }
      this.firstAt = undefined
      this.urgent = false
      return
    }
    const stillUrgent = this.items.some(entry => entry.urgent)
    if (this.urgent && !stillUrgent) {
      this.urgent = false
      this.arm(false)
    }
  }

  private arm(urgent: boolean): void {
    const now = this.timer.now()
    this.firstAt ??= now
    if (urgent) this.urgent = true
    if (this.handle !== undefined) this.timer.clear(this.handle)
    const quiet = this.urgent ? Math.min(this.options.quietMs, this.options.urgentMs ?? 1500) : this.options.quietMs
    const wait = Math.max(0, Math.min(quiet, this.firstAt + this.options.maxWaitMs - now))
    this.handle = this.timer.set(() => { void this.drain() }, wait)
  }

  get size(): number { return this.items.length + this.held.length }

  /** Take every pending notice for a delivery that carries them itself. */
  take(): Notice[] {
    if (this.handle !== undefined) { this.timer.clear(this.handle); this.handle = undefined }
    this.firstAt = undefined
    this.urgent = false
    if ((this.items.length === 0 && this.held.length === 0) || this.disposed) return []
    const batch = [...this.items.map(entry => entry.notice), ...this.held]
    this.items = []
    this.held = []
    return batch
  }

  /** Put a failed delivery back ahead of anything that arrived meanwhile. */
  restore(batch: readonly Notice[]): void {
    if (this.disposed || batch.length === 0) return
    this.items.unshift(...batch.map(notice => ({ notice, urgent: false })))
    this.arm(false)
  }

  async drain(): Promise<void> {
    const batch = this.take()
    if (batch.length === 0) return
    try {
      await this.flush(batch)
    } catch {
      // Failed items become wake-ups; later held items stay held until this
      // retry or another delivery drains them.
      this.restore(batch)
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.handle !== undefined) this.timer.clear(this.handle)
    this.handle = undefined
    this.items = []
    this.held = []
  }
}

/** The message dot receives for one batch. */
export function formatNotices(items: readonly Notice[]): string {
  const lines = ['[dot notice] Updates from other sessions:']
  for (const item of items) lines.push(`- ${item.kind} · ${item.sessionId}: ${item.text}`)
  lines.push('Report what matters to the human, handle waiting requests by your rules, and stay silent about routine progress, routine requests you settle yourself, or requests already answered in their own session.')
  return lines.join('\n')
}
