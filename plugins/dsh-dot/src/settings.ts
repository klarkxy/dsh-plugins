/**
 * Host-side reading and patching of dot's settings. Stored rows read field by
 * field, so one bad value falls back to its default instead of losing the rest;
 * patches from the panel are checked strictly and refused as a whole.
 */
import { z } from 'zod'
import { DEFAULT_SETTINGS, POLICY_MAX_CHARS, SETTING_FIELDS, TASK_MODEL_LIST_MAX, type DotSettings, type SettingField } from './contracts.ts'
import { ADDRESS_MAX_CHARS, DEFAULT_ADDRESS, DEFAULT_PERSONA, PERSONA_MAX_CHARS } from './persona.ts'

const FIELDS = {
  model: z.object({
    provider: z.string().trim().min(1).max(200),
    model: z.string().trim().min(1).max(200),
    reasoningEffort: z.string().trim().min(1).max(40).optional(),
  }).strict(),
  approvals: z.enum(['dot', 'human', 'deny', 'allow']),
  questions: z.enum(['dot', 'human', 'off']),
  scope: z.enum(['all', 'tracked']),
  taskModels: z.object({
    mode: z.enum(['all', 'allow', 'deny']),
    list: z.array(z.string().trim().min(1).max(400)).max(TASK_MODEL_LIST_MAX),
  }).strict(),
  policy: z.string().max(POLICY_MAX_CHARS),
  persona: z.string().max(PERSONA_MAX_CHARS),
  address: z.string().trim().min(1).max(ADDRESS_MAX_CHARS),
  locks: z.object(Object.fromEntries(SETTING_FIELDS.map(field => [field, z.boolean().optional()]))).strict(),
} as const

/** Settings a patch may clear with null, going back to their defaults. */
const CLEARABLE = new Set<string>(['model', 'persona', 'address'])
/** A value equal to its default is stored as absent, so later default updates still reach it. */
const DEFAULTS: Record<string, string> = { persona: DEFAULT_PERSONA, address: DEFAULT_ADDRESS }

type Field = keyof typeof FIELDS

export class SettingsError extends Error {
  constructor(message: string) { super(message); this.name = 'SettingsError' }
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

export function parseSettings(value: unknown): DotSettings {
  const row = isRecord(value) ? value : {}
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(FIELDS) as Field[]) {
    if (!(key in row)) continue
    if (key === 'locks' && isRecord(row.locks)) {
      const locks: Record<string, boolean> = {}
      for (const field of SETTING_FIELDS) {
        if (typeof row.locks[field] === 'boolean') locks[field] = row.locks[field] as boolean
      }
      out.locks = locks
      continue
    }
    const parsed = FIELDS[key].safeParse(row[key])
    if (parsed.success) out[key] = parsed.data
  }
  return out as unknown as DotSettings
}

/** Apply a patch from the settings view; null on model, persona or address goes back to the default. */
export function patchSettings(current: DotSettings, patch: unknown): DotSettings {
  if (!isRecord(patch)) throw new SettingsError('settings patch must be an object')
  const next: Record<string, unknown> = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in FIELDS)) throw new SettingsError(`unknown setting: ${key}`)
    if (CLEARABLE.has(key) && value === null) { delete next[key]; continue }
    const parsed = FIELDS[key as Field].safeParse(value)
    if (!parsed.success) throw new SettingsError(`invalid value for ${key}`)
    if (key in DEFAULTS && (parsed.data as string).trim() === DEFAULTS[key]!.trim()) { delete next[key]; continue }
    next[key] = parsed.data
  }
  return next as unknown as DotSettings
}

/** Dorothy can only propose unlocked fields; neither model nor panel proposals can change locks. */
export function lockedField(current: DotSettings, field: string): SettingField | undefined {
  if (!SETTING_FIELDS.some(key => key === field)) throw new SettingsError(`unknown setting: ${field}`)
  const key = field as SettingField
  if (current.locks?.[key] === true) throw new SettingsError(`${field} is locked by the human`)
  return key
}
