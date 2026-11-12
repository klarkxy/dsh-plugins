import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES } from './contracts.ts'
import { routeInstruction, routeRequest } from './rules.ts'

describe('routeRequest', () => {
  it('lets dot judge approvals and questions by default', () => {
    expect(routeRequest(DEFAULT_RULES, 'approval')).toEqual({ action: 'dot', kind: 'approval' })
    expect(routeRequest(DEFAULT_RULES, 'question')).toEqual({ action: 'dot', kind: 'question' })
    expect(DEFAULT_RULES.scope).toBe('all')
  })

  it('leaves a kind to the host when it is off', () => {
    const rules = { ...DEFAULT_RULES, questions: 'off' as const }
    expect(routeRequest(rules, 'question')).toEqual({ action: 'skip' })
    expect(routeRequest(rules, 'approval')).toEqual({ action: 'dot', kind: 'approval' })
  })

  it('routes approvals across human, deny, and allow modes', () => {
    const human = { ...DEFAULT_RULES, approvals: 'human' as const }
    expect(routeRequest(human, 'approval')).toEqual({ action: 'human' })
    expect(routeRequest({ ...human, approvals: 'dot' }, 'approval')).toEqual({ action: 'dot', kind: 'approval' })
    expect(routeRequest({ ...DEFAULT_RULES, approvals: 'deny' }, 'approval')).toEqual({ action: 'deny' })
    expect(routeRequest({ ...DEFAULT_RULES, approvals: 'allow' }, 'approval')).toEqual({ action: 'allow' })
  })
})

describe('routeInstruction', () => {
  it('escalates risky approvals in the instruction dot reads', () => {
    const text = routeInstruction({ action: 'dot', kind: 'approval' })
    expect(text).toContain('publishes')
    expect(text).toContain('credentials')
  })

  it("appends the human's own rules for dot, quoted line by line", () => {
    const text = routeInstruction({ action: 'dot', kind: 'approval' }, 'push to my repos is fine\nask before deleting')
    expect(text).toContain('take precedence')
    expect(text).toContain('  > push to my repos is fine\n  > ask before deleting')
    expect(routeInstruction({ action: 'human' }, 'push is fine')).not.toContain('push is fine')
  })
})
