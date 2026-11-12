/**
 * Which agent preset a task dot starts runs on. A preset is the set of tools
 * and instructions a session works with; the host keeps the roster, and this
 * file holds the pure decisions about dot's request.
 */
import { PRESET_ID } from './contracts.ts'

export interface CatalogPreset {
  readonly id: string
  readonly name?: string
  readonly description?: string
  /** Why the preset cannot be used; absent when it can. */
  readonly broken?: string
}

/** The host's preset roster as dot needs it. */
export interface TaskPresetCatalog {
  /** Preset of a new session that nobody picked one for. */
  readonly fallback?: string
  readonly presets: readonly CatalogPreset[]
}

export class TaskPresetError extends Error {
  constructor(readonly code: 'dot/unknown-preset' | 'dot/preset-broken', message: string) { super(message); this.name = 'TaskPresetError' }
}

/** Presets a task can run on: dot's own is for dot alone. */
export function usablePresets(catalog: TaskPresetCatalog): CatalogPreset[] {
  return catalog.presets.filter(preset => preset.id !== PRESET_ID && !preset.broken)
}

const describe = (catalog: TaskPresetCatalog): string => {
  const rows = usablePresets(catalog).map(preset => `${preset.id}${preset.id === catalog.fallback ? ' (the default)' : ''}`)
  return rows.length > 0 ? `Presets on this host: ${rows.join(', ')}.` : 'This host lists no preset a task can run on.'
}

export interface TaskPresetChoice {
  /** Preset the session runs on; undefined when the host names no default. */
  readonly id?: string
  /** Whether the session has to be created with this preset named; false lets it take the host default. */
  readonly named: boolean
}

/**
 * The preset a new task session runs on.
 * @param requested - what dot asked for: a preset id, or nothing / "default" for the host default.
 * @throws TaskPresetError when the request names no usable preset.
 */
export function pickTaskPreset(catalog: TaskPresetCatalog, requested?: string): TaskPresetChoice {
  const wanted = requested?.trim()
  if (!wanted || wanted.toLowerCase() === 'default') return { ...catalog.fallback ? { id: catalog.fallback } : {}, named: false }
  const found = catalog.presets.find(preset => preset.id === wanted) ?? catalog.presets.find(preset => preset.id.toLowerCase() === wanted.toLowerCase())
  if (!found || found.id === PRESET_ID) throw new TaskPresetError('dot/unknown-preset', `no preset "${wanted}" for tasks. ${describe(catalog)} Leave preset out for the default.`)
  if (found.broken) throw new TaskPresetError('dot/preset-broken', `preset ${found.id} cannot be used on this host: ${found.broken}. ${describe(catalog)}`)
  // Naming the default is the same as leaving it out.
  return { id: found.id, named: found.id !== catalog.fallback }
}
