/**
 * dsh-model-hub — subagent cast (host half).
 *
 * Edits the host-native `subagent-model-selection-settings` namespace
 * (`enabled` + `allowedModels` routes) through the official settings CAS
 * path, and keeps one user-annotated "task tendency" per route in
 * `<profile>/data/model-hub/cast.json`. Tendencies are advisory hints for
 * the system-prompt injection in index.ts; the main agent still decides
 * which model a delegated subagent receives.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ProbeDescriptorLike } from './probe.ts'

/** Native namespace owning the subagent model-selection preference. */
export const CAST_NAMESPACE = 'subagent-model-selection-settings'
/** Separate revision domain; native settings revisions do not cover this file. */
export const CAST_TENDENCIES_NAMESPACE = '@klarkxy/dsh-model-hub/cast-tendencies'

/** Tendency ids are limited like host route ids; notes stay short prompt lines. */
export const CAST_LIMITS = { id: 250, tendency: 500 } as const

/** One valid route of the cast. `index` is the write handle (see createCast). */
export interface CastRoute {
  /** Position inside the raw native allowedModels array. Malformed entries are
   * skipped when reading, so a route's position in `CastState.routes` can
   * diverge from its raw index; every write addresses routes by this index. */
  index: number
  provider: string
  model: string
  reasoningEffort?: string
  tendency?: string
}

/** Cast snapshot served to the browser half. */
export interface CastState {
  enabled: boolean
  revision: number
  tendencyRevision?: number
  tendencyError?: string
  routes: CastRoute[]
}
/** Native saves acknowledge only the commit; getCast owns later reads. */
export interface CastCommit { committed: true }

type SettingsOp = { op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] }

export interface CastDeps {
  describe(): readonly ProbeDescriptorLike[]
  mutate(ns: string, ops: readonly SettingsOp[], expectedRevision: number): Promise<void>
  profileDir?: string
  logger?: { warn(message: string, ...args: unknown[]): void }
  notifyTendenciesChanged?(revision: number): void
}

/** One valid allowedModels entry plus its raw array index. */
type IndexedRoute = Omit<CastRoute, 'tendency'>

interface RawCast {
  enabled: boolean
  revision: number
  routes: IndexedRoute[]
  /** Raw allowedModels length, malformed entries included. */
  length: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Tendency store key for one provider/model pair. */
export function tendencyKey(provider: string, model: string): string {
  return JSON.stringify([provider, model])
}

/** Keep well-formed entries with their raw indexes; skip malformed ones. */
function parseAllowedModels(value: unknown): { routes: IndexedRoute[]; length: number } {
  const list = Array.isArray(value) ? value : []
  const routes: IndexedRoute[] = []
  list.forEach((entry, index) => {
    if (!isRecord(entry)) return
    const { provider, model, reasoningEffort } = entry
    if (typeof provider !== 'string' || !provider || typeof model !== 'string' || !model) return
    routes.push({
      index, provider, model,
      ...(typeof reasoningEffort === 'string' && reasoningEffort ? { reasoningEffort } : {}),
    })
  })
  return { routes, length: list.length }
}

function normalizeRouteInput(input: unknown): { provider: string; model: string; reasoningEffort?: string } {
  const row = isRecord(input) ? input : {}
  const provider = typeof row.provider === 'string' ? row.provider.trim() : ''
  const model = typeof row.model === 'string' ? row.model.trim() : ''
  if (!provider || !model) throw new Error('A route requires non-empty provider and model ids')
  if (provider.length > CAST_LIMITS.id || model.length > CAST_LIMITS.id) {
    throw new Error(`Route provider and model ids are limited to ${CAST_LIMITS.id} characters`)
  }
  if (row.reasoningEffort !== undefined) {
    const effort = typeof row.reasoningEffort === 'string' ? row.reasoningEffort.trim() : ''
    if (!effort) throw new Error('A route reasoning effort must be a non-empty string')
    if (effort.length > CAST_LIMITS.id) throw new Error(`Route reasoning effort is limited to ${CAST_LIMITS.id} characters`)
    return { provider, model, reasoningEffort: effort }
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
 * tendency-merged routes. Returns '' when the injection should not appear —
 * the host prompt renderer drops empty sections.
 */
export function buildCastPrompt(enabled: boolean, routes: readonly CastRoute[]): string {
  if (!enabled || !routes.length) return ''
  const annotated = routes.filter(route => typeof route.tendency === 'string' && route.tendency.trim())
  // Global settings can differ from a Session's saved route policy. Discovery
  // and the actual tool schema, not this section, determine what it can select.
  const guidance = [
    'Subagent model selection:',
    'When delegating an independent task, actively choose a suitable model instead of silently inheriting your own. If list_subagent_models and a delegation tool with provider/model fields are available, inspect the available routes before the first model-selectable delegation in this task, reuse those results for later delegations, and supply provider and model together explicitly.',
    'Keep provider and model as separate arguments. A discovery label is displayed as provider/model; do not copy the whole label into model or prepend provider to the model id. Example only: if provider is "example-provider" and its list shows "example-provider/team/model-a", pass {"provider":"example-provider","model":"team/model-a"}. Remove only the known display prefix "example-provider/" from that combined label; preserve all slashes and namespaces inside the model id. If discovery already gives separate fields, copy both exactly without stripping or adding any prefix. The example is not an available route.',
    'For independent reviews, alternative approaches, or disputed conclusions, prefer a model different from your own when a suitable candidate is available. Choose for task fit and the user\'s constraints; using the same model is appropriate when it fits better or no suitable alternative is available. Do not create extra subtasks solely for model diversity.',
    'The current Session\'s discovery results and tool schema are authoritative. Its allowed routes are saved when the Session is created and inherited by its subagents; later list edits apply to new top-level Sessions. This limits explicit selection, not pure route inheritance. Configured model notes may refer to routes unavailable in this Session. If discovery or model-selection fields are unavailable, use the supported delegation behavior; do not invent routes or pass unsupported fields to tools such as subagent_fork. When changing models, omit reasoning_effort unless you have verified a supported value.',
  ]
  if (annotated.length) guidance.push(
    'User-provided task tendencies (advisory): prefer a matching tendency among available models. Models without a tendency remain general-purpose candidates; no model-specific strengths are assumed.',
    ...annotated.map(route =>
      `- ${JSON.stringify({ provider: route.provider, model: route.model })}${route.reasoningEffort ? ` (reasoning effort: ${route.reasoningEffort})` : ''}: ${route.tendency}`),
  )
  return guidance.join('\n')
}

export function createCast(deps: CastDeps) {
  const castFile = (): string => {
    if (!deps.profileDir) throw new Error('No profile directory; cast tendencies cannot be stored')
    return join(deps.profileDir, 'data', 'model-hub', 'cast.json')
  }

  // Always read the durable revision: another tab or plugin incarnation may
  // have committed since the last snapshot. Failed reads never become a cache.
  const readTendencies = (): { revision: number; tendencies: Record<string, string> } => {
    if (!deps.profileDir) return { revision: 0, tendencies: {} }
    let raw: string
    try {
      raw = readFileSync(castFile(), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { revision: 0, tendencies: {} }
      throw new Error('Cast tendency store cannot be read; restore access to cast.json and refresh', { cause: error })
    }
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch (error) {
      throw new Error('Cast tendency store is damaged; repair cast.json and refresh', { cause: error })
    }
    if (isRecord(parsed) && parsed.schemaVersion !== 1 && parsed.schemaVersion !== 2) {
      throw new Error('Cast tendency store version is unsupported; use a compatible plugin before saving')
    }
    try {
      if (!isRecord(parsed) || !isRecord(parsed.tendencies)) throw new Error('Invalid tendency store schema')
      if (parsed.schemaVersion === 2 && (!Number.isSafeInteger(parsed.revision) || (parsed.revision as number) < 0)) throw new Error('Invalid tendency store revision')
      for (const [key, value] of Object.entries(parsed.tendencies)) {
        const ids: unknown = JSON.parse(key)
        if (!Array.isArray(ids) || ids.length !== 2 || !ids.every(id => typeof id === 'string' && id.trim()) || typeof value !== 'string') {
          throw new Error('Invalid tendency store entry')
        }
      }
      return { revision: parsed.schemaVersion === 1 ? 0 : parsed.revision as number, tendencies: parsed.tendencies as Record<string, string> }
    } catch (error) {
      throw new Error('Cast tendency store schema is invalid; repair cast.json and refresh', { cause: error })
    }
  }

  /** Atomic store write: temp file plus rename, so a crash never halves JSON. */
  const writeTendencies = (next: Record<string, string>, revision: number): void => {
    const file = castFile()
    mkdirSync(dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.tmp`
    try {
      writeFileSync(temp, JSON.stringify({ schemaVersion: 2, revision, tendencies: next }, null, 2))
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

  const mergeTendencies = (routes: readonly IndexedRoute[], stored: Record<string, string>): CastRoute[] => {
    return routes.map(route => {
      const tendency = stored[tendencyKey(route.provider, route.model)]
      return tendency ? { ...route, tendency } : { ...route }
    })
  }

  const getCast = (): CastState => {
    const raw = readRaw()
    try {
      const stored = readTendencies()
      return { enabled: raw.enabled, revision: raw.revision, tendencyRevision: stored.revision, routes: mergeTendencies(raw.routes, stored.tendencies) }
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
    return write(expectedRevision, raw => {
      if (enabled && raw.routes.length === 0) throw new Error('Add a model before enabling subagent cast')
      return [{ op: 'set', path: ['enabled'], value: enabled }]
    })
  }

  const addRoute = async (input: unknown, expectedRevision: unknown): Promise<CastCommit> => {
    const route = normalizeRouteInput(input)
    return write(expectedRevision, raw => {
      assertUnique(route, raw)
      return [{ op: 'set', path: ['allowedModels', String(raw.length)], value: route }]
    })
  }

  const setRoute = async (index: unknown, input: unknown, expectedRevision: unknown): Promise<CastCommit> => {
    const route = normalizeRouteInput(input)
    const at = validateIndex(index)
    return write(expectedRevision, raw => {
      if (at >= raw.length) throw new Error('Invalid route index')
      assertUnique(route, raw, at)
      return [{ op: 'set', path: ['allowedModels', String(at)], value: route }]
    })
  }

  const removeRoute = async (index: unknown, expectedRevision: unknown): Promise<CastCommit> => {
    const at = validateIndex(index)
    return write(expectedRevision, raw => {
      if (at >= raw.length) throw new Error('Invalid route index')
      const ops: SettingsOp[] = [{ op: 'unset', path: ['allowedModels', String(at)] }]
      if (raw.enabled && !raw.routes.some(route => route.index !== at)) ops.push({ op: 'set', path: ['enabled'], value: false })
      return ops
    })
  }

  /** Synchronous read/CAS/rename in one host turn; no native settings write. */
  const setTendency = (provider: unknown, model: unknown, tendency: unknown, expectedRevision: unknown, signal?: AbortSignal): CastState => {
    if (typeof provider !== 'string' || !provider.trim() || typeof model !== 'string' || !model.trim()) {
      throw new Error('A tendency requires non-empty provider and model ids')
    }
    if (typeof tendency !== 'string') throw new Error('A tendency must be a string')
    const text = tendency.trim()
    if (text.length > CAST_LIMITS.tendency) throw new Error(`A tendency is limited to ${CAST_LIMITS.tendency} characters`)
    if (!deps.profileDir) throw new Error('No profile directory; cast tendencies cannot be stored')
    const revision = validateRevision(expectedRevision)
    const stored = readTendencies()
    if (stored.revision !== revision) throw new Error('Cast tendencies changed; refresh and retry')
    if (revision === Number.MAX_SAFE_INTEGER) throw new Error('Cast tendency revision limit reached')
    // Resolve native state before committing so a later aggregate read cannot
    // turn a completed tendency save into a rejected RPC.
    const raw = readRaw()
    const next = { ...stored.tendencies }
    const key = tendencyKey(provider.trim(), model.trim())
    if (text) next[key] = text
    else Reflect.deleteProperty(next, key)
    signal?.throwIfAborted()
    writeTendencies(next, revision + 1)
    try { deps.notifyTendenciesChanged?.(revision + 1) } catch { /* Already committed. */ }
    return { enabled: raw.enabled, revision: raw.revision, tendencyRevision: revision + 1, routes: mergeTendencies(raw.routes, next) }
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
      return buildCastPrompt(snapshot.enabled, mergeTendencies(snapshot.routes, readTendencies().tendencies))
    } catch (error) {
      deps.logger?.warn('model-hub: cast tendencies unavailable: %s', (error as Error).message)
      // Optional user notes must not suppress the generic selection guidance.
      return buildCastPrompt(snapshot.enabled, snapshot.routes)
    }
  }

  return { getCast, setEnabled, addRoute, setRoute, removeRoute, setTendency, promptText }
}

export type Cast = ReturnType<typeof createCast>
