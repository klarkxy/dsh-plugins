/** Browser-safe Mood contracts. Shared TaskContract fields match frozen @klarkxy/dsh-plugin-kit. */
import type { EvidenceRef, ProducerMessageSource, RpcResult, TaskContract } from '@klarkxy/dsh-plugin-kit/contracts'

export type { EvidenceRef, ProducerMessageSource, RpcResult, TaskContract }
export { projectIdFromCwd } from '@klarkxy/dsh-plugin-kit/contracts'

/** Frozen shared chat-events seat. Must stay equal to @klarkxy/dsh-plugin-kit CHAT_EVENTS_SLOT. */
export const CHAT_EVENTS_SLOT = 'dsh-editor.chat.events'
export const MOOD_PLUGIN = '@klarkxy/dsh-mood'
export const MOOD_SOURCE_KIND = 'plugin:@klarkxy/dsh-mood' as const
/** Production activate identity after scoped pluginName support. */
export const MOOD_AI_PLUGIN = MOOD_PLUGIN
export const MOOD_RPC_CHANNEL = '/dsh-mood'
export const MOOD_ANALYZE_PURPOSE = 'mood.analyze'
export const CONTRACT_SECTION = 'dsh-mood:contract'
export const PROMPT_VERSION = 'mood.analyze.v2'
export const SCHEMA_VERSION = 'mood-contract.v1'
export const MAX_QUESTIONS = 3
export const MAX_EXCERPT_CHARS = 200
export const MAX_PROJECT_ID_CHARS = 32_768
/** Legacy export only. Empty analysis results never synthesize this question. */
export const DEFAULT_QUESTION = '这次要改哪些内容，做到什么程度算完成？'

export type MoodMode = 'auto' | 'manual' | 'strict'
export type ClarificationStatus = 'pending' | 'answered' | 'skipped' | 'cancelled' | 'stale'
export type MoodLocale = 'zh' | 'en'

export interface MoodModelRoute {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

export interface MoodSettings {
  revision: number
  mode: MoodMode
  /** Plugin-page model selection. Empty provider/model means "follow the default". */
  model: MoodModelRoute
}

export const defaultModelRoute = (): MoodModelRoute => ({ provider: '', model: '' })

export const defaultSettings = (): MoodSettings => ({ revision: 0, mode: 'auto', model: defaultModelRoute() })

/** Old mode names remain accepted aliases for the single non-blocking strategy. */
export function operationalSettings(settings: MoodSettings): MoodSettings {
  return { revision: settings.revision, mode: 'auto', model: settings.model }
}

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

export interface MoodSessionView {
  sessionId: string
  projectId?: string
  contract?: TaskContract
  clarification: ClarificationItem[]
  pendingManual: boolean
  held: boolean
}

export interface MoodStatus {
  settings: MoodSettings
  storageFailed: boolean
  session?: MoodSessionView
}

/** Native `@deepseek-ai/dsh-user-questions` AskUserQuestionItem. */
export interface AskUserQuestionOption {
  label: string
  description?: string
}

export interface AskUserQuestionItem {
  id: string
  question: string
  detail?: string
  header?: string
  options?: AskUserQuestionOption[]
  multiSelect?: boolean
}

export interface AskUserQuestionAnswerItem {
  id: string
  selected: string[]
  custom?: string
}

export interface AskUserQuestionAnswer {
  answers: AskUserQuestionAnswerItem[]
}

export interface AskUserRequest {
  questions: AskUserQuestionItem[]
  agent?: unknown
  signal?: AbortSignal
}

export function ok<T>(value: T): RpcResult<T> {
  return { ok: true, value }
}

export function fail(code: string, message: string): RpcResult<never> {
  return { ok: false, error: { code, message } }
}

export function isMoodMode(value: unknown): value is MoodMode {
  return value === 'auto' || value === 'manual' || value === 'strict'
}

export function parseSessionId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const sessionId = (payload as { sessionId?: unknown }).sessionId
  return typeof sessionId === 'string' && sessionId.length > 0 && sessionId.length <= 200 ? sessionId : undefined
}

export function excerptOf(text: string, limit = MAX_EXCERPT_CHARS): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (!trimmed) return ''
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit - 1)}…`
}

export function sessionIdOf(agent: { id?: unknown; session?: { id?: unknown } } | undefined): string {
  const fromSession = agent?.session?.id
  if (fromSession != null && String(fromSession).length > 0) return String(fromSession)
  if (agent?.id != null && String(agent.id).length > 0) return String(agent.id)
  return ''
}

export function cloneContract(contract: TaskContract): TaskContract {
  return structuredClone(contract)
}

/** Defaults to zh: the injected model-context section (inject.ts) stays Chinese. */
export function readinessLabel(readiness: TaskContract['readiness'], locale: 'zh' | 'en' = 'zh'): string {
  const en = locale === 'en'
  if (readiness === 'clear-request') return en ? 'Clearly stated' : '表述清楚'
  if (readiness === 'user-confirmed') return en ? 'Confirmed by you' : '作者已确认'
  if (readiness === 'disclosed-assumptions') return en ? 'Proceeding on stated assumptions' : '按已披露假定继续'
  if (readiness === 'cancelled') return en ? 'Cancelled, not confirmed' : '已取消，未确认'
  if (readiness === 'stale') return en ? 'Out of date' : '已过期'
  return en ? 'Awaiting confirmation' : '待确认'
}
