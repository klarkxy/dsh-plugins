/**
 * Host runtime guards for long-running sessions:
 *
 * 1. Compaction reasoningEffort inheritance (`compactionInheritEffort`):
 *    DSH's built-in `BasicCompactionEngine` omits `reasoningEffort` when
 *    calling `ctx.llm.stream` to summarize a session. When the active
 *    conversation uses a non-default effort (such as `max`), the adapter falls
 *    back to its default (`high`) and invalidates the 30K+ token KV prefix
 *    cache. Wrapping `compaction.summarize` in a per-call scope preserves the
 *    conversation's effective `reasoningEffort` when summarizing on the same
 *    `(provider, model)` after checking `llm.resolveModelInfo` capabilities,
 *    without mutating shared `llm` state across concurrent sessions.
 *
 * 2. Silent-turn progress note (`progressNoteMinutes` / `progressNoteMinSteps`):
 *    When a top-level session turn runs for several minutes and multiple
 *    tool-only steps without emitting visible prose, attaches a deferred
 *    context notice (`exec.deferContext`) asking the model to include one or
 *    two short progress sentences in the user's language alongside its next
 *    tool call without prematurely ending the turn.
 *
 * 3. SSE heartbeat stall guard (`streamStallSeconds` / `streamFirstContentSeconds`):
 *    Wraps `globalThis.fetch` only for `POST .../messages` event-stream calls.
 *    Heartbeats (`: keep-alive`, `ping`, `message_start`) reset DSH's native
 *    idle socket timer even when token generation stalls; counting actual
 *    content events aborts stalled streams with `STREAM_STALL` so `dsh-llm-retry`
 *    recovers automatically.
 *
 * Adapted from `herenfor/dsh-runtime-tuning` (MIT License).
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type ContextFormed, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { PluginLogger } from '@klarkxy/dsh-plugin-kit/logger'
import {
  DEFAULT_PROGRESS_NOTE_MIN_STEPS,
  DEFAULT_PROGRESS_NOTE_MINUTES,
  DEFAULT_STREAM_FIRST_CONTENT_SECONDS,
  DEFAULT_STREAM_STALL_SECONDS,
  type ResolvedConfig,
} from './contracts.ts'

export const PROGRESS_NOTE_KIND = 'dsh-progress-note'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dsh-progress-note': { kind: 'dsh-progress-note' } & ContextFormed
  }
}

export interface ModelTarget {
  readonly provider: string
  readonly model: string
}

export interface CompactionPolicyRule {
  readonly provider?: string | undefined
  readonly model?: string | undefined
  readonly summarizationProvider?: string | undefined
  readonly summarizationModel?: string | undefined
  readonly summarizationReasoningEffort?: string | undefined
  readonly inheritReasoningEffort?: boolean | undefined
}

export interface CompactionConfigLike {
  readonly summarizationProvider?: string | undefined
  readonly summarizationModel?: string | undefined
  readonly summarizationReasoningEffort?: string | undefined
  readonly inheritReasoningEffort?: boolean | undefined
  readonly modelPolicies?: readonly CompactionPolicyRule[] | undefined
}

export interface CompactionAgentLike {
  readonly session?: {
    requestHeader?(): {
      readonly config?: {
        readonly provider?: unknown | undefined
        readonly model?: unknown | undefined
        readonly reasoningEffort?: unknown | undefined
      } | undefined
    } | undefined
  } | undefined
  readonly options?: {
    readonly provider?: unknown | undefined
    readonly model?: unknown | undefined
    readonly reasoningEffort?: unknown | undefined
  } | undefined
  readonly model?: {
    current?(): {
      readonly provider?: unknown | undefined
      readonly model?: unknown | undefined
      readonly reasoningEffort?: unknown | undefined
    } | undefined
  } | undefined
}

export interface LlmModelInfoLike {
  readonly reasoning?: {
    readonly efforts?: readonly (string | { readonly id?: string | undefined })[] | undefined
  } | null | undefined
}

export interface LlmServiceLike {
  stream(options: Record<string, unknown>): unknown
  resolveModelInfo?(provider: string, model: string, signal?: AbortSignal | undefined): Promise<LlmModelInfoLike | undefined>
}

export interface CompactionEngineLike {
  ctx?: { llm?: LlmServiceLike | undefined } | undefined
  config?: CompactionConfigLike | undefined
  summarize(input: unknown, agent: CompactionAgentLike | undefined, signal?: AbortSignal | undefined): Promise<unknown>
}

export interface EffortResolution {
  readonly reasoningEffort: string | undefined
  readonly source: string
  readonly summaryTarget?: ModelTarget | undefined
  readonly conversationTarget?: ModelTarget | undefined
  readonly candidate?: string | undefined
  readonly requestedFrom?: string | undefined
  readonly reasonDetail?: string | undefined
  readonly supportedEfforts?: readonly string[] | undefined
  readonly modelInfoUnavailable?: boolean | undefined
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

export function normalizeTarget(provider: unknown, model: unknown): ModelTarget | undefined {
  const cleanProvider = nonEmptyString(provider)
  const cleanModel = nonEmptyString(model)
  if (cleanProvider === undefined || cleanModel === undefined) return undefined
  return { provider: cleanProvider, model: cleanModel }
}

export function sameTarget(left: ModelTarget | undefined, right: ModelTarget | undefined): boolean {
  return Boolean(left && right && left.provider === right.provider && left.model === right.model)
}

export function resolvePolicySummaryTarget(
  config: CompactionConfigLike | undefined,
  conversationTarget: ModelTarget | undefined,
): { summarizationProvider: string; summarizationModel: string; policyRule?: CompactionPolicyRule | undefined } {
  const policyRule = conversationTarget && Array.isArray(config?.modelPolicies)
    ? config.modelPolicies.find(
      policy => policy.provider === conversationTarget.provider && policy.model === conversationTarget.model,
    )
    : undefined
  return {
    summarizationProvider: policyRule?.summarizationProvider ?? config?.summarizationProvider ?? '',
    summarizationModel: policyRule?.summarizationModel ?? config?.summarizationModel ?? '',
    ...(policyRule === undefined ? {} : { policyRule }),
  }
}

/**
 * Resolve the `reasoningEffort` to attach to a single compaction summarization call.
 * Priority: explicit override -> `inheritReasoningEffort` gate -> same `(provider, model)`
 * check -> latest `requestHeader` (or pre-header `agent.options` / `agent.model.current`) ->
 * `llm.resolveModelInfo` capability check.
 */
export async function resolveSummaryEffort(params: {
  readonly agent?: CompactionAgentLike | undefined
  readonly llm?: Pick<LlmServiceLike, 'resolveModelInfo'> | undefined
  readonly policy?: { readonly summarizationProvider?: string | undefined; readonly summarizationModel?: string | undefined; readonly policyRule?: CompactionPolicyRule | undefined } | undefined
  readonly inheritReasoningEffort?: boolean | undefined
  readonly explicitReasoningEffort?: string | undefined
  readonly latestHeader?: { readonly provider?: unknown | undefined; readonly model?: unknown | undefined; readonly reasoningEffort?: unknown | undefined } | undefined
  readonly signal?: AbortSignal | undefined
}): Promise<EffortResolution> {
  const latestConfig = params.latestHeader ?? params.agent?.session?.requestHeader?.()?.config
  const latest = normalizeTarget(latestConfig?.provider, latestConfig?.model)
  const agentTarget = normalizeTarget(params.agent?.options?.provider, params.agent?.options?.model)
  const conversationTarget = latest ?? agentTarget

  const configured = normalizeTarget(params.policy?.summarizationProvider, params.policy?.summarizationModel)
  const summaryTarget = configured ?? latest ?? agentTarget

  const rule = params.policy?.policyRule
  const explicitEffort = nonEmptyString(rule?.summarizationReasoningEffort) ?? nonEmptyString(params.explicitReasoningEffort)
  const inheritEnabled = rule?.inheritReasoningEffort ?? params.inheritReasoningEffort ?? true

  if (summaryTarget === undefined) {
    return { reasoningEffort: undefined, source: 'no-summary-target', summaryTarget, conversationTarget }
  }

  let candidate: string | undefined
  let candidateSource: string
  if (explicitEffort !== undefined) {
    candidate = explicitEffort
    candidateSource = nonEmptyString(rule?.summarizationReasoningEffort) !== undefined ? 'explicit-policy' : 'explicit'
  } else {
    if (!inheritEnabled) {
      return { reasoningEffort: undefined, source: 'inherit-disabled', summaryTarget, conversationTarget }
    }
    if (!sameTarget(summaryTarget, conversationTarget)) {
      return { reasoningEffort: undefined, source: 'independent-model', summaryTarget, conversationTarget }
    }
    if (latest !== undefined) {
      candidate = nonEmptyString(latestConfig?.reasoningEffort)
      candidateSource = 'request-header'
      if (candidate === undefined) {
        return { reasoningEffort: undefined, source: 'header-without-effort', summaryTarget, conversationTarget }
      }
    } else {
      const optionsEffort = nonEmptyString(params.agent?.options?.reasoningEffort)
      const selection = typeof params.agent?.model?.current === 'function' ? params.agent.model.current() : undefined
      const selectionTarget = normalizeTarget(selection?.provider, selection?.model)
      const selectionEffort = sameTarget(selectionTarget, summaryTarget) ? nonEmptyString(selection?.reasoningEffort) : undefined
      candidate = optionsEffort ?? selectionEffort
      candidateSource = optionsEffort !== undefined ? 'agent-options' : 'model-selection'
      if (candidate === undefined) {
        return { reasoningEffort: undefined, source: 'no-conversation-effort', summaryTarget, conversationTarget }
      }
    }
  }

  if (typeof params.llm?.resolveModelInfo === 'function') {
    let info: LlmModelInfoLike | undefined
    try {
      info = await params.llm.resolveModelInfo(summaryTarget.provider, summaryTarget.model, params.signal)
    } catch (error) {
      if (params.signal?.aborted) throw error
      return {
        reasoningEffort: candidate,
        source: candidateSource,
        summaryTarget,
        conversationTarget,
        modelInfoUnavailable: true,
      }
    }
    if (!info || typeof info !== 'object') {
      return {
        reasoningEffort: candidate,
        source: candidateSource,
        summaryTarget,
        conversationTarget,
        modelInfoUnavailable: true,
      }
    }
    const rawEfforts = info.reasoning?.efforts
    const supportedEfforts = Array.isArray(rawEfforts)
      ? rawEfforts
          .map(entry => (typeof entry === 'string' ? entry : entry?.id))
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      : []
    if (!supportedEfforts.includes(candidate)) {
      return {
        reasoningEffort: undefined,
        source: 'unsupported-effort',
        requestedFrom: candidateSource,
        reasonDetail: info.reasoning == null ? 'no-reasoning-metadata' : 'effort-not-listed',
        candidate,
        supportedEfforts,
        summaryTarget,
        conversationTarget,
      }
    }
  }

  return {
    reasoningEffort: candidate,
    source: candidateSource,
    summaryTarget,
    conversationTarget,
  }
}

function canProxyOverride(target: unknown, prop: PropertyKey): target is object {
  if (target === null || typeof target !== 'object') return false
  const desc = Object.getOwnPropertyDescriptor(target, prop)
  return desc === undefined || desc.configurable === true || desc.writable === true
}

export function shouldAttachCompactionEffort(options: unknown): options is Record<string, unknown> {
  if (options === null || typeof options !== 'object') return false
  const rec = options as Record<string, unknown>
  return rec.reasoningEffort === undefined && (rec.purpose === undefined || rec.purpose === 'compaction')
}

function wrapLlmForCall(baseLlm: LlmServiceLike, reasoningEffort: string): LlmServiceLike {
  const wrappedStream = (options: Record<string, unknown>) =>
    baseLlm.stream(shouldAttachCompactionEffort(options) ? { ...options, reasoningEffort } : options)
  if (canProxyOverride(baseLlm, 'stream')) {
    return new Proxy(baseLlm, {
      get(target, prop) {
        if (prop === 'stream') return wrappedStream
        const value = Reflect.get(target, prop, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }
  // The canProxyOverride guard narrows the else branch away from object, so
  // the spread needs an explicit object type even though it is the fallback.
  return { ...(baseLlm as LlmServiceLike), stream: wrappedStream }
}

function wrapCtxForCall(baseCtx: Record<string, unknown>, scopedLlm: LlmServiceLike): Record<string, unknown> {
  if (canProxyOverride(baseCtx, 'llm')) {
    return new Proxy(baseCtx, {
      get(target, prop) {
        if (prop === 'llm') return scopedLlm
        const value = Reflect.get(target, prop, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }
  return { ...(baseCtx as Record<string, unknown>), llm: scopedLlm }
}

/** Build a single-call receiver around `engine` so concurrent compactions never share state. */
export function createScopedSummarizeReceiver<T extends CompactionEngineLike>(engine: T, reasoningEffort: string | undefined): T {
  if (reasoningEffort === undefined || !engine.ctx?.llm) return engine
  const scopedLlm = wrapLlmForCall(engine.ctx.llm, reasoningEffort)
  const scopedCtx = wrapCtxForCall(engine.ctx as Record<string, unknown>, scopedLlm)
  return Object.create(engine, {
    ctx: { value: scopedCtx, writable: true, enumerable: true, configurable: true },
  }) as T
}

export function installCompactionEffortBridge(
  compaction: CompactionEngineLike,
  llm: LlmServiceLike,
  getConfig: () => Pick<ResolvedConfig, 'compactionInheritEffort' | 'compactionReasoningEffort'>,
  logger?: PluginLogger | undefined,
): () => void {
  const originalSummarize = compaction.summarize
  const originalStream = llm.stream
  const activeEffort = new AsyncLocalStorage<string>()

  const streamWrapper = function (this: unknown, options: Record<string, unknown>) {
    const scopedEffort = activeEffort.getStore()
    if (scopedEffort !== undefined && shouldAttachCompactionEffort(options)) {
      return originalStream.call(this ?? llm, { ...options, reasoningEffort: scopedEffort })
    }
    return originalStream.call(this ?? llm, options)
  }

  let patchedLlm = false
  try {
    llm.stream = streamWrapper
    patchedLlm = true
  } catch {
    /* read-only llm facade: receiver-scoped `this.ctx.llm` still covers BasicCompactionEngine */
  }

  const summarizeWrapper = async function (
    this: CompactionEngineLike,
    input: unknown,
    agent: CompactionAgentLike | undefined,
    signal?: AbortSignal | undefined,
  ): Promise<unknown> {
    const receiver = this ?? compaction
    const cfg = getConfig()
    let resolution: EffortResolution
    try {
      const latestHeader = agent?.session?.requestHeader?.()?.config
      const conversationTarget =
        normalizeTarget(latestHeader?.provider, latestHeader?.model) ??
        normalizeTarget(agent?.options?.provider, agent?.options?.model)
      const engineConfig = receiver.config
      const policy = resolvePolicySummaryTarget(engineConfig, conversationTarget)
      resolution = await resolveSummaryEffort({
        agent,
        llm: receiver.ctx?.llm ?? llm,
        policy,
        inheritReasoningEffort: engineConfig?.inheritReasoningEffort ?? cfg.compactionInheritEffort,
        explicitReasoningEffort: engineConfig?.summarizationReasoningEffort ?? cfg.compactionReasoningEffort,
        latestHeader,
        signal,
      })
    } catch (error) {
      if (signal?.aborted) throw error
      logger?.warn('compaction-effort.resolve-failed', 'Compaction effort resolution failed; falling back to stock summarize.', error)
      resolution = { reasoningEffort: undefined, source: 'resolve-error' }
    }

    if (resolution.reasoningEffort === undefined) {
      logger?.debug('compaction-effort.passthrough', 'Compaction summarize running without effort override.', {
        source: resolution.source,
        provider: resolution.summaryTarget?.provider ?? null,
        model: resolution.summaryTarget?.model ?? null,
        ...(resolution.candidate === undefined ? {} : { droppedCandidate: resolution.candidate }),
      })
      return await originalSummarize.call(receiver, input, agent, signal)
    }

    logger?.debug('compaction-effort.applied', 'Compaction summarize inheriting effective reasoningEffort.', {
      source: resolution.source,
      reasoningEffort: resolution.reasoningEffort,
      provider: resolution.summaryTarget?.provider ?? null,
      model: resolution.summaryTarget?.model ?? null,
    })
    const scopedReceiver = receiver.ctx?.llm
      ? createScopedSummarizeReceiver(receiver, resolution.reasoningEffort)
      : receiver
    const run = () => originalSummarize.call(scopedReceiver, input, agent, signal)
    // Avoid double-wrapping when `scopedReceiver.ctx.llm` already wraps `llm.stream`.
    return receiver.ctx?.llm ? await run() : await activeEffort.run(resolution.reasoningEffort, run)
  }

  compaction.summarize = summarizeWrapper
  return () => {
    if (compaction.summarize === summarizeWrapper) compaction.summarize = originalSummarize
    if (patchedLlm && llm.stream === streamWrapper) llm.stream = originalStream
  }
}

/* -------------------------------------------------------------------------- */
/* Progress Note                                                              */
/* -------------------------------------------------------------------------- */

export function progressNoteText(minutes: number): string {
  return `The user has not seen any message from you for about ${minutes} minutes while you work. ` +
    'In your next reply, write one or two short sentences for the user, in their language, on what you have found or done so far and what you are doing next, ' +
    'and send them together with your next tool calls. Keep working afterwards: a reply without tool calls ends the turn, so send one only when the task is finished. ' +
    'Do not mention this note.'
}

export function buildProgressNoteMessage(minutes: number): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: progressNoteText(minutes) }],
    source: { kind: PROGRESS_NOTE_KIND, form: 'notice', summary: 'progress note' },
  })
}

export function isTopLevelSession(session: unknown): boolean {
  const header = (session as { header?: { delegationDepth?: unknown | undefined; origin?: unknown | undefined } | undefined } | undefined)?.header
  if (header?.origin === 'subagent') return false
  const depth = header?.delegationDepth
  return depth === undefined || depth === 0
}

function hasVisibleText(content: unknown): boolean {
  if (!Array.isArray(content)) return false
  return content.some(block => {
    const rec = block as { type?: unknown | undefined; text?: unknown | undefined } | undefined
    return rec?.type === 'text' && typeof rec.text === 'string' && rec.text.trim() !== ''
  })
}

function hasToolCalls(content: unknown): boolean {
  if (!Array.isArray(content)) return false
  return content.some(block => (block as { type?: unknown | undefined } | undefined)?.type === 'tool-call')
}

interface SessionProgressState {
  lastVisible: number
  steps: number
  notedAt: number
  awaiting: boolean
}

export interface ProgressTrackerOptions {
  readonly now?: (() => number) | undefined
  readonly onReplyAfterNote?: ((sessionId: string, reply: 'text-with-tools' | 'text-only' | 'tools-only') => void) | undefined
}

export function createProgressTracker(
  getConfig: () => { readonly minutes: number; readonly minSteps: number },
  options: ProgressTrackerOptions = {},
) {
  const now = options.now ?? Date.now
  const sessions = new Map<string, SessionProgressState>()

  return {
    onEvent(sessionId: string | undefined, event: Pick<SessionEvent, 'type'> & { time?: unknown | undefined; data?: unknown | undefined }): void {
      if (typeof sessionId !== 'string' || sessionId === '') return
      const time = typeof event.time === 'number' ? event.time : now()
      if (event.type === 'turn/start') {
        sessions.set(sessionId, { lastVisible: time, steps: 0, notedAt: -Infinity, awaiting: false })
        return
      }
      const state = sessions.get(sessionId)
      if (state === undefined) return
      if (event.type === 'turn/end') {
        sessions.delete(sessionId)
        return
      }
      if (event.type !== 'assistant/message') return
      const content = (event.data as { message?: { content?: unknown | undefined } | undefined } | undefined)?.message?.content
      const tools = hasToolCalls(content)
      const text = hasVisibleText(content)
      if (state.awaiting) {
        state.awaiting = false
        options.onReplyAfterNote?.(sessionId, text ? (tools ? 'text-with-tools' : 'text-only') : 'tools-only')
      }
      if (text) {
        state.lastVisible = time
        state.steps = 0
      } else if (tools) {
        state.steps += 1
      }
    },
    due(sessionId: string): number | undefined {
      const state = sessions.get(sessionId)
      if (state === undefined || state.awaiting) return undefined
      const cfg = getConfig()
      if (!(cfg.minutes > 0)) return undefined
      const current = now()
      const thresholdMs = cfg.minutes * 60_000
      if (current - state.lastVisible < thresholdMs || state.steps < cfg.minSteps || current - state.notedAt < thresholdMs) {
        return undefined
      }
      state.notedAt = current
      state.awaiting = true
      return Math.max(1, Math.round((current - state.lastVisible) / 60_000))
    },
    clear(): void {
      sessions.clear()
    },
    size(): number {
      return sessions.size
    },
  }
}

/* -------------------------------------------------------------------------- */
/* Stream Stall Guard                                                         */
/* -------------------------------------------------------------------------- */

const IDLE_SSE_TYPES = new Set(['ping', 'message_start'])

export class StreamStallError extends Error {
  readonly code = 'STREAM_STALL'
  readonly phase: 'first-content' | 'stalled'

  constructor(phase: 'first-content' | 'stalled', seconds: number) {
    super(
      phase === 'first-content'
        ? `model stream sent no content within ${seconds}s (only heartbeats)`
        : `model stream stalled: no new content for ${seconds}s (only heartbeats)`,
    )
    this.name = 'StreamStallError'
    this.phase = phase
  }
}

function headerOf(headers: HeadersInit | undefined, key: string): string {
  if (!headers) return ''
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(key) ?? ''
  if (Array.isArray(headers)) {
    const found = headers.find(([k]) => k.toLowerCase() === key)
    return found ? String(found[1]) : ''
  }
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === key) return String(v)
  }
  return ''
}

export function isModelStream(input: RequestInfo | URL, init?: RequestInit | undefined): boolean {
  if (typeof input !== 'string' && !(input instanceof URL)) return false
  if (String(init?.method ?? 'GET').toUpperCase() !== 'POST') return false
  let pathname: string
  try {
    pathname = new URL(String(input)).pathname
  } catch {
    return false
  }
  return pathname.endsWith('/messages') && headerOf(init?.headers, 'accept').includes('text/event-stream')
}

export function createSseCounter(onEvent: (type: string) => void): (chunk: Uint8Array) => void {
  const decoder = new TextDecoder()
  let buffer = ''
  return (chunk: Uint8Array) => {
    buffer += decoder.decode(chunk, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      onEvent(/"type"\s*:\s*"([A-Za-z_]+)"/.exec(line)?.[1] ?? 'unknown')
    }
  }
}

export interface StreamStallConfig {
  readonly stallSeconds: number
  readonly firstContentSeconds?: number | undefined
}

export function wrapStreamStallFetch(
  original: typeof fetch,
  config: StreamStallConfig,
  options: {
    readonly active?: (() => boolean) | undefined
    readonly onStall?: ((detail: { path: string; phase: 'first-content' | 'stalled'; seconds: number; events: number }) => void) | undefined
  } = {},
): typeof fetch {
  const isActive = options.active ?? (() => true)
  const firstContentSeconds = config.firstContentSeconds ?? DEFAULT_STREAM_FIRST_CONTENT_SECONDS
  return async function fetchWithStallGuard(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (!isActive() || !isModelStream(input, init)) {
      return init === undefined ? original(input) : original(input, init)
    }
    const stop = new AbortController()
    const signal = init?.signal ? AbortSignal.any([init.signal, stop.signal]) : stop.signal
    const response = await original(input, { ...init, signal })
    if (!response.ok || response.body === null || !headerOf(response.headers, 'content-type').includes('text/event-stream')) {
      return response
    }

    const path = (() => {
      try { return new URL(String(input)).pathname } catch { return '' }
    })()
    let timer: ReturnType<typeof setTimeout> | undefined
    let events = 0
    let out: TransformStreamDefaultController<Uint8Array> | undefined

    const clear = () => {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
    }
    const arm = (seconds: number, phase: 'first-content' | 'stalled') => {
      clear()
      if (!(seconds > 0)) return
      timer = setTimeout(() => {
        const error = new StreamStallError(phase, seconds)
        options.onStall?.({ path, phase, seconds, events })
        try { out?.error(error) } catch { /* stream may already be closed */ }
        stop.abort(error)
      }, seconds * 1_000)
      timer.unref?.()
    }
    const count = createSseCounter(type => {
      events += 1
      if (type === 'message_stop') clear()
      else if (!IDLE_SSE_TYPES.has(type)) arm(config.stallSeconds, 'stalled')
    })
    signal.addEventListener('abort', clear, { once: true })
    arm(firstContentSeconds, 'first-content')
    // The WHATWG Transformer allows `cancel`, but lib.dom typings omit it, so
    // widen the literal once instead of dropping stall cleanup on cancel.
    const transformer = {
      start(controller: TransformStreamDefaultController<Uint8Array>) { out = controller },
      transform(chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) {
        controller.enqueue(chunk)
        count(chunk)
      },
      flush() { clear() },
      cancel() { clear() },
    } as Transformer<Uint8Array, Uint8Array>
    const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>(transformer))
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
  }
}

/* -------------------------------------------------------------------------- */
/* Host Installation                                                          */
/* -------------------------------------------------------------------------- */

export function installRuntimeTuning(
  ctx: Context,
  resolved: Partial<Pick<
    ResolvedConfig,
    | 'compactionInheritEffort'
    | 'compactionReasoningEffort'
    | 'progressNoteMinutes'
    | 'progressNoteMinSteps'
    | 'streamStallSeconds'
    | 'streamFirstContentSeconds'
  >>,
  logger?: PluginLogger | undefined,
): void {
  const compactionInheritEffort = resolved.compactionInheritEffort ?? true
  const compactionReasoningEffort = nonEmptyString(resolved.compactionReasoningEffort)
  const progressNoteMinutes = resolved.progressNoteMinutes ?? DEFAULT_PROGRESS_NOTE_MINUTES
  const progressNoteMinSteps = resolved.progressNoteMinSteps ?? DEFAULT_PROGRESS_NOTE_MIN_STEPS
  const streamStallSeconds = resolved.streamStallSeconds ?? DEFAULT_STREAM_STALL_SECONDS
  const streamFirstContentSeconds = resolved.streamFirstContentSeconds ?? DEFAULT_STREAM_FIRST_CONTENT_SECONDS

  if (compactionInheritEffort || compactionReasoningEffort !== undefined) {
    ctx.inject(['compaction', 'llm'], inner => {
      const scoped = inner as unknown as { compaction?: CompactionEngineLike | undefined; llm?: LlmServiceLike | undefined }
      if (typeof scoped.compaction?.summarize !== 'function' || typeof scoped.llm?.stream !== 'function') return
      const compaction = scoped.compaction
      const llm = scoped.llm
      inner.effect(
        () => installCompactionEffortBridge(
          compaction,
          llm,
          () => ({ compactionInheritEffort, compactionReasoningEffort: compactionReasoningEffort ?? '' }),
          logger,
        ),
        'session-manager.compaction-effort',
      )
    })
  }

  const hostEvents = ctx as unknown as {
    on?(event: string, listener: (...args: any[]) => unknown): () => void
  }

  if (progressNoteMinutes > 0 && typeof hostEvents.on === 'function') {
    const tracker = createProgressTracker(
      () => ({ minutes: progressNoteMinutes, minSteps: progressNoteMinSteps }),
      {
        onReplyAfterNote: (sessionId, reply) => {
          logger?.debug('progress-note.reply', 'Observed first assistant step after progress note.', { sessionId, reply })
        },
      },
    )
    ctx.effect(() => {
      const offEvent = hostEvents.on!('session/event', (session: { id?: string | undefined; header?: unknown | undefined } | undefined, event: SessionEvent) => {
        try {
          if (isTopLevelSession(session)) tracker.onEvent(session?.id, event)
        } catch (error) {
          logger?.debug('progress-note.track-failed', 'Ignoring progress-note tracking error.', {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })
      const offExec = hostEvents.on!('tools/execute', async (
        exec: {
          name?: string | undefined
          agent?: { session?: { id?: string | undefined; header?: unknown | undefined } | undefined } | undefined
          deferContext?: ((message: UserMessage) => void) | undefined
        },
        next: () => Promise<unknown>,
      ) => {
        const result = await next()
        try {
          const session = exec.agent?.session
          if (!session?.id || !isTopLevelSession(session) || typeof exec.deferContext !== 'function') return result
          const silentMinutes = tracker.due(session.id)
          if (silentMinutes === undefined) return result
          exec.deferContext(buildProgressNoteMessage(silentMinutes))
          logger?.info('progress-note.queued', 'Queued silent-turn progress note for top-level session.', {
            sessionId: session.id,
            minutes: silentMinutes,
          })
        } catch (error) {
          logger?.debug('progress-note.defer-failed', 'Could not attach progress note to tool execution.', {
            tool: exec?.name ?? null,
            error: error instanceof Error ? error.message : String(error),
          })
        }
        return result
      })
      return () => {
        offEvent?.()
        offExec?.()
        tracker.clear()
      }
    }, 'session-manager.progress-note')
  }

  if ((streamStallSeconds > 0 || streamFirstContentSeconds > 0) && typeof globalThis.fetch === 'function') {
    ctx.effect(() => {
      let active = true
      const original = globalThis.fetch
      const wrapped = wrapStreamStallFetch(
        original,
        { stallSeconds: streamStallSeconds, firstContentSeconds: streamFirstContentSeconds },
        {
          active: () => active,
          onStall: detail => {
            logger?.warn('stream-stall.aborted', 'Aborted stalled model event stream so host retry can recover.', detail)
          },
        },
      )
      globalThis.fetch = wrapped
      return () => {
        active = false
        if (globalThis.fetch === wrapped) globalThis.fetch = original
      }
    }, 'session-manager.stream-stall')
  }
}
