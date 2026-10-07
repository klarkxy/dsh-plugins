import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import LocalJobRegistry from '../../packages/jobs/jobs-local/src/index.ts'
import { MockAdapter, textResponse } from '../../packages/core/agent-loop/tests/mock-adapter.ts'
import { boot } from '../../.acceptance/recovery-boot.ts'

it('blocks retry while an owned external producer has no trustworthy effect evidence', async () => {
  const previousHome = process.env.DSH_HOME
  const home = await mkdtemp(join(resolve('.review/integrated_host_review'), 'running-job-'))
  const ctx = await boot(new MockAdapter([textResponse('READ_ONLY')]), () => {}, home)
  const done = Promise.withResolvers<JobOutcome>()
  try {
    await ctx.plugin(LocalJobRegistry)
    ctx.jobs.attachController('review-producer')
    const id = SessionId('running-job-review')
    await ctx.sessionController.create({ kind: 'free', sessionId: id })
    const job = ctx.jobs.start({ kind: 'bash', label: 'unknown-effect owned producer', owner: id, run() { return { done: done.promise, cancel() { done.resolve({ status: 'killed' }) } } } })
    await ctx.sessionController.prompt({ requestId: brandString('query'), sessionId: id, mode: 'queue', content: [{ type: 'text', text: 'read-only question while producer runs' }] }, new AbortController().signal)
    const agent = ctx.agents.get(id)!
    await agent.whenIdle()
    expect(ctx.jobs.get(job, id).status).toBe('running')
    const anchor = agent.session.snapshotEvents().find(event => event.type === 'user/message' && event.data.source.kind === 'user')!
    if (anchor.type !== 'user/message') throw new Error('Missing prompt')
    expect(await ctx.sessionController.previewRetry({ sessionId: id, messageId: anchor.data.id })).toMatchObject({ eligible: false })
  } finally {
    done.resolve({ status: 'completed' })
    await ctx.fiber.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  }
})
