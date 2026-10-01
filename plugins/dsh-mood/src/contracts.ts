/** Shared TaskContract fields remain compatible with Recap and stored Mood notes. */
import type { EvidenceRef, RpcResult, TaskContract } from '@klarkxy/dsh-plugin-kit/contracts'
export type { EvidenceRef, RpcResult, TaskContract }
export { projectIdFromCwd } from '@klarkxy/dsh-plugin-kit/contracts'

export const MOOD_PLUGIN = '@klarkxy/dsh-mood'
export const MOOD_RPC_CHANNEL = '/dsh-mood'
export const MAX_EXCERPT_CHARS = 200
export const MAX_PROJECT_ID_CHARS = 32_768

/** Retained only to read and preserve historical storage, never to select a model. */
export type MoodMode = 'auto' | 'manual' | 'strict'
export interface MoodModelRoute {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}
export interface MoodSettings { revision: number; mode: MoodMode; model: MoodModelRoute }
export const defaultModelRoute = (): MoodModelRoute => ({ provider: '', model: '' })
export const defaultSettings = (): MoodSettings => ({ revision: 0, mode: 'auto', model: defaultModelRoute() })

export type ClarificationStatus = 'pending' | 'answered' | 'skipped' | 'cancelled' | 'stale'
export interface ClarificationItem {
  id: string
  question: string
  status: ClarificationStatus
  answer?: string
}
export interface HeldRequest {
  sourceVersion: string
  trigger: 'material' | 'risk' | 'mild' | 'clear'
  messages: unknown[]
}

export function ok<T>(value: T): RpcResult<T> { return { ok: true, value } }
export function fail(code: string, message: string): RpcResult<never> { return { ok: false, error: { code, message } } }
export function parseSessionId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const sessionId = (payload as { sessionId?: unknown }).sessionId
  return typeof sessionId === 'string' && sessionId.length > 0 && sessionId.length <= 200 ? sessionId : undefined
}
export function excerptOf(text: string, limit = MAX_EXCERPT_CHARS): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit - 1)}…`
}
export function cloneContract(contract: TaskContract): TaskContract { return structuredClone(contract) }
