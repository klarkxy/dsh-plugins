/**
 * Shared plugin-page model menu.
 *
 * A feature plugin's own settings row exposes a model select. An empty
 * selection means the host default chat model for that feature's own call.
 *
 * Browser-safe and React-optional: pure helpers live here so hosts and clients
 * share one catalog contract without bundling React into the host build.
 */
import { useEffect, useState } from 'react'
import type { ModelRoute } from './contracts.ts'

/** One selectable model. `efforts` are the advertised reasoning efforts. */
export interface ModelMenuChoice {
  readonly provider: string
  readonly model: string
  readonly label: string
  readonly efforts: ReadonlyArray<{ id: string; name: string }>
}

/** The stored selection. Empty provider/model means "follow the default". */
export type ModelMenuRoute = ModelRoute

/** The catalog face this helper needs; stays structural so hosts may add more. */
export interface ModelCatalogClient {
  readonly remote?: {
    readonly session?: { readonly modelCatalog?: () => Promise<unknown> }
  }
}

const KEY_SEPARATOR = '\u001f'

export function modelMenuChoiceKey(provider: string, model: string): string {
  return provider && model ? `${provider}${KEY_SEPARATOR}${model}` : ''
}

export function parseModelMenuChoiceKey(value: string): { provider: string; model: string } | undefined {
  const index = value.indexOf(KEY_SEPARATOR)
  if (index <= 0) return undefined
  const provider = value.slice(0, index)
  const model = value.slice(index + KEY_SEPARATOR.length)
  if (!provider || !model) return undefined
  return { provider, model }
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
export function parseModelMenuChoices(value: unknown, bound?: ModelMenuRoute): ModelMenuChoice[] {
  const root = asRecord(value) ?? {}
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

/** An empty saved route means no explicit model. */
export function modelMenuOverride(route: ModelMenuRoute | undefined): ModelRoute | undefined {
  const provider = route?.provider?.trim()
  const model = route?.model?.trim()
  if (!provider || !model) return undefined
  const effort = route?.reasoningEffort?.trim()
  return effort ? { provider, model, reasoningEffort: effort } : { provider, model }
}

export function normalizeModelMenuRoute(value: unknown): ModelMenuRoute {
  const row = asRecord(value)
  if (!row) return { provider: '', model: '' }
  const provider = asText(row.provider) ?? ''
  const model = asText(row.model) ?? ''
  const effort = asText(row.reasoningEffort)
  if (!provider || !model || provider.length > 250 || model.length > 250) return { provider: '', model: '' }
  return effort && effort.length <= 80 ? { provider, model, reasoningEffort: effort } : { provider, model }
}

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

/** Reasoning-effort options for one choice; the saved value stays selectable. */
export function modelMenuEffortOptions(
  choice: ModelMenuChoice | undefined,
  current?: string,
): Array<{ id: string; name: string }> {
  const listed = (choice?.efforts ?? []).map(item => ({ ...item }))
  if (current && !listed.some(item => item.id === current)) listed.push({ id: current, name: current })
  return listed
}
