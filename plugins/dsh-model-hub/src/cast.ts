/**
 * dsh-model-hub — subagent cast (host half).
 *
 * Edits the host-native `subagent-model-selection-settings` namespace
 * (`enabled` + `allowedModels` routes) through the official settings CAS
 * path, and keeps the per-route user preferences in
 * `<profile>/data/model-hub/cast.json`: the free-text "task tendency" note
 * and the reasoning effort.
 *
 * The native AllowedModelRoute schema carries provider and model only — the
 * host strips a reasoning effort from the settings value — so the effort is a
 * plugin-side preference keyed by provider/model and saved with the file's own
 * CAS. Tendencies and efforts are advisory hints for the system-prompt
 * injection in index.ts; the main agent still decides which model a delegated
 * subagent receives.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { PluginLogger } from '@klarkxy/dsh-plugin-kit/log-shared'
import type { ProbeDescriptorLike } from './probe.ts'

/** Native namespace owning the subagent model-selection preference. */
export const CAST_NAMESPACE = 'subagent-model-selection-settings'
/** Separate revision domain; native settings revisions do not cover this file. */
export const CAST_TENDENCIES_NAMESPACE = '@klarkxy/dsh-model-hub/cast-tendencies'

/** Tendency ids are limited like host route ids; notes stay short prompt lines. */
export const CAST_LIMITS = { id: 250, tendency: 500, effort: 80 } as const

/** One valid route of the cast. `index` is the write handle (see createCast). */
export interface CastRoute {
  /** Position inside the raw native allowedModels array. Malformed entries are
   * skipped when reading, so a route's position in `CastState.routes` can
   * diverge from its raw index; every write addresses routes by this index. */
  index: number
  provider: string
  model: string
  /** Plugin-side preference; the native schema never carries it. */
  reasoningEffort?: string
  tendency?: string
}

/** Cast snapshot served to the browser half. */
export interface CastState {
  enabled: boolean
  revision: number
  /** Revision of the plugin-side preference store (tendencies and efforts). */
  tendencyRevision?: number
  tendencyError?: string
  routes: CastRoute[]
}
/** Native saves acknowledge only the commit; getCast owns later reads. */
export interface CastCommit { committed: true }

/**
 * One route's plugin-side preferences. An absent field keeps its stored value;
 * an empty string clears it.
 */
export interface RoutePreferences {
  tendency?: string
  reasoningEffort?: string
}

type SettingsOp = { op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] }

export interface CastDeps {
  describe(): readonly ProbeDescriptorLike[]
  mutate(ns: string, ops: readonly SettingsOp[], expectedRevision: number): Promise<void>
  profileDir?: string
  logger?: { warn(message: string, ...args: unknown[]): void }
  pluginLogger?: PluginLogger
  notifyTendenciesChanged?(revision: number): void
}

/** One valid allowedModels entry plus its raw array index. */
type IndexedRoute = Omit<CastRoute, 'tendency' | 'reasoningEffort'>

interface RawCast {
  enabled: boolean
  revision: number
  routes: IndexedRoute[]
  /** Raw allowedModels length, malformed entries included. */
  length: number
}

/** The plugin-side preference store: one revision over both maps. */
interface PreferenceStore {
  revision: number
  tendencies: Record<string, string>
  efforts: Record<string, string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Store key for one provider/model pair; it keys tendencies and efforts. */
export function tendencyKey(provider: string, model: string): string {
  return JSON.stringify([provider, model])
}

/** Keep well-formed entries with their raw indexes; skip malformed ones. */
function parseAllowedModels(value: unknown): { routes: IndexedRoute[]; length: number } {
  const list = Array.isArray(value) ? value : []
  const routes: IndexedRoute[] = []
  list.forEach((entry, index) => {
    if (!isRecord(entry)) return
    const { provider, model } = entry
    if (typeof provider !== 'string' || !provider || typeof model !== 'string' || !model) return
    routes.push({ index, provider, model })
  })
  return { routes, length: list.length }
}

/**
 * Normalize a native route write. The native schema owns provider and model
 * only: a reasoning effort is a plugin-side preference and never travels
 * through the settings CAS.
 */
function normalizeRouteInput(input: unknown): { provider: string; model: string } {
  const row = isRecord(input) ? input : {}
  const provider = typeof row.provider === 'string' ? row.provider.trim() : ''
  const model = typeof row.model === 'string' ? row.model.trim() : ''
  if (!provider || !model) throw new Error('A route requires non-empty provider and model ids')
  if (provider.length > CAST_LIMITS.id || model.length > CAST_LIMITS.id) {
    throw new Error(`Route provider and model ids are limited to ${CAST_LIMITS.id} characters`)
  }
  return { provider, model }
}

function validateRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error('A valid expected revision is required; refresh and retry')
  }
  return value as number
}

function validateIndex(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('Invalid route index')
  return value as number
}

/**
 * Render the injected guidance. Pure: callers resolve enabled state and the
 * preference-merged routes. Returns '' when the injection should not appear —
 * the host prompt renderer drops empty sections.
 */
export function buildCastPrompt(enabled: boolean, routes: readonly CastRoute[]): string {
  if (!enabled || !routes.length) return ''
  const annotated = routes.filter(route => typeof route.tendency === 'string' && route.tendency.trim())
  const withEffort = routes.filter(route => typeof route.reasoningEffort === 'string' && route.reasoningEffort.trim())
  // Global settings can differ from a Session's saved route policy. Discovery
  // and the actual tool schema, not this section, determine what it can select.
  const guidance = [
    'Subagent model selection:',
    'When delegating an independent task, actively select a model suited to the subtask. When list_subagent_models and delegation tools with provider/model parameters are available, call list_subagent_models once before the first model-selectable delegation, reuse that catalog for subsequent delegations, and supply provider and model together explicitly.',
    'Pass provider and model as separate fields. When discovery displays a combined "provider/model" label, strip only the leading "<provider>/" prefix and keep any internal slashes in the model id — for example, for provider "example-provider" and label "example-provider/team/model-a", pass {"provider":"example-provider","model":"team/model-a"} (illustrative example only). When discovery returns separate provider and model fields, copy each value verbatim.',
    'For independent code review, alternative designs, or second-opinion verification, prefer a distinct capable model when available; choose your own model whenever it best fits the task or constraints, keeping task decomposition driven strictly by actual work scope.',
    'Follow the current Session\'s live discovery results and tool schema as authoritative (allowed routes are snapshotted at top-level Session creation and inherited by child agents; configured notes below apply only when their route appears in discovery). On tools without model-selection fields (such as subagent_fork) or when discovery is unavailable, rely on standard route inheritance. Include reasoning_effort only when verified as supported by the selected route.',
  ]
  if (annotated.length) guidance.push(
    'User-configured task tendencies (advisory — match task type to tendency among available routes; unannotated routes remain general-purpose):',
    ...annotated.map(route =>
      `- ${JSON.stringify({ provider: route.provider, model: route.model })}${route.reasoningEffort ? ` (reasoning effort: ${route.reasoningEffort})` : ''}: ${route.tendency}`),
  )
  if (withEffort.length) guidance.push(
    'Configured reasoning effort (advisory — applies at subagent startup when supported by the target route; omit for routes with different effort levels):',
    ...withEffort.map(route =>
      `- ${JSON.stringify({ provider: route.provider, model: route.model })}: reasoning effort "${route.reasoningEffort}"`),
  )
  return guidance.join('\n')
}

export function createCast(deps: CastDeps) {
  const castFile = (): string => {
    if (!deps.profileDir) throw new Error('No profile directory; cast preferences cannot be stored')
    return join(deps.profileDir, 'data', 'model-hub', 'cast.json')
  }

  /**
   * Always read the durable revision: another tab or plugin incarnation may
   * have committed since the last snapshot. Failed reads never become a cache.
   * v1 and v2 stores hold tendencies only; v3 adds the effort map.
   */
  const readPreferences = (): PreferenceStore => {
    if (!deps.profileDir) return { revision: 0, tendencies: {}, efforts: {} }
    let raw: string
    try {
      raw = readFileSync(castFile(), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { revision: 0, tendencies: {}, efforts: {} }
      throw new Error('Cast preference store cannot be read; restore access to cast.json and refresh', { cause: error })
    }
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch (error) {
      deps.pluginLogger?.fault('cast.preferences-corrupt', 'Cast preference store JSON is damaged.', error)
      throw new Error('Cast preference store is damaged; repair cast.json and refresh', { cause: error })
    }
    const version = isRecord(parsed) ? parsed.schemaVersion : undefined
    if (version !== 1 && version !== 2 && version !== 3) {
      throw new Error('Cast preference store version is unsupported; use a compatible plugin before saving')
    }
    try {
      if (!isRecord(parsed) || !isRecord(parsed.tendencies)) throw new Error('Invalid preference store schema')
      if (version !== 1 && (!Number.isSafeInteger(parsed.revision) || (parsed.revision as number) < 0)) throw new Error('Invalid preference store revision')
      const efforts = version === 3 ? parsed.efforts : {}
      if (!isRecord(efforts)) throw new Error('Invalid preference store schema')
      for (const map of [parsed.tendencies, efforts]) {
        for (const [key, value] of Object.entries(map)) {
          const ids: unknown = JSON.parse(key)
          if (!Array.isArray(ids) || ids.length !== 2 || !ids.every(id => typeof id === 'string' && id.trim()) || typeof value !== 'string') {
            throw new Error('Invalid preference store entry')
          }
        }
      }
      return {
        revision: version === 1 ? 0 : parsed.revision as number,
        tendencies: parsed.tendencies as Record<string, string>,
        efforts: efforts as Record<string, string>,
      }
    } catch (error) {
      throw new Error('Cast preference store schema is invalid; repair cast.json and refresh', { cause: error })
    }
  }

  /** Atomic store write: temp file plus rename, so a crash never halves JSON. */
  const writePreferences = (next: { tendencies: Record<string, string>; efforts: Record<string, string> }, revision: number): void => {
    const file = castFile()
    mkdirSync(dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.tmp`
    try {
      writeFileSync(temp, JSON.stringify({ schemaVersion: 3, revision, tendencies: next.tendencies, efforts: next.efforts }, null, 2))
      renameSync(temp, file)
    } catch (error) {
      try {
        rmSync(temp, { force: true })
      } catch {
        // The temp file may never have been created.
      }
      throw error
    }
  }

  const readRaw = (): RawCast => {
    const descriptor = deps.describe().find(entry => entry.ns === CAST_NAMESPACE)
    if (!descriptor) throw new Error('native subagent-model-selection-settings not found')
    const value = isRecord(descriptor.value) ? descriptor.value : {}
    const parsed = parseAllowedModels(value.allowedModels)
    return {
      enabled: value.enabled === true,
      revision: typeof descriptor.revision === 'number' ? descriptor.revision : 0,
      routes: parsed.routes,
      length: parsed.length,
    }
  }

  /** Merge the stored preferences into the native routes. */
  const mergePreferences = (routes: readonly IndexedRoute[], stored: { tendencies: Record<string, string>; efforts: Record<string, string> }): CastRoute[] => {
    return routes.map(route => {
      const key = tendencyKey(route.provider, route.model)
      const tendency = stored.tendencies[key]
      const effort = stored.efforts[key]
      return {
        ...route,
        ...(tendency ? { tendency } : {}),
        ...(effort ? { reasoningEffort: effort } : {}),
      }
    })
  }

  const getCast = (): CastState => {
    const raw = readRaw()
    try {
      const stored = readPreferences()
      return { enabled: raw.enabled, revision: raw.revision, tendencyRevision: stored.revision, routes: mergePreferences(raw.routes, stored) }
    } catch (error) {
      // Native controls remain available, including repair of enabled + [].
      return { enabled: raw.enabled, revision: raw.revision, routes: raw.routes, tendencyError: (error as Error).message }
    }
  }

  /** CAS write: re-describe, pin the revision, then acknowledge the commit.
   * The host owns the next revision; do not invent it or read after saving. */
  const write = async (expectedRevision: unknown, plan: (raw: RawCast) => SettingsOp[]): Promise<CastCommit> => {
    const revision = validateRevision(expectedRevision)
    const raw = readRaw()
    if (raw.revision !== revision) throw new Error('Settings changed; refresh and retry')
    await deps.mutate(CAST_NAMESPACE, plan(raw), revision)
    return { committed: true }
  }

  const assertUnique = (route: { provider: string; model: string }, raw: RawCast, except?: number): void => {
    if (raw.routes.some(entry => entry.index !== except && entry.provider === route.provider && entry.model === route.model)) {
      throw new Error(`Route "${route.provider}/${route.model}" already exists`)
    }
  }

  /* Async all the way down: argument validation must reject, never throw
   * synchronously, so RPC callers and specs see one failure channel. */
  const setEnabled = async (enabled: unknown, expectedRevision: unknown): Promise<CastCommit> => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid enabled state')
    const committed = await write(expectedRevision, raw => {
      if (enabled && raw.routes.length === 0) throw new Error('Add a model before enabling subagent cast')
      return [{ op: 'set', path: ['enabled'], value: enabled }]
    })
    deps.pluginLogger?.info('cast.enabled-updated', 'Updated subagent cast enabled state.', { enabled })
    return committed
  }

  const addRoute = async (input: unknown, expectedRevision: unknown): Promise<CastCommit> => {
    const route = normalizeRouteInput(input)
    const committed = await write(expectedRevision, raw => {
      assertUnique(route, raw)
      return [{ op: 'set', path: ['allowedModels', String(raw.length)], value: route }]
    })
    deps.pluginLogger?.info('cast.route-added', 'Added subagent cast route.', { provider: route.provider, model: route.model })
    return committed
  }

  const setRoute = async (index: unknown, input: unknown, expectedRevision: unknown): Promise<CastCommit> => {
    const route = normalizeRouteInput(input)
    const at = validateIndex(index)
    const committed = await write(expectedRevision, raw => {
      if (at >= raw.length) throw new Error('Invalid route index')
      assertUnique(route, raw, at)
      return [{ op: 'set', path: ['allowedModels', String(at)], value: route }]
    })
    deps.pluginLogger?.info('cast.route-updated', 'Updated subagent cast route.', { index: at, provider: route.provider, model: route.model })
    return committed
  }

  const removeRoute = async (index: unknown, expectedRevision: unknown): Promise<CastCommit> => {
    const at = validateIndex(index)
    const committed = await write(expectedRevision, raw => {
      if (at >= raw.length) throw new Error('Invalid route index')
      const ops: SettingsOp[] = [{ op: 'unset', path: ['allowedModels', String(at)] }]
      if (raw.enabled && !raw.routes.some(route => route.index !== at)) ops.push({ op: 'set', path: ['enabled'], value: false })
      return ops
    })
    deps.pluginLogger?.info('cast.route-removed', 'Removed subagent cast route.', { index: at })
    return committed
  }

  /**
   * Save one route's plugin-side preferences with the file's own CAS. The
   * returned state is the committed one, so the page never waits for a later
   * refresh that could still carry the previous value.
   */
  const setRoutePreferences = (provider: unknown, model: unknown, preferences: unknown, expectedRevision: unknown, signal?: AbortSignal): CastState => {
    if (typeof provider !== 'string' || !provider.trim() || typeof model !== 'string' || !model.trim()) {
      throw new Error('A route preference requires non-empty provider and model ids')
    }
    if (!deps.profileDir) throw new Error('No profile directory; cast preferences cannot be stored')
    const revision = validateRevision(expectedRevision)
    const stored = readPreferences()
    if (stored.revision !== revision) throw new Error('Cast preferences changed; refresh and retry')
    if (revision === Number.MAX_SAFE_INTEGER) throw new Error('Cast preference revision limit reached')
    const patch = isRecord(preferences) ? preferences : {}
    const next = { tendencies: { ...stored.tendencies }, efforts: { ...stored.efforts } }
    const key = tendencyKey(provider.trim(), model.trim())
    if ('tendency' in patch) {
      if (typeof patch.tendency !== 'string') throw new Error('A tendency must be a string')
      const text = patch.tendency.trim()
      if (text.length > CAST_LIMITS.tendency) throw new Error(`A tendency is limited to ${CAST_LIMITS.tendency} characters`)
      if (text) next.tendencies[key] = text
      else Reflect.deleteProperty(next.tendencies, key)
    }
    if ('reasoningEffort' in patch) {
      if (typeof patch.reasoningEffort !== 'string') throw new Error('A reasoning effort must be a string')
      const effort = patch.reasoningEffort.trim()
      if (effort.length > CAST_LIMITS.effort) throw new Error(`A reasoning effort is limited to ${CAST_LIMITS.effort} characters`)
      if (effort) next.efforts[key] = effort
      else Reflect.deleteProperty(next.efforts, key)
    }
    // Resolve native state before committing so a later aggregate read cannot
    // turn a completed preference save into a rejected RPC.
    const raw = readRaw()
    signal?.throwIfAborted()
    writePreferences(next, revision + 1)
    deps.pluginLogger?.info('cast.preferences-updated', 'Saved subagent route preferences.', {
      provider: provider.trim(),
      model: model.trim(),
      revision: revision + 1,
    })
    try { deps.notifyTendenciesChanged?.(revision + 1) } catch { /* Already committed. */ }
    return { enabled: raw.enabled, revision: raw.revision, tendencyRevision: revision + 1, routes: mergePreferences(raw.routes, next) }
  }

  /** Synchronous read/CAS/rename in one host turn; no native settings write. */
  const setTendency = (provider: unknown, model: unknown, tendency: unknown, expectedRevision: unknown, signal?: AbortSignal): CastState => {
    if (typeof tendency !== 'string') throw new Error('A tendency must be a string')
    return setRoutePreferences(provider, model, { tendency }, expectedRevision, signal)
  }

  /**
   * Section text for the system-prompt injection. The native
   * `subagentModelSelection` service is authoritative when present; a missing
   * or failing service falls back to the settings descriptor, and a failing
   * descriptor hides the section entirely.
   */
  const promptText = (readCurrent?: () => unknown): string => {
    let snapshot: { enabled: boolean; routes: IndexedRoute[] } | undefined
    try {
      const current = readCurrent?.()
      if (isRecord(current)) snapshot = { enabled: current.enabled === true, routes: parseAllowedModels(current.allowedModels).routes }
    } catch {
      snapshot = undefined
    }
    if (!snapshot) {
      try {
        const raw = readRaw()
        snapshot = { enabled: raw.enabled, routes: raw.routes }
      } catch {
        return ''
      }
    }
    try {
      return buildCastPrompt(snapshot.enabled, mergePreferences(snapshot.routes, readPreferences()))
    } catch (error) {
      deps.pluginLogger?.warn('cast.preferences-unavailable', 'Cast preferences unavailable while building prompt.', error)
      deps.logger?.warn('model-hub: cast preferences unavailable: %s', (error as Error).message)
      // Optional user notes must not suppress the generic selection guidance.
      return buildCastPrompt(snapshot.enabled, snapshot.routes)
    }
  }

  return { getCast, setEnabled, addRoute, setRoute, removeRoute, setTendency, setRoutePreferences, promptText }
}

export type Cast = ReturnType<typeof createCast>
