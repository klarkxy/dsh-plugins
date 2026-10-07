import { cp, mkdtemp, rm } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse, toolCallResponse } from '../../packages/core/agent-loop/tests/mock-adapter.ts'
import { boot } from '../../.acceptance/recovery-boot.ts'

it('keeps missing durable tool-effect evidence blocked on cold retry recovery', async () => {
  const previousHome = process.env.DSH_HOME
  const artifactRoot = resolve('.review/integrated_host_review')
  const home = await mkdtemp(join(artifactRoot, 'source-'))
  const capturedHome = await mkdtemp(join(artifactRoot, 'captured-'))
  let first: Awaited<ReturnType<typeof boot>> | undefined
  let second: Awaited<ReturnType<typeof boot>> | undefined
  try {
    first = await boot(new MockAdapter([textResponse('INITIAL'), toolCallResponse('uncertain-call', 'uncertain_tool', {})]), ctx => {
      ctx.tools.register(defineContentToolFixture({ name: 'uncertain_tool', description: 'unknown effect fixture', parameters: {}, async execute() { return [] } }))
    }, home)
    const id = SessionId('missing-effect-review')
    await first.sessionController.create({ kind: 'free', sessionId: id })
    const agent = first.agents.get(id)!
    await first.sessionController.prompt({ requestId: brandString('initial'), sessionId: id, mode: 'queue', content: [{ type: 'text', text: 'ORIGINAL' }] }, new AbortController().signal)
    await agent.whenIdle()
    const anchor = agent.session.snapshotEvents().find(event => event.type === 'user/message' && event.data.source.kind === 'user')!
    if (anchor.type !== 'user/message') throw new Error('No anchor')
    const preview = await first.sessionController.previewRetry({ sessionId: id, messageId: anchor.data.id })
    const request = { sessionId: id, messageId: anchor.data.id, expectedRevision: preview.branchRevision, expectedInputRevision: preview.inputRevision, requestId: 'missing-effect-retry', text: 'REPLACEMENT' }
    const reached = Promise.withResolvers<void>()
    const stop = first.on('tools/pre-execute', async (exec, next) => {
      if (exec.name !== 'uncertain_tool') return next()
      reached.resolve()
      await new Promise<void>((_resolve, reject) => { if (exec.signal.aborted) { reject(exec.signal.reason); return }; exec.signal.addEventListener('abort', () => reject(exec.signal.reason), { once: true }) })
      return next()
    })
    await first.sessionController.retry(request)
    await reached.promise
    await first.sessions.flush(agent.session)
    const events = agent.session.snapshotEvents()
    expect(events.some(event => event.type === 'tool/call' && event.data.callId === 'uncertain-call')).toBe(true)
    expect(events.some(event => event.type === 'host/tool-effect' && event.data.callId === 'uncertain-call')).toBe(false)
    await cp(home, capturedHome, { recursive: true, filter: path => !basename(path).endsWith('.lock') })
    first.sessionController.cancel({ sessionId: id })
    await agent.whenIdle()
    stop()
    await first.fiber.dispose()
    first = undefined
    // Restore the durable crash snapshot at the original location. Existing
    // owned directories retain their physical identity rather than adopting a copy.
    await cp(capturedHome, home, { recursive: true })
    const recovered = new MockAdapter([textResponse('MUST_NOT_REPLAY_UNKNOWN_WORK')])
    second = await boot(recovered, () => {}, home)
    await second.sessionController.retry(request)
    await second.agents.get(id)!.whenIdle()
    expect(recovered.requests).toHaveLength(0)
  } finally {
    await first?.fiber.dispose()
    await second?.fiber.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
    await rm(capturedHome, { recursive: true, force: true })
  }
})
