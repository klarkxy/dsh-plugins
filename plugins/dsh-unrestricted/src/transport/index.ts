/**
 * Request-boundary transport for the unrestricted preset.
 *
 * This is the only part of the package that intercepts the provider stream. It
 * mounted from the preset's plugin row, but `llm/stream` is process-wide:
 * the live-Agent registry proves the selected preset on every request, and
 * auxiliary/sessionless calls always pass through untouched.
 *
 * A refused opening is discarded and the original request is re-entered with a
 * new nested request: assistant prefill first, pair second, plain third. The
 * final attempt is always honest passthrough; this module cannot make a model
 * produce content it refuses to produce, it only removes the first refusal
 * turn from the conversation path.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { isAgentLoopRequest, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import { PRESET_ID } from '../contracts.ts'
import { readTuning } from '../tuning.ts'
import { guardStream, type GuardResult } from './monitor.ts'
import { buildNestedRequest } from './request.ts'

export const name = 'dsh-unrestricted-transport'

/** `llm/stream` is process-wide, so ownership needs the live-Agent registry too. */
export const inject = ['llm', 'agents', 'agentPresets'] as const

/** The transport switches; the preset row supplies the active defaults. */
export interface Config {
  /** Whether to intercept refusal-shaped streams; off by default for a bare row. */
  enabled?: boolean
  /** Maximum retries after the initial attempt, 1–3. */
  maxRetries?: number
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
  maxRetries: z.number().step(1).min(1).max(3).default(3),
})

/** Read the attempt marker from a request built by this module. */
function attemptOf(options: GenerateOptions): number {
  const value = (options as GenerateOptions & { __unrestrictedAttempt?: unknown }).__unrestrictedAttempt
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0
}

/**
 * Register the stream waterfall listener.
 * @param ctx - the preset-scoped host context.
 * @param config - transport switches from the preset row.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const tuning = readTuning()
  const enabled = tuning.transportEnabled ?? config.enabled ?? false
  const maxRetries = Math.min(3, Math.max(1, tuning.transportMaxRetries ?? config.maxRetries ?? 3))
  if (!enabled) return

  ctx.effect(() => ctx.on('llm/stream', async function* (options, next) {
    // A preset's Cordis scope does NOT isolate the llm waterfall. Its listener
    // sees every Agent, title, compaction and auxiliary one-shot in the profile.
    // Only the original conversation request of a live unrestricted Agent may
    // enter this path; an unprovable identity is always a plain passthrough.
    const agent: Agent | undefined = options.sessionId === undefined
      ? undefined : ctx.agents.get(options.sessionId)
    if (!isAgentLoopRequest(options) || options.purpose !== undefined
      || agent === undefined || ctx.agentPresets.composedPreset(agent.ctx) !== PRESET_ID) {
      yield* next()
      return
    }
    const attempt = attemptOf(options)
    // The last attempt is intentionally unguarded: the user sees the honest
    // result rather than an endless rewrite loop.
    if (attempt >= maxRetries) {
      yield* next()
      return
    }

    const guarded = guardStream(next())
    let result: GuardResult | undefined
    // The generator's return value is only available through the manual loop.
    while (true) {
      const step = await guarded.next()
      if (step.done) {
        result = step.value
        break
      }
      yield step.value
    }

    if (result.refused) {
      const nextAttempt = attempt + 1
      ctx.logger?.info?.(
        'dsh-unrestricted: transport refusal on attempt %d; retrying %d/%d',
        attempt, nextAttempt, maxRetries,
      )
      const nested = buildNestedRequest(options, nextAttempt)
      yield* ctx.llm.stream(nested) as AsyncIterable<StreamChunk>
    }
  }), 'unrestricted.transport')
}
