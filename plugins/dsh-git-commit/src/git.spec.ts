import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commitGroups, execGit, fallbackGroup, parsePorcelain, untrackedPreview, workingTreeChanges, type ChangedFile } from './git.ts'

const NUL = String.fromCharCode(0)

describe('parsePorcelain', () => {
  it('parses modified, added, deleted and untracked entries', () => {
    const output = [
      ` M src/a.ts`,
      `M  src/b.ts`,
      ` D src/c.ts`,
      `A  src/d.ts`,
      `?? src/new.ts`,
      `!! ignored.log`,
    ].join(NUL) + NUL
    const files = parsePorcelain(output)
    expect(files).toEqual([
      { path: 'src/a.ts', status: 'modified', staged: false },
      { path: 'src/b.ts', status: 'modified', staged: true },
      { path: 'src/c.ts', status: 'deleted', staged: false },
      { path: 'src/d.ts', status: 'added', staged: true },
      { path: 'src/new.ts', status: 'untracked', staged: false },
    ])
  })

  it('consumes the origin token of rename entries', () => {
    const output = [`R  src/next.ts`, `src/old.ts`, ` M src/other.ts`, ''].join(NUL)
    const files = parsePorcelain(output)
    expect(files).toEqual([
      { path: 'src/next.ts', origin: 'src/old.ts', status: 'renamed', staged: true },
      { path: 'src/other.ts', status: 'modified', staged: false },
    ])
  })

  it('returns an empty list for a clean tree', () => {
    expect(parsePorcelain('')).toEqual([])
  })

  it.each(['UU', 'AA', 'DD', 'AU', 'UD', 'DU', 'UA'])('rejects unmerged %s status', status => {
    expect(() => parsePorcelain(`${status} src/conflicted.ts${NUL}`)).toThrow('resolve merge conflicts')
  })
})

describe('fallbackGroup', () => {
  const files: ChangedFile[] = [
    { path: 'a.ts', status: 'modified', staged: false },
    { path: 'b.ts', status: 'untracked', staged: false },
  ]

  it('builds a single group with every path', () => {
    const group = fallbackGroup(files, 'en')
    expect(group.files).toEqual(['a.ts', 'b.ts'])
    expect(group.message).toContain('2 files')
  })

  it('uses Chinese when the recent log is Chinese', () => {
    expect(fallbackGroup(files, 'zh').message).toContain('2 个文件')
  })
})

async function tempRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-git-commit-test-'))
  const git = (args: string[]) => execGit(args, { cwd: root })
  await git(['init', '--quiet'])
  await git(['config', 'user.name', 'Test User'])
  await git(['config', 'user.email', 'test@example.invalid'])
  await writeFile(join(root, 'old.txt'), 'rename me\n')
  await writeFile(join(root, 'other.txt'), 'base\n')
  await git(['add', '-A'])
  await git(['commit', '--quiet', '-m', 'initial'])
  return root
}

describe('commitGroups in a real repository', () => {
  it('commits both sides of a rename and keeps the other group staged', async () => {
    const root = await tempRepo()
    const git = (args: string[]) => execGit(args, { cwd: root })
    try {
      await git(['mv', 'old.txt', 'new.txt'])
      await writeFile(join(root, 'other.txt'), 'changed\n')
      await git(['add', 'other.txt'])
      const files = await workingTreeChanges(execGit, root)
      expect(files.find(file => file.status === 'renamed')).toMatchObject({ path: 'new.txt', origin: 'old.txt' })
      const [first] = await commitGroups(execGit, root, [{ message: 'rename file', files: ['new.txt'] }], files)
      expect(first?.skipped).toBe(false)
      expect(await git(['show', '--format=', '--name-status', 'HEAD'])).toMatch(/R100\s+old\.txt\s+new\.txt/u)
      expect(await git(['diff', '--cached', '--name-only'])).toContain('other.txt')
      await commitGroups(execGit, root, [{ message: 'change other', files: ['other.txt'] }], files)
      expect(await git(['status', '--porcelain'])).toBe('')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('restores the exact index when a commit fails', async () => {
    const root = await tempRepo()
    const git = (args: string[]) => execGit(args, { cwd: root })
    try {
      await writeFile(join(root, 'other.txt'), 'staged\n')
      await git(['add', 'other.txt'])
      await writeFile(join(root, 'other.txt'), 'later worktree edit\n')
      const indexPath = (await git(['rev-parse', '--git-path', 'index'])).trim()
      const before = await readFile(join(root, indexPath))
      const files = await workingTreeChanges(execGit, root)
      await expect(commitGroups(execGit, root, [{ message: '', files: ['other.txt'] }], files)).rejects.toThrow()
      expect(await readFile(join(root, indexPath))).toEqual(before)
      expect(await git(['show', '-s', '--format=%s', 'HEAD'])).toContain('initial')
      expect(await readFile(join(root, 'other.txt'), 'utf8')).toBe('later worktree edit\n')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a real merge conflict before it can be staged', async () => {
    const root = await tempRepo()
    const git = (args: string[]) => execGit(args, { cwd: root })
    try {
      const base = (await git(['symbolic-ref', '--short', 'HEAD'])).trim()
      await git(['switch', '--quiet', '-c', 'conflicting'])
      await writeFile(join(root, 'old.txt'), 'from branch\n')
      await git(['commit', '--quiet', '-am', 'branch edit'])
      await git(['switch', '--quiet', base])
      await writeFile(join(root, 'old.txt'), 'from base\n')
      await git(['commit', '--quiet', '-am', 'base edit'])
      await expect(git(['merge', 'conflicting'])).rejects.toThrow()
      await expect(workingTreeChanges(execGit, root)).rejects.toThrow('resolve merge conflicts')
      expect(await git(['show', 'HEAD:old.txt'])).toBe('from base\n')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('untrackedPreview', () => {
  it('does not send symlink target content to the model', async ({ skip }) => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-git-preview-'))
    const outside = await mkdtemp(join(tmpdir(), 'dsh-git-private-'))
    try {
      await writeFile(join(outside, 'secret.txt'), 'private data')
      try {
        await symlink(join(outside, 'secret.txt'), join(root, 'link.txt'))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') skip('symlink creation requires privilege on this host')
        throw error
      }
      expect(await untrackedPreview(root, 'link.txt')).toEqual({ path: 'link.txt', preview: '', binary: true })
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })
})
