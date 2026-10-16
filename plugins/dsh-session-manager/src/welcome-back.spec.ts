import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Sessions, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import Query from '@deepseek-ai/dsh-session-query'
import { MessageId } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveConfig, type ResolvedConfig } from './contracts.ts'
import { PresenceSettingsStore } from './presence-settings.ts'
import {
  activeEventsOf,
  buildRecapMaterial,
  compactSession,
  createSuggestionCache,
  lastResponseTime,
  prepareWelcomeBack,
  PresenceError,
  suggestContinuation,
  type PresenceModelHost,
  type PresenceServices,
} from './welcome-back.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function fixture(config: Partial<Parameters<typeof resolveConfig>[0]> = {}, id = 'presence') {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Sessions); await ctx.plugin(Query, [])
  const session = ctx.sessions.create(SessionId(id), { meta: { cwd: resolve('fixture') } })
  return { ctx, session, config: resolveConfig(config) }
}

function request(session: Session, text: string) {
  return session.append('user/message', { id: MessageId(`u${session.snapshotEvents().length}`), role: 'user', source: { kind: 'user' } as never,
    content: [{ type: 'text', text }] }, { surfaceOp: 'append' })
}
function response(session: Session, turn: number, text: string) {
  return session.append('assistant/message', { turn, step: 1, stream: [],
    message: { id: MessageId(`a${turn}`), role: 'assistant', source: { kind: 'model', provider: 'fixture', model: 'fixture' },
      content: [{ type: 'text', text }] } }, { surfaceOp: 'append' })
}
function finish(session: Session, turn: number) {
  return session.append('turn/end', { turn, reason: { kind: 'completed' } } as never)
}
function conversation(session: Session) {
  session.append('turn/start', { turn: 1 })
  request(session, 'Repair the menu')
  response(session, 1, 'Menu repaired; restart pending.')
  finish(session, 1)
}

/** Model stub in the handoff.spec.ts shape: resolveFeatureModel falls back to agentDefaultModel. */
function models(
  text: string,
  saved?: () => { provider: string; model: string; reasoningEffort?: string } | null,
): PresenceModelHost & { prepareCall: ReturnType<typeof vi.fn> } {
  const prepareCall = vi.fn(async (config: Record<string, unknown>, _signal: AbortSignal) => ({
    config: { ...config, model: 'resolved-model' },
    stream: async function* () {
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }))
  return {
    prepareCall,
    host: { llm: { prepareCall }, agentDefaultModel: { currentSelection: () => ({ provider: 'fixture', model: 'requested-model' }) } },
    ...(saved ? { saved } : {}),
    signal: new AbortController().signal,
  }
}

function services(ctx: Context, patch: Partial<PresenceServices> = {}): PresenceServices {
  return { sessionQuery: ctx.sessionQuery, ...patch }
}

const MIN = 60_000

describe('welcome-back preparation', () => {
  it('stays silent below the recap threshold and when both features are disabled', async () => {
    const { ctx, session, config } = await fixture()
    conversation(session)
    const last = session.snapshotEvents().at(-1)!.time
    const quiet = await prepareWelcomeBack(services(ctx), config, undefined, { sessionId: session.id },
      new AbortController().signal, () => last + 5 * MIN)
    expect(quiet).toEqual({ show: false })
    const disabled = resolveConfig({ recapMinutes: 0, compactMinutes: 0 })
    const off = await prepareWelcomeBack(services(ctx), disabled, undefined, { sessionId: session.id },
      new AbortController().signal, () => last + 500 * MIN)
    expect(off).toEqual({ show: false })
  })

  it('shows a model recap past the recap threshold without a compact suggestion', async () => {
    const { ctx, session, config } = await fixture()
    conversation(session)
    const last = session.snapshotEvents().at(-1)!.time
    const stub = models(JSON.stringify({ summary: '修复菜单', progress: '已改完待重启', nextStep: '重启验证' }))
    const value = await prepareWelcomeBack(services(ctx), config, stub, { sessionId: session.id },
      new AbortController().signal, () => last + 20 * MIN)
    expect(value).toMatchObject({
      show: true, sessionId: session.id, lastResponseAt: last, idleMinutes: 20,
      recap: { summary: '修复菜单', progress: '已改完待重启', nextStep: '重启验证' },
      compactSuggested: false, compactAvailable: false, compactMinutes: 60,
    })
    expect(stub.prepareCall).toHaveBeenCalledOnce()
  })

  it('prepares the recap with the saved plugin route instead of the host default', async () => {
    const { ctx, session, config } = await fixture()
    conversation(session)
    const last = session.snapshotEvents().at(-1)!.time
    const stub = models(JSON.stringify({ summary: 's', progress: '', nextStep: '' }),
      () => ({ provider: 'saved-provider', model: 'saved-model', reasoningEffort: 'low' }))
    const value = await prepareWelcomeBack(services(ctx), config, stub, { sessionId: session.id },
      new AbortController().signal, () => last + 20 * MIN)
    expect(value).toMatchObject({ show: true, recap: { summary: 's' } })
    expect(stub.prepareCall).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'saved-provider', model: 'saved-model', reasoningEffort: expect.anything() }),
      expect.anything())
  })

  it('hides the dialog when the recap model fails and no compact suggestion applies', async () => {
    const { ctx, session, config } = await fixture()
    conversation(session)
    const last = session.snapshotEvents().at(-1)!.time
    const broken = models('unused')
    broken.prepareCall.mockRejectedValueOnce(new Error('provider failed'))
    const value = await prepareWelcomeBack(services(ctx), config, broken, { sessionId: session.id },
      new AbortController().signal, () => last + 20 * MIN)
    expect(value).toEqual({ show: false })
  })

  it('accepts fenced recap JSON and skips the model call for an already-answered activity mark', async () => {
    const { ctx, session, config } = await fixture()
    conversation(session)
    const last = session.snapshotEvents().at(-1)!.time
    const stub = models('```json\n{"summary":"修复菜单","progress":"已改完","nextStep":""}\n```')
    const fenced = await prepareWelcomeBack(services(ctx), config, stub, { sessionId: session.id },
      new AbortController().signal, () => last + 20 * MIN)
    expect(fenced).toMatchObject({ show: true, recap: { summary: '修复菜单', progress: '已改完', nextStep: '' } })
    // A dismissed dialog re-asks with knownLastResponseAt and never re-calls the model.
    const quiet = await prepareWelcomeBack(services(ctx), config, stub,
      { sessionId: session.id, knownLastResponseAt: last }, new AbortController().signal, () => last + 20 * MIN)
    expect(quiet).toEqual({ show: false })
    expect(stub.prepareCall).toHaveBeenCalledOnce()
  })

  it('still shows the dialog for a compact suggestion when the recap model fails', async () => {
    const { ctx, session, config } = await fixture()
    conversation(session)
    const last = session.snapshotEvents().at(-1)!.time
    const broken = models('bad json')
    const value = await prepareWelcomeBack(
      services(ctx, {
        sessionController: { resolveAgent: vi.fn() },
        compaction: { compactNow: vi.fn() },
      }),
      config, broken, { sessionId: session.id }, new AbortController().signal, () => last + 90 * MIN)
    expect(value).toMatchObject({ show: true, recap: null, compactSuggested: true, compactAvailable: true, compactMinutes: 60 })
  })

  it('offers context choices even when root compaction is absent and recap generation fails', async () => {
    const { ctx, session, config } = await fixture()
    conversation(session)
    const last = session.snapshotEvents().at(-1)!.time
    const value = await prepareWelcomeBack(services(ctx), config, undefined,
      { sessionId: session.id }, new AbortController().signal, () => last + 90 * MIN)
    expect(value).toMatchObject({ show: true, recap: null, compactSuggested: true, compactAvailable: false })
  })

  it('never interrupts a running session or a delegated child session', async () => {
    const { ctx, session, config } = await fixture()
    conversation(session)
    const last = session.snapshotEvents().at(-1)!.time
    const running = await prepareWelcomeBack(
      services(ctx, { agents: { get: () => ({ status: 'running' }) } }),
      config, undefined, { sessionId: session.id }, new AbortController().signal, () => last + 90 * MIN)
    expect(running).toEqual({ show: false })
    const child = ctx.sessions.create(SessionId('presence-child'), {
      meta: { cwd: resolve('fixture'), origin: 'subagent', delegationDepth: 1, parentSession: session.id },
    })
    child.append('turn/start', { turn: 1 })
    request(child, 'Delegated task')
    const childValue = await prepareWelcomeBack(services(ctx), config, undefined, { sessionId: child.id },
      new AbortController().signal, () => last + 90 * MIN)
    expect(childValue).toEqual({ show: false })
  })

  it('rejects invalid requests and empty sessions', async () => {
    const { ctx, session, config } = await fixture()
    await expect(prepareWelcomeBack(services(ctx), config, undefined, { sessionId: '' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'session-manager/invalid-request' })
    expect(await prepareWelcomeBack(services(ctx), config, undefined, { sessionId: session.id }, new AbortController().signal))
      .toEqual({ show: false })
  })
})

describe('manual compaction', () => {
  const compactRequest = { sessionId: 'presence', requestId: '40a2f2d0-9f3b-4b9e-bd2b-45346188bb31' }

  it('fails closed without host services and validates the request shape', async () => {
    const { ctx } = await fixture()
    await expect(compactSession(services(ctx), compactRequest, new AbortController().signal))
      .rejects.toMatchObject({ code: 'session-manager/unavailable' })
    await expect(compactSession(services(ctx), { sessionId: 'presence', requestId: 'not-a-uuid' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'session-manager/invalid-request' })
  })

  it('maps busy, empty and successful compactions', async () => {
    const { ctx } = await fixture()
    const signal = new AbortController().signal
    const busyResolve: PresenceServices = services(ctx, {
      sessionController: { resolveAgent: vi.fn(async () => ({ error: { code: 'session/agent-busy' } })) },
      compaction: { compactNow: vi.fn() },
    })
    expect(await compactSession(busyResolve, compactRequest, signal)).toEqual({ compacted: false, reason: 'busy' })
    const agent = { fake: true }
    const nothing: PresenceServices = services(ctx, {
      sessionController: { resolveAgent: vi.fn(async () => ({ agent })) },
      compaction: { compactNow: vi.fn(async () => null) },
    })
    expect(await compactSession(nothing, compactRequest, signal)).toEqual({ compacted: false, reason: 'nothing' })
    const compactNow = vi.fn(async () => ({ shadowedTokenCount: 12_345 }))
    const worked: PresenceServices = services(ctx, {
      sessionController: { resolveAgent: vi.fn(async () => ({ agent })) },
      compaction: { compactNow },
    })
    expect(await compactSession(worked, compactRequest, signal)).toEqual({ compacted: true, shadowedTokens: 12_345 })
    expect(compactNow).toHaveBeenCalledWith(agent, signal)
    const locked: PresenceServices = services(ctx, {
      sessionController: { resolveAgent: vi.fn(async () => ({ agent })) },
      compaction: { compactNow: vi.fn(async () => {
        const error = new Error('another compaction is active') as Error & { code: string }
        error.name = 'ManualCompactionError'; error.code = 'busy'
        throw error
      }) },
    })
    expect(await compactSession(locked, compactRequest, signal)).toEqual({ compacted: false, reason: 'busy' })
  })

  it('wraps unexpected compaction failures with the backend class as the reason', async () => {
    const { ctx } = await fixture()
    const failing: PresenceServices = services(ctx, {
      sessionController: { resolveAgent: vi.fn(async () => ({ agent: {} })) },
      compaction: { compactNow: vi.fn(async () => {
        const error = new Error('summary failed') as Error & { code: string }
        error.name = 'ManualCompactionError'; error.code = 'summary'
        throw error
      }) },
    })
    await expect(compactSession(failing, compactRequest, new AbortController().signal))
      .rejects.toMatchObject({ code: 'session-manager/compact-failed', message: 'summary' })
  })
})

describe('ghost continuation suggestions', () => {
  it.each(['request', 'model'])('propagates %s cancellation without caching null and retries the same sequence', async cancelledBy => {
    const { ctx, session } = await fixture()
    conversation(session)
    const cache = createSuggestionCache()
    const config = resolveConfig({ continueMode: 'auto' })
    const stub = models('Retry the verification')
    const original = stub.prepareCall.getMockImplementation()!
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    stub.prepareCall.mockImplementationOnce(async (...args) => {
      await pending
      return original(...args)
    })
    const request = new AbortController()
    const owner = new AbortController()
    const remember = vi.fn(async () => {})
    const bound = { ...stub, signal: owner.signal, rememberSuggestion: remember }
    const first = suggestContinuation(services(ctx), config, bound, cache, { sessionId: session.id }, request.signal)
    await vi.waitFor(() => expect(stub.prepareCall).toHaveBeenCalledOnce())
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    ;(cancelledBy === 'request' ? request : owner).abort()
    release()
    await rejected
    expect(remember).not.toHaveBeenCalled()
    const seq = session.snapshotEvents().at(-1)!.seq
    expect(cache.read(`${session.id}:${seq}`)).toBeUndefined()
    const retry = await suggestContinuation(services(ctx), config, stub, cache, { sessionId: session.id }, new AbortController().signal)
    expect(retry).toEqual({ text: 'Retry the verification', seq })
    expect(stub.prepareCall).toHaveBeenCalledTimes(2)
  })

  it('checks cancellation inside queued persistence and leaves that cut retryable', async () => {
    const { ctx, session } = await fixture()
    conversation(session)
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const put = vi.fn(async () => { if (put.mock.calls.length === 1) await pending })
    const store = new PresenceSettingsStore({
      table: () => ({ get: () => undefined, entries: () => [][Symbol.iterator](), put }),
      close: async () => {},
    })
    const blocking = store.write(null)
    const controller = new AbortController()
    const stub = models('Retry after cancellation')
    const remember = vi.fn((id: string, seq: number, text: string | null, signal?: AbortSignal) =>
      store.rememberSuggestion(id, seq, text, signal))
    const cache = createSuggestionCache()
    const config = resolveConfig({ continueMode: 'auto' })
    const first = suggestContinuation(services(ctx), config, { ...stub, rememberSuggestion: remember },
      cache, { sessionId: session.id }, controller.signal)
    await vi.waitFor(() => expect(remember).toHaveBeenCalledOnce())
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    release()
    await blocking
    await rejected
    expect(store.suggestion(session.id)).toBeUndefined()
    expect(put).toHaveBeenCalledTimes(1)
    await suggestContinuation(services(ctx), config, { ...stub, rememberSuggestion: remember },
      cache, { sessionId: session.id }, new AbortController().signal)
    expect(stub.prepareCall).toHaveBeenCalledTimes(2)
    expect(store.suggestion(session.id)?.text).toBe('Retry after cancellation')
  })

  it('propagates a model AbortError but still settles ordinary failures as cached null', async () => {
    const { ctx, session } = await fixture()
    conversation(session)
    const stub = models('unused')
    const cache = createSuggestionCache()
    const config = resolveConfig({ continueMode: 'auto' })
    const signal = new AbortController().signal
    stub.prepareCall.mockRejectedValueOnce(new DOMException('model cancelled', 'AbortError'))
    await expect(suggestContinuation(services(ctx), config, stub, cache, { sessionId: session.id }, signal))
      .rejects.toMatchObject({ name: 'AbortError' })
    stub.prepareCall.mockRejectedValueOnce(new Error('model failed'))
    const remember = vi.fn(async () => {})
    const first = await suggestContinuation(services(ctx), config, { ...stub, rememberSuggestion: remember },
      cache, { sessionId: session.id }, signal)
    expect(first.text).toBeNull()
    expect(remember).toHaveBeenCalledWith(session.id, first.seq, null, expect.any(AbortSignal))
    expect(await suggestContinuation(services(ctx), config, stub, cache, { sessionId: session.id }, signal)).toEqual(first)
    expect(stub.prepareCall).toHaveBeenCalledTimes(2)
  })

  it('uses fixed text only in fixed mode, even when a model line was configured', async () => {
    const { ctx, session } = await fixture({ continueText: '接着修复菜单', continueMode: 'auto' })
    conversation(session)
    const cache = createSuggestionCache()
    const fixed = await suggestContinuation(services(ctx), resolveConfig({ continueText: '接着修复菜单' }), undefined,
      cache, { sessionId: session.id }, new AbortController().signal)
    expect(fixed).toEqual({ text: '接着修复菜单' })
    const plain = await suggestContinuation(services(ctx), resolveConfig(), undefined,
      cache, { sessionId: session.id }, new AbortController().signal)
    expect(plain).toEqual({ text: null })
  })

  it('generates once after a turn ends and reuses the line stored for that session', async () => {
    const { ctx, session } = await fixture()
    conversation(session)
    const seq = session.snapshotEvents().at(-1)!.seq
    const remembered: { seq?: number; text?: string | null } = {}
    const stub = models('继续处理重启验证')
    stub.rememberSuggestion = async (_sessionId, nextSeq, text) => { remembered.seq = nextSeq; remembered.text = text }
    stub.suggestion = () => remembered.seq === undefined ? undefined : { seq: remembered.seq, text: remembered.text ?? null }
    const cache = createSuggestionCache()
    const config = resolveConfig({ continueMode: 'auto', continueText: '固定文本不再生效' })
    const signal = new AbortController().signal
    const first = await suggestContinuation(services(ctx), config, stub, cache, { sessionId: session.id }, signal)
    expect(first).toEqual({ text: '继续处理重启验证', seq })
    cache.clear()
    const second = await suggestContinuation(services(ctx), config, stub, cache, { sessionId: session.id }, signal)
    expect(second).toEqual({ text: '继续处理重启验证', seq })
    expect(stub.prepareCall).toHaveBeenCalledOnce()
    expect(remembered).toEqual({ seq, text: '继续处理重启验证' })
  })

  it('does not call the model before the first turn ends or while the client already holds that cut', async () => {
    const { ctx, session } = await fixture()
    const stub = models('继续')
    const cache = createSuggestionCache()
    const config = resolveConfig({ continueMode: 'auto' })
    const signal = new AbortController().signal
    session.append('turn/start', { turn: 1 })
    request(session, 'Repair the menu')
    expect(await suggestContinuation(services(ctx), config, stub, cache, { sessionId: session.id }, signal))
      .toEqual({ text: null })
    conversation(session)
    const seq = session.snapshotEvents().at(-1)!.seq
    expect(await suggestContinuation(services(ctx), config, stub, cache, { sessionId: session.id, knownSeq: seq }, signal))
      .toEqual({ text: null, seq })
    expect(stub.prepareCall).not.toHaveBeenCalled()
  })

  it('never suggests inside empty or delegated sessions', async () => {
    const { ctx, session } = await fixture()
    const stub = models('继续')
    const cache = createSuggestionCache()
    const config = resolveConfig({ continueMode: 'auto' })
    const signal = new AbortController().signal
    expect(await suggestContinuation(services(ctx), config, stub, cache, { sessionId: session.id }, signal))
      .toEqual({ text: null })
    conversation(session)
    const child = ctx.sessions.create(SessionId('suggest-child'), {
      meta: { cwd: resolve('fixture'), origin: 'subagent', delegationDepth: 1, parentSession: session.id },
    })
    child.append('turn/start', { turn: 1 })
    expect(await suggestContinuation(services(ctx), config, stub, cache, { sessionId: child.id }, signal))
      .toEqual({ text: null })
    expect(stub.prepareCall).not.toHaveBeenCalled()
  })

  it('keeps only the first line of a suggestion and rejects oversized ones', async () => {
    const { ctx, session } = await fixture()
    conversation(session)
    const config = resolveConfig({ continueMode: 'auto' })
    const signal = new AbortController().signal
    const multiline = models('先重启服务\n再验证菜单')
    const seq = session.snapshotEvents().at(-1)!.seq
    expect(await suggestContinuation(services(ctx), config, multiline, createSuggestionCache(), { sessionId: session.id }, signal))
      .toEqual({ text: '先重启服务', seq })
    const long = models('很长的建议'.repeat(40))
    expect(await suggestContinuation(services(ctx), config, long, createSuggestionCache(), { sessionId: session.id }, signal))
      .toEqual({ text: null, seq })
  })
})

describe('activity reading', () => {
  it('prefers the newest response event and caps recap material', async () => {
    const { session } = await fixture()
    conversation(session)
    const events = session.snapshotEvents()
    const last = events.at(-1)!
    expect(lastResponseTime(events, session.header.createdAt)).toBe(last.time)
    const material = buildRecapMaterial(events, session.id, session.inheritedEventCount)
    expect(material).toMatchObject({ turnCount: 1, lastTurnState: 'completed', objective: 'Repair the menu' })
    expect(material?.recentTurns[0]).toMatchObject({ requests: ['Repair the menu'], response: 'Menu repaired; restart pending.' })
    expect(lastResponseTime([], session.header.createdAt)).toBe(session.header.createdAt)
  })

  it('selects the active branch like query.ts branchView and degrades when it is unavailable', async () => {
    const plain = [{ type: 'user/message', seq: 0, time: 1, data: {} }]
    expect(activeEventsOf({ events: plain as never })).toBe(plain)
    const active = [{ type: 'user/message', seq: 5, time: 2, data: {} }]
    const withMarker = [...plain, { type: 'session/active-branch', seq: 1, time: 2, data: {} }]
    // The branch marker event or a positive revision both mean branched.
    expect(activeEventsOf({ events: withMarker as never, activeEvents: active })).toBe(active)
    expect(activeEventsOf({ events: plain as never, branchRevision: 2, activeEvents: active })).toBe(active)
    // Branched but the projection is unavailable: degrade instead of summarizing abandoned branches.
    expect(activeEventsOf({ events: withMarker as never })).toBeUndefined()
    expect(activeEventsOf({ events: plain as never, branchRevision: 1 })).toBeUndefined()
  })

  it('answers show:false for a branched session without an active-branch projection', async () => {
    const { ctx, session, config } = await fixture()
    conversation(session)
    // Simulate the patched-host shape: branched, but the observation lacks activeEvents.
    const query = ctx.sessionQuery
    const original = query.observeSession.bind(query)
    const spied = vi.spyOn(query, 'observeSession').mockImplementation(async (id, options) => {
      const observation = await original(id, options)
      return new Proxy(observation, {
        get(target, key, receiver) {
          if (key === 'events') return [...target.events, { type: 'session/active-branch', seq: 999, time: Date.now(), data: {} }]
          return Reflect.get(target, key, receiver)
        },
      })
    })
    try {
      const value = await prepareWelcomeBack(services(ctx), config, models('unused'), { sessionId: session.id },
        new AbortController().signal, () => Date.now() + 90 * MIN)
      expect(value).toEqual({ show: false })
    } finally {
      spied.mockRestore()
    }
  })
})
