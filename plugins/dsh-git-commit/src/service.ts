import { callLlmText, resolveFeatureModel, type LlmTextCaller } from '@klarkxy/dsh-plugin-kit'
import { modelMenuOverride } from '@klarkxy/dsh-plugin-kit/model-menu'
import {
  DEFAULT_MAX_OUTPUT_TOKENS, RECENT_LOG_COUNT,
  defaultSettings, normalizeFallback, type CommitGroupResult, type CommitModelInfo, type CommitRunResult,
  type GitCommitSettings, type GitCommitStatus,
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
  readonly llm: LlmTextCaller
  readonly host?: unknown
  readonly sessions: SessionStoreLike
  readonly agents?: AgentStoreLike
  readonly run?: GitRunner
  readonly preview?: (root: string, path: string) => Promise<UntrackedPreview>
  /** Plugin-page settings row; absent keeps the shared purpose route. */
  readonly settings?: {
    load(): Promise<GitCommitSettings>
    save(settings: GitCommitSettings): Promise<void>
  }
}

export class CommitRunError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'CommitRunError'
    this.code = code
  }
}

function modelInfo(route: { provider: string; model: string } | undefined, source: CommitModelInfo['source']): CommitModelInfo | undefined {
  if (!route?.provider || !route.model) return undefined
  return { provider: route.provider, model: route.model, source }
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
  private running: Promise<unknown> | undefined
  private settings: GitCommitSettings
  private settingsPending: Promise<void> = Promise.resolve()
  private readonly settingsReady: Promise<void>
  private disposed = false

  constructor(deps: GitCommitServiceDeps) {
    this.deps = deps
    this.run = deps.run ?? execGit
    this.preview = deps.preview ?? untrackedPreview
    this.settings = defaultSettings()
    // The stored row is adopted once it resolves; a failed read keeps the default.
    this.settingsReady = deps.settings?.load().then(
      loaded => { if (loaded) this.settings = structuredClone(loaded) },
      () => { this.settings = defaultSettings() },
    ) ?? Promise.resolve()
  }

  /** Apply a freshly loaded settings row; the default stays until a row is read. */
  adoptSettings(next: GitCommitSettings): void {
    this.settings = structuredClone(next)
  }

  getSettings(): GitCommitSettings {
    return structuredClone(this.settings)
  }

  private selectedModel() {
    const page = modelMenuOverride(this.settings.model)
    return { route: resolveFeatureModel(this.deps.host, page), source: page ? 'page' as const : 'default' as const }
  }

  async updateSettings(patch: Omit<GitCommitSettings, 'revision'>, expectedRevision: number): Promise<GitCommitSettings> {
    const detached = structuredClone(patch)
    const result = this.settingsPending.then(async () => {
      await this.settingsReady
      if (this.disposed) throw new CommitRunError('disposed', 'dsh-git-commit: plugin disabled')
      if (expectedRevision !== this.settings.revision) {
        throw new CommitRunError('stale', 'dsh-git-commit: settings changed; reload and retry')
      }
      const next: GitCommitSettings = {
        revision: expectedRevision + 1,
        model: detached.model,
        allowFallback: normalizeFallback(detached.allowFallback),
      }
      await this.deps.settings?.save(next)
      this.settings = next
      return this.getSettings()
    })
    this.settingsPending = result.then(() => {}, () => {})
    return result
  }

  start(): void {}

  async dispose(): Promise<void> {
    this.disposed = true
    await this.settingsPending
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
    const selected = this.selectedModel()
    const model = modelInfo(selected.route, selected.source)
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
      if (this.disposed || !this.deps.llm) throw new CommitRunError('cancelled', 'dsh-git-commit: plugin is no longer active')
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
    let planFailure = 'no model route was available'
    let model: CommitModelInfo | undefined
    const planned = this.selectedModel()
    if (planned.route) {
      try {
        const result = await callLlmText(this.deps.llm, {
          plugin: this.deps.plugin,
          route: planned.route,
          system: planSystemPrompt(),
          text: buildPlanInput({ files: selected, recentSubjects: subjects, stat, diff, untracked }),
          maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
          signal: signal ?? new AbortController().signal,
          sessionId,
        })
        model = modelInfo(result, planned.source)
        groups = parsePlan(result.text, selected)
        if (!groups) planFailure = 'the model returned a plan that does not cover the change set'
      } catch (error) {
        if (error instanceof CommitRunError) throw error
        planFailure = error instanceof Error ? error.message : String(error)
      }
    }

    // Without a plan the run would write commits nobody asked for, so it stops
    // here — before the index or the worktree is touched. A single fallback
    // commit stays available, but only when the settings row asked for it.
    if (!groups && !this.settings.allowFallback) {
      throw new CommitRunError('plan-unavailable', `dsh-git-commit: no commit plan (${planFailure})`)
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
