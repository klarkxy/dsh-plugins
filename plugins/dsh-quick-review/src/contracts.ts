import { defaultModelRoute, normalizeModelRoute, type ModelRoute } from '@klarkxy/dsh-model-route'
export { defaultModelRoute, normalizeModelRoute }

/** Browser-safe contracts. Shared RPC/result types stay on @klarkxy/dsh-plugin-kit. */
import type { RpcResult as SharedRpcResult } from '@klarkxy/dsh-plugin-kit/contracts'
export type RpcResult<T = unknown> = SharedRpcResult<T>

export const PLUGIN_NAME = '@klarkxy/dsh-quick-review'
export const RPC_CHANNEL = '/dsh-quick-review'
export const QUICK_REVIEW_CLIENT_SERVICE = 'dshQuickReviewClient'
export const SETTINGS_KEY = 'current'

/** Resource protocol of the right-sidebar review tab (`dsh-resource://quickreview/session/<id>`). */
export const RESOURCE_PROTOCOL = 'quickreview'
export const REVIEW_TAB_ID = PLUGIN_NAME
/** Host preset the review session is pinned to (sandbox read-only + approval ask). */
export const REVIEW_PERMISSION_PRESET = 'read-only'

/** Popover model pick. Empty provider/model means "follow the host default model". */
export type ReviewModelRoute = ModelRoute

/** A selection concrete enough to hand to `agent.model.select`. */
export interface ResolvedModel {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/**
 * What the review session is asked to look at.
 * `session`: the source session's own recorded file changes (union of every
 * `workspace/changes` summary). `workspace`: the host recorded no usable
 * summary (fresh session or a restarted host), so the reviewer covers all
 * uncommitted changes in the workspace instead.
 */
export type ReviewScope =
  | { readonly kind: 'session'; readonly files: readonly string[] }
  | { readonly kind: 'workspace' }

export type ReviewState = 'running' | 'sent' | 'failed'

export interface ReviewStatus {
  readonly reviewSessionId: string
  readonly sourceSessionId: string
  readonly state: ReviewState
  readonly model: ResolvedModel
  readonly scope: ReviewScope
  /** Machine-readable failure note when `state` is 'failed'. */
  readonly error?: string
}

export interface ReviewStatusValue {
  readonly review?: ReviewStatus
  /** True when the queried session id is itself a tracked review session. */
  readonly isReview?: boolean
}

export interface ReviewStartValue {
  readonly reviewSessionId: string
  readonly scope: ReviewScope
  readonly model: ResolvedModel
}

export interface QuickReviewSettings {
  readonly revision: number
  readonly model: ReviewModelRoute
}

export const defaultSettings = (): QuickReviewSettings => ({ revision: 0, model: defaultModelRoute() })

/** Build the sidebar resource address for one review session. */
export function reviewAddress(reviewSessionId: string, sourceSessionId: string): string {
  const query = new URLSearchParams({ source: sourceSessionId })
  return `dsh-resource://${RESOURCE_PROTOCOL}/session/${encodeURIComponent(reviewSessionId)}?${query}`
}

export interface ParsedReviewAddress {
  readonly reviewSessionId: string
  readonly sourceSessionId?: string
}

/** Parse one review resource address; undefined for another protocol or a malformed address. */
export function parseReviewAddress(value: string): ParsedReviewAddress | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  if (url.protocol !== 'dsh-resource:' || url.hostname.toLowerCase() !== RESOURCE_PROTOCOL) return undefined
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length !== 2 || parts[0] !== 'session') return undefined
  try {
    const reviewSessionId = decodeURIComponent(parts[1] as string)
    if (reviewSessionId === '') return undefined
    const source = url.searchParams.get('source')
    return {
      reviewSessionId,
      ...(source === null || source === '' ? {} : { sourceSessionId: source }),
    }
  } catch {
    return undefined
  }
}
