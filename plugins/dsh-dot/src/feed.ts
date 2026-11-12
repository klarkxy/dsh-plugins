/**
 * Live view of dot's chat for the plugin's own chat panel. The host folds the
 * events of dot's current session segment into rows as they commit, tracks the
 * reply being streamed, and wakes long-polling clients on every change. The
 * rows of earlier segments stay above them, each followed by a marker, so the
 * human keeps one continuous chat.
 */
import { ChatFold, type RawEvent } from './chat.ts'
import type { ChatItem, ChatSnapshot } from './contracts.ts'
import type { DotHost } from './host.ts'
import type { PastSegment } from './segments.ts'

/** Events read back when the panel first opens. */
const HISTORY_EVENTS = 3000
/** Stream text reaches waiting clients at most this often. */
const STREAM_PUSH_MS = 80
/** Earlier segments shown above the current one. */
export const HISTORY_SEGMENTS = 6

type Answers = NonNullable<ChatSnapshot['answers']>
interface Folded { readonly items: readonly ChatItem[]; readonly answers: Answers }

/** Rows of one segment with keys that stay unique next to other segments. A card's key is its call id and stays as it is. */
function scoped(sessionId: string, items: readonly ChatItem[]): ChatItem[] {
  return items.map(item => item.kind === 'view' ? item : { ...item, key: `${sessionId}/${item.key}` })
}

export class ChatFeed {
  private sessionId: string | undefined
  private fold: ChatFold | undefined
  private lastSeq = -1
  private rev = 1
  private itemsRev = 1
  private streaming = ''
  private streamTimer: ReturnType<typeof setTimeout> | undefined
  private readonly waiters = new Set<() => void>()
  /** Earlier segments shown above the current one, oldest first. */
  private past: readonly PastSegment[] = []
  /** Folded rows of ended segments by session id. */
  private readonly ended = new Map<string, Folded>()
  private historyItems: readonly ChatItem[] = []
  private historyAnswers: Answers = {}

  constructor(private readonly host: DotHost) {}

  /**
   * Point the feed at dot's current session. A new session starts a fresh
   * list below the rows of the segments in `past`.
   */
  attach(sessionId: string, past: readonly PastSegment[] = []): void {
    if (sessionId === this.sessionId) return
    // The segment that just ended is already folded; keep it instead of reading its log again.
    if (this.sessionId !== undefined && this.fold !== undefined) this.ended.set(this.sessionId, { items: [...this.fold.items], answers: { ...this.fold.answers } })
    this.sessionId = sessionId
    this.fold = undefined
    this.lastSeq = -1
    this.streaming = ''
    this.past = past.slice(-HISTORY_SEGMENTS)
    this.rebuildHistory()
    this.bump(true)
    void this.loadHistory(sessionId)
  }

  isDot(sessionId: string | undefined): boolean { return sessionId !== undefined && sessionId === this.sessionId }

  onEvent(sessionId: string, event: RawEvent): void {
    if (!this.isDot(sessionId)) return
    if (this.fold === undefined) { this.bump(true); return }
    if (typeof event.seq === 'number') {
      if (event.seq <= this.lastSeq) return
      this.lastSeq = event.seq
    }
    if (event.type === 'assistant/message') this.streaming = ''
    if (this.fold.add(event)) this.bump(true)
  }

  onStatus(sessionId: string): void {
    if (this.isDot(sessionId)) this.bump(false)
  }

  onStream(sessionId: string, frame: { type?: string; chunk?: { type?: string; text?: string } }): void {
    if (!this.isDot(sessionId)) return
    if (frame.type === 'start' || frame.type === 'end') {
      this.streaming = ''
      this.bump(false)
      return
    }
    if (frame.type === 'chunk' && frame.chunk?.type === 'text-delta' && typeof frame.chunk.text === 'string') {
      this.streaming += frame.chunk.text
      this.streamTimer ??= setTimeout(() => { this.streamTimer = undefined; this.bump(false) }, STREAM_PUSH_MS)
    }
  }

  /** @param knownItemsRev - the client's item revision; items are left out when it is current. */
  snapshot(knownItemsRev = 0): ChatSnapshot | undefined {
    const sessionId = this.sessionId
    if (sessionId === undefined) return undefined
    if (this.fold === undefined) {
      const fold = new ChatFold()
      for (const event of this.host.dotEvents(sessionId, HISTORY_EVENTS)) {
        fold.add(event)
        if (typeof event.seq === 'number') this.lastSeq = Math.max(this.lastSeq, event.seq)
      }
      this.fold = fold
    }
    const base = { sessionId, running: this.host.isRunning(sessionId), streaming: this.streaming, rev: this.rev, itemsRev: this.itemsRev }
    if (knownItemsRev === this.itemsRev) return base
    return { ...base, items: [...this.historyItems, ...scoped(sessionId, this.fold.items)], answers: { ...this.historyAnswers, ...this.fold.answers } }
  }

  /** Resolve once the revision moves past `rev`, the signal aborts, or `ms` passes. */
  wait(rev: number, signal: AbortSignal, ms: number): Promise<void> {
    if (rev !== this.rev || signal.aborted) return Promise.resolve()
    return new Promise(resolve => {
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); this.waiters.delete(done); resolve() }
      const timer = setTimeout(done, ms)
      signal.addEventListener('abort', done, { once: true })
      this.waiters.add(done)
    })
  }

  dispose(): void {
    if (this.streamTimer !== undefined) clearTimeout(this.streamTimer)
    for (const wake of [...this.waiters]) wake()
  }

  /** Read the stored logs of the earlier segments that are not folded yet. A log that cannot be read is left out. */
  private async loadHistory(sessionId: string): Promise<void> {
    let loaded = false
    for (const segment of this.past) {
      if (this.ended.has(segment.sessionId)) continue
      try {
        const fold = new ChatFold()
        for (const event of await this.host.readEvents(segment.sessionId)) fold.add(event)
        this.ended.set(segment.sessionId, { items: [...fold.items], answers: { ...fold.answers } })
        loaded = true
      } catch { /* the marker still shows where that segment ended */ }
      if (this.sessionId !== sessionId) return
    }
    if (!loaded) return
    this.rebuildHistory()
    this.bump(true)
  }

  private rebuildHistory(): void {
    const items: ChatItem[] = []
    const answers: Record<string, Answers[string]> = {}
    for (const segment of this.past) {
      const folded = this.ended.get(segment.sessionId)
      if (folded) {
        items.push(...scoped(segment.sessionId, folded.items))
        Object.assign(answers, folded.answers)
      }
      items.push({ kind: 'segment', key: `segment:${segment.sessionId}`, ...segment.reason ? { reason: segment.reason } : {}, at: segment.endedAt })
    }
    this.historyItems = items
    this.historyAnswers = answers
    const shown = new Set(this.past.map(segment => segment.sessionId))
    for (const id of [...this.ended.keys()]) if (!shown.has(id)) this.ended.delete(id)
  }

  private bump(items: boolean): void {
    this.rev += 1
    if (items) this.itemsRev += 1
    for (const wake of [...this.waiters]) wake()
  }
}
