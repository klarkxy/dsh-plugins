import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse, toolCallResponse } from '../../packages/core/agent-loop/tests/mock-adapter.ts'
import { boot } from '../../.acceptance/recovery-boot.ts'

it('blocks retry when a persisted nonresident child wrote after the selected prompt', async () => {
  const previousHome = process.env.DSH_HOME
  const home = await mkdtemp(join(resolve('.review/integrated_host_review'), 'child-'))
  const ctx = await boot(new MockAdapter([textResponse('FIRST'), toolCallResponse('past-child-write', 'child_write', {}), textResponse('CHILD_DONE'), textResponse('LATER_READ_ONLY')]), ctx => {
    ctx.tools.register(defineContentToolFixture({ name: 'child_write', description: 'test-owned earlier write', hostEffect: 'filesystem-write', parameters: {}, async execute(_args, exec) {
      await writeFile(join(exec.agent!.session.header.cwd!, 'prior-work.txt'), 'preserve earlier work')
      return []
    } }))
  }, home)
  try {
    const id = SessionId('parent-earlier-effects-review')
    await ctx.sessionController.create({ kind: 'free', sessionId: id })
    const parent = ctx.agents.get(id)!
    await ctx.sessionController.prompt({ requestId: brandString('first'), sessionId: id, mode: 'queue', content: [{ type: 'text', text: 'first task' }] }, new AbortController().signal)
    await parent.whenIdle()
    const childHandle = await ctx.agents.create({ sessionId: SessionId('earlier-child-review'), parentAgent: parent, meta: { cwd: parent.session.header.cwd, parentSession: id, origin: 'subagent', delegationDepth: 1 }, agentOptions: { provider: 'mock', model: 'mock' } })
    childHandle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'earlier child task' }], source: { kind: 'user' } }))
    await childHandle.agent.whenIdle()
    await childHandle.dispose()
    expect(ctx.sessions.get(SessionId('earlier-child-review'))).toBeUndefined()
    expect(await ctx.sessionPersistence.stat(SessionId('earlier-child-review'))).toBeDefined()
    await parent.whenIdle()
    const target = parent.session.snapshotEvents().findLast(event => event.type === 'user/message' && event.data.source.kind === 'user')!
    if (target.type !== 'user/message') throw new Error('No later prompt')
    const preview = await ctx.sessionController.previewRetry({ sessionId: id, messageId: target.data.id })
    expect(preview).toMatchObject({ eligible: false })
  } finally {
    await ctx.fiber.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  }
})

