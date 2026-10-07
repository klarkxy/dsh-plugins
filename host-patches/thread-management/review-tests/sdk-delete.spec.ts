import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { HarnessSdkJsonRpcServer } from '../../packages/sdk/server/src/server.ts'
import { MockAdapter, textResponse } from '../../packages/core/agent-loop/tests/mock-adapter.ts'
import { boot } from '../../.acceptance/recovery-boot.ts'

it('rejects SDK recreation of a terminally deleted session ID', async () => {
  const previousHome = process.env.DSH_HOME
  const home = await mkdtemp(join(resolve('.review/integrated_host_review'), 'sdk-'))
  const ctx = await boot(new MockAdapter([textResponse('RESURRECTED')]), () => {}, home)
  const sdk = new HarnessSdkJsonRpcServer(ctx, { request: async () => { throw new Error('unused') }, notify() {} })
  try {
    const id = SessionId('sdk-resurrection-review')
    await ctx.sessionController.create({ sessionId: id, cwd: home })
    expect(await ctx.sessionController.delete({ sessionId: id, requestId: 'review-delete' })).toEqual({ sessionId: id, phase: 'deleted' })
    await sdk.initialize({ cwd: home, provider: 'mock', model: 'mock' })
    let accepted = false
    try { await sdk.prompt({ sessionId: id, contentBlocks: [{ type: 'text', text: 'NEW INPUT' }] }); accepted = true } catch { /* Expected tombstone refusal. */ }
    await ctx.agents.get(id)?.whenIdle()
    expect(accepted).toBe(false)
    expect(ctx.sessions.get(id)).toBeUndefined()
  } finally {
    await sdk.shutdown()
    await ctx.fiber.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  }
})
