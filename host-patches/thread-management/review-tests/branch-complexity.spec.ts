import { expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { imageOffloadProjection } from '../../packages/compaction/compaction-image-offload/src/projection.ts'

it('does not recursively double prefix replay for successive active branch decisions', () => {
  let projections = 0
  const counted = { ...imageOffloadProjection, project(...args: Parameters<typeof imageOffloadProjection.project>) {
    projections++
    return imageOffloadProjection.project(...args)
  } }
  const session = Session.create(SessionId('branch-complexity-review'), undefined, undefined, undefined, [counted])
  const original = session.append('user/message', createUserMessage({ content: [{ type: 'image', attachment: { attachmentId: `sha256:${'a'.repeat(64)}` as never, mediaType: 'image/png', bytes: 1, width: 1, height: 1 } }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  session.append('image/offload', { targets: [{ seq: original.seq, imageIndexes: [0] }] })
  projections = 0
  for (let index = 0; index < 12; index++) {
    const target = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: `prompt ${index}` }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    session.append('session/active-branch', { revision: index + 1, anchorSeq: target.seq, prompt: target.data, messageId: target.data.id, requestId: `review-${index}`, expectedRevision: index, inputRevision: `review-${index}` })
  }
  expect(projections).toBeLessThan(512)
})
