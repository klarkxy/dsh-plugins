/**
 * Optional schemastery binding for the model-route contract. Schemastery is
 * the host's native config-schema library; this entry stays an optional peer
 * so browser-only consumers never load it.
 */
import Schema from '@deepseek-ai/schemastery'
import { MODEL_ROUTE_ROLE, modelRouteMarker, type ModelRouteMarkerMeta } from './marker.ts'
import type { ModelRoute } from './route.ts'

type ModelRouteSchema = ReturnType<typeof base>

function base() {
  return Schema.object({
    provider: Schema.string().default(''),
    model: Schema.string().default(''),
    reasoningEffort: Schema.string(),
  })
}

/**
 * Schemastery field schema for a ModelRoute config entry, marked through the
 * custom `x-model-route` metadata key. Defaults mirror defaultModelRoute():
 * empty means "follow the host default model".
 */
export function modelRouteSchemastery(meta?: ModelRouteMarkerMeta): ModelRouteSchema {
  const schema = base()
  // Meta is a closed interface, so the custom key goes through a cast; the
  // projector either keeps it (precise detection) or shape detection applies.
  schema.meta = { ...schema.meta, ...modelRouteMarker(meta) } as typeof schema.meta
  return schema
}

/**
 * Same field, marked through schemastery's official renderer-role channel
 * (`role('model-route', meta)`) for projectors that drop unknown meta keys.
 */
export function modelRouteRoleSchemastery(meta?: ModelRouteMarkerMeta): ModelRouteSchema {
  return base().role(MODEL_ROUTE_ROLE, meta ?? {}) as ModelRouteSchema
}

/** The config value type these schemas validate to. */
export type ModelRouteSchemasteryValue = ModelRoute
