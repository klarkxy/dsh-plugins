import { cp, lstat, mkdtemp, realpath, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse, toolCallResponse } from '../packages/core/agent-loop/tests/mock-adapter.ts'
import { boot } from './recovery-boot.ts'

/** Restore crash-time durable bytes while retaining the proven physical free roots. */
async function restoreCrashBytes(home: string, capturedHome: string): Promise<void> {
  const root = await realpath(home)
  const snapshot = await realpath(capturedHome)
  if (!/^thread-(recovery|tool|result)-source-/.test(basename(root))
    || !/^thread-(recovery|tool|result)-crash-/.test(basename(snapshot))) throw new Error('Unexpected owned acceptance roots')
  const names = ['sessions', 'storages', 'query.sqlite', 'query.sqlite-wal', 'query.sqlite-shm']
  const targets = names.map(name => ({ target: resolve(root, name), source: resolve(snapshot, name) }))
  for (const { target, source } of targets) {
    if (dirname(target) !== root || dirname(source) !== snapshot) throw new Error('Restore path escape')
    for (const candidate of [target, source]) {
      const metadata = await lstat(candidate).catch((error: unknown) => {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return undefined
        throw error
      })
      if (metadata?.isSymbolicLink()) throw new Error('Unexpected restore link')
    }
  }
  for (const { target, source } of targets) {
    await rm(target, { recursive: true, force: true })
    const exists = await lstat(source).catch((error: unknown) => {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return undefined
      throw error
    })
    if (exists !== undefined) await cp(source, target, { recursive: true })
  }
}

it('recovers a durable retry admitted before inference rather than treating a start marker as completion', async () => {
  const previousHome = process.env.DSH_HOME
  const home = await mkdtemp(join(tmpdir(), 'thread-recovery-source-'))
  const capturedHome = await mkdtemp(join(tmpdir(), 'thread-recovery-crash-'))
  let first: Awaited<ReturnType<typeof boot>> | undefined
  let second: Awaited<ReturnType<typeof boot>> | undefined
  try {
    const initial = new MockAdapter([textResponse('INITIAL_DONE')])
    first = await boot(initial, () => {}, home)
    const id = SessionId('recovery-before-inference')
    await first.sessionController.create({ kind: 'free', sessionId: id })
    const agent = first.agents.get(id)!
    await first.sessionController.prompt({ requestId: brandString('initial'), sessionId: id, mode: 'queue', content: [{ type: 'text', text: 'ORIGINAL_PROMPT' }] }, new AbortController().signal)
    await agent.whenIdle()
    const anchor = agent.session.snapshotEvents().find(event => event.type === 'user/message' && event.data.source.kind === 'user')!
    if (anchor.type !== 'user/message') throw new Error('No human anchor')
    const preview = await first.sessionController.previewRetry({ sessionId: id, messageId: anchor.data.id })
    const request = { sessionId: id, messageId: anchor.data.id, expectedRevision: preview.branchRevision, expectedInputRevision: preview.inputRevision, requestId: 'durable-retry-one', text: 'REPLACEMENT_PROMPT' }
    let reachedPreStep!: () => void
    const beforeInference = new Promise<void>(resolve => { reachedPreStep = resolve })
    const stop = first.on('agent/pre-step', async ({ agent: subject, signal }, next) => {
      if (subject !== agent) return next()
      reachedPreStep()
      await new Promise<void>((_resolve, reject) => {
        if (signal.aborted) { reject(signal.reason); return }
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
      return next()
    })
    const admitted = first.sessionController.retry(request)
    await beforeInference
    await admitted
    expect(initial.requests).toHaveLength(1)
    // Persisted snapshot at the crash boundary: no model call or result after turn/start.
    await cp(home, capturedHome, { recursive: true, filter: path => !basename(path).endsWith('.lock') })
    first.sessionController.cancel({ sessionId: id })
    await agent.whenIdle()
    stop()
    await first.fiber.dispose()
    first = undefined
    const recovered = new MockAdapter([textResponse('RECOVERED_REPLACEMENT_DONE')])
    await restoreCrashBytes(home, capturedHome)
    second = await boot(recovered, () => {}, home)
    const replayed = await second.sessionController.retry(request)
    expect(replayed).toMatchObject({ sessionId: id, branchRevision: 1 })
    const resumed = second.agents.get(id)!
    await resumed.whenIdle()
    expect(recovered.requests).toHaveLength(1)
    expect(resumed.session.deriveMessages().some(message => message.role === 'assistant' && message.content.some(block => block.type === 'text' && block.text === 'RECOVERED_REPLACEMENT_DONE'))).toBe(true)
    expect(resumed.session.snapshotEvents().filter(event => event.type === 'session/active-branch')).toHaveLength(1)
  } finally {
    await first?.fiber.dispose()
    await second?.fiber.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
    await rm(capturedHome, { recursive: true, force: true })
  }
})

it('does not mistake a durable intermediate tool-call message for a completed retry response', async () => {
  const previousHome = process.env.DSH_HOME
  const home = await mkdtemp(join(tmpdir(), 'thread-tool-source-'))
  const capturedHome = await mkdtemp(join(tmpdir(), 'thread-tool-crash-'))
  let first: Awaited<ReturnType<typeof boot>> | undefined
  let second: Awaited<ReturnType<typeof boot>> | undefined
  try {
    let entered!: () => void
    const toolStarted = new Promise<void>(resolve => { entered = resolve })
    const initial = new MockAdapter([textResponse('INITIAL_DONE'), toolCallResponse('replacement-read', 'trusted_read', {})])
    first = await boot(initial, ctx => {
      ctx.tools.register(defineContentToolFixture({ name: 'trusted_read', description: 'read-only acceptance fixture', hostEffect: 'read-only', parameters: {}, async execute(_args, exec) {
        entered()
        await new Promise<void>((_resolve, reject) => { if (exec.signal.aborted) { reject(exec.signal.reason); return }; exec.signal.addEventListener('abort', () => reject(exec.signal.reason), { once: true }) })
        return []
      } }))
    }, home)
    const id = SessionId('recovery-intermediate-message')
    await first.sessionController.create({ kind: 'free', sessionId: id })
    const agent = first.agents.get(id)!
    await first.sessionController.prompt({ requestId: brandString('initial'), sessionId: id, mode: 'queue', content: [{ type: 'text', text: 'ORIGINAL_PROMPT' }] }, new AbortController().signal)
    await agent.whenIdle()
    const anchor = agent.session.snapshotEvents().find(event => event.type === 'user/message' && event.data.source.kind === 'user')!
    if (anchor.type !== 'user/message') throw new Error('No anchor')
    const preview = await first.sessionController.previewRetry({ sessionId: id, messageId: anchor.data.id })
    const request = { sessionId: id, messageId: anchor.data.id, expectedRevision: preview.branchRevision, expectedInputRevision: preview.inputRevision, requestId: 'intermediate-retry-one', text: 'REPLACEMENT_PROMPT' }
    await first.sessionController.retry(request)
    await toolStarted
    await first.sessions.flush(agent.session)
    await cp(home, capturedHome, { recursive: true, filter: path => !basename(path).endsWith('.lock') })
    first.sessionController.cancel({ sessionId: id })
    await agent.whenIdle()
    await first.fiber.dispose()
    first = undefined
    const recovered = new MockAdapter([textResponse('RECOVERED_FINAL_RESPONSE')])
    await restoreCrashBytes(home, capturedHome)
    second = await boot(recovered, ctx => { ctx.tools.register(defineContentToolFixture({ name: 'trusted_read', description: 'read-only fixture', hostEffect: 'read-only', parameters: {}, async execute() { return [{ type: 'text', text: 'safe content' }] } })) }, home)
    await second.sessionController.retry(request)
    const resumed = second.agents.get(id)!
    await resumed.whenIdle()
    expect(recovered.requests).toHaveLength(1)
    expect(resumed.session.deriveMessages().some(message => message.role === 'assistant' && message.content.some(block => block.type === 'text' && block.text === 'RECOVERED_FINAL_RESPONSE'))).toBe(true)
    expect(resumed.session.snapshotEvents().filter(event => event.type === 'session/active-branch')).toHaveLength(1)
  } finally {
    await first?.fiber.dispose()
    await second?.fiber.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
    await rm(capturedHome, { recursive: true, force: true })
  }
})

it('does not repeat a completed durable model response when the process stops before turn bookkeeping finishes', async () => {
  const previousHome = process.env.DSH_HOME
  const home = await mkdtemp(join(tmpdir(), 'thread-result-source-'))
  const capturedHome = await mkdtemp(join(tmpdir(), 'thread-result-crash-'))
  let first: Awaited<ReturnType<typeof boot>> | undefined
  let second: Awaited<ReturnType<typeof boot>> | undefined
  try {
    first = await boot(new MockAdapter([textResponse('INITIAL_DONE'), textResponse('DURABLE_FINAL_RESPONSE')]), () => {}, home)
    const id = SessionId('recovery-result-before-bookkeeping')
    await first.sessionController.create({ kind: 'free', sessionId: id })
    const agent = first.agents.get(id)!
    await first.sessionController.prompt({ requestId: brandString('initial'), sessionId: id, mode: 'queue', content: [{ type: 'text', text: 'ORIGINAL_PROMPT' }] }, new AbortController().signal)
    await agent.whenIdle()
    const anchor = agent.session.snapshotEvents().find(event => event.type === 'user/message' && event.data.source.kind === 'user')!
    if (anchor.type !== 'user/message') throw new Error('No anchor')
    const preview = await first.sessionController.previewRetry({ sessionId: id, messageId: anchor.data.id })
    const request = { sessionId: id, messageId: anchor.data.id, expectedRevision: preview.branchRevision, expectedInputRevision: preview.inputRevision, requestId: 'completed-result-retry', text: 'REPLACEMENT_PROMPT' }
    let reached!: () => void
    const stopping = new Promise<void>(resolve => { reached = resolve })
    const stop = first.on('agent/turn-stopping', async ({ agent: subject, signal }) => {
      if (subject !== agent) return
      reached()
      await new Promise<void>((_resolve, reject) => { if (signal.aborted) { reject(signal.reason); return }; signal.addEventListener('abort', () => reject(signal.reason), { once: true }) })
    })
    await first.sessionController.retry(request)
    await stopping
    await first.sessions.flush(agent.session)
    await cp(home, capturedHome, { recursive: true, filter: path => !basename(path).endsWith('.lock') })
    first.sessionController.cancel({ sessionId: id })
    await agent.whenIdle()
    stop()
    await first.fiber.dispose()
    first = undefined
    const recovered = new MockAdapter([textResponse('MUST_NOT_RUN_AGAIN')])
    await restoreCrashBytes(home, capturedHome)
    second = await boot(recovered, () => {}, home)
    await second.sessionController.retry(request)
    const resumed = second.agents.get(id)!
    await resumed.whenIdle()
    expect(recovered.requests).toHaveLength(0)
    expect(resumed.session.snapshotEvents().filter(event => event.type === 'session/active-branch')).toHaveLength(1)
    expect(resumed.session.deriveMessages().filter(message => message.role === 'assistant' && message.content.some(block => block.type === 'text' && block.text === 'DURABLE_FINAL_RESPONSE'))).toHaveLength(1)
  } finally {
    await first?.fiber.dispose()
    await second?.fiber.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
    await rm(capturedHome, { recursive: true, force: true })
  }
})
