/** Browser-safe contracts. Shared RPC/result types stay on @klarkxy/dsh-plugin-kit. */
export type { RpcResult } from '@klarkxy/dsh-plugin-kit/contracts'

export const PLUGIN_NAME = '@klarkxy/dsh-git-commit'
export const FEATURE_ID = 'git-commit'
export const PURPOSE_ID = 'git-commit.plan'
export const RPC_CHANNEL = '/dsh-git-commit'
export const GIT_COMMIT_CLIENT_SERVICE = 'dshGitCommitClient'
export const PROMPT_VERSION = 'git-commit.v1'
export const SCHEMA_VERSION = 'commit-plan-json.v1'
export const CONTRACT_VERSION = 1

export const DEFAULT_MAX_OUTPUT_TOKENS = 2048
/** Total character budget for the change manifest sent to the model. */
export const MAX_MANIFEST_CHARS = 48_000
/** Per-file preview cap for untracked files. */
export const MAX_UNTRACKED_PREVIEW_CHARS = 2_000
/** Recent commit subjects supplied as style reference. */
export const RECENT_LOG_COUNT = 10
/** Hard cap for one generated commit message line. */
export const MAX_MESSAGE_CHARS = 120
/** git subprocess timeout. */
export const GIT_TIMEOUT_MS = 30_000
export const SETTINGS_KEY = 'current'

/** Plugin-page model selection. Empty provider/model means "follow the default". */
export interface CommitModelRoute {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

export interface GitCommitSettings {
  readonly revision: number
  readonly model: CommitModelRoute
  /**
   * Opt-in single commit when the model produced no usable plan. Off by
   * default: an unplanned commit is one the user never reviewed, so a failed
   * or unusable model call rejects the run instead of writing to the index.
   */
  readonly allowFallback: boolean
}

export const defaultModelRoute = (): CommitModelRoute => ({ provider: '', model: '' })

export const defaultSettings = (): GitCommitSettings => ({
  revision: 0, model: defaultModelRoute(), allowFallback: false,
})

/** Untrusted stored flags stay opt-in: anything but a literal true is false. */
export function normalizeFallback(value: unknown): boolean {
  return value === true
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** Untrusted stored routes collapse to the default so a bad row never breaks the run. */
export function normalizeModelRoute(value: unknown): CommitModelRoute {
  const row = asRecord(value)
  if (!row) return defaultModelRoute()
  const provider = asText(row.provider) ?? ''
  const model = asText(row.model) ?? ''
  const effort = asText(row.reasoningEffort)
  if (!provider || !model || provider.length > 250 || model.length > 250) return defaultModelRoute()
  return effort && effort.length <= 80 ? { provider, model, reasoningEffort: effort } : { provider, model }
}

export interface CommitModelInfo {
  readonly provider: string
  readonly model: string
  /** 'page' is the plugin-page selection; 'default' is the host chat model. */
  readonly source: 'page' | 'default'
}

export interface GitCommitStatus {
  readonly available: boolean
  /** Machine-readable reason when unavailable: 'no-session' | 'no-cwd' | 'not-a-repo' | 'no-git'. */
  readonly reason?: string
  readonly detail?: string
  readonly root?: string
  readonly branch?: string
  readonly workspace: { readonly files: number }
  readonly model?: CommitModelInfo
}

export interface CommitGroupResult {
  readonly hash: string
  readonly message: string
  readonly files: readonly string[]
}

export interface CommitRunResult {
  readonly branch: string
  readonly commits: readonly CommitGroupResult[]
  /** True when the model plan was unavailable and a single fallback commit was used. */
  readonly fallback: boolean
  readonly model?: CommitModelInfo
}
