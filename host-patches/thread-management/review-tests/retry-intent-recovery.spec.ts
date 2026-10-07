/** Durable retry receipts cannot shadow input admitted by a controller-free SDK composition. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { HarnessSdkJsonRpcServer } from '../../packages/sdk/server/src/server.ts'
import { ApiSessionAgentController } from '../../packages/api/session-controller/src/agent.ts'
import { SessionLifecycle } from '../../packages/api/session-controller/src/lifecycle.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../packages/core/agent-loop/tests/mock-adapter.ts'
import { boot } from '../../.acceptance/recovery-boot.ts'

it.each([true, false])('recovers a crash-boundary intent with newer SDK input = %s without losing history', async newerInput => {
  const previousHome = process.env.DSH_HOME
  const home = await mkdtemp(join(resolve('.review/integrated_host_review'), 'intent-sdk-'))
  process.env.DSH_HOME = home
  let ctx: Context | undefined
  let sdk: HarnessSdkJsonRpcServer | undefined
  try {
    ctx = await boot(new MockAdapter([textResponse('ORIGINAL_REPLY'), textResponse('NEWER_REPLY')]), () => {}, home)
    // sdk-minimal has native persistence admission but no SessionController recovery consumer.
    const controllerEntry = [...ctx.loader.entries()].find(entry => entry.options.name === '@deepseek-ai/dsh-api-session-controller')
    if (controllerEntry?.fiber === undefined) throw new Error('fixture controller entry missing')
    controllerEntry.options.disabled = true
    await controllerEntry.fiber.dispose()
    expect(ctx.get('sessionController')).toBeUndefined()
    sdk = new HarnessSdkJsonRpcServer(ctx, { request: async () => { throw new Error('unused transport request') }, notify() {} })
    await sdk.initialize({ cwd: home, provider: 'mock', model: 'mock' })
    const id = SessionId('sdk-intent-recovery')
    const original = await sdk.prompt({ sessionId: id, contentBlocks: [{ type: 'text', text: 'original' }] })
    const agent = ctx.agents.get(id)!
    await agent.whenIdle()
    const lifecycle = new SessionLifecycle(ctx, new ApiSessionAgentController(ctx))
    const preview = await lifecycle.previewRetry(id, original.messageId)
    expect(preview.eligible).toBe(true)
    const request = { sessionId: id, messageId: original.messageId, expectedRevision: preview.branchRevision, expectedInputRevision: preview.inputRevision, requestId: 'crash-intent', text: 'replacement' }
    const receipt = { requestId: request.requestId, messageId: original.messageId, expectedRevision: preview.branchRevision, inputRevision: preview.inputRevision, revision: 1, text: request.text, stage: 'intent' as const }
    await ctx.sessionPersistence.admission.table!.put(id, { phase: 'active', classification: 'ordinary', retry: receipt })
    if (newerInput) {
      await sdk.prompt({ sessionId: id, contentBlocks: [{ type: 'text', text: 'newer human input' }] })
      await agent.whenIdle()
    }
    const visibleBefore = agent.session.deriveMessages().filter(message => message.role === 'user').map(message => message.content)
    expect(visibleBefore).toEqual(newerInput ? [[{ type: 'text', text: 'original' }], [{ type: 'text', text: 'newer human input' }]] : [[{ type: 'text', text: 'original' }]])
    await sdk.shutdown()
    sdk = undefined
    const before = agent.session.snapshotEvents()
    await ctx.fiber.dispose()
    ctx = undefined
    const durableRecord = JSON.parse(await readFile(join(home, 'storages/session_lifecycle.json'), 'utf8'))
    expect(durableRecord.tables.sessions[id].retry).toEqual(receipt)

    // Reopen the same durable home at the intent-before-branch crash cut.
    const adapter = new MockAdapter([textResponse('RECOVERED_REPLY'), textResponse('FRESH_RETRY_REPLY')])
    ctx = await boot(adapter, () => {}, home)
    if (newerInput) {
      const resolved = await ctx.sessionController.resolveAgent(id)
      if ('error' in resolved) throw resolved.error
      const resumed = resolved.agent.session
      const beforeRetry = resumed.snapshotEvents()
      // Native resume records its end-seed marker; retry must not change that resumed prefix.
      expect(beforeRetry.slice(0, before.length)).toEqual(before)
      await expect(ctx.sessionController.retry(request)).rejects.toMatchObject({ code: 'session/retry-input' })
      expect(resumed.snapshotEvents()).toEqual(beforeRetry)
      expect(resumed.deriveMessages().filter(message => message.role === 'user').map(message => message.content)).toEqual(visibleBefore)
      expect(ctx.sessionPersistence.admission.table!.get(id)?.retry).toEqual(receipt)
      expect(adapter.requests).toHaveLength(0)
      await ctx.sessionController.prompt({ requestId: brandString('fresh-controller-prompt'), sessionId: id, mode: 'queue', content: [{ type: 'text', text: 'fresh controller input' }] }, new AbortController().signal)
      await resolved.agent.whenIdle()
      expect(resumed.deriveMessages().filter(message => message.role === 'user').map(message => message.content)).toEqual([...visibleBefore, [{ type: 'text', text: 'fresh controller input' }]])
      expect(resumed.snapshotEvents().some(event => event.type === 'session/active-branch')).toBe(false)
      expect(ctx.sessionPersistence.admission.table!.get(id)?.retry).toEqual(receipt)
      expect(adapter.requests).toHaveLength(1)
      await expect(ctx.sessionController.retry(request)).rejects.toMatchObject({ code: 'session/retry-input' })
      const forked = await ctx.sessionController.fork({ sessionId: id })
      expect(ctx.agents.get(forked.sessionId)!.session.deriveMessages().filter(message => message.role === 'user').map(message => message.content)).toEqual([...visibleBefore, [{ type: 'text', text: 'fresh controller input' }]])
      const latest = resumed.snapshotEvents().findLast(event => event.type === 'user/message' && event.data.source.kind === 'user')!
      if (latest.type !== 'user/message') throw new Error('fresh controller prompt missing')
      const freshPreview = await ctx.sessionController.previewRetry({ sessionId: id, messageId: latest.data.id })
      expect(freshPreview.eligible).toBe(true)
      await ctx.sessionController.retry({ sessionId: id, messageId: latest.data.id, expectedRevision: freshPreview.branchRevision, expectedInputRevision: freshPreview.inputRevision, requestId: 'explicit-fresh-retry', text: 'fresh replacement' })
      await resolved.agent.whenIdle()
      expect(ctx.sessionPersistence.admission.table!.get(id)?.retry?.requestId).toBe('explicit-fresh-retry')
      expect(adapter.requests).toHaveLength(2)
      expect(resumed.deriveMessages().filter(message => message.role === 'user').map(message => message.content)).toEqual([...visibleBefore, [{ type: 'text', text: 'fresh replacement' }]])
    } else {
      await expect(ctx.sessionController.retry(request)).resolves.toEqual({ sessionId: id, branchRevision: 1 })
      await ctx.agents.get(id)!.whenIdle()
      expect(ctx.agents.get(id)!.session.deriveMessages().find(message => message.role === 'user')?.content).toEqual([{ type: 'text', text: 'replacement' }])
      expect(adapter.requests).toHaveLength(1)
      await expect(ctx.sessionController.retry(request)).resolves.toEqual({ sessionId: id, branchRevision: 1 })
      expect(adapter.requests).toHaveLength(1)
    }
  } finally {
    await sdk?.shutdown()
    await ctx?.fiber.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  }
})

it('retains an unbranched intent after a persisted nonresident owned child writes', async () => {
  const previousHome = process.env.DSH_HOME
  const home = await mkdtemp(join(resolve('.review/integrated_host_review'), 'intent-cold-'))
  process.env.DSH_HOME = home
  let ctx: Context | undefined
  try {
    ctx = await boot(new MockAdapter([textResponse('ORIGINAL_REPLY'), toolCallResponse('cold-write', 'write_fixture', {}), textResponse('CHILD_DONE')]), tools => {
      tools.tools.register(defineContentToolFixture({ name: 'write_fixture', description: 'fixture-owned writer', parameters: {}, hostEffect: 'filesystem-write', async execute() {
        await writeFile(join(home, 'preserve.txt'), 'owned child effect')
        return []
      } }))
    }, home)
    const id = SessionId('intent-parent-cold-child')
    await ctx.sessionController.create({ sessionId: id, cwd: home })
    await ctx.sessionController.prompt({ requestId: brandString('original-prompt'), sessionId: id, mode: 'queue', content: [{ type: 'text', text: 'original' }] }, new AbortController().signal)
    const parent = ctx.agents.get(id)!
    await parent.whenIdle()
    const original = parent.session.snapshotEvents().find(event => event.type === 'user/message')!
    if (original.type !== 'user/message') throw new Error('fixture prompt missing')
    const preview = await ctx.sessionController.previewRetry({ sessionId: id, messageId: original.data.id })
    expect(preview.eligible).toBe(true)
    const receipt = { requestId: 'intent-before-child', messageId: original.data.id, expectedRevision: 0, inputRevision: preview.inputRevision, revision: 1, text: 'replacement', stage: 'intent' as const }
    const table = ctx.sessionPersistence.admission.table!
    await table.put(id, { phase: 'active', classification: 'ordinary', retry: receipt })
    const childId = SessionId('intent-cold-child')
    const child = await ctx.agents.create({ sessionId: childId, parentAgent: parent, meta: { cwd: home, parentSession: id, origin: 'subagent', delegationDepth: 1 }, agentOptions: { provider: 'mock', model: 'mock' } })
    child.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'write fixture' }], source: { kind: 'user' } }))
    await child.agent.whenIdle()
    await child.dispose()
    expect(ctx.sessions.get(childId)).toBeUndefined()
    expect(await readFile(join(home, 'preserve.txt'), 'utf8')).toBe('owned child effect')
    const before = parent.session.snapshotEvents()
    await expect(ctx.sessionController.retry({ sessionId: id, messageId: original.data.id, expectedRevision: 0, expectedInputRevision: preview.inputRevision, requestId: receipt.requestId, text: receipt.text })).rejects.toMatchObject({ code: 'session/retry-blocked', details: { reason: 'modified', blockers: expect.arrayContaining([`child:${childId}:filesystem-write:cold-write`]) } })
    expect(parent.session.snapshotEvents()).toEqual(before)
    expect(table.get(id)?.retry).toEqual(receipt)
    expect(await readFile(join(home, 'preserve.txt'), 'utf8')).toBe('owned child effect')
  } finally {
    await ctx?.fiber.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  }
})
