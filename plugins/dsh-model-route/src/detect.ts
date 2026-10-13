import { readModelRouteMarker, type ModelRouteMarkerMeta } from './marker.ts'
import { modelRouteOverride, normalizeModelRoute, type ModelRoute } from './route.ts'

/** One model-route field found in a projected settings schema. */
export interface DetectedModelField {
  /** Concrete keys and numeric indices; [] denotes an informational item template. */
  readonly path: readonly string[]
  readonly via: 'marker' | 'shape'
  readonly marker?: ModelRouteMarkerMeta
  readonly current?: ModelRoute
  readonly known?: boolean
  /** False for a collection template with no live item to edit. */
  readonly editable?: false
  /** Clearing this route must retain the array element instead of unsetting it. */
  readonly arrayItem?: true
  readonly label?: string
  readonly description?: string
  readonly rootKeys?: readonly string[]
  readonly writeKeys?: readonly string[]
  readonly preserveSiblings?: true
  readonly supportsReasoning?: false
}

export interface DetectModelFieldsOptions {
  readonly value?: unknown
  readonly knownModel?: (route: ModelRoute) => boolean
  /** Recursion budget against deep or circular projections; defaults to 32. */
  readonly maxDepth?: number
}

type Json = Record<string, unknown>
function isObject(value: unknown): value is Json {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** Resolve native Schemastery child ids and JSON Schema local references. */
function projection(root: Json) {
  const refs = isObject(root.refs) ? root.refs : undefined
  const resolve = (input: unknown): Json | undefined => {
    let node: unknown = refs && (typeof input === 'number' || typeof input === 'string') ? refs[String(input)] : input
    const seen = new Set<unknown>()
    for (let step = 0; step < 32 && isObject(node); step++) {
      if (seen.has(node)) return undefined
      seen.add(node)
      const ref = node.$ref
      if (typeof ref !== 'string') return node
      if (ref === '#') { node = root; continue }
      if (!ref.startsWith('#/')) return node
      let target: unknown = root
      for (const segment of ref.slice(2).split('/')) {
        target = isObject(target) ? target[segment.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined
      }
      if (!isObject(target)) return undefined
      node = target
    }
    return undefined
  }
  return { resolve, node: resolve(refs ? root.uid : root) }
}

function allowsString(input: unknown, resolve: (input: unknown) => Json | undefined, depth = 0): boolean {
  if (depth > 16) return false
  const node = resolve(input)
  if (!node) return false
  if (node.type === 'string') return true
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const branches = node[key]
    if (Array.isArray(branches) && branches.some(branch => allowsString(branch, resolve, depth + 1))) return true
  }
  if ((node.type === 'union' || node.type === 'intersect') && Array.isArray(node.list)
    && node.list.some(branch => allowsString(branch, resolve, depth + 1))) return true
  return (node.type === 'transform' || node.type === 'lazy') && allowsString(node.inner, resolve, depth + 1)
}

function routeShape(node: Json, resolve: (input: unknown) => Json | undefined): boolean {
  const properties = routeProperties(node, resolve)
  return Boolean(properties && allowsString(properties.provider, resolve) && allowsString(properties.model, resolve))
}

/** Markers can sit on a transform/union around the actual route object. */
function routeProperties(node: Json, resolve: (input: unknown) => Json | undefined, seen = new Set<Json>()): Json | undefined {
  if (seen.has(node)) return undefined
  seen.add(node)
  const direct = isObject(node.properties) ? node.properties : node.type === 'object' && isObject(node.dict) ? node.dict : undefined
  if (direct) return direct
  const intersect = node.type === 'intersect' && Array.isArray(node.list) ? node.list : Array.isArray(node.allOf) ? node.allOf : undefined
  if (intersect) {
    const merged: Json = {}
    for (const branch of intersect) {
      const child = resolve(branch)
      const properties = child && routeProperties(child, resolve, new Set(seen))
      if (properties) Object.assign(merged, properties)
    }
    return Object.keys(merged).length ? merged : undefined
  }
  const branches = node.type === 'transform' || node.type === 'lazy' ? [node.inner]
    : ['union', 'intersect'].includes(String(node.type)) && Array.isArray(node.list) ? node.list
    : [node.anyOf, node.oneOf, node.allOf].flatMap(value => Array.isArray(value) ? value : [])
  for (const branch of branches) {
    const child = resolve(branch)
    const properties = child && routeProperties(child, resolve, seen)
    if (properties && allowsString(properties.provider, resolve) && allowsString(properties.model, resolve)) return properties
  }
  return undefined
}

/** Same-path wrappers retain their route leaf's presentation/contract metadata. */
function routeMetadata(node: Json, resolve: (input: unknown) => Json | undefined, seen = new Set<Json>()): { marker?: ModelRouteMarkerMeta; label?: string; description?: string } {
  if (seen.has(node)) return {}
  seen.add(node)
  const own = {
    marker: readModelRouteMarker(node),
    label: typeof node.title === 'string' ? node.title : isObject(node.meta) && typeof node.meta.description === 'string' ? node.meta.description : undefined,
    description: typeof node.description === 'string' ? node.description : undefined,
  }
  const branches = node.type === 'transform' || node.type === 'lazy' ? [node.inner]
    : ['union', 'intersect'].includes(String(node.type)) && Array.isArray(node.list) ? node.list
    : [node.anyOf, node.oneOf, node.allOf].flatMap(value => Array.isArray(value) ? value : [])
  for (const branch of branches) {
    const child = resolve(branch)
    if (!child) continue
    const nested = routeMetadata(child, resolve, seen)
    own.marker ??= readModelRouteMarker(branch) ?? nested.marker
    own.label ??= nested.label
    own.description ??= nested.description
  }
  return own
}

/** Recognize both JSON Schema nodes and native serialized Schemastery schemas. */
export function hasModelRouteShape(schema: unknown): boolean {
  if (!isObject(schema)) return false
  const { resolve, node } = projection(schema)
  return Boolean(node && routeShape(node, resolve))
}

/** Find route leaves without visiting unrelated metadata or definition nodes. */
export function detectModelFields(schema: unknown, options: DetectModelFieldsOptions = {}): DetectedModelField[] {
  if (!isObject(schema)) return []
  const { resolve, node: root } = projection(schema)
  if (!root) return []
  const found = new Map<string, DetectedModelField>()
  const maxDepth = options.maxDepth ?? 32
  const ancestors: Array<{ node: Json; value: unknown }> = []
  const visit = (input: unknown, path: string[], value: unknown, depth: number, editable = true, arrayItem = false): void => {
    if (depth > maxDepth) return
    const node = resolve(input)
    if (!node) return
    if (ancestors.some(item => item.node === node && item.value === value)) return
    ancestors.push({ node, value })
    try {
    const metadata = routeMetadata(node, resolve)
    const marker = readModelRouteMarker(input) ?? metadata.marker
    if (marker || routeShape(node, resolve)) {
      const candidate = routeProperties(node, resolve)
      const properties = candidate && allowsString(candidate.provider, resolve) && allowsString(candidate.model, resolve) ? candidate : undefined
      const keys = Object.keys(properties ?? {}).filter(key => ['provider', 'model', 'reasoningEffort'].includes(key))
      const preserveSiblings = properties && (Object.keys(properties).some(key => !keys.includes(key))
        || isObject(value) && Object.keys(value).some(key => !['provider', 'model', 'reasoningEffort'].includes(key)))
      const current = value === undefined ? undefined : normalizeModelRoute(value)
      const override = modelRouteOverride(current)
      const field: DetectedModelField = {
        path, via: marker ? 'marker' : 'shape',
        ...(metadata.label ? { label: metadata.label } : {}),
        ...(metadata.description ? { description: metadata.description } : {}),
        ...(!path.length ? { rootKeys: keys, ...(!properties ? { editable: false as const } : {}) } : {}),
        ...(preserveSiblings ? { preserveSiblings: true as const, writeKeys: keys } : {}),
        ...(properties && !allowsString(properties.reasoningEffort, resolve) ? { supportsReasoning: false as const } : {}),
        ...(marker ? { marker } : {}), ...(current ? { current } : {}),
        ...(override && options.knownModel ? { known: options.knownModel(override) } : {}),
        ...(!editable ? { editable: false as const } : {}), ...(arrayItem ? { arrayItem: true as const } : {}),
      }
      const key = JSON.stringify(path)
      if (!found.has(key) || marker) found.set(key, field)
      return
    }
    for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
      const branches = node[key]
      if (Array.isArray(branches)) for (const branch of branches) visit(branch, path, value, depth + 1, editable, arrayItem)
    }
    if ((node.type === 'union' || node.type === 'intersect') && Array.isArray(node.list)) {
      for (const branch of node.list) visit(branch, path, value, depth + 1, editable, arrayItem)
    }
    if (node.type === 'transform' || node.type === 'lazy') visit(node.inner, path, value, depth + 1, editable, arrayItem)
    const properties = isObject(node.properties) ? node.properties : node.type === 'object' && isObject(node.dict) ? node.dict : undefined
    if (properties) for (const [key, child] of Object.entries(properties)) {
      visit(child, [...path, key], isObject(value) ? value[key] : undefined, depth + 1, editable)
    }
    const items = node.items ?? (node.type === 'array' ? node.inner : undefined)
    if (items !== undefined) {
      if (Array.isArray(value) && value.length) value.forEach((item, index) => visit(items, [...path, String(index)], item, depth + 1, editable, true))
      else visit(items, [...path, '[]'], undefined, depth + 1, false, true)
    }
    if (node.type === 'dict') {
      if (isObject(value) && Object.keys(value).length) for (const [key, item] of Object.entries(value)) visit(node.inner, [...path, key], item, depth + 1, editable)
      else visit(node.inner, [...path, '*'], undefined, depth + 1, false)
    }
    if (isObject(node.additionalProperties)) {
      const declared = new Set(Object.keys(properties ?? {}))
      const extra = isObject(value) ? Object.entries(value).filter(([key]) => !declared.has(key)) : []
      if (extra.length) for (const [key, item] of extra) visit(node.additionalProperties, [...path, key], item, depth + 1, editable)
      else visit(node.additionalProperties, [...path, '*'], undefined, depth + 1, false)
    }
    } finally { ancestors.pop() }
  }
  visit(root, [], options.value, 0)
  return [...found.values()]
}
