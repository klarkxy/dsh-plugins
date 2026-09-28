import { describe, expect, it } from 'vitest'
import type { AiServices, AuxiliaryRequest, AuxiliaryResult, ResolvedRoute } from '@klarkxy/dsh-ai-services/contracts'
import { GitCommitService, type SessionStoreLike } from './service.ts'
import type { GitRunner } from './git.ts'

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

const route: ResolvedRoute = {
  provider: 'deepseek', model: 'deepseek-chat', source: 'default',
  target: { kind: 'role', role: 'weak' }, policyRevision: 0,
}

function makeAi(planText: string | Error, beforeReturn?: () => Promise<void> | void): AiServices {
  let active = true
  const scope = {
    plugin: 'test',
    signal: new AbortController().signal,
    get active() { return active },
    registerPurpose: () => () => {},
    async run(_request: AuxiliaryRequest): Promise<AuxiliaryResult> {
      await beforeReturn?.()
      if (planText instanceof Error) throw planText
      return {
        text: planText,
        receipt: { id: 'r1', plugin: 'test', purpose: 'git-commit.plan', sourceVersion: 'v', status: 'success', attempts: 1, cost: null, startedAt: 0, finishedAt: 1, route },
      }
    },
    dispose() { active = false },
  }
  return {
    activate: () => scope,
    importPurposes: async () => { throw new Error('unused') },
    getPolicy: () => { throw new Error('unused') },
    updatePolicy: async () => { throw new Error('unused') },
    resolve: async () => route,
    purposes: () => [],
    usage: () => [],
  }
}

const porcelain = [' M src/a.ts', ' M src/b.ts', '?? docs/c.md', ''].join(NUL)

function makeService(planText: string | Error, run: GitRunner & { calls: string[][] }) {
  const service = new GitCommitService({
    plugin: 'test',
    ai: makeAi(planText),
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

  it('falls back to one commit when the plan is invalid', async () => {
    const run = makeRunner({
      'rev-parse --show-toplevel': 'D:/repo\n',
      'symbolic-ref': 'main\n',
      'status --porcelain': porcelain,
      'rev-parse --short': 'def5678\n',
    })
    const service = makeService('not json', run)
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
    const service = new GitCommitService({
      plugin: 'test',
      ai: makeAi(plan),
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
    const service = new GitCommitService({ plugin: 'test', ai: makeAi(plan), sessions: makeSessions(), run,
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
    const service = new GitCommitService({ plugin: 'test', ai: makeAi(plan, () => gate), sessions: makeSessions(), run,
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
