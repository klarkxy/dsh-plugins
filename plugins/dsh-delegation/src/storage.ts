import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { defaultSettings, type DelegationSettings } from './contracts.ts'

export const SETTINGS_KEY = 'global'

export const settingsSchema = z.object({
  revision: z.number().int().nonnegative(),
  defaultEnabled: z.boolean(),
}).strict()

export const sessionSchema = z.object({
  enabled: z.boolean(),
  revision: z.number().int().min(1),
}).strict()

export interface SessionDelegation {
  readonly enabled: boolean
  readonly revision: number
}

export const settingsUpdateSchema = z.object({
  defaultEnabled: z.boolean(),
  expectedRevision: z.number().int().nonnegative(),
}).strict()

export const sessionStatusSchema = z.object({
  sessionId: z.string().min(1),
}).strict()

export const sessionUpdateSchema = z.object({
  sessionId: z.string().min(1),
  enabled: z.boolean(),
  expectedRevision: z.number().int().nonnegative(),
}).strict()

export const delegationDomain = defineDomain({
  name: 'dsh_delegation',
  version: 1,
  tables: {
    settings: domainTable<string, DelegationSettings>(settingsSchema),
    sessions: domainTable<string, SessionDelegation>(sessionSchema),
  },
})

/** A missing or unreadable settings row reads as the shipped defaults. */
export function parseSettings(value: unknown): DelegationSettings {
  const parsed = settingsSchema.safeParse(value)
  if (!parsed.success) return defaultSettings()
  return { revision: parsed.data.revision, defaultEnabled: parsed.data.defaultEnabled }
}

/** A missing or unreadable session row reads as "no record": off, revision 0. */
export function parseSession(value: unknown): SessionDelegation | undefined {
  const parsed = sessionSchema.safeParse(value)
  if (!parsed.success) return undefined
  return { enabled: parsed.data.enabled, revision: parsed.data.revision }
}
