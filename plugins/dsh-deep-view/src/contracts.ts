import type { RpcResult as SharedRpcResult } from '@klarkxy/dsh-plugin-kit/contracts'
export type RpcResult<T = unknown> = SharedRpcResult<T>
export const PLUGIN_NAME = '@klarkxy/dsh-deep-view'
export const RPC_CHANNEL = '/dsh-deep-view'
export const VIEW_OWNER = 'dsh-deep-view'
export const CANVAS_OWNER = 'deep-view/canvas'
export const HOST_SERVICE = 'dshDeepView'
export type DeepViewConfig = {
  /** Restrict native `ask_user_question` in user-facing sessions so questions route through Deep View. */
  replaceNativeAskUser?: boolean
}
export type DeepViewHost = {
  /** Move an open card and route stale session lookups to a replacement root session. */
  handoffSession(fromSessionId: string, toSessionId: string): boolean
}

export type Scalar = string | number | boolean
export type Formula = { '=': string }
export type Value = Scalar | Formula
export type ChoiceOption = { label: string; value?: Scalar }
export type StepStatus = 'done' | 'active' | 'pending' | 'blocked'
export type SourceItem = { label: string; url: string }
export type StepItem = { label: string; detail?: Value; status?: Value }
export type FormField = { id: string; label: string; placeholder?: string; value?: string; multiline?: boolean; readOnly?: boolean }
export type MathPoint = { id: string; label?: string; x: number; y: number; constrain?: 'free' | 'horizontal' | 'vertical' }
export type MathCurve = { label?: string; expression: string }
export type FlowNode = { id: string; label: string; detail?: string; x?: number; y?: number; tone?: 'neutral' | 'accent' | 'success' | 'warn' | 'bad' }
export type FlowEdge = { id?: string; source: string; target: string; label?: string }
export type ExploreDatum = Record<string, Scalar>
export type MapLocation = { id: string; label: string; detail?: string; coordinates: [number, number] }
export type MapRoute = { label?: string; coordinates: [number, number][] }
export type ViewBinding = { id: string; value: unknown; kind?: 'input' | 'math' | 'flow' | 'explore' | 'map'; node?: ViewNode }
// The wire shares `items` between sources ({label,url}) and steps
// ({label,detail?,status?}); the validator enforces the shape per node type.
// Narrow with `isSourceItem`/`isStepItem` before reading `url` or `status`.
export function isSourceItem(item: SourceItem | StepItem): item is SourceItem {
  return item !== null && typeof item === 'object' && 'url' in item
}
export function isStepItem(item: SourceItem | StepItem): item is StepItem {
  return item !== null && typeof item === 'object' && !('url' in item)
}
export type ViewNode = {
  type: 'stack' | 'row' | 'text' | 'metric' | 'table' | 'chart' | 'progress' | 'callout' | 'sources' | 'steps'
    | 'slider' | 'number' | 'choice' | 'toggle' | 'options' | 'confirm' | 'form' | 'submit'
    | 'math' | 'flow' | 'explore' | 'map'
  id?: string
  children?: ViewNode[]
  let?: Record<string, string>
  text?: Value
  label?: string
  value?: Value | Scalar[]
  tone?: Value
  caption?: Value
  columns?: { key: string; label: string }[]
  rows?: Value[][]
  kind?: 'bar' | 'hbar' | 'line' | 'area' | 'donut'
  categories?: Scalar[]
  series?: { name?: string; values: (number | Formula)[] }[]
  unit?: string
  percent?: Value
  max?: Value
  valueLabel?: Value
  items?: SourceItem[] | StepItem[]
  min?: number
  step?: number
  options?: ChoiceOption[] | { label: string; description?: string }[]
  multi?: boolean
  allowCustom?: boolean
  customPlaceholder?: string
  confirmLabel?: string
  cancelLabel?: string
  fields?: FormField[]
  submitLabel?: string
  /** Interactive math: point ids expose `<id>X` and `<id>Y` bindings. */
  mathPoints?: MathPoint[]
  curves?: MathCurve[]
  domain?: [number, number]
  range?: [number, number]
  /** Node graph: id receives the selected node id. */
  nodes?: FlowNode[]
  edges?: FlowEdge[]
  /** Bounded data exploration: id receives selected category values or an x/y interval. */
  data?: ExploreDatum[]
  xKey?: string
  yKey?: string
  colorKey?: string
  select?: 'point' | 'interval'
  /** Map: id receives the selected location id. */
  center?: [number, number]
  zoom?: number
  locations?: MapLocation[]
  routes?: MapRoute[]
}
export type ShownView = { title: string; view: ViewNode; interactive: boolean; revision?: number }
export type ViewFailure = { error: string }
export type ViewSnapshot = ShownView & { id: string; sessionId: string; callId?: string; revision: number; blocking?: boolean }
export type PendingView = ViewSnapshot
export type ViewAnswer = { id: string; action: string; values: Record<string, unknown>; revision?: number }
/** Stored on the same user message as its readable answer, outside model text. */
export type ViewAnswerMetadata = { owner: typeof VIEW_OWNER; version: 1; answer: ViewAnswer }
export type ViewPresentation = {
  owner: typeof VIEW_OWNER
  viewId?: string
  title: string
  view: ViewNode
  interactive: boolean
  awaitReply: boolean
  revision?: number
  blocking?: boolean
  answer?: ViewAnswer
}
/** Persisted `show_canvas` result metadata the client tool card renders. */
export type CanvasPresentation = {
  owner: typeof CANVAS_OWNER
  path: string
  address: string
  title?: string
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
