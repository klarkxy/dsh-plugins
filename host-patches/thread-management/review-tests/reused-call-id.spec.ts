import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse, toolCallResponse } from '../../packages/core/agent-loop/tests/mock-adapter.ts'
import { boot } from '../../.acceptance/recovery-boot.ts'

it('keeps write evidence when a later read-only dispatch reuses the provider call ID', async () => {
  const previousHome = process.env.DSH_HOME
  const home = await mkdtemp(join(resolve('.review/integrated_host_review'), 'reused-call-'))
  const ctx = await boot(new MockAdapter([toolCallResponse('reused', 'actual_write', {}), toolCallResponse('reused', 'actual_read', {}), textResponse('DONE')]), ctx => {
    ctx.tools.register(defineContentToolFixture({ name: 'actual_write', description: 'test-owned write', hostEffect: 'filesystem-write', parameters: {}, async execute(_args, exec) {
      await writeFile(join(exec.agent!.session.header.cwd!, 'actual-change.txt'), 'written')
      return []
    } }))
    ctx.tools.register(defineContentToolFixture({ name: 'actual_read', description: 'read-only fixture', hostEffect: 'read-only', parameters: {}, async execute() { return [] } }))
  }, home)
  try {
    const id = SessionId('reused-call-review')
    await ctx.sessionController.create({ kind: 'free', sessionId: id })
    await ctx.sessionController.prompt({ requestId: brandString('prompt'), sessionId: id, mode: 'queue', content: [{ type: 'text', text: 'perform requested work' }] }, new AbortController().signal)
    const agent = ctx.agents.get(id)!
    await agent.whenIdle()
    expect(agent.session.snapshotEvents().filter(event => event.type === 'host/tool-effect').map(event => event.data.effect)).toEqual(['filesystem-write', 'read-only'])
    const anchor = agent.session.snapshotEvents().find(event => event.type === 'user/message' && event.data.source.kind === 'user')!
    if (anchor.type !== 'user/message') throw new Error('Missing prompt')
    expect(await ctx.sessionController.previewRetry({ sessionId: id, messageId: anchor.data.id })).toMatchObject({ eligible: false })
  } finally {
    await ctx.fiber.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  }
})
