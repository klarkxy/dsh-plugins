import type { MoodMode, TaskContract } from './contracts.ts'
import { defaultModelRoute, isMoodMode, parseSessionId, type MoodModelRoute } from './contracts.ts'

export interface ModeUpdate {
  expectedRevision: number
  mode: MoodMode
}

/** Plugin-page model selection payload: empty route means "follow the default". */
export interface ModelUpdate {
  expectedRevision: number
  model: MoodModelRoute
}

export interface ManualRequest {
  sessionId: string
}

export interface ContractEdit {
  sessionId: string
  expectedRevision: number
  patch: Partial<Pick<TaskContract, 'goal' | 'deliverables' | 'inScope' | 'outOfScope' | 'constraints' | 'acceptance' | 'assumptions' | 'questions'>>
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function asString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (text.length > max) return undefined
  return text
}

function asStringList(value: unknown, maxItems: number, maxChars: number): string[] | undefined {
  if (!Array.isArray(value) || value.length > maxItems) return undefined
  const items: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length > maxChars) return undefined
    items.push(entry)
  }
  return items
}

export function parseModeUpdate(payload: unknown): ModeUpdate | undefined {
  const row = asRecord(payload)
  if (!row) return undefined
  if (typeof row.expectedRevision !== 'number' || !Number.isInteger(row.expectedRevision) || row.expectedRevision < 0) return undefined
  if (!isMoodMode(row.mode)) return undefined
  return { expectedRevision: row.expectedRevision, mode: row.mode }
}

/** A bad route collapses to the default so a malformed row never breaks analysis. */
export function parseModelRoute(value: unknown): MoodModelRoute {
  const row = asRecord(value)
  const provider = row ? asString(row.provider, 250) : undefined
  const model = row ? asString(row.model, 250) : undefined
  if (!provider || !model) return defaultModelRoute()
  const effort = row ? asString(row.reasoningEffort, 80) : undefined
  return effort ? { provider, model, reasoningEffort: effort } : { provider, model }
}

export function parseModelUpdate(payload: unknown): ModelUpdate | undefined {
  const row = asRecord(payload)
  if (!row) return undefined
  if (typeof row.expectedRevision !== 'number' || !Number.isInteger(row.expectedRevision) || row.expectedRevision < 0) return undefined
  return { expectedRevision: row.expectedRevision, model: parseModelRoute(row.model) }
}

export function parseManual(payload: unknown): ManualRequest | undefined {
  const sessionId = parseSessionId(payload)
  return sessionId ? { sessionId } : undefined
}

const PATCH_KEYS = ['goal', 'deliverables', 'inScope', 'outOfScope', 'constraints', 'acceptance', 'assumptions', 'questions'] as const

export function parseEdit(payload: unknown): ContractEdit | undefined {
  const row = asRecord(payload)
  if (!row) return undefined
  const sessionId = parseSessionId(row)
  if (!sessionId) return undefined
  if (typeof row.expectedRevision !== 'number' || !Number.isInteger(row.expectedRevision) || row.expectedRevision < 0) return undefined
  const patchRow = asRecord(row.patch)
  if (!patchRow) return undefined
  const patch: ContractEdit['patch'] = {}
  for (const key of Object.keys(patchRow)) {
    if (!(PATCH_KEYS as readonly string[]).includes(key)) return undefined
  }
  if (patchRow.goal !== undefined) {
    const goal = asString(patchRow.goal, 2000)
    if (goal === undefined) return undefined
    patch.goal = goal
  }
  for (const key of ['deliverables', 'inScope', 'outOfScope', 'constraints', 'acceptance', 'assumptions', 'questions'] as const) {
    if (patchRow[key] === undefined) continue
    const list = asStringList(patchRow[key], 16, 400)
    if (!list) return undefined
    patch[key] = list
  }
  if (Object.keys(patch).length === 0) return undefined
  return { sessionId, expectedRevision: row.expectedRevision, patch }
}
