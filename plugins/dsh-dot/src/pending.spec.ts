import { describe, expect, it } from 'vitest'
import { PendingHub, SETTLEMENT_LIMIT } from './pending.ts'
import { routeRequest } from './rules.ts'
import { DEFAULT_RULES } from './contracts.ts'

describe('PendingHub', () => {
  it('settles an approval once and lists nothing afterwards', async () => {
    const hub = new PendingHub(() => 1)
    const { id, settled } = hub.open({ kind: 'approval', sessionId: 's', subject: 'bash' })
    expect(hub.list()).toHaveLength(1)
    expect(hub.answer(id, { kind: 'question', answers: [] })).toBe(false)
    expect(hub.answer(id, { kind: 'approval', allow: true })).toBe(true)
    expect(hub.answer(id, { kind: 'approval', allow: false })).toBe(false)
    await expect(settled).resolves.toEqual({ kind: 'approval', allow: true })
    expect(hub.list()).toEqual([])
  })

  it('requires every question exactly once', () => {
    const hub = new PendingHub()
    const { id } = hub.open({ kind: 'question', sessionId: 's', subject: 'A?', questions: [{ id: 'a', question: 'A?' }, { id: 'b', question: 'B?' }] })
    expect(hub.answer(id, { kind: 'question', answers: [{ id: 'a', selected: ['x'] }] })).toBe(false)
    expect(hub.answer(id, { kind: 'question', answers: [{ id: 'a', selected: [] }, { id: 'a', selected: [] }] })).toBe(false)
    expect(hub.answer(id, { kind: 'question', answers: [{ id: 'b', selected: [] }, { id: 'a', selected: ['x'] }] })).toBe(true)
  })

  it('withdraws on abort and on dispose, notifying listeners', async () => {
    const hub = new PendingHub()
    let changes = 0
    hub.onChange(() => { changes++ })
    const ac = new AbortController()
    const one = hub.open({ kind: 'approval', sessionId: 's', subject: 'x', signal: ac.signal })
    const two = hub.open({ kind: 'approval', sessionId: 's', subject: 'y' })
    ac.abort()
    await expect(one.settled).resolves.toBeUndefined()
    hub.dispose()
    await expect(two.settled).resolves.toBeUndefined()
    expect(changes).toBe(4)
  })

  it('withdraws immediately when the signal is already aborted', async () => {
    const hub = new PendingHub()
    const { settled } = hub.open({ kind: 'approval', sessionId: 's', subject: 'x', signal: AbortSignal.abort() })
    await expect(settled).resolves.toBeUndefined()
    expect(hub.list()).toEqual([])
  })

  it('records an answered request and tells a late caller how it ended', async () => {
    const hub = new PendingHub()
    const { id, settled } = hub.open({ kind: 'approval', sessionId: 's1', subject: 'bash' })
    expect(hub.settlement(id)).toBeUndefined()
    hub.answer(id, { kind: 'approval', allow: true })
    await settled
    expect(hub.settlement(id)).toEqual({ sessionId: 's1', kind: 'approval', reason: 'answered' })
  })

  it('records withdraw, abort, and dispose as withdrawn', async () => {
    const hub = new PendingHub()
    const withdrawn = hub.open({ kind: 'question', sessionId: 's1', subject: 'A?', questions: [{ id: 'a', question: 'A?' }] })
    withdrawn.withdraw()
    expect(hub.settlement(withdrawn.id)).toEqual({ sessionId: 's1', kind: 'question', reason: 'withdrawn' })

    const ac = new AbortController()
    const aborted = hub.open({ kind: 'approval', sessionId: 's2', subject: 'x', signal: ac.signal })
    ac.abort()
    await expect(aborted.settled).resolves.toBeUndefined()
    expect(hub.settlement(aborted.id)).toEqual({ sessionId: 's2', kind: 'approval', reason: 'withdrawn' })

    const disposed = hub.open({ kind: 'approval', sessionId: 's3', subject: 'y' })
    hub.dispose()
    await expect(disposed.settled).resolves.toBeUndefined()
    expect(hub.settlement(disposed.id)).toEqual({ sessionId: 's3', kind: 'approval', reason: 'withdrawn' })
  })

  it('keeps the answered reason when an abort arrives after settlement', async () => {
    const hub = new PendingHub()
    const ac = new AbortController()
    const { id, settled } = hub.open({ kind: 'approval', sessionId: 's', subject: 'x', signal: ac.signal })
    expect(hub.answer(id, { kind: 'approval', allow: true })).toBe(true)
    ac.abort()
    await settled
    expect(hub.settlement(id)).toEqual({ sessionId: 's', kind: 'approval', reason: 'answered' })
  })

  it('still tells an unknown id apart from a known one that is only open', () => {
    const hub = new PendingHub()
    const { id } = hub.open({ kind: 'approval', sessionId: 's', subject: 'x' })
    expect(hub.get(id)).toBeDefined()
    expect(hub.settlement(id)).toBeUndefined()
    expect(hub.get('ap-999')).toBeUndefined()
    expect(hub.settlement('ap-999')).toBeUndefined()
  })

  it('keeps only the most recent settlements, bounded', async () => {
    const hub = new PendingHub(() => 0, 2)
    const first = hub.open({ kind: 'approval', sessionId: 's1', subject: 'a' })
    hub.answer(first.id, { kind: 'approval', allow: true })
    const second = hub.open({ kind: 'approval', sessionId: 's2', subject: 'b' })
    hub.answer(second.id, { kind: 'approval', allow: false })
    const third = hub.open({ kind: 'approval', sessionId: 's3', subject: 'c' })
    third.withdraw()
    expect(SETTLEMENT_LIMIT).toBe(500)
    expect(hub.settlement(first.id)).toBeUndefined()
    expect(hub.settlement(second.id)).toEqual({ sessionId: 's2', kind: 'approval', reason: 'answered' })
    expect(hub.settlement(third.id)).toEqual({ sessionId: 's3', kind: 'approval', reason: 'withdrawn' })
    await expect(first.settled).resolves.toEqual({ kind: 'approval', allow: true })
    await expect(second.settled).resolves.toEqual({ kind: 'approval', allow: false })
    await expect(third.settled).resolves.toBeUndefined()
  })
})

describe('rules', () => {
  it('routes by the default table: dot judges questions and approvals', () => {
    expect(routeRequest(DEFAULT_RULES, 'question')).toEqual({ action: 'dot', kind: 'question' })
    expect(routeRequest(DEFAULT_RULES, 'approval')).toEqual({ action: 'dot', kind: 'approval' })
  })
})
