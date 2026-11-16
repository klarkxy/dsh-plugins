// Bounded data exploration: a closed Vega-Lite scatter plot built only from the
// node's declared fields. The model supplies inline rows; nothing it writes can
// become a remote data source, a transform, an expression or an arbitrary spec.
// Selection signals are normalized to plain data before reaching setInput:
// point selections give deduplicated category values ([] when empty), interval
// selections give {field: [low, high]} ({} when empty).
import { useEffect, useMemo, useRef, useState } from 'react'
import embed from 'vega-embed'
import type { Result } from 'vega-embed'
import type { TopLevelSpec } from 'vega-lite'
import { asText } from './core/index.js'
import { isRecord, type Scalar, type ViewNode } from './contracts.ts'
import type { RichNodeProps } from './rich-types.ts'
import { formatNumber } from './chart.tsx'
import { english, type ViewT } from './ui.tsx'

export const PICK_SIGNAL = 'pick'
export const BRUSH_SIGNAL = 'brush'
export type ExploreMode = 'point' | 'interval'
export type ExploreMeta = { mode: ExploreMode; category: string; signal: string }
const TABLE_ROWS = 50
const isScalar = (value: unknown): value is Scalar => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
const keyOf = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)

export function exploreMeta(node: ViewNode): ExploreMeta {
  const mode: ExploreMode = node.select === 'interval' ? 'interval' : 'point'
  const category = keyOf(node.colorKey) ?? keyOf(node.xKey) ?? ''
  return { mode, category, signal: mode === 'interval' ? BRUSH_SIGNAL : PICK_SIGNAL }
}

// Sanitized inline rows: records with scalar cells only, so model data cannot
// smuggle nested objects or arrays into the chart or the data table.
export function exploreRows(node: ViewNode): Record<string, Scalar>[] {
  if (!Array.isArray(node.data)) return []
  const rows: Record<string, Scalar>[] = []
  for (const item of node.data) {
    if (!isRecord(item)) continue
    const row: Record<string, Scalar> = {}
    for (const [key, value] of Object.entries(item)) if (isScalar(value)) row[key] = value
    rows.push(row)
  }
  return rows
}

// The whole Vega-Lite spec is built here: inline values, circle marks, x/y/color
// encodings from the declared keys and exactly one point or interval selection.
// A settled card keeps the selection parameter so saved tuples can still paint,
// but its event stream never matches. Interval brushes must stay a between-stream;
// a bare click selector crashes the Vega-Lite compiler.
function selectionParam(mode: ExploreMode, category: string, editable: boolean) {
  if (mode === 'interval') return editable
    ? { type: 'interval', encodings: ['x', 'y'] }
    : { type: 'interval', encodings: ['x', 'y'], on: '[pointerdown[false], window:pointerup] > window:pointermove', clear: false, translate: false, zoom: false }
  return editable
    ? { type: 'point', fields: [category] }
    : { type: 'point', fields: [category], on: 'view:click[false]', clear: false, toggle: false }
}
/** Vega-Lite `params.value` is compiled into the selection store and, for an
 * interval, the brush's pixel signals. Empty selections omit it: `{}` would
 * seed a null range. */
export function exploreSelectionValue(meta: ExploreMeta, value: unknown, xKey: string, yKey: string): unknown {
  if (meta.mode === 'point') {
    const items = (Array.isArray(value) ? value : []).filter(isScalar)
    return items.length === 0 ? undefined : items.map(item => ({ [meta.category]: item }))
  }
  const ranges = intervalSelection(value, xKey, yKey)
  return Object.keys(ranges).length === 0 ? undefined : ranges
}
export function exploreSpec(node: ViewNode, editable = true, selection?: unknown): TopLevelSpec | null {
  const xKey = keyOf(node.xKey)
  const yKey = keyOf(node.yKey)
  const colorKey = keyOf(node.colorKey)
  const rows = exploreRows(node)
  if (xKey === null || yKey === null || rows.length === 0) return null
  const meta = exploreMeta(node)
  const select = selectionParam(meta.mode, meta.category, editable)
  const initial = exploreSelectionValue(meta, selection, xKey, yKey)
  const spec: Record<string, unknown> = {
    data: { values: rows },
    mark: { type: 'circle', tooltip: true, size: 64, opacity: 0.9 },
    width: 'container',
    height: 260,
    autosize: { type: 'fit-x', contains: 'padding' },
    params: [{ name: meta.signal, select, ...(initial !== undefined ? { value: initial } : {}) }],
    encoding: {
      x: { field: xKey, type: 'quantitative' },
      y: { field: yKey, type: 'quantitative' },
      color: colorKey === null ? { value: 'var(--dsw-alias-state-business-primary)' } : { field: colorKey, type: 'nominal', scale: { range: ['var(--dsw-alias-state-business-primary)', 'var(--dsw-alias-brand-primary)', 'var(--dsw-alias-label-tertiary)'] } },
      opacity: { condition: { param: meta.signal, value: 1 }, value: 0.28 },
    },
    config: {
      background: 'transparent',
      view: { stroke: 'transparent' },
      axis: { domain: false, tickSize: 0, gridDash: [3, 3], gridColor: 'var(--dsw-alias-border-l2)', labelColor: 'var(--dsw-alias-label-tertiary)', titleColor: 'var(--dsw-alias-label-secondary)', labelFontSize: 11 },
      legend: { labelColor: 'var(--dsw-alias-label-secondary)', titleColor: 'var(--dsw-alias-label-secondary)', labelFontSize: 11, titleFontSize: 11 },
    },
  }
  return spec as unknown as TopLevelSpec
}

// A resolved point selection carries per-field value arrays plus a vlPoint
// predicate ({or: [{field: value}…]}) — verified against the vega-lite 6.5
// runtime; a cleared selection is {}. Callers get deduplicated category values.
export function pointSelection(value: unknown, category: string): Scalar[] {
  if (!isRecord(value)) return []
  const predicate = isRecord(value.vlPoint) && Array.isArray(value.vlPoint.or) ? value.vlPoint.or : []
  const seen = new Set<Scalar>()
  const out: Scalar[] = []
  for (const tuple of predicate) {
    const item = isRecord(tuple) ? tuple[category] : undefined
    if (isScalar(item) && !seen.has(item)) {
      seen.add(item)
      out.push(item)
    }
  }
  return out
}

// A resolved interval selection is {field: [low, high]}; a cleared brush is {}.
export function intervalSelection(value: unknown, xKey: string, yKey: string): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {}
  if (!isRecord(value)) return out
  for (const key of [xKey, yKey]) {
    const range = value[key]
    if (Array.isArray(range) && range.length === 2 && range.every(item => typeof item === 'number' && Number.isFinite(item))) out[key] = [range[0] as number, range[1] as number]
  }
  return out
}

function selectionText(meta: ExploreMeta, value: unknown, t: ViewT): string | null {
  if (value === null) return null
  if (meta.mode === 'point') {
    const values = Array.isArray(value) ? value : []
    if (values.length === 0) return null
    const shown = values.slice(0, 4).map(item => asText(item)).join(', ')
    return t('{n} selected: {values}', { n: values.length, values: values.length > 4 ? `${shown}, …` : shown })
  }
  const ranges = isRecord(value) ? Object.entries(value) : []
  if (ranges.length === 0) return null
  return ranges.map(([key, range]) => `${key} ${formatNumber((range as [number, number])[0])} – ${formatNumber((range as [number, number])[1])}`).join(' · ')
}

export function ExploreView({ node, lookup, setInput, t = english, editable = true }: RichNodeProps & { editable?: boolean }) {
  const rows = useMemo(() => exploreRows(node), [node])
  const meta = useMemo(() => exploreMeta(node), [node])
  const xKey = keyOf(node.xKey)
  const yKey = keyOf(node.yKey)
  const columns = [xKey, yKey, keyOf(node.colorKey)].filter((key): key is string => key !== null)
  const host = useRef<HTMLDivElement | null>(null)
  const [failed, setFailed] = useState(false)
  const restored = (() => {
    try { return typeof node.id === 'string' ? lookup(node.id) : undefined } catch { return undefined }
  })()
  const [picked, setPicked] = useState<unknown>(restored ?? (meta.mode === 'point' ? [] : {}))
  // A click updates latest before publishing into lookup, so its echo does not
  // rebuild the view. A different external value or edit-permission change does.
  const latest = useRef(restored)
  const [seeded, setSeeded] = useState(0)
  const publish = useRef<(value: unknown) => void>(() => {})
  publish.current = (value: unknown) => {
    if (!editable) return
    latest.current = value
    setPicked(value)
    if (typeof node.id === 'string' && node.id !== '') setInput(node.id, value)
  }
  useEffect(() => { setPicked(restored ?? (meta.mode === 'point' ? [] : {})) }, [restored, meta.mode])
  useEffect(() => {
    const key = JSON.stringify(restored ?? null)
    if (JSON.stringify(latest.current ?? null) === key) return
    latest.current = restored
    setSeeded(count => count + 1)
  }, [restored, meta.mode])
  const spec = useMemo(() => exploreSpec(node, editable, latest.current), [node, editable, seeded])
  useEffect(() => {
    const element = host.current
    if (spec === null || element === null) return undefined
    setFailed(false)
    let done = false
    let result: Result | null = null
    void embed(element, spec, { actions: false, ast: true, renderer: 'svg' }).then(embedded => {
      if (done) {
        embedded.finalize()
        return
      }
      result = embedded
      embedded.view.addSignalListener(meta.signal, (_name, value) => {
        if (done) return
        publish.current(meta.mode === 'point' ? pointSelection(value, meta.category) : intervalSelection(value, xKey ?? '', yKey ?? ''))
      })
    }).catch(() => { if (!done) setFailed(true) })
    return () => {
      done = true
      result?.finalize()
    }
  }, [spec, meta, xKey, yKey])
  if (spec === null || rows.length === 0) return <div className="dvui-explore"><span className="dvui-muted">{t('Nothing to explore')}</span></div>
  const summary = selectionText(meta, picked, t)
  const hint = meta.mode === 'interval' ? t('Drag to select a range; double-click to clear') : t('Click points to select; double-click to clear')
  const shown = rows.slice(0, TABLE_ROWS)
  const caption = typeof node.caption === 'string' ? node.caption : ''
  return (
    <figure className="dvui-explore">
      {failed
        ? <div className="dvui-tool-error" role="alert">{t('The chart could not be drawn.')}</div>
        : <div ref={host} className="dvui-explore-host" />}
      <div className="dvui-caption" role="status" aria-live="polite">{summary ?? hint}</div>
      <details>
        <summary>{t('Data: {n} rows', { n: rows.length })}</summary>
        <div className="dvui-table">
          <table>
            <thead><tr>{columns.map(key => <th key={key} scope="col">{key}</th>)}</tr></thead>
            <tbody>{shown.map((row, index) => <tr key={index}>{columns.map(key => <td key={key} className={typeof row[key] === 'number' ? 'dvui-num' : undefined}>{asText(row[key] ?? '')}</td>)}</tr>)}</tbody>
          </table>
        </div>
        {rows.length > shown.length ? <div className="dvui-caption">{t('Showing {shown} of {n} rows', { shown: shown.length, n: rows.length })}</div> : null}
      </details>
      {caption !== '' ? <figcaption className="dvui-caption">{caption}</figcaption> : null}
    </figure>
  )
}
