/** Independent late-cut and provider-failure probes, isolated from user profiles. */
import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { SessionLifecycle } from '../../packages/api/session-controller/src/lifecycle.ts'
import { ApiSessionAgentController } from '../../packages/api/session-controller/src/agent.ts'
import { MockAdapter, textResponse } from '../../packages/core/agent-loop/tests/mock-adapter.ts'
import { boot } from '../../.acceptance/recovery-boot.ts'

async function isolated(body: (ctx: Context) => Promise<void>): Promise<void> {
  const previous = process.env.DSH_HOME
  const home = await mkdtemp(join(resolve('.review/integrated_host_review'), 'release-cut-'))
  let ctx: Context | undefined
  try {
    ctx = await boot(new MockAdapter([textResponse('ORIGINAL')]), () => {}, home)
    await body(ctx)
  } finally {
    await ctx?.fiber.dispose()
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
}

it.each(['input', 'filesystem-write'] as const)('rechecks %s arriving during the durable intent write before fresh branch commit', async change => {
  await isolated(async ctx => {
    const id = SessionId(`release-late-${change}`)
    await ctx.sessionController.create({ sessionId: id })
    const agent = ctx.agents.get(id)!
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'original' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    const anchor = agent.session.snapshotEvents().find(event => event.type === 'user/message')!
    if (anchor.type !== 'user/message') throw new Error('anchor missing')
    const preview = await ctx.sessionController.previewRetry({ sessionId: id, messageId: anchor.data.id })
    expect(preview.eligible).toBe(true)
    const table = ctx.sessionPersistence.admission.table!
    const put = table.put.bind(table)
    let injected = false
    table.put = async (key, value) => {
      await put(key, value)
      if (!injected && value.retry?.requestId === 'late-cut' && value.retry.stage === 'intent') {
        injected = true
        if (change === 'input') agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'late input' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
        else {
          agent.session.append('tool/call', { turn: 1, step: 1, callId: ToolCallId('late-write'), name: 'write', arguments: '{}' })
          agent.session.append('host/tool-effect', { callId: 'late-write', name: 'write', effect: 'filesystem-write', nested: false })
        }
      }
    }
    try {
      await expect(ctx.sessionController.retry({ sessionId: id, messageId: anchor.data.id, expectedRevision: preview.branchRevision, expectedInputRevision: preview.inputRevision, requestId: 'late-cut', text: 'replacement' })).rejects.toMatchObject({ code: change === 'input' ? 'session/retry-input' : 'session/retry-blocked' })
      expect(injected).toBe(true)
      expect(agent.session.snapshotEvents().some(event => event.type === 'session/active-branch')).toBe(false)
      expect(table.get(id)?.retry?.stage).toBe('intent')
    } finally { table.put = put }
  })
})

it('does not swallow a checkpoint provider failure carrying a retry refusal code', async () => {
  await isolated(async ctx => {
    const id = SessionId('release-checkpoint-failure')
    await ctx.sessionController.create({ sessionId: id })
    const agent = ctx.agents.get(id)!
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'original' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    const anchor = agent.session.snapshotEvents().find(event => event.type === 'user/message')!
    if (anchor.type !== 'user/message') throw new Error('anchor missing')
    const preview = await ctx.sessionController.previewRetry({ sessionId: id, messageId: anchor.data.id })
    const recovery = new SessionLifecycle(ctx, new ApiSessionAgentController(ctx))
    await recovery.whenReady()
    const receipt = { requestId: 'failed-checkpoint', messageId: anchor.data.id, expectedRevision: 0, inputRevision: preview.inputRevision, revision: 1, stage: 'intent' as const }
    await ctx.sessionPersistence.admission.table!.put(id, { phase: 'active', classification: 'ordinary', retry: receipt })
    const flush = ctx.sessions.flush.bind(ctx.sessions)
    const failure = new RemoteError('session/retry-blocked', 'checkpoint provider failed', { sessionId: id, reason: 'provider-failure', blockers: [] })
    ctx.sessions.flush = () => Promise.reject(failure)
    let published = false
    try {
      await expect(recovery.exclusive(id, async () => { published = true })).rejects.toBe(failure)
      expect(published).toBe(false)
      expect(ctx.sessionPersistence.admission.table!.get(id)?.retry).toEqual(receipt)
    } finally { ctx.sessions.flush = flush }
  })
})

it('retains an unresolved intent and propagates an owned-session listing failure', async () => {
  await isolated(async ctx => {
    const id = SessionId('release-owned-list-failure')
    await ctx.sessionController.create({ sessionId: id })
    const agent = ctx.agents.get(id)!
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'original' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    const anchor = agent.session.snapshotEvents().find(event => event.type === 'user/message')!
    if (anchor.type !== 'user/message') throw new Error('anchor missing')
    const preview = await ctx.sessionController.previewRetry({ sessionId: id, messageId: anchor.data.id })
    const recovery = new SessionLifecycle(ctx, new ApiSessionAgentController(ctx))
    await recovery.whenReady()
    const receipt = { requestId: 'owner-list-failure', messageId: anchor.data.id, expectedRevision: 0, inputRevision: preview.inputRevision, revision: 1, stage: 'intent' as const }
    await ctx.sessionPersistence.admission.table!.put(id, { phase: 'active', classification: 'ordinary', retry: receipt })
    const list = ctx.sessionQuery.listSessions.bind(ctx.sessionQuery)
    const before = agent.session.snapshotEvents()
    const failure = new RemoteError('session/writer-held', 'owned-session lookup failed', { sessionId: id })
    ctx.sessionQuery.listSessions = () => Promise.reject(failure)
    let published = false
    try {
      await expect(recovery.exclusive(id, async () => { published = true })).rejects.toBe(failure)
      expect(published).toBe(false)
      expect(agent.session.snapshotEvents()).toEqual(before)
      expect(ctx.sessionPersistence.admission.table!.get(id)?.retry).toEqual(receipt)
    } finally { ctx.sessionQuery.listSessions = list }
  })
})
