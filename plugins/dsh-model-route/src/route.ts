/**
 * Shared model-route value contract.
 *
 * A feature plugin stores its model override as a ModelRoute on its own
 * settings page. Empty provider/model means "follow the host default model".
 * Pure and browser-safe: no cordis, no React, no schema library.
 */

/** A concrete provider model a feature call should use. */
export interface ModelRoute {
  provider: string
  model: string
  reasoningEffort?: string
}

/** Empty route: no explicit model, the feature follows the host default. */
export function defaultModelRoute(): ModelRoute {
  return { provider: '', model: '' }
}

/** Structural check: both id fields are strings (either may be empty). */
export function isModelRouteValue(value: unknown): value is ModelRoute {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return typeof row.provider === 'string' && typeof row.model === 'string'
}

const MAX_ID_CHARS = 250
const MAX_EFFORT_CHARS = 80

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * Coerce a stored value into a ModelRoute. Anything malformed collapses to the
 * empty route, matching the per-plugin normalizers this contract replaces.
 */
export function normalizeModelRoute(value: unknown): ModelRoute {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultModelRoute()
  const row = value as Record<string, unknown>
  const provider = asText(row.provider) ?? ''
  const model = asText(row.model) ?? ''
  const effort = asText(row.reasoningEffort)
  if (!provider || !model || provider.length > MAX_ID_CHARS || model.length > MAX_ID_CHARS) return defaultModelRoute()
  return effort && effort.length <= MAX_EFFORT_CHARS ? { provider, model, reasoningEffort: effort } : { provider, model }
}

/** The override to actually call with: undefined when the route is empty. */
export function modelRouteOverride(route: ModelRoute | undefined): ModelRoute | undefined {
  const provider = route?.provider?.trim()
  const model = route?.model?.trim()
  if (!provider || !model) return undefined
  const effort = route?.reasoningEffort?.trim()
  return effort ? { provider, model, reasoningEffort: effort } : { provider, model }
}

const KEY_SEPARATOR = '\u001f'

/** Stable key for one route, safe to use as a select-option value. */
export function modelRouteKey(provider: string, model: string): string {
  return provider && model ? `${provider}${KEY_SEPARATOR}${model}` : ''
}

/** Inverse of modelRouteKey; undefined for malformed keys. */
export function parseModelRouteKey(value: string): { provider: string; model: string } | undefined {
  const index = value.indexOf(KEY_SEPARATOR)
  if (index <= 0) return undefined
  const provider = value.slice(0, index)
  const model = value.slice(index + KEY_SEPARATOR.length)
  if (!provider || !model) return undefined
  return { provider, model }
}

/** True when both routes name the same target; two empty routes are equal. */
export function sameModelRoute(a: ModelRoute | undefined, b: ModelRoute | undefined): boolean {
  const left = modelRouteOverride(a)
  const right = modelRouteOverride(b)
  if (!left || !right) return !left === !right
  return left.provider === right.provider && left.model === right.model
    && (left.reasoningEffort ?? '') === (right.reasoningEffort ?? '')
}
