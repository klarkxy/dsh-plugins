import type { Session } from '@deepseek-ai/dsh-session'

/**
 * Caller identity for ranking and continuation binding.
 *
 * The agent loop puts the calling agent on `ToolExecution.agent`. A subagent's
 * user-role task is not a human, so message source is not a caller signal.
 */
export interface SessionCaller {
  readonly sessionId?: string
  readonly cwd?: string
}

export interface CallerExecution {
  readonly agent?: { readonly session: Session }
}

export function callerFromExecution(exec: CallerExecution): SessionCaller {
  const session = exec.agent?.session
  if (session === undefined) return {}
  return {
    sessionId: session.id,
    ...session.header.cwd === undefined ? {} : { cwd: session.header.cwd },
  }
}
