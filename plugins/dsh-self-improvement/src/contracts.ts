/** Own records plus reexported frozen AI/Memory interfaces. */
import {
  CHAT_EVENTS_SLOT as FROZEN_CHAT_EVENTS_SLOT,
  projectIdFromCwd as sharedProjectIdFromCwd,
} from '@klarkxy/dsh-plugin-kit/contracts'
import type {
  EvidenceRef,
  KnowledgeKind,
  KnowledgeScope,
  MemoryMutationOptions,
  MemoryQuery,
  MemoryRecord,
  MemoryService,
  NewMemoryRecord,
  ProducerMessageSource,
  RpcResult,
} from '@klarkxy/dsh-plugin-kit/contracts'

export type {
  EvidenceRef,
  KnowledgeKind,
  KnowledgeScope,
  MemoryMutationOptions,
  MemoryQuery,
  MemoryRecord,
  MemoryService,
  NewMemoryRecord,
  ProducerMessageSource,
  RpcResult,
}

export const CHAT_EVENTS_SLOT = FROZEN_CHAT_EVENTS_SLOT
export const projectIdFromCwd = sharedProjectIdFromCwd
export const SELF_IMPROVEMENT_RPC_CHANNEL = '/dsh-self-improvement'
export const SELF_IMPROVEMENT_PLUGIN = '@klarkxy/dsh-self-improvement'
export const SELF_IMPROVEMENT_REVIEW_SERVICE = 'dshSelfImprovementReview'
export const SELF_IMPROVEMENT_SOURCE_KIND = 'plugin:@klarkxy/dsh-self-improvement' as const
/** Production activate identity. Core owns the scoped pluginName regex. */
export const SELF_IMPROVEMENT_ACTIVATE_ID = SELF_IMPROVEMENT_PLUGIN
export const EXTRACT_PURPOSE = 'self-improvement.extract'
export const LESSON_INJECTION_SECTION = 'dsh-self-improvement:lessons'
export const LESSON_SCHEMA_TAG = 'lesson-schema:1'
export const LESSON_SCHEMA_VERSION = 1
export const MAX_INJECTED_LESSONS = 5
export const MAX_INJECTION_TOKENS = 800
export const MAX_PROJECT_ID_CHARS = 32_768
export const MAX_RECALL_QUERY_CHARS = 200
/** Plugin-page settings row key. */
export const SETTINGS_KEY = 'current'

/** Plugin-page model selection. Empty provider/model means "follow the default". */
export interface SelfImprovementModelRoute {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

export interface SelfImprovementSettings {
  readonly revision: number
  readonly model: SelfImprovementModelRoute
}

export const defaultModelRoute = (): SelfImprovementModelRoute => ({ provider: '', model: '' })
export const defaultSettings = (): SelfImprovementSettings => ({ revision: 0, model: defaultModelRoute() })

/** Untrusted stored routes collapse to the default so a bad row never breaks a run. */
export function normalizeModelRoute(value: unknown): SelfImprovementModelRoute {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultModelRoute()
  const row = value as Record<string, unknown>
  const provider = typeof row.provider === 'string' ? row.provider.trim() : ''
  const model = typeof row.model === 'string' ? row.model.trim() : ''
  if (!provider || !model || provider.length > 250 || model.length > 250) return defaultModelRoute()
  const effort = typeof row.reasoningEffort === 'string' ? row.reasoningEffort.trim() : ''
  return effort && effort.length <= 80 ? { provider, model, reasoningEffort: effort } : { provider, model }
}

export type SkillStatus = 'preview' | 'accepted' | 'rejected' | 'revoked'
export type SkillExportState = 'none' | 'recorded' | 'revoked'
export interface SkillAuditEntry { at: number; action: string; detail?: string }
export interface SkillSourceRef {
  id: string
  revision: number
  status: MemoryRecord['status']
  scope: KnowledgeScope
  expiresAt?: number
}
export interface SkillRecord {
  id: string
  revision: number
  status: SkillStatus
  lessonIds: string[]
  sources: SkillSourceRef[]
  title: string
  markdown: string
  createdAt: number
  updatedAt: number
  exportState: SkillExportState
  exportedAt?: number
  exportRevokedAt?: number
  exportFilename?: string
  audit: SkillAuditEntry[]
}
export interface SessionWatermark {
  sessionId: string
  seq: number
  projectId?: string
  updatedAt: number
}

export type LessonTriggerKind = 'human-correction' | 'human-instruction' | 'human-feedback' | 'tool-recovery' | 'verified-tool-fix' | 'manual'
export interface LessonTrigger {
  kind: LessonTriggerKind
  evidence: EvidenceRef[]
  titleHint: string
  contentHint: string
  toolName?: string
}

export interface LessonInjectPayload {
  source: ProducerMessageSource & {
    kind: typeof SELF_IMPROVEMENT_SOURCE_KIND
    plugin: typeof SELF_IMPROVEMENT_PLUGIN
    form: 'snapshot'
    sections: Array<{ name: string; text: string }>
  }
  content: Array<{ type: 'text'; text: string }>
}

export interface PreStepEnter { kind: 'enter'; messages: unknown[]; startsRequestSeries?: true }
export type PreStepDecision = { kind: 'reject' } | PreStepEnter

export interface ReviewSnapshot {
  memoryAvailable: boolean
  memoryMessage?: string
  projectId?: string
  generation: number
  storageFailed: boolean
  lessons: MemoryRecord[]
  skills: SkillRecord[]
  /** True while an extract for this session (or any session, if none requested) is queued or in flight. */
  extracting?: boolean
}

export function evidenceWatermark(refs: readonly EvidenceRef[]): string {
  return [...refs].map(ref => `${ref.sessionId}:${ref.seq}:${ref.kind}`).sort().join('|')
}

export function sessionCwd(session: unknown): string | undefined {
  if (!session || typeof session !== 'object') return undefined
  const row = session as { meta?: { cwd?: unknown }; header?: { cwd?: unknown } }
  const cwd = row.meta?.cwd ?? row.header?.cwd
  return typeof cwd === 'string' ? cwd : undefined
}

export function fail(code: string, message: string): RpcResult<never> {
  return { ok: false, error: { code, message } }
}

export const MEMORY_UNAVAILABLE_MESSAGE = '记忆服务不可用。请先单独启用「长期记忆」插件；启用经验学习不会自动打开记忆。'
export const MEMORY_UNAVAILABLE_MESSAGE_EN = 'Memory is unavailable. Enable the Long-term Memory plugin separately; turning on Experience Learning does not enable Long-term Memory.'
