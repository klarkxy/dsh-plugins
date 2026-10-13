import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { commitGroups, execGit, PartialCommitError, workingTreeChanges, type GitRunner } from './git.ts'

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'git-outcomes-'))
  const git = (args: string[]) => execGit(args, { cwd: root })
  try {
    await git(['init', '--quiet'])
    await git(['config', 'user.name', 'Outcome Test'])
    await git(['config', 'user.email', 'outcome@example.invalid'])
    await writeFile(join(root, 'a.txt'), 'base a')
    await writeFile(join(root, 'b.txt'), 'base b')
    await git(['add', '-A'])
    await git(['commit', '--quiet', '-m', 'base'])
    await writeFile(join(root, 'a.txt'), 'changed a')
    await writeFile(join(root, 'b.txt'), 'staged b')
    await git(['add', 'b.txt'])
    await writeFile(join(root, 'b.txt'), 'worktree b')
    await run(root)
  } finally {
    const fixtureRoot = resolve(root)
    if (dirname(fixtureRoot) !== resolve(tmpdir()) || !basename(fixtureRoot).startsWith('git-outcomes-')) {
      throw new Error('Refusing to remove an unexpected fixture path')
    }
    await rm(fixtureRoot, { recursive: true, force: true })
  }
}

const groups = [{ message: 'first', files: ['a.txt'] }, { message: 'second', files: ['b.txt'] }]

describe('durable Git outcomes', { timeout: 30_000 }, () => {
  it('keeps the first commit and restores only the failing second group index', async () => fixture(async root => {
    let indexAfterFirst: Buffer | undefined
    const run: GitRunner = async (args, options) => {
      if (args[0] === 'commit' && args.includes('second')) throw new Error('second group rejected')
      const output = await execGit(args, options)
      if (args[0] === 'rev-parse' && args[1] === '--short') indexAfterFirst = await readFile(join(root, '.git', 'index'))
      return output
    }
    const error = await commitGroups(run, root, groups, await workingTreeChanges(execGit, root)).catch(error => error)
    expect(error).toBeInstanceOf(PartialCommitError)
    expect(error.commits).toEqual([{ hash: expect.stringMatching(/^[a-f0-9]+$/), skipped: false }])
    expect(error.cause.message).toBe('second group rejected')
    expect(await readFile(join(root, '.git', 'index'))).toEqual(indexAfterFirst)
    expect(await execGit(['log', '--format=%s'], { cwd: root })).toBe('first\nbase\n')
    expect(await readFile(join(root, 'b.txt'), 'utf8')).toBe('worktree b')
    expect(await execGit(['show', ':b.txt'], { cwd: root })).toBe('staged b')
  }))

  it('collects the durable hash after cancellation and never starts the second group', async () => fixture(async root => {
    const controller = new AbortController()
    const commands: string[][] = []
    const run: GitRunner = async (args, options) => {
      commands.push([...args])
      const output = await execGit(args, options)
      if (args[0] === 'commit') controller.abort()
      return output
    }
    const error = await commitGroups(run, root, groups, await workingTreeChanges(execGit, root), controller.signal).catch(error => error)
    expect(error).toBeInstanceOf(PartialCommitError)
    expect(error.commits[0].hash).toMatch(/^[a-f0-9]+$/)
    expect(commands.filter(args => args[0] === 'commit')).toHaveLength(1)
    expect(await execGit(['log', '--format=%s'], { cwd: root })).toBe('first\nbase\n')
  }))

  it('reports a created commit even when its post-commit hash read fails', async () => fixture(async root => {
    const run: GitRunner = (args, options) => args[0] === 'rev-parse' && args[1] === '--short'
      ? Promise.reject(new Error('cannot read hash')) : execGit(args, options)
    const error = await commitGroups(run, root, groups, await workingTreeChanges(execGit, root)).catch(error => error)
    expect(error).toBeInstanceOf(PartialCommitError)
    expect(error.commits).toEqual([{ hash: '', skipped: false }])
    expect(error.cause.message).toBe('cannot read hash')
    expect(await execGit(['log', '--format=%s'], { cwd: root })).toBe('first\nbase\n')
  }))

  it('leaves an index changed by another owner untouched on failure', async () => fixture(async root => {
    let externalIndex: Buffer | undefined
    const run: GitRunner = async (args, options) => {
      if (args[0] === 'commit') {
        await execGit(['add', 'b.txt'], options)
        externalIndex = await readFile(join(root, '.git', 'index'))
        throw new Error('concurrent index edit')
      }
      return execGit(args, options)
    }
    await expect(commitGroups(run, root, groups, await workingTreeChanges(execGit, root))).rejects.toThrow('concurrent index edit')
    expect(await readFile(join(root, '.git', 'index'))).toEqual(externalIndex)
    expect(await execGit(['log', '--format=%s'], { cwd: root })).toBe('base\n')
  }))

  it('does not restore the index if HEAD advanced while a command failed', async () => fixture(async root => {
    let stagedIndex: Buffer | undefined
    let advancedHead = ''
    const run: GitRunner = async (args, options) => {
      if (args[0] === 'commit') {
        stagedIndex = await readFile(join(root, '.git', 'index'))
        const head = (await execGit(['rev-parse', 'HEAD'], options)).trim()
        const tree = (await execGit(['rev-parse', 'HEAD^{tree}'], options)).trim()
        advancedHead = (await execGit(['commit-tree', tree, '-p', head, '-m', 'external HEAD'], options)).trim()
        await execGit(['update-ref', 'HEAD', advancedHead, head], options)
        throw new Error('HEAD changed externally')
      }
      return execGit(args, options)
    }
    await expect(commitGroups(run, root, groups, await workingTreeChanges(execGit, root))).rejects.toThrow('HEAD changed externally')
    expect(await readFile(join(root, '.git', 'index'))).toEqual(stagedIndex)
    expect((await execGit(['rev-parse', 'HEAD'], { cwd: root })).trim()).toBe(advancedHead)
  }))

  it('preserves the original pre-commit failure without claiming an uncertain commit when HEAD inspection fails', async () => fixture(async root => {
    let addFailed = false
    let commits = 0
    let indexAtFailure!: Buffer
    const run: GitRunner = async (args, options) => {
      if (args[0] === 'commit') commits += 1
      if (addFailed && args[0] === 'rev-parse' && args[1] === '--verify') throw new Error('HEAD inspection failed')
      const output = await execGit(args, options)
      if (args[0] === 'add') {
        addFailed = true
        indexAtFailure = await readFile(join(root, '.git', 'index'))
        throw new Error('add failed before commit invocation')
      }
      return output
    }
    const error = await commitGroups(run, root, groups, await workingTreeChanges(execGit, root)).catch(error => error)
    expect(error).not.toBeInstanceOf(PartialCommitError)
    expect(error.message).toBe('add failed before commit invocation')
    expect(commits).toBe(0)
    expect(await readFile(join(root, '.git', 'index'))).toEqual(indexAtFailure)
    expect(await execGit(['log', '--format=%s'], { cwd: root })).toBe('base\n')
  }))
})
