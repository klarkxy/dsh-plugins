import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES } from './contracts.ts'
import { routeRequest } from './rules.ts'

describe('routeRequest', () => {
  it('lets dot judge every approval and question by default', () => {
    expect(routeRequest(DEFAULT_RULES, 'approval')).toEqual({ action: 'dot', kind: 'approval' })
    expect(routeRequest(DEFAULT_RULES, 'question')).toEqual({ action: 'dot', kind: 'question' })
    expect(DEFAULT_RULES.scope).toBe('all')
  })

  it('leaves questions to the host when off', () => {
    const rules = { ...DEFAULT_RULES, questions: 'off' as const }
    expect(routeRequest(rules, 'question')).toEqual({ action: 'skip' })
    expect(routeRequest(rules, 'approval')).toEqual({ action: 'dot', kind: 'approval' })
  })

  it('enforces human and deny switches without an automatic allow mode', () => {
    expect(routeRequest({ ...DEFAULT_RULES, approvals: 'human' }, 'approval')).toEqual({ action: 'human' })
    expect(routeRequest({ ...DEFAULT_RULES, approvals: 'deny' }, 'approval')).toEqual({ action: 'deny' })
    expect(routeRequest({ ...DEFAULT_RULES, approvals: 'allow' } as unknown as typeof DEFAULT_RULES, 'approval')).toEqual({ action: 'human' })
  })
})
