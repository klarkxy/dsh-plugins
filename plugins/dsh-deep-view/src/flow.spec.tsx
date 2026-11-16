import { act } from 'react'
import type { ReactNode } from 'react'
import { JSDOM } from 'jsdom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ViewNode } from './contracts.ts'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://local.test' })
vi.stubGlobal('window', dom.window)
vi.stubGlobal('document', dom.window.document)
vi.stubGlobal('navigator', dom.window.navigator)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

type AnyProps = Record<string, unknown> & { children?: ReactNode }
// A light React Flow double: components render as tagged divs and ReactFlow
// records its latest props so the spec can drive the controlled callbacks.
// Pure exports (applyNodeChanges/applyEdgeChanges/Position/MarkerType) stay real.
const latest = vi.hoisted(() => ({ props: undefined as AnyProps | undefined }))
vi.mock('@xyflow/react', async importOriginal => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  const ReactFlow = (props: AnyProps) => { latest.props = props; return <div data-testid="rf">{props.children}</div> }
  return {
    ...actual,
    default: ReactFlow,
    ReactFlow,
    Background: (props: AnyProps) => <div data-testid="background" />,
    Controls: (props: AnyProps) => <div data-testid="controls" />,
    MiniMap: (props: AnyProps) => <div data-testid="minimap" />,
    Handle: (props: AnyProps) => <div data-testid="handle" data-type={String(props.type)} />,
  }
})

let createRoot: typeof import('react-dom/client').createRoot
let FlowView: typeof import('./flow.tsx').FlowView
let flowGraph: typeof import('./flow.tsx').flowGraph
let applyFlowNodeChanges: typeof import('./flow.tsx').applyFlowNodeChanges
let applyFlowEdgeChanges: typeof import('./flow.tsx').applyFlowEdgeChanges
let selectedFlowNodeId: typeof import('./flow.tsx').selectedFlowNodeId
beforeAll(async () => {
  createRoot = (await import('react-dom/client')).createRoot
  ;({ FlowView, flowGraph, applyFlowNodeChanges, applyFlowEdgeChanges, selectedFlowNodeId } = await import('./flow.tsx'))
})
afterEach(() => { latest.props = undefined; document.body.innerHTML = '<div id="root"></div>' })

const t = (key: string) => key
const lookup = () => undefined
const view: ViewNode = { type: 'flow', id: 'pick', nodes: [
  { id: 'a', label: 'Alpha', detail: 'starts the run', x: 0, y: 0, tone: 'accent' },
  { id: 'b', label: 'Beta', x: 240, y: 60, tone: 'warn' },
  { id: 'c', label: 'Gamma', x: 480, y: 120 },
], edges: [
  { id: 'e1', source: 'a', target: 'b', label: 'next' },
  { id: 'e2', source: 'b', target: 'c' },
] }

describe('flowGraph mapping', () => {
  it('maps nodes to the closed dvui type with tone classes and no connect/delete', () => {
    const { nodes } = flowGraph(view)
    expect(nodes).toHaveLength(3)
    expect(nodes[0]).toMatchObject({ id: 'a', type: 'dvui-flow-node', position: { x: 0, y: 0 }, connectable: false, deletable: false })
    expect(nodes[0].data).toEqual({ label: 'Alpha', detail: 'starts the run', tone: 'accent' })
    expect(nodes[1].data.tone).toBe('warn')
    expect(nodes[2].data).toMatchObject({ label: 'Gamma', detail: '', tone: 'neutral' })
  })
  it('maps edges to smoothstep arrows that cannot be selected, deleted or reconnected', () => {
    const { edges } = flowGraph(view)
    expect(edges).toHaveLength(2)
    expect(edges[0]).toMatchObject({ id: 'e1', type: 'smoothstep', source: 'a', target: 'b', label: 'next', selectable: false, deletable: false, reconnectable: false })
    expect((edges[0].markerEnd as never as { type: string }).type).toBe('arrowclosed')
  })
  it('sanitizes malformed input: unknown tones, missing coords and dangling edges', () => {
    const graph = flowGraph({ type: 'flow', nodes: [
      { id: 'a', label: 'A', x: Number.NaN, y: 0, tone: 'hotpink' as 'neutral' },
      { id: 'a', label: 'Dupe', x: 10, y: 10 },
      { id: '', label: 'No id', x: 0, y: 0 },
      { id: 'b', label: 'B', x: 5, y: 5 },
    ], edges: [
      { id: 'ok', source: 'a', target: 'b' },
      { id: 'gone', source: 'a', target: 'missing' },
      { id: 'both', source: 'x', target: 'y' },
    ] })
    expect(graph.nodes.map(item => item.id)).toEqual(['a', 'b'])
    expect(graph.nodes[0].data.tone).toBe('neutral')
    expect(graph.nodes[0].position).toEqual({ x: 0, y: 0 })
    expect(graph.edges.map(item => item.id)).toEqual(['ok'])
  })
})

describe('controlled change helpers', () => {
  it('applies select and drag changes but refuses removals', () => {
    const { nodes } = flowGraph(view)
    const selected = applyFlowNodeChanges(nodes, [{ id: 'a', type: 'select', selected: true }])
    expect(selectedFlowNodeId(selected)).toBe('a')
    const moved = applyFlowNodeChanges(selected, [{ id: 'a', type: 'position', position: { x: 30, y: 40 }, positionAbsolute: { x: 30, y: 40 }, dragging: true }])
    expect(moved[0].position).toEqual({ x: 30, y: 40 })
    const refused = applyFlowNodeChanges(moved, [{ id: 'a', type: 'remove' }])
    expect(refused.map(item => item.id)).toEqual(['a', 'b', 'c'])
  })
  it('keeps edges identical when a delete change arrives', () => {
    const { edges } = flowGraph(view)
    const refused = applyFlowEdgeChanges(edges, [{ id: 'e1', type: 'remove' }])
    expect(refused.map(item => item.id)).toEqual(['e1', 'e2'])
  })
})

describe('FlowView selection', () => {
  it('renders the graph, disables mutations and shows an empty selection hint', async () => {
    const root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<FlowView node={view} lookup={lookup} setInput={vi.fn()} t={t} />))
    const props = latest.props!
    expect(props.nodes).toHaveLength(3)
    expect(props.edges).toHaveLength(2)
    expect(props.nodesConnectable).toBe(false)
    expect(props.edgesReconnectable).toBe(false)
    expect(props.deleteKeyCode).toBeNull()
    expect(props.elementsSelectable).toBe(true)
    expect(props.nodesDraggable).toBe(true)
    expect(props.proOptions?.hideAttribution).not.toBe(true)
    expect(document.body.textContent).toContain('Select a node')
    expect(document.body.textContent).not.toContain('starts the run')
    await act(async () => root.unmount())
  })
  it('publishes the selected node id and shows its label and detail', async () => {
    const root = createRoot(document.getElementById('root')!)
    const setInput = vi.fn()
    await act(async () => root.render(<FlowView node={view} lookup={lookup} setInput={setInput} t={t} />))
    const graph = { nodes: flowGraph(view).nodes.map(item => ({ ...item, selected: true })), edges: [] }
    await act(async () => { latest.props!.onNodesChange?.([{ id: 'a', type: 'select', selected: true }]) })
    await act(async () => { latest.props!.onSelectionChange?.({ nodes: [graph.nodes[0]], edges: [] }) })
    expect(setInput).toHaveBeenCalledWith('pick', 'a')
    const detail = document.querySelector('.dvui-flow-selection')!
    expect(detail.textContent).toContain('Alpha')
    expect(detail.textContent).toContain('starts the run')
    expect(detail.querySelector('.dvui-flow-detail')?.getAttribute('data-tone')).toBe('accent')
    await act(async () => root.unmount())
  })
  it('clears the binding when the selection empties and re-binds when a node disappears', async () => {
    const root = createRoot(document.getElementById('root')!)
    const setInput = vi.fn()
    await act(async () => root.render(<FlowView node={view} lookup={lookup} setInput={setInput} t={t} />))
    const graph = { nodes: flowGraph(view).nodes.map(item => ({ ...item, selected: true })), edges: [] }
    await act(async () => { latest.props!.onSelectionChange?.({ nodes: [graph.nodes[0]], edges: [] }) })
    expect(setInput).toHaveBeenLastCalledWith('pick', 'a')
    await act(async () => { latest.props!.onSelectionChange?.({ nodes: [], edges: [] }) })
    expect(setInput).toHaveBeenLastCalledWith('pick', '')
    // Select again, then swap the model payload so the picked id vanishes.
    await act(async () => { latest.props!.onSelectionChange?.({ nodes: [graph.nodes[0]], edges: [] }) })
    const next: ViewNode = { type: 'flow', id: 'pick', nodes: [{ id: 'b', label: 'Beta', x: 0, y: 0 }], edges: [] }
    await act(async () => root.render(<FlowView node={next} lookup={lookup} setInput={setInput} t={t} />))
    expect(setInput).toHaveBeenLastCalledWith('pick', '')
    expect(document.body.textContent).toContain('Select a node')
    await act(async () => root.unmount())
  })
})
