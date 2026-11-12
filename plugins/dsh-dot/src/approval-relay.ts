/** Race the original session's answerer against dot without cancelling dot's turn. */
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { RawEvent } from './chat.ts'
import type { NativeLease } from './native.ts'
import type { PendingAnswer } from './pending.ts'

/** The host audit id is not on the request. Ambiguous calls use the answerer race instead of guessing an id. */
export function approvalAuditId(session: { readonly seq?: number; eventAt?(seq: number): RawEvent | undefined } | undefined, toolName: string, callId?: string): string | undefined {
  if (!session?.eventAt || typeof session.seq !== 'number') return undefined
  const decided = new Set<string>()
  let candidate: string | undefined
  for (let seq = session.seq - 1; seq >= Math.max(0, session.seq - 400); seq--) {
    const event = session.eventAt(seq)
    const data = event?.data as { id?: unknown; callId?: unknown; toolName?: unknown } | undefined
    if (typeof data?.id !== 'string') continue
    if (event?.type === 'approval/decided') decided.add(data.id)
    if (event?.type !== 'approval/asked' || data.toolName !== toolName || data.callId !== callId || decided.has(data.id)) continue
    if (candidate !== undefined) return undefined
    candidate = data.id
  }
  return candidate
}

export interface ApprovalRelay {
  readonly settled: Promise<PendingAnswer | undefined>
  readonly withdraw: () => void
}

export async function raceApproval(
  routed: ApprovalRelay,
  next: () => Promise<ApprovalOutcome>,
  lease: NativeLease | undefined,
  callerSignal?: AbortSignal,
): Promise<ApprovalOutcome> {
  const native = Promise.resolve().then(next).catch(() => 'unavailable' as const)
  try {
    const winner = await Promise.race([
      native.then(outcome => ({ from: 'native' as const, outcome })),
      routed.settled.then(answer => ({ from: 'dot' as const, answer })),
    ])
    // Rejection is a final decision for THIS request. A subsequent manual
    // retry has a fresh host request id and must be routed independently.
    if (winner.from === 'native' && winner.outcome !== 'unavailable') {
      routed.withdraw()
      return winner.outcome
    }
    const answer = winner.from === 'dot' ? winner.answer : await routed.settled
    if (answer?.kind === 'approval') {
      lease?.close()
      return answer.allow ? 'allowed-once' : 'rejected'
    }
    return callerSignal?.aborted ? 'cancelled' : await native
  } finally {
    lease?.release()
  }
}
