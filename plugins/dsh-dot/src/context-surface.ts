/**
 * Dorothy's current context surface. Adapted from dsh-context v0.82.2's
 * category and token-estimate rules (Apache-2.0, bowenliang123).
 * Only the live surface is kept: no request history or per-step snapshots.
 */
import type { DotContextNode, DotContextParts, DotContextSurface } from './contracts.ts'
import type { RawEvent } from './chat.ts'

const CHARS_PER_TOKEN = 4
const BLOCK_OVERHEAD = 4
const ROLE_OVERHEAD = 4
const TEXT_MAX = 4_000

type Rec = Record<string, unknown>
const rec = (value: unknown): Rec | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Rec : undefined
const num = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
const stringify = (value: unknown): string => { try { return JSON.stringify(value) ?? '' } catch { return '' } }
const clipped = (text: string): { text: string; clipped?: boolean } => text.length > TEXT_MAX ? { text: text.slice(0, TEXT_MAX), clipped: true } : { text }

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(item => {
    const block = rec(item)
    if (!block) return ''
    if ((block.type === 'text' || block.type === 'reasoning') && typeof block.text === 'string') return block.text
    if (block.type === 'tool-call') return [typeof block.name === 'string' ? block.name : 'tool', typeof block.arguments === 'string' ? block.arguments : stringify(block.arguments)].filter(Boolean).join('\n')
    if (block.type === 'image') return '[image]'
    return stringify(block)
  }).filter(Boolean).join('\n\n')
}

/** Upstream's fixed estimate: four characters per token plus block/role overhead. */
function estimateContent(content: unknown, emptyIsZero = false): number {
  if (emptyIsZero && (!Array.isArray(content) || content.length === 0)) return 0
  let tokens = 0
  if (Array.isArray(content)) {
    for (const item of content) {
      const block = rec(item)
      if (!block) { tokens += BLOCK_OVERHEAD; continue }
      if ((block.type === 'text' || block.type === 'reasoning') && typeof block.text === 'string') tokens += Math.ceil(block.text.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD
      else if (block.type === 'tool-call') tokens += Math.ceil((typeof block.name === 'string' ? block.name : '').length / CHARS_PER_TOKEN) + Math.ceil((typeof block.arguments === 'string' ? block.arguments : stringify(block.arguments)).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD
      else tokens += BLOCK_OVERHEAD + Math.ceil(stringify(block).length / CHARS_PER_TOKEN)
    }
  }
  return tokens + ROLE_OVERHEAD
}

const estimateTool = (tool: unknown): number => Math.ceil(stringify(tool).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD
const PROMPT_VAR = /\{\{([a-z][a-z0-9_]*)\}\}/g

function interpolateText(text: string, interpolate: unknown, variables: Readonly<Record<string, unknown>> | undefined): string {
  if (interpolate === false || !variables) return text
  return text.replace(PROMPT_VAR, (match, name: string) => {
    const value = variables[name]
    return typeof value === 'string' ? value : match
  })
}

export interface ContextSurfaceState {
  nodes: DotContextNode[]
  calls: Record<string, string>
}

export interface AssembledPromptInput {
  readonly sections?: readonly unknown[]
  readonly contexts?: readonly unknown[]
  readonly variables?: Readonly<Record<string, unknown>>
  readonly tools?: readonly unknown[]
}

/**
 * Pre-turn surface and heuristic breakdown assembled from the live agent's
 * registered prompt sections, runtime contexts and tool schemas before the
 * segment's first model request commits `system/message` and `request/header`.
 */
export function assembledSurface(assembly: AssembledPromptInput): {
  readonly surface: ContextSurfaceState
  readonly breakdown: { readonly system: number; readonly tools: number; readonly messages: number }
} {
  const nodes: DotContextNode[] = []
  const renderedSections: string[] = []
  const sections = Array.isArray(assembly.sections) ? assembly.sections : []
  sections.forEach((item, index) => {
    const row = rec(item)
    if (typeof row?.text !== 'string') return
    const text = interpolateText(row.text, row.interpolate, assembly.variables)
    if (!text) return
    renderedSections.push(text)
    const name = typeof row.name === 'string' && row.name ? row.name : 'System prompt'
    nodes.push({
      id: 'pre:system:' + String(index),
      seq: 0,
      at: 0,
      category: 'system',
      name,
      tokens: Math.ceil(text.length / CHARS_PER_TOKEN) + ROLE_OVERHEAD,
      ...clipped(text),
    })
  })

  const tools = Array.isArray(assembly.tools) ? assembly.tools : []
  tools.forEach((tool, index) => {
    const row = rec(tool)
    nodes.push({
      id: 'pre:tools:' + String(index),
      seq: 0,
      at: 0,
      category: 'tools',
      tokens: estimateTool(tool),
      ...clipped(stringify(tool)),
      ...(typeof row?.name === 'string' && row.name ? { name: row.name } : {}),
    })
  })

  const renderedContexts: string[] = []
  const contexts = Array.isArray(assembly.contexts) ? assembly.contexts : []
  contexts.forEach((item, index) => {
    const row = rec(item)
    if (typeof row?.text !== 'string') return
    const text = interpolateText(row.text, row.interpolate, assembly.variables)
    if (!text) return
    renderedContexts.push(text)
    const name = typeof row.name === 'string' && row.name ? row.name : 'context'
    nodes.push({
      id: 'pre:inject:' + String(index),
      seq: 0,
      at: 0,
      category: 'inject',
      name,
      tokens: Math.ceil(text.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD + ROLE_OVERHEAD,
      ...clipped(text),
    })
  })

  const joinedSections = renderedSections.join('\n\n')
  const system = joinedSections.length === 0 ? 0 : Math.ceil(joinedSections.length / CHARS_PER_TOKEN) + ROLE_OVERHEAD
  const toolsTokens = tools.length === 0 ? 0 : Math.ceil(stringify(tools).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD
  const contextSnapshot = renderedContexts.length === 0
    ? ''
    : `Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\n${renderedContexts.join('\n\n')}`
  const messages = contextSnapshot.length === 0 ? 0 : Math.ceil(contextSnapshot.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD + ROLE_OVERHEAD

  return {
    surface: { nodes, calls: {} },
    breakdown: { system, tools: toolsTokens, messages },
  }
}

export function mergePreTurnSurface(existing: ContextSurfaceState | undefined, pre: ContextSurfaceState): ContextSurfaceState {
  if (!existing || existing.nodes.length === 0) return pre
  const hasInject = existing.nodes.some(node => node.category === 'inject')
  const base = pre.nodes.filter(node => node.category === 'system' || node.category === 'tools' || (!hasInject && node.category === 'inject'))
  const rest = existing.nodes.filter(node => node.category !== 'system' && node.category !== 'tools')
  return { nodes: [...base, ...rest], calls: { ...existing.calls } }
}

export function cloneContextSurface(state: ContextSurfaceState | undefined): ContextSurfaceState {
  return { nodes: state?.nodes.map(node => ({ ...node })) ?? [], calls: { ...state?.calls } }
}

function addNode(state: ContextSurfaceState, event: RawEvent, message: Rec | undefined, category: DotContextNode['category'], name?: string): void {
  const seq = num(event.seq) ?? 0
  const content = message?.content
  const text = contentText(content).trim()
  state.nodes.push({
    id: 'message:' + String(seq), seq,
    at: num(event.time) ?? 0,
    category,
    tokens: estimateContent(content, category === 'assistant' || category === 'inject'),
    ...clipped(text),
    ...(name ? { name } : {}),
    ...(message?.isError === true ? { status: 'error' as const } : {}),
  })
}

/** Mutates the clone owned by the enclosing incremental scan. */
export function applyContextSurface(state: ContextSurfaceState, event: RawEvent): void {
  const data = rec(event.data) ?? {}
  const seq = num(event.seq) ?? 0
  const at = num(event.time) ?? 0
  switch (event.type) {
    case 'request/header': {
      const tools = Array.isArray(rec(data.header)?.tools) ? rec(data.header)!.tools as unknown[] : []
      state.nodes = state.nodes.filter(node => node.category !== 'tools')
      tools.forEach((tool, index) => {
        const row = rec(tool)
        state.nodes.push({ id: 'tools:' + String(seq) + ':' + String(index), seq, at, category: 'tools', tokens: estimateTool(tool), ...clipped(stringify(tool)), ...(typeof row?.name === 'string' ? { name: row.name } : {}) })
      })
      break
    }
    case 'system/message':
      state.nodes = state.nodes.filter(node => node.category !== 'system')
      addNode(state, event, rec(data.message), 'system', 'System prompt')
      break
    case 'tool/call':
      if (typeof data.callId === 'string' && typeof data.name === 'string') state.calls[data.callId] = data.name
      break
    case 'user/message':
    case 'developer/message': {
      const message = event.type === 'user/message' ? data : rec(data.message)
      const source = rec(message?.source)
      const kind = typeof source?.kind === 'string' ? source.kind : ''
      const form = typeof source?.form === 'string' ? source.form : ''
      const injected = Boolean(kind && kind !== 'user') || Boolean(form)
      const category = event.type === 'developer/message' ? 'inject' : kind === 'skill-invocation' || kind === 'skill-catalog' ? 'skill' : injected ? 'inject' : 'user'
      const name = typeof source?.name === 'string' ? source.name : typeof source?.plugin === 'string' ? source.plugin : kind || form || undefined
      addNode(state, event, message, category, name)
      break
    }
    case 'tool/result': {
      const message = rec(data.message)
      const source = rec(message?.source)
      const callId = typeof source?.callId === 'string' ? source.callId : typeof message?.toolCallId === 'string' ? message.toolCallId : undefined
      let name = callId ? state.calls[callId] : undefined
      const text = contentText(message?.content)
      const skill = (name === 'skill' || name === undefined) ? text.match(/<skill_content\s+name="([^"]+)"/)?.[1] : undefined
      const category = skill !== undefined ? 'skill' : 'tool'
      if (skill !== undefined) name = skill
      addNode(state, event, message, category, name)
      if (callId) delete state.calls[callId]
      break
    }
    case 'assistant/message':
      addNode(state, event, rec(data.message), 'assistant')
      break
    case 'compaction/summary':
    case 'compaction/prune': {
      const shadowed = new Set(Array.isArray(data.shadowedSeqs) ? data.shadowedSeqs.filter(value => typeof value === 'number') : [])
      if (shadowed.size > 0) state.nodes = state.nodes.filter(node => !shadowed.has(node.seq))
      break
    }
    default:
      break
  }
}

export function surfaceParts(nodes: readonly DotContextNode[]): DotContextParts {
  const parts: DotContextParts = { system: 0, tools: 0, user: 0, inject: 0, skill: 0, assistant: 0, tool: 0 }
  for (const node of nodes) parts[node.category] += node.tokens
  return parts
}

export function surfaceView(state: ContextSurfaceState): DotContextSurface {
  return { parts: surfaceParts(state.nodes), nodes: state.nodes }
}

/** Split official messageTokens using the fold's detailed live-surface shares. */
export function officialSurfaceParts(surface: DotContextParts, breakdown: { system: number; tools: number; messages: number } | undefined): DotContextParts {
  const surfaceMessages = surface.user + surface.inject + surface.skill + surface.assistant + surface.tool
  const system = breakdown?.system ?? surface.system
  const tools = breakdown?.tools ?? surface.tools
  const messages = breakdown?.messages ?? surfaceMessages
  const out: DotContextParts = { system, tools, user: 0, inject: 0, skill: 0, assistant: 0, tool: 0 }
  if (surfaceMessages <= 0) return out
  const keys = ['user', 'inject', 'skill', 'assistant', 'tool'] as const
  const fractions: { key: typeof keys[number]; fraction: number }[] = []
  let assigned = 0
  for (const key of keys) {
    const scaled = messages * surface[key] / surfaceMessages
    out[key] = Math.floor(scaled)
    assigned += out[key]
    fractions.push({ key, fraction: scaled - out[key] })
  }
  fractions.sort((a, b) => b.fraction - a.fraction)
  for (let index = 0; index < messages - assigned; index++) out[fractions[index % fractions.length]!.key] += 1
  return out
}
