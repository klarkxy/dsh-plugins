import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { brandString } from '@deepseek-ai/dsh-brand'
import { MockAdapter, textResponse } from '../packages/core/agent-loop/tests/mock-adapter.ts'
import { boot } from './recovery-boot.ts'

it('deletes persisted owned subagent logs while preserving independent forks', async () => {
  const previousHome = process.env.DSH_HOME
  const home = await mkdtemp(join(tmpdir(), 'thread-owned-delete-'))
  let ctx: Awaited<ReturnType<typeof boot>> | undefined
  try {
    ctx = await boot(new MockAdapter([textResponse('PARENT_DONE')]), () => {}, home)
    const root = SessionId('owned-delete-root')
    await ctx.sessionController.create({ kind: 'free', sessionId: root })
    await ctx.sessionController.prompt({ requestId: brandString('parent-prompt'), sessionId: root, mode: 'queue', content: [{ type: 'text', text: 'Parent task' }] }, new AbortController().signal)
    await ctx.agents.get(root)!.whenIdle()
    const source = ctx.sessions.get(root)!
    const child = ctx.sessions.prepare(SessionId('owned-delete-cold-child'), { meta: { parentSession: root, origin: 'subagent', delegationDepth: 1, cwd: source.header.cwd } })
    child.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Delegated child task' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    const writer = await ctx.sessionPersistence.create(child.header, { inheritedEventCount: child.inheritedEventCount })
    await writer.append(child.snapshotEvents())
    await writer.close()
    expect(ctx.sessions.get(child.id)).toBeUndefined()
    expect(await ctx.sessionPersistence.stat(child.id)).toBeDefined()
    const independent = await ctx.sessionController.fork({ sessionId: root, increaseTitle: true })
    expect(await ctx.sessionPersistence.stat(independent.sessionId)).toBeDefined()
    const outcome = await ctx.sessionController.delete({ sessionId: root, requestId: 'delete-owned-one' })
    expect(outcome.phase).toBe('deleted')
    expect(await ctx.sessionPersistence.stat(root)).toBeUndefined()
    expect(await ctx.sessionPersistence.stat(child.id)).toBeUndefined()
    expect(await ctx.sessionPersistence.stat(independent.sessionId)).toBeDefined()
    const remaining = await ctx.sessionQuery.listSessions()
    expect(remaining.map(record => record.header.id)).not.toContain(child.id)
  } finally {
    await ctx?.fiber.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  }
})
