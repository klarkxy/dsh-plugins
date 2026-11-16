import type { ViewNode } from './contracts.ts'
import type { ViewT } from './ui.tsx'

/** Shared face of the native rich nodes. All interaction remains host-owned:
 * models supply JSON only; components publish bindings into the view scope. */
export type RichNodeProps = {
  node: ViewNode
  lookup(name: string): unknown
  setInput(id: string, value: unknown): void
  t: ViewT
}
