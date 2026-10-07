/**
 * Optional zod binding for the model-route contract. Zod stays an optional
 * peer: plugins that declare config with another schema library can still use
 * the marker object and the detector from the root entry.
 */
import { z } from 'zod'
import { modelRouteMarker, type ModelRouteMarkerMeta } from './marker.ts'

/**
 * Zod field schema for a ModelRoute config entry, pre-marked so hubs detect it
 * without shape heuristics. Defaults mirror defaultModelRoute(): empty means
 * "follow the host default model".
 */
export function modelRouteZod(meta?: ModelRouteMarkerMeta) {
  return z.object({
    provider: z.string().default(''),
    model: z.string().default(''),
    reasoningEffort: z.string().optional(),
  }).meta(modelRouteMarker(meta))
}

/** Attach the model-route marker to any zod schema. */
export function withModelRouteMarker<S extends z.ZodType>(schema: S, meta?: ModelRouteMarkerMeta): S {
  return schema.meta(modelRouteMarker(meta)) as S
}
