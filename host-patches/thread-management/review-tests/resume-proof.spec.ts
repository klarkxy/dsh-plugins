import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import { MockAdapter, textResponse } from '../../packages/core/agent-loop/tests/mock-adapter.ts'
import { boot } from '../../.acceptance/recovery-boot.ts'

it('refuses cold free-session activation after its proven root is substituted', async () => {
  const previousHome = process.env.DSH_HOME
  const home = await mkdtemp(join(resolve('.review/integrated_host_review'), 'resume-proof-'))
  const ctx = await boot(new MockAdapter([textResponse('DONE')]), () => {}, home)
  try {
    const id = SessionId('resume-proof-review')
    await ctx.sessionController.create({ kind: 'free', sessionId: id })
    const agent = ctx.agents.get(id)!
    const owned = agent.session.header.ownedDirectory!
    await ctx.sessionController.prompt({ requestId: brandString('initial'), sessionId: id, mode: 'queue', content: [{ type: 'text', text: 'original' }] }, new AbortController().signal)
    await agent.whenIdle()
    const anchor = agent.session.snapshotEvents().find(event => event.type === 'user/message' && event.data.source.kind === 'user')!
    if (anchor.type !== 'user/message') throw new Error('Missing prompt')
    await ctx.agentLoop.releaseSession(id)
    await rename(owned, `${owned}-saved`)
    await mkdir(owned)
    await writeFile(join(owned, 'unowned.txt'), 'preserve substituted root')
    let accepted = false
    try { await ctx.sessionController.previewRetry({ sessionId: id, messageId: anchor.data.id }); accepted = true } catch { /* Correct ownership refusal. */ }
    expect(accepted).toBe(false)
    expect(ctx.agents.get(id)).toBeUndefined()
  } finally {
    await ctx.fiber.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  }
})
