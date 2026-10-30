import type { PresenceRpc } from './presence-model.ts'
import {
  RETRY_CAPABILITIES_ENDPOINT,
  RETRY_COMMIT_ENDPOINT,
  RETRY_PREVIEW_ENDPOINT,
  type RetryCapabilities,
  type RetryCommitRequest,
  type RetryCommitValue,
  type RetryPreviewRequest,
  type RetryPreviewValue,
} from './retry-contracts.ts'
import { TEMP_WORKSPACE_CHANNEL } from './contracts.ts'
import { HostOperationError, unwrap } from './session-actions.ts'

export interface RetryHost {
  capabilities: () => Promise<RetryCapabilities>
  preview: (request: RetryPreviewRequest, signal?: AbortSignal) => Promise<RetryPreviewValue>
  commit: (request: RetryCommitRequest, signal?: AbortSignal) => Promise<RetryCommitValue>
}

export function bindRetryHost(rpc: PresenceRpc | undefined): RetryHost {
  const call = (endpoint: string, payload: unknown, signal?: AbortSignal) => {
    if (typeof rpc?.call !== 'function') throw new HostOperationError('session/lifecycle-unavailable')
    return rpc.call(TEMP_WORKSPACE_CHANNEL, endpoint, payload, signal)
  }
  return {
    async capabilities() {
      const value = await unwrap(call(RETRY_CAPABILITIES_ENDPOINT, {}))
      if (!isCapabilities(value)) throw new HostOperationError('session-manager/unavailable')
      return value
    },
    async preview(request, signal) {
      const value = await unwrap(call(RETRY_PREVIEW_ENDPOINT, request, signal))
      if (!isPreview(value)) throw new HostOperationError('session-manager/unavailable')
      return value
    },
    async commit(request, signal) {
      const value = await unwrap(call(RETRY_COMMIT_ENDPOINT, request, signal))
      if (!isCommit(value)) throw new HostOperationError('session-manager/unavailable')
      return value
    },
  }
}

/**
 * Commit then navigate: the forked child is the chat the user keeps, so the
 * browser follows a successful commit to the new session. `open` is absent
 * only when the host has no workspace navigation; the commit value returns
 * either way.
 */
export function retryCommitAndOpen(
  commit: RetryHost['commit'],
  open: ((sessionId: string) => void | Promise<void>) | undefined,
): RetryHost['commit'] {
  return async (request, signal) => {
    const value = await commit(request, signal)
    try { await open?.(value.sessionId) }
    catch { throw new HostOperationError('session/retry-pending') }
    return value
  }
}

function isCapabilities(value: unknown): value is RetryCapabilities {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Partial<RetryCapabilities>
  return typeof item.retry === 'boolean'
    && typeof item.retryModified === 'boolean'
    && typeof item.retryContent === 'boolean'
}

function isPreview(value: unknown): value is RetryPreviewValue {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Partial<RetryPreviewValue>
  return typeof item.sessionId === 'string'
    && typeof item.messageId === 'string'
    && Number.isSafeInteger(item.promptSeq)
    && typeof item.branchRevision === 'number'
    && typeof item.inputRevision === 'string'
    && typeof item.eligible === 'boolean'
    && typeof item.modified === 'boolean'
}

function isCommit(value: unknown): value is RetryCommitValue {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Partial<RetryCommitValue>
  return typeof item.sessionId === 'string'
    && typeof item.sourceSessionId === 'string'
    && typeof item.archived === 'boolean'
}
