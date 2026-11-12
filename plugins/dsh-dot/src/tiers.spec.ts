import { describe, expect, it } from 'vitest'
import { eventTier } from './tiers.ts'

describe('eventTier', () => {
  it('wakes for requests, errors and turns of tasks dot started', () => {
    expect(eventTier('approval')).toBe('wake')
    expect(eventTier('question', 'watched')).toBe('wake')
    expect(eventTier('error', 'watched')).toBe('wake')
    expect(eventTier('turn-end', 'started')).toBe('wake')
  })

  it('holds turns of watched sessions and keeps lifecycle events on the ledger', () => {
    expect(eventTier('turn-end', 'watched')).toBe('hold')
    expect(eventTier('status', 'started')).toBe('ledger')
    expect(eventTier('status', 'watched')).toBe('ledger')
    expect(eventTier('archived', 'started')).toBe('ledger')
  })
})
