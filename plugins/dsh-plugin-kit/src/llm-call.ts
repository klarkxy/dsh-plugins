import {
  BlockAssembler, ReasoningEffortId, createUserMessage,
  type GenerateOptions, type LlmRuntime, type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { getAuxiliaryModel, producerMessageSource, type ModelRoute } from './contracts.ts'
import { buildAuxiliaryUserText } from './auxiliary-context.ts'
import type { PluginLogger } from './log-shared.ts'

/** A feature's own saved model. Empty means the host default chat model. */
export interface FeatureModelRoute {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

export type LlmTextCaller = Pick<LlmRuntime, 'prepareCall' | 'resolveCallConfig'>

export interface LlmTextRequest {
  plugin: string
  /** Optional feature id, stamped on the context envelope for attribution. */
  feature?: string
  /**
   * Stable material rebuilt from current facts (session events, durable
   * records). Packed before the live text so provider-side caching reuses
   * the prefix; never model outputs or approval history. Strings or
   * pre-ordered segments.
   */
  context?: string | readonly string[]
  route: FeatureModelRoute
  system: string
  text: string
  /** Omit to use the selected model's normal output settings. */
  maxTokens?: number
  signal: AbortSignal
  /** The real session id for host attribution; never a feature-scoped alias. */
  sessionId?: string
  /** Auxiliary-call marker adapters may special-case (e.g. disable thinking for titles). */
  purpose?: GenerateOptions['purpose']
  /** Pure control selection using the exact model captured for this call. */
  configure?: Parameters<LlmRuntime['prepareCall']>[2]
  /** Rechecked before the call returns text. A false result discards the output. */
  isCurrent?: () => boolean
  /** Optional diagnostic logger for timing, token usage, and failure telemetry. */
  logger?: PluginLogger
}

export interface LlmTextResult {
  text: string
  provider: string
  model: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
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
 * Plugin selection first; then the shared auxiliary default (when any
 * participant retains it); otherwise the live session model, then the host
 * default. Cordis callers must declare agents, sessionProjections and
 * agentDefaultModel in their inject list so the fallback reads use the
 * caller's live services.
 */
export function resolveFeatureModel(host: unknown, saved: FeatureModelRoute | undefined, sessionId?: string): FeatureModelRoute | undefined {
  const explicit = routeOf(saved)
  if (explicit) return explicit
  const auxiliary = getAuxiliaryModel(host)
  if (auxiliary) return auxiliary
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
    // Settlement includes producer cleanup; never leave a detached return()
    // running after the caller has released its lifecycle ownership.
    await iterator.return?.()
  }
  return assembler
}

/** One native model call. No retry, timeout policy, or provider queue. */
export async function callLlmText(llm: LlmTextCaller, request: LlmTextRequest): Promise<LlmTextResult> {
  request.signal.throwIfAborted()
  const live = () => request.isCurrent?.() !== false && !request.signal.aborted
  if (!live()) throw Object.assign(new Error('调用已取消。'), { name: 'AbortError' })
  const started = Date.now()
  const logBase = {
    plugin: request.plugin,
    feature: request.feature ?? null,
    provider: request.route.provider,
    model: request.route.model,
    purpose: request.purpose ?? null,
    sessionId: request.sessionId ?? null,
  }
  request.logger?.debug('llm.call.started', 'Auxiliary model call started.', logBase)
  try {
  const effort = request.route.reasoningEffort?.trim()
  const prepared = await llm.prepareCall({
    provider: request.route.provider,
    model: request.route.model,
    ...(effort ? { reasoningEffort: ReasoningEffortId(effort) } : {}),
    ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
  }, request.signal, request.configure)
  if (!live()) throw Object.assign(new Error('调用已取消。'), { name: 'AbortError' })
  const maxTokens = request.maxTokens === undefined
    ? prepared.config.maxTokens
    : Math.min(request.maxTokens, prepared.config.maxTokens ?? request.maxTokens)
  const options: GenerateOptions = {
    provider: prepared.config.provider,
    model: prepared.config.model,
    ...(prepared.config.reasoningEffort ? { reasoningEffort: prepared.config.reasoningEffort } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(prepared.config.temperature !== undefined ? { temperature: prepared.config.temperature } : {}),
    ...(prepared.config.stop ? { stop: [...prepared.config.stop] } : {}),
    system: request.system,
    messages: [createUserMessage({
      source: producerMessageSource(request.plugin),
      content: [{ type: 'text', text: buildAuxiliaryUserText(request) }],
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
  // Every usable host usage field passes through; absent fields stay absent
  // (the caller's accounting must not see invented zeros).
  const usage = assembler.usage
  request.logger?.debug('llm.call.completed', 'Auxiliary model call completed.', {
    ...logBase,
    provider: prepared.config.provider,
    model: prepared.config.model,
    durationMs: Date.now() - started,
    ...(usage?.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
    ...(usage?.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
    ...(usage?.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
  })
  return {
    text: joinText(assembler),
    provider: prepared.config.provider,
    model: prepared.config.model,
    ...(usage ? {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      ...(usage.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
      ...(usage.cacheReadTokens !== undefined ? { cacheReadTokens: usage.cacheReadTokens } : {}),
      ...(usage.cacheWriteTokens !== undefined ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
      ...(usage.reasoningTokens !== undefined ? { reasoningTokens: usage.reasoningTokens } : {}),
    } : {}),
  }
  } catch (error) {
    const durationMs = Date.now() - started
    const aborted = request.signal.aborted || (error instanceof Error && error.name === 'AbortError')
    if (aborted) {
      request.logger?.debug('llm.call.cancelled', 'Auxiliary model call cancelled.', { ...logBase, durationMs })
    } else {
      request.logger?.warn('llm.call.failed', 'Auxiliary model call failed.', error, { ...logBase, durationMs })
    }
    throw error
  }
}
