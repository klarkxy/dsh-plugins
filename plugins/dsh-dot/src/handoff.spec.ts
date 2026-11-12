import { describe, expect, it } from 'vitest'
import { buildHandoff, FALLBACK_TAIL_TOKENS, handoffText, TAIL_MAX_TOKENS, tailExchanges, type Handoff } from './handoff.ts'
import { estimateTokens, formatRows, type TranscriptRow } from './transcript.ts'

const row = (role: TranscriptRow['role'], text: string): TranscriptRow => ({ role, text, at: 0 })
/** n exchanges of about 2 x size tokens each. */
const long = (n: number, size = 1000): TranscriptRow[] =>
  Array.from({ length: n }, (_, index) => [row('human', `q${index} ` + 'x'.repeat(size * 4)), row('dot', `a${index} ` + 'y'.repeat(size * 4))]).flat()

describe('buildHandoff', () => {
  it('has nothing to carry out of an empty segment', async () => {
    expect(await buildHandoff({ rows: [] })).toBeUndefined()
  })

  it('carries a short conversation word for word without asking the model', async () => {
    let asked = 0
    const rows = [row('human', 'plan the release'), row('dot', 'started task s1')]
    const handoff = await buildHandoff({ rows, summarize: async () => { asked += 1; return 'note' } })
    expect(handoff).toEqual({ tier: 'verbatim', rows })
    expect(asked).toBe(0)
  })

  it('keeps what the ending segment itself was handed', async () => {
    const carried: Handoff = { tier: 'summary', summary: 'release is the goal', rows: [row('human', 'old')] }
    const handoff = await buildHandoff({ rows: [row('human', 'new')], carried })
    expect(handoff).toEqual({ tier: 'verbatim', summary: 'release is the goal', rows: [row('human', 'old'), row('human', 'new')] })
    expect(await buildHandoff({ rows: [], carried })).toEqual({ tier: 'verbatim', summary: 'release is the goal', rows: [row('human', 'old')] })
  })

  it('turns a long conversation into a note plus its last exchanges', async () => {
    const rows = long(20)
    const handoff = await buildHandoff({ rows, summarize: async () => '  the note  ' })
    expect(handoff!.tier).toBe('summary')
    expect(handoff!.summary).toBe('the note')
    expect(handoff!.rows).toEqual(rows.slice(-4))
    expect(estimateTokens(formatRows(handoff!.rows))).toBeLessThanOrEqual(TAIL_MAX_TOKENS)
  })

  it('falls back to the recent tail when the note cannot be written', async () => {
    const errors: unknown[] = []
    const rows = long(20)
    const failed = await buildHandoff({ rows, summarize: async () => { throw new Error('no model') }, onError: error => errors.push(error) })
    expect(failed!.tier).toBe('tail')
    expect(failed!.summary).toBeUndefined()
    expect(failed!.rows.at(-1)).toEqual(rows.at(-1))
    expect(estimateTokens(formatRows(failed!.rows))).toBeLessThanOrEqual(FALLBACK_TAIL_TOKENS)
    expect(failed!.rows.length).toBeGreaterThan(4)
    expect(errors).toHaveLength(1)

    const small = await buildHandoff({ rows, contextWindow: 20_000, carried: { tier: 'summary', summary: 'earlier note', rows: [] } })
    expect(small!.tier).toBe('tail')
    expect(small!.summary).toBe('earlier note')
    expect(estimateTokens(formatRows(small!.rows))).toBeLessThanOrEqual(6_000)
  })
})

describe('tailExchanges', () => {
  it('cuts a single oversized exchange instead of dropping it', () => {
    const rows = [row('human', 'x'.repeat(40_000)), row('dot', 'y'.repeat(40_000))]
    const kept = tailExchanges(rows, 3, 1_000)
    expect(kept).toHaveLength(1)
    expect(kept[0]!.role).toBe('dot')
    expect(estimateTokens(kept[0]!.text)).toBeLessThanOrEqual(1_001)
  })
})

describe('handoffText', () => {
  it('labels the note and the rows by how they were carried', () => {
    const rows = [row('human', 'hi'), row('dot', 'hello')]
    expect(handoffText({ tier: 'verbatim', rows })).toBe('The conversation before this session, word for word:\nHuman: hi\n\nYou: hello')
    const summary = handoffText({ tier: 'summary', summary: 'note', rows })
    expect(summary).toContain('Your own note on the conversation so far:\nnote')
    expect(summary).toContain('The last messages before this session')
    expect(handoffText({ tier: 'tail', summary: 'old note', rows })).toContain('older than the messages below')
  })
})
