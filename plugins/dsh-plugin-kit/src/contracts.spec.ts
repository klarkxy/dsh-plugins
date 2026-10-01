import { describe, expect, it } from 'vitest'
import { isSubagentSession } from './contracts.ts'

describe('isSubagentSession', () => {
  it('treats a plain top-level session as human-driven', () => {
    expect(isSubagentSession({ header: { cwd: '/work' } })).toBe(false)
    expect(isSubagentSession({ id: 's1' })).toBe(false)
  })

  it('treats missing, non-object, and absent sessions as top-level', () => {
    expect(isSubagentSession(undefined)).toBe(false)
    expect(isSubagentSession(null)).toBe(false)
    expect(isSubagentSession('session-id')).toBe(false)
    expect(isSubagentSession({ header: undefined })).toBe(false)
    expect(isSubagentSession({ header: 'subagent' })).toBe(false)
  })

  it('detects a delegated child by any of the three host session markers', () => {
    expect(isSubagentSession({ header: { parentSession: 'parent-1' } })).toBe(true)
    expect(isSubagentSession({ header: { origin: 'subagent' } })).toBe(true)
    expect(isSubagentSession({ header: { delegationDepth: 1 } })).toBe(true)
    expect(isSubagentSession({ header: { delegationDepth: 3 } })).toBe(true)
  })

  it('does not treat a zero delegation budget as a child', () => {
    expect(isSubagentSession({ header: { delegationDepth: 0 } })).toBe(false)
  })

  it('ignores unrelated origins and non-numeric depths', () => {
    expect(isSubagentSession({ header: { origin: 'user' } })).toBe(false)
    expect(isSubagentSession({ header: { delegationDepth: undefined } })).toBe(false)
  })
})
