import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import SessionTitleService, { SessionTitleProviderId } from '@deepseek-ai/dsh-session-title'
import { MockAdapter, textResponse } from '../../packages/core/agent-loop/tests/mock-adapter.ts'
import { boot } from '../../.acceptance/recovery-boot.ts'

it('fences an in-flight title derived from a superseded prompt', async () => {
  const previousHome = process.env.DSH_HOME
  const home = await mkdtemp(join(resolve('.review/integrated_host_review'), 'title-'))
  const ctx = await boot(new MockAdapter([textResponse('OLD'), textResponse('NEW')]), () => {}, home)
  const generated = Promise.withResolvers<void>()
  const finish = Promise.withResolvers<void>()
  let refreshing: Promise<unknown> | undefined
  try {
    await ctx.plugin(SessionTitleService, { fallbackMaxWords: 5, fallbackMaxBytes: 80, maxTitleBytes: 80 })
    const id = SessionId('title-fence-review')
    await ctx.sessionController.create({ kind: 'free', sessionId: id })
    const agent = ctx.agents.get(id)!
    await ctx.sessionController.prompt({ requestId: brandString('old'), sessionId: id, mode: 'queue', content: [{ type: 'text', text: 'OLD_PROMPT' }] }, new AbortController().signal)
    await agent.whenIdle()
    const anchor = agent.session.snapshotEvents().find(event => event.type === 'user/message' && event.data.source.kind === 'user')!
    if (anchor.type !== 'user/message') throw new Error('Missing prompt')
    ctx.sessionTitle.register({ id: SessionTitleProviderId('review-title'), automatic: 'first-prompt', async generate(request) {
      generated.resolve()
      await finish.promise
      return { title: 'OLD_PROMPT_TITLE', messageSeqs: request.messages.map(message => message.seq) }
    } })
    refreshing = ctx.sessionTitle.refresh(agent.session).catch(() => undefined)
    await generated.promise
    const preview = await ctx.sessionController.previewRetry({ sessionId: id, messageId: anchor.data.id })
    await ctx.sessionController.retry({ sessionId: id, messageId: anchor.data.id, expectedRevision: preview.branchRevision, expectedInputRevision: preview.inputRevision, requestId: 'title-retry', text: 'NEW_PROMPT' })
    await agent.whenIdle()
    finish.resolve()
    await refreshing
    expect(ctx.sessionTitle.get(agent.session)?.title).not.toBe('OLD_PROMPT_TITLE')
  } finally {
    finish.resolve()
    await refreshing
    await ctx.fiber.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  }
})
