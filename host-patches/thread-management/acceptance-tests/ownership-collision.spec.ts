import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { MockAdapter } from '../packages/core/agent-loop/tests/mock-adapter.ts'
import { boot } from './recovery-boot.ts'
it.runIf(process.platform === 'win32')('never claims or deletes another free root through a case alias after a failed creation', async () => {
  const previousHome = process.env.DSH_HOME
  const home = await mkdtemp(join(tmpdir(), 'thread-owner-collision-'))
  let ctx: Awaited<ReturnType<typeof boot>> | undefined
  try {
    ctx = await boot(new MockAdapter([]), () => {}, home)
    const id = SessionId('case-owner')
    await ctx.sessionController.create({ kind: 'free', sessionId: id })
    await ctx.sessions.flush(ctx.sessions.get(id)!)
    const owned = ctx.sessions.get(id)!.header.ownedDirectory!
    await writeFile(join(owned, 'keep.txt'), 'belongs to the first chat')
    await ctx.sessionController.create({ kind: 'free', sessionId: SessionId('CASE-OWNER') }).catch(() => undefined)
    await ctx.sessionController.delete({ sessionId: SessionId('CASE-OWNER'), requestId: 'delete-alias' }).catch(() => undefined)
    expect(await readFile(join(owned, 'keep.txt'), 'utf8')).toBe('belongs to the first chat')
    expect(ctx.sessions.get(id)).toBeDefined()
  } finally {
    await ctx?.fiber.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  }
})
