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
