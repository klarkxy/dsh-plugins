/** Browser-safe contracts. Shared RPC/result types stay on @klarkxy/dsh-plugin-kit. */
import type { RpcResult as SharedRpcResult } from '@klarkxy/dsh-plugin-kit/contracts'
export type RpcResult<T = unknown> = SharedRpcResult<T>

export const PLUGIN_NAME = '@klarkxy/dsh-delegation'
export const RPC_CHANNEL = '/dsh-delegation'
export const DELEGATION_CLIENT_SERVICE = 'dshDelegationClient'

/** Native delegation tools; Delegation Mode only helps presets that mount one. */
export const DELEGATION_TOOLS = ['subagent', 'subagent_fork'] as const

export interface DelegationSettings {
  readonly revision: number
  /** Initial delegation flag for sessions created from now on. */
  readonly defaultEnabled: boolean
}

export const defaultSettings = (): DelegationSettings => ({ revision: 0, defaultEnabled: false })

export type DelegationRole = 'coordinator' | 'executor'

export interface DelegationSessionStatus {
  readonly sessionId: string
  /** 'executor' for subagent threads: they never carry their own switch. */
  readonly role: DelegationRole
  /** The session record's flag; false when the session has no record yet. */
  readonly enabled: boolean
  /** The session record's revision; 0 when the session has no record yet. */
  readonly revision: number
  /** No edit is allowed once the first turn starts, or while the session is cold. */
  readonly locked: boolean
  /**
   * Whether a live agent on this session sees a delegation tool; null when no
   * agent is live, so a stale answer is never shown as unavailable.
   */
  readonly capable: boolean | null
}
