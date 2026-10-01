import { describe, expect, it } from 'vitest'
import { toolRequestSchema } from './schema.ts'
import { draft } from './testing.ts'

describe('requirements tool input', () => {
  it('defaults omitted lists without inventing requirements or questions', () => {
    expect(draft().requirements.questions).toEqual([])
    expect(draft().requirements.acceptance).toEqual([])
  })
  it('rejects session/model overrides, fabricated readiness and invalid bounds', () => {
    for (const value of [
      { action: 'read', sessionId: 'other' },
      { ...draft(), model: 'another' },
      { ...draft(), expectedRevision: -1 },
      { ...draft(), requirements: { ...draft().requirements, readiness: 'user-confirmed' } },
      { ...draft(), requirements: { goal: '' } },
      { ...draft(), requirements: { goal: 'x'.repeat(2001) } },
      { ...draft(), requirements: { goal: 'ok', constraints: Array(17).fill('x') } },
      { ...draft(), requirements: { goal: 'ok', questions: Array(9).fill('x') } },
    ]) expect(toolRequestSchema.safeParse(value).success).toBe(false)
  })
})
