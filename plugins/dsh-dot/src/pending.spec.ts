import { describe, expect, it } from 'vitest'
import { PendingHub } from './pending.ts'
import { routeInstruction, routeRequest } from './rules.ts'
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
})

describe('rules', () => {
  it('routes by the default table: dot judges questions and approvals', () => {
    expect(routeRequest(DEFAULT_RULES, 'question', 'x')).toEqual({ action: 'dot', kind: 'question' })
    expect(routeRequest(DEFAULT_RULES, 'approval', 'bash')).toEqual({ action: 'dot', kind: 'approval' })
  })

  it('keeps human-routed requests out of dot\'s own judgement', () => {
    expect(routeInstruction({ action: 'human' })).toContain('Never decide it yourself')
  })
})
