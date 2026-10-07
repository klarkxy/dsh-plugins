import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import ScheduleService from '../../packages/schedule/schedule/src/index.ts'
import { MockAdapter, textResponse } from '../../packages/core/agent-loop/tests/mock-adapter.ts'
import { boot } from '../../.acceptance/recovery-boot.ts'

it('deletes owned completed reminder rows and delivery history with the session', async () => {
  const previousHome = process.env.DSH_HOME
  const home = await mkdtemp(join(resolve('.review/integrated_host_review'), 'schedule-'))
  const ctx = await boot(new MockAdapter([textResponse('REMINDER_DONE')]), () => {}, home)
  try {
    await ctx.plugin(ScheduleService)
    const id = SessionId('inactive-reminder-review')
    await ctx.sessionController.create({ kind: 'free', sessionId: id })
    const reminder = await ctx.schedule.create(id, { title: 'Owned one-shot', prompt: 'deleted session private prompt', after_seconds: 1 })
    await vi.waitFor(async () => { expect((await ctx.schedule.catalog()).find(row => row.id === reminder.id)?.status).toBe('inactive') }, { timeout: 4000 })
    await ctx.agents.get(id)!.whenIdle()
    expect(await ctx.sessionController.delete({ sessionId: id, requestId: 'delete-inactive-review' })).toEqual({ sessionId: id, phase: 'deleted' })
    expect((await ctx.schedule.catalog()).filter(row => row.sessionId === id)).toEqual([])
  } finally {
    await ctx.fiber.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  }
})
