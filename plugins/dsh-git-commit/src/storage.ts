import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import {
  SETTINGS_KEY, defaultSettings, normalizeModelRoute, type GitCommitSettings,
} from './contracts.ts'

export { SETTINGS_KEY }

const modelRouteSchema = z.object({
  provider: z.string().max(250),
  model: z.string().max(250),
  reasoningEffort: z.string().max(80).optional(),
}).strict()

/** Version 1 stored no settings row, so a missing record fills defaults. */
export const settingsSchema = z.object({
  revision: z.number().int().nonnegative(),
  model: modelRouteSchema,
}).strict()

export const updateSettingsSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  settings: z.object({ model: z.unknown() }).strict(),
}).strict()

export const gitCommitDomain = defineDomain({
  name: 'dsh_editor_git_commit',
  version: 1,
  tables: {
    settings: domainTable<string, GitCommitSettings>(settingsSchema),
  },
})

export function parseSettings(value: unknown): GitCommitSettings {
  const parsed = settingsSchema.safeParse(value)
  if (!parsed.success) return defaultSettings()
  return { revision: parsed.data.revision, model: normalizeModelRoute(parsed.data.model) }
}

export type { GitCommitSettings }
