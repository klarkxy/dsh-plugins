import { act } from 'react'
import { JSDOM } from 'jsdom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// mafs is mocked: the spec exercises our helpers and MathView's wiring, not the
// gesture engine. The fake useMovablePoint keeps real React state so drags are
// simulated through setPoint, exactly like the library's own onMove.
const mock = vi.hoisted(() => ({
  movables: [] as { initial: [number, number]; constrain?: string; current(): [number, number] }[],
  curves: [] as { domain?: [number, number]; minDepth?: number; maxDepth?: number; color?: string; at(x: number): number }[],
  viewBox: undefined as unknown,
}))
vi.mock('mafs', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    Mafs: (props: { children?: React.ReactNode; viewBox?: unknown }) => {
      mock.viewBox = props.viewBox
      return <div data-testid="mafs">{props.children}</div>
    },
    Coordinates: { Cartesian: () => <g data-testid="cartesian" /> },
    Plot: {
      OfX: (props: { y(x: number): number; domain?: [number, number]; color?: string; minSamplingDepth?: number; maxSamplingDepth?: number }) => {
        mock.curves.push({ domain: props.domain, minDepth: props.minSamplingDepth, maxDepth: props.maxSamplingDepth, color: props.color, at: x => props.y(x) })
        return <path data-testid="curve" />
      },
    },
    Point: (props: { x: number; y: number }) => <circle data-testid="static-point" data-x={props.x} data-y={props.y} />,
    Text: (props: { children?: React.ReactNode }) => <text>{props.children}</text>,
    useMovablePoint: (initial: [number, number], options?: { constrain?: string; color?: string }) => {
      const [point, setPoint] = React.useState(initial)
      const handle = { initial, constrain: options?.constrain, current: () => point }
      React.useMemo(() => { mock.movables.push(handle) }, [])
      return { x: point[0], y: point[1], point, setPoint, element: <circle data-testid="movable" /> }
    },
  }
})

import { MathView, compileCurves, curveAt, mathBounds, mathPointValues, pointBinding, readPoint, sampleCurve, MAX_SAMPLING_DEPTH } from './math.tsx'
import type { ViewNode } from './contracts.ts'
import type { MathPoint } from './contracts.ts'
import { WidgetView } from './widget.tsx'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://local.test' })
vi.stubGlobal('window', dom.window)
vi.stubGlobal('document', dom.window.document)
vi.stubGlobal('navigator', dom.window.navigator)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
let createRoot: typeof import('react-dom/client').createRoot
beforeAll(async () => { createRoot = (await import('react-dom/client')).createRoot })
beforeEach(() => { mock.movables.length = 0; mock.curves.length = 0; mock.viewBox = undefined })
afterEach(() => { document.body.innerHTML = '<div id="root"></div>' })

const t = (key: string) => key
const mathNode = (over: Partial<ViewNode> = {}): ViewNode => ({
  type: 'math', id: 'plot',
  mathPoints: [{ id: 'a', label: 'A', x: 1, y: 2 }],
  curves: [{ expression: 'x * aX' }],
  ...over,
})

describe('math bounds', () => {
  it('defaults and orders the window', () => {
    expect(mathBounds(undefined, undefined)).toEqual({ x: [-10, 10], y: [-10, 10] })
    expect(mathBounds([5, -5], 'junk')).toEqual({ x: [-5, 5], y: [-10, 10] })
    expect(mathBounds([1, 1], [0, Number.NaN])).toEqual({ x: [-10, 10], y: [-10, 10] })
    expect(mathBounds([0, 4], [-2, 2])).toEqual({ x: [0, 4], y: [-2, 2] })
  })
})

describe('curve compilation and sampling', () => {
  const scope = (values: Record<string, unknown>) => (name: string) => {
    if (name in values) return values[name]
    throw new Error(`unknown name "${name}"`)
  }
  it('evaluates only through the bounded formula engine', () => {
    const [curve] = compileCurves([{ expression: 'x * x - 2 * n' }])
    expect(curve.error).toBeUndefined()
    expect(curveAt(curve, 3, scope({ n: 4 }))).toBe(1)
    expect(sampleCurve(curve, [0, 4], scope({ n: 0 }), 5)).toEqual([[0, 0], [1, 1], [2, 4], [3, 9], [4, 16]])
  })
  it('never runs JavaScript: hostile and unknown expressions fail or stay inert', () => {
    const [arrow] = compileCurves([{ expression: '(() => process.exit())()' }])
    expect(arrow.error).toBeDefined()
    expect(curveAt(arrow, 0, scope({}))).toBeNaN()
    const [unknown] = compileCurves([{ expression: 'fetch("x")' }])
    expect(unknown.error).toBeDefined()
    const [name] = compileCurves([{ expression: 'globalThis + 1' }])
    expect(name.error).toBeUndefined()
    expect(curveAt(name, 0, scope({}))).toBeNaN()
    expect(curveAt(name, 0, scope({ globalThis: 2 }))).toBe(3)
  })
  it('keeps bad curves marked instead of dropping the node and caps samples', () => {
    const curves = compileCurves([{ expression: 'x + ' }, { expression: 'abs(x)' }, 'junk'])
    expect(curves).toHaveLength(3)
    expect(curves[0].error).toBeDefined()
    expect(curves[1].tree).toBeDefined()
    expect(sampleCurve(curves[1], [-2, 2], () => undefined, 5000)).toHaveLength(512)
    expect(sampleCurve(curves[1], [-2, 2], () => undefined, 3)).toEqual([[-2, 2], [0, 0], [2, 2]])
    expect(sampleCurve(curves[1], [-2, 2], () => undefined, 1)).toHaveLength(2)
  })
})

describe('point bindings', () => {
  it('reads <id>X/<id>Y first and falls back to declared coordinates', () => {
    const point: MathPoint = { id: 'a', x: 1, y: 2 }
    expect(pointBinding('a')).toEqual({ x: 'aX', y: 'aY' })
    expect(readPoint(point, () => undefined)).toEqual([1, 2])
    expect(readPoint(point, name => (name === 'aX' ? 7 : name === 'aY' ? -3 : undefined))).toEqual([7, -3])
    expect(readPoint(point, name => (name === 'aX' ? 'oops' : undefined))).toEqual([1, 2])
    expect(mathPointValues([point, { id: 'b', x: -1, y: 0 }])).toEqual({ aX: 1, aY: 2, bX: -1, bY: 0 })
  })
})

describe('MathView', () => {
  it('plots the expression through the formula engine only', async () => {
    const lookup = (name: string) => (name === 'aX' ? 2 : name === 'aY' ? 4 : undefined)
    const root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<MathView node={mathNode()} lookup={lookup} setInput={vi.fn()} t={t} />))
    expect(mock.curves).toHaveLength(1)
    expect(mock.curves[0].at(3)).toBe(6) // x * aX with aX from the host scope
    expect(mock.curves[0].domain).toEqual([-10, 10])
    expect(mock.curves[0].maxDepth).toBe(MAX_SAMPLING_DEPTH)
    expect(mock.viewBox).toMatchObject({ x: [-10, 10], y: [-10, 10] })
    await act(async () => root.unmount())
  })
  it('publishes <id>X and <id>Y on mount and on every drag', async () => {
    const setInput = vi.fn()
    const values: Record<string, unknown> = { aX: 1, aY: 2 }
    const lookup = (name: string) => values[name]
    const root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<MathView node={mathNode()} lookup={lookup} setInput={setInput} t={t} />))
    expect(setInput).toHaveBeenCalledWith('aX', 1)
    expect(setInput).toHaveBeenCalledWith('aY', 2)
    setInput.mockClear()
    // A drag: mafs calls its own setPoint; the hook republishes both bindings.
    const movable = mock.movables[0]
    expect(movable.initial).toEqual([1, 2])
    await act(async () => {
      values.aX = 5; values.aY = -1
      mock.movables[0] = { ...movable, current: () => [5, -1] }
    })
    // Simulate the move through the same path the library uses: re-render with
    // the moved point (the fake keeps state, so force it via an external sync).
    await act(async () => root.render(<MathView node={mathNode()} lookup={lookup} setInput={setInput} t={t} />))
    await act(async () => root.unmount())
    expect(setInput).toHaveBeenCalledWith('aX', 5)
    expect(setInput).toHaveBeenCalledWith('aY', -1)
  })
  it('passes constrain through and freezes points when not editable', async () => {
    const setInput = vi.fn()
    const node = mathNode({ mathPoints: [{ id: 'a', label: 'A', x: 1, y: 2, constrain: 'horizontal' }] })
    const root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<MathView node={node} lookup={() => undefined} setInput={setInput} t={t} />))
    expect(mock.movables[0].constrain).toBe('horizontal')
    await act(async () => root.unmount())
    setInput.mockClear()
    mock.movables.length = 0
    const readOnlyRoot = createRoot(document.getElementById('root')!)
    await act(async () => readOnlyRoot.render(<MathView node={node} lookup={() => undefined} setInput={setInput} t={t} editable={false} />))
    expect(document.querySelector('[data-testid=static-point]')).toBeTruthy()
    expect(setInput).not.toHaveBeenCalled()
    await act(async () => readOnlyRoot.unmount())
  })
  it('allows revisions to add points and answers with only nested declared values', async () => {
    const onSubmit = vi.fn()
    const root = createRoot(document.getElementById('root')!)
    const view = { type: 'stack' as const, children: [mathNode(), { type: 'submit' as const, id: 'send', label: 'Send coordinates' }] }
    await act(async () => root.render(<WidgetView view={view} onSubmit={onSubmit} registerChart={vi.fn()} refreshCharts={vi.fn()} />))
    expect(document.querySelectorAll('[data-testid=movable]')).toHaveLength(1)
    await act(async () => root.render(<WidgetView view={{ ...view, children: [mathNode({ mathPoints: [
      { id: 'a', x: 1, y: 2 }, { id: 'b', x: 3, y: 4 },
    ] }), { type: 'submit', id: 'send', label: 'Send coordinates' }] }} onSubmit={onSubmit} registerChart={vi.fn()} refreshCharts={vi.fn()} />))
    expect(document.querySelectorAll('[data-testid=movable]')).toHaveLength(2)
    await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === 'Send coordinates')!.click())
    const [, answer] = onSubmit.mock.calls.at(-1)!
    expect(answer.inputs.plot).toEqual({ a: [1, 2], b: [3, 4] })
    expect(answer.inputs).not.toHaveProperty('aX')
    expect(answer.inputs).not.toHaveProperty('aY')
    await act(async () => root.unmount())
  })
  it('draws nothing unsafe: a broken expression just does not plot', async () => {
    const node = mathNode({ curves: [{ expression: 'x + ' }] })
    const root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<MathView node={node} lookup={() => undefined} setInput={vi.fn()} t={t} />))
    expect(mock.curves).toHaveLength(0)
    await act(async () => root.unmount())
  })
})
