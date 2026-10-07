import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { boot } from './boot-no-persistence.ts'
import { MockAdapter } from '../../packages/core/agent-loop/tests/mock-adapter.ts'

it('does not advertise durable lifecycle without a session persistence owner', async () => {
  const previousHome = process.env.DSH_HOME
  const home = await mkdtemp(join(resolve('.review/integrated_host_review'), 'capabilities-'))
  const ctx = await boot(new MockAdapter([]), () => {}, home)
  try {
    await ctx.sessionController.previewRetry({ sessionId: SessionId('missing'), messageId: 'missing' }).catch(() => undefined)
    expect(ctx.get('sessionPersistence')).toBeUndefined()
    expect(ctx.get('storageDomain')).toBeDefined()
    expect(ctx.sessionController.capabilities()).toEqual({ retry: false, freeSession: false, deleteSession: false })
  } finally {
    await ctx.fiber.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  }
})
