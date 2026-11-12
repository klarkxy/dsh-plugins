import { describe, expect, it } from 'vitest'
import { NoticeBatcher, formatNotices, type Notice, type Timer } from './batcher.ts'

function fakeTimer() {
  let now = 0
  const tasks = new Map<number, { at: number; fn: () => void }>()
  let next = 0
  const timer: Timer = {
    set: (fn, ms) => { const id = ++next; tasks.set(id, { at: now + ms, fn }); return id },
    clear: id => { tasks.delete(id as number) },
    now: () => now,
  }
  const advance = (ms: number) => {
    now += ms
    for (const [id, t] of [...tasks]) if (t.at <= now) { tasks.delete(id); t.fn() }
  }
  return { timer, advance }
}

const n = (id: string, at = 0): Notice => ({ sessionId: id, kind: 'turn-end', text: 'done', at })

describe('NoticeBatcher', () => {
  it('merges notices inside the quiet window', async () => {
    const { timer, advance } = fakeTimer()
    const batches: string[][] = []
    const b = new NoticeBatcher(async items => { batches.push(items.map(i => i.sessionId)) }, { quietMs: 100, maxWaitMs: 1000, timer })
    b.push(n('a')); advance(50); b.push(n('b')); advance(99)
    expect(batches).toEqual([])
    advance(1); await Promise.resolve()
    expect(batches).toEqual([['a', 'b']])
  })

  it('flushes a steady stream at maxWait', async () => {
    const { timer, advance } = fakeTimer()
    const batches: number[] = []
    const b = new NoticeBatcher(async items => { batches.push(items.length) }, { quietMs: 100, maxWaitMs: 250, timer })
    for (let i = 0; i < 5; i++) { b.push(n(String(i))); advance(60) }
    await Promise.resolve()
    expect(batches).toEqual([5])
  })

  it('requeues a failed delivery ahead of newer notices', async () => {
    const { timer } = fakeTimer()
    const seen: string[][] = []
    let fail = true
    const b = new NoticeBatcher(async items => { seen.push(items.map(i => i.sessionId)); if (fail) { fail = false; throw new Error('busy') } }, { quietMs: 10, maxWaitMs: 100, timer })
    b.push(n('a'))
    await b.drain()
    b.push(n('b'))
    await b.drain()
    expect(seen).toEqual([['a'], ['a', 'b']])
  })

  it('holds routine notices without a timer and carries them in order with the next wake', async () => {
    const { timer, advance } = fakeTimer()
    const batches: string[][] = []
    const b = new NoticeBatcher(async items => { batches.push(items.map(i => i.sessionId)) }, { quietMs: 100, maxWaitMs: 1000, timer })
    b.hold(n('held-first'))
    advance(10_000)
    expect(batches).toEqual([])
    expect(b.size).toBe(1)
    b.push(n('wake'))
    b.hold(n('held-later'))
    await b.drain()
    expect(batches).toEqual([['held-first', 'wake', 'held-later']])
  })

  it('flushes a full held queue as one batch', async () => {
    const { timer, advance } = fakeTimer()
    const batches: string[][] = []
    const b = new NoticeBatcher(async items => { batches.push(items.map(i => i.sessionId)) }, { quietMs: 100, maxWaitMs: 1000, holdLimit: 2, timer })
    b.hold(n('a'))
    advance(1000)
    expect(batches).toEqual([])
    b.hold(n('b'))
    advance(100)
    await Promise.resolve()
    expect(batches).toEqual([['a', 'b']])
  })

  it('requeues a failed mixed batch ahead of newer wake and held notices', async () => {
    const { timer } = fakeTimer()
    const seen: string[][] = []
    let fail = true
    const b = new NoticeBatcher(async items => { seen.push(items.map(i => i.sessionId)); if (fail) { fail = false; throw new Error('busy') } }, { quietMs: 10, maxWaitMs: 100, timer })
    b.hold(n('held'))
    b.push(n('wake'))
    await b.drain()
    b.push(n('new-wake'))
    b.hold(n('new-held'))
    await b.drain()
    expect(seen).toEqual([['held', 'wake'], ['held', 'wake', 'new-wake', 'new-held']])
  })

  it('takes held notices for a combined delivery and restores them after failure', async () => {
    const { timer, advance } = fakeTimer()
    const batches: string[][] = []
    const b = new NoticeBatcher(async items => { batches.push(items.map(i => i.sessionId)) }, { quietMs: 100, maxWaitMs: 1000, timer })
    b.hold(n('held'))
    const taken = b.take()
    expect(taken.map(item => item.sessionId)).toEqual(['held'])
    expect(b.size).toBe(0)
    advance(1000)
    expect(batches).toEqual([])
    b.restore(taken)
    b.push(n('wake'))
    await b.drain()
    expect(batches).toEqual([['held', 'wake']])
  })

  it('drops everything after dispose', async () => {
    const { timer } = fakeTimer()
    let calls = 0
    const b = new NoticeBatcher(async () => { calls++ }, { quietMs: 10, maxWaitMs: 100, timer })
    b.push(n('a')); b.dispose(); b.push(n('b'))
    await b.drain()
    expect(calls).toBe(0)
  })

  it('formats one line per notice', () => {
    expect(formatNotices([n('a'), { ...n('b'), kind: 'error', text: 'boom' }])).toContain('- error · b: boom')
  })

  it('cancels urgent timer when a settled request is dropped, and falls back to quiet window when routine items remain', async () => {
    const { timer, advance } = fakeTimer()
    const batches: string[][] = []
    const b = new NoticeBatcher(async items => { batches.push(items.map(i => i.sessionId)) }, { quietMs: 5000, urgentMs: 500, maxWaitMs: 20_000, timer })

    b.push({ ...n('s1'), kind: 'approval', requestId: 'ap-1' }, true)
    advance(200)
    b.dropWhere(item => item.requestId === 'ap-1')
    advance(10_000)
    await Promise.resolve()
    expect(batches).toEqual([])

    b.push(n('routine'))
    advance(1000)
    b.push({ ...n('s2'), kind: 'approval', requestId: 'ap-2' }, true)
    advance(200)
    b.dropWhere(item => item.requestId === 'ap-2')
    // Urgent request was dropped, so routine notice waits out the remaining quiet window instead of firing at 500ms.
    advance(500)
    await Promise.resolve()
    expect(batches).toEqual([])
    advance(4500)
    await Promise.resolve()
    expect(batches).toEqual([['routine']])
  })
})
