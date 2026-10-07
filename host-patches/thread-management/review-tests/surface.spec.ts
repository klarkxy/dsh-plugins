import { expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { imageOffloadProjection } from '../../packages/compaction/compaction-image-offload/src/projection.ts'

it('reconstructs pre-anchor image projections after retry discards a later offload', () => {
  const session = Session.create(SessionId('projection-review'), undefined, undefined, undefined, [imageOffloadProjection])
  session.append('user/message', createUserMessage({ content: [{ type: 'image', attachment: { attachmentId: `sha256:${'a'.repeat(64)}` as never, mediaType: 'image/png', bytes: 1, width: 1, height: 1 } }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  const target = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'answer using previous image' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  const before = session.deriveMessages()[0]
  session.append('image/offload', { targets: [{ seq: session.snapshotEvents()[0]!.seq, imageIndexes: [0] }] })
  session.append('session/active-branch', { revision: 1, anchorSeq: target.seq, prompt: target.data, messageId: target.data.id, requestId: 'review', expectedRevision: 0, inputRevision: 'review' })
  expect(session.deriveMessages()[0]).toEqual(before)
})
