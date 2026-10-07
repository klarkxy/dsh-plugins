/**
 * The schema marker a feature plugin puts on a model-route config field so a
 * hub can find it without heuristics. The marker is an accelerator, not a
 * requirement: detectModelFields also recognizes the bare ModelRoute shape.
 *
 * Two marking channels exist because host projection fidelity differs per
 * schema library:
 *
 * - **extra key** — a custom `x-model-route` property on the schema node's
 *   metadata. Preferred, but a projector may drop unknown keys.
 * - **renderer role** — schemastery's official `.role('model-route', meta)`
 *   channel, which form renderers already understand and projectors are more
 *   likely to keep.
 *
 * The reader accepts both, at the node top level and inside the cordis
 * metadata bag (`x-cordis`), so consumers stay correct across projections.
 */

export const MODEL_ROUTE_MARKER = 'x-model-route'
export const MODEL_ROUTE_ROLE = 'model-route'

export interface ModelRouteMarkerMeta {
  /** Stable purpose id, e.g. 'summary' or 'vision'. */
  purpose?: string
  /** Human label a hub can show, e.g. '总结模型'. */
  label?: string
  /** Set false to hide the reasoning-effort input for this field. */
  reasoningEffort?: boolean
}

/** The object to merge into a schema library's metadata slot. */
export function modelRouteMarker(meta?: ModelRouteMarkerMeta): Record<typeof MODEL_ROUTE_MARKER, ModelRouteMarkerMeta> {
  return { [MODEL_ROUTE_MARKER]: meta ?? {} }
}

function asMeta(value: unknown): ModelRouteMarkerMeta | undefined {
  if (value === true) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as ModelRouteMarkerMeta
}

/** Read the marker off a projected JSON-schema node; undefined when absent. */
export function readModelRouteMarker(node: unknown): ModelRouteMarkerMeta | undefined {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined
  const record = node as Record<string, unknown>
  const direct = asMeta(record[MODEL_ROUTE_MARKER])
  if (direct) return direct
  // SettingsForms projects Schemastery nodes with their original meta bag.
  const meta = record.meta
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const bag = meta as Record<string, unknown>
    const fromMeta = asMeta(bag[MODEL_ROUTE_MARKER])
    if (fromMeta) return fromMeta
    if (bag.role === MODEL_ROUTE_ROLE) return asMeta(bag.extra) ?? {}
  }
  const bag = record['x-cordis']
  if (bag && typeof bag === 'object' && !Array.isArray(bag)) {
    const fromBag = asMeta((bag as Record<string, unknown>)[MODEL_ROUTE_MARKER])
    if (fromBag) return fromBag
    if ((bag as Record<string, unknown>).role === MODEL_ROUTE_ROLE) {
      return asMeta((bag as Record<string, unknown>).extra) ?? {}
    }
  }
  if (record.role === MODEL_ROUTE_ROLE) return asMeta(record.extra) ?? {}
  return undefined
}
