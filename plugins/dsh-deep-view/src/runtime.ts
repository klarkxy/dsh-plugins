// Contract from @deepseek-ai/dsh-client-ui-tool 0.2.2 contract/slots.d.ts:
// 'tool.call.toolview' is a keyed session slot dispatched by wire tool name.
export type ToolArgsView = {
  has(key: string): boolean
  complete(key: string): boolean
  text(key: string): string | undefined
  value(key: string): unknown
}
export type ToolViewBlock = {
  callId: string
  name?: string
  args?: ToolArgsView
  argsRaw?: string
  kind?: 'tool-result'
  meta?: unknown
  isError?: boolean
  error?: { name: string; code: string; reason?: string }
  content?: readonly unknown[]
  subCalls?: readonly ToolViewBlock[]
}
export type ToolViewProps = {
  sessionId: string
  callId: string
  toolName?: string
  phase: 'preparing' | 'start' | 'result'
  block: ToolViewBlock
  t(key: string, params?: Record<string, unknown>): string
}

// Narrow read face of ChatSnapshot / TurnTailOwnerProps in ui-chat 0.2.2.
// useChat is a session standard prop, supplied to the completed-turn slot.
export type ReplySnapshot = {
  order: readonly string[]
  locations: { getTurn(turn: number): readonly string[] }
  nodes: { get(key: string): { kind: string; data?: { root?: ToolViewBlock; source?: unknown; content?: readonly unknown[] } } | undefined }
}
export type ReplyViewProps = {
  sessionId: string
  turn: { turn: number; status: 'open' | 'closed' | 'unknown' }
  useChat<T>(selector: (snapshot: ReplySnapshot) => T, equal?: (left: T, right: T) => boolean): T
  t(key: string, params?: Record<string, unknown>): string
  call(endpoint: string, payload: unknown): Promise<unknown>
}
