import { callLlmText, resolveFeatureModel, type LlmTextCaller } from '@klarkxy/dsh-plugin-kit'
import { modelRouteOverride } from '@klarkxy/dsh-model-route'
import {
  DEFAULT_MAX_OUTPUT_TOKENS, RECENT_LOG_COUNT,
  defaultSettings, normalizeFallback, type CommitGroupResult, type CommitModelInfo, type CommitRunResult,
  type GitCommitSettings, type GitCommitStatus, type PartialCommitResult,
} from './contracts.ts'
import {
  commitGroups, diffAgainstHead, execGit, fallbackGroup, isGitMissing, PartialCommitError, pathVersions, recentSubjects, repoInfo,
  untrackedPreview, workspaceSnapshot, workingTreeChanges, type ChangedFile, type ExecutedCommit, type GitRunner, type UntrackedPreview,
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
  readonly onSettingsChanged?: (revision: number) => void
  readonly llm: LlmTextCaller
  readonly host?: unknown
  readonly sessions: SessionStoreLike
  readonly workingDirectory: { get(session: SessionLike): string }
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
  /** Commits already created when this run stopped. Absent when nothing was written. */
  readonly partial?: PartialCommitResult
  constructor(code: string, message: string, partial?: PartialCommitResult) {
    super(message)
    this.name = code === 'cancelled' ? 'AbortError' : 'CommitRunError'
    this.code = code
    this.partial = partial
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
  private settingsFailure: CommitRunError | undefined
  private settingsAdopted = false
  private disposed = false
  /** Aborted on unload so an in-flight model plan receives the same signal as a cancelled request. */
  private readonly lifetime = new AbortController()

  constructor(deps: GitCommitServiceDeps) {
    this.deps = deps
    this.run = deps.run ?? execGit
    this.preview = deps.preview ?? untrackedPreview
    this.settings = defaultSettings()
    // A missing row is resolved by storage; an unreadable row must not select a different model.
    this.settingsReady = deps.settings?.load().then(
      loaded => { if (loaded && !this.settingsAdopted) this.settings = structuredClone(loaded) },
      () => {
        if (!this.settingsAdopted) this.settingsFailure = new CommitRunError(
          'settings-unavailable', 'dsh-git-commit: saved settings could not be read; reload the plugin before retrying',
        )
      },
    ) ?? Promise.resolve()
  }

  /** A refreshed row wins over a pending initial read. */
  adoptSettings(next: GitCommitSettings): void {
    if (this.disposed) throw new CommitRunError('disposed', 'dsh-git-commit: plugin disabled')
    this.settingsAdopted = true
    this.settingsFailure = undefined
    this.settings = structuredClone(next)
  }

  /** Existing synchronous snapshot API; host operations wait for initialization first. */
  getSettings(): GitCommitSettings {
    this.workSignal()
    if (this.settingsFailure) throw this.settingsFailure
    return structuredClone(this.settings)
  }

  async ready(): Promise<void> {
    this.workSignal()
    await this.settingsReady
    this.workSignal()
    if (this.settingsFailure) throw this.settingsFailure
  }

  /** Request cancellation and plugin unload share one signal. A disposed service rejects before any new work. */
  private workSignal(signal?: AbortSignal): AbortSignal {
    if (this.disposed || this.lifetime.signal.aborted) {
      throw new CommitRunError('disposed', 'dsh-git-commit: plugin is no longer active')
    }
    return signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal
  }

  private async waitForSettings(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    if (!signal) { await this.ready(); return }
    let onAbort: () => void = () => {}
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => {
        try { signal.throwIfAborted() }
        catch (error) { reject(error) }
      }
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
    })
    try { await Promise.race([this.settingsReady, aborted]) }
    finally { signal.removeEventListener('abort', onAbort) }
    signal.throwIfAborted()
    if (this.settingsFailure) throw this.settingsFailure
  }

  private selectedModel(sessionId: string) {
    const page = modelRouteOverride(this.settings.model)
    return { route: resolveFeatureModel(this.deps.host, page, sessionId), source: page ? 'page' as const : 'default' as const }
  }

  async updateSettings(patch: Omit<GitCommitSettings, 'revision'>, expectedRevision: number): Promise<GitCommitSettings> {
    const detached = structuredClone(patch)
    const result = this.settingsPending.then(async () => {
      await this.ready()
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
      try { this.deps.onSettingsChanged?.(next.revision) } catch {}
      return structuredClone(next)
    })
    this.settingsPending = result.then(() => {}, () => {})
    return result
  }

  start(): void {}

  async dispose(): Promise<void> {
    this.disposed = true
    this.lifetime.abort()
    await this.settingsReady
    await this.settingsPending
    await this.running?.catch(() => {})
  }

  private async resolveRepo(sessionId: string, signal?: AbortSignal): Promise<{ root: string; branch: string }> {
    const session = this.deps.sessions.get(sessionId)
    if (!session) throw new CommitRunError('no-session', 'dsh-git-commit: session is not live on this host')
    const cwd = normalizeCwd(this.deps.workingDirectory.get(session))
    if (!cwd) throw new CommitRunError('no-cwd', 'dsh-git-commit: session has no working directory')
    try {
      return await repoInfo(this.run, cwd, signal)
    } catch (error) {
      signal?.throwIfAborted()
      if (isGitMissing(error)) throw new CommitRunError('no-git', 'dsh-git-commit: git executable not found')
      throw new CommitRunError('not-a-repo', 'dsh-git-commit: session directory is not inside a git repository')
    }
  }

  async status(sessionId: string, signal?: AbortSignal): Promise<GitCommitStatus> {
    const work = this.workSignal(signal)
    await this.waitForSettings(work)
    let resolved
    try {
      resolved = await this.resolveRepo(sessionId, work)
    } catch (error) {
      if (error instanceof CommitRunError) {
        return { available: false, reason: error.code, detail: error.message, workspace: { files: 0 } }
      }
      throw error
    }
    const changes = await workingTreeChanges(this.run, resolved.root, work)
    work.throwIfAborted()
    const selected = this.selectedModel(sessionId)
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
    if (this.disposed || this.lifetime.signal.aborted) {
      throw new CommitRunError('disposed', 'dsh-git-commit: plugin is no longer active')
    }
    if (this.running) throw new CommitRunError('busy', 'dsh-git-commit: a commit run is already in progress')
    const work = this.workSignal(signal)
    const run = this.runCommit(sessionId, work)
    this.running = run
    try {
      return await run
    } catch (error) {
      if (error instanceof CommitRunError && error.partial) throw error
      if (work.aborted) throw new CommitRunError('cancelled', 'dsh-git-commit: commit run cancelled')
      throw error
    } finally {
      this.running = undefined
    }
  }

  private async runCommit(sessionId: string, signal: AbortSignal): Promise<CommitRunResult> {
    await this.waitForSettings(signal)
    if (this.disposed || signal?.aborted) throw new CommitRunError('cancelled', 'dsh-git-commit: plugin is no longer active')
    const session = this.deps.sessions.get(sessionId)
    const sessionCwd = session ? normalizeCwd(this.deps.workingDirectory.get(session)) : undefined
    const resolved = await this.resolveRepo(sessionId, signal)
    const assertReady = () => {
      signal?.throwIfAborted()
      if (this.disposed || !this.deps.llm) throw new CommitRunError('cancelled', 'dsh-git-commit: plugin is no longer active')
      const currentSession = this.deps.sessions.get(sessionId)
      if (currentSession !== session || (currentSession ? normalizeCwd(this.deps.workingDirectory.get(currentSession)) : undefined) !== sessionCwd) {
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
      assertReady()
      if (file.status === 'untracked') untracked.push(await this.preview(resolved.root, file.path))
    }

    let groups: PlanGroup[] | undefined
    let planFailure = 'no model route was available'
    let model: CommitModelInfo | undefined
    const planned = this.selectedModel(sessionId)
    if (planned.route) {
      try {
        const result = await callLlmText(this.deps.llm, {
          plugin: this.deps.plugin,
          route: planned.route,
          system: planSystemPrompt(),
          text: buildPlanInput({ files: selected, recentSubjects: subjects, stat, diff, untracked }),
          maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
          signal,
          sessionId,
        })
        model = modelInfo(result, planned.source)
        groups = parsePlan(result.text, selected)
        if (!groups) planFailure = 'the model returned a plan that does not cover the change set'
      } catch (error) {
        assertReady()
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
    const describe = (executed: readonly ExecutedCommit[]): CommitGroupResult[] => {
      const commits: CommitGroupResult[] = []
      for (let index = 0; index < executed.length; index += 1) {
        const result = executed[index]
        const group = effective[index]
        if (!result || !group || result.skipped) continue
        commits.push({ hash: result.hash, message: group.message, files: [...group.files] })
      }
      return commits
    }
    let executed: ExecutedCommit[]
    try {
      const commitRun: GitRunner = (args, options) => {
        // Async index preparation can yield after verification. Recheck the
        // session immediately before either Git mutation is dispatched.
        if (args[0] === 'add' || args[0] === 'commit') assertReady()
        return this.run(args, options)
      }
      executed = await commitGroups(commitRun, resolved.root, effective, selected, signal, async () => {
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
        assertReady()
      })
    } catch (error) {
      if (!(error instanceof PartialCommitError)) throw error
      const commits = describe(error.commits)
      const cause = error.cause
      const cancelled = signal?.aborted
        || (typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === 'cancelled')
        || (cause instanceof Error && cause.name === 'AbortError')
      const code = cause instanceof CommitRunError ? cause.code : cancelled ? 'cancelled' : 'commit-failed'
      const message = cause instanceof Error ? cause.message : String(cause)
      throw new CommitRunError(code, message, {
        branch: resolved.branch,
        commits,
        fallback: groups === undefined,
        failure: { code, message },
        remaining: effective.slice(error.commits.length + (error.uncertain ? 1 : 0)).map(group => ({ message: group.message, files: [...group.files] })),
        ...(error.uncertain ? { uncertain: [error.uncertain] } : {}),
        ...(model ? { model } : {}),
      })
    }
    const commits = describe(executed)
    if (commits.length === 0) throw new CommitRunError('no-changes', 'dsh-git-commit: nothing was committed')
    return {
      branch: resolved.branch,
      commits,
      fallback: groups === undefined,
      ...(model ? { model } : {}),
    }
  }
}
