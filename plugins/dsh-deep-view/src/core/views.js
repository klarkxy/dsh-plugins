// Adapted from deep-view/src/core/views.js (deep-view 0.1.0, Apache-2.0).
// DSH migration: html is deliberately rejected rather than migrating its frame;
// validation, formulas and answers retain the original bounded JSON semantics,
// while normalizeView absorbs common model authoring habits (inline titles,
// object table rows, tone aliases, hyphenated ids and auto-laid-out graphs).

import { compileFormula, createScope, evaluate, isName, MATH_CONSTANTS, show } from './formula.js'

const LAYOUT = ['stack', 'row']
const DISPLAY = ['text', 'metric', 'table', 'chart', 'progress', 'callout', 'sources', 'steps']
const INPUT_TYPES = ['slider', 'choice', 'toggle', 'number', 'math', 'flow', 'explore', 'map']
const ANSWERS = ['options', 'confirm', 'form', 'submit']
const COMPONENTS = [...LAYOUT, ...DISPLAY, ...INPUT_TYPES, ...ANSWERS]
const TONES = ['good', 'warn', 'bad', 'accent']
const TEXT_TONES = ['muted']
const CALLOUT_TONES = ['info', 'good', 'warn', 'bad']
export const CHART_KINDS = ['bar', 'hbar', 'line', 'area', 'donut']
const INTERACTIVE = new Set(ANSWERS)
const INPUTS = new Set(INPUT_TYPES)
const PROPS = {
  stack: ['id', 'children', 'let'],
  row: ['id', 'children', 'let'],
  text: ['id', 'text', 'tone'],
  metric: ['id', 'label', 'value', 'unit', 'tone', 'caption'],
  table: ['id', 'columns', 'rows', 'caption'],
  chart: ['id', 'kind', 'categories', 'series', 'unit', 'caption'],
  progress: ['id', 'label', 'percent', 'value', 'max', 'valueLabel', 'tone'],
  callout: ['id', 'text', 'tone'],
  sources: ['id', 'items'],
  steps: ['id', 'items'],
  slider: ['id', 'label', 'min', 'max', 'step', 'value', 'unit'],
  choice: ['id', 'label', 'options', 'value'],
  toggle: ['id', 'label', 'value'],
  number: ['id', 'label', 'min', 'max', 'step', 'value', 'unit'],
  math: ['id', 'mathPoints', 'curves', 'domain', 'range', 'caption'],
  flow: ['id', 'nodes', 'edges', 'caption'],
  explore: ['id', 'data', 'xKey', 'yKey', 'colorKey', 'select', 'caption'],
  map: ['id', 'center', 'zoom', 'locations', 'routes', 'caption'],
  options: ['id', 'options', 'multi'],
  confirm: ['id', 'confirmLabel', 'cancelLabel'],
  form: ['id', 'fields', 'submitLabel', 'cancelLabel'],
  submit: ['id', 'label'],
}
const FIELD_PROPS = ['id', 'label', 'placeholder', 'value', 'multiline', 'readOnly']
const STEP_STATUSES = ['done', 'active', 'pending', 'blocked']
const MAX_DEPTH = 8
// Component nesting stops at MAX_DEPTH. This cap is separate: it bounds every
// array and object normalizeView walks. A nested array still fits in
// VIEW_BYTE_LIMIT at a few thousand levels, and the recursive walk overflows
// the stack before that (sooner after this function grew a larger frame).
// Past the cap the raw value stays in place so validation can reject it.
const MAX_NORMALIZE_DEPTH = 64
const MAX_NODES = 64
const MAX_CHILDREN = 16
const MAX_TEXT = 2000
const MAX_CELL = 400
const MAX_COLUMNS = 8
const MAX_ROWS = 50
const MAX_OPTIONS = 8
const MAX_FIELDS = 6
const MAX_STEPS = 8
const SUMMARY_PART = 40
const SUMMARY_COUNT = 8
const RESERVED = new Set(['true', 'false'])
// UTF-8 bytes of the blueprint JSON plus the title. Not a wrapped document:
// the tool rejects a show_view whose viewBytes() is over this before it
// normalizes or validates, so the number has to be the bytes the model sent.
export const VIEW_BYTE_LIMIT = 8192

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const quoted = value => JSON.stringify(value)
const allowed = list => list.join(', ')
const isNumber = value => typeof value === 'number' && Number.isFinite(value)
const isScalar = value => typeof value === 'string' || typeof value === 'boolean' || isNumber(value)
const setOwn = (target, key, value) => Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true })

// `{ "=": "a * b" }`: a value worked out from the view's inputs.
export const isFormula = value => isRecord(value) && Object.keys(value).length === 1 && Object.hasOwn(value, '=')

export function viewBytes(title, view) {
  return new TextEncoder().encode(`${JSON.stringify(view) ?? ''}${title ?? ''}`).length
}

const NUMERIC = ['value', 'percent', 'min', 'max', 'step', 'height']
const numeric = value => (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)) ? Number(value) : value)

const METRIC_TONE_ALIASES = {
  success: 'good', positive: 'good', ok: 'good',
  warning: 'warn', caution: 'warn',
  error: 'bad', danger: 'bad', critical: 'bad', negative: 'bad',
  info: 'accent', primary: 'accent', highlight: 'accent',
}
const CALLOUT_TONE_ALIASES = {
  neutral: 'info', accent: 'info', primary: 'info', default: 'info', note: 'info', tip: 'info',
  success: 'good', positive: 'good', ok: 'good',
  warning: 'warn', caution: 'warn',
  error: 'bad', danger: 'bad', critical: 'bad',
}
const FLOW_TONE_ALIASES = {
  good: 'success', positive: 'success', ok: 'success',
  info: 'accent', primary: 'accent', highlight: 'accent',
  warning: 'warn', caution: 'warn',
  error: 'bad', danger: 'bad', critical: 'bad',
  default: 'neutral', muted: 'neutral',
}
const CHART_KIND_ALIASES = {
  pie: 'donut',
  column: 'bar', vertical: 'bar',
  horizontal: 'hbar', 'horizontal-bar': 'hbar', 'bar-horizontal': 'hbar',
}
const STEP_STATUS_ALIASES = {
  completed: 'done', complete: 'done', success: 'done', finished: 'done',
  running: 'active', in_progress: 'active', 'in-progress': 'active', current: 'active', ongoing: 'active',
  todo: 'pending', waiting: 'pending', queued: 'pending',
  error: 'blocked', failed: 'blocked',
}
const NEEDS_AUTO_ID = new Set(['slider', 'number', 'choice', 'toggle', 'flow', 'map', 'explore', 'math', 'options', 'confirm', 'form', 'submit'])
const DISPLAY_TYPES = new Set([...LAYOUT, ...DISPLAY])
const FORBIDDEN_PROPS = new Set(['__proto__', 'constructor', 'prototype'])
const asArray = value => isRecord(value) ? [value] : value
const boolean = value => typeof value === 'string' && /^(true|false)$/i.test(value.trim()) ? value.trim().toLowerCase() === 'true' : value
const coordinatePair = value => Array.isArray(value) && value.length === 2 ? value.map(numeric) : value

function safeIdentifier(raw, fallbackPrefix, used) {
  const cleaned = typeof raw === 'string'
    ? raw.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^(\d)/, '_$1').replace(/^_+$/, '')
    : ''
  let candidate = cleaned !== '' && isName(cleaned) && !RESERVED.has(cleaned) ? cleaned : fallbackPrefix
  if (used) {
    let suffix = 2
    const base = candidate
    while (used.has(candidate) || RESERVED.has(candidate)) candidate = `${base}_${suffix++}`
    used.add(candidate)
  }
  return candidate
}

// Compute clean topological layered coordinates when the model omits node (x, y)
// or leaves every node stacked at (0, 0). Keeps explicit non-overlapping coords intact.
function autoLayoutFlowNodes(nodes, edges) {
  if (!Array.isArray(nodes) || nodes.length === 0) return nodes
  const validRecords = nodes.every(item => isRecord(item))
  if (!validRecords) return nodes
  const allMissing = nodes.every(item => item.x === undefined && item.y === undefined)
  const allZero = nodes.length > 1 && nodes.every(item => item.x === 0 && item.y === 0)
  const anyBothMissing = nodes.some(item => item.x === undefined && item.y === undefined)
  if (!allMissing && !allZero && !anyBothMissing) return nodes

  const ids = nodes.map(item => (typeof item.id === 'string' ? item.id : ''))
  const indexById = new Map(ids.map((id, index) => [id, index]))
  const outgoing = Array.from({ length: nodes.length }, () => [])
  const indegree = new Array(nodes.length).fill(0)
  for (const edge of Array.isArray(edges) ? edges : []) {
    if (!isRecord(edge)) continue
    const u = indexById.get(edge.source)
    const v = indexById.get(edge.target)
    if (u === undefined || v === undefined || u === v) continue
    outgoing[u].push(v)
    indegree[v] += 1
  }

  const hasEdges = outgoing.some(list => list.length > 0)
  const rank = new Array(nodes.length).fill(0)
  if (!hasEdges) {
    const perRow = nodes.length <= 4 ? nodes.length : 3
    return nodes.map((item, index) => {
      if (!allMissing && !allZero && !(item.x === undefined && item.y === undefined)) return item
      const col = index % perRow
      const row = Math.floor(index / perRow)
      const next = {}
      for (const k of Object.keys(item)) setOwn(next, k, item[k])
      setOwn(next, 'x', col * 228)
      setOwn(next, 'y', row * 108)
      return next
    })
  }

  // Kahn's topological longest-path rank assignment with deterministic cycle breaking.
  const remaining = [...indegree]
  const settled = new Array(nodes.length).fill(false)
  let processed = 0
  while (processed < nodes.length) {
    let queue = []
    for (let i = 0; i < nodes.length; i++) if (!settled[i] && remaining[i] <= 0) queue.push(i)
    if (queue.length === 0) {
      // Break cycle at the earliest unsettled node.
      const pick = settled.findIndex(done => !done)
      queue = [pick]
    }
    for (const u of queue) {
      settled[u] = true
      processed += 1
      for (const v of outgoing[u]) {
        if (!settled[v]) rank[v] = Math.max(rank[v], Math.min(nodes.length - 1, rank[u] + 1))
        remaining[v] -= 1
      }
    }
  }

  const maxRank = Math.max(...rank, 0)
  const groups = new Map()
  for (let i = 0; i < nodes.length; i++) {
    const r = rank[i]
    if (!groups.has(r)) groups.set(r, [])
    groups.get(r).push(i)
  }
  // Wide multi-hop pipelines (> 4 stages) read cleaner top-to-bottom in narrow chat columns.
  const vertical = maxRank >= 4
  const coords = new Array(nodes.length)
  for (const [r, members] of groups) {
    const count = members.length
    members.forEach((nodeIndex, slot) => {
      const offset = (slot - (count - 1) / 2)
      coords[nodeIndex] = vertical
        ? { x: Math.round(offset * 224), y: r * 116 }
        : { x: r * 236, y: Math.round(offset * 108) }
    })
  }
  return nodes.map((item, index) => {
    if (!allMissing && !allZero && !(item.x === undefined && item.y === undefined)) return item
    const next = {}
    for (const k of Object.keys(item)) setOwn(next, k, item[k])
    setOwn(next, 'x', coords[index].x)
    setOwn(next, 'y', coords[index].y)
    return next
  })
}

function normalizeComponent(out, depth, state) {
  if (Object.hasOwn(out, '__proto__')) return out
  const type = typeof out.type === 'string' ? out.type.trim().toLowerCase() : out.type
  if (type !== out.type) setOwn(out, 'type', type)
  if (typeof type !== 'string' || !COMPONENTS.includes(type)) return out

  // Providers and models often omit brackets around a one-item collection.
  const collections = type === 'stack' || type === 'row' ? ['children']
    : type === 'table' ? ['columns', 'rows']
      : type === 'chart' ? ['categories', 'series']
        : type === 'steps' || type === 'sources' ? ['items']
          : type === 'flow' ? ['nodes', 'edges']
            : type === 'math' ? ['mathPoints', 'curves']
            : type === 'map' ? ['locations', 'routes']
              : type === 'form' ? ['fields']
                : type === 'choice' || type === 'options' ? ['options'] : []
  for (const key of collections) if (Object.hasOwn(out, key)) setOwn(out, key, asArray(out[key]))

  // Models frequently attach `title` directly on a ViewNode instead of the outer
  // { title, view } envelope, or on nested chart/table/flow blocks.
  if (typeof out.title === 'string') {
    const trimmed = out.title.trim()
    delete out.title
    if (depth > 0 && trimmed !== '') {
      if (PROPS[type].includes('label') && out.label === undefined) setOwn(out, 'label', trimmed)
      else if (PROPS[type].includes('caption') && out.caption === undefined) setOwn(out, 'caption', trimmed)
    }
  }

  // Unify tone synonyms across metric/progress, callout, text and flow.
  if (typeof out.tone === 'string') {
    if (type === 'metric' || type === 'progress') {
      if (out.tone === 'neutral' || out.tone === 'default') delete out.tone
      else if (Object.hasOwn(METRIC_TONE_ALIASES, out.tone)) setOwn(out, 'tone', METRIC_TONE_ALIASES[out.tone])
    } else if (type === 'callout') {
      if (Object.hasOwn(CALLOUT_TONE_ALIASES, out.tone)) setOwn(out, 'tone', CALLOUT_TONE_ALIASES[out.tone])
    } else if (type === 'text') {
      if (out.tone === 'default' || out.tone === 'neutral') delete out.tone
      else if (out.tone === 'secondary' || out.tone === 'subtle') setOwn(out, 'tone', 'muted')
    }
  }

  // Supply or sanitize component ids where required so hyphenated ids ("api-flow")
  // or omitted display-only rich ids never discard a valid card.
  if (NEEDS_AUTO_ID.has(type)) {
    if (out.id === undefined) {
      setOwn(out, 'id', safeIdentifier('', `${type}_${++state.seq}`, state.ids))
    } else if (typeof out.id === 'string' && out.id.trim() !== '' && !isName(out.id) && !RESERVED.has(out.id)) {
      // Only rewrite when called through checkShownView's wire normalization;
      // direct validateView(raw) calls still enforce strict identifier syntax.
      setOwn(out, 'id', safeIdentifier(out.id, `${type}_${++state.seq}`, state.ids))
    } else if (typeof out.id === 'string' && isName(out.id)) {
      state.ids.add(out.id)
    }
  } else if (INPUTS.has(type) && typeof out.id === 'string' && out.id.trim() !== '' && !isName(out.id) && !RESERVED.has(out.id)) {
    setOwn(out, 'id', safeIdentifier(out.id, `${type}_${++state.seq}`, state.ids))
  }

  if ((type === 'text' || type === 'callout') && isScalar(out.text) && typeof out.text !== 'string') {
    setOwn(out, 'text', String(out.text))
  }
  for (const key of ['label', 'caption', 'unit']) {
    if (isScalar(out[key]) && typeof out[key] !== 'string') setOwn(out, key, String(out[key]))
  }
  if (['slider', 'number', 'choice', 'toggle'].includes(type) && out.label === undefined && typeof out.id === 'string') setOwn(out, 'label', out.id)

  if (type === 'choice' || type === 'options') {
    if (Array.isArray(out.options)) {
      setOwn(out, 'options', out.options.map(option => {
        if (isScalar(option)) return { label: String(option), ...(type === 'choice' ? { value: numeric(option) } : {}) }
        if (!isRecord(option) || Object.hasOwn(option, '__proto__')) return option
        const next = {}
        for (const key of Object.keys(option)) {
          if (['title', 'name', 'text'].includes(key) && option.label === undefined) setOwn(next, 'label', option[key])
          else setOwn(next, key, option[key])
        }
        if (isScalar(next.label) && typeof next.label !== 'string') setOwn(next, 'label', String(next.label))
        return next
      }))
    }
  }
  if (type === 'options' && out.multi !== undefined) setOwn(out, 'multi', boolean(out.multi))
  if (type === 'toggle' && out.value !== undefined) setOwn(out, 'value', boolean(out.value))

  if (type === 'table') {
    // Infer columns only when every row is a plain object: a single array or
    // scalar row would silently lose its cells under the inferred columns, so
    // mixed shapes keep `columns` undefined and let the validator complain.
    if (out.columns === undefined && Array.isArray(out.rows) && out.rows.every(row => isRecord(row) && !isFormula(row))) {
      // Union every row's keys in first-seen order: a later row may add
      // a column the first one lacks (an empty first row is no evidence at all).
      const keys = []
      for (const row of out.rows) {
        for (const key of Object.keys(row)) if (!FORBIDDEN_PROPS.has(key) && !keys.includes(key)) keys.push(key)
      }
      if (keys.length > 0) setOwn(out, 'columns', keys.map(key => ({ key, label: key })))
    }
    if (Array.isArray(out.columns)) {
      const cols = out.columns.map((col, idx) => {
        if (typeof col === 'string') return { key: `col_${idx}`, label: col }
        if (!isRecord(col) || Object.hasOwn(col, '__proto__')) return col
        const keys = Object.keys(col)
        if (keys.some(k => !['key', 'id', 'label', 'title', 'name'].includes(k))) return col
        const label = typeof col.label === 'string' ? col.label
          : typeof col.title === 'string' ? col.title
            : typeof col.name === 'string' ? col.name : col.label
        const key = typeof col.key === 'string' && col.key !== '' ? col.key
          : typeof col.id === 'string' && col.id !== '' ? col.id
            : typeof label === 'string' ? `col_${idx}` : col.key
        const nextCol = {}
        if (key !== undefined) setOwn(nextCol, 'key', key)
        if (label !== undefined) setOwn(nextCol, 'label', label)
        return nextCol
      })
      setOwn(out, 'columns', cols)
      if (Array.isArray(out.rows)) {
        setOwn(out, 'rows', out.rows.map(row => {
          if (!isRecord(row) || isFormula(row)) return row
          return cols.map(col => isRecord(col)
            ? (Object.hasOwn(row, col.key) ? row[col.key] : Object.hasOwn(row, col.label) ? row[col.label] : '')
            : '')
        }))
      }
    }
  } else if (type === 'chart') {
    if (typeof out.kind === 'string') setOwn(out, 'kind', out.kind.trim().toLowerCase())
    if (typeof out.kind === 'string' && Object.hasOwn(CHART_KIND_ALIASES, out.kind)) setOwn(out, 'kind', CHART_KIND_ALIASES[out.kind])
    if (out.categories === undefined && Array.isArray(out.labels)) {
      setOwn(out, 'categories', out.labels)
      delete out.labels
    }
    if (Array.isArray(out.series)) {
      setOwn(out, 'series', out.series.map(item => {
        if (!isRecord(item) || Object.hasOwn(item, '__proto__')) return item
        const nextSeries = {}
        for (const k of Object.keys(item)) {
          if (k === 'label' && item.name === undefined) setOwn(nextSeries, 'name', item.label)
          else if (k === 'data' && item.values === undefined && Array.isArray(item.data)) setOwn(nextSeries, 'values', item.data.map(numeric))
          else setOwn(nextSeries, k, item[k])
        }
        return nextSeries
      }))
    }
  } else if (type === 'steps' && Array.isArray(out.items)) {
    setOwn(out, 'items', out.items.map(item => {
      if (!isRecord(item) || Object.hasOwn(item, '__proto__')) return item
      const nextStep = {}
      for (const k of Object.keys(item)) {
        if (k === 'title' && item.label === undefined) setOwn(nextStep, 'label', item.title)
        else if ((k === 'description' || k === 'text') && item.detail === undefined) setOwn(nextStep, 'detail', item[k])
        else if (k === 'status' && typeof item.status === 'string' && Object.hasOwn(STEP_STATUS_ALIASES, item.status)) setOwn(nextStep, 'status', STEP_STATUS_ALIASES[item.status])
        else setOwn(nextStep, k, item[k])
      }
      return nextStep
    }))
  } else if (type === 'math') {
    for (const key of ['domain', 'range']) if (Object.hasOwn(out, key)) setOwn(out, key, coordinatePair(out[key]))
    if (Array.isArray(out.mathPoints)) {
      setOwn(out, 'mathPoints', out.mathPoints.map(point => {
        if (!isRecord(point) || Object.hasOwn(point, '__proto__')) return point
        const next = {}
        for (const key of Object.keys(point)) setOwn(next, key, key === 'x' || key === 'y' ? numeric(point[key]) : point[key])
        return next
      }))
    }
  } else if (type === 'explore' && Array.isArray(out.data)) {
    setOwn(out, 'data', out.data.map(row => {
      if (!isRecord(row) || Object.hasOwn(row, '__proto__')) return row
      const next = {}
      for (const key of Object.keys(row)) setOwn(next, key, key === out.xKey || key === out.yKey ? numeric(row[key]) : row[key])
      return next
    }))
  } else if (type === 'flow') {
    const nodeIds = new Set()
    const remap = new Map()
    if (Array.isArray(out.nodes)) {
      const normalizedNodes = out.nodes.map((item, idx) => {
        if (!isRecord(item) || Object.hasOwn(item, '__proto__')) return item
        const nextNode = {}
        for (const k of Object.keys(item)) {
          if (k === 'title' && item.label === undefined) setOwn(nextNode, 'label', item.title)
          else if ((k === 'description' || k === 'subtitle') && item.detail === undefined) setOwn(nextNode, 'detail', item[k])
          else if (k === 'tone' && typeof item.tone === 'string' && Object.hasOwn(FLOW_TONE_ALIASES, item.tone)) setOwn(nextNode, 'tone', FLOW_TONE_ALIASES[item.tone])
          else setOwn(nextNode, k, item[k])
        }
        if (typeof nextNode.id === 'string' && nextNode.id.trim() !== '') {
          const original = nextNode.id
          if (!isName(original) || RESERVED.has(original)) {
            const safe = safeIdentifier(original, `node_${idx + 1}`, nodeIds)
            remap.set(original, safe)
            setOwn(nextNode, 'id', safe)
          } else nodeIds.add(original)
        } else if (nextNode.id === undefined && typeof nextNode.label === 'string' && nextNode.label.trim() !== '') {
          setOwn(nextNode, 'id', safeIdentifier(nextNode.label, `node_${idx + 1}`, nodeIds))
        }
        if (typeof nextNode.x === 'string') setOwn(nextNode, 'x', numeric(nextNode.x))
        if (typeof nextNode.y === 'string') setOwn(nextNode, 'y', numeric(nextNode.y))
        return nextNode
      })
      const edgeIds = new Set()
      const normalizedEdges = Array.isArray(out.edges)
        ? out.edges.map((edge, idx) => {
          if (!isRecord(edge) || Object.hasOwn(edge, '__proto__')) return edge
          const nextEdge = {}
          for (const k of Object.keys(edge)) {
            if (k === 'from' && edge.source === undefined) setOwn(nextEdge, 'source', edge.from)
            else if (k === 'to' && edge.target === undefined) setOwn(nextEdge, 'target', edge.to)
            else setOwn(nextEdge, k, edge[k])
          }
          if (typeof nextEdge.source === 'string' && remap.has(nextEdge.source)) setOwn(nextEdge, 'source', remap.get(nextEdge.source))
          if (typeof nextEdge.target === 'string' && remap.has(nextEdge.target)) setOwn(nextEdge, 'target', remap.get(nextEdge.target))
          if (nextEdge.id === undefined || (typeof nextEdge.id === 'string' && (!isName(nextEdge.id) || RESERVED.has(nextEdge.id) || edgeIds.has(nextEdge.id)))) {
            setOwn(nextEdge, 'id', safeIdentifier(typeof nextEdge.id === 'string' ? nextEdge.id : '', `edge_${idx + 1}`, edgeIds))
          } else if (typeof nextEdge.id === 'string') {
            edgeIds.add(nextEdge.id)
          }
          return nextEdge
        })
        : out.edges
      if (normalizedEdges !== undefined) setOwn(out, 'edges', normalizedEdges)
      setOwn(out, 'nodes', autoLayoutFlowNodes(normalizedNodes, normalizedEdges))
    }
  } else if (type === 'map') {
    if (out.center !== undefined) setOwn(out, 'center', coordinatePair(out.center))
    if (out.zoom !== undefined) setOwn(out, 'zoom', numeric(out.zoom))
    if (Array.isArray(out.routes)) {
      setOwn(out, 'routes', out.routes.map(route => isRecord(route) && Array.isArray(route.coordinates)
        ? { ...route, coordinates: route.coordinates.map(coordinatePair) } : route))
    }
    if (Array.isArray(out.locations)) {
      const locIds = new Set()
      setOwn(out, 'locations', out.locations.map((loc, idx) => {
        if (!isRecord(loc) || Object.hasOwn(loc, '__proto__')) return loc
        const nextLoc = {}
        for (const k of Object.keys(loc)) {
          if (k === 'name' && loc.label === undefined) setOwn(nextLoc, 'label', loc.name)
          else if (k === 'description' && loc.detail === undefined) setOwn(nextLoc, 'detail', loc.description)
          else if ((k === 'lat' || k === 'lng' || k === 'lon') && loc.coordinates === undefined) continue
          else setOwn(nextLoc, k, loc[k])
        }
        if (nextLoc.coordinates !== undefined) setOwn(nextLoc, 'coordinates', coordinatePair(nextLoc.coordinates))
        if (nextLoc.coordinates === undefined && isNumber(numeric(loc.lat)) && isNumber(numeric(loc.lng ?? loc.lon))) {
          setOwn(nextLoc, 'coordinates', [numeric(loc.lng ?? loc.lon), numeric(loc.lat)])
        }
        if (nextLoc.id === undefined || (typeof nextLoc.id === 'string' && nextLoc.id.trim() !== '' && (!isName(nextLoc.id) || RESERVED.has(nextLoc.id)))) {
          setOwn(nextLoc, 'id', safeIdentifier(typeof nextLoc.id === 'string' ? nextLoc.id : '', `loc_${idx + 1}`, locIds))
        } else if (typeof nextLoc.id === 'string') locIds.add(nextLoc.id)
        return nextLoc
      }))
    }
  } else if (type === 'confirm' && depth < MAX_DEPTH && (typeof out.label === 'string' || typeof out.text === 'string')) {
    // Models routinely pass `label` or `text` to `confirm`; lift it into a
    // sibling text node instead of failing the card.
    const promptText = String(out.label ?? out.text).trim()
    delete out.label
    delete out.text
    if (promptText !== '') return { type: 'stack', children: [{ type: 'text', text: promptText }, out] }
  }
  // Keep dangerous keys visible to the validator. Unknown decorative fields on
  // inputs and answers stay strict because silently dropping one could change
  // a formula binding or the meaning of the user's reply.
  if (DISPLAY_TYPES.has(type)) {
    for (const key of Object.keys(out)) {
      if (key !== 'type' && !PROPS[type].includes(key) && !FORBIDDEN_PROPS.has(key)) delete out[key]
    }
  }
  return out
}

// Some providers serialize nested arrays as `{ item: [...] }` (XML-style) and
// numbers as strings. Normalize the blueprint before validation so a model is
// not asked to retry a call whose only fault is the provider's encoding or a
// harmless schema alias.
// A form field's `value` is the text the user starts with, so `value` inside a
// `fields` array keeps its type: "42" must stay text, not become a number.
// Returns a new object; the input is not mutated.
export function normalizeView(value, inFormFields = false, depth = 0, state = { seq: 0, ids: new Set(), nesting: 0 }) {
  return normalizeNode(value, inFormFields, depth, state, true)
}

// Component normalization (type casing, auto ids, decorative-field drops)
// applies only where the validator reads components: the root and layout
// `children` elements. Everywhere else — table/explore data rows, form fields,
// choice options — a `type` key is payload data, not a component marker, so
// only the structural fixes (unwrapping, numeric coercion) still apply.
function normalizeNode(value, inFormFields, depth, state, asComponent) {
  // `depth` is layout nesting for normalizeComponent. `state.nesting` counts
  // every array element and object, which is what overflows the stack.
  if (state.nesting > MAX_NORMALIZE_DEPTH) return value
  state.nesting += 1
  try {
    if (Array.isArray(value)) return value.map(item => normalizeNode(item, inFormFields, depth, state, asComponent))
    if (!isRecord(value)) return value
    const keys = Object.keys(value)
    // Unwrap recursively: a provider may nest the wrapper, as { item: { item: [...] } }.
    if (keys.length === 1 && keys[0] === 'item') {
      const inner = normalizeNode(value.item, inFormFields, depth, state, asComponent)
      if (Array.isArray(inner)) return inner
    }
    // Define own properties: an incoming "__proto__" key must become data the
    // validator can reject, not hit the prototype setter and vanish from the JSON.
    const out = {}
    const isLayout = asComponent && typeof value.type === 'string' && LAYOUT.includes(value.type.trim().toLowerCase())
    for (const key of keys) {
      const nextDepth = isLayout && key === 'children' ? depth + 1 : depth
      setOwn(out, key, normalizeNode(value[key], inFormFields || key === 'fields', nextDepth, state, isLayout && key === 'children'))
    }
    for (const field of NUMERIC) if ((field !== 'value' || !inFormFields) && Object.hasOwn(out, field)) out[field] = numeric(out[field])
    if (Array.isArray(out.values)) out.values = out.values.map(numeric)
    return asComponent ? normalizeComponent(out, depth, state) : out
  } finally {
    state.nesting -= 1
  }
}

export function validateView(view) {
  const ctx = { ids: new Set(), nodes: 0, interactive: false, inputs: new Map(), lets: new Map(), formulas: [] }
  const error = checkNode(view, 'view', 1, ctx) ?? checkFormulas(ctx)
  return error === undefined ? { ok: true, interactive: ctx.interactive } : { ok: false, error }
}

// What show_view checks before it shows a view: the same answer on the host and
// in the client. The bytes are measured as sent, before normalizeView unwraps the
// provider's encoding, or a wrapped view could shrink under the byte limit. The
// normalized view and the trimmed title come back; the title may be empty.
export function checkShownView(title, sent) {
  let bytes
  try { bytes = viewBytes(title, sent) } catch { return { error: 'The view is not JSON data.' } }
  if (bytes > VIEW_BYTE_LIMIT) return { error: `The view is ${bytes} bytes; the limit is ${VIEW_BYTE_LIMIT}.` }
  if (title !== undefined && title !== null && typeof title !== 'string') return { error: 'title: expected a string' }
  const inlineTitle = (title === undefined || title === null || title.trim() === '')
    && isRecord(sent) && typeof sent.type === 'string' && typeof sent.title === 'string'
    ? sent.title : undefined
  if (isRecord(sent) && Object.hasOwn(sent, 'title') && sent.title !== undefined && sent.title !== null && typeof sent.title !== 'string') {
    return { error: 'title: expected a string' }
  }
  const named = String(title || inlineTitle || '').trim()
  // The byte check above only catches JSON.stringify. Normalization is capped,
  // and any RangeError that still escapes becomes a rejected view rather than
  // an uncaught exception on the tool call.
  let view
  let checked
  try {
    view = normalizeView(sent)
    checked = validateView(view)
  } catch (error) {
    if (error instanceof RangeError) return { error: 'The view is nested too deeply to check.' }
    throw error
  }
  if (!checked.ok) return { error: checked.error }
  // Normalization can grow the wire form — inferred columns add empty cells,
  // shorthand options expand to { label, value }, ids and labels are filled —
  // and presentation re-shows the normalized snapshot, so an accepted card
  // must still fit the limit after normalization or the replay would reject it.
  const normalizedBytes = viewBytes(title, view)
  if (normalizedBytes > VIEW_BYTE_LIMIT) return { error: `After normalization the view is ${normalizedBytes} bytes; the limit is ${VIEW_BYTE_LIMIT}.` }
  return { title: named, view, interactive: checked.interactive }
}

function checkNode(node, path, depth, ctx) {
  if (!isRecord(node)) return `${path}: expected a component object`
  if (depth > MAX_DEPTH) return `${path}: ${depth} levels exceeds the limit of ${MAX_DEPTH}`
  ctx.nodes += 1
  if (ctx.nodes > MAX_NODES) return `${path}: ${ctx.nodes} components exceeds the limit of ${MAX_NODES}`
  const type = node.type
  if (!COMPONENTS.includes(type)) return `${path}.type: unknown component ${quoted(type)}; allowed: ${allowed(COMPONENTS)}`
  if (node.id !== undefined && !INPUTS.has(type) && !INTERACTIVE.has(type)) {
    const idError = checkId(node, path, ctx)
    if (idError !== undefined) return idError
  }
  const props = PROPS[type]
  for (const key of Object.keys(node)) {
    if (key === 'type' || props.includes(key)) continue
    return `${path}.${key}: unknown property ${quoted(key)}; allowed: ${allowed(props)}`
  }
  if (INTERACTIVE.has(type)) ctx.interactive = true
  switch (type) {
    case 'stack': case 'row': return checkLayout(node, path, depth, ctx)
    case 'text': return checkText(node, path, ctx)
    case 'metric': return checkMetric(node, path, ctx)
    case 'table': return checkTable(node, path, ctx)
    case 'chart': return checkChart(node, path, ctx)
    case 'progress': return checkProgress(node, path, ctx)
    case 'callout': return checkCallout(node, path, ctx)
    case 'sources': return checkSources(node, path)
    case 'steps': return checkSteps(node, path, ctx)
    case 'slider': case 'number': return checkNumberInput(node, path, ctx)
    case 'choice': return checkChoice(node, path, ctx)
    case 'toggle': return checkToggle(node, path, ctx)
    case 'math': case 'flow': case 'explore': case 'map': return checkRichNode(node, path, ctx)
    case 'options': return checkOptions(node, path, ctx)
    case 'confirm': return checkConfirm(node, path, ctx)
    case 'form': return checkForm(node, path, ctx)
    default: return checkSubmit(node, path, ctx)
  }
}

function checkLayout(node, path, depth, ctx) {
  if (node.let !== undefined) {
    if (depth !== 1) return `${path}.let: only the outermost component can define names`
    if (!isRecord(node.let)) return `${path}.let: expected an object of names to formulas`
    for (const [name, source] of Object.entries(node.let)) {
      if (!isName(name) || RESERVED.has(name)) return `${path}.let.${name}: a name is letters, digits and _, and starts with a letter or _`
      if (typeof source !== 'string') return `${path}.let.${name}: expected a formula string`
      ctx.lets.set(name, { source, path: `${path}.let.${name}` })
    }
  }
  if (!Array.isArray(node.children)) return `${path}.children: expected an array of 1 to ${MAX_CHILDREN} components`
  if (node.children.length < 1 || node.children.length > MAX_CHILDREN) return `${path}.children: expected 1 to ${MAX_CHILDREN} children; got ${node.children.length}`
  for (let index = 0; index < node.children.length; index += 1) {
    const error = checkNode(node.children[index], `${path}.children[${index}]`, depth + 1, ctx)
    if (error !== undefined) return error
  }
  return undefined
}

// A property that may be a literal of `kind` or a formula giving one. Formulas are
// checked once the whole tree, with every input and name, is known.
function checkValue(node, key, path, ctx, kind, { required = false, max = MAX_TEXT } = {}) {
  const value = node[key]
  const at = `${path}.${key}`
  if (value === undefined) return required ? `${at}: ${expected(kind)}` : undefined
  if (isFormula(value)) {
    ctx.formulas.push({ source: value['='], path: at, kind })
    return undefined
  }
  if (kind === 'number') return isNumber(value) ? undefined : `${at}: ${expected(kind)}`
  if (Array.isArray(kind)) return kind.includes(value) ? undefined : `${at}: unknown tone ${quoted(value)}; allowed: ${allowed(kind)}`
  if (kind === 'string') {
    if (typeof value !== 'string') return `${at}: ${expected(kind)}`
    return value.length > max ? `${at}: ${value.length} characters exceeds the limit of ${max}` : undefined
  }
  if (!isScalar(value)) return `${at}: ${expected(kind)}`
  return undefined
}
const expected = kind => (kind === 'number' ? 'expected a number' : kind === 'string' ? 'expected a string' : Array.isArray(kind) ? `expected one of ${allowed(kind)}` : 'expected a string or a number')

function checkText(node, path, ctx) {
  return checkValue(node, 'text', path, ctx, 'string', { required: true })
    ?? checkValue(node, 'tone', path, ctx, TEXT_TONES)
}

function checkMetric(node, path, ctx) {
  if (typeof node.label !== 'string') return `${path}.label: expected a string`
  if (node.value === undefined) return `${path}.value: expected a string or a number`
  if (typeof node.value === 'number' && !Number.isFinite(node.value)) return `${path}.value: expected a finite number`
  return checkValue(node, 'value', path, ctx, 'scalar')
    ?? checkValue(node, 'unit', path, ctx, 'string')
    ?? checkValue(node, 'tone', path, ctx, TONES)
    ?? checkValue(node, 'caption', path, ctx, 'string')
}

function checkTable(node, path, ctx) {
  if (!Array.isArray(node.columns)) return `${path}.columns: expected an array of at most ${MAX_COLUMNS} columns`
  if (node.columns.length > MAX_COLUMNS) return `${path}.columns: ${node.columns.length} columns exceeds the limit of ${MAX_COLUMNS}`
  for (let index = 0; index < node.columns.length; index += 1) {
    const column = node.columns[index]
    const at = `${path}.columns[${index}]`
    if (!isRecord(column)) return `${at}: expected a column object`
    for (const key of Object.keys(column)) {
      if (key !== 'key' && key !== 'label') return `${at}.${key}: unknown property ${quoted(key)}; allowed: key, label`
    }
    if (typeof column.key !== 'string' || column.key === '') return `${at}.key: expected a non-empty string`
    if (typeof column.label !== 'string') return `${at}.label: expected a string`
  }
  if (!Array.isArray(node.rows)) return `${path}.rows: expected an array of at most ${MAX_ROWS} rows`
  if (node.rows.length > MAX_ROWS) return `${path}.rows: ${node.rows.length} rows exceeds the limit of ${MAX_ROWS}`
  for (let row = 0; row < node.rows.length; row += 1) {
    const cells = node.rows[row]
    if (!Array.isArray(cells)) return `${path}.rows[${row}]: expected an array of cells`
    for (let column = 0; column < cells.length; column += 1) {
      const at = `${path}.rows[${row}][${column}]`
      if (isFormula(cells[column])) { ctx.formulas.push({ source: cells[column]['='], path: at, kind: 'scalar' }); continue }
      const text = cellText(cells[column])
      if (text.length > MAX_CELL) return `${at}: ${text.length} characters exceeds the limit of ${MAX_CELL}`
    }
  }
  if (node.caption !== undefined) return checkValue(node, 'caption', path, ctx, 'string')
  return undefined
}

function checkChart(node, path, ctx) {
  if (node.kind !== undefined && !CHART_KINDS.includes(node.kind)) return `${path}.kind: unknown chart ${quoted(node.kind)}; allowed: ${allowed(CHART_KINDS)}`
  if (!Array.isArray(node.categories) || node.categories.length === 0) return `${path}.categories: expected a non-empty array of labels`
  for (let index = 0; index < node.categories.length; index += 1) {
    const label = node.categories[index]
    if (typeof label !== 'string' && !isNumber(label)) return `${path}.categories[${index}]: expected a string`
  }
  if (!Array.isArray(node.series) || node.series.length === 0) return `${path}.series: expected a non-empty array of { name?, values }`
  if (node.kind === 'donut' && node.series.length > 1) return `${path}.series: a donut takes one series; got ${node.series.length}`
  for (let index = 0; index < node.series.length; index += 1) {
    const series = node.series[index]
    const at = `${path}.series[${index}]`
    if (!isRecord(series)) return `${at}: expected a series object`
    for (const key of Object.keys(series)) {
      if (key !== 'name' && key !== 'values') return `${at}.${key}: unknown property ${quoted(key)}; allowed: name, values`
    }
    if (series.name !== undefined && typeof series.name !== 'string') return `${at}.name: expected a string`
    if (!Array.isArray(series.values)) return `${at}.values: expected an array of numbers`
    if (series.values.length !== node.categories.length) return `${at}.values: ${series.values.length} values for ${node.categories.length} categories`
    for (let item = 0; item < series.values.length; item += 1) {
      const value = series.values[item]
      if (isFormula(value)) ctx.formulas.push({ source: value['='], path: `${at}.values[${item}]`, kind: 'number' })
      else if (!isNumber(value)) return `${at}.values[${item}]: expected a number`
    }
  }
  if (node.unit !== undefined && typeof node.unit !== 'string') return `${path}.unit: expected a string`
  if (node.caption !== undefined && typeof node.caption !== 'string') return `${path}.caption: expected a string`
  return undefined
}

function checkProgress(node, path, ctx) {
  if (node.label !== undefined && typeof node.label !== 'string') return `${path}.label: expected a string`
  if ((node.percent === undefined) === (node.value === undefined)) return `${path}: give percent (0 to 100), or value with max`
  if (node.percent !== undefined && !isFormula(node.percent)) {
    if (typeof node.percent !== 'number' || !Number.isFinite(node.percent) || node.percent < 0 || node.percent > 100) return `${path}.percent: expected a number from 0 to 100`
  }
  if (node.value !== undefined && node.max === undefined) return `${path}.max: expected a number with value`
  if (node.value === undefined && node.max !== undefined) return `${path}.value: expected a number with max`
  return checkValue(node, 'percent', path, ctx, 'number')
    ?? checkValue(node, 'value', path, ctx, 'number')
    ?? checkValue(node, 'max', path, ctx, 'number')
    ?? checkValue(node, 'valueLabel', path, ctx, 'scalar')
    ?? checkValue(node, 'tone', path, ctx, TONES)
}

function checkCallout(node, path, ctx) {
  return checkValue(node, 'text', path, ctx, 'string', { required: true })
    ?? checkValue(node, 'tone', path, ctx, CALLOUT_TONES)
}

function checkSources(node, path) {
  if (!Array.isArray(node.items) || node.items.length === 0) return `${path}.items: expected a non-empty array of { label, url }`
  for (let index = 0; index < node.items.length; index += 1) {
    const item = node.items[index]
    const at = `${path}.items[${index}]`
    if (!isRecord(item)) return `${at}: expected a { label, url } object`
    for (const key of Object.keys(item)) {
      if (key !== 'label' && key !== 'url') return `${at}.${key}: unknown property ${quoted(key)}; allowed: label, url`
    }
    if (typeof item.label !== 'string' || item.label.trim() === '') return `${at}.label: expected a non-empty string`
    if (typeof item.url !== 'string' || !/^https?:\/\/[^\s]+$/i.test(item.url)) return `${at}.url: expected an http(s) address`
  }
  return undefined
}

// One step in a flow: a label, an optional detail line and a status. `detail`
// and `status` may be formulas so a view can derive its stage from inputs.
function checkSteps(node, path, ctx) {
  if (!Array.isArray(node.items) || node.items.length === 0) return `${path}.items: expected an array of 1 to ${MAX_STEPS} steps`
  if (node.items.length > MAX_STEPS) return `${path}.items: ${node.items.length} steps exceeds the limit of ${MAX_STEPS}`
  for (let index = 0; index < node.items.length; index += 1) {
    const item = node.items[index]
    const at = `${path}.items[${index}]`
    if (!isRecord(item)) return `${at}: expected a { label, detail?, status? } object`
    for (const key of Object.keys(item)) {
      if (key !== 'label' && key !== 'detail' && key !== 'status') return `${at}.${key}: unknown property ${quoted(key)}; allowed: label, detail, status`
    }
    if (typeof item.label !== 'string' || item.label.trim() === '') return `${at}.label: expected a non-empty string`
    const error = checkValue(item, 'detail', at, ctx, 'scalar')
      ?? checkValue(item, 'status', at, ctx, STEP_STATUSES)
    if (error !== undefined) return error
  }
  return undefined
}

function checkInputId(node, path, ctx) {
  if (!isName(node.id) || RESERVED.has(node.id)) return `${path}.id: an input id is letters, digits and _, and starts with a letter or _, so formulas can use it`
  if (ctx.ids.has(node.id)) return `${path}.id: duplicate id ${quoted(node.id)}`
  ctx.ids.add(node.id)
  // A <pointId>X/<pointId>Y name an earlier math node publishes is taken too;
  // an input taking that name would silently overwrite the binding.
  if (ctx.inputs.has(node.id)) return `${path}.id: ${quoted(node.id)} collides with a math point binding`
  if (typeof node.label !== 'string') return `${path}.label: expected a string`
  return undefined
}

function checkNumberInput(node, path, ctx) {
  const idError = checkInputId(node, path, ctx)
  if (idError !== undefined) return idError
  for (const key of ['min', 'max', 'step']) {
    if (node[key] !== undefined && !isNumber(node[key])) return `${path}.${key}: expected a number`
  }
  if (node.type === 'slider' && (node.min === undefined || node.max === undefined)) return `${path}: a slider needs min and max`
  if (node.min !== undefined && node.max !== undefined && node.max <= node.min) return `${path}.max: expected more than min (${node.min})`
  if (node.step !== undefined && node.step <= 0) return `${path}.step: expected more than 0`
  if (!isNumber(node.value)) return `${path}.value: expected a number`
  if ((node.min !== undefined && node.value < node.min) || (node.max !== undefined && node.value > node.max)) return `${path}.value: expected a number from ${node.min ?? '-∞'} to ${node.max ?? '∞'}`
  if (node.unit !== undefined && typeof node.unit !== 'string') return `${path}.unit: expected a string`
  ctx.inputs.set(node.id, node.value)
  return undefined
}

function checkChoice(node, path, ctx) {
  const idError = checkInputId(node, path, ctx)
  if (idError !== undefined) return idError
  if (!Array.isArray(node.options) || node.options.length === 0) return `${path}.options: expected a non-empty array of { label, value }`
  const labels = new Set()
  const values = new Set()
  for (let index = 0; index < node.options.length; index += 1) {
    const option = node.options[index]
    const at = `${path}.options[${index}]`
    if (!isRecord(option)) return `${at}: expected a { label, value } object`
    for (const key of Object.keys(option)) {
      if (key !== 'label' && key !== 'value') return `${at}.${key}: unknown property ${quoted(key)}; allowed: label, value`
    }
    if (typeof option.label !== 'string' || option.label.trim() === '') return `${at}.label: expected a non-empty string`
    if (labels.has(option.label)) return `${at}.label: duplicate label ${quoted(option.label)}`
    labels.add(option.label)
    const value = option.value ?? option.label
    if (!isScalar(value)) return `${at}.value: expected a string, a number or true/false`
    if (values.has(value)) return `${at}.value: duplicate value ${quoted(value)}`
    values.add(value)
  }
  const chosen = node.value ?? choiceValue(node.options[0])
  if (!values.has(chosen)) return `${path}.value: expected one of the options' values`
  ctx.inputs.set(node.id, chosen)
  return undefined
}

function checkToggle(node, path, ctx) {
  const idError = checkInputId(node, path, ctx)
  if (idError !== undefined) return idError
  if (node.value !== undefined && typeof node.value !== 'boolean') return `${path}.value: expected true or false`
  ctx.inputs.set(node.id, node.value === true)
  return undefined
}

function richId(node, path, ctx) {
  if (!isName(node.id) || RESERVED.has(node.id)) return `${path}.id: an interaction id is letters, digits and _, and starts with a letter or _`
  if (ctx.ids.has(node.id)) return `${path}.id: duplicate id ${quoted(node.id)}`
  ctx.ids.add(node.id)
  // Same guard as checkInputId: a rich node id may not take a math point's
  // derived <pointId>X/<pointId>Y binding published by an earlier node.
  if (ctx.inputs.has(node.id)) return `${path}.id: ${quoted(node.id)} collides with a math point binding`
  return undefined
}
const pair = (value) => Array.isArray(value) && value.length === 2 && value.every(isNumber) && Math.abs(value[0]) <= 1e7 && Math.abs(value[1]) <= 1e7
const richLabel = (value, at) => typeof value !== 'string' || value.trim() === '' || value.length > MAX_TEXT ? `${at}: expected a non-empty label` : undefined

function checkRichNode(node, path, ctx) {
  const idError = richId(node, path, ctx)
  if (idError !== undefined) return idError
  if (node.caption !== undefined && typeof node.caption !== 'string') return `${path}.caption: expected a string`
  if (node.type === 'math') {
    if (!Array.isArray(node.mathPoints) || node.mathPoints.length < 1 || node.mathPoints.length > 4) return `${path}.mathPoints: expected 1 to 4 points`
    const ids = new Set()
    for (let index = 0; index < node.mathPoints.length; index++) {
      const point = node.mathPoints[index], at = `${path}.mathPoints[${index}]`
      if (!isRecord(point) || !isName(point.id) || RESERVED.has(point.id) || ids.has(point.id)) return `${at}.id: expected a unique safe point id`
      if (Object.keys(point).some(key => !['id', 'label', 'x', 'y', 'constrain'].includes(key))) return `${at}: unknown point property`
      if (!isNumber(point.x) || !isNumber(point.y) || Math.abs(point.x) > 1e6 || Math.abs(point.y) > 1e6) return `${at}: expected finite x/y within ±1000000`
      if (point.label !== undefined && typeof point.label !== 'string') return `${at}.label: expected a string`
      if (point.constrain !== undefined && !['free', 'horizontal', 'vertical'].includes(point.constrain)) return `${at}.constrain: expected free, horizontal or vertical`
      ids.add(point.id)
      for (const key of [`${point.id}X`, `${point.id}Y`]) {
        // A derived binding may not shadow an input already bound or the math
        // node's own id; later input ids are refused in checkInputId/richId so
        // the same collision is rejected whatever order the nodes come in.
        if (ctx.inputs.has(key) || key === node.id) return `${at}: duplicate binding ${key}`
        ctx.inputs.set(key, point[key.endsWith('X') ? 'x' : 'y'])
      }
    }
    if (node.curves !== undefined && (!Array.isArray(node.curves) || node.curves.length > 4)) return `${path}.curves: expected at most 4 curves`
    for (let index = 0; index < (node.curves ?? []).length; index++) {
      const curve = node.curves[index], at = `${path}.curves[${index}]`
      if (!isRecord(curve) || Object.keys(curve).some(key => !['label', 'expression'].includes(key))) return `${at}: unknown curve property`
      if (curve.label !== undefined && typeof curve.label !== 'string') return `${at}.label: expected a string`
      if (typeof curve.expression !== 'string' || curve.expression.length > 300) return `${at}.expression: expected a bounded formula`
      const compiled = compileFormula(curve.expression)
      if (compiled.error !== undefined) return `${at}.expression: ${compiled.error}`
      // Defer identifier resolution to checkFormulas so curves can read sliders
      // placed below the plot as well as outermost `let` bindings.
      ctx.formulas.push({ source: curve.expression, path: `${at}.expression`, kind: 'curve' })
    }
    for (const key of ['domain', 'range']) if (node[key] !== undefined && (!pair(node[key]) || node[key][0] === node[key][1])) return `${path}.${key}: expected two distinct finite numbers`
    ctx.inputs.set(node.id, mathDefaults(node))
    return undefined
  }
  if (node.type === 'flow') {
    if (!Array.isArray(node.nodes) || node.nodes.length < 1 || node.nodes.length > 40) return `${path}.nodes: expected 1 to 40 nodes`
    const ids = new Set()
    for (let index = 0; index < node.nodes.length; index++) {
      const item = node.nodes[index], at = `${path}.nodes[${index}]`
      if (!isRecord(item) || !isName(item.id) || ids.has(item.id)) return `${at}.id: expected a unique safe node id`
      if (Object.keys(item).some(key => !['id', 'label', 'detail', 'x', 'y', 'tone'].includes(key))) return `${at}: unknown node property`
      const error = richLabel(item.label, `${at}.label`) ?? (item.detail !== undefined && typeof item.detail !== 'string' ? `${at}.detail: expected a string` : undefined) ?? (!isNumber(item.x) || !isNumber(item.y) ? `${at}: expected finite x/y` : undefined)
      if (error) return error
      if (item.tone !== undefined && !['neutral', 'accent', 'success', 'warn', 'bad'].includes(item.tone)) return `${at}.tone: unsupported tone`
      ids.add(item.id)
    }
    if (node.edges !== undefined && (!Array.isArray(node.edges) || node.edges.length > 80)) return `${path}.edges: expected at most 80 edges`
    for (let index = 0; index < (node.edges ?? []).length; index++) {
      const edge = node.edges[index], at = `${path}.edges[${index}]`
      if (!isRecord(edge) || !isName(edge.id) || Object.keys(edge).some(key => !['id', 'source', 'target', 'label'].includes(key))) return `${at}: expected a safe edge object`
      if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) return `${at}: source and target must be distinct declared nodes`
      if (edge.label !== undefined && typeof edge.label !== 'string') return `${at}.label: expected a string`
    }
    ctx.inputs.set(node.id, '')
    return undefined
  }
  if (node.type === 'explore') {
    if (!Array.isArray(node.data) || node.data.length < 1 || node.data.length > 200) return `${path}.data: expected 1 to 200 inline records`
    for (const key of ['xKey', 'yKey']) if (!isName(node[key])) return `${path}.${key}: expected a safe field name`
    if (node.colorKey !== undefined && !isName(node.colorKey)) return `${path}.colorKey: expected a safe field name`
    if (node.select !== undefined && !['point', 'interval'].includes(node.select)) return `${path}.select: expected point or interval`
    for (let index = 0; index < node.data.length; index++) {
      const row = node.data[index]
      if (!isRecord(row) || Object.keys(row).some(key => !isName(key)) || Object.keys(row).length > 12) return `${path}.data[${index}]: expected a bounded flat record`
      for (const key of ['xKey', 'yKey']) if (!isNumber(row[node[key]]) || Math.abs(row[node[key]]) > 1e12) return `${path}.data[${index}].${node[key]}: expected a finite number`
      if (node.colorKey !== undefined && !isScalar(row[node.colorKey])) return `${path}.data[${index}].${node.colorKey}: expected a scalar category`
      if (Object.values(row).some(value => !isScalar(value) || typeof value === 'string' && value.length > MAX_CELL)) return `${path}.data[${index}]: cells must be bounded scalars`
    }
    // An omitted select means point, as exploreMeta on the client resolves it.
    ctx.inputs.set(node.id, node.select === 'interval' ? {} : [])
    return undefined
  }
  if (!Array.isArray(node.locations) || node.locations.length < 1 || node.locations.length > 60) return `${path}.locations: expected 1 to 60 locations`
  const ids = new Set()
  for (let index = 0; index < node.locations.length; index++) {
    const location = node.locations[index], at = `${path}.locations[${index}]`
    if (!isRecord(location) || !isName(location.id) || ids.has(location.id)) return `${at}.id: expected a unique safe location id`
    if (Object.keys(location).some(key => !['id', 'label', 'detail', 'coordinates'].includes(key))) return `${at}: unknown location property`
    const error = richLabel(location.label, `${at}.label`) ?? (location.detail !== undefined && typeof location.detail !== 'string' ? `${at}.detail: expected a string` : undefined) ?? (!pair(location.coordinates) || Math.abs(location.coordinates[0]) > 180 || Math.abs(location.coordinates[1]) > 90 ? `${at}.coordinates: expected [longitude, latitude]` : undefined)
    if (error) return error
    ids.add(location.id)
  }
  if (node.center !== undefined && (!pair(node.center) || Math.abs(node.center[0]) > 180 || Math.abs(node.center[1]) > 90)) return `${path}.center: expected [longitude, latitude]`
  if (node.zoom !== undefined && (!isNumber(node.zoom) || node.zoom < 0 || node.zoom > 22)) return `${path}.zoom: expected a number from 0 to 22`
  if (node.routes !== undefined && (!Array.isArray(node.routes) || node.routes.length > 8)) return `${path}.routes: expected at most 8 routes`
  for (let index = 0; index < (node.routes ?? []).length; index++) {
    const route = node.routes[index]
    if (!isRecord(route) || Object.keys(route).some(key => !['label', 'coordinates'].includes(key)) || !Array.isArray(route.coordinates) || route.coordinates.length < 2 || route.coordinates.length > 200) return `${path}.routes[${index}]: expected a route with 2 to 200 coordinates`
    if (route.coordinates.some(point => !pair(point) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90)) return `${path}.routes[${index}]: invalid coordinates`
  }
  ctx.inputs.set(node.id, '')
  return undefined
}

function checkOptions(node, path, ctx) {
  const idError = checkId(node, path, ctx)
  if (idError !== undefined) return idError
  if (node.multi !== undefined && typeof node.multi !== 'boolean') return `${path}.multi: expected a boolean`
  if (!Array.isArray(node.options)) return `${path}.options: expected an array of 1 to ${MAX_OPTIONS} options`
  if (node.options.length < 1 || node.options.length > MAX_OPTIONS) return `${path}.options: expected 1 to ${MAX_OPTIONS} options; got ${node.options.length}`
  const labels = new Set()
  for (let index = 0; index < node.options.length; index += 1) {
    const option = node.options[index]
    const at = `${path}.options[${index}]`
    if (!isRecord(option)) return `${at}: expected an option object`
    for (const key of Object.keys(option)) {
      if (key !== 'label' && key !== 'description') return `${at}.${key}: unknown property ${quoted(key)}; allowed: label, description`
    }
    if (typeof option.label !== 'string' || option.label.trim() === '') return `${at}.label: expected a non-empty string`
    if (labels.has(option.label)) return `${at}.label: duplicate label ${quoted(option.label)}`
    labels.add(option.label)
    if (option.description !== undefined && typeof option.description !== 'string') return `${at}.description: expected a string`
  }
  return undefined
}

function checkConfirm(node, path, ctx) {
  const idError = checkId(node, path, ctx)
  if (idError !== undefined) return idError
  if (node.confirmLabel !== undefined && typeof node.confirmLabel !== 'string') return `${path}.confirmLabel: expected a string`
  if (node.cancelLabel !== undefined && typeof node.cancelLabel !== 'string') return `${path}.cancelLabel: expected a string`
  return undefined
}

function checkForm(node, path, ctx) {
  const idError = checkId(node, path, ctx)
  if (idError !== undefined) return idError
  if (node.submitLabel !== undefined && typeof node.submitLabel !== 'string') return `${path}.submitLabel: expected a string`
  if (node.cancelLabel !== undefined && typeof node.cancelLabel !== 'string') return `${path}.cancelLabel: expected a string`
  if (!Array.isArray(node.fields)) return `${path}.fields: expected an array of at most ${MAX_FIELDS} fields`
  if (node.fields.length > MAX_FIELDS) return `${path}.fields: ${node.fields.length} fields exceeds the limit of ${MAX_FIELDS}`
  const seen = new Set()
  for (let index = 0; index < node.fields.length; index += 1) {
    const field = node.fields[index]
    const at = `${path}.fields[${index}]`
    if (!isRecord(field)) return `${at}: expected a field object`
    for (const key of Object.keys(field)) {
      if (!FIELD_PROPS.includes(key)) return `${at}.${key}: unknown property ${quoted(key)}; allowed: ${allowed(FIELD_PROPS)}`
    }
    if (typeof field.id !== 'string' || field.id === '') return `${at}.id: expected a non-empty string`
    if (field.id === '__proto__') return `${at}.id: "__proto__" cannot be an id`
    if (seen.has(field.id)) return `${at}.id: duplicate field id ${quoted(field.id)}`
    seen.add(field.id)
    if (typeof field.label !== 'string') return `${at}.label: expected a string`
    if (field.placeholder !== undefined && typeof field.placeholder !== 'string') return `${at}.placeholder: expected a string`
    if (field.value !== undefined) {
      // The value is the text the field starts with; it stays a string end to
      // end (normalizeView keeps a fields[].value literal unsourced as text).
      if (typeof field.value !== 'string') return `${at}.value: expected a string`
      if (field.value.length > MAX_TEXT) return `${at}.value: ${field.value.length} characters exceeds the limit of ${MAX_TEXT}`
    }
    if (field.multiline !== undefined && typeof field.multiline !== 'boolean') return `${at}.multiline: expected a boolean`
    if (field.readOnly !== undefined && typeof field.readOnly !== 'boolean') return `${at}.readOnly: expected a boolean`
  }
  return undefined
}

function checkSubmit(node, path, ctx) {
  const idError = checkId(node, path, ctx)
  if (idError !== undefined) return idError
  if (node.label !== undefined && typeof node.label !== 'string') return `${path}.label: expected a string`
  return undefined
}

function checkId(node, path, ctx) {
  if (typeof node.id !== 'string' || node.id === '') return `${path}.id: expected a non-empty string`
  // A `__proto__` id would write through to a plain object's prototype where the
  // answer is kept, losing it silently.
  if (node.id === '__proto__') return `${path}.id: "__proto__" cannot be an id`
  if (ctx.ids.has(node.id)) return `${path}.id: duplicate id ${quoted(node.id)}`
  ctx.ids.add(node.id)
  return undefined
}

// Every formula parses, reads only inputs and names the view defines, and gives the
// right kind of value with the inputs as the Bot set them.
function checkFormulas(ctx) {
  const userNames = [...ctx.inputs.keys(), ...ctx.lets.keys()]
  const known = new Set([...userNames, ...MATH_CONSTANTS.keys()])
  const lets = new Map()
  for (const [name, entry] of ctx.lets) {
    if (ctx.inputs.has(name)) return `${entry.path}: ${quoted(name)} is already an input id`
    const compiled = compileFormula(entry.source)
    if (compiled.error !== undefined) return `${entry.path}: ${compiled.error}`
    const unknown = compiled.names.find(item => !known.has(item))
    if (unknown !== undefined) return `${entry.path}: unknown name ${quoted(unknown)}; known: ${allowed(userNames) || '(none)'}`
    lets.set(name, compiled.tree)
  }
  const lookup = createScope(ctx.inputs, lets)
  for (const [name, entry] of ctx.lets) {
    const result = evaluate(lets.get(name), lookup)
    if (result.error !== undefined) return `${entry.path}: ${result.error}`
  }
  for (const formula of ctx.formulas) {
    const compiled = compileFormula(formula.source)
    if (compiled.error !== undefined) return `${formula.path}: ${compiled.error}`
    if (formula.kind === 'curve') {
      const unknown = compiled.names.find(item => item !== 'x' && !known.has(item))
      if (unknown !== undefined) return `${formula.path}: unknown name ${quoted(unknown)}; known: ${allowed(['x', ...userNames])}`
      continue
    }
    const unknown = compiled.names.find(item => !known.has(item))
    if (unknown !== undefined) return `${formula.path}: unknown name ${quoted(unknown)}; known: ${allowed(userNames) || '(none)'}`
    const result = evaluate(compiled.tree, lookup)
    if (result.error !== undefined) return `${formula.path}: ${result.error}`
    const problem = kindProblem(result.value, formula.kind)
    if (problem !== undefined) return `${formula.path}: the formula gives ${quoted(result.value)}; ${problem}`
  }
  return undefined
}

function kindProblem(value, kind) {
  if (kind === 'number') return isNumber(value) ? undefined : 'expected a number'
  if (Array.isArray(kind)) return kind.includes(value) ? undefined : `expected one of ${allowed(kind)}`
  if (kind === 'string') return isScalar(value) ? undefined : 'expected text'
  return isScalar(value) ? undefined : 'expected a string or a number'
}

function cellText(value) {
  if (typeof value === 'string') return value
  const text = JSON.stringify(value)
  return typeof text === 'string' ? text : ''
}

// -------------------------------------------------------------------------
// Working a blueprint out: the client draws with these, the summary reads them.

const compiled = new WeakMap()
const treeOf = (formula) => {
  let entry = compiled.get(formula)
  if (entry === undefined) {
    entry = compileFormula(formula['='])
    compiled.set(formula, entry)
  }
  return entry
}

export const choiceValue = option => option?.value ?? option?.label

function walk(node, visit) {
  if (!isRecord(node)) return
  visit(node)
  if (LAYOUT.includes(node.type) && Array.isArray(node.children)) for (const child of node.children) walk(child, visit)
}

export function viewInputs(view) {
  const found = []
  walk(view, (node) => { if (INPUTS.has(node.type)) found.push(node) })
  return found
}

export function inputDefault(node) {
  if (node.type === 'toggle') return node.value === true
  if (node.type === 'choice') return node.value ?? choiceValue(Array.isArray(node.options) ? node.options[0] : undefined)
  if (node.type === 'math') return mathDefaults(node)
  if (node.type === 'explore') return node.select === 'interval' ? {} : []
  if (node.type === 'flow' || node.type === 'map') return ''
  return node.value
}

export function mathDefaults(node) {
  return Object.fromEntries((node.mathPoints ?? []).map(point => [point.id, [point.x, point.y]]))
}

// Component ids expose small JSON values, not library event objects. Math
// coordinates also appear as <pointId>X/<pointId>Y so existing formulas can use them.
export function viewBindings(view) {
  const bindings = []
  for (const node of viewInputs(view)) {
    if (node.type === 'math') for (const point of node.mathPoints ?? []) {
      bindings.push({ id: `${point.id}X`, value: undefined, kind: 'math', node }, { id: `${point.id}Y`, value: undefined, kind: 'math', node })
    }
    bindings.push({ id: node.id, value: undefined, kind: node.type, node })
  }
  return bindings
}

export const hasInputs = view => viewInputs(view).length > 0

// The values a view's formulas read: each input's default unless `values` sets it.
export function viewScope(view, values = {}) {
  const inputs = new Map()
  for (const binding of viewBindings(view)) {
    const { id, node } = binding
    if (binding.kind === 'math' && id !== node.id) {
      const point = node.mathPoints.find(item => `${item.id}X` === id || `${item.id}Y` === id)
      const sent = isRecord(values[node.id]) ? values[node.id][point.id] : undefined
      const coordinate = Array.isArray(sent) ? sent[id.endsWith('X') ? 0 : 1] : point[id.endsWith('X') ? 'x' : 'y']
      inputs.set(id, coordinate)
    } else inputs.set(id, Object.hasOwn(values, id) ? values[id] : inputDefault(node))
  }
  const lets = new Map()
  for (const [name, source] of Object.entries(isRecord(view?.let) ? view.let : {})) {
    const entry = compileFormula(source)
    if (entry.tree !== undefined) lets.set(name, entry.tree)
  }
  return createScope(inputs, lets)
}

// A property's value: the literal, or the formula worked out. A formula that fails
// with these inputs gives `fallback`.
export function resolve(value, lookup, fallback = undefined) {
  if (!isFormula(value)) return value
  const entry = treeOf(value)
  if (entry.tree === undefined) return fallback
  const result = evaluate(entry.tree, lookup)
  return result.error === undefined ? result.value : fallback
}

export const asText = value => (value === undefined || value === null ? '' : show(value))

// -------------------------------------------------------------------------
// Summaries

function clip(text) {
  const flat = String(text).replace(/\s+/g, ' ').trim()
  return flat.length <= SUMMARY_PART ? flat : flat.slice(0, SUMMARY_PART)
}

const choiceLabel = (node, value) => (Array.isArray(node.options) ? node.options : []).find(option => choiceValue(option) === value)?.label ?? asText(value)

export function richSelectionSummary(node, value) {
  if (node.type === 'math') return Object.fromEntries((node.mathPoints ?? []).map(point => [point.id, value?.[point.id] ?? [point.x, point.y]]))
  if (node.type === 'flow') return { selected: (node.nodes ?? []).find(item => item.id === value)?.label ?? '' }
  if (node.type === 'map') return { selected: (node.locations ?? []).find(item => item.id === value)?.label ?? '' }
  if (node.type === 'explore') return { selected: value }
  return { value }
}

function inputText(node, value) {
  if (node.type === 'toggle') return value === true ? 'on' : 'off'
  if (node.type === 'choice') return choiceLabel(node, value)
  if (node.type === 'math') return (node.mathPoints ?? []).map(point => `${point.label || point.id}=(${Array.isArray(value?.[point.id]) ? value[point.id].map(asText).join(', ') : 'unset'})`).join(', ')
  if (node.type === 'flow') return (node.nodes ?? []).find(item => item.id === value)?.label || 'No selection'
  if (node.type === 'map') return (node.locations ?? []).find(item => item.id === value)?.label || 'No selection'
  if (node.type === 'explore') return node.select === 'interval'
    ? (isRecord(value) ? Object.entries(value).map(([key, range]) => `${key}=${Array.isArray(range) ? range.map(asText).join('–') : asText(range)}`).join(', ') : 'No selection')
    : `${Array.isArray(value) ? value.length : 0} selected`
  return `${asText(value)}${node.unit ? ` ${node.unit}` : ''}`
}

function progressPercent(node, lookup) {
  if (node.percent !== undefined) return Number(resolve(node.percent, lookup, 0))
  const max = Number(resolve(node.max, lookup, 0))
  return max > 0 ? (Number(resolve(node.value, lookup, 0)) / max) * 100 : 0
}

function componentSummary(node, lookup) {
  const value = item => asText(resolve(item, lookup, ''))
  switch (node.type) {
    case 'text': return `text: ${value(node.text)}`
    case 'metric': return `metric: ${node.label}=${value(node.value)}`
    case 'table': return `table: ${(Array.isArray(node.columns) ? node.columns : []).map(column => column?.label ?? column?.key ?? '').filter(Boolean).join('/')}`
    case 'chart': {
      const series = Array.isArray(node.series) ? node.series[0] : undefined
      const values = Array.isArray(series?.values) ? series.values : []
      const unit = node.unit ? ` ${node.unit}` : ''
      return `chart: ${(Array.isArray(node.categories) ? node.categories : []).map((label, index) => `${label}=${value(values[index])}${unit}`).join(', ')}`
    }
    case 'progress': return `progress: ${node.label ? `${node.label} ` : ''}${Math.round(progressPercent(node, lookup))}%`
    case 'callout': return `callout: ${value(node.text)}`
    case 'sources': return `sources: ${(Array.isArray(node.items) ? node.items : []).map(item => item?.label).filter(Boolean).join('/')}`
    case 'steps': return `steps: ${(Array.isArray(node.items) ? node.items : []).map(item => item?.label).filter(Boolean).join('/')}`
    case 'slider': case 'number': case 'choice': case 'toggle': case 'math': case 'flow': case 'explore': case 'map': return `${node.type}: ${node.label || node.id}=${inputText(node, inputDefault(node))}`
    case 'options': return `options: ${(Array.isArray(node.options) ? node.options : []).map(option => option?.label).filter(Boolean).join('/')}`
    case 'confirm': return 'confirm'
    case 'form': return `form: ${(Array.isArray(node.fields) ? node.fields : []).map(field => field?.label ?? field?.id).filter(Boolean).join('/')}`
    case 'submit': return `submit: ${node.label ?? 'Send'}`
    default: return undefined
  }
}

// One line for a handoff or a checkpoint. Containers add nothing of their own;
// each component keeps one short phrase, and the line stops after a few. Formulas
// show what they give with the inputs as the Bot set them.
export function viewSummary(view) {
  const parts = []
  const lookup = viewScope(view)
  const visit = (node) => {
    if (parts.length >= SUMMARY_COUNT || !isRecord(node)) return
    const line = componentSummary(node, lookup)
    if (line !== undefined) parts.push(clip(line))
    if (parts.length >= SUMMARY_COUNT || !LAYOUT.includes(node.type) || !Array.isArray(node.children)) return
    for (const child of node.children) visit(child)
  }
  visit(view)
  return parts.join('; ')
}

// The inputs of an answer as `Label=value` pairs, for the Bot's history.
export function inputsSummary(view, inputs) {
  if (!isRecord(inputs)) return ''
  return viewInputs(view)
    .filter(node => Object.hasOwn(inputs, node.id))
    .map(node => `${node.label || node.id}=${inputText(node, inputs[node.id])}`)
    .join('; ')
}

export function answersSummary(view, inputs) {
  if (!isRecord(inputs)) return ''
  return viewInputs(view)
    .filter(node => ['math', 'flow', 'explore', 'map'].includes(node.type) && Object.hasOwn(inputs, node.id))
    .map(node => ({ id: node.id, ...richSelectionSummary(node, inputs[node.id]) }))
}

// -------------------------------------------------------------------------
// Answers

function interactiveNodes(node, found = []) {
  walk(node, (item) => { if (INTERACTIVE.has(item.type)) found.push(item) })
  return found
}

// `action` is the id of the component the user submitted. One submit settles
// the whole card, so only that component's values are kept, plus the inputs'
// values when the view has inputs.
export function validateViewAnswer(view, action, values) {
  const nodes = interactiveNodes(view)
  if (typeof action !== 'string' || action === '') return { error: `action: expected an interactive component id; allowed: ${allowed(nodes.map(node => node.id))}` }
  const node = nodes.find(item => item.id === action)
  if (node === undefined) return { error: `action: no interactive component with id ${quoted(action)}; allowed: ${allowed(nodes.map(item => item.id))}` }
  if (!isRecord(values)) return { error: 'values: expected an object' }
  const inputs = validateInputs(view, values.inputs)
  if (inputs.error !== undefined) return inputs
  const extra = inputs.inputs === undefined ? {} : { inputs: inputs.inputs }
  if (node.type === 'submit') return { ...extra }
  const own = node.type === 'options' ? validateOptions(node, values) : node.type === 'confirm' ? validateConfirm(values) : validateForm(node, values)
  return own.error === undefined ? { ...own, ...extra } : own
}

function validateRichInput(node, value, at) {
  if (node.type === 'flow') {
    if (value !== '' && !(node.nodes ?? []).some(item => item.id === value)) return `${at}: expected a declared node id or an empty selection`
  }
  if (node.type === 'map') {
    if (value !== '' && !(node.locations ?? []).some(item => item.id === value)) return `${at}: expected a declared location id or an empty selection`
  }
  if (node.type === 'math') {
    if (!isRecord(value)) return `${at}: expected point coordinates`
    const ids = (node.mathPoints ?? []).map(point => point.id)
    if (Object.keys(value).some(key => !ids.includes(key))) return `${at}: unknown point`
    for (const point of node.mathPoints ?? []) {
      if (!pair(value[point.id]) || Math.abs(value[point.id][0]) > 1e6 || Math.abs(value[point.id][1]) > 1e6) return `${at}.${point.id}: expected finite [x, y] within ±1000000`
    }
  }
  if (node.type === 'explore') {
    if (node.select !== 'interval') {
      // Point values are categories: the client picks on colorKey when the view
      // declares one, else on xKey — so the answer must be a value a row has.
      const category = node.colorKey ?? node.xKey
      if (!Array.isArray(value) || value.length > node.data.length || value.some(item => !isScalar(item) || !node.data.some(row => row[category] === item))) return `${at}: expected declared category values`
      if (new Set(value).size !== value.length) return `${at}: duplicate selection`
    } else {
      // Interval keys are the real field names only; the literal 'xKey'/'yKey'
      // the old check admitted never reach the client.
      if (!isRecord(value) || Object.keys(value).some(key => key !== node.xKey && key !== node.yKey)) return `${at}: expected a bounded interval`
      for (const [key, range] of Object.entries(value)) {
        if (!Array.isArray(range) || range.length !== 2 || !range.every(isNumber) || range[0] > range[1]) return `${at}.${key}: expected an ordered numeric range`
      }
    }
  }
  return undefined
}

// Every input of the view, as sent or else as the Bot set it.
function validateInputs(view, sent) {
  const nodes = viewInputs(view)
  if (nodes.length === 0) return sent === undefined ? {} : { error: 'values.inputs: this view has no inputs' }
  if (sent !== undefined && !isRecord(sent)) return { error: 'values.inputs: expected an object of input ids to values' }
  const given = sent ?? {}
  const ids = nodes.map(node => node.id)
  const unknown = Object.keys(given).find(key => !ids.includes(key))
  if (unknown !== undefined) return { error: `values.inputs.${unknown}: unknown input; allowed: ${allowed(ids)}` }
  const inputs = {}
  for (const node of nodes) {
    const value = Object.hasOwn(given, node.id) ? given[node.id] : inputDefault(node)
    const at = `values.inputs.${node.id}`
    if (node.type === 'toggle' && typeof value !== 'boolean') return { error: `${at}: expected true or false` }
    if (node.type === 'choice' && !(Array.isArray(node.options) ? node.options : []).some(option => choiceValue(option) === value)) return { error: `${at}: expected one of the options' values` }
    if (node.type === 'slider' || node.type === 'number') {
      if (!isNumber(value)) return { error: `${at}: expected a number` }
      if ((node.min !== undefined && value < node.min) || (node.max !== undefined && value > node.max)) return { error: `${at}: expected a number from ${node.min ?? '-∞'} to ${node.max ?? '∞'}` }
    }
    const richError = validateRichInput(node, value, at)
    if (richError !== undefined) return { error: richError }
    inputs[node.id] = value
  }
  return { inputs }
}

function validateOptions(node, values) {
  if (!Array.isArray(values.selected)) return { error: 'values.selected: expected an array of option labels' }
  const labels = new Set((node.options ?? []).map(option => option?.label))
  const picked = values.selected.filter(label => typeof label === 'string' && labels.has(label))
  const selected = node.multi === true ? [...new Set(picked)] : picked.slice(0, 1)
  if (selected.length === 0) return { error: 'values.selected: select at least one option' }
  return { selected }
}

function validateConfirm(values) {
  if (typeof values.confirmed !== 'boolean') return { error: 'values.confirmed: expected a boolean' }
  return { confirmed: values.confirmed }
}

function validateForm(node, values) {
  // A cancel is its own answer: no field values are read or stored.
  if (values.canceled === true) return { canceled: true }
  if (!isRecord(values.fields)) return { error: 'values.fields: expected an object of field ids to strings' }
  const declaredFields = (node.fields ?? []).filter(field => typeof field?.id === 'string')
  const declared = declaredFields.map(field => field.id)
  const byId = new Map(declaredFields.map(field => [field.id, field]))
  const allowedIds = new Set(declared)
  const fields = {}
  for (const [key, value] of Object.entries(values.fields)) {
    if (!allowedIds.has(key)) return { error: `values.fields.${key}: unknown field; allowed: ${allowed(declared)}` }
    if (typeof value !== 'string') return { error: `values.fields.${key}: expected a string` }
    if (value.length > MAX_TEXT) return { error: `values.fields.${key}: ${value.length} characters exceeds the limit of ${MAX_TEXT}` }
    const spec = byId.get(key)
    // A read-only field answers what the card declared, not what was sent.
    fields[key] = spec?.readOnly === true ? (spec.value ?? '') : value
  }
  return { fields }
}
