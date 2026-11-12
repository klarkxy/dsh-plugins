/**
 * Coalesces noteworthy task events into one wake-up for dot.
 *
 * Each wake-up costs dot a model turn, so events arriving within `quietMs`
 * of each other merge, and a steady stream still flushes after `maxWaitMs`.
 * Held events set no timer: they join the next wake-up, a human message or a
 * reminder, and a full held queue flushes once. The flush callback decides
 * delivery; a failed delivery puts its items back.
 *
 * A notice may also ask for its own delay (an approval's grace period, so the
 * original session's answerer can settle it first). Such a notice waits on a
 * separate fixed deadline: ordinary wake-ups do not flush it early, `take()`
 * (a human message or reminder) and a manual `drain()` leave it queued, and a
 * later request never pushes the deadline back. Its service supplies the
 * delay, e.g. the approval grace default.
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

interface DeferredNotice {
  readonly notice: Notice
  /** Fixed at push time; later pushes never move it. */
  readonly dueAt: number
}

export class NoticeBatcher {
  private items: QueuedNotice[] = []
  private held: Notice[] = []
  private deferred: DeferredNotice[] = []
  private handle: unknown
  private deferredHandle: unknown
  private firstAt: number | undefined
  private disposed = false
  private urgent = false

  constructor(
    private readonly flush: (items: readonly Notice[]) => Promise<void>,
    private readonly options: { readonly quietMs: number; readonly maxWaitMs: number; readonly urgentMs?: number; readonly holdLimit?: number; readonly timer?: Timer },
  ) {}

  private get timer(): Timer { return this.options.timer ?? realTimer }
  private get holdLimit(): number { return Math.max(1, Math.trunc(this.options.holdLimit ?? HOLD_LIMIT)) }

  /**
   * @param urgent - a session is blocked on this notice: flush after the short urgent window.
   * @param delayMs - hold this notice for its own independent grace period (0 keeps the normal batching flow).
   */
  push(notice: Notice, urgent = false, delayMs = 0): void {
    if (this.disposed) return
    const delay = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0
    if (delay > 0) {
      this.deferred.push({ notice, dueAt: this.timer.now() + delay })
      this.armDeferred()
      return
    }
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
    const kept = this.deferred.filter(entry => !predicate(entry.notice))
    const deferredChanged = kept.length !== this.deferred.length
    this.deferred = kept
    if (deferredChanged) this.armDeferred()
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

  /** Re-arm the single timer that guards every deferred deadline, always at the earliest one. */
  private armDeferred(): void {
    if (this.deferredHandle !== undefined) {
      this.timer.clear(this.deferredHandle)
      this.deferredHandle = undefined
    }
    if (this.disposed || this.deferred.length === 0) return
    let earliest = Number.POSITIVE_INFINITY
    for (const entry of this.deferred) earliest = Math.min(earliest, entry.dueAt)
    this.deferredHandle = this.timer.set(() => { void this.drainDeferred() }, Math.max(0, earliest - this.timer.now()))
  }

  /** Deliver the deferred notices whose own deadline has passed, merged with anything already waiting. */
  private async drainDeferred(): Promise<void> {
    this.deferredHandle = undefined
    if (this.disposed) return
    const now = this.timer.now()
    const due: Notice[] = []
    const remaining: DeferredNotice[] = []
    for (const entry of this.deferred) {
      if (entry.dueAt <= now) due.push(entry.notice)
      else remaining.push(entry)
    }
    this.deferred = remaining
    this.armDeferred()
    if (due.length === 0) return
    // One wake-up: the expired notices join whatever ordinary items and held
    // notices are already waiting. Unexpired deferred notices keep waiting in
    // `remaining`, untouched by take().
    const batch = [...this.take(), ...due]
    try {
      await this.flush(batch)
    } catch {
      // A failed delivery becomes normal pending items again, so it is retried
      // instead of silently dropping the request after its grace expired.
      this.restore(batch)
    }
  }

  get size(): number { return this.items.length + this.held.length + this.deferred.length }

  /** Take every pending notice for a delivery that carries them itself. Deferred notices keep waiting. */
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
    if (this.deferredHandle !== undefined) this.timer.clear(this.deferredHandle)
    this.handle = undefined
    this.deferredHandle = undefined
    this.items = []
    this.held = []
    this.deferred = []
  }
}

/** The message dot receives for one batch: only the facts; rules live in the system prompt. */
export function formatNotices(items: readonly Notice[]): string {
  const lines = ['[dot notice] Updates from other sessions:']
  for (const item of items) lines.push(`- ${item.kind} · ${item.sessionId}: ${item.text}`)
  return lines.join('\n')
}
