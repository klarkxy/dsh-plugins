import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Sessions, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import Query from '@deepseek-ai/dsh-session-query'
import { MessageId } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveConfig, type ResolvedConfig } from './contracts.ts'
import { PresenceSettingsStore } from './presence-settings.ts'
import { createSharedCalls } from './shared-call.ts'
import { resolveFeatureModel, type FeatureModelRoute } from '@klarkxy/dsh-plugin-kit/llm-call'
import type { ModelRoute } from '@klarkxy/dsh-model-route'
import {
  activeEventsOf,
  buildRecapMaterial,
  compactSession,
  createSuggestionCache,
  lastResponseTime,
  prepareWelcomeBack,
  PresenceError,
  suggestContinuation,
  suggestionFingerprint,
  type PresenceModelHost,
  type PresenceServices,
} from './welcome-back.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

/** Fresh same-material merge runner per call site; shared() mirrors the RPC-owned instance. */
const shared = () => createSharedCalls()

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

interface ModelStubOptions {
  /** Explicit per-feature overrides; a route wins over every default chain. */
  saved?: () => ModelRoute | null
  savedGhost?: () => ModelRoute | null
  savedJudge?: () => ModelRoute | null
  /** Stored ghost-line persistence callbacks (e.g. a real or fake settings store). */
  suggestion?: PresenceModelHost['suggestion']
  rememberSuggestion?: PresenceModelHost['rememberSuggestion']
  /** Shared auxiliary default published on the host's root services. */
  auxModel?: ModelRoute
  /** A failed shared auxiliary store: defaults must degrade, never silently pay the chat model. */
  auxBroken?: boolean
  /** Receives each generated user message (auxiliary-context block + request). */
  onUserText?: (text: string) => void
  /** Receives each prepared model config. */
  onPrepared?: (config: Record<string, unknown>) => void
}

/**
 * Model stub in the handoff.spec.ts shape: resolveFeatureModel falls back to
 * the shared auxiliary default, then agentDefaultModel. The shared service is
 * published on host.root exactly where getAuxiliaryModel reads it.
 */
function stubHost(aux?: ModelRoute) {
  const services = new Map<string, unknown>()
  if (aux !== undefined) {
    services.set('dshAuxiliaryModel', {
      ready: Promise.resolve(),
      snapshot: () => ({ revision: 1, model: aux }),
    })
  }
  return {
    llm: undefined as unknown,
    agentDefaultModel: { currentSelection: () => ({ provider: 'fixture', model: 'requested-model' }) },
    root: {
      get: (name: string) => services.get(name),
      provide: (name: string, value: unknown) => { services.set(name, value); return () => services.delete(name) },
      inject: () => { throw new Error('unexpected root inject') },
    },
  }
}

function models(
  text: string,
  options: ModelStubOptions | (() => ModelRoute | null) = {},
): PresenceModelHost & { prepareCall: ReturnType<typeof vi.fn> } {
  const opts: ModelStubOptions = typeof options === 'function' ? { saved: options } : options
  const host = stubHost(opts.auxModel)
  const prepareCall = vi.fn(async (config: Record<string, unknown>, _signal: AbortSignal, _configure?: unknown) => {
    opts.onPrepared?.(config)
    return {
      config: { ...config, model: 'resolved-model' },
      stream: async function* (generated: { messages?: { content?: { type: string; text?: string }[] }[] }) {
        const userText = (generated.messages ?? [])
          .flatMap(message => message.content ?? [])
          .filter(part => part.type === 'text')
          .map(part => part.text ?? '')
          .join('')
        opts.onUserText?.(userText)
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
  })
  host.llm = { prepareCall }
  return {
    prepareCall,
    host: host as PresenceModelHost['host'],
    ...opts.saved ? { saved: opts.saved } : {},
    ...opts.savedGhost ? { savedGhost: opts.savedGhost } : {},
    ...opts.savedJudge ? { savedJudge: opts.savedJudge } : {},
    ...opts.suggestion ? { suggestion: opts.suggestion } : {},
    ...opts.rememberSuggestion ? { rememberSuggestion: opts.rememberSuggestion } : {},
    ...opts.auxBroken === undefined ? {} : { auxBroken: opts.auxBroken },
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
      expect.anything(), undefined)
  })

  it('routes the recap through the shared auxiliary default with the stable context first', async () => {
    const { ctx, session, config } = await fixture()
    conversation(session)
    const last = session.snapshotEvents().at(-1)!.time
    const prepared: Record<string, unknown>[] = []
    let userText = ''
    const stub = models(JSON.stringify({ summary: 's', progress: '', nextStep: '' }), {
      auxModel: { provider: 'aux-p', model: 'aux-m' },
      onPrepared: config => prepared.push(config),
      onUserText: text => { userText = text },
    })
    const value = await prepareWelcomeBack(services(ctx), config, stub, { sessionId: session.id },
      new AbortController().signal, () => last + 20 * MIN)
    expect(value).toMatchObject({ show: true, recap: { summary: 's' } })
    expect(prepared[0]).toMatchObject({ provider: 'aux-p', model: 'aux-m' })
    const envelope = userText.match(/^<auxiliary-context feature="session-manager\.recap">\n([\s\S]*?)\n<\/auxiliary-context>\n<request>\n([\s\S]*?)\n<\/request>$/)
    expect(envelope).not.toBeNull()
    const context = JSON.parse(envelope![1]!) as Record<string, unknown>
    const requestBody = JSON.parse(envelope![2]!) as Record<string, unknown>
    expect(Object.keys(context).sort()).toEqual(['objective', 'recentTurns'])
    expect(Object.keys(requestBody).sort()).toEqual(['lastTurnState', 'turnCount'])
  })

  it('never bills the host default for a recap once the shared auxiliary store broke', async () => {
    const { ctx, session, config } = await fixture()
    conversation(session)
    const last = session.snapshotEvents().at(-1)!.time
    const broken = models('unused', { auxBroken: true })
    const value = await prepareWelcomeBack(services(ctx), config, broken, { sessionId: session.id },
      new AbortController().signal, () => last + 20 * MIN)
    expect(value).toEqual({ show: false })
    expect(broken.prepareCall).not.toHaveBeenCalled()
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
    const first = suggestContinuation(services(ctx), config, bound, cache, shared(), { sessionId: session.id }, request.signal)
    await vi.waitFor(() => expect(stub.prepareCall).toHaveBeenCalledOnce())
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    ;(cancelledBy === 'request' ? request : owner).abort()
    release()
    await rejected
    expect(remember).not.toHaveBeenCalled()
    const seq = session.snapshotEvents().at(-1)!.seq
    expect(cache.read(`${session.id}:${seq}`)).toBeUndefined()
    const retry = await suggestContinuation(services(ctx), config, stub, cache, shared(), { sessionId: session.id }, new AbortController().signal)
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
    const remember = vi.fn((id: string, seq: number, text: string | null, key: string, signal?: AbortSignal) =>
      store.rememberSuggestion(id, seq, text, key, signal))
    const cache = createSuggestionCache()
    const config = resolveConfig({ continueMode: 'auto' })
    const first = suggestContinuation(services(ctx), config, { ...stub, rememberSuggestion: remember },
      cache, shared(), { sessionId: session.id }, controller.signal)
    await vi.waitFor(() => expect(remember).toHaveBeenCalledOnce())
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    release()
    await blocking
    await rejected
    expect(store.suggestion(session.id)).toBeUndefined()
    expect(put).toHaveBeenCalledTimes(1)
    await suggestContinuation(services(ctx), config, { ...stub, rememberSuggestion: remember },
      cache, shared(), { sessionId: session.id }, new AbortController().signal)
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
    await expect(suggestContinuation(services(ctx), config, stub, cache, shared(), { sessionId: session.id }, signal))
      .rejects.toMatchObject({ name: 'AbortError' })
    stub.prepareCall.mockRejectedValueOnce(new Error('model failed'))
    const remember = vi.fn(async () => {})
    const first = await suggestContinuation(services(ctx), config, { ...stub, rememberSuggestion: remember },
      cache, shared(), { sessionId: session.id }, signal)
    expect(first.text).toBeNull()
    expect(remember).toHaveBeenCalledWith(session.id, first.seq, null, expect.any(String), expect.any(AbortSignal))
    const retry = await suggestContinuation(services(ctx), config, stub, cache, shared(), { sessionId: session.id }, signal)
    expect(retry).toEqual({ text: 'unused', seq: first.seq })
    expect(stub.prepareCall).toHaveBeenCalledTimes(3)
  })

  it('uses fixed text only in fixed mode, even when a model line was configured', async () => {
    const { ctx, session } = await fixture({ continueText: '接着修复菜单', continueMode: 'auto' })
    conversation(session)
    const cache = createSuggestionCache()
    const seq = session.snapshotEvents().at(-1)!.seq
    const fixed = await suggestContinuation(services(ctx), resolveConfig({ continueText: '接着修复菜单' }), undefined,
      cache, shared(), { sessionId: session.id }, new AbortController().signal)
    expect(fixed).toEqual({ text: '接着修复菜单', seq })
    const plain = await suggestContinuation(services(ctx), resolveConfig(), undefined,
      cache, shared(), { sessionId: session.id }, new AbortController().signal)
    expect(plain).toEqual({ text: null, seq, fallback: true })
  })

  it('generates once after a turn ends and reuses the line stored for that session', async () => {
    const { ctx, session } = await fixture()
    conversation(session)
    const seq = session.snapshotEvents().at(-1)!.seq
    const remembered: { seq?: number; text?: string | null; key?: string } = {}
    const stub = models('继续处理重启验证')
    stub.rememberSuggestion = async (_sessionId, nextSeq, text, key) => {
      remembered.seq = nextSeq; remembered.text = text; remembered.key = key
    }
    stub.suggestion = () => remembered.seq === undefined ? undefined
      : { seq: remembered.seq, text: remembered.text ?? null, ...remembered.key === undefined ? {} : { key: remembered.key } }
    const cache = createSuggestionCache()
    const config = resolveConfig({ continueMode: 'auto', continueText: '固定文本不再生效' })
    const signal = new AbortController().signal
    const first = await suggestContinuation(services(ctx), config, stub, cache, shared(), { sessionId: session.id }, signal)
    expect(first).toEqual({ text: '继续处理重启验证', seq })
    cache.clear()
    const second = await suggestContinuation(services(ctx), config, stub, cache, shared(), { sessionId: session.id }, signal)
    expect(second).toEqual({ text: '继续处理重启验证', seq })
    expect(stub.prepareCall).toHaveBeenCalledOnce()
    expect(remembered).toEqual({ seq, text: '继续处理重启验证', key: expect.any(String) })
  })

  it('does not call the model before the first turn ends or while the server already produced that cut', async () => {
    const { ctx, session } = await fixture()
    const stub = models('继续')
    const cache = createSuggestionCache()
    const config = resolveConfig({ continueMode: 'auto' })
    const signal = new AbortController().signal
    session.append('turn/start', { turn: 1 })
    request(session, 'Repair the menu')
    expect(await suggestContinuation(services(ctx), config, stub, cache, shared(), { sessionId: session.id }, signal))
      .toEqual({ text: null, pending: true })
    // A finished, idle session gets one generation even when the client
    // reports holding that cut: seq alone is not a fingerprint match.
    conversation(session)
    const seq = session.snapshotEvents().at(-1)!.seq
    expect(await suggestContinuation(services(ctx), config, stub, cache, shared(), { sessionId: session.id, knownSeq: seq }, signal))
      .toEqual({ text: '继续', seq })
    // Once the produced line is cached under its fingerprint, the same
    // knownSeq re-ask reuses it without another model call.
    expect(await suggestContinuation(services(ctx), config, stub, cache, shared(), { sessionId: session.id, knownSeq: seq }, signal))
      .toEqual({ text: '继续', seq })
    expect(stub.prepareCall).toHaveBeenCalledOnce()
  })

  it('settles a held cut to null only when the server entry for it carries the same fingerprint', async () => {
    const { ctx, session } = await fixture()
    conversation(session)
    const seq = session.snapshotEvents().at(-1)!.seq
    const config = resolveConfig({ continueMode: 'auto' })
    const signal = new AbortController().signal
    // Persisted settled failure: the fingerprint survives on the durable row,
    // so a client still holding this cut gets null instead of another call.
    const material = buildRecapMaterial(session.snapshotEvents(), session.id, session.inheritedEventCount)
    const key = suggestionFingerprint(material, resolveFeatureModel(stubHost(), undefined, session.id))
    const stub = models('unused', { suggestion: () => ({ seq, text: null, key }) })
    expect(await suggestContinuation(services(ctx), config, stub, createSuggestionCache(), shared(),
      { sessionId: session.id, knownSeq: seq }, signal)).toEqual({ text: null, seq })
    expect(stub.prepareCall).not.toHaveBeenCalled()
    // A same-seq row produced under different inputs never suppresses generation.
    const stale = models('再验证一次', { suggestion: () => ({ seq, text: null, key: 'other-fingerprint' }) })
    expect(await suggestContinuation(services(ctx), config, stale, createSuggestionCache(), shared(),
      { sessionId: session.id, knownSeq: seq }, signal)).toEqual({ text: '再验证一次', seq })
    expect(stale.prepareCall).toHaveBeenCalledOnce()
  })

  it('hides the previous line once the next turn starts', async () => {
    const { ctx, session } = await fixture()
    conversation(session)
    session.append('turn/start', { turn: 2 })
    const stub = models('接着验证菜单')
    const result = await suggestContinuation(services(ctx), resolveConfig({ continueMode: 'auto' }), stub,
      createSuggestionCache(), shared(), { sessionId: session.id }, new AbortController().signal)
    expect(result).toEqual({ text: null, pending: true })
    expect(stub.prepareCall).not.toHaveBeenCalled()
  })

  it('never suggests inside empty or delegated sessions', async () => {
    const { ctx, session } = await fixture()
    const stub = models('继续')
    const cache = createSuggestionCache()
    const config = resolveConfig({ continueMode: 'auto' })
    const signal = new AbortController().signal
    expect(await suggestContinuation(services(ctx), config, stub, cache, shared(), { sessionId: session.id }, signal))
      .toEqual({ text: null, pending: true })
    conversation(session)
    const child = ctx.sessions.create(SessionId('suggest-child'), {
      meta: { cwd: resolve('fixture'), origin: 'subagent', delegationDepth: 1, parentSession: session.id },
    })
    child.append('turn/start', { turn: 1 })
    expect(await suggestContinuation(services(ctx), config, stub, cache, shared(), { sessionId: child.id }, signal))
      .toEqual({ text: null })
    expect(stub.prepareCall).not.toHaveBeenCalled()
  })

  it('keeps only the first line and does not reject a long line by character count', async () => {
    const { ctx, session } = await fixture()
    conversation(session)
    const config = resolveConfig({ continueMode: 'auto' })
    const signal = new AbortController().signal
    const multiline = models('先重启服务\n再验证菜单')
    const seq = session.snapshotEvents().at(-1)!.seq
    expect(await suggestContinuation(services(ctx), config, multiline, createSuggestionCache(), shared(), { sessionId: session.id }, signal))
      .toEqual({ text: '先重启服务', seq })
    const long = 'Please continue verifying the menu after restarting the service and report what still fails'
    expect(await suggestContinuation(services(ctx), config, models(long), createSuggestionCache(), shared(), { sessionId: session.id }, signal))
      .toEqual({ text: long, seq })
  })

  it('routes the ghost through explicit override, shared auxiliary default, then the host fallback', async () => {
    const { ctx, session } = await fixture()
    conversation(session)
    const config = resolveConfig({ continueMode: 'auto' })
    const signal = new AbortController().signal
    const seq = session.snapshotEvents().at(-1)!.seq
    const prepared: Record<string, unknown>[] = []
    const explicit = models('显式路线', {
      savedGhost: () => ({ provider: 'ghost-p', model: 'ghost-m', reasoningEffort: 'low' }),
      auxModel: { provider: 'aux-p', model: 'aux-m' },
      onPrepared: config => prepared.push(config),
    })
    expect(await suggestContinuation(services(ctx), config, explicit, createSuggestionCache(), shared(), { sessionId: session.id }, signal))
      .toEqual({ text: '显式路线', seq })
    expect(prepared[0]).toMatchObject({ provider: 'ghost-p', model: 'ghost-m' })

    const auxed = models('辅助模型', {
      auxModel: { provider: 'aux-p', model: 'aux-m' },
      onPrepared: config => prepared.push(config),
    })
    expect(await suggestContinuation(services(ctx), config, auxed, createSuggestionCache(), shared(), { sessionId: session.id }, signal))
      .toEqual({ text: '辅助模型', seq })
    expect(prepared[1]).toMatchObject({ provider: 'aux-p', model: 'aux-m' })

    const fallback = models('宿主默认', { onPrepared: config => prepared.push(config) })
    expect(await suggestContinuation(services(ctx), config, fallback, createSuggestionCache(), shared(), { sessionId: session.id }, signal))
      .toEqual({ text: '宿主默认', seq })
    expect(prepared[2]).toMatchObject({ provider: 'fixture', model: 'requested-model' })
    expect(prepared).toHaveLength(3)
  })

  it('packs the ghost material before the live request under its own feature bucket', async () => {
    const { ctx, session } = await fixture()
    conversation(session)
    let userText = ''
    const stub = models('接着验证', { onUserText: text => { userText = text } })
    await suggestContinuation(services(ctx), resolveConfig({ continueMode: 'auto' }), stub,
      createSuggestionCache(), shared(), { sessionId: session.id }, new AbortController().signal)
    const envelope = userText.match(/^<auxiliary-context feature="session-manager\.ghost">\n([\s\S]*?)\n<\/auxiliary-context>\n<request>\n([\s\S]*?)\n<\/request>$/)
    expect(envelope).not.toBeNull()
    const context = JSON.parse(envelope![1]!) as Record<string, unknown>
    const requestBody = JSON.parse(envelope![2]!) as Record<string, unknown>
    // Stable material only: no dynamic counts, no generated output fields.
    expect(Object.keys(context).sort()).toEqual(['objective', 'recentTurns'])
    expect(context.objective).toBe('Repair the menu')
    expect(Object.keys(requestBody).sort()).toEqual(['lastTurnState', 'turnCount'])
  })

  it('merges identical concurrent generations, keeps waiters independently cancellable and cleans up after the last detach', async () => {
    const { ctx, session } = await fixture()
    conversation(session)
    const config = resolveConfig({ continueMode: 'auto' })
    const runner = shared()
    const cache = createSuggestionCache()
    const seq = session.snapshotEvents().at(-1)!.seq

    let release!: () => void
    let gate = new Promise<void>(done => { release = done })
    // Each generation round gates on its own deferred: the mock reads the
    // current promise so a re-armed gate never releases a later call early.
    const arm = () => { gate = new Promise<void>(done => { release = done }) }
    const stub = models('合并后的继续')
    const original = stub.prepareCall.getMockImplementation()!
    stub.prepareCall.mockImplementation(async (...args) => { await gate; return original(...args) })

    const firstCtl = new AbortController()
    const secondCtl = new AbortController()
    const first = suggestContinuation(services(ctx), config, stub, cache, runner, { sessionId: session.id }, firstCtl.signal)
    await vi.waitFor(() => expect(stub.prepareCall).toHaveBeenCalledOnce())
    // Same session, same cut, same fingerprint: the second caller joins, it does not pay again.
    const second = suggestContinuation(services(ctx), config, stub, cache, runner, { sessionId: session.id }, secondCtl.signal)
    const firstRejected = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    firstCtl.abort()
    await firstRejected
    release()
    // The surviving waiter still receives the shared result; the merged call ran once.
    expect(await second).toEqual({ text: '合并后的继续', seq })
    expect(stub.prepareCall).toHaveBeenCalledOnce()

    // Re-arm the gate: when every waiter detaches the in-flight call is torn
    // down and a later caller starts a fresh generation instead of inheriting
    // the aborted entry.
    arm()
    const thirdCtl = new AbortController()
    const fourthCtl = new AbortController()
    const third = suggestContinuation(services(ctx), config, stub, createSuggestionCache(), runner, { sessionId: session.id }, thirdCtl.signal)
    await vi.waitFor(() => expect(stub.prepareCall).toHaveBeenCalledTimes(2))
    const fourth = suggestContinuation(services(ctx), config, stub, createSuggestionCache(), runner, { sessionId: session.id }, fourthCtl.signal)
    const thirdRejected = expect(third).rejects.toMatchObject({ name: 'AbortError' })
    const fourthRejected = expect(fourth).rejects.toMatchObject({ name: 'AbortError' })
    thirdCtl.abort()
    fourthCtl.abort()
    await Promise.all([thirdRejected, fourthRejected])
    release()
    expect(await suggestContinuation(services(ctx), config, stub, createSuggestionCache(), runner,
      { sessionId: session.id }, new AbortController().signal)).toEqual({ text: '合并后的继续', seq })
    expect(stub.prepareCall).toHaveBeenCalledTimes(3)
  })

  it('regenerates when the stored or cached line was produced for different inputs', async () => {
    const { ctx, session } = await fixture()
    conversation(session)
    const config = resolveConfig({ continueMode: 'auto' })
    const signal = new AbortController().signal
    const seq = session.snapshotEvents().at(-1)!.seq
    const cache = createSuggestionCache()
    const remember = vi.fn(async () => {})
    const first = models('第一版')
    expect(await suggestContinuation(services(ctx), config, first, cache, shared(), { sessionId: session.id }, signal))
      .toEqual({ text: '第一版', seq })
    // A legacy row written before fingerprints existed regenerates instead of
    // being replayed for the new inputs.
    const legacy = models('迁移后的新行', {
      suggestion: () => ({ seq, text: 'seq-only 旧行' }),
      rememberSuggestion: remember,
    })
    expect(await suggestContinuation(services(ctx), config, legacy, createSuggestionCache(), shared(), { sessionId: session.id }, signal))
      .toEqual({ text: '迁移后的新行', seq })
    // A route switch changes the fingerprint, so the cached and persisted line
    // from the first route no longer applies.
    const rerouted = models('换模型', {
      savedGhost: () => ({ provider: 'other-p', model: 'other-m' }),
      suggestion: () => ({ seq, text: '旧模型行', key: 'stale' }),
      rememberSuggestion: remember,
    })
    expect(await suggestContinuation(services(ctx), config, rerouted, cache, shared(), { sessionId: session.id }, signal))
      .toEqual({ text: '换模型', seq })
    expect(rerouted.prepareCall).toHaveBeenCalledOnce()
    // New material (the next ended turn) is a different fingerprint too.
    session.append('turn/start', { turn: 2 })
    request(session, 'Verify the restart')
    response(session, 2, 'Restart verified.')
    finish(session, 2)
    const nextSeq = session.snapshotEvents().at(-1)!.seq
    const reuse = models('新材料', {
      suggestion: () => ({ seq: nextSeq, text: '上个切片的行', key: 'stale' }),
    })
    expect(await suggestContinuation(services(ctx), config, reuse, cache, shared(), { sessionId: session.id }, signal))
      .toEqual({ text: '新材料', seq: nextSeq })
    expect(reuse.prepareCall).toHaveBeenCalledOnce()
    expect(remember).toHaveBeenCalledTimes(2)
  })

  it('degrades without billing the host default once the shared auxiliary store broke, unless a feature override exists', async () => {
    const { ctx, session } = await fixture()
    conversation(session)
    const config = resolveConfig({ continueMode: 'auto' })
    const signal = new AbortController().signal
    const seq = session.snapshotEvents().at(-1)!.seq
    // Broken aux + no explicit route: degrade, never silently pay the chat model.
    const broken = models('unused', { auxBroken: true })
    expect(await suggestContinuation(services(ctx), config, broken, createSuggestionCache(), shared(), { sessionId: session.id }, signal))
      .toEqual({ text: null, seq })
    expect(broken.prepareCall).not.toHaveBeenCalled()
    // An explicit per-feature route still applies: the fallback chain is what is broken.
    const explicit = models('仍可用', {
      auxBroken: true,
      savedGhost: () => ({ provider: 'ghost-p', model: 'ghost-m' }),
    })
    expect(await suggestContinuation(services(ctx), config, explicit, createSuggestionCache(), shared(), { sessionId: session.id }, signal))
      .toEqual({ text: '仍可用', seq })
    expect(explicit.prepareCall).toHaveBeenCalledOnce()
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
