import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { MockAdapter, textResponse, toolCallResponse } from '../../packages/core/agent-loop/tests/mock-adapter.ts'
import { boot } from '../../.acceptance/recovery-boot.ts'

it('does not acknowledge free fork while an owned file writer is between its updates', async () => {
  const previousHome = process.env.DSH_HOME
  const home = await mkdtemp(join(resolve('.review/integrated_host_review'), 'fork-'))
  const writing = Promise.withResolvers<void>()
  const finish = Promise.withResolvers<void>()
  const ctx = await boot(new MockAdapter([textResponse('READY'), toolCallResponse('writer', 'two_file_write', {}), textResponse('UPDATED')]), ctx => {
    ctx.tools.register(defineContentToolFixture({ name: 'two_file_write', description: 'test-owned writer', hostEffect: 'filesystem-write', parameters: {}, async execute(_args, exec) {
      const owned = exec.agent!.session.header.cwd!
      await writeFile(join(owned, 'a.txt'), 'new')
      writing.resolve()
      exec.signal.addEventListener('abort', () => finish.resolve(), { once: true })
      await finish.promise
      await writeFile(join(owned, 'b.txt'), 'new')
      return []
    } }))
  }, home)
  try {
    const id = SessionId('fork-write-review')
    await ctx.sessionController.create({ kind: 'free', sessionId: id })
    const agent = ctx.agents.get(id)!
    const owned = agent.session.header.cwd!
    await writeFile(join(owned, 'a.txt'), 'old')
    await writeFile(join(owned, 'b.txt'), 'old')
    await ctx.sessionController.prompt({ requestId: brandString('first'), sessionId: id, mode: 'queue', content: [{ type: 'text', text: 'ready' }] }, new AbortController().signal)
    await agent.whenIdle()
    const boundary = agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')!.seq
    await ctx.sessionController.prompt({ requestId: brandString('write'), sessionId: id, mode: 'queue', content: [{ type: 'text', text: 'update both files' }] }, new AbortController().signal)
    await writing.promise
    let forked: Awaited<ReturnType<typeof ctx.sessionController.fork>>
    try {
      forked = await ctx.sessionController.fork({ sessionId: id, atSeq: boundary })
    } catch (error) {
      expect(remoteErrorOf(error)?.code).toBe('session/agent-busy')
      finish.resolve()
      await agent.whenIdle()
      return
    }
    const childRoot = ctx.sessions.get(forked.sessionId)!.header.cwd!
    const files = await Promise.all(['a.txt', 'b.txt'].map(name => readFile(join(childRoot, name), 'utf8')))
    finish.resolve()
    await agent.whenIdle()
    expect(files).toEqual(['new', 'new'])
  } finally {
    finish.resolve()
    await ctx.fiber.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  }
})
