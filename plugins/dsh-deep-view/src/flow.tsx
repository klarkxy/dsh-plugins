// Node graph view on @xyflow/react (MIT). Read-only canvas: users pan, zoom,
// drag nodes into a layout and select one node; models cannot connect, delete
// or bring their own node components, so every control that could mutate the
// model-supplied topology stays disabled or filtered out below.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow, Background, Controls, MiniMap, Handle, Position, MarkerType,
  applyEdgeChanges, applyNodeChanges,
} from '@xyflow/react'
import type {
  Edge, EdgeChange, Node, NodeChange, NodeProps, OnSelectionChangeFunc,
} from '@xyflow/react'
import { asText } from './core/index.js'
import type { ViewNode } from './contracts.ts'
import type { RichNodeProps } from './rich-types.ts'
import { english, type ViewT } from './ui.tsx'

export type FlowTone = 'neutral' | 'accent' | 'success' | 'warn' | 'bad'
export type FlowNodeData = { label: string; detail: string; tone: FlowTone }
export type FlowGraphNode = Node<FlowNodeData>
export type FlowGraphEdge = Edge

const FLOW_NODE_TYPE = 'dvui-flow-node'
const TONES: readonly FlowTone[] = ['neutral', 'accent', 'success', 'warn', 'bad']
const NODE_CHANGES: readonly NodeChange['type'][] = ['dimensions', 'position', 'select']
const EDGE_CHANGES: readonly EdgeChange['type'][] = ['select']
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0
export const flowToneOf = (tone: unknown): FlowTone => TONES.includes(tone as FlowTone) ? tone as FlowTone : 'neutral'
/** First selected node id; the canvas never produces a multi-node selection. */
export const selectedFlowNodeId = (nodes: readonly FlowGraphNode[]) => nodes.find(item => item.selected === true)?.id ?? ''

export function flowGraph(node: ViewNode, selectedId?: unknown): { nodes: FlowGraphNode[]; edges: FlowGraphEdge[] } {
  const seen = new Set<string>()
  const items = (Array.isArray(node.nodes) ? node.nodes : [])
    .filter(item => item !== null && typeof item === 'object')
  const nodes = items.map(item => {
    const id = asText(item.id)
    seen.add(id)
    return {
      id,
      type: FLOW_NODE_TYPE,
      position: { x: finite(item.x), y: finite(item.y) },
      data: { label: asText(item.label), detail: item.detail === undefined ? '' : asText(item.detail), tone: flowToneOf(item.tone) },
      className: `dvui-flow-tone-${flowToneOf(item.tone)}`,
      connectable: false,
      deletable: false,
      selected: typeof selectedId === 'string' && selectedId !== '' && id === selectedId,
    } satisfies FlowGraphNode
  }).filter((item, index, all) => item.id !== '' && all.findIndex(other => other.id === item.id) === index)
  const edges = (Array.isArray(node.edges) ? node.edges : [])
    .filter(item => item !== null && typeof item === 'object')
    .map(item => ({
      id: asText(item.id) || `${asText(item.source)}→${asText(item.target)}`,
      type: 'smoothstep' as const,
      source: asText(item.source),
      target: asText(item.target),
      label: item.label === undefined ? undefined : asText(item.label),
      className: 'dvui-flow-edge',
      selectable: false,
      deletable: false,
      reconnectable: false,
      focusable: false,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    } satisfies FlowGraphEdge))
    .filter(item => item.source !== '' && item.target !== '' && seen.has(item.source) && seen.has(item.target))
  return { nodes, edges }
}
/** Drag/select/dimension changes only: remove/add/replace never reach the state. */
export function applyFlowNodeChanges(nodes: readonly FlowGraphNode[], changes: readonly NodeChange<FlowGraphNode>[]) {
  return applyNodeChanges(changes.filter(change => NODE_CHANGES.includes(change.type)), [...nodes])
}
export function applyFlowEdgeChanges(edges: readonly FlowGraphEdge[], changes: readonly EdgeChange<FlowGraphEdge>[]) {
  return applyEdgeChanges(changes.filter(change => EDGE_CHANGES.includes(change.type)), [...edges])
}

// One closed node type, registered once so React Flow never unmounts nodes when
// FlowView re-renders. Handles exist so edges can attach; they are styled away
// in CSS and connectable stays false.
function DvuiFlowNode({ data }: NodeProps<FlowGraphNode>) {
  return <div className="dvui-flow-node-body">
    <span className="dvui-flow-node-label">{data.label}</span>
    {data.detail !== '' ? <span className="dvui-flow-node-detail">{data.detail}</span> : null}
    <Handle type="target" position={Position.Left} isConnectable={false} />
    <Handle type="source" position={Position.Right} isConnectable={false} />
  </div>
}
const NODE_TYPES = { [FLOW_NODE_TYPE]: DvuiFlowNode }

export function FlowView({ node, lookup, setInput, t = english, editable = true }: RichNodeProps & { editable?: boolean }) {
  const selectedId = (() => { try { return node.id ? lookup(node.id) : '' } catch { return '' } })()
  const graph = useMemo(() => flowGraph(node, selectedId), [node.nodes, node.edges])
  const [rfNodes, setRfNodes] = useState<FlowGraphNode[]>(graph.nodes)
  const [rfEdges, setRfEdges] = useState<FlowGraphEdge[]>(graph.edges)
  const bind = typeof node.id === 'string' && node.id !== '' ? node.id : undefined
  // Handlers stay referentially stable; the latest binder lives in a ref so a
  // re-rendered card never leaves a stale setInput captured in the canvas.
  const emit = useRef<(id: string) => void>(() => {})
  emit.current = (id: string) => { if (editable && bind !== undefined) setInput(bind, id) }
  const lastSelected = useRef('')
  const onNodesChange = useCallback((changes: NodeChange<FlowGraphNode>[]) => setRfNodes(before => applyFlowNodeChanges(before, changes)), [])
  const onEdgesChange = useCallback((changes: EdgeChange<FlowGraphEdge>[]) => setRfEdges(before => applyFlowEdgeChanges(before, changes)), [])
  const onSelectionChange = useCallback<OnSelectionChangeFunc<FlowGraphNode, FlowGraphEdge>>(selection => {
    const id = selectedFlowNodeId(selection.nodes)
    lastSelected.current = id
    emit.current(id)
  }, [])
  // The graph is model data: a new payload replaces local drag positions and
  // clears a selection that no longer points at a real node.
  useEffect(() => {
    setRfNodes(graph.nodes)
    setRfEdges(graph.edges)
    if (lastSelected.current !== '' && !graph.nodes.some(item => item.id === lastSelected.current)) {
      lastSelected.current = ''
      emit.current('')
    }
  }, [graph])
  const selected = useMemo(() => {
    const id = selectedFlowNodeId(rfNodes)
    return id === '' ? undefined : rfNodes.find(item => item.id === id)
  }, [rfNodes])
  return <div className="dvui-flow">
    <div className="dvui-flow-canvas" style={{ height: 320 }}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onSelectionChange={onSelectionChange}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={2.5}
        nodesDraggable={editable}
        nodesConnectable={false}
        elementsSelectable={editable}
        edgesFocusable={false}
        edgesReconnectable={false}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        panActivationKeyCode={null}
        aria-label={typeof node.label === 'string' && node.label !== '' ? node.label : t('Node graph')}
      >
        <Background gap={20} className="dvui-flow-background" />
        <Controls showInteractive={false} position="top-left" />
        <MiniMap pannable zoomable position="bottom-left" />
      </ReactFlow>
    </div>
    <div className="dvui-flow-selection" aria-live="polite">
      {selected === undefined
        ? <span className="dvui-flow-hint">{t('Select a node')}</span>
        : <span className="dvui-flow-detail" data-tone={selected.data.tone}><strong className="dvui-flow-detail-label">{selected.data.label}</strong>{selected.data.detail !== '' ? <span className="dvui-flow-detail-text">{selected.data.detail}</span> : null}</span>}
    </div>
  </div>
}
