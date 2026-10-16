/**
 * Presence feature configuration over the host configEditor: the cordis plugin
 * config stays the single source of truth (YAML edits keep working), and the
 * bundle settings page edits it through the normal Loader reconcile path. The
 * feature model route lives in plugin-owned storage instead: it is a volatile
 * route pointer, not user configuration text.
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  CONTINUE_MODES,
  MAX_CONTINUE_TEXT_CHARS,
  MAX_IDLE_MINUTES,
  PLUGIN_NAME,
  type ConfigPatch,
  type ConfigView,
  type ContinueMode,
  type ResolvedConfig,
} from './contracts.ts'
import { PresenceError } from './welcome-back.ts'
import type { ModelRoute } from '@klarkxy/dsh-model-route'

/** Narrow face of the host configEditor service (optional, browser hosts have it). */
export interface ConfigEditorLike {
  entries(): { options?: { name?: unknown } }[]
  edit(
    entry: unknown,
    change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void>
}

/** Narrow face of the plugin-owned settings store that carries the model route. */
export interface PresenceWriteOptions {
  readonly signal?: AbortSignal
  readonly expectedRevision?: number
}

export interface PresenceModelStore {
  read(): {
    readonly revision: number
    readonly model: ModelRoute | null
    readonly ghostModel: ModelRoute | null
  } | undefined
  write(model: ModelRoute | null, options?: PresenceWriteOptions): Promise<number | undefined>
  writeGhost(model: ModelRoute | null, options?: PresenceWriteOptions): Promise<number | undefined>
}

export function readPresenceConfig(config: ResolvedConfig, store?: PresenceModelStore): ConfigView {
  return {
    recapMinutes: config.recapMinutes,
    compactMinutes: config.compactMinutes,
    continueText: config.continueText,
    continueMode: config.continueMode,
    model: store?.read()?.model ?? null,
    ghostModel: store?.read()?.ghostModel ?? null,
  }
}

function minutes(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_IDLE_MINUTES) {
    throw new PresenceError('session-manager/invalid-request', `${name} must be an integer from 0 to ${MAX_IDLE_MINUTES}`)
  }
  return value
}

function continueText(value: unknown): string {
  if (typeof value !== 'string') throw new PresenceError('session-manager/invalid-request', 'continueText must be a string')
  const trimmed = value.trim()
  if (Array.from(trimmed).length > MAX_CONTINUE_TEXT_CHARS) {
    throw new PresenceError('session-manager/invalid-request', `continueText must be at most ${MAX_CONTINUE_TEXT_CHARS} characters`)
  }
  return trimmed
}

function continueMode(value: unknown): ContinueMode {
  if (typeof value !== 'string' || !CONTINUE_MODES.includes(value as ContinueMode)) {
    throw new PresenceError('session-manager/invalid-request', `continueMode must be one of ${CONTINUE_MODES.join(', ')}`)
  }
  return value as ContinueMode
}

function modelRoute(value: unknown): ModelRoute | null {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PresenceError('session-manager/invalid-request', 'model must be null or a {provider, model} route')
  }
  const record = value as Record<string, unknown>
  const provider = typeof record.provider === 'string' ? record.provider.trim() : ''
  const model = typeof record.model === 'string' ? record.model.trim() : ''
  if (provider === '' || model === '') {
    throw new PresenceError('session-manager/invalid-request', 'model.provider and model.model must be non-empty strings')
  }
  if (record.reasoningEffort !== undefined
    && (typeof record.reasoningEffort !== 'string' || record.reasoningEffort.trim() === '')) {
    throw new PresenceError('session-manager/invalid-request', 'model.reasoningEffort must be a non-empty string')
  }
  return { provider, model, ...record.reasoningEffort === undefined ? {} : { reasoningEffort: (record.reasoningEffort as string).trim() } }
}

/** Validate a raw patch into the exact override keys allowed to persist. */
export function sanitizeConfigPatch(patch: unknown): ConfigPatch {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new PresenceError('session-manager/invalid-request', 'config patch must be an object')
  }
  const record = patch as Record<string, unknown>
  const next: { -readonly [K in keyof ConfigPatch]: ConfigPatch[K] } = {}
  for (const key of Object.keys(record)) {
    if (key === 'recapMinutes' || key === 'compactMinutes') next[key] = minutes(record[key], key)
    else if (key === 'continueText') next.continueText = continueText(record[key])
    else if (key === 'continueMode') next.continueMode = continueMode(record[key])
    else if (key === 'model') next.model = modelRoute(record[key])
    else if (key === 'ghostModel') next.ghostModel = modelRoute(record[key])
    else throw new PresenceError('session-manager/invalid-request', `unknown config key: ${key}`)
  }
  return next
}

/**
 * Persist a validated patch. The cordis portion goes through the host config
 * editor, which restarts this plugin with the new config — the in-flight RPC
 * response may fall away with the old fiber, and the client confirms the write
 * by re-reading. The model route writes to plugin storage and, when absent,
 * fails soft unless the patch asks for a model change.
 */
export async function writePresenceConfig(
  root: Context,
  config: ResolvedConfig,
  patch: unknown,
  store?: PresenceModelStore,
  signal?: AbortSignal,
): Promise<ConfigView> {
  // Validate before capability checks: a malformed patch is rejected either way.
  const next = sanitizeConfigPatch(patch)
  signal?.throwIfAborted()
  const { model, ghostModel, ...configPatch } = next
  if (model !== undefined || ghostModel !== undefined) {
    if (store === undefined) {
      throw new PresenceError('session-manager/unavailable', 'this runtime cannot store the session model selection')
    }
    if (model !== undefined) await store.write(model, { signal })
    if (ghostModel !== undefined) await store.writeGhost(ghostModel, { signal })
  }
  if (Object.keys(configPatch).length > 0) {
    signal?.throwIfAborted()
    const editor = root.get('configEditor') as ConfigEditorLike | undefined
    if (editor === undefined) throw new PresenceError('session-manager/unavailable', 'this runtime cannot edit plugin configuration')
    const entry = editor.entries().find(row => row?.options?.name === PLUGIN_NAME)
    if (entry === undefined) throw new PresenceError('session-manager/unavailable', 'the session manager entry is not editable')
    await editor.edit(entry, current => ({ ...current, ...configPatch }))
  }
  return readPresenceConfig({ ...config, ...configPatch }, store)
}
