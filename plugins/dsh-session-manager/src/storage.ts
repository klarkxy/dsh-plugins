import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { normalizeModelRoute, type ModelRoute } from '@klarkxy/dsh-model-route'
import { z } from 'zod'
import { MAX_AUTO_CONTINUE_MAX, MIN_AUTO_CONTINUE_MAX, type AutoContinueMode } from './contracts.ts'

export const SETTINGS_KEY = 'current'

const modelRouteSchema = z.object({
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.string().optional(),
}).strict()

const suggestionSchema = z.object({
  seq: z.number().int().nonnegative(),
  text: z.string().nullable(),
  /**
   * Fingerprint of the generation inputs (resolved model route + stable
   * material). Rows written before the fingerprint existed carry no key and
   * never match, so an old line regenerates once instead of being served
   * against a different model or material.
   */
  key: z.string().optional(),
}).strict()

export const presenceSettingsSchema = z.object({
  revision: z.number().int().nonnegative(),
  model: modelRouteSchema.nullable(),
  ghostModel: modelRouteSchema.nullable().optional(),
  judgeModel: modelRouteSchema.nullable().optional(),
  handoffModel: modelRouteSchema.nullable().optional(),
  suggestions: z.record(z.string(), suggestionSchema).optional(),
}).strict()

export interface GhostSuggestion {
  readonly seq: number
  /** Null is a settled failure: do not call the model again for this cut. */
  readonly text: string | null
  /** Generation-input fingerprint this line belongs to. */
  readonly key?: string
}

export interface PresenceSettings {
  readonly revision: number
  /** Null resumes following the feature default chain for the welcome-back recap. */
  readonly model: ModelRoute | null
  /** Null resumes following the feature default chain for the ghost. */
  readonly ghostModel: ModelRoute | null
  /** Null resumes following the feature default chain for the auto-continue judge. */
  readonly judgeModel: ModelRoute | null
  /** Null resumes following the feature default chain for read_session handoff summaries. */
  readonly handoffModel: ModelRoute | null
  /** One generated ghost line per human session, keyed by session id. */
  readonly suggestions: Readonly<Record<string, GhostSuggestion>>
  /**
   * One-time migration semantics: before judgeModel existed the judge ran on
   * ghostModel, so an explicit legacy ghost choice is copied once into
   * judgeModel on store open and persisted with the next revision. The user's
   * explicit judge model is preserved rather than silently falling back to
   * the shared auxiliary default.
   */
  readonly migratedJudge?: boolean
}

const autoContinueSchema = z.object({
  mode: z.enum(['off', 'cautious', 'bold']),
  max: z.number().int().min(MIN_AUTO_CONTINUE_MAX).max(MAX_AUTO_CONTINUE_MAX),
  revision: z.number().int().min(1),
}).strict()

/** The locked per-session auto-continue choice; keyed by session id. */
export interface SessionAutoContinue {
  readonly mode: AutoContinueMode
  readonly max: number
  readonly revision: number
}

export const presenceDomain = defineDomain({
  name: 'dsh_editor_session_manager',
  version: 1,
  tables: {
    settings: domainTable<string, {
      revision: number
      model: { provider: string; model: string; reasoningEffort?: string } | null
      ghostModel?: { provider: string; model: string; reasoningEffort?: string } | null
      judgeModel?: { provider: string; model: string; reasoningEffort?: string } | null
      handoffModel?: { provider: string; model: string; reasoningEffort?: string } | null
      suggestions?: Record<string, { seq: number; text: string | null; key?: string }>
    }>(presenceSettingsSchema),
    auto_continue: domainTable<string, SessionAutoContinue>(autoContinueSchema),
  },
})

/** A missing or unreadable session row reads as "no record": off, revision 0. */
export function parseAutoContinue(value: unknown): SessionAutoContinue | undefined {
  const parsed = autoContinueSchema.safeParse(value)
  if (!parsed.success) return undefined
  return { mode: parsed.data.mode, max: parsed.data.max, revision: parsed.data.revision }
}

/** Malformed rows collapse to a fresh default instead of blocking the settings page. */
export function parsePresenceSettings(value: unknown): PresenceSettings | undefined {
  const parsed = presenceSettingsSchema.safeParse(value)
  if (!parsed.success) return undefined
  const route = parsed.data.model === null ? null : normalizeModelRoute(parsed.data.model)
  const ghost = parsed.data.ghostModel == null ? null : normalizeModelRoute(parsed.data.ghostModel)
  const judge = parsed.data.judgeModel == null ? null : normalizeModelRoute(parsed.data.judgeModel)
  const handoff = parsed.data.handoffModel == null ? null : normalizeModelRoute(parsed.data.handoffModel)
  const suggestions: Record<string, GhostSuggestion> = {}
  for (const [sessionId, suggestion] of Object.entries(parsed.data.suggestions ?? {})) {
    if (sessionId.trim() === '') continue
    suggestions[sessionId] = {
      seq: suggestion.seq,
      text: suggestion.text,
      ...suggestion.key === undefined ? {} : { key: suggestion.key },
    }
  }
  const ghostValid = ghost && ghost.provider && ghost.model ? ghost : null
  const migratedJudge = parsed.data.judgeModel === undefined && ghostValid !== null
  return {
    revision: parsed.data.revision,
    model: route && route.provider && route.model ? route : null,
    ghostModel: ghostValid,
    judgeModel: judge && judge.provider && judge.model ? judge : migratedJudge ? ghostValid : null,
    handoffModel: handoff && handoff.provider && handoff.model ? handoff : null,
    suggestions,
    ...migratedJudge ? { migratedJudge: true } : {},
  }
}
