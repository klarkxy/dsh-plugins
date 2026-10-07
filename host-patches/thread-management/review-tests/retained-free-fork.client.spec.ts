import { createClientTest, webApp } from '../../packages/test-support/client-runtime/src/assembly/index.ts'
import { ok } from '@deepseek-ai/dsh-remote-mock'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { expect, vi } from 'vitest'
import { sessionWorld } from '../../packages/api/session-controller/tests/remote/session.client.ts'
import type {} from '../../packages/client/ui-workspace/src/client/navigation.ts'
import { sessionMemberIds } from '../../packages/client/ui-workspace/src/client/tree.ts'

const it = createClientTest({ roster: webApp.closure(['@deepseek-ai/dsh-client-ui-workspace']) })
const FREE = SessionId('review-retained-free')
const CHILD = SessionId('review-free-fork')

it('inherits retained free classification into a fork after catalog omission', async ({ mock, start }) => {
  mock.load(sessionWorld)
  mock.remote.session.create.mockResolvedValue(ok({ sessionId: FREE }))
  mock.remote.session.fork.mockResolvedValue(ok({ sessionId: CHILD }))
  const client = await start()
  await vi.waitFor(() => { expect(client.ctx.get('uiWorkspace')).toBeDefined() })
  await client.ctx.sessions.refresh()
  const id = await client.ctx.sessions.create({ kind: 'free', sessionId: FREE })
  using gateway = client.ctx.sessions.retain(id, { source: 'gateway' })
  await gateway.ready
  await client.ctx.sessions.refresh()
  await client.flush()
  expect(client.ctx.sessions.list.getSnapshot().ids).not.toContain(id)
  expect(client.ctx.sessions.list.getSnapshot().byId[id]?.classification).toBe('free')
  client.ctx.uiWorkspace.openSession(id)
  await client.flush()
  const child = await client.ctx.uiWorkspace.forkSession(id)
  expect(child).toBe(CHILD)
  const snapshot = client.ctx.sessions.list.getSnapshot()
  expect(snapshot.byId[child]?.classification).toBe('free')
  expect(sessionMemberIds(snapshot)).not.toContain(child)
})
