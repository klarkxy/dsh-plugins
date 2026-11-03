/**
 * Settings write planning. Given the live `ctx.settings` descriptors and the
 * state a gateway listing implies, produce the `mutate` ops per namespace.
 * The comparison layer is `descriptor.user` when present — the profile-patch
 * section `mutate` edits — otherwise `descriptor.value`; a namespace whose
 * user layer already matches is skipped entirely so a repeat sync never
 * churns the patch.
 */
import {
  NS_DEFAULT_MODEL, NS_LLM, NS_WEB_SEARCH, ROUTE_NAMES, type RouteName,
} from './contracts.ts'

export interface SettingsDescriptorLike {
  ns: string
  value?: unknown
  base?: unknown
  user?: unknown
  revision: number
}

export type PlanOp =
  | { op: 'set'; path: string[]; value: unknown }
  | { op: 'unset'; path: string[] }

export interface NamespacePlan {
  ns: string
  revision: number
  ops: PlanOp[]
}

export interface SyncPlan {
  namespaces: NamespacePlan[]
  warnings: string[]
}

export interface DesiredSync {
  /** Produced provider profiles; absent keys mean "no such route". */
  routes: Partial<Record<RouteName, unknown>>
  /** Credential reference shared by the routes and web search. */
  apiKeyEnv: string
  /** Requested default model id; empty means leave `agent-default-model` alone. */
  defaultModel?: string
  webSearch: boolean
  /** Web-search model id; falls back to defaultModel when empty. */
  webSearchModel?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function layer(descriptor: SettingsDescriptorLike | undefined): unknown {
  return descriptor?.user !== undefined ? descriptor.user : descriptor?.value
}

function getPath(value: unknown, path: readonly string[]): unknown {
  let node = value
  for (const key of path) {
    if (!isRecord(node) && !Array.isArray(node)) return undefined
    node = (node as Record<string, unknown>)[key]
  }
  return node
}

export function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => deepEqual(item, right[index]))
  }
  if (isRecord(left) && isRecord(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)])
    return [...keys].every(key => deepEqual(left[key], right[key]))
  }
  return false
}

function setIfChanged(ops: PlanOp[], current: unknown, path: readonly string[], value: unknown): void {
  if (!deepEqual(getPath(current, path), value)) ops.push({ op: 'set', path: [...path], value })
}

function unsetIfPresent(ops: PlanOp[], current: unknown, path: readonly string[]): void {
  if (getPath(current, path) !== undefined) ops.push({ op: 'unset', path: [...path] })
}

function routeForModel(routes: DesiredSync['routes'], model: string): RouteName | undefined {
  for (const name of ROUTE_NAMES) {
    const models = (routes[name] as { models?: { id?: unknown }[] } | undefined)?.models
    if (Array.isArray(models) && models.some(entry => entry?.id === model)) return name
  }
  return undefined
}

function llmPiAiOps(desired: DesiredSync, current: unknown): PlanOp[] {
  const ops: PlanOp[] = []
  for (const name of ROUTE_NAMES) {
    const profile = desired.routes[name]
    if (profile !== undefined) setIfChanged(ops, current, ['providers', name], profile)
    else unsetIfPresent(ops, current, ['providers', name])
  }
  return ops
}

function webSearchOffOps(current: unknown, root: string): PlanOp[] {
  if (getPath(current, ['baseURL']) !== `${root}/v1`) return []
  const ops: PlanOp[] = []
  unsetIfPresent(ops, current, ['apiKeyEnv'])
  unsetIfPresent(ops, current, ['baseURL'])
  unsetIfPresent(ops, current, ['model'])
  return ops
}

/**
 * Plan the ops writing one gateway state into llm-pi-ai routes, the default
 * model, and web search. Missing namespaces become warnings, not ops.
 */
export function planSync(
  descriptors: readonly SettingsDescriptorLike[],
  desired: DesiredSync,
  root: string,
): SyncPlan {
  const warnings: string[] = []
  const namespaces: NamespacePlan[] = []
  const byNs = new Map(descriptors.map(entry => [entry.ns, entry]))
  const find = (ns: string): SettingsDescriptorLike | undefined => {
    const descriptor = byNs.get(ns)
    if (!descriptor) warnings.push(`settings namespace "${ns}" is not available; skipped`)
    return descriptor
  }

  const llm = find(NS_LLM)
  if (llm) {
    const ops = llmPiAiOps(desired, layer(llm))
    if (ops.length) namespaces.push({ ns: NS_LLM, revision: llm.revision, ops })
  }

  if (desired.defaultModel) {
    const model = desired.defaultModel
    const route = routeForModel(desired.routes, model)
    if (!route) warnings.push(`default model "${model}" is not offered by this gateway; default model unchanged`)
    else {
      const descriptor = find(NS_DEFAULT_MODEL)
      if (descriptor) {
        const current = layer(descriptor)
        const ops: PlanOp[] = []
        setIfChanged(ops, current, ['provider'], route)
        setIfChanged(ops, current, ['model'], model)
        if (ops.length) namespaces.push({ ns: NS_DEFAULT_MODEL, revision: descriptor.revision, ops })
      }
    }
  }

  const search = byNs.get(NS_WEB_SEARCH)
  if (desired.webSearch) {
    const model = desired.webSearchModel || desired.defaultModel
    if (!model) warnings.push('web search is enabled but no model is selected; web search unchanged')
    else if (!search) warnings.push(`settings namespace "${NS_WEB_SEARCH}" is not available; skipped`)
    else {
      const current = layer(search)
      const ops: PlanOp[] = []
      setIfChanged(ops, current, ['apiKeyEnv'], desired.apiKeyEnv)
      setIfChanged(ops, current, ['baseURL'], `${root}/v1`)
      setIfChanged(ops, current, ['model'], model)
      if (ops.length) namespaces.push({ ns: NS_WEB_SEARCH, revision: search.revision, ops })
    }
  } else if (search) {
    const ops = webSearchOffOps(layer(search), root)
    if (ops.length) namespaces.push({ ns: NS_WEB_SEARCH, revision: search.revision, ops })
  }

  return { namespaces, warnings }
}

/** Remove the three routes and revert the defaults they may own; the stored credential is kept. */
export function planDisconnect(descriptors: readonly SettingsDescriptorLike[], root: string): SyncPlan {
  const warnings: string[] = []
  const namespaces: NamespacePlan[] = []
  const byNs = new Map(descriptors.map(entry => [entry.ns, entry]))

  const llm = byNs.get(NS_LLM)
  if (llm) {
    const current = layer(llm)
    const ops: PlanOp[] = []
    for (const name of ROUTE_NAMES) unsetIfPresent(ops, current, ['providers', name])
    if (ops.length) namespaces.push({ ns: NS_LLM, revision: llm.revision, ops })
  } else {
    warnings.push(`settings namespace "${NS_LLM}" is not available; skipped`)
  }

  const fallback = byNs.get(NS_DEFAULT_MODEL)
  if (fallback) {
    const current = layer(fallback)
    if (ROUTE_NAMES.includes(getPath(current, ['provider']) as RouteName)) {
      const ops: PlanOp[] = []
      unsetIfPresent(ops, current, ['provider'])
      unsetIfPresent(ops, current, ['model'])
      if (ops.length) namespaces.push({ ns: NS_DEFAULT_MODEL, revision: fallback.revision, ops })
    }
  }

  const search = byNs.get(NS_WEB_SEARCH)
  if (search) {
    const ops = webSearchOffOps(layer(search), root)
    if (ops.length) namespaces.push({ ns: NS_WEB_SEARCH, revision: search.revision, ops })
  }

  return { namespaces, warnings }
}
