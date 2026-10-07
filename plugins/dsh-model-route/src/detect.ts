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
}

export interface DetectModelFieldsOptions {
  readonly value?: unknown
  readonly knownModel?: (route: ModelRoute) => boolean
  /** Recursion budget against deep or circular projections; defaults to 6. */
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
  const properties = isObject(node.properties) ? node.properties : node.type === 'object' && isObject(node.dict) ? node.dict : undefined
  return Boolean(properties && allowsString(properties.provider, resolve) && allowsString(properties.model, resolve))
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
  const maxDepth = options.maxDepth ?? 6
  const visit = (input: unknown, path: string[], value: unknown, depth: number, editable = true, arrayItem = false): void => {
    if (depth > maxDepth) return
    const node = resolve(input)
    if (!node) return
    const marker = readModelRouteMarker(input) ?? readModelRouteMarker(node)
    if (marker || routeShape(node, resolve)) {
      const current = value === undefined ? undefined : normalizeModelRoute(value)
      const override = modelRouteOverride(current)
      const field: DetectedModelField = {
        path, via: marker ? 'marker' : 'shape',
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
  }
  visit(root, [], options.value, 0)
  return [...found.values()]
}
