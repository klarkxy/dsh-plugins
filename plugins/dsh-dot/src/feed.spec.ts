import { describe, expect, it } from 'vitest'
import type { RawEvent } from './chat.ts'
import { ChatFeed } from './feed.ts'
import type { DotHost } from './host.ts'

function feedWith(history: RawEvent[], stored: Record<string, RawEvent[]> = {}) {
  let running = false
  const reads: string[] = []
  const host = {
    dotEvents: () => history,
    isRunning: () => running,
    async readEvents(sessionId: string) {
      reads.push(sessionId)
      const events = stored[sessionId]
      if (!events) throw new Error('gone')
      return events
    },
  } as unknown as DotHost
  return { feed: new ChatFeed(host), reads, setRunning: (value: boolean) => { running = value } }
}

const user = (seq: number, text: string): RawEvent => ({ seq, type: 'user/message', time: seq, data: { content: [{ type: 'text', text }], source: { kind: 'user' } } })

describe('ChatFeed', () => {
  it('builds history once, then folds new events without repeating old ones', () => {
    const { feed } = feedWith([user(1, 'a')])
    feed.attach('dot')
    const first = feed.snapshot()!
    expect(first.items).toHaveLength(1)
    feed.onEvent('dot', user(1, 'a'))
    feed.onEvent('dot', user(2, 'b'))
    feed.onEvent('other', user(3, 'c'))
    const next = feed.snapshot()!
    expect(next.items!.map(item => (item as { text: string }).text)).toEqual(['a', 'b'])
    expect(next.itemsRev).toBeGreaterThan(first.itemsRev)
  })

  it('leaves items out when the client already has them', () => {
    const { feed } = feedWith([user(1, 'a')])
    feed.attach('dot')
    const first = feed.snapshot()!
    expect(feed.snapshot(first.itemsRev)!.items).toBeUndefined()
  })

  it('streams reply text and wakes waiting clients', async () => {
    const { feed } = feedWith([])
    feed.attach('dot')
    const { rev } = feed.snapshot()!
    const waiting = feed.wait(rev, new AbortController().signal, 5_000)
    feed.onStream('dot', { type: 'start' })
    await waiting
    feed.onStream('dot', { type: 'chunk', chunk: { type: 'text-delta', text: 'Hel' } })
    feed.onStream('dot', { type: 'chunk', chunk: { type: 'text-delta', text: 'lo' } })
    expect(feed.snapshot()!.streaming).toBe('Hello')
    feed.onEvent('dot', { seq: 5, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'Hello' }] } } })
    expect(feed.snapshot()!.streaming).toBe('')
    feed.dispose()
  })

  it('keeps earlier segments above the current one, each followed by a marker', async () => {
    const { feed } = feedWith([user(1, 'now')], { old: [user(1, 'before')] })
    feed.attach('dot', [
      { sessionId: 'gone', startedAt: 0, endedAt: 3, reason: 'lost' },
      { sessionId: 'old', startedAt: 3, endedAt: 5, reason: 'context-full' },
    ])
    const { itemsRev } = feed.snapshot()!
    await new Promise(resolve => setTimeout(resolve, 0))
    const next = feed.snapshot()!
    expect(next.itemsRev).toBeGreaterThan(itemsRev)
    // A segment whose log cannot be read still leaves its marker.
    expect(next.items!.map(item => item.kind)).toEqual(['segment', 'user', 'segment', 'user'])
    expect(next.items![2]).toMatchObject({ kind: 'segment', reason: 'context-full', at: 5 })
    expect(new Set(next.items!.map(item => item.key)).size).toBe(4)
  })

  it('keeps the rows it already folded when dot moves to a new segment', async () => {
    const { feed, reads } = feedWith([user(1, 'a')])
    feed.attach('first')
    feed.snapshot()
    feed.attach('second', [{ sessionId: 'first', startedAt: 0, endedAt: 9 }])
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(reads).toEqual([])
    const items = feed.snapshot()!.items!
    expect(items.map(item => item.kind)).toEqual(['user', 'segment', 'user'])
    expect(items[0]!.key).not.toBe(items[2]!.key)
  })

  it('a wait with a stale revision returns at once', async () => {
    const { feed } = feedWith([])
    feed.attach('dot')
    await expect(feed.wait(-1, new AbortController().signal, 60_000)).resolves.toBeUndefined()
  })
})
