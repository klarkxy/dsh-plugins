import { expect, it } from 'vitest'
import type { SessionFormatArtifact } from '@deepseek-ai/dsh-session-format'
import { restoreReleasedV5Artifact } from '../../packages/session/session-format-v4-to-v5/src/index.ts'

it('preserves inherited V5 delivery identity and rejects a foreign owned suffix delivery', () => {
  const known = new Set(['feedback/record', 'session-log-deepseek/delivery-accepted', 'session/end-seed'])
  const input: SessionFormatArtifact = {
    header: { version: 5, id: 'child', createdAt: 1, isSeeded: true, delegationDepth: 0, classification: 'ordinary', parentSession: 'parent' },
    inheritedEventCount: 2,
    events: [
      { type: 'feedback/record', seq: 0, time: 1, data: {} },
      { type: 'session-log-deepseek/delivery-accepted', seq: 1, time: 2, data: { sessionId: 'parent', sessionFormatVersion: 5, throughSeq: 0 } },
      { type: 'session/end-seed', seq: 2, time: 3, data: { inherited: true } },
    ],
  }
  const before = JSON.stringify(input)
  expect(restoreReleasedV5Artifact(input, known)).toBe(input)
  expect(JSON.stringify(input)).toBe(before)
  expect(() => restoreReleasedV5Artifact({
    ...input,
    events: [...input.events, { type: 'session-log-deepseek/delivery-accepted', seq: 3, time: 4, data: { sessionId: 'parent', sessionFormatVersion: 5, throughSeq: 2 } }],
  }, known)).toThrow('wrong Session')
})
