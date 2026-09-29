import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import {
  SETTINGS_KEY, defaultModelRoute, isTitleLocaleMode, normalizeCadence, normalizeModelRoute, normalizePrompt,
  type TitleModelRoute, type TitleSettings,
} from './contracts.ts'

export { SETTINGS_KEY }

const localeSchema = z.enum(['auto', 'zh', 'en'])

/** Version 1 stored only the locale. Prompt and model are filled as defaults. */
const legacySettingsSchema = z.object({
  revision: z.number().int().nonnegative(),
  locale: localeSchema,
}).strict()

const modelRouteSchema = z.object({
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.string().optional(),
}).strict()

export const titleSettingsSchema = z.object({
  revision: z.number().int().nonnegative(),
  locale: localeSchema,
  prompt: z.string(),
  model: modelRouteSchema,
  /** Defaulted so rows stored before the cadence switch existed still parse. */
  cadence: z.enum(['all-prompts', 'first-prompt']).default('all-prompts'),
}).strict()

export const titleDomain = defineDomain({
  name: 'dsh_editor_current_title',
  version: 2,
  tables: {
    settings: domainTable<string, TitleSettings>(titleSettingsSchema),
  },
})

export function parseTitleSettings(value: unknown): TitleSettings | undefined {
  const current = titleSettingsSchema.safeParse(value)
  if (current.success) {
    return {
      revision: current.data.revision,
      locale: isTitleLocaleMode(current.data.locale) ? current.data.locale : 'auto',
      prompt: normalizePrompt(current.data.prompt),
      model: normalizeModelRoute(current.data.model),
      cadence: normalizeCadence(current.data.cadence),
    }
  }
  const legacy = legacySettingsSchema.safeParse(value)
  if (!legacy.success || !isTitleLocaleMode(legacy.data.locale)) return undefined
  return {
    revision: legacy.data.revision,
    locale: legacy.data.locale,
    prompt: '',
    model: defaultModelRoute(),
    cadence: 'all-prompts',
  }
}

export function storedSettings(value: unknown, _fallbackLocale: TitleSettings['locale'] = 'auto'): TitleSettings {
  const parsed = parseTitleSettings(value)
  return {
    revision: parsed?.revision ?? 0,
    locale: 'auto',
    prompt: parsed?.prompt ?? '',
    model: parsed?.model ?? defaultModelRoute(),
    cadence: parsed?.cadence ?? 'all-prompts',
  }
}

export function settingsPatch(current: TitleSettings, patch: {
  prompt?: unknown
  model?: unknown
  cadence?: unknown
}): Pick<TitleSettings, 'prompt' | 'model' | 'cadence'> & { locale: 'auto' } {
  return {
    locale: 'auto',
    prompt: patch.prompt === undefined ? current.prompt : normalizePrompt(patch.prompt),
    model: patch.model === undefined ? current.model : normalizeModelRoute(patch.model),
    cadence: patch.cadence === undefined ? current.cadence : normalizeCadence(patch.cadence),
  }
}

export function modelRouteKey(route: TitleModelRoute): string {
  return route.provider && route.model ? `${route.provider}\u001f${route.model}` : ''
}
