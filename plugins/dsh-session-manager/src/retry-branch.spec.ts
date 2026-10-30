import { describe, expect, it } from 'vitest'
import { buildForkSeed, Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { editForkBoundary } from './retry-branch.ts'

function event(type: string, data: unknown, surfaceOp?: string): SessionEvent {
  return { type, data, time: 0, seq: 0, ...surfaceOp ? { surfaceOp } : {} } as SessionEvent
}
const message = (id: string, value: string) => ({ id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: value }] })
const user = (id: string, value: string) => event('user/message', message(id, value), 'append')
const splice = (target: string, inserted: unknown[], removedCount = 0) => event('agent/inbox/spliced', { target, start: 0, inserted, removedCount })
const sequence = (events: SessionEvent[]) => events.map((value, seq) => ({ ...value, seq })) as SessionEvent[]

function history(): SessionEvent[] {
  return sequence([
    event('permission/preset', { preset: 'workspace-write' }),
    event('turn/start', { turn: 1 }),
    user('first', 'retained'),
    event('step/start', { turn: 1, step: 1 }),
    event('assistant/message', { turn: 1, step: 1, stream: [], message: {
      id: 'answer', role: 'assistant', source: { kind: 'model', provider: 'test', model: 'test' }, content: [{ type: 'text', text: 'retained reply' }],
    } }, 'append'),
    event('step/end', { turn: 1, step: 1 }),
    event('turn/end', { turn: 1, reason: { kind: 'completed' } }),
    splice('next-turn', [message('selected', 'original')]),
    event('turn/start', { turn: 2 }),
    splice('next-turn', [], 1),
    event('step/start', { turn: 2, step: 1 }),
    user('selected', 'original'),
  ])
}

function replay(events: SessionEvent[], boundary: number) {
  const seed = buildForkSeed(events, boundary)
  const id = SessionId('branch-probe')
  const session = Session.create(id, seed, { version: 4, id, createdAt: 0, isSeeded: true, parentSession: SessionId('source') }, boundary + 1)
  return { seed, session }
}

/** Fold both durable inboxes, the same splice semantics used by the host driver. */
function pending(seed: readonly SessionEvent[]) {
  const queues: Record<string, unknown[]> = { 'next-turn': [], 'next-step': [] }
  for (const entry of seed) if (entry.type === 'agent/inbox/spliced') {
    const data = entry.data as { target: string; start: number; removedCount?: number; inserted: unknown[] }
    queues[data.target]!.splice(data.start, data.removedCount ?? 0, ...data.inserted)
  }
  return [...queues['next-turn']!, ...queues['next-step']!]
}

describe('edit fork boundary with real host seed construction', () => {
  it('removes the empty shell without resurrecting the queued original or changing retained messages', () => {
    const events = history()
    const old = replay(events, 10)
    expect(old.seed.some(e => e.type === 'turn/end' && e.data.reason.kind === 'forked')).toBe(true)
    const naive = replay(events, 7)
    expect(pending(naive.seed)).toHaveLength(1)
    const boundary = editForkBoundary(events, 11)!
    expect(boundary).toBe(6)
    const corrected = replay(events, boundary)
    expect(corrected.seed.filter(e => e.type === 'turn/start')).toHaveLength(1)
    expect(corrected.seed.some(e => e.type === 'turn/end' && e.data.reason.kind === 'forked')).toBe(false)
    expect(pending(corrected.seed)).toEqual([])
    expect(corrected.session.deriveMessages()).toEqual(old.session.deriveMessages())
  })

  it('does not accumulate empty turns across consecutive edits', () => {
    let events = history()
    for (let attempt = 0; attempt < 3; attempt++) {
      const boundary = editForkBoundary(events, events.at(-1)!.seq)!
      const { seed } = replay(events, boundary)
      expect(seed.filter(e => e.type === 'turn/start')).toHaveLength(1)
      expect(pending(seed)).toEqual([])
      events = sequence([...seed,
        splice('next-turn', [message('edited', `edited ${attempt}`)]),
        event('turn/start', { turn: 2 }), splice('next-turn', [], 1),
        event('step/start', { turn: 2, step: 1 }), user('edited', `edited ${attempt}`),
      ])
    }
  })

  it('cuts before the first queued prompt and keeps initial permissions', () => {
    const events = sequence([event('permission/preset', { preset: 'workspace-write' }), ...history().slice(7)])
    const boundary = editForkBoundary(events, events.at(-1)!.seq)!
    expect(boundary).toBe(0)
    const { seed } = replay(events, boundary)
    expect(seed[0]!.type).toBe('permission/preset')
    expect(seed.some(e => e.type === 'turn/start')).toBe(false)
    expect(pending(seed)).toEqual([])
  })

  it('retains earlier input and model work when editing a later input in the same turn', () => {
    const events = sequence([...history(), event('assistant/message', { turn: 2, step: 1, stream: [], message: {
      id: 'earlier-answer', role: 'assistant', source: { kind: 'model', provider: 'test', model: 'test' }, content: [{ type: 'text', text: 'earlier work' }],
    } }, 'append'), user('later', 'edit this')])
    const boundary = editForkBoundary(events, 13)!
    expect(boundary).toBe(12)
    const { seed, session } = replay(events, boundary)
    expect(session.deriveMessages().some(m => m.id === 'selected')).toBe(true)
    expect(session.deriveMessages().some(m => m.id === 'earlier-answer')).toBe(true)
    expect(session.deriveMessages().some(m => m.id === 'later')).toBe(false)
    expect(seed.filter(e => e.type === 'turn/start')).toHaveLength(2)
    expect(pending(seed)).toEqual([])
  })

  it('does not cross a pending next-step queue or an invalid splice', () => {
    const events = sequence([...history(), splice('next-step', [message('pending', 'keep queued')]), user('later', 'edit this')])
    expect(editForkBoundary(events, 13)).toBeUndefined()
    const malformed = sequence([event('permission/preset', {}), splice('next-turn', [], 1), user('bad', 'edit')])
    expect(editForkBoundary(malformed, 2)).toBeUndefined()
  })
})
