/**
 * Host model-catalog parsing shared by plugin settings UIs and model hubs.
 * Pure and browser-safe: no React, no host imports. The catalog envelope is
 * structural so hosts may add fields without breaking consumers.
 */
import { modelRouteKey, type ModelRoute } from './route.ts'

/** One selectable model. `efforts` are the advertised reasoning efforts. */
export interface ModelMenuChoice {
  readonly provider: string
  readonly model: string
  readonly label: string
  readonly efforts: ReadonlyArray<{ id: string; name: string }>
}

/** Both services are required: Cordis checks the nested namespace separately. */
export const MODEL_CATALOG_INJECT = ['remote', 'remote.session'] as const

export interface ModelCatalogFailure {
  readonly id: string
  readonly name: string
  readonly message: string
}

/** The catalog face this helper needs; stays structural so hosts may add more. */
export interface ModelCatalogClient {
  readonly remote?: {
    readonly session?: { readonly modelCatalog?: () => Promise<unknown> }
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** A useful diagnostic even when a transport rejects with a plain object. */
export function modelCatalogErrorMessage(value: unknown): string {
  if (value instanceof Error && value.message) return value.message
  const row = asRecord(value)
  return asText(row?.message) ?? asText(value) ?? 'Unable to load the model catalog.'
}

/**
 * Validate and unwrap a successful catalog without discarding provider failures
 * or newer host metadata. Names and metadata remain optional for older hosts.
 * A broken response is never presented as a successfully loaded empty menu.
 */
export function checkedModelCatalog(value: unknown): unknown {
  const envelope = asRecord(value)
  if (envelope?.ok === false) throw new Error(modelCatalogErrorMessage(envelope.error ?? envelope))
  const root = envelope?.ok === true ? asRecord(envelope.value) : envelope
  const malformed = (field: string): never => { throw new Error(`Invalid model catalog: ${field}.`) }
  if (!root || !Array.isArray(root.groups)) return malformed('groups must be an array')
  for (const value of root.groups) {
    const group = asRecord(value)
    if (!group || !asText(group.id) || !Array.isArray(group.models)) return malformed('each group needs an id and models array')
    for (const value of group.models) {
      const model = asRecord(value)
      if (!model || !asText(model.id)) return malformed('each model needs an id')
      if (model.reasoning !== undefined) {
        const reasoning = asRecord(model.reasoning)
        if (!reasoning || !Array.isArray(reasoning.efforts) || reasoning.efforts.some(value => !parseEffort(value))) {
          return malformed('reasoning efforts must be an array of identified efforts')
        }
      }
    }
  }
  if (root.failures !== undefined && (!Array.isArray(root.failures) || root.failures.some(value => {
    const failure = asRecord(value)
    return !failure || !asText(failure.id) || typeof failure.name !== 'string' || typeof failure.message !== 'string'
  }))) return malformed('failures must be an array of provider failures')
  return root
}

/** Read through the injected session namespace; absence and rejection are errors. */
export async function readModelCatalog(client: ModelCatalogClient): Promise<unknown> {
  const session = client.remote?.session
  if (typeof session?.modelCatalog !== 'function') {
    throw new Error('Model catalog unavailable: inject both remote and remote.session.')
  }
  return checkedModelCatalog(await session.modelCatalog())
}

/** Provider failures are partial results, not a transport failure. */
export function modelCatalogFailures(value: unknown): readonly ModelCatalogFailure[] {
  // Rendering can precede the checked load boundary (for example hub owner
  // snapshots). Invalid or absent data must not crash the whole settings page.
  try {
    const root = checkedModelCatalog(value) as { failures?: readonly ModelCatalogFailure[] }
    return root.failures ?? []
  } catch { return [] }
}

/** Text adapter for existing model-hub status messages. */
export function catalogFailures(value: unknown): string[] {
  return modelCatalogFailures(value).map(failure => `${failure.name || failure.id}: ${failure.message}`)
}

function parseEffort(value: unknown): { id: string; name: string } | undefined {
  const row = asRecord(value)
  const id = row ? asText(row.id) : undefined
  if (!id) return undefined
  return { id, name: row ? asText(row.name) ?? id : id }
}

/** Parse the host session catalog into flat choices, keeping a saved route selectable. */
export function parseModelMenuChoices(value: unknown, bound?: ModelRoute): ModelMenuChoice[] {
  const envelope = asRecord(value)
  // Host remote calls resolve to a result envelope ({ ok, value }); older hosts
  // and unit tests hand over the bare catalog. Accept both.
  const root = (envelope && envelope.ok === true ? asRecord(envelope.value) : undefined) ?? envelope ?? {}
  const groups = Array.isArray(root.groups) ? root.groups : []
  const choices: ModelMenuChoice[] = []
  for (const group of groups) {
    const groupRow = asRecord(group)
    const provider = groupRow ? asText(groupRow.id) : undefined
    if (!provider || !groupRow || !Array.isArray(groupRow.models)) continue
    const providerName = asText(groupRow.name) ?? provider
    for (const entry of groupRow.models) {
      const modelRow = asRecord(entry)
      const model = modelRow ? asText(modelRow.id) : undefined
      if (!model || !modelRow) continue
      const name = asText(modelRow.name) ?? model
      const reasoning = asRecord(modelRow.reasoning)
      const efforts = reasoning && Array.isArray(reasoning.efforts)
        ? reasoning.efforts.flatMap(effort => { const parsed = parseEffort(effort); return parsed ? [parsed] : [] })
        : []
      choices.push({ provider, model, label: `${providerName} / ${name}`, efforts })
    }
  }
  if (bound?.provider && bound.model && !choices.some(item => item.provider === bound.provider && item.model === bound.model)) {
    choices.push({ provider: bound.provider, model: bound.model, label: `${bound.provider} / ${bound.model}`, efforts: [] })
  }
  return choices
}

/** Reasoning-effort options for one choice; the saved value stays selectable. */
export function modelMenuEffortOptions(
  choice: ModelMenuChoice | undefined,
  current?: string,
): Array<{ id: string; name: string }> {
  const listed = (choice?.efforts ?? []).map(item => ({ ...item }))
  if (current && !listed.some(item => item.id === current)) listed.push({ id: current, name: current })
  return listed
}

/** Flat set of known routes for DetectModelFieldsOptions.knownModel. */
export function knownModelFromChoices(choices: readonly ModelMenuChoice[]): (route: ModelRoute) => boolean {
  const known = new Set(choices.map(choice => modelRouteKey(choice.provider, choice.model)))
  return route => known.has(modelRouteKey(route.provider, route.model))
}
