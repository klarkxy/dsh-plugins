import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { brandString } from '@deepseek-ai/dsh-brand'
import { MockAdapter, textResponse } from '../packages/core/agent-loop/tests/mock-adapter.ts'
import { boot } from './recovery-boot.ts'
it('searches active human transcript text hidden only by ordinary model compaction', async () => {
  const previousHome = process.env.DSH_HOME
  const home = await mkdtemp(join(tmpdir(), 'thread-compaction-search-'))
  let ctx: Awaited<ReturnType<typeof boot>> | undefined
  try {
    ctx = await boot(new MockAdapter([]), () => {}, home)
    const id = SessionId('compacted-search-thread')
    const session = ctx.sessions.create(id)
    const original = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'UNIQUE_ORIGINAL_NEEDLE historical human question' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'A shortened summary without the original keyword' }], source: { kind: 'compact-checkpoint' } as never }), { surfaceOp: { op: 'replace', startSeq: original.seq, endSeq: original.seq }, sourceEventSeqs: [original.seq] })
    using observation = await ctx.sessionQuery.observeSession(id, { projectionMode: 'none' })
    expect(observation.activeEvents.some(event => event.seq === original.seq)).toBe(true)
    const found = await ctx.sessionQuery.searchSessions({ query: 'UNIQUE_ORIGINAL_NEEDLE' })
    expect(found.items.map(item => item.header.id)).toContain(id)
    const within = await ctx.sessionQuery.searchEvents({ sessionId: id, query: 'UNIQUE_ORIGINAL_NEEDLE' })
    expect(within.items.map(item => item.seq)).toContain(original.seq)
  } finally {
    await ctx?.fiber.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  }
})

it('excludes superseded retry attempts from default cross-session search', async () => {
  const previousHome = process.env.DSH_HOME
  const home = await mkdtemp(join(tmpdir(), 'thread-branch-search-'))
  let ctx: Awaited<ReturnType<typeof boot>> | undefined
  try {
    ctx = await boot(new MockAdapter([textResponse('OLD_ATTEMPT_UNIQUE_NEEDLE'), textResponse('CURRENT_RESPONSE')]), () => {}, home)
    const id = SessionId('search-current-branch')
    await ctx.sessionController.create({ kind: 'free', sessionId: id })
    const agent = ctx.agents.get(id)!
    await ctx.sessionController.prompt({ requestId: brandString('initial'), sessionId: id, mode: 'queue', content: [{ type: 'text', text: 'Original question' }] }, new AbortController().signal)
    await agent.whenIdle()
    const anchor = agent.session.snapshotEvents().find(event => event.type === 'user/message' && event.data.source.kind === 'user')!
    if (anchor.type !== 'user/message') throw new Error('No anchor')
    const preview = await ctx.sessionController.previewRetry({ sessionId: id, messageId: anchor.data.id })
    await ctx.sessionController.retry({ sessionId: id, messageId: anchor.data.id, expectedRevision: preview.branchRevision, expectedInputRevision: preview.inputRevision, requestId: 'search-retry', text: 'Edited question' })
    await agent.whenIdle()
    const old = await ctx.sessionQuery.searchSessions({ query: 'OLD_ATTEMPT_UNIQUE_NEEDLE' })
    expect(old.items.map(item => item.header.id)).not.toContain(id)
    const current = await ctx.sessionQuery.searchSessions({ query: 'CURRENT_RESPONSE' })
    expect(current.items.map(item => item.header.id)).toContain(id)
  } finally {
    await ctx?.fiber.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  }
})
