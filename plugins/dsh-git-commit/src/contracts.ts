import { defaultModelRoute, normalizeModelRoute, type ModelRoute } from '@klarkxy/dsh-model-route'
export { defaultModelRoute, normalizeModelRoute }

/** Browser-safe contracts. Shared RPC/result types stay on @klarkxy/dsh-plugin-kit. */
import type { RpcResult as SharedRpcResult } from '@klarkxy/dsh-plugin-kit/contracts'
export type RpcResult<T = unknown> = Extract<SharedRpcResult<T>, { ok: true }> | {
  ok: false
  error: { code: string; message: string; partial?: PartialCommitResult }
}

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

/**
 * Plugin-page model selection. Empty provider/model means "follow the default".
 * The value shape, empty default, and 250/80 normalizer live in
 * @klarkxy/dsh-model-route; this alias keeps the commit-specific name.
 */
export type CommitModelRoute = ModelRoute

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

export const defaultSettings = (): GitCommitSettings => ({
  revision: 0, model: defaultModelRoute(), allowFallback: false,
})

/** Untrusted stored flags stay opt-in: anything but a literal true is false. */
export function normalizeFallback(value: unknown): boolean {
  return value === true
}

export interface CommitModelInfo {
  readonly provider: string
  readonly model: string
  /** 'page' is the plugin-page selection; 'default' follows the session or host chat model. */
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
  /** Empty only when a created commit's hash could not be read. */
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

/**
 * Commits that already exist when a later group fails or the run is cancelled.
 * `commits` is the durable outcome; `failure` is why the rest did not run.
 * A recorded commit is never rolled back and never retried by this plugin.
 */
export interface PartialCommitResult {
  readonly branch: string
  readonly commits: readonly CommitGroupResult[]
  readonly fallback: boolean
  readonly model?: CommitModelInfo
  readonly failure: { readonly code: string; readonly message: string }
  readonly remaining: readonly { readonly message: string; readonly files: readonly string[] }[]
  /** After a rejected commit command, unchanged HEAD could not be proved; completion and ownership are unconfirmed. */
  readonly uncertain?: readonly { readonly message: string; readonly files: readonly string[] }[]
}
