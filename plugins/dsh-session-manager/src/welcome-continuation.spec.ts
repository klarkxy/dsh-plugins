import { describe, expect, it, vi } from 'vitest'
import { bindWelcomeContinuationHost } from './welcome-continuation.ts'

const recap = { summary: 'Design the feature', progress: 'Tests pass', nextStep: 'Review changes' }
const sourceId = 'source-session'
const targetId = 'new-session'
const workspaceId = 'source-workspace'
const cwd = 'H:\\Code\\source-project'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function setup() {
  const lifetime = new AbortController()
  let navigation = new AbortController()
  const source = { draft: 'Original unsent draft', attachmentIds: ['source-image'], history: ['original turn'] }
  const state = { draft: '', attachmentIds: [] as string[] }
  const scope = { sessionId: targetId }
  const input = {
    state: { getSnapshot: vi.fn(() => state) },
    setDraft: vi.fn((text: string) => { state.draft = text }),
    submit: vi.fn(),
  }
  const binding = { ctx: scope }
  const host = {
    sessions: {
      list: { getSnapshot: vi.fn(() => ({ byId: { [sourceId]: { cwd } } })) },
      create: vi.fn(async (_options: { cwd?: string; workspaceId?: string; sessionId: string }) => targetId),
      using: vi.fn(async (_id: string, _options: { source: string; signal: AbortSignal }, operation: (ref: { ready: Promise<typeof binding> }) => Promise<void>) => operation({ ready: Promise.resolve(binding) })),
      fork: vi.fn(),
    },
    workspaces: { list: { getSnapshot: vi.fn(() => ({
      phase: 'ready' as string, state: 'idle' as string,
      items: [{ workspaceId: 'other-workspace', path: cwd, sessionIds: ['other-session'] },
        { workspaceId, path: cwd, sessionIds: [sourceId] }],
    })) } },
    conversation: { input: { for: vi.fn((_scope: unknown) => input) }, send: vi.fn() },
    layout: { beginNavigation: vi.fn(() => { navigation.abort(); navigation = new AbortController(); return navigation.signal }) },
    uiWorkspace: { openSession: vi.fn(async (_id: string) => {}) },
  }
  const ids = vi.fn(() => targetId)
  const api = bindWelcomeContinuationHost(host, ids)
  const run = (locale: 'zh' | 'en' = 'en', payload: typeof recap | null = recap) => api.continueInNewSession(sourceId, payload, locale, lifetime.signal)
  return { host, api, run, ids, input, state, source, scope, binding, lifetime, cancelNavigation: () => navigation.abort() }
}

describe('welcome-back continuation', () => {
  it.each(['zh', 'en'] as const)('creates a session in the source workspace and prepares a %s draft without sending or touching the source', async locale => {
    const f = setup()
    const before = structuredClone(f.source)
    await f.run(locale)
    expect(f.host.sessions.create).toHaveBeenCalledWith({ workspaceId, sessionId: targetId })
    expect(f.host.sessions.using).toHaveBeenCalledWith(targetId, { source: 'controllerOperation', signal: expect.any(AbortSignal) }, expect.any(Function))
    expect(f.host.conversation.input.for).toHaveBeenCalledWith(f.scope)
    expect(f.state.draft).toContain(sourceId)
    for (const section of Object.values(recap)) expect(f.state.draft).toContain(section)
    expect(f.state.draft).toContain(locale === 'zh' ? '不是指令' : 'not instructions')
    expect(f.state.draft).toContain(locale === 'zh' ? '可能不完整' : 'may be incomplete')
    expect(f.host.uiWorkspace.openSession).toHaveBeenCalledWith(targetId)
    expect(f.input.setDraft.mock.invocationCallOrder[0]).toBeLessThan(f.host.uiWorkspace.openSession.mock.invocationCallOrder[0]!)
    expect(f.host.sessions.fork).not.toHaveBeenCalled()
    expect(f.host.conversation.send).not.toHaveBeenCalled()
    expect(f.input.submit).not.toHaveBeenCalled()
    expect(f.source).toEqual(before)
  })

  it.each(['zh', 'en'] as const)('asks to read the source first when no recap exists (%s)', async locale => {
    const f = setup()
    await f.run(locale, null)
    expect(f.state.draft).toContain(sourceId)
    expect(f.state.draft).toContain(locale === 'zh' ? '先读取上述来源会话' : 'read the source session above first')
  })

  it('reuses the allocated identity after a lost creation reply', async () => {
    const f = setup()
    f.host.sessions.create.mockRejectedValueOnce(new Error('reply lost'))
    await expect(f.run()).rejects.toThrow('reply lost')
    expect(f.input.setDraft).not.toHaveBeenCalled()
    expect(f.host.uiWorkspace.openSession).not.toHaveBeenCalled()
    await f.run()
    expect(f.ids).toHaveBeenCalledTimes(1)
    expect(f.host.sessions.create.mock.calls).toEqual([[{ workspaceId, sessionId: targetId }], [{ workspaceId, sessionId: targetId }]])
  })

  it('caches a created target across binding and navigation failures', async () => {
    const f = setup()
    f.host.sessions.using.mockRejectedValueOnce(new Error('binding failed'))
    await expect(f.run()).rejects.toThrow('binding failed')
    f.host.uiWorkspace.openSession.mockRejectedValueOnce(new Error('navigation failed'))
    await expect(f.run()).rejects.toThrow('navigation failed')
    await f.run()
    expect(f.host.sessions.create).toHaveBeenCalledTimes(1)
    expect(f.input.setDraft).toHaveBeenCalledTimes(1)
    expect(f.host.uiWorkspace.openSession).toHaveBeenLastCalledWith(targetId)
  })

  it('restores the handoff into a replacement input shell after a failed open released the first binding', async () => {
    const f = setup()
    f.host.uiWorkspace.openSession.mockRejectedValueOnce(new Error('navigation failed'))
    await expect(f.run()).rejects.toThrow('navigation failed')
    const nextState = { draft: '', attachmentIds: [] as string[] }
    const nextInput = {
      ...f.input,
      state: { getSnapshot: vi.fn(() => nextState) },
      setDraft: vi.fn((text: string) => { nextState.draft = text }),
    }
    f.host.conversation.input.for.mockReturnValueOnce(nextInput)
    await f.run()
    expect(nextInput.setDraft).toHaveBeenCalledOnce()
    expect(nextState.draft).toContain(sourceId)
    expect(f.host.sessions.create).toHaveBeenCalledTimes(1)
  })

  it('rejects a mismatching creation identity without borrowing or navigating', async () => {
    const f = setup()
    f.host.sessions.create.mockResolvedValueOnce('unexpected-session')
    await expect(f.run()).rejects.toMatchObject({ code: 'session/lifecycle-unavailable' })
    expect(f.host.sessions.using).not.toHaveBeenCalled()
    expect(f.host.uiWorkspace.openSession).not.toHaveBeenCalled()
    await f.run()
    expect(f.ids).toHaveBeenCalledTimes(1)
  })

  it.each([undefined, '', '   '])('fails closed with missing source cwd (%s)', async missing => {
    const f = setup()
    f.host.sessions.list.getSnapshot.mockReturnValue({ byId: { [sourceId]: { cwd: missing } } } as never)
    f.host.workspaces.list.getSnapshot.mockReturnValue({ phase: 'ready', state: 'idle', items: [] })
    await expect(f.run()).rejects.toMatchObject({ code: 'session/lifecycle-unavailable' })
    expect(f.host.sessions.create).not.toHaveBeenCalled()
  })

  it('uses workspace membership even when the source cwd is missing', async () => {
    const f = setup()
    f.host.sessions.list.getSnapshot.mockReturnValue({ byId: {} } as never)
    await f.run()
    expect(f.host.sessions.create).toHaveBeenCalledWith({ workspaceId, sessionId: targetId })
  })

  it('keeps a confirmed ungrouped source ungrouped instead of inferring ownership from its path', async () => {
    const f = setup()
    f.host.workspaces.list.getSnapshot.mockReturnValue({ phase: 'ready', state: 'idle',
      items: [{ workspaceId: 'same-path', path: cwd, sessionIds: ['other-session'] }] })
    await f.run()
    expect(f.host.sessions.create).toHaveBeenCalledWith({ cwd, sessionId: targetId })
  })

  it.each([
    { phase: 'pending', state: 'loading' },
    { phase: 'ready', state: 'loading' },
    { phase: 'ready', state: 'error' },
  ])('does not create an ungrouped session with incomplete workspace state: %j', async status => {
    const f = setup()
    f.host.workspaces.list.getSnapshot.mockReturnValue({ ...status, items: [] })
    await expect(f.run()).rejects.toMatchObject({ code: 'session/lifecycle-unavailable' })
    expect(f.host.sessions.create).not.toHaveBeenCalled()
    expect(f.input.setDraft).not.toHaveBeenCalled()
  })

  it('retries workspace attachment with the original workspace and identity after a lost reply', async () => {
    const f = setup()
    f.host.sessions.create.mockRejectedValueOnce({ code: 'session/workspace-attach-failed' })
    await expect(f.run()).rejects.toMatchObject({ code: 'session/workspace-attach-failed' })
    // A later selection or list update must not redirect the pending attempt.
    f.host.workspaces.list.getSnapshot.mockReturnValue({ phase: 'ready', state: 'idle',
      items: [{ workspaceId: 'other-workspace', path: 'H:\\other', sessionIds: [sourceId] }] })
    await f.run()
    expect(f.host.sessions.create.mock.calls).toEqual([
      [{ workspaceId, sessionId: targetId }], [{ workspaceId, sessionId: targetId }],
    ])
  })

  it('does not fall back to cwd when the source workspace was deleted', async () => {
    const f = setup()
    f.host.sessions.create.mockRejectedValue({ code: 'workspace/not-found' })
    await expect(f.run()).rejects.toMatchObject({ code: 'workspace/not-found' })
    expect(f.host.sessions.create).toHaveBeenCalledTimes(1)
    expect(f.host.sessions.create).toHaveBeenCalledWith({ workspaceId, sessionId: targetId })
    expect(f.host.uiWorkspace.openSession).not.toHaveBeenCalled()
  })

  it('rejects unavailable lifecycle capabilities before creation', async () => {
    const f = setup()
    const api = bindWelcomeContinuationHost({ ...f.host, conversation: {} })
    await expect(api.continueInNewSession(sourceId, recap, 'en', f.lifetime.signal)).rejects.toMatchObject({ code: 'session/lifecycle-unavailable' })
    expect(f.host.sessions.create).not.toHaveBeenCalled()
  })

  it.each(['navigation', 'lifetime'] as const)('does not seed or steal navigation after %s cancellation during creation', async kind => {
    const f = setup(), creation = deferred<string>()
    f.host.sessions.create.mockReturnValueOnce(creation.promise)
    const pending = f.run()
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    if (kind === 'navigation') f.cancelNavigation()
    else f.lifetime.abort()
    creation.resolve(targetId)
    await rejected
    expect(f.host.sessions.using).not.toHaveBeenCalled()
    expect(f.input.setDraft).not.toHaveBeenCalled()
    expect(f.host.uiWorkspace.openSession).not.toHaveBeenCalled()
    if (kind === 'navigation') {
      await f.run()
      expect(f.host.sessions.create).toHaveBeenCalledTimes(1)
    }
  })

  it('waits for reference.ready and honors navigation cancellation before borrowing input', async () => {
    const f = setup(), ready = deferred<typeof f.binding>(), entered = deferred<void>()
    f.host.sessions.using.mockImplementationOnce(async (_id, _options, callback) => {
      entered.resolve()
      await callback({ ready: ready.promise })
    })
    const pending = f.run()
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await entered.promise
    expect(f.host.conversation.input.for).not.toHaveBeenCalled()
    f.cancelNavigation()
    ready.resolve(f.binding)
    await rejected
    expect(f.host.conversation.input.for).not.toHaveBeenCalled()
    expect(f.host.uiWorkspace.openSession).not.toHaveBeenCalled()
  })

  it('deduplicates overlapping creation while the newest click owns navigation', async () => {
    const f = setup(), creation = deferred<string>()
    f.host.sessions.create.mockReturnValueOnce(creation.promise)
    const first = expect(f.run()).rejects.toMatchObject({ name: 'AbortError' })
    const second = f.run()
    creation.resolve(targetId)
    await Promise.all([first, second])
    expect(f.host.sessions.create).toHaveBeenCalledTimes(1)
    expect(f.input.setDraft).toHaveBeenCalledTimes(1)
    expect(f.host.uiWorkspace.openSession).toHaveBeenCalledTimes(1)
  })

  it.each(['draft', 'whitespace', 'attachment'] as const)('preserves an existing target %s', async kind => {
    const f = setup()
    if (kind === 'draft') f.state.draft = 'User edited this'
    if (kind === 'whitespace') f.state.draft = ' '
    if (kind === 'attachment') f.state.attachmentIds.push('user-file')
    const before = structuredClone(f.state)
    await expect(f.run()).rejects.toMatchObject({ code: 'session/retry-conflict' })
    expect(f.input.setDraft).not.toHaveBeenCalled()
    expect(f.host.uiWorkspace.openSession).not.toHaveBeenCalled()
    expect(f.state).toEqual(before)
  })

  it('does not overwrite later edits on retry after a navigation failure', async () => {
    const f = setup()
    f.host.uiWorkspace.openSession.mockRejectedValueOnce(new Error('navigation failed'))
    await expect(f.run()).rejects.toThrow('navigation failed')
    f.state.draft = 'My revised handoff'
    await expect(f.run()).rejects.toMatchObject({ code: 'session/retry-conflict' })
    expect(f.state.draft).toBe('My revised handoff')
    expect(f.input.setDraft).toHaveBeenCalledTimes(1)
    expect(f.host.sessions.create).toHaveBeenCalledTimes(1)
  })

  it('does not restore a handoff the user deliberately cleared', async () => {
    const f = setup()
    f.host.uiWorkspace.openSession.mockRejectedValueOnce(new Error('navigation failed'))
    await expect(f.run()).rejects.toThrow('navigation failed')
    f.state.draft = ''
    await f.run()
    expect(f.state.draft).toBe('')
    expect(f.input.setDraft).toHaveBeenCalledTimes(1)
  })

  it('creates a fresh target for a later welcome-back activity after a successful handoff', async () => {
    const f = setup()
    await f.run()
    f.ids.mockReturnValueOnce('later-session')
    f.host.sessions.create.mockResolvedValueOnce('later-session')
    f.state.draft = ''
    await f.run()
    expect(f.host.sessions.create).toHaveBeenLastCalledWith({ workspaceId, sessionId: 'later-session' })
    expect(f.host.uiWorkspace.openSession).toHaveBeenLastCalledWith('later-session')
  })

  it('does no work with a cancelled lifecycle', async () => {
    const f = setup()
    f.lifetime.abort()
    await expect(f.run()).rejects.toMatchObject({ name: 'AbortError' })
    expect(f.host.layout.beginNavigation).not.toHaveBeenCalled()
    expect(f.host.sessions.create).not.toHaveBeenCalled()
  })
})
