/**
 * Fixed event tiers. Approvals, questions and failures need a prompt response;
 * a turn of a session dot only watches can wait for the next wake-up. Status
 * changes already live on the ledger and never need a notice of their own.
 */
import type { Notice } from './batcher.ts'
import type { TaskOrigin } from './contracts.ts'

export type EventTier = 'wake' | 'hold' | 'ledger'
export type TierEventKind = Notice['kind'] | 'status'

export function eventTier(kind: TierEventKind, origin?: TaskOrigin): EventTier {
  if (kind === 'status' || kind === 'archived') return 'ledger'
  if (kind === 'turn-end' && origin === 'watched') return 'hold'
  return 'wake'
}
