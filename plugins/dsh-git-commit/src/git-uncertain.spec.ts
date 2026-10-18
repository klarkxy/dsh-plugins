import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import * as kit from '@klarkxy/dsh-plugin-kit'
import { execGit, type GitRunner } from './git.ts'
import { GitCommitService } from './service.ts'
import { handleRpc } from './index.ts'

afterEach(() => vi.restoreAllMocks())

describe('uncertain commit completion through RPC', { timeout: 30_000 }, () => {
  it.each([
    ['created', 0], ['created', 1], ['external', 0], ['external', 1], ['unreadable', 0], ['unreadable', 1],
  ] as const)('preserves %s HEAD without attribution after group %s rejects', async (mode, failedGroup) => {
    const root = await mkdtemp(join(tmpdir(), 'git-uncertain-'))
    const git = (args: string[]) => execGit(args, { cwd: root })
    const groups = ['a', 'b', 'c'].map(path => ({ message: `change ${path}`, files: [`${path}.txt`] }))
    try {
      await git(['init', '--quiet'])
      await git(['config', 'user.name', 'Uncertain Test'])
      await git(['config', 'user.email', 'uncertain@example.invalid'])
      for (const path of ['a', 'b', 'c']) await writeFile(join(root, `${path}.txt`), `base ${path}`)
      await git(['add', '-A'])
      await git(['commit', '--quiet', '-m', 'base'])
      for (const path of ['a', 'b', 'c']) await writeFile(join(root, `${path}.txt`), `changed ${path}`)
      let commands = 0
      let indexAtFailure!: Buffer
      let headAtFailure = ''
      let headUnreadable = false
      const run: GitRunner = async (args, options) => {
        if (headUnreadable && args[0] === 'rev-parse' && args[1] === '--verify') throw new Error('HEAD inspection failed')
        if (args[0] === 'commit' && commands++ === failedGroup) {
          if (mode !== 'external') await execGit(args, options)
          else {
            const head = (await git(['rev-parse', 'HEAD'])).trim()
            const tree = (await git(['rev-parse', 'HEAD^{tree}'])).trim()
            const external = (await git(['commit-tree', tree, '-p', head, '-m', 'external owner'])).trim()
            await git(['update-ref', 'HEAD', external, head])
          }
          indexAtFailure = await readFile(join(root, '.git', 'index'))
          headAtFailure = (await git(['rev-parse', 'HEAD'])).trim()
          headUnreadable = mode === 'unreadable'
          throw new Error('command rejected after HEAD advanced')
        }
        return execGit(args, options)
      }
      vi.spyOn(kit, 'callLlmText').mockResolvedValue({ text: JSON.stringify({ groups }), provider: 'test', model: 'test' })
      const session = { id: 's1', header: { cwd: root } }
      const service = new GitCommitService({ plugin: 'test', workingDirectory: { get: () => root }, run, sessions: { get: () => session },
        host: { agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'test' }) } },
        llm: { prepareCall: async () => { throw new Error('unused') }, resolveCallConfig: async () => { throw new Error('unused') } },
      })
      const response = await handleRpc(service, 'commit', { sessionId: 's1' }, new AbortController().signal)
      expect(response.ok).toBe(false)
      if (response.ok) throw new Error('run unexpectedly succeeded')
      expect(response.error.code).toBe('commit-failed')
      const partial = response.error.partial!
      expect(partial.commits).toEqual(groups.slice(0, failedGroup).map(group => ({ ...group, hash: expect.stringMatching(/^[a-f0-9]+$/) })))
      expect(partial.uncertain).toEqual([groups[failedGroup]])
      expect(partial.remaining).toEqual(groups.slice(failedGroup + 1))
      expect(partial.failure).toEqual({ code: 'commit-failed', message: 'command rejected after HEAD advanced' })
      expect(await readFile(join(root, '.git', 'index'))).toEqual(indexAtFailure)
      expect((await git(['rev-parse', 'HEAD'])).trim()).toBe(headAtFailure)
      expect(commands).toBe(failedGroup + 1)
      expect(await git(['show', '-s', '--format=%s', 'HEAD'])).toBe(`${mode !== 'external' ? groups[failedGroup]!.message : 'external owner'}\n`)
      await service.dispose()
    } finally {
      const fixtureRoot = resolve(root)
      if (dirname(fixtureRoot) !== resolve(tmpdir()) || !basename(fixtureRoot).startsWith('git-uncertain-')) {
        throw new Error('Refusing to remove an unexpected fixture path')
      }
      await rm(fixtureRoot, { recursive: true, force: true })
    }
  })
})
