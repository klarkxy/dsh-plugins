import {
  BlockAssembler, ReasoningEffortId, createUserMessage,
  type GenerateOptions, type LlmRuntime, type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { producerMessageSource, type ModelRoute } from './contracts.ts'

/** A feature's own saved model. Empty means the host default chat model. */
export interface FeatureModelRoute {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

export type LlmTextCaller = Pick<LlmRuntime, 'prepareCall' | 'resolveCallConfig'>

export interface LlmTextRequest {
  plugin: string
  route: FeatureModelRoute
  system: string
  text: string
  maxTokens: number
  signal: AbortSignal
  sessionId?: string
  /** Auxiliary-call marker adapters may special-case (e.g. disable thinking for titles). */
  purpose?: GenerateOptions['purpose']
  /** Rechecked before the call returns text. A false result discards the output. */
  isCurrent?: () => boolean
}

export interface LlmTextResult {
  text: string
  provider: string
  model: string
  inputTokens?: number
  outputTokens?: number
}

type SessionModelsHost = {
  agents?: { get(sessionId: string): { session?: { requestHeader?: () => { config?: ModelRoute; adapterDefaults?: { reasoningEffort?: unknown } } | undefined } } | undefined }
  sessionProjections?: { stateOf(session: unknown, key: string): { pending?: ModelRoute | null } | undefined }
  agentDefaultModel?: { currentSelection(): ModelRoute | undefined }
}

function routeOf(value: { provider?: unknown; model?: unknown; reasoningEffort?: unknown } | undefined): FeatureModelRoute | undefined {
  if (typeof value?.provider !== 'string' || !value.provider.trim()) return undefined
  if (typeof value.model !== 'string' || !value.model.trim()) return undefined
  const effort = typeof value.reasoningEffort === 'string' ? value.reasoningEffort.trim() : ''
  return effort
    ? { provider: value.provider.trim(), model: value.model.trim(), reasoningEffort: effort }
    : { provider: value.provider.trim(), model: value.model.trim() }
}

/**
 * Plugin selection first; otherwise the live session model, then the host default.
 * Cordis callers must declare agents, sessionProjections and agentDefaultModel
 * in their inject list so the fallback reads use the caller's live services.
 */
export function resolveFeatureModel(host: unknown, saved: FeatureModelRoute | undefined, sessionId?: string): FeatureModelRoute | undefined {
  const explicit = routeOf(saved)
  if (explicit) return explicit
  const face = host as SessionModelsHost | undefined
  if (sessionId && face?.agents && face.sessionProjections) {
    const session = face.agents.get(sessionId)?.session
    if (session) {
      try {
        const pending = face.sessionProjections.stateOf(session, 'modelSelection')?.pending
        const selected = routeOf(pending ?? undefined)
        if (selected) return selected
      } catch { /* fall through to the recorded route */ }
      const header = session.requestHeader?.()
      const recorded = header?.config
      if (recorded) {
        const selected = header?.adapterDefaults?.reasoningEffort === true
          ? { provider: recorded.provider, model: recorded.model }
          : recorded
        const route = routeOf(selected)
        if (route) return route
      }
    }
  }
  return routeOf(face?.agentDefaultModel?.currentSelection())
}

function joinText(assembler: BlockAssembler): string {
  return assembler.blocks()
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map(block => block.text)
    .join('')
}

async function readStream(stream: AsyncIterable<StreamChunk>, signal: AbortSignal, live: () => boolean): Promise<BlockAssembler> {
  const assembler = new BlockAssembler()
  const iterator = stream[Symbol.asyncIterator]()
  try {
    while (live()) {
      if (signal.aborted) break
      const item = await iterator.next()
      if (item.done) break
      assembler.push(item.value)
    }
  } finally {
    try { const closing = iterator.return?.(); if (closing) void closing.catch(() => {}) } catch { /* producer ignored abort */ }
  }
  return assembler
}

/** One native model call. No retry, timeout policy, or provider queue. */
export async function callLlmText(llm: LlmTextCaller, request: LlmTextRequest): Promise<LlmTextResult> {
  request.signal.throwIfAborted()
  const live = () => request.isCurrent?.() !== false && !request.signal.aborted
  if (!live()) throw Object.assign(new Error('调用已取消。'), { name: 'AbortError' })
  const effort = request.route.reasoningEffort?.trim()
  const prepared = await llm.prepareCall({
    provider: request.route.provider,
    model: request.route.model,
    ...(effort ? { reasoningEffort: ReasoningEffortId(effort) } : {}),
    maxTokens: request.maxTokens,
  }, request.signal)
  if (!live()) throw Object.assign(new Error('调用已取消。'), { name: 'AbortError' })
  const options: GenerateOptions = {
    provider: prepared.config.provider,
    model: prepared.config.model,
    ...(prepared.config.reasoningEffort ? { reasoningEffort: prepared.config.reasoningEffort } : {}),
    ...(prepared.config.maxTokens !== undefined ? { maxTokens: Math.min(request.maxTokens, prepared.config.maxTokens) } : { maxTokens: request.maxTokens }),
    ...(prepared.config.temperature !== undefined ? { temperature: prepared.config.temperature } : {}),
    ...(prepared.config.stop ? { stop: [...prepared.config.stop] } : {}),
    system: request.system,
    messages: [createUserMessage({
      source: producerMessageSource(request.plugin),
      content: [{ type: 'text', text: request.text }],
    })],
    signal: request.signal,
    ...(request.purpose ? { purpose: request.purpose } : {}),
    ...(request.sessionId ? { sessionId: request.sessionId as GenerateOptions['sessionId'] } : {}),
  }
  const assembler = await readStream(prepared.stream(options), request.signal, live)
  if (request.signal.aborted || assembler.finish.kind === 'aborted') {
    throw Object.assign(new Error('调用已取消。'), { name: 'AbortError' })
  }
  if (!live()) throw Object.assign(new Error('调用已取消。'), { name: 'AbortError' })
  if (assembler.finish.kind === 'error') {
    const code = assembler.finish.failure.code
    throw Object.assign(new Error(assembler.finish.failure.message || '模型调用失败。'), { code })
  }
  if (assembler.blocks().some(block => block.type === 'tool-call') || assembler.finish.kind === 'tool-calls') {
    throw new Error('这次调用不使用工具。')
  }
  if (assembler.finish.kind !== 'stop') throw new Error('模型调用未完成。')
  return {
    text: joinText(assembler),
    provider: prepared.config.provider,
    model: prepared.config.model,
    ...(assembler.usage ? { inputTokens: assembler.usage.inputTokens, outputTokens: assembler.usage.outputTokens } : {}),
  }
}
