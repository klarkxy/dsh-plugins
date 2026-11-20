import { describe, expect, it, vi } from 'vitest'
import { QuickReviewService, type AgentLike, type SessionEventLike, type SessionLike } from './service.ts'
import type { ReviewScope } from './contracts.ts'
import { handleRpc } from './index.ts'

function ev(type: string, seq: number, data: unknown): SessionEventLike {
  return { type, seq, data } as SessionEventLike
}

function makeSession(id: string, cwd = 'D:/repo'): SessionLike {
  return { id, header: { cwd } }
}

interface Fixture {
  calls: string[]
  service: QuickReviewService
  controller: {
    create: ReturnType<typeof vi.fn>
    rename: ReturnType<typeof vi.fn>
    prompt: ReturnType<typeof vi.fn>
    selectModel: ReturnType<typeof vi.fn>
    resolveAgent: (id: string) => Promise<{ agent?: AgentLike; error?: { code: string; message: string } }>
  }
  agents: Map<string, AgentLike>
  presets: { set: ReturnType<typeof vi.fn>; optionOf: ReturnType<typeof vi.fn> }
  defaultModel: { currentSelection: ReturnType<typeof vi.fn>; saveSelection: ReturnType<typeof vi.fn> }
  summaries: Map<string, { files: { display?: string; path?: string }[] }>
  followups: { message: unknown }[]
  /** Live event-log contents per session, served by the fake sessionQuery. */
  events: Map<string, SessionEventLike[]>
}

function makeFixture(options: {
  sourceEvents?: SessionEventLike[]
  summaries?: Map<string, { files: { display?: string; path?: string }[] }>
  workspaces?: { id: string; sessionIds: string[] }[]
  storedModel?: { provider: string; model: string }
  withWorkspaceChanges?: boolean
  withPresets?: boolean
} = {}): Fixture {
  const calls: string[] = []
  const agents = new Map<string, AgentLike>()
  const followups: { message: unknown }[] = []
  const events = new Map<string, SessionEventLike[]>([
    ['source-1', options.sourceEvents ?? []],
    ['review-1', []],
  ])
  const sourceSession = makeSession('source-1')
  const reviewSession = makeSession('review-1')
  agents.set('source-1', { id: 'source-1', session: sourceSession, followup: (message: unknown) => { calls.push('followup'); followups.push({ message }) } })
  const reviewAgent: AgentLike = {
    id: 'review-1',
    session: reviewSession,
    model: { select: (selection: unknown) => { calls.push(`model.select:${JSON.stringify(selection)}`) } },
  }
  agents.set('review-1', reviewAgent)
  let created = 0
  const controller = {
    create: vi.fn(async () => { calls.push('create'); return { sessionId: `review-${++created}` } }),
    rename: vi.fn(async () => { calls.push('rename'); return { title: 't', seq: 1 } }),
    prompt: vi.fn(async () => { calls.push('prompt'); return { accepted: true } }),
    selectModel: vi.fn(async () => { calls.push('selectModel'); return {} }),
    resolveAgent: async (id: string) => {
      const agent = agents.get(id)
      return agent === undefined ? { error: { code: 'session/not-found', message: 'gone' } } : { agent }
    },
  }
  const presets = {
    set: vi.fn((session: SessionLike, name: string) => { calls.push(`preset:${name}:${session.id}`) }),
    optionOf: vi.fn((name: string) => {
      if (name !== 'read-only') throw new Error(`unknown preset "${name}"`)
      return { value: name }
    }),
  }
  const defaultModel = {
    currentSelection: vi.fn(() => ({ provider: 'deepseek', model: 'deepseek-chat' })),
    saveSelection: vi.fn(async () => {}),
  }
  const summaries = options.summaries ?? new Map()
  const service = new QuickReviewService({
    plugin: 'test',
    sessionController: controller,
    sessionQuery: {
      observeSession: async (sessionId: string) => {
        const log = events.get(sessionId)
        if (log === undefined) throw Object.assign(new Error(`session "${sessionId}" not found`), { code: 'SESSION_QUERY_SESSION_NOT_FOUND' })
        return { events: log, [Symbol.dispose]: () => {} }
      },
    },
    llm: { resolveCallConfig: async () => { calls.push('resolveCallConfig'); return {} } },
    ...(options.withWorkspaceChanges === false ? {} : {
      workspaceChanges: () => ({
        summary: (sessionId: string, seq: number) => { calls.push(`summary:${sessionId}:${seq}`); return summaries.get(`${sessionId}:${seq}`) },
      }),
    }),
    workspaceRegistry: () => ({ list: () => options.workspaces ?? [] }),
    ...(options.withPresets === false ? {} : { permissionPresets: () => presets }),
    agentDefaultModel: () => defaultModel,
    sessionTitle: () => ({ get: () => ({ title: 'Fix bug' }) }),
    settings: {
      load: async () => ({ revision: 0, model: options.storedModel ?? { provider: '', model: '' } }),
      save: async () => {},
    },
    ids: () => 'req-1',
  })
  return { calls, service, controller, agents, presets, defaultModel, summaries, followups, events }
}

const start = (f: Fixture, extra: Record<string, unknown> = {}) =>
  f.service.start({ sourceSessionId: 'source-1', ...extra }, new AbortController().signal)

describe('scope', () => {
  it('unions file paths across every recorded workspace/changes event, path over display', async () => {
    const f = makeFixture({
      sourceEvents: [ev('workspace/changes', 3, { turn: 1 }), ev('workspace/changes', 7, { turn: 2 }), ev('user/message', 8, {})],
      summaries: new Map([
        ['source-1:3', { files: [{ display: '~/a.ts', path: 'src/a.ts' }, { display: 'src/hidden.ts' }] }],
        ['source-1:7', { files: [{ path: 'src/b.ts' }, { display: '~/a.ts', path: 'src/a.ts' }] }],
      ]),
    })
    const scope = await f.service.scope('source-1', new AbortController().signal)
    expect(scope).toEqual({ kind: 'session', files: ['src/a.ts', 'src/b.ts', 'src/hidden.ts'] })
  })

  it('falls back to the workspace when no summary survives', async () => {
    const f = makeFixture({ sourceEvents: [ev('workspace/changes', 3, { turn: 1 })] })
    expect(await f.service.scope('source-1', new AbortController().signal)).toEqual({ kind: 'workspace' })
    const empty = makeFixture({ sourceEvents: [] })
    expect(await empty.service.scope('source-1', new AbortController().signal)).toEqual({ kind: 'workspace' })
    const noService = makeFixture({ withWorkspaceChanges: false })
    expect(await noService.service.scope('source-1', new AbortController().signal)).toEqual({ kind: 'workspace' })
  })
})

describe('start', () => {
  it('creates, selects the model without saving a default, pins read-only, renames, prompts — in order', async () => {
    const f = makeFixture({ workspaces: [{ id: 'ws-1', sessionIds: ['source-1'] }] })
    const value = await start(f, { model: { provider: 'p', model: 'm', reasoningEffort: 'high' } })
    expect(value).toMatchObject({ reviewSessionId: 'review-1', scope: { kind: 'workspace' }, model: { provider: 'p', model: 'm' } })
    expect(f.controller.create).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
    const order = f.calls.filter(c => !c.startsWith('summary'))
    expect(order).toEqual([
      'resolveCallConfig',
      'create',
      'model.select:{"provider":"p","model":"m","reasoningEffort":"high"}',
      'preset:read-only:review-1',
      'rename',
      'prompt',
    ])
    expect(f.controller.selectModel).not.toHaveBeenCalled()
    expect(f.defaultModel.saveSelection).not.toHaveBeenCalled()
    const prompt = f.controller.prompt.mock.calls[0]?.[0] as { content: { text: string }[]; mode: string; sessionId: string }
    expect(prompt.sessionId).toBe('review-1')
    expect(prompt.mode).toBe('queue')
    expect(prompt.content[0]?.text).toContain('git status')
    expect(prompt.content[0]?.text).toContain('source-1')
  })

  it('uses cwd when the source belongs to no workspace and lists session files in the prompt', async () => {
    const f = makeFixture({
      sourceEvents: [ev('workspace/changes', 3, { turn: 1 })],
      summaries: new Map([['source-1:3', { files: [{ display: 'src/a.ts' }] }]]),
    })
    const value = await start(f, { model: { provider: 'p', model: 'm' }, focus: 'concurrency' })
    expect(f.controller.create).toHaveBeenCalledWith({ cwd: 'D:/repo' })
    const prompt = f.controller.prompt.mock.calls[0]?.[0] as { content: { text: string }[] }
    expect(prompt.content[0]?.text).toContain('- "src/a.ts"')
    expect(prompt.content[0]?.text).toContain('concurrency')
    expect(value.scope).toEqual({ kind: 'session', files: ['src/a.ts'] } satisfies ReviewScope)
  })

  it('fails before creating a session when the read-only preset is unavailable', async () => {
    const f = makeFixture({ withPresets: false })
    await expect(start(f, { model: { provider: 'p', model: 'm' } })).rejects.toMatchObject({ code: 'permission-unavailable' })
    expect(f.controller.create).not.toHaveBeenCalled()
    const unknown = makeFixture()
    unknown.presets.optionOf.mockImplementation(() => { throw new Error('unknown preset') })
    await expect(start(unknown, { model: { provider: 'p', model: 'm' } })).rejects.toMatchObject({ code: 'permission-unavailable' })
    expect(unknown.controller.create).not.toHaveBeenCalled()
  })

  it('rejects an unusable model before creating a session — nothing is orphaned', async () => {
    const broken = makeFixture()
    const deps = broken.service as unknown as { deps: { llm: { resolveCallConfig(): Promise<unknown> } } }
    deps.deps.llm = { resolveCallConfig: async () => { throw new Error('no such model') } }
    await expect(start(broken, { model: { provider: 'p', model: 'ghost' } })).rejects.toMatchObject({ code: 'model-unavailable' })
    expect(broken.controller.create).not.toHaveBeenCalled()
    expect(broken.controller.prompt).not.toHaveBeenCalled()
  })

  it('tracks the record before prompt resolves; a prompt failure marks it failed', async () => {
    const f = makeFixture()
    let release!: () => void
    f.controller.prompt.mockImplementation(() => new Promise(resolve => { release = () => resolve({ accepted: true }) }))
    const pending = start(f)
    // Once prompt() is invoked but still in flight, the record is already
    // running — a fast turn/end can never slip past the tracker.
    await vi.waitFor(() => expect(f.controller.prompt).toHaveBeenCalled())
    expect(f.service.status({ reviewSessionId: 'review-1' }).review).toMatchObject({ state: 'running' })
    expect(f.service.status({ sourceSessionId: 'source-1' })).toMatchObject({ review: { state: 'running' } })
    expect(f.service.status({ sourceSessionId: 'source-1' }).isReview).not.toBe(true)
    expect(f.service.status({ reviewSessionId: 'review-1' }).isReview).toBe(true)
    release()
    await pending

    const failing = makeFixture()
    failing.controller.prompt.mockRejectedValue(new Error('prompt rejected'))
    await expect(start(failing)).rejects.toThrow('prompt rejected')
    expect(failing.service.status({ reviewSessionId: 'review-1' }).review).toMatchObject({ state: 'failed', error: 'prompt-failed' })
  })

  it('treats an explicit empty route as the host default, not the stored pick', async () => {
    const f = makeFixture({ storedModel: { provider: 'saved', model: 'route' } })
    await start(f, { model: { provider: '', model: '' } })
    expect(f.calls).toContain('model.select:{"provider":"deepseek","model":"deepseek-chat"}')
    expect(f.calls).not.toContain('model.select:{"provider":"saved","model":"route"}')
  })

  it('fails a created session that cannot be pinned as setup-failed without prompting', async () => {
    const f = makeFixture()
    f.presets.set.mockImplementation(() => { throw new Error('cannot pin read-only') })
    await expect(start(f, { model: { provider: 'p', model: 'm' } })).rejects.toMatchObject({ code: 'setup-failed' })
    expect(f.controller.create).toHaveBeenCalled()
    expect(f.controller.prompt).not.toHaveBeenCalled()
    expect(f.service.status({ reviewSessionId: 'review-1' }).review).toBeUndefined()
  })

  it('evicts the oldest settled records past 50, keeping running ones', async () => {
    const f = makeFixture()
    for (let i = 1; i <= 52; i++) {
      const source = `src-${i}`
      f.agents.set(source, { id: source, session: makeSession(source) })
      f.events.set(source, [])
      if (i > 1) {
        const review = `review-${i}`
        f.agents.set(review, { id: review, session: makeSession(review), model: { select: () => {} } })
      }
    }
    for (let i = 1; i <= 52; i++) {
      await start(f, { sourceSessionId: `src-${i}`, model: { provider: 'p', model: 'm' } })
      if (i === 5) continue // review-5 stays running to prove eviction skips it
      const review = f.agents.get(`review-${i}`)!
      f.service.onSessionEvent(review.session!, ev('turn/end', 1, { turn: 1, reason: { kind: 'aborted' } }))
    }
    expect(f.service.status({ reviewSessionId: 'review-1' }).review).toBeUndefined()
    expect(f.service.status({ reviewSessionId: 'review-2' }).review).toBeUndefined()
    expect(f.service.status({ reviewSessionId: 'review-3' }).review).toMatchObject({ state: 'failed' })
    expect(f.service.status({ reviewSessionId: 'review-5' }).review).toMatchObject({ state: 'running' })
    expect(f.service.status({ reviewSessionId: 'review-52' }).review).toMatchObject({ state: 'failed' })
  })

  it('falls back to the stored pick, then the host default model', async () => {
    const stored = makeFixture({ storedModel: { provider: 'saved', model: 'route' } })
    await start(stored)
    expect(stored.calls).toContain('model.select:{"provider":"saved","model":"route"}')
    const defaulted = makeFixture()
    await start(defaulted)
    expect(defaulted.calls).toContain('model.select:{"provider":"deepseek","model":"deepseek-chat"}')
  })
})

describe('first turn', () => {
  const reviewAnswer: SessionEventLike[] = [
    ev('turn/start', 5, { turn: 1 }),
    ev('assistant/message', 6, { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'verdict: ship it' }] } }),
    ev('turn/end', 7, { turn: 1, reason: { kind: 'completed' } }),
  ]

  async function started(events = reviewAnswer) {
    const f = makeFixture()
    await start(f)
    f.events.set('review-1', events)
    return f
  }

  it('relays the final assistant text once, as an agent-message relay', async () => {
    const f = await started()
    f.service.onSessionEvent(f.agents.get('review-1')!.session!, reviewAnswer[2]!)
    await vi.waitFor(() => expect(f.followups.length).toBe(1))
    const message = f.followups[0]!.message as { content: { text: string }[]; source: unknown; role: string }
    expect(message.role).toBe('user')
    expect(message.source).toEqual({ kind: 'agent-message', form: 'relay', senderSessionId: 'review-1' })
    expect(message.content[0]?.text).toContain('verdict: ship it')
    expect(message.content[0]?.text).toContain('review-1')
    // Only the first turn/end auto-sends.
    f.service.onSessionEvent(f.agents.get('review-1')!.session!, ev('turn/end', 9, { turn: 2, reason: { kind: 'completed' } }))
    await Promise.resolve()
    expect(f.followups.length).toBe(1)
    expect(f.service.status({ reviewSessionId: 'review-1' }).review?.state).toBe('sent')
  })

  it('does not send on abort or error — records a failure instead', async () => {
    const f = await started()
    const review = f.agents.get('review-1')!.session!
    f.service.onSessionEvent(review, ev('turn/end', 7, { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } }))
    f.service.onSessionEvent(review, ev('turn/end', 8, { turn: 2, reason: { kind: 'completed' } }))
    await Promise.resolve()
    expect(f.followups.length).toBe(0)
    expect(f.service.status({ reviewSessionId: 'review-1' }).review).toMatchObject({ state: 'failed', error: 'turn-aborted' })
  })

  it('does not send an empty answer', async () => {
    const f = await started([ev('turn/end', 7, { turn: 1, reason: { kind: 'completed' } })])
    f.service.onSessionEvent(f.agents.get('review-1')!.session!, ev('turn/end', 7, { turn: 1, reason: { kind: 'completed' } }))
    await vi.waitFor(() => expect(f.service.status({ reviewSessionId: 'review-1' }).review?.error).toBe('empty-response'))
    expect(f.followups.length).toBe(0)
  })

  it('resend delivers the latest assistant text again', async () => {
    const f = await started()
    await f.service.resend('review-1', new AbortController().signal)
    expect(f.followups.length).toBe(1)
    await expect(f.service.resend('missing', new AbortController().signal)).rejects.toMatchObject({ code: 'not-found' })
  })
})

describe('rpc', () => {
  it('rejects a second running review and answers status/settings', async () => {
    const f = makeFixture()
    const signal = new AbortController().signal
    await start(f)
    await expect(start(f)).rejects.toMatchObject({ code: 'busy' })
    const status = await handleRpc(f.service, 'status', { sourceSessionId: 'source-1' }, signal)
    expect(status).toMatchObject({ ok: true, value: { review: { reviewSessionId: 'review-1', state: 'running' } } })
    const settings = await handleRpc(f.service, 'settings', {}, signal)
    expect(settings).toEqual({ ok: true, value: { revision: 0, model: { provider: '', model: '' } } })
    const updated = await handleRpc(f.service, 'settings.update', { settings: { model: { provider: 'a', model: 'b' } }, expectedRevision: 0 }, signal)
    expect(updated).toEqual({ ok: true, value: { revision: 1, model: { provider: 'a', model: 'b' } } })
    const stale = await handleRpc(f.service, 'settings.update', { settings: { model: { provider: 'a', model: 'b' } }, expectedRevision: 0 }, signal)
    expect(stale).toMatchObject({ ok: false, error: { code: 'stale' } })
    const bad = await handleRpc(f.service, 'start', {}, signal)
    expect(bad).toMatchObject({ ok: false, error: { code: 'bad-request' } })
  })
})
