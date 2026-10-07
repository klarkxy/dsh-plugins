/**
 * Shared plugin-page model menu.
 *
 * Everything lives in @klarkxy/dsh-model-route: the pure contract (route
 * values, schema marker, catalog parsing, menu grouping) in its core entry,
 * and the ModelMenu popover component in its `./ui` browser entry. This entry
 * re-exports the core so existing plugin-kit consumers keep working, and adds
 * the React catalog hook on top. It must stay free of any ui-primitives
 * import so host-side and node-test consumers never load the component
 * bundle — the popover component and its styles are re-exported from
 * `./model-menu-ui` instead.
 */
import { useEffect, useState } from 'react'
import { parseModelMenuChoices, type ModelCatalogClient, type ModelMenuChoice, type ModelRoute } from '@klarkxy/dsh-model-route'

export type { ModelCatalogClient, ModelMenuChoice, ModelMenuGroup } from '@klarkxy/dsh-model-route'
export {
  groupModelMenuChoices,
  knownModelFromChoices,
  modelMenuEffortOptions,
  modelMenuShortName,
  modelRouteKey as modelMenuChoiceKey,
  modelRouteOverride as modelMenuOverride,
  normalizeModelRoute as normalizeModelMenuRoute,
  parseModelMenuChoices,
  parseModelRouteKey as parseModelMenuChoiceKey,
} from '@klarkxy/dsh-model-route'

/** The stored selection. Empty provider/model means "follow the default". */
export type ModelMenuRoute = ModelRoute

/** Load the host catalog once per mount and republish whenever it answers. */
export function useModelMenuChoices(client: ModelCatalogClient, bound?: ModelMenuRoute): ModelMenuChoice[] {
  const [choices, setChoices] = useState<ModelMenuChoice[]>([])
  useEffect(() => {
    if (typeof document === 'undefined') return
    let live = true
    const load = () => {
      void client.remote?.session?.modelCatalog?.()
        ?.then(value => { if (live) setChoices(parseModelMenuChoices(value, bound)) })
        .catch(() => { if (live) setChoices([]) })
    }
    load()
    return () => { live = false }
  }, [client, bound?.provider, bound?.model])
  return choices
}
