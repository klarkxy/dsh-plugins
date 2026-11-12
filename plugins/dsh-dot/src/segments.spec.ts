import { describe, expect, it } from 'vitest'
import { IDLE_MIN_TOKENS, IDLE_ROLLOVER_MS, openingText, reasonAfterTurn, reasonBeforeDelivery, type DeliveryCheck } from './segments.ts'

const base: DeliveryCheck = { replied: true, now: 10 * IDLE_ROLLOVER_MS, persona: 'p', frozenPersona: 'p', model: 'a/b@', frozenModel: 'a/b@' }

describe('reasonBeforeDelivery', () => {
  it('keeps a segment whose inputs did not move', () => {
    expect(reasonBeforeDelivery(base)).toBeUndefined()
    expect(reasonBeforeDelivery({ ...base, lastReplyAt: base.now - 60_000, usedTokens: 500_000 })).toBeUndefined()
  })

  it('ends it when the model or the persona changed', () => {
    expect(reasonBeforeDelivery({ ...base, model: 'a/c@' })).toBe('model-switch')
    expect(reasonBeforeDelivery({ ...base, persona: 'q' })).toBe('prompt-changed')
    expect(reasonBeforeDelivery({ ...base, model: 'a/c@', persona: 'q' })).toBe('model-switch')
  })

  it('never ends a segment dot has not replied in', () => {
    expect(reasonBeforeDelivery({ ...base, replied: false, model: 'a/c@', persona: 'q' })).toBeUndefined()
  })

  it('ends a long-idle segment only when it is large', () => {
    const idle = { ...base, lastReplyAt: base.now - IDLE_ROLLOVER_MS }
    expect(reasonBeforeDelivery({ ...idle, usedTokens: IDLE_MIN_TOKENS })).toBe('idle-expired')
    expect(reasonBeforeDelivery({ ...idle, usedTokens: IDLE_MIN_TOKENS - 1 })).toBeUndefined()
    expect(reasonBeforeDelivery(idle)).toBeUndefined()
  })
})

describe('reasonAfterTurn', () => {
  it('ends the segment at the rollover line', () => {
    expect(reasonAfterTurn({ usedTokens: 70, rolloverAt: 70 })).toBe('context-full')
    expect(reasonAfterTurn({ usedTokens: 69, rolloverAt: 70 })).toBeUndefined()
    expect(reasonAfterTurn({ usedTokens: 70 })).toBeUndefined()
    expect(reasonAfterTurn({})).toBeUndefined()
  })
})

describe('openingText', () => {
  it('explains the handoff and carries the note, the rows and the ledger', () => {
    const text = openingText({
      reason: 'context-full',
      handoff: { tier: 'summary', summary: 'release 1.2 is the goal', rows: [{ role: 'human', text: 'any news?', at: 0 }] },
      ledger: '[ledger]\n- s1 RUNNING "build"',
      at: Date.UTC(2026, 0, 2, 12),
    })
    expect(text.startsWith('[conversation handoff]')).toBe(true)
    expect(text).toContain('had grown long')
    expect(text).toContain('release 1.2 is the goal')
    expect(text).toContain('Human: any news?')
    expect(text).toContain('dot_overview shows the current state:\n[ledger]')
  })

  it('says so when nothing could be carried', () => {
    const text = openingText({ reason: 'lost', at: 0 })
    expect(text).toContain('could not be reopened')
    expect(text).toContain('Nothing was carried over')
    expect(text).not.toContain('Task ledger')
  })

  it('records an open card carried from the previous segment with history lookup guidance', () => {
    const text = openingText({
      reason: 'context-full',
      previous: 'dot-prev',
      openCard: 'Deploy target',
      at: 0,
    })
    expect(text).toContain('An interactive show_view card ("Deploy target") from the earlier segment is still open')
    expect(text).toContain('inspect dot-prev with dot_search_history and dot_read_history')
  })
})
