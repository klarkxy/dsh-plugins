import type { RecapModelRoute, RecapSettings } from './contracts.ts'
import { defaultModelRoute, defaultSettings } from './contracts.ts'

const PATCH_KEYS = [
  'cardsEnabled', 'checkpointsEnabled', 'semanticCheckpointsEnabled', 'idleReturnMs', 'displayModel', 'checkpointModel',
] as const

/** Plugin-page model routes. A malformed route collapses to the default, never breaking a save. */
export function parseModelRoute(value: unknown): RecapModelRoute {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultModelRoute()
  const row = value as Record<string, unknown>
  const provider = typeof row.provider === 'string' ? row.provider.trim() : ''
  const model = typeof row.model === 'string' ? row.model.trim() : ''
  if (!provider || !model || provider.length > 250 || model.length > 250) return defaultModelRoute()
  const effort = typeof row.reasoningEffort === 'string' ? row.reasoningEffort.trim() : ''
  return effort && effort.length <= 80 ? { provider, model, reasoningEffort: effort } : { provider, model }
}

export function parseSettingsPatch(value: unknown): Omit<RecapSettings, 'revision'> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  if (Object.keys(row).some(key => !(PATCH_KEYS as readonly string[]).includes(key))) return undefined
  if (typeof row.cardsEnabled !== 'boolean' || typeof row.checkpointsEnabled !== 'boolean' || typeof row.semanticCheckpointsEnabled !== 'boolean') return undefined
  if (typeof row.idleReturnMs !== 'number' || !Number.isInteger(row.idleReturnMs) || row.idleReturnMs < 60_000 || row.idleReturnMs > 180 * 60_000) return undefined
  return {
    cardsEnabled: row.cardsEnabled,
    checkpointsEnabled: row.checkpointsEnabled,
    semanticCheckpointsEnabled: row.semanticCheckpointsEnabled,
    idleReturnMs: row.idleReturnMs,
    displayModel: parseModelRoute(row.displayModel),
    checkpointModel: parseModelRoute(row.checkpointModel),
  }
}

export function parseUpdate(payload: unknown): { expectedRevision: number; settings: Omit<RecapSettings, 'revision'> } | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const row = payload as Record<string, unknown>
  if (typeof row.expectedRevision !== 'number' || !Number.isInteger(row.expectedRevision) || row.expectedRevision < 0) return undefined
  const settings = parseSettingsPatch(row.settings)
  if (!settings) return undefined
  return { expectedRevision: row.expectedRevision, settings }
}

export function storedSettings(value: RecapSettings | undefined): RecapSettings {
  const revision = value && typeof value.revision === 'number' && Number.isInteger(value.revision) && value.revision >= 0
    ? value.revision
    : 0
  return {
    ...defaultSettings(),
    revision,
    displayModel: parseModelRoute(value?.displayModel),
    checkpointModel: parseModelRoute(value?.checkpointModel),
  }
}
