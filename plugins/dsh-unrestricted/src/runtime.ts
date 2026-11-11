import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { createUserMessage, type Message } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { deriveEventMessage } from '@deepseek-ai/dsh-session/surface'
import type { PromptPresentation } from '@deepseek-ai/dsh-system-prompt'
import z from '@deepseek-ai/schemastery'
import { producerMessageSource } from '@klarkxy/dsh-plugin-kit'
import { PLUGIN_NAME, PRESET_ID } from './contracts.ts'
import { modelNote } from './model-profiles.ts'
import { fuseSections } from './prompt/fuse.ts'
import { composeProfile } from './prompt/profiles.ts'
import { isRefusalText } from './refusal.ts'
import { retryMessage, TAIL_REMINDER } from './reminder.ts'
import { readTuning } from './tuning.ts'

export const name = PLUGIN_NAME

/** Host services the runtime half needs; the preset can live without them. */
export const inject = ['systemPrompt', 'agentPresets'] as const

/** The reminder is registered after every host section, including persona suffix 10200. */
export const TAIL_SECTION_ORDER = 1_000_000

/** The preset-scoped runtime switches. */
export interface Config {
  /** Append the standing reminder as the final prompt section on every assembly. */
  tailReminder?: boolean
  /** Retry once when a turn ends on a refusal-shaped reply. */
  refusalRetry?: boolean
  /** Maximum corrective retries per turn; 1 retries the reply once. */
  maxRetries?: number
  /** Prompt profile id from `presets/profiles`; unknown ids fall back to default. */
  profile?: string
}

export const Config: z<Config> = z.object({
  tailReminder: z.boolean().default(true),
  refusalRetry: z.boolean().default(true),
  maxRetries: z.number().step(1).min(1).max(3).default(1),
  profile: z.string().default('default'),
})

/** One turn's retry budget; the WeakMap keys by live Agent so no disposal hook is needed. */
interface RetryState {
  turn: number
  count: number
}

/** The slice of the turn-stopping event this half reads. */
interface TurnStopping {
  agent: Agent
  turn: number
  signal: AbortSignal
}

/**
 * Host half of the 破限模式 / Unrestricted mode preset.
 *
 * The preset declaration itself is static. This half adds two runtime
 * behaviours, both scoped by the Agent's composed preset so every other preset
 * remains byte-identical:
 *
 * 1. a short reminder placed after every host section on each assembly, which
 *    keeps the execution posture fresh in a long context;
 * 2. one corrective retry when a turn ends on a refusal-shaped reply, which
 *    turns a dead turn into another model step without touching the user's
 *    original request.
 *
 * Neither changes tool catalogs, approvals, sandbox limits, or any host file.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const tuning = readTuning()
  const settings = {
    tailReminder: tuning.tailReminder ?? config.tailReminder ?? true,
    refusalRetry: tuning.refusalRetry ?? config.refusalRetry ?? true,
    maxRetries: tuning.maxRetries ?? config.maxRetries ?? 1,
    modelProfiles: tuning.modelProfiles ?? {},
    profile: tuning.profile ?? config.profile ?? 'default',
  }
  const retryState = new WeakMap<Agent, RetryState>()

  ctx.effect(() => ctx.on('system-prompt/assemble', async (assembly: PromptPresentation, context, next) => {
    const original = await next()
    try {
      if (context.agent === undefined
        || ctx.agentPresets.composedPreset(context.agent.ctx) !== PRESET_ID) return original
      const fused = fuseSections(original.sections, { profileBody: composeProfile(settings.profile) ?? '' })
      if (fused.issues !== undefined) {
        ctx.logger?.warn?.('dsh-unrestricted: prompt fusion skipped: %s', fused.issues.join(', '))
        return original
      }
      return { ...original, sections: fused.sections! }
    } catch (error) {
      // A fusion failure must not take the session's prompt down; the static
      // preset declaration is still a complete fallback.
      ctx.logger?.warn?.(
        'dsh-unrestricted: prompt fusion failed: %s',
        error instanceof Error ? error.message : String(error),
      )
      return original
    }
  }), 'unrestricted.prompt-fusion')

  if (settings.tailReminder) {
    ctx.effect(() => ctx.systemPrompt.section({
      name: 'unrestricted:tail-reminder',
      // One million is deliberately above every host-owned order (the highest
      // is the persona suffix at 10200). A third-party section cannot push the
      // reminder out of the final instruction slot.
      order: TAIL_SECTION_ORDER,
      interpolate: false,
      text: context => {
        // A prompt contributor must never break assembly; an unbound Agent is
        // simply another preset and contributes nothing.
        try {
          if (context.agent === undefined
            || ctx.agentPresets.composedPreset(context.agent.ctx) !== PRESET_ID) return ''
          const note = modelNote(context.modelSelection, settings.modelProfiles)
          return note === '' ? TAIL_REMINDER : `${TAIL_REMINDER}\n\n${note}`
        } catch {
          return ''
        }
      },
    }), 'unrestricted.tail-reminder')
  }

  if (settings.refusalRetry) {
    ctx.effect(() => ctx.on('agent/turn-stopping', ({ agent, turn }: TurnStopping) => {
      // An observer must never fail the turn it observes: a projection or a
      // disposed Agent can change between the event and this read.
      try {
        if (ctx.agentPresets.composedPreset(agent.ctx) !== PRESET_ID) return
        const previous = retryState.get(agent)
        const used = previous?.turn === turn ? previous.count : 0
        if (used >= settings.maxRetries) return
        const text = lastAssistantText(agent.session, turn)
        if (text === undefined || !isRefusalText(text)) return
        retryState.set(agent, { turn, count: used + 1 })
        ctx.logger?.info?.(
          'dsh-unrestricted: refusal detected on turn %d; corrective retry %d/%d',
          turn, used + 1, settings.maxRetries,
        )
        agent.steer(createUserMessage({
          content: [{ type: 'text', text: retryMessage(used + 1) }],
          source: producerMessageSource(PLUGIN_NAME),
        }))
      } catch (error) {
        ctx.logger?.warn?.(
          'dsh-unrestricted: refusal retry skipped: %s',
          error instanceof Error ? error.message : String(error),
        )
      }
    }), 'unrestricted.refusal-retry')
  }
}

/**
 * Read the turn's last assistant message. Only the final surface node is
 * considered: scanning backwards could pick a refusal from an earlier turn
 * after a tool-only step, and the event's own turn number is checked as well.
 * @param session - the live session.
 * @param turn - the turn that is about to close.
 * @returns the reply text, or undefined when the turn did not end on an assistant message.
 */
function lastAssistantText(session: Session, turn: number): string | undefined {
  const nodes = session.surface.nodes
  const last = nodes.at(-1)
  if (last === undefined) return undefined
  const event = session.eventAt(last)
  if (event === undefined || event.type !== 'assistant/message') return undefined
  if (event.data.turn !== turn) return undefined
  const message = deriveEventMessage(event)
  if (message?.role !== 'assistant') return undefined
  return textOf(message)
}

/** @param message - one projected message.
 * @returns its text blocks joined, which is what a refusal lives in. */
function textOf(message: Message): string {
  return message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim()
}
