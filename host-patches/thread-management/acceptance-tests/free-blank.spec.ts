import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { MockAdapter } from '../packages/core/agent-loop/tests/mock-adapter.ts'
import { boot } from './recovery-boot.ts'
it('preserves a created free chat and its owned files before the first model prompt across restart', async () => {
  const previousHome = process.env.DSH_HOME
  const home = await mkdtemp(join(tmpdir(), 'thread-free-blank-'))
  let ctx: Awaited<ReturnType<typeof boot>> | undefined
  try {
    ctx = await boot(new MockAdapter([]), () => {}, home)
    const id = SessionId('blank-free-chat')
    await ctx.sessionController.create({ kind: 'free', sessionId: id })
    expect(await ctx.sessionPersistence.stat(id)).toBeDefined()
    const owned = ctx.sessions.get(id)!.header.ownedDirectory!
    await writeFile(join(owned, 'draft.txt'), 'owned file before any model prompt')
    await ctx.fiber.dispose()
    ctx = undefined
    ctx = await boot(new MockAdapter([]), () => {}, home)
    // Wait through the public lifecycle admission barrier before inspecting cold rows.
    await ctx.sessionController.previewRetry({ sessionId: id, messageId: 'not-an-anchor' }).catch(() => undefined)
    const rows = await ctx.sessionQuery.listSessions()
    expect(rows.map(row => row.header.id)).toContain(id)
    using observation = await ctx.sessionQuery.observeSession(id, { projectionMode: 'none' })
    expect(observation.header.classification).toBe('free')
    expect(observation.header.ownedDirectory).toBe(owned)
    expect(await readFile(join(owned, 'draft.txt'), 'utf8')).toBe('owned file before any model prompt')
  } finally {
    await ctx?.fiber.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  }
})
