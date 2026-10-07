import { expect, vi } from 'vitest'
import { createClientTest, webApp } from '../../packages/test-support/client-runtime/src/assembly/index.ts'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { sessionBench } from '../../packages/api/session-controller/tests/remote/bench.client.ts'
import { FOLLOW, followScript, history } from '../../packages/api/session-controller/tests/remote/session.client.ts'
import { plainTurn } from '../../packages/api/session-controller/tests/event-script.client.ts'

const it = createClientTest({ roster: webApp.closure(['@deepseek-ai/dsh-api-gateway']) })
it('resubscribes a passive native client when another caller commits a branch', async ({ mock, start }) => {
  const id = SessionId('passive-branch-review')
  const session = await sessionBench(mock, start, id)
  mock.stream(FOLLOW, followScript(history(plainTurn(SessionSeq(0), 0, 'OLD_PROMPT', 'OLD_REPLY'))))
  await session.open()
  mock.stream(FOLLOW, followScript(history(plainTurn(SessionSeq(0), 0, 'NEW_PROMPT', 'NEW_REPLY'))))
  mock.streams.fail(FOLLOW, new RemoteError('session/branch-moved', 'active branch changed; resubscribe session history', { sessionId: id, branchRevision: 1 }))
  await vi.waitFor(() => { expect(mock.log.requests(FOLLOW)).toHaveLength(2) })
  expect(session.getSnapshot()).toMatchObject({ openState: 'open', openError: null })
})
