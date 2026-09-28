import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, lstat, mkdtemp, open, readFile, readlink, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { GIT_TIMEOUT_MS, MAX_UNTRACKED_PREVIEW_CHARS } from './contracts.ts'

export interface GitRunOptions {
  readonly cwd: string
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

export class GitError extends Error {
  readonly stderr: string
  constructor(message: string, stderr = '') {
    super(message)
    this.name = 'GitError'
    this.stderr = stderr
  }
}

export type GitRunner = (args: readonly string[], options: GitRunOptions) => Promise<string>

/** NUL separator used by `git status -z` without embedding a control byte in this source file. */
const NUL = String.fromCharCode(0)

/** Spawn git without a shell; arguments are passed literally. */
export const execGit: GitRunner = (args, options) => new Promise((resolve, reject) => {
  try {
    execFile('git', [...args], {
      cwd: options.cwd,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: options.timeoutMs ?? GIT_TIMEOUT_MS,
      signal: options.signal,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1' },
    }, (error, stdout, stderr) => {
      if (error) {
        if (options.signal?.aborted) {
          reject(Object.assign(new Error('dsh-git-commit: git command cancelled'), { code: 'cancelled' }))
          return
        }
        reject(Object.assign(new GitError(stderr.trim() || error.message, stderr), { code: (error as NodeJS.ErrnoException).code }))
        return
      }
      resolve(stdout)
    })
  } catch (error) {
    reject(error)
  }
})

export function isGitMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
}

export type ChangeStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked'

export interface ChangedFile {
  readonly path: string
  readonly status: ChangeStatus
  /** Rename source in porcelain -z output; committed with the destination. */
  readonly origin?: string
  /** True when the index already stages this path. */
  readonly staged: boolean
}

export function statusLetter(kind: ChangeStatus): string {
  switch (kind) {
    case 'added': return 'A'
    case 'deleted': return 'D'
    case 'renamed': return 'R'
    case 'copied': return 'C'
    case 'untracked': return '?'
    default: return 'M'
  }
}

/**
 * Parse `git status --porcelain=v1 -z --untracked-files=all` output.
 * In -z mode rename/copy entries put the destination path first, then a NUL, then the origin path.
 */
export function parsePorcelain(output: string): ChangedFile[] {
  const tokens = output.split(NUL)
  const files: ChangedFile[] = []
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index]
    index += 1
    if (!token) continue
    if (token.length < 4) continue
    const x = token[0] ?? ' '
    const y = token[1] ?? ' '
    const path = token.slice(3)
    if (x === '!' && y === '!') continue
    if (x === '?' && y === '?') {
      files.push({ path, status: 'untracked', staged: false })
      continue
    }
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      const origin = tokens[index]
      index += 1
      if (!origin) throw new GitError('dsh-git-commit: incomplete rename status')
      files.push({ path, origin, status: x === 'C' || y === 'C' ? 'copied' : 'renamed', staged: x !== ' ' && x !== '?' })
      continue
    }
    if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
      throw new GitError(`dsh-git-commit: resolve merge conflicts before committing (${path})`)
    }
    const status: ChangeStatus = x === 'D' || y === 'D' ? 'deleted' : x === 'A' || y === 'A' ? 'added' : 'modified'
    files.push({ path, status, staged: x !== ' ' && x !== '?' })
  }
  return files
}

export interface RepoInfo {
  readonly root: string
  readonly branch: string
}

export async function repoInfo(run: GitRunner, cwd: string, signal?: AbortSignal): Promise<RepoInfo> {
  const root = (await run(['rev-parse', '--show-toplevel'], { cwd, signal })).trim()
  let branch = (await run(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: root, signal }).catch(() => '')).trim()
  if (!branch) branch = (await run(['rev-parse', '--short', 'HEAD'], { cwd: root, signal }).catch(() => '')).trim()
  return { root, branch: branch || 'HEAD' }
}

export async function workingTreeChanges(run: GitRunner, root: string, signal?: AbortSignal): Promise<ChangedFile[]> {
  const output = await run(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: root, signal })
  return parsePorcelain(output)
}

/** Exact index/worktree content fingerprint, including untracked file bytes. */
export async function workspaceSnapshot(run: GitRunner, root: string, signal?: AbortSignal): Promise<{ files: ChangedFile[]; fingerprint: string }> {
  const status = await run(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: root, signal })
  const files = parsePorcelain(status)
  const hash = createHash('sha256').update(status)
  hash.update(await run(['symbolic-ref', '--quiet', 'HEAD'], { cwd: root, signal }).catch(() => 'DETACHED'))
  hash.update(await run(['rev-parse', 'HEAD'], { cwd: root, signal }).catch(() => 'unborn'))
  hash.update(await run(['diff', '--cached', '--binary', '--no-ext-diff'], { cwd: root, signal }))
  hash.update(await run(['diff', '--binary', '--no-ext-diff'], { cwd: root, signal }))
  for (const file of files) {
    if (file.status !== 'untracked') continue
    hash.update(file.path)
    hash.update(await worktreePathDigest(run, root, file.path, signal))
  }
  return { files, fingerprint: hash.digest('hex') }
}

/** A worktree content check for groups waiting behind earlier commits. */
export async function pathVersions(run: GitRunner, root: string, paths: readonly string[], signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256')
  for (const path of paths) {
    hash.update(path)
    hash.update(await worktreePathDigest(run, root, path, signal))
  }
  return hash.digest('hex')
}

async function worktreePathDigest(run: GitRunner, root: string, path: string, signal?: AbortSignal): Promise<string> {
  const absolute = resolve(root, path)
  let stat
  try {
    stat = await lstat(absolute)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
    throw error
  }
  const hash = createHash('sha256').update(String(stat.mode))
  if (stat.isSymbolicLink()) hash.update(await readlink(absolute))
  else if (stat.isFile()) {
    const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      if (!(await handle.stat()).isFile() || !(await lstat(absolute)).isFile()) throw new GitError(`dsh-git-commit: file changed while reading (${path})`)
      for await (const chunk of handle.createReadStream({ autoClose: false })) {
        signal?.throwIfAborted()
        hash.update(chunk)
      }
      if (!(await lstat(absolute)).isFile()) throw new GitError(`dsh-git-commit: file changed while reading (${path})`)
    } finally {
      await handle.close()
    }
  } else if (stat.isDirectory()) {
    hash.update(await run(['-C', absolute, 'rev-parse', 'HEAD'], { cwd: root, signal }))
    hash.update(await run(['-C', absolute, 'status', '--porcelain=v1', '-z'], { cwd: root, signal }))
  }
  return hash.digest('hex')
}

export async function recentSubjects(run: GitRunner, root: string, count: number, signal?: AbortSignal): Promise<string[]> {
  const output = await run(['log', `-${count}`, '--pretty=%s'], { cwd: root, signal }).catch(() => '')
  return output.split('\n').map(line => line.trim()).filter(Boolean)
}

/** Combined staged+worktree stat and diff against HEAD for the given paths. */
export async function diffAgainstHead(
  run: GitRunner, root: string, paths: readonly string[], signal?: AbortSignal,
): Promise<{ stat: string; diff: string }> {
  const args = paths.length > 0 ? ['--', ...paths] : []
  const stat = await run(['diff', 'HEAD', '--stat', '--no-color', ...args], { cwd: root, signal }).catch(() => '')
  const diff = await run(['diff', 'HEAD', '--no-color', '--no-ext-diff', ...args], { cwd: root, signal }).catch(() => '')
  return { stat, diff }
}

export interface UntrackedPreview {
  readonly path: string
  readonly preview: string
  readonly binary: boolean
}

export async function untrackedPreview(root: string, path: string): Promise<UntrackedPreview> {
  try {
    const absolute = resolve(root, path)
    const rootReal = await realpath(root)
    const withinRoot = async () => {
      const target = await realpath(absolute)
      const rel = relative(rootReal, target)
      return rel !== '' && rel !== '..' && !rel.startsWith(`..${String.fromCharCode(47)}`)
        && !rel.startsWith(`..${String.fromCharCode(92)}`) && !isAbsolute(rel)
    }
    if (!await withinRoot()) return { path, preview: '', binary: true }
    if (!(await lstat(absolute)).isFile()) return { path, preview: '', binary: true }
    const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    let buffer: Buffer
    try {
      const bounded = Buffer.alloc(MAX_UNTRACKED_PREVIEW_CHARS * 4)
      const { bytesRead } = await handle.read(bounded, 0, bounded.length, 0)
      buffer = bounded.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
    if (!await withinRoot() || !(await lstat(absolute)).isFile()) return { path, preview: '', binary: true }
    if (buffer.includes(0)) return { path, preview: '', binary: true }
    const text = buffer.toString('utf8')
    return { path, preview: text.slice(0, MAX_UNTRACKED_PREVIEW_CHARS), binary: false }
  } catch {
    return { path, preview: '', binary: true }
  }
}

export interface ExecutedCommit {
  readonly hash: string
  readonly skipped: boolean
}

async function indexBytes(path: string): Promise<Buffer | undefined> {
  try { return await readFile(path) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function headOid(run: GitRunner, root: string): Promise<string> {
  try { return (await run(['rev-parse', '--verify', 'HEAD'], { cwd: root })).trim() }
  catch (error) {
    if (error instanceof GitError && /Needed a single revision|not a valid object name HEAD/u.test(error.stderr)) return ''
    throw error
  }
}

/**
 * Commit each group from the worktree. `--only` keeps other staged paths out of
 * this commit; an exact index backup protects the current group on failure.
 */
export async function commitGroups(
  run: GitRunner,
  root: string,
  groups: ReadonlyArray<{ message: string; files: readonly string[] }>,
  selected: readonly ChangedFile[],
  signal?: AbortSignal,
  verify?: (paths: readonly string[]) => Promise<void>,
): Promise<ExecutedCommit[]> {
  const commits: ExecutedCommit[] = []
  for (const group of groups) {
    if (group.files.length === 0) continue
    const paths = group.files.flatMap(path => {
      const file = selected.find(file => file.path === path)
      return file?.status === 'renamed' && file.origin ? [path, file.origin] : [path]
    })
    await verify?.(paths)
    const gitPath = (await run(['rev-parse', '--git-path', 'index'], { cwd: root, signal })).trim()
    const indexPath = isAbsolute(gitPath) ? gitPath : resolve(root, gitPath)
    const backupDir = await mkdtemp(join(tmpdir(), 'dsh-git-commit-'))
    const backupPath = join(backupDir, 'index')
    let hadIndex = true
    try {
      try {
        await copyFile(indexPath, backupPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        hadIndex = false
      }
      const head = await headOid(run, root)
      const originalIndex = await indexBytes(indexPath)
      if (hadIndex ? !originalIndex?.equals(await readFile(backupPath)) : originalIndex !== undefined) {
        throw new GitError('dsh-git-commit: index changed before committing; retry')
      }
      let stagedIndex = originalIndex
      try {
        await run(['add', '-A', '--', ...group.files], { cwd: root, signal })
        stagedIndex = await indexBytes(indexPath)
        await run(['commit', '--quiet', '--only', '-m', group.message, '--', ...paths], { cwd: root, signal })
        const hash = (await run(['rev-parse', '--short', 'HEAD'], { cwd: root, signal })).trim()
        commits.push({ hash, skipped: false })
      } catch (error) {
        const currentHead = await headOid(run, root)
        const currentIndex = await indexBytes(indexPath)
        const indexUntouched = currentIndex === undefined ? stagedIndex === undefined : currentIndex.equals(stagedIndex ?? Buffer.alloc(0))
        if (currentHead === head && indexUntouched) {
          if (hadIndex) await copyFile(backupPath, indexPath)
          else await rm(indexPath, { force: true })
        }
        throw error
      }
    } finally {
      await rm(backupDir, { recursive: true, force: true })
    }
  }
  return commits
}

/** One deterministic commit for every selected path; used when the model plan is unavailable. */
export function fallbackGroup(files: readonly ChangedFile[], localeHint: 'zh' | 'en'): { message: string; files: readonly string[] } {
  const message = localeHint === 'zh'
    ? `chore: 提交 ${files.length} 个文件的修改`
    : `chore: commit changes to ${files.length} file${files.length === 1 ? '' : 's'}`
  return { message, files: files.map(file => file.path) }
}
