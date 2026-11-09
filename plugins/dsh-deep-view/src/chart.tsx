// Chart layout and interaction adapted from deep-view/src/react/chart.js (Apache-2.0).
// SVG is responsive, keyboard navigable, and uses only official --dsw-* theme tokens.
import { Fragment, useId, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { asText, resolve } from './core/index.js'
import type { ViewNode } from './contracts.ts'
import { english, type ViewT } from './ui.tsx'

export const PALETTE = [
  'var(--dsw-alias-state-business-primary)', 'var(--dsw-alias-brand-primary)',
  'var(--dsw-alias-state-success-primary)', 'var(--dsw-alias-state-warn-primary)',
  'var(--dsw-alias-state-error-primary)',
]
const colorAt = (index: number) => PALETTE[index % PALETTE.length]
const TICK = 10
const LABEL = 11
const textWidth = (text: unknown, size: number) => [...String(text)].reduce((sum, char) => sum + (char.charCodeAt(0) > 0x2e80 ? size : size * 0.58), 0)
const fit = (text: unknown, room: number, size: number) => {
  if (textWidth(text, size) <= room) return String(text)
  let out = ''
  for (const char of String(text)) {
    if (textWidth(`${out}${char}…`, size) > room) break
    out += char
  }
  return out === '' ? '' : `${out}…`
}
export function formatNumber(value: number) {
  if (!Number.isFinite(value)) return asText(value)
  const abs = Math.abs(value)
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2
  return Number(value.toFixed(digits)).toLocaleString('en-US', { maximumFractionDigits: digits })
}
const withUnit = (value: number, unit: string) => unit ? (unit === '%' ? `${formatNumber(value)}%` : `${formatNumber(value)} ${unit}`) : formatNumber(value)

export function niceTicks(low: number, high: number) {
  let lo = low
  let hi = high
  if (lo === hi) { lo = Math.min(0, lo); hi = hi === 0 ? 1 : Math.max(0, hi) }
  if (lo === hi) hi = lo + 1
  const raw = (hi - lo) / 4
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map(scale => scale * magnitude).find(candidate => candidate >= raw)!
  const start = Math.floor(lo / step + 1e-9) * step
  const end = Math.ceil(hi / step - 1e-9) * step
  const ticks = []
  for (let value = start; value <= end + step / 2; value += step) ticks.push(Number(value.toPrecision(12)))
  return ticks
}

export type ChartSeries = { name: string; color: string; values: number[] }
export type ChartData = { kind: string; categories: string[]; series: ChartSeries[]; unit: string }
export function chartData(node: ViewNode, lookup: (name: string) => unknown): ChartData {
  const categories = (Array.isArray(node.categories) ? node.categories : []).map(asText)
  const series = (Array.isArray(node.series) ? node.series : []).map((item, index) => ({
    name: typeof item?.name === 'string' ? item.name : '', color: colorAt(index),
    values: categories.map((_, at) => {
      const value = Number(resolve(Array.isArray(item?.values) ? item.values[at] : undefined, lookup, 0))
      return Number.isFinite(value) ? value : 0
    }),
  }))
  return { kind: node.kind ?? 'bar', categories, series, unit: typeof node.unit === 'string' ? node.unit : '' }
}
const csvCell = (value: string) => /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
export function chartCsv({ categories, series, unit }: ChartData, t: ViewT = english) {
  const head = ['', ...series.map((item, index) => item.name || (series.length === 1 ? unit || t('Value') : `${t('Series')} ${index + 1}`))]
  const rows = categories.map((label, at) => [label, ...series.map(item => String(item.values[at]))])
  return [head, ...rows].map(row => row.map(cell => csvCell(String(cell))).join(',')).join('\n')
}

type Point = { x: number; y: number }
type Hit = { x: number; y: number; w: number; h: number }
type Drawn = { parts: React.ReactNode[]; height: number; points: Point[]; hits: Hit[]; size?: number; values?: number[]; total?: number }
function valueAxis(values: number[], zero: boolean) {
  const finite = values.length > 0 ? values : [0]
  const low = Math.min(...finite)
  const high = Math.max(...finite)
  if (zero) return niceTicks(Math.min(0, low), Math.max(0, high))
  const pad = (high - low) * 0.1 || Math.abs(high) * 0.1 || 1
  return niceTicks(low - pad, high + pad)
}
function columns({ categories, series, unit, kind }: ChartData, width: number, active: number | null, shown: boolean[]): Drawn {
  const visible = series.filter((_, index) => shown[index])
  const ticks = valueAxis(visible.flatMap(item => item.values), kind !== 'line')
  const lo = ticks[0]
  const hi = ticks.at(-1)!
  const left = Math.ceil(Math.max(...ticks.map(tick => textWidth(withUnit(tick, unit), TICK)))) + 10
  const top = 8
  const height = 220
  const bottom = 24
  const plot = { x: left, y: top, w: Math.max(40, width - left - 4), h: height - top - bottom }
  const y = (value: number) => plot.y + plot.h - ((value - lo) / (hi - lo)) * plot.h
  const band = plot.w / categories.length
  const parts: React.ReactNode[] = []
  for (const tick of ticks) {
    parts.push(<line key={`g${tick}`} className="dvui-chart-grid" x1={plot.x} x2={plot.x + plot.w} y1={y(tick)} y2={y(tick)} />)
    parts.push(<text key={`t${tick}`} className="dvui-chart-tick" x={plot.x - 8} y={y(tick) + 3} textAnchor="end">{withUnit(tick, unit)}</text>)
  }
  const points: Point[] = []
  categories.forEach((label, at) => {
    const cx = plot.x + band * at + band / 2
    parts.push(<text key={`c${at}`} className="dvui-chart-label" x={cx} y={height - 7} textAnchor="middle">{fit(label, band - 4, LABEL)}</text>)
    points.push({ x: cx, y: y(Math.max(...visible.map(item => item.values[at]), lo)) })
  })
  if (kind === 'bar') {
    const group = band * 0.72
    const gap = visible.length > 1 ? 2 : 0
    const barW = Math.max(2, (group - gap * (visible.length - 1)) / visible.length)
    const zero = y(Math.max(lo, Math.min(0, hi)))
    categories.forEach((_, at) => visible.forEach((item, row) => {
      const value = item.values[at]
      const x = plot.x + band * at + (band - group) / 2 + row * (barW + gap)
      const top2 = Math.min(y(value), zero)
      const tall = Math.max(1, Math.abs(y(value) - zero))
      const r = Math.min(4, barW / 2, tall)
      const d = value >= 0
        ? `M${x},${top2 + tall}V${top2 + r}q0,-${r} ${r},-${r}h${barW - 2 * r}q${r},0 ${r},${r}V${top2 + tall}z`
        : `M${x},${top2}V${top2 + tall - r}q0,${r} ${r},${r}h${barW - 2 * r}q${r},0 ${r},-${r}V${top2}z`
      parts.push(<path key={`b${at}-${row}`} className="dvui-chart-mark" data-dim={active !== null && active !== at ? '' : undefined} d={d} style={{ fill: item.color }} />)
    }))
  } else {
    const xs = categories.map((_, at) => plot.x + band * at + band / 2)
    visible.forEach((item, row) => {
      const line = item.values.map((value, at) => `${at === 0 ? 'M' : 'L'}${xs[at]},${y(value)}`).join('')
      if (kind === 'area') {
        const base = y(Math.max(lo, Math.min(0, hi)))
        parts.push(<path key={`a${row}`} className="dvui-chart-area" d={`${line}L${xs.at(-1)},${base}L${xs[0]},${base}z`} style={{ fill: item.color }} />)
      }
      parts.push(<path key={`l${row}`} className="dvui-chart-line" d={line} style={{ stroke: item.color }} />)
      item.values.forEach((value, at) => parts.push(<circle key={`p${row}-${at}`} className="dvui-chart-dot" cx={xs[at]} cy={y(value)} r={active === at ? 4 : 2.5} style={{ fill: item.color }} />))
    })
    if (active !== null) parts.unshift(<line key="guide" className="dvui-chart-guide" x1={xs[active]} x2={xs[active]} y1={plot.y} y2={plot.y + plot.h} />)
  }
  return { parts, height, points, hits: categories.map((_, at) => ({ x: plot.x + band * at, y: plot.y, w: band, h: plot.h })) }
}
function rows({ categories, series, unit }: ChartData, width: number, active: number | null, shown: boolean[]): Drawn {
  const visible = series.filter((_, index) => shown[index])
  const ticks = valueAxis(visible.flatMap(item => item.values), true)
  const lo = ticks[0]
  const hi = ticks.at(-1)!
  const labelW = Math.min(width * 0.38, Math.ceil(Math.max(...categories.map(label => textWidth(label, LABEL)))) + 10)
  const valueW = Math.ceil(Math.max(...visible.flatMap(item => item.values).map(value => textWidth(withUnit(value, unit), LABEL)))) + 10
  const barH = 14
  const rowH = 10 + visible.length * barH + (visible.length - 1) * 2
  const top = 4
  const height = top + rowH * categories.length + 22
  const plot = { x: labelW, y: top, w: Math.max(40, width - labelW - valueW), h: rowH * categories.length }
  const x = (value: number) => plot.x + ((value - lo) / (hi - lo)) * plot.w
  const parts: React.ReactNode[] = []
  for (const tick of ticks) {
    parts.push(<line key={`g${tick}`} className="dvui-chart-grid" x1={x(tick)} x2={x(tick)} y1={plot.y} y2={plot.y + plot.h} />)
    parts.push(<text key={`t${tick}`} className="dvui-chart-tick" x={x(tick)} y={height - 6} textAnchor="middle">{withUnit(tick, unit)}</text>)
  }
  const points: Point[] = []
  const zero = x(Math.max(lo, Math.min(0, hi)))
  categories.forEach((label, at) => {
    const rowY = plot.y + rowH * at + 5
    parts.push(<text key={`c${at}`} className="dvui-chart-label" x={labelW - 10} y={rowY + (rowH - 10) / 2 + 4} textAnchor="end">{fit(label, labelW - 12, LABEL)}</text>)
    visible.forEach((item, row) => {
      const value = item.values[at]
      const by = rowY + row * (barH + 2)
      const left = Math.min(x(value), zero)
      const long = Math.max(1, Math.abs(x(value) - zero))
      parts.push(<rect key={`b${at}-${row}`} className="dvui-chart-mark" data-dim={active !== null && active !== at ? '' : undefined} x={left} y={by} width={long} height={barH} rx={Math.min(4, long / 2)} style={{ fill: item.color }} />)
      parts.push(<text key={`v${at}-${row}`} className="dvui-chart-value" x={left + long + 6} y={by + barH - 3}>{withUnit(value, unit)}</text>)
    })
    points.push({ x: Math.max(...visible.map(item => x(item.values[at])), zero), y: rowY })
  })
  return { parts, height, points, hits: categories.map((_, at) => ({ x: 0, y: plot.y + rowH * at, w: width, h: rowH })) }
}
function donut({ categories, series }: ChartData, width: number, active: number | null, hover: (at: number) => void): Drawn {
  const values = (series[0]?.values ?? []).map(value => Math.max(0, value))
  const total = values.reduce((sum, value) => sum + value, 0)
  const size = Math.min(180, Math.max(120, width * 0.42))
  const r = size / 2
  const inner = r * 0.62
  const cx = r
  const cy = r
  const parts: React.ReactNode[] = []
  const points: Point[] = []
  let angle = -Math.PI / 2
  values.forEach((value, at) => {
    const sweep = total > 0 ? (value / total) * Math.PI * 2 : 0
    const end = angle + sweep
    const mid = angle + sweep / 2
    points.push({ x: cx + Math.cos(mid) * (r - (r - inner) / 2), y: cy + Math.sin(mid) * (r - (r - inner) / 2) })
    if (sweep > 0) {
      const large = sweep > Math.PI ? 1 : 0
      const full = sweep >= Math.PI * 2 - 1e-6
      const p = (radius: number, theta: number) => `${cx + Math.cos(theta) * radius},${cy + Math.sin(theta) * radius}`
      const d = full
        ? `M${p(r, angle)}A${r},${r} 0 1 1 ${p(r, angle + Math.PI)}A${r},${r} 0 1 1 ${p(r, angle)}M${p(inner, angle)}A${inner},${inner} 0 1 0 ${p(inner, angle + Math.PI)}A${inner},${inner} 0 1 0 ${p(inner, angle)}z`
        : `M${p(r, angle)}A${r},${r} 0 ${large} 1 ${p(r, end)}L${p(inner, end)}A${inner},${inner} 0 ${large} 0 ${p(inner, angle)}z`
      parts.push(<path key={`s${at}`} className="dvui-chart-mark" data-dim={active !== null && active !== at ? '' : undefined} d={d} fillRule="evenodd" style={{ fill: colorAt(at) }} onPointerEnter={() => hover(at)} />)
    }
    angle = end
  })
  return { parts, height: size, size, points, total, values, hits: [] }
}
function useWidth(box: React.RefObject<HTMLDivElement | null>, initial: number) {
  const [width, setWidth] = useState(initial)
  useLayoutEffect(() => {
    const node = box.current
    if (!node || typeof ResizeObserver !== 'function') return undefined
    const measure = () => { const next = Math.round(node.clientWidth); if (next > 0) setWidth(next) }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [box])
  return width
}

export type ChartHandle = { label: string | null; asTable: boolean; toggleTable(): void; copy(): void }
export function ChartTable({ data, t = english }: { data: ChartData; t?: ViewT }) {
  const { categories, series, unit } = data
  const heads = series.map((item, index) => item.name || (series.length === 1 ? unit || t('Value') : `${t('Series')} ${index + 1}`))
  return <div className="dvui-table"><table><thead><tr><th scope="col" />{heads.map((head, index) => <th key={index} scope="col" className="dvui-num">{head}</th>)}</tr></thead><tbody>{categories.map((label, at) => <tr key={`${at}-${label}`}><th scope="row">{label}</th>{series.map((item, index) => <td key={index} className="dvui-num">{withUnit(item.values[at], series.length === 1 && !item.name ? '' : unit)}</td>)}</tr>)}</tbody></table></div>
}
export function WidgetChart({ node, lookup, registerChart, refreshCharts, t = english }: { node: ViewNode; lookup: (name: string) => unknown; registerChart?: (key: string, handle: ChartHandle) => (() => void) | void; refreshCharts?: () => void; t?: ViewT }) {
  const data = chartData(node, lookup)
  const { kind, categories, series, unit } = data
  const box = useRef<HTMLElement>(null)
  const width = useWidth(box as React.RefObject<HTMLDivElement | null>, 520)
  const [active, setActive] = useState<number | null>(null)
  const [hidden, setHidden] = useState<number[]>([])
  const [asTable, setAsTable] = useState(false)
  const [copied, setCopied] = useState(false)
  const labelId = useId()
  const menuKey = useId()
  const table = useRef(asTable)
  table.current = asTable
  const shown = series.map((_, index) => !hidden.includes(index))
  const label = typeof node.caption === 'string' && node.caption !== '' ? node.caption : t('Chart')
  const isDonut = kind === 'donut'
  const legendBeside = isDonut && width >= 360
  const drawn = isDonut ? donut(data, legendBeside ? width - 200 : width, active, setActive) : kind === 'hbar' ? rows(data, width, active, shown) : columns(data, width, active, shown)
  const svgWidth = isDonut ? drawn.size! : width
  const move = (event: KeyboardEvent<SVGSVGElement>) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
    if (event.key === 'Escape') { setActive(null); return }
    if (keys[event.key] === undefined) return
    event.preventDefault()
    setActive(current => current === null ? 0 : (current + keys[event.key] + categories.length) % categories.length)
  }
  const point = active === null ? null : drawn.points[active]
  const share = (at: number) => unit === '%' ? withUnit(drawn.values![at], unit) : `${withUnit(drawn.values![at], unit)} · ${drawn.total! > 0 ? Math.round((drawn.values![at] / drawn.total!) * 100) : 0}%`
  const tipRows = active === null || isDonut ? [] : series.filter((_, index) => shown[index]).map(item => ({ color: item.color, name: item.name, value: withUnit(item.values[active], unit) }))
  const copy = () => {
    void navigator.clipboard?.writeText(chartCsv(data, t)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200) }).catch(() => {})
  }
  const toggleTable = () => { table.current = !table.current; setAsTable(table.current) }
  const action = useRef<ChartHandle>({ label: null, asTable: false, toggleTable, copy })
  action.current = { label: typeof node.caption === 'string' && node.caption !== '' ? node.caption : null, get asTable() { return table.current }, toggleTable, copy }
  useLayoutEffect(() => registerChart?.(menuKey, { get label() { return action.current.label }, get asTable() { return action.current.asTable }, toggleTable: () => action.current.toggleTable(), copy: () => action.current.copy() }), [registerChart, menuKey])
  useLayoutEffect(() => { refreshCharts?.() }, [refreshCharts, asTable, label])
  const legend = isDonut
    ? <div className="dvui-chart-legend dvui-chart-legend-list">{categories.map((name, at) => <div key={`${at}-${name}`} className="dvui-chart-key" data-dim={active !== null && active !== at ? '' : undefined} onPointerEnter={() => setActive(at)} onPointerLeave={() => setActive(null)}><i style={{ background: colorAt(at) }} /><span className="dvui-chart-key-name">{name}</span><span className="dvui-chart-key-value">{share(at)}</span></div>)}</div>
    : series.length > 1 ? <div className="dvui-chart-legend">{series.map((item, index) => <button key={`${index}-${item.name}`} type="button" className="dvui-chart-key" aria-pressed={shown[index]} onClick={() => setHidden(before => before.includes(index) ? before.filter(item => item !== index) : shown.filter(Boolean).length > 1 ? [...before, index] : before)}><i style={{ background: item.color }} />{item.name || `${t('Series')} ${index + 1}`}</button>)}</div> : null
  const plot = <div className="dvui-chart-plot" style={isDonut ? { width: svgWidth } : undefined}>
    <svg className="dvui-chart-svg" width={svgWidth} height={drawn.height} viewBox={`0 0 ${svgWidth} ${drawn.height}`} role="img" aria-labelledby={labelId} tabIndex={0} onKeyDown={move} onBlur={() => setActive(null)} onPointerLeave={() => setActive(null)}>
      {drawn.parts}
      {isDonut ? (active === null
        ? <text className="dvui-chart-center" x={svgWidth / 2} y={drawn.height / 2 + 5} textAnchor="middle">{unit === '%' ? '' : withUnit(drawn.total!, unit)}</text>
        : <Fragment><text className="dvui-chart-center-name" x={svgWidth / 2} y={drawn.height / 2 - 4} textAnchor="middle">{fit(categories[active], drawn.size! * 0.56, LABEL)}</text><text className="dvui-chart-center" x={svgWidth / 2} y={drawn.height / 2 + 14} textAnchor="middle">{share(active)}</text></Fragment>)
        : drawn.hits.map((hit, at) => <rect key={`h${at}`} className="dvui-chart-hit" x={hit.x} y={hit.y} width={hit.w} height={hit.h} onPointerEnter={() => setActive(at)} />)}
    </svg>
    {point && !asTable && !isDonut ? <div className="dvui-chart-tip" role="status" style={{ left: point.x, top: point.y } as CSSProperties}><b>{categories[active!]}</b>{tipRows.map((row, index) => <span key={index}><i style={{ background: row.color }} />{row.name ? `${row.name}  ` : ''}{row.value}</span>)}</div> : null}
  </div>
  return <figure ref={box} className="dvui-chart" data-kind={kind}>
    <span id={labelId} hidden>{label}</span>
    {asTable ? <ChartTable data={data} t={t} /> : isDonut ? <div className={legendBeside ? 'dvui-chart-donut dvui-chart-donut-beside' : 'dvui-chart-donut'} onPointerLeave={() => setActive(null)}>{plot}{legend}</div> : <Fragment>{legend}{plot}</Fragment>}
    {copied ? <span className="dvui-chart-copied" role="status">{t('Copied')}</span> : null}
    {typeof node.caption === 'string' && node.caption !== '' ? <figcaption className="dvui-caption">{node.caption}</figcaption> : null}
  </figure>
}
