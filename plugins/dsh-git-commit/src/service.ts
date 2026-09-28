import type { AiFeatureScope, AiServices, ResolvedRoute } from '@klarkxy/dsh-ai-services/contracts'
import {
  CONTRACT_VERSION, DEFAULT_MAX_OUTPUT_TOKENS, PROMPT_VERSION, PURPOSE_ID, RECENT_LOG_COUNT, SCHEMA_VERSION,
  type CommitGroupResult, type CommitModelInfo, type CommitRunResult, type GitCommitStatus,
} from './contracts.ts'
import {
  commitGroups, diffAgainstHead, execGit, fallbackGroup, isGitMissing, pathVersions, recentSubjects, repoInfo,
  untrackedPreview, workspaceSnapshot, workingTreeChanges, type ChangedFile, type GitRunner, type UntrackedPreview,
} from './git.ts'
import { buildPlanInput, parsePlan, planSystemPrompt, type PlanGroup } from './plan.ts'

export interface SessionLike {
  readonly id: string
  readonly header?: { readonly cwd?: string }
}

export interface SessionStoreLike {
  get(id: string): SessionLike | undefined
}

export interface AgentStoreLike {
  get(id: string): { readonly status?: string } | undefined
}

export interface GitCommitServiceDeps {
  readonly plugin: string
  readonly ai: AiServices
  readonly sessions: SessionStoreLike
  readonly agents?: AgentStoreLike
  readonly run?: GitRunner
  readonly preview?: (root: string, path: string) => Promise<UntrackedPreview>
}

export class CommitRunError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'CommitRunError'
    this.code = code
  }
}

function modelInfo(route: ResolvedRoute | undefined): CommitModelInfo | undefined {
  if (!route?.provider || !route.model) return undefined
  return { provider: route.provider, model: route.model, source: route.source }
}

function looksChinese(subjects: readonly string[]): boolean {
  return subjects.some(subject => /[一-鿿]/u.test(subject))
}

function normalizeCwd(cwd: string | undefined): string | undefined {
  if (typeof cwd !== 'string') return undefined
  const normalized = cwd.trim().replaceAll('\\', '/')
  if (!normalized) return undefined
  return normalized === '/' || /^[A-Za-z]:\/$/.test(normalized) ? normalized : normalized.replace(/\/+$/, '')
}

export class GitCommitService {
  private readonly deps: GitCommitServiceDeps
  private readonly run: GitRunner
  private readonly preview: (root: string, path: string) => Promise<UntrackedPreview>
  private scope: AiFeatureScope | undefined
  private disposePurpose: (() => void) | undefined
  private running: Promise<unknown> | undefined

  constructor(deps: GitCommitServiceDeps) {
    this.deps = deps
    this.run = deps.run ?? execGit
    this.preview = deps.preview ?? untrackedPreview
  }

  start(): void {
    this.scope = this.deps.ai.activate(this.deps.plugin)
    this.disposePurpose = this.scope.registerPurpose({
      id: PURPOSE_ID,
      label: 'Git 提交',
      // Configurable in advance via the AI-services purpose route; unset roles
      // inherit the normal tier and finally the default chat model.
      defaultTarget: { kind: 'role', role: 'weak' },
      maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    })
  }

  async dispose(): Promise<void> {
    this.disposePurpose?.()
    this.scope?.dispose()
    this.scope = undefined
    await this.running?.catch(() => {})
  }

  private async resolveRepo(sessionId: string): Promise<{ root: string; branch: string }> {
    const session = this.deps.sessions.get(sessionId)
    if (!session) throw new CommitRunError('no-session', 'dsh-git-commit: session is not live on this host')
    const cwd = normalizeCwd(session.header?.cwd)
    if (!cwd) throw new CommitRunError('no-cwd', 'dsh-git-commit: session has no working directory')
    try {
      return await repoInfo(this.run, cwd)
    } catch (error) {
      if (isGitMissing(error)) throw new CommitRunError('no-git', 'dsh-git-commit: git executable not found')
      throw new CommitRunError('not-a-repo', 'dsh-git-commit: session directory is not inside a git repository')
    }
  }

  async status(sessionId: string): Promise<GitCommitStatus> {
    let resolved
    try {
      resolved = await this.resolveRepo(sessionId)
    } catch (error) {
      if (error instanceof CommitRunError) {
        return { available: false, reason: error.code, detail: error.message, workspace: { files: 0 } }
      }
      throw error
    }
    const changes = await workingTreeChanges(this.run, resolved.root)
    let model: CommitModelInfo | undefined
    if (this.scope?.active) {
      model = await this.deps.ai.resolve(PURPOSE_ID, sessionId).then(modelInfo, () => undefined)
    }
    return {
      available: true,
      root: resolved.root,
      branch: resolved.branch,
      workspace: { files: changes.length },
      ...(model ? { model } : {}),
    }
  }

  async commit(sessionId: string, signal?: AbortSignal): Promise<CommitRunResult> {
    if (this.running) throw new CommitRunError('busy', 'dsh-git-commit: a commit run is already in progress')
    const run = this.runCommit(sessionId, signal)
    this.running = run
    try {
      return await run
    } finally {
      this.running = undefined
    }
  }

  private async runCommit(sessionId: string, signal?: AbortSignal): Promise<CommitRunResult> {
    const session = this.deps.sessions.get(sessionId)
    const sessionCwd = normalizeCwd(session?.header?.cwd)
    const resolved = await this.resolveRepo(sessionId)
    const assertReady = () => {
      signal?.throwIfAborted()
      if (!this.scope?.active) throw new CommitRunError('cancelled', 'dsh-git-commit: plugin is no longer active')
      const currentSession = this.deps.sessions.get(sessionId)
      if (currentSession !== session || normalizeCwd(currentSession?.header?.cwd) !== sessionCwd) {
        throw new CommitRunError('session-changed', 'dsh-git-commit: session workspace changed during planning')
      }
      if (this.deps.agents?.get(sessionId)?.status === 'running') {
        throw new CommitRunError('session-running', 'dsh-git-commit: wait for the session turn to finish')
      }
    }
    assertReady()
    const initial = await workspaceSnapshot(this.run, resolved.root, signal)
    const branchRef = await this.run(['symbolic-ref', '--quiet', 'HEAD'], { cwd: resolved.root, signal }).catch(() => 'DETACHED')
    const selected: ChangedFile[] = initial.files
    if (selected.length === 0) {
      throw new CommitRunError('no-changes', 'dsh-git-commit: working tree is clean')
    }
    const paths = selected.flatMap(file => file.status === 'renamed' && file.origin ? [file.path, file.origin] : [file.path])
    const originalVersions = await pathVersions(this.run, resolved.root, paths, signal)
    const [{ stat, diff }, subjects] = await Promise.all([
      diffAgainstHead(this.run, resolved.root, paths, signal),
      recentSubjects(this.run, resolved.root, RECENT_LOG_COUNT, signal),
    ])
    const untracked: UntrackedPreview[] = []
    for (const file of selected) {
      if (file.status === 'untracked') untracked.push(await this.preview(resolved.root, file.path))
    }

    let groups: PlanGroup[] | undefined
    let model: CommitModelInfo | undefined
    const scope = this.scope
    if (scope?.active) {
      try {
        const result = await scope.run({
          purpose: PURPOSE_ID,
          sessionId,
          input: buildPlanInput({ files: selected, recentSubjects: subjects, stat, diff, untracked }),
          system: planSystemPrompt(),
          sourceVersion: `${sessionId}:${initial.fingerprint}`,
          contractVersion: CONTRACT_VERSION,
          promptVersion: PROMPT_VERSION,
          schemaVersion: SCHEMA_VERSION,
          signal,
          priority: 'interactive',
        })
        model = modelInfo(result.receipt.route)
        if (result.receipt.status === 'cancelled') throw new CommitRunError('cancelled', 'dsh-git-commit: planning was cancelled')
        groups = parsePlan(result.text, selected)
      } catch (error) {
        if (error instanceof CommitRunError) throw error
        groups = undefined
      }
    }

    assertReady()
    const current = await workspaceSnapshot(this.run, resolved.root, signal)
    if (current.fingerprint !== initial.fingerprint) {
      throw new CommitRunError('workspace-changed', 'dsh-git-commit: workspace changed during planning; retry the commit')
    }
    const effective = groups ?? [fallbackGroup(selected, looksChinese(subjects) ? 'zh' : 'en')]
    const executed = await commitGroups(this.run, resolved.root, effective, selected, signal, async () => {
      assertReady()
      const currentBranchRef = await this.run(['symbolic-ref', '--quiet', 'HEAD'], { cwd: resolved.root, signal }).catch(() => 'DETACHED')
      if (currentBranchRef !== branchRef) {
        throw new CommitRunError('workspace-changed', 'dsh-git-commit: branch changed during the commit run')
      }
      if (await pathVersions(this.run, resolved.root, paths, signal) !== originalVersions) {
        throw new CommitRunError('workspace-changed', 'dsh-git-commit: selected file changed during the commit run')
      }
      // A new merge conflict must never be passed to git add or git commit.
      await workingTreeChanges(this.run, resolved.root, signal)
    })
    const commits: CommitGroupResult[] = []
    for (let index = 0; index < effective.length; index += 1) {
      const result = executed[index]
      const group = effective[index]
      if (!result || !group || result.skipped) continue
      commits.push({ hash: result.hash, message: group.message, files: group.files })
    }
    if (commits.length === 0) throw new CommitRunError('no-changes', 'dsh-git-commit: nothing was committed')
    return {
      branch: resolved.branch,
      commits,
      fallback: groups === undefined,
      ...(model ? { model } : {}),
    }
  }
}
