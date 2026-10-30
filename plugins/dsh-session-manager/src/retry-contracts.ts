import type { PromptContent } from './edit-host.ts'

export const RETRY_CAPABILITIES_ENDPOINT = 'retry.capabilities'
export const RETRY_PREVIEW_ENDPOINT = 'retry.preview'
export const RETRY_COMMIT_ENDPOINT = 'retry.commit'

export interface RetryCapabilities {
  readonly retry: boolean
  readonly retryModified: boolean
  readonly retryContent: boolean
}

export interface RetryPreviewRequest {
  readonly sessionId: string
  readonly messageId: string
}

export interface RetryPreviewValue {
  readonly sessionId: string
  readonly messageId: string
  readonly promptSeq: number
  readonly branchRevision: number
  readonly inputRevision: string
  readonly eligible: boolean
  readonly modified: boolean
  readonly reason?: string
}

export interface RetryCommitRequest {
  readonly sessionId: string
  readonly messageId: string
  readonly expectedRevision: number
  readonly expectedInputRevision: string
  readonly requestId: string
  readonly text?: string
  readonly content?: readonly PromptContent[]
  readonly allowModified?: boolean
}

export interface RetryCommitValue {
  /** The forked session the conversation continues in. */
  readonly sessionId: string
  /** The session the prompt was edited out of. */
  readonly sourceSessionId: string
  /** Whether the source session was moved to the archive. */
  readonly archived: boolean
}
