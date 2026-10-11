import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as kit from '@klarkxy/dsh-plugin-kit'
import type { LlmTextCaller } from '@klarkxy/dsh-plugin-kit'
import { GitCommitService, type SessionStoreLike } from './service.ts'
import type { GitRunner } from './git.ts'
import { defaultSettings, type GitCommitSettings } from './contracts.ts'

const NUL = String.fromCharCode(0)

function makeRunner(handlers: { [command: string]: string }): GitRunner & { calls: string[][] } {
  const calls: string[][] = []
  const run = async (args: readonly string[]) => {
    calls.push([...args])
    for (const [prefix, value] of Object.entries(handlers)) {
      if (args.join(' ').startsWith(prefix)) return value
    }
    return ''
  }
  return Object.assign(run, { calls })
}

function makeSessions(cwd = 'D:/repo'): SessionStoreLike {
  const session = { id: 's1', header: { cwd } }
  return {
    get: (id: string) => id === 's1' ? session : undefined,
  }
}

const host = { agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) } }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function repoRunner() {
  return makeRunner({
    'rev-parse --show-toplevel': 'D:/repo\n',
    'symbolic-ref': 'main\n',
    'status --porcelain': porcelain,
    'rev-parse --short': 'abc1234\n',
  })
}

const pageRoute = { provider: 'page-provider', model: 'page-model', reasoningEffort: 'high' }
const liveRoute = { provider: 'live-provider', model: 'live-model', reasoningEffort: 'medium' }
const pendingRoute = { provider: 'pending-provider', model: 'pending-model', reasoningEffort: 'low' }
const defaultRoute = { provider: 'deepseek', model: 'deepseek-chat' }

function modelHost(pending?: typeof liveRoute, recorded: typeof liveRoute | undefined = liveRoute) {
  const session = { requestHeader: () => recorded ? { config: recorded } : undefined }
  return {
    ...host,
    agents: { get: (id: string) => id === 's1' ? { session } : undefined },
    sessionProjections: { stateOf: () => ({ pending }) },
  }
}

function makeLlm(): LlmTextCaller {
  return {
    prepareCall: async () => { throw new Error('unused') },
    resolveCallConfig: async () => { throw new Error('unused') },
  }
}

beforeEach(() => { vi.restoreAllMocks() })

function stubPlan(planText: string | Error, beforeReturn?: () => Promise<void> | void) {
  vi.spyOn(kit, 'callLlmText').mockImplementation(async () => {
    await beforeReturn?.()
    if (planText instanceof Error) throw planText
    return { text: planText, provider: 'deepseek', model: 'deepseek-chat' }
  })
}

const porcelain = [' M src/a.ts', ' M src/b.ts', '?? docs/c.md', ''].join(NUL)

function makeService(planText: string | Error, run: GitRunner & { calls: string[][] }) {
  stubPlan(planText)
  const service = new GitCommitService({
    plugin: 'test',
    llm: makeLlm(),
    host,
    sessions: makeSessions(),
    run,
    preview: async path => ({ path, preview: 'new file body', binary: false }),
  })
  service.start()
  return service
}

describe('GitCommitService.status', () => {
  it('reports repo, workspace count and the resolved model', async () => {
    const run = makeRunner({
      'rev-parse --show-toplevel': 'D:/repo\n',
      'symbolic-ref': 'main\n',
      'status --porcelain': porcelain,
    })
    const service = makeService('{}', run)
    const status = await service.status('s1')
    expect(status.available).toBe(true)
    expect(status.branch).toBe('main')
    expect(status.workspace.files).toBe(3)
    expect(status.model?.model).toBe('deepseek-chat')
  })

  it('reports unavailable when the directory is not a repository', async () => {
    const run: GitRunner & { calls: string[][] } = Object.assign(
      async (args: readonly string[]) => {
        if (args[0] === 'rev-parse') throw new Error('fatal: not a git repository')
        return ''
      },
      { calls: [] as string[][] },
    )
    const service = makeService('{}', run)
    const status = await service.status('s1')
    expect(status.available).toBe(false)
    expect(status.reason).toBe('not-a-repo')
  })
})

describe('GitCommitService model selection', () => {
  it.each([
    { name: 'explicit page before pending session', route: pageRoute, host: modelHost(pendingRoute), expected: pageRoute, source: 'page' },
    { name: 'pending session before recorded session', route: undefined, host: modelHost(pendingRoute), expected: pendingRoute, source: 'default' },
    { name: 'recorded session before host default', route: undefined, host: modelHost(), expected: liveRoute, source: 'default' },
    { name: 'host default without a session route', route: undefined, host, expected: defaultRoute, source: 'default' },
  ])('uses $name for status and planning', async ({ route, host, expected, source }) => {
    const plan = JSON.stringify({ groups: [{ message: 'chore: update workspace', files: ['src/a.ts', 'src/b.ts', 'docs/c.md'] }] })
    const call = vi.spyOn(kit, 'callLlmText').mockImplementation(async (_llm, request) => ({ text: plan, ...request.route }))
    const service = new GitCommitService({
      plugin: 'test', llm: makeLlm(), host, sessions: makeSessions(), run: repoRunner(),
      preview: async (_root, path) => ({ path, preview: '', binary: false }),
      settings: { load: async () => ({ ...defaultSettings(), ...(route ? { model: route } : {}) }), save: async () => {} },
    })
    expect((await service.status('s1')).model).toEqual({ provider: expected.provider, model: expected.model, source })
    expect((await service.commit('s1')).model).toEqual({ provider: expected.provider, model: expected.model, source })
    expect(call).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ route: expected, sessionId: 's1' }))
  })
})

describe('GitCommitService initialization', () => {
  it('releases a cancelled commit waiting for the initial settings load', async () => {
    const load = deferred<GitCommitSettings>()
    const service = new GitCommitService({ plugin: 'test', llm: makeLlm(), sessions: makeSessions(),
      settings: { load: () => load.promise, save: async () => {} } })
    const firstSignal = new AbortController()
    const first = service.commit('s1', firstSignal.signal)
    firstSignal.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })

    const nextSignal = new AbortController()
    const next = service.commit('s1', nextSignal.signal)
    nextSignal.abort()
    await expect(next).rejects.toMatchObject({ name: 'AbortError' })
    load.resolve(defaultSettings())
    await service.dispose()
  })

  it('adopts a refreshed row after initialization without a late load overwriting it', async () => {
    const load = deferred<GitCommitSettings>()
    const service = new GitCommitService({ plugin: 'test', llm: makeLlm(), sessions: makeSessions(),
      settings: { load: () => load.promise, save: async () => {} } })
    const refreshed = { revision: 8, model: pageRoute, allowFallback: true }
    service.adoptSettings(refreshed)
    const read = service.ready().then(() => service.getSettings())
    Object.assign(refreshed, { revision: 99 })
    load.resolve({ ...defaultSettings(), revision: 7 })
    expect(await read).toEqual({ revision: 8, model: pageRoute, allowFallback: true })
    await service.dispose()
    expect(() => service.adoptSettings(defaultSettings())).toThrowError(expect.objectContaining({ code: 'disposed' }))
  })

  it('waits for stored settings before reads, status and commits', async () => {
    const load = deferred<GitCommitSettings>()
    const stored = { revision: 7, model: pageRoute, allowFallback: true }
    const run = repoRunner()
    stubPlan('invalid plan')
    const service = new GitCommitService({
      plugin: 'test', llm: makeLlm(), host, sessions: makeSessions(), run,
      preview: async (_root, path) => ({ path, preview: '', binary: false }),
      settings: { load: () => load.promise, save: async () => {} },
    })
    const read = service.ready().then(() => service.getSettings())
    const status = service.status('s1')
    const commit = service.commit('s1')
    const settled = vi.fn()
    void read.then(settled)
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    expect(run.calls).toEqual([])
    expect(kit.callLlmText).not.toHaveBeenCalled()
    await expect(service.commit('s1')).rejects.toMatchObject({ code: 'busy' })
    load.resolve(stored)
    const settings = await read
    expect(settings).toEqual(stored)
    expect((await status).model).toEqual({ provider: pageRoute.provider, model: pageRoute.model, source: 'page' })
    expect((await commit).fallback).toBe(true)
    expect(kit.callLlmText).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ route: pageRoute }))
    Object.assign(settings, { revision: 99 })
    expect((await service.getSettings()).revision).toBe(7)
  })

  it('compares revision only after loading and serializes competing updates', async () => {
    const load = deferred<GitCommitSettings>()
    const save = vi.fn(async (_settings: GitCommitSettings) => {})
    const service = new GitCommitService({ plugin: 'test', llm: makeLlm(), sessions: makeSessions(),
      settings: { load: () => load.promise, save } })
    const patch = { model: pageRoute, allowFallback: true }
    const first = service.updateSettings(patch, 7)
    const second = service.updateSettings(patch, 7)
    const stale = expect(second).rejects.toMatchObject({ code: 'stale' })
    await Promise.resolve()
    expect(save).not.toHaveBeenCalled()
    load.resolve({ ...defaultSettings(), revision: 7 })
    expect((await first).revision).toBe(8)
    await stale
    expect(save).toHaveBeenCalledTimes(1)
    expect(await service.getSettings()).toEqual({ revision: 8, ...patch })
  })

  it('retains the loaded row after a failed write and allows a retry', async () => {
    const stored = { ...defaultSettings(), revision: 7 }
    const save = vi.fn().mockRejectedValueOnce(new Error('write failed')).mockResolvedValue(undefined)
    const service = new GitCommitService({ plugin: 'test', llm: makeLlm(), sessions: makeSessions(),
      settings: { load: async () => stored, save } })
    const patch = { model: pageRoute, allowFallback: true }
    await expect(service.updateSettings(patch, 7)).rejects.toThrow('write failed')
    expect(await service.getSettings()).toEqual(stored)
    expect((await service.updateSettings(patch, 7)).revision).toBe(8)
  })

  it('reports an unreadable settings row before reading git, calling a model or saving defaults', async () => {
    const load = deferred<GitCommitSettings>()
    const run = repoRunner()
    stubPlan('unused')
    const save = vi.fn(async () => {})
    const service = new GitCommitService({ plugin: 'test', llm: makeLlm(), host, sessions: makeSessions(), run,
      preview: async (_root, path) => ({ path, preview: '', binary: false }),
      settings: { load: () => load.promise, save } })
    const failure = { code: 'settings-unavailable' }
    const read = expect(service.ready()).rejects.toMatchObject(failure)
    const status = expect(service.status('s1')).rejects.toMatchObject(failure)
    const commit = expect(service.commit('s1')).rejects.toMatchObject(failure)
    const update = expect(service.updateSettings({ model: pageRoute, allowFallback: true }, 0)).rejects.toMatchObject(failure)
    load.reject(new Error('read failed'))
    await Promise.all([read, status, commit, update])
    expect(() => service.getSettings()).toThrowError(expect.objectContaining(failure))
    expect(run.calls).toEqual([])
    expect(kit.callLlmText).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    await service.dispose()
  })

  it('recovers from a failed initial read only after adopting a known settings row', async () => {
    const service = new GitCommitService({ plugin: 'test', llm: makeLlm(), sessions: makeSessions(),
      settings: { load: async () => { throw new Error('read failed') }, save: async () => {} } })
    await expect(service.ready()).rejects.toMatchObject({ code: 'settings-unavailable' })
    const stored = { revision: 7, model: pageRoute, allowFallback: false }
    service.adoptSettings(stored)
    await service.ready()
    expect(service.getSettings()).toEqual(stored)
    expect((await service.updateSettings({ model: pageRoute, allowFallback: true }, 7)).revision).toBe(8)
    await service.dispose()
  })

  it('waits during disposal and cancels queued commits and writes before touching git', async () => {
    const load = deferred<GitCommitSettings>()
    const save = vi.fn(async (_settings: GitCommitSettings) => {})
    const run = repoRunner()
    const service = new GitCommitService({ plugin: 'test', llm: makeLlm(), host, sessions: makeSessions(), run,
      settings: { load: () => load.promise, save } })
    const commit = expect(service.commit('s1')).rejects.toMatchObject({ code: 'cancelled' })
    const update = expect(service.updateSettings({ model: pageRoute, allowFallback: true }, 7)).rejects.toMatchObject({ code: 'disposed' })
    const disposed = vi.fn()
    const disposal = service.dispose().then(disposed)
    await Promise.resolve()
    expect(disposed).not.toHaveBeenCalled()
    load.resolve({ ...defaultSettings(), revision: 7 })
    await Promise.all([commit, update, disposal])
    expect(save).not.toHaveBeenCalled()
    expect(run.calls).toEqual([])
  })

  it('honors cancellation while settings are loading before touching git', async () => {
    const load = deferred<GitCommitSettings>()
    const run = repoRunner()
    const controller = new AbortController()
    const service = new GitCommitService({ plugin: 'test', llm: makeLlm(), host, sessions: makeSessions(), run,
      settings: { load: () => load.promise, save: async () => {} } })
    const commit = expect(service.commit('s1', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    load.resolve(defaultSettings())
    await commit
    expect(run.calls).toEqual([])
  })
})

describe('GitCommitService.commit', () => {
  const plan = JSON.stringify({ groups: [
    { message: 'feat: update a and b', files: ['src/a.ts', 'src/b.ts'] },
    { message: 'docs: add c', files: ['docs/c.md'] },
  ] })

  it('commits workspace changes in the model-planned groups', async () => {
    const run = makeRunner({
      'rev-parse --show-toplevel': 'D:/repo\n',
      'symbolic-ref': 'main\n',
      'status --porcelain': porcelain,
      'rev-parse --short': 'abc1234\n',
    })
    const service = makeService(plan, run)
    const result = await service.commit('s1')
    expect(result.fallback).toBe(false)
    expect(result.commits.map(commit => commit.message)).toEqual(['feat: update a and b', 'docs: add c'])
    const added = run.calls.filter(args => args[0] === 'add').map(args => args.slice(3))
    expect(added).toEqual([['src/a.ts', 'src/b.ts'], ['docs/c.md']])
  })

  it('refuses to commit when the plan is invalid', async () => {
    const run = makeRunner({
      'rev-parse --show-toplevel': 'D:/repo\n',
      'symbolic-ref': 'main\n',
      'status --porcelain': porcelain,
    })
    const service = makeService('not json', run)
    // Nobody reviewed a commit the model never planned, so the run stops here.
    await expect(service.commit('s1')).rejects.toMatchObject({ code: 'plan-unavailable' })
    expect(run.calls.some(args => args[0] === 'add' || args[0] === 'commit')).toBe(false)
  })

  it('refuses to commit when the model call itself fails', async () => {
    const run = makeRunner({
      'rev-parse --show-toplevel': 'D:/repo\n',
      'symbolic-ref': 'main\n',
      'status --porcelain': porcelain,
    })
    const service = makeService(new Error('provider refused the request'), run)
    await expect(service.commit('s1')).rejects.toMatchObject({ code: 'plan-unavailable' })
    expect(run.calls.some(args => args[0] === 'add' || args[0] === 'commit')).toBe(false)
  })

  it('commits one fallback group when the settings row opted in', async () => {
    const run = makeRunner({
      'rev-parse --show-toplevel': 'D:/repo\n',
      'symbolic-ref': 'main\n',
      'status --porcelain': porcelain,
      'rev-parse --short': 'def5678\n',
    })
    const service = makeService('not json', run)
    await service.updateSettings({ model: { provider: '', model: '' }, allowFallback: true }, 0)
    const result = await service.commit('s1')
    expect(result.fallback).toBe(true)
    expect(result.commits).toHaveLength(1)
    expect(result.commits[0]?.files).toEqual(['src/a.ts', 'src/b.ts', 'docs/c.md'])
  })

  it('rejects when the working tree is clean', async () => {
    const run = makeRunner({
      'rev-parse --show-toplevel': 'D:/repo\n',
      'symbolic-ref': 'main\n',
      'status --porcelain': '',
    })
    const service = makeService(plan, run)
    await expect(service.commit('s1')).rejects.toMatchObject({ code: 'no-changes' })
  })

  it('rejects concurrent runs', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const inner = makeRunner({
      'rev-parse --show-toplevel': 'D:/repo\n',
      'symbolic-ref': 'main\n',
      'status --porcelain': porcelain,
      'rev-parse --short': 'abc1234\n',
    })
    const blocking: GitRunner = async (args, options) => {
      if (args[0] === 'add') { await gate; return '' }
      return inner(args, options)
    }
    stubPlan(plan)
    const service = new GitCommitService({
      plugin: 'test',
      llm: makeLlm(), host,
      sessions: makeSessions(),
      run: blocking,
      preview: async path => ({ path, preview: '', binary: false }),
    })
    service.start()
    const first = service.commit('s1')
    await expect(service.commit('s1')).rejects.toMatchObject({ code: 'busy' })
    release()
    await first
  })

  it('does not mutate git when workspace status changes during AI planning', async () => {
    const inner = makeRunner({
      'rev-parse --show-toplevel': 'D:/repo\n',
      'symbolic-ref': 'main\n',
      'status --porcelain': porcelain,
    })
    let statuses = 0
    const run: GitRunner = async (args, options) => {
      if (args[0] === 'status' && ++statuses > 1) return [' M src/a.ts', '?? new-after-plan.txt', ''].join(NUL)
      return inner(args, options)
    }
    stubPlan(plan)
    const service = new GitCommitService({ plugin: 'test', llm: makeLlm(), host, sessions: makeSessions(), run,
      preview: async path => ({ path, preview: '', binary: false }) })
    service.start()
    await expect(service.commit('s1')).rejects.toMatchObject({ code: 'workspace-changed' })
    expect(inner.calls.some(args => args[0] === 'add' || args[0] === 'commit')).toBe(false)
  })

  it('does not fall back to a commit after service disposal during planning', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const run = makeRunner({
      'rev-parse --show-toplevel': 'D:/repo\n',
      'symbolic-ref': 'main\n',
      'status --porcelain': porcelain,
    })
    stubPlan(plan, () => gate)
    const service = new GitCommitService({ plugin: 'test', llm: makeLlm(), host, sessions: makeSessions(), run,
      preview: async path => ({ path, preview: '', binary: false }) })
    service.start()
    const committing = service.commit('s1')
    await new Promise(resolve => setTimeout(resolve, 0))
    const disposing = service.dispose()
    release()
    await expect(committing).rejects.toMatchObject({ code: 'cancelled' })
    await disposing
    expect(run.calls.some(args => args[0] === 'add' || args[0] === 'commit')).toBe(false)
  })
})
