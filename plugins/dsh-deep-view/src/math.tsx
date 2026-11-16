// Interactive math plane for the 'math' rich node. Mafs draws the plane and
// owns gesture handling; the component only publishes each point's `<id>X` and
// `<id>Y` bindings through setInput so the view scope stays the single source
// of truth. Curve expressions run through the shared bounded formula
// interpreter (compileFormula + evaluate): x is the running variable, every
// other name reads the host's lookup. No eval, no Function.
import { useEffect } from 'react'
import { Coordinates, Mafs, Plot, Point, Text, useMovablePoint } from 'mafs'
import { compileFormula, evaluate, isName } from './core/index.js'
import type { FormulaTree } from './core/index.js'
import { isRecord, type MathCurve, type MathPoint } from './contracts.ts'
import type { RichNodeProps } from './rich-types.ts'
import { english } from './ui.tsx'

export const DEFAULT_DOMAIN: [number, number] = [-10, 10]
export const DEFAULT_RANGE: [number, number] = [-10, 10]
export const CURVE_COLORS = [
  'var(--dsw-alias-state-business-primary)',
  'var(--dsw-alias-brand-primary)',
  'var(--dsw-alias-label-secondary)',
  'var(--dsw-alias-label-tertiary)',
]
export const curveColor = (index: number) => CURVE_COLORS[index % CURVE_COLORS.length]
const POINT_COLOR = 'var(--dsw-alias-state-business-primary)'
// Adaptive sampling goes 2^depth deep; the cap keeps one pathological curve
// from doing tens of thousands of evaluations per render.
export const MIN_SAMPLING_DEPTH = 5
export const MAX_SAMPLING_DEPTH = 10

export { mathStyles } from './math-styles.ts'

/** `lookup` can throw (the scope reports unknown names); a missing binding
 * falls back to the declared coordinate instead of breaking the plane. */
const safeLookup = (lookup: RichNodeProps['lookup']) => (name: string) => {
  try { return lookup(name) } catch { return undefined }
}
const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

/** Ordered domain/range with sane defaults; degenerate input falls back. */
export function mathBounds(domain: unknown, range: unknown): { x: [number, number]; y: [number, number] } {
  const read = (value: unknown, fallback: [number, number]): [number, number] => {
    if (!Array.isArray(value)) return fallback
    const a = finite(value[0])
    const b = finite(value[1])
    if (a === undefined || b === undefined || a === b) return fallback
    return a < b ? [a, b] : [b, a]
  }
  return { x: read(domain, DEFAULT_DOMAIN), y: read(range, DEFAULT_RANGE) }
}

export type CompiledCurve = { label?: string; expression: string; tree?: FormulaTree; error?: string }
/** Every declared curve is kept: a failed one carries `error` and is skipped
 * at draw time instead of dropping the whole view. */
export function compileCurves(curves: unknown): CompiledCurve[] {
  if (!Array.isArray(curves)) return []
  const out: CompiledCurve[] = []
  for (const item of curves as MathCurve[]) {
    const expression = typeof item?.expression === 'string' ? item.expression : ''
    const compiled = compileFormula(expression)
    out.push(compiled.error === undefined
      ? { label: typeof item?.label === 'string' ? item.label : undefined, expression, tree: compiled.tree }
      : { label: typeof item?.label === 'string' ? item.label : undefined, expression, error: compiled.error })
  }
  return out
}

/** f(x) for one compiled expression. x binds the running variable; other names
 * read the view scope through `lookup`. Failures and non-finite results are
 * NaN so the plotter just breaks the line there. */
export function curveAt(curve: CompiledCurve, x: number, lookup: RichNodeProps['lookup']): number {
  if (curve.tree === undefined) return NaN
  const scope = (name: string) => {
    if (name === 'x') return x
    try { return lookup(name) } catch { return undefined }
  }
  const result = evaluate(curve.tree, scope)
  const value = result.error === undefined ? finite(result.value) : undefined
  return value === undefined ? NaN : value
}

/** Uniform samples for tests and label placement; only finite values kept. */
export function sampleCurve(curve: CompiledCurve, domain: [number, number], lookup: RichNodeProps['lookup'], samples = 64): [number, number][] {
  const count = Math.max(2, Math.min(512, Math.floor(samples)))
  const [min, max] = domain
  const out: [number, number][] = []
  for (let index = 0; index < count; index += 1) {
    const x = min + ((max - min) * index) / (count - 1)
    const y = curveAt(curve, x, lookup)
    if (Number.isFinite(y)) out.push([x, y])
  }
  return out
}

export function pointBinding(id: string): { x: string; y: string } {
  return { x: `${id}X`, y: `${id}Y` }
}

/** The live position of one declared point: its published `<id>X`/`<id>Y`
 * bindings first, the declared x/y as the fallback. */
export function readPoint(point: MathPoint, lookup: RichNodeProps['lookup']): [number, number] {
  const binding = pointBinding(point.id)
  return [finite(lookup(binding.x)) ?? point.x, finite(lookup(binding.y)) ?? point.y]
}

/** The flat `<id>X`/`<id>Y` record the host's scope needs for its inputs. */
export function mathPointValues(points: readonly MathPoint[]): Record<string, number> {
  const values: Record<string, number> = {}
  for (const point of points) values[pointBinding(point.id).x] = point.x
  for (const point of points) values[pointBinding(point.id).y] = point.y
  return values
}

function curveLabelAt(curve: CompiledCurve, domain: [number, number], lookup: (name: string) => unknown): { at: [number, number]; text: string } | null {
  if (typeof curve.label !== 'string' || curve.label === '') return null
  const samples = sampleCurve(curve, domain, lookup, 40)
  const last = samples.at(-1)
  if (last === undefined) return null
  return { at: last, text: curve.label }
}

type BoundPoint = { spec: MathPoint; x: number; y: number; element: React.ReactElement }
// Each point is its own keyed component, so revisions may add, remove or
// reorder declared points without changing this component's hook count.
function useBoundPoint(point: MathPoint, lookup: (name: string) => unknown, setInput: RichNodeProps['setInput']): BoundPoint {
  const [declaredX, declaredY] = [finite(point.x) ?? 0, finite(point.y) ?? 0]
  const externalX = finite(lookup(pointBinding(point.id).x)) ?? declaredX
  const externalY = finite(lookup(pointBinding(point.id).y)) ?? declaredY
  const movable = useMovablePoint([externalX, externalY], {
    color: POINT_COLOR,
    ...(point.constrain === 'horizontal' || point.constrain === 'vertical' ? { constrain: point.constrain } : {}),
  })
  const { x, y, setPoint } = movable
  useEffect(() => {
    setInput(pointBinding(point.id).x, x)
    setInput(pointBinding(point.id).y, y)
  }, [setInput, point.id, x, y])
  useEffect(() => {
    if (Math.abs(externalX - x) > 1e-9 || Math.abs(externalY - y) > 1e-9) setPoint([externalX, externalY])
  }, [externalX, externalY, x, y, setPoint])
  return { spec: point, x, y, element: movable.element }
}
function EditableMathPoint({ point, lookup, setInput }: { point: MathPoint; lookup: (name: string) => unknown; setInput: RichNodeProps['setInput'] }) {
  return useBoundPoint(point, lookup, setInput).element
}

export type MathViewProps = RichNodeProps & {
  /** False freezes the plane: points become static dots and publish nothing. */
  editable?: boolean
}
export function MathView({ node, lookup, setInput, t = english, editable = true }: MathViewProps) {
  const safe = safeLookup(lookup)
  const bounds = mathBounds(node.domain, node.range)
  const curves = compileCurves(node.curves)
  const declared = (Array.isArray(node.mathPoints) ? node.mathPoints : []).filter(point => isRecord(point) && isName(point.id))
  const points = declared.map(spec => ({ spec,
    x: finite(safe(pointBinding(spec.id).x)) ?? finite(spec.x) ?? 0,
    y: finite(safe(pointBinding(spec.id).y)) ?? finite(spec.y) ?? 0,
  }))
  const shown = curves.filter(curve => curve.tree !== undefined)
  const readouts = points.filter(item => typeof item.spec.label === 'string' && item.spec.label !== '')
  return <figure className="dvui-math">
    <div className="dvui-math-plot">
      <Mafs height={320} pan={false} zoom={false} viewBox={{ x: bounds.x, y: bounds.y, padding: 0 }}>
        <Coordinates.Cartesian />
        {shown.map((curve, index) => {
          const color = curveColor(index)
          const label = curveLabelAt(curve, bounds.x, safe)
          return <g key={`${curve.expression}-${index}`}>
            <Plot.OfX y={(x: number) => curveAt(curve, x, safe)} domain={bounds.x} color={color} minSamplingDepth={MIN_SAMPLING_DEPTH} maxSamplingDepth={MAX_SAMPLING_DEPTH} />
            {label ? <Text x={label.at[0]} y={label.at[1]} attach="ne" attachDistance={8} color={color}>{label.text}</Text> : null}
          </g>
        })}
        {points.map(item => editable
          ? <EditableMathPoint key={item.spec.id} point={item.spec} lookup={safe} setInput={setInput} />
          : <Point key={item.spec.id} x={item.x} y={item.y} color={POINT_COLOR} />)}
      </Mafs>
    </div>
    {readouts.length > 0 ? <div className="dvui-math-readout" aria-label={t('Point values')}>
      {readouts.map(item => <span key={item.spec.id}><i style={{ background: POINT_COLOR }} />{item.spec.label} ({formatCoordinate(item.x)}, {formatCoordinate(item.y)})</span>)}
    </div> : null}
    {typeof node.caption === 'string' && node.caption !== '' ? <figcaption className="dvui-caption">{node.caption}</figcaption> : null}
  </figure>
}

function formatCoordinate(value: number): string {
  return Number.isFinite(value) ? String(Number(value.toPrecision(6))) : '—'
}
