/**
 * dot's context page: folds dot's session log for what the official token
 * projections leave out (compactions, the routed model and its output
 * reservation) and joins it with those projections into one view.
 */
import type { RawEvent } from './chat.ts'
import { COMPACTION_POLICY, ROLLOVER_POLICY, type DotContextUsage, type DotContextView, type DotUsageOffset } from './contracts.ts'
import { applyContextSurface, cloneContextSurface, mergePreTurnSurface, surfaceView, type ContextSurfaceState } from './context-surface.ts'

/** What an incremental scan of dot's log has seen up to `seq`. */
export interface ContextScan {
  readonly seq: number
  readonly compactions: number
  readonly lastCompactionAt?: number
  readonly provider?: string
  readonly model?: string
  /** Output tokens the latest request reserved. */
  readonly maxTokens?: number
  /** Current prompt items; no historical snapshots are retained. */
  readonly surface?: ContextSurfaceState
}

export const EMPTY_SCAN: ContextScan = { seq: 0, compactions: 0 }

const rec = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined

export const ZERO_USAGE: DotContextUsage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }

export function addUsage(left: DotContextUsage | undefined, right: DotContextUsage | undefined): DotContextUsage {
  return {
    input: (left?.input ?? 0) + (right?.input ?? 0),
    cacheRead: (left?.cacheRead ?? 0) + (right?.cacheRead ?? 0),
    cacheWrite: (left?.cacheWrite ?? 0) + (right?.cacheWrite ?? 0),
    output: (left?.output ?? 0) + (right?.output ?? 0),
  }
}

export function netSegmentUsage(raw: DotContextUsage | undefined, sessionId: string | undefined, offset: DotUsageOffset | undefined): DotContextUsage {
  if (!raw) return ZERO_USAGE
  if (!offset || !sessionId || offset.sessionId !== sessionId) return { ...raw }
  return {
    input: Math.max(0, raw.input - offset.input),
    cacheRead: Math.max(0, raw.cacheRead - offset.cacheRead),
    cacheWrite: Math.max(0, raw.cacheWrite - offset.cacheWrite),
    output: Math.max(0, raw.output - offset.output),
  }
}

export function combineUsage(
  raw: DotContextUsage | undefined,
  sessionId: string | undefined,
  carry: DotContextUsage | undefined,
  offset: DotUsageOffset | undefined,
): DotContextUsage {
  return addUsage(carry, netSegmentUsage(raw, sessionId, offset))
}

/** Fallback usage fold from stored session events when projections are unavailable. */
export function usageFromEvents(events: Iterable<RawEvent>): DotContextUsage | undefined {
  let totals: DotContextUsage | undefined
  let lastStepKey: string | undefined
  let lastBucket: DotContextUsage | undefined
  for (const event of events) {
    if (event.type !== 'assistant/message') continue
    const data = rec(event.data)
    const usage = rec(data?.usage)
    const input = count(usage?.inputTokens)
    const output = count(usage?.outputTokens)
    if (input === undefined || output === undefined) continue
    const bucket: DotContextUsage = {
      input,
      cacheRead: count(usage?.cacheReadTokens) ?? 0,
      cacheWrite: count(usage?.cacheWriteTokens) ?? 0,
      output,
    }
    const turn = count(data?.turn)
    const step = count(data?.step)
    const stepKey = turn !== undefined && step !== undefined ? `${turn}:${step}` : undefined
    const base = totals ?? ZERO_USAGE
    if (stepKey !== undefined && stepKey === lastStepKey && lastBucket) {
      totals = {
        input: Math.max(0, base.input - lastBucket.input) + bucket.input,
        cacheRead: Math.max(0, base.cacheRead - lastBucket.cacheRead) + bucket.cacheRead,
        cacheWrite: Math.max(0, base.cacheWrite - lastBucket.cacheWrite) + bucket.cacheWrite,
        output: Math.max(0, base.output - lastBucket.output) + bucket.output,
      }
    } else {
      totals = addUsage(base, bucket)
    }
    lastStepKey = stepKey
    lastBucket = bucket
  }
  return totals
}

/** Fold events after `scan.seq`; `next` is the seq the scan has reached afterwards. */
export function foldScan(scan: ContextScan, events: Iterable<RawEvent>, next: number): ContextScan {
  let out: { -readonly [K in keyof ContextScan]: ContextScan[K] } = { ...scan, seq: next }
  const surface = cloneContextSurface(scan.surface)
  for (const event of events) {
    applyContextSurface(surface, event)
    if (event.type === 'compaction/summary') {
      out.compactions += 1
      if (typeof event.time === 'number') out.lastCompactionAt = event.time
    } else if (event.type === 'request/header') {
      const data = rec(event.data)
      const config = rec(rec(data?.header)?.config) ?? rec(data?.config)
      if (typeof config?.provider === 'string' && typeof config.model === 'string') {
        out = { ...out, provider: config.provider, model: config.model }
        const reserve = count(config.maxTokens)
        if (reserve === undefined) delete out.maxTokens
        else out.maxTokens = reserve
      }
    }
  }
  if (surface.nodes.length > 0 || scan.surface) out.surface = surface
  return out
}

/** Same budget rule as dsh-compaction-basic: a window fraction, capped by what output and headroom leave. */
export function compactThreshold(contextWindow: number, reservedOutput = 0): number | undefined {
  if (!Number.isInteger(contextWindow) || contextWindow <= 0) return undefined
  const budget = contextWindow - reservedOutput - COMPACTION_POLICY.headroomTokens
  if (budget <= 0) return undefined
  return Math.floor(Math.min(contextWindow * COMPACTION_POLICY.thresholdRatio, budget))
}

/**
 * Rollover line: a share of what the window leaves after the output reservation.
 * On a small window the compaction headroom would put the compaction line
 * below that share, so the rollover line never sits above it.
 */
export function rolloverThreshold(contextWindow: number, reservedOutput = 0): number | undefined {
  if (!Number.isInteger(contextWindow) || contextWindow <= 0) return undefined
  const usable = contextWindow - reservedOutput
  if (usable <= 0) return undefined
  const line = Math.round(usable * ROLLOVER_POLICY.ratio)
  const compactAt = compactThreshold(contextWindow, reservedOutput)
  return compactAt === undefined ? line : Math.min(line, compactAt)
}

export interface ProjectionValues {
  readonly contextPressure?: unknown
  readonly contextBreakdown?: unknown
  readonly tokenUsage?: unknown
}

export interface PreTurnContext {
  readonly surface: ContextSurfaceState
  readonly breakdown: { readonly system: number; readonly tools: number; readonly messages: number }
}

export function contextView(scan: ContextScan, values: ProjectionValues, fallbackWindow?: number, preTurn?: PreTurnContext): DotContextView {
  const pressure = rec(values.contextPressure)
  const breakdown = rec(values.contextBreakdown)
  const usage = rec(values.tokenUsage)
  const contextWindow = count(pressure?.contextWindow) ?? count(fallbackWindow)
  const usedTokens = count(pressure?.projectedTokens) ?? count(pressure?.pressureTokens)
  const compactAt = contextWindow === undefined ? undefined : compactThreshold(contextWindow, scan.maxTokens)
  const rolloverAt = contextWindow === undefined ? undefined : rolloverThreshold(contextWindow, scan.maxTokens)
  const needsPreTurn = preTurn !== undefined && !scan.surface?.nodes.some(node => node.category === 'system' || node.category === 'tools')
  const surfaceState = needsPreTurn ? mergePreTurnSurface(scan.surface, preTurn.surface) : scan.surface
  let system = count(breakdown?.systemTokens)
  let tools = count(breakdown?.toolsTokens)
  let messages = count(breakdown?.messageTokens)
  if (needsPreTurn && ((system ?? 0) === 0 && (tools ?? 0) === 0)) {
    system = preTurn.breakdown.system
    tools = preTurn.breakdown.tools
    messages = Math.max(messages ?? 0, preTurn.breakdown.messages)
  }
  const input = count(usage?.uncachedInputTokens)
  const cacheRead = count(usage?.cacheReadTokens)
  const cacheWrite = count(usage?.cacheWriteTokens)
  const output = count(usage?.outputTokens)
  return {
    live: true,
    ...scan.provider ? { provider: scan.provider } : {},
    ...scan.model ? { model: scan.model } : {},
    ...contextWindow !== undefined ? { contextWindow } : {},
    ...usedTokens !== undefined ? { usedTokens } : {},
    ...compactAt !== undefined ? { compactAt } : {},
    ...rolloverAt !== undefined ? { rolloverAt } : {},
    ...scan.maxTokens !== undefined ? { reservedOutput: scan.maxTokens } : {},
    ...system !== undefined && tools !== undefined && messages !== undefined ? { breakdown: { system, tools, messages } } : {},
    ...surfaceState && surfaceState.nodes.length > 0 ? { surface: surfaceView(surfaceState) } : {},
    ...input !== undefined && cacheRead !== undefined && cacheWrite !== undefined && output !== undefined ? { usage: { input, cacheRead, cacheWrite, output } } : {},
    compactions: scan.compactions,
    ...scan.lastCompactionAt !== undefined ? { lastCompactionAt: scan.lastCompactionAt } : {},
  }
}
