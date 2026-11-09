import type { RpcResult as SharedRpcResult } from '@klarkxy/dsh-plugin-kit/contracts'
export type RpcResult<T = unknown> = SharedRpcResult<T>
export const PLUGIN_NAME = '@klarkxy/dsh-deep-view'
export const RPC_CHANNEL = '/dsh-deep-view'
export const VIEW_OWNER = 'dsh-deep-view'

export type Scalar = string | number | boolean
export type Formula = { '=': string }
export type Value = Scalar | Formula
export type ChoiceOption = { label: string; value?: Scalar }
export type ViewNode = {
  type: 'stack' | 'row' | 'text' | 'metric' | 'table' | 'chart' | 'progress' | 'callout' | 'sources'
    | 'slider' | 'number' | 'choice' | 'toggle' | 'options' | 'confirm' | 'form' | 'submit'
  id?: string
  children?: ViewNode[]
  let?: Record<string, string>
  text?: Value
  label?: string
  value?: Value
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
  items?: { label: string; url: string }[]
  min?: number
  step?: number
  options?: ChoiceOption[] | { label: string; description?: string }[]
  multi?: boolean
  confirmLabel?: string
  cancelLabel?: string
  fields?: { id: string; label: string; placeholder?: string }[]
  submitLabel?: string
}
export type ShownView = { title: string; view: ViewNode; interactive: boolean }
export type ViewFailure = { error: string }
export type PendingView = { id: string; sessionId: string; callId?: string; title: string; view: ViewNode }
export type ViewAnswer = { id: string; action: string; values: Record<string, unknown> }
/** Stored on the same user message as its readable answer, outside model text. */
export type ViewAnswerMetadata = { owner: typeof VIEW_OWNER; version: 1; answer: ViewAnswer }
export type ViewPresentation = {
  owner: typeof VIEW_OWNER
  viewId?: string
  title: string
  view: ViewNode
  interactive: boolean
  awaitReply: boolean
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
