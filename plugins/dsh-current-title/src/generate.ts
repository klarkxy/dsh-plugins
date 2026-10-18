import { callLlmText, resolveFeatureModel, type LlmTextCaller } from '@klarkxy/dsh-plugin-kit'
import type { ModelRoute } from '@klarkxy/dsh-model-route'
import type { GenerateConfig, TitleMessage, TitleModelRoute } from './contracts.ts'
import { DEFAULT_TIMEOUT_MS, PLUGIN_NAME } from './contracts.ts'
import { frameMessages, selectRecentMessages } from './input.ts'
import { formatTitle, normalizeSessionTitle, parseModelTitle, resolveTitleLocale, type TitleLocaleMode } from './output.ts'
import { sourceVersionOf } from './messages.ts'

export interface GeneratedTitle {
  readonly title: string
  readonly messageSeqs: readonly number[]
  readonly model?: { readonly provider: string; readonly model: string }
  readonly sourceVersion: string
}

export function systemPrompt(config: GenerateConfig, customPrompt = ''): string {
  const instruction = customPrompt.trim()
  return [
    instruction || 'Name the current task in an AI coding-assistant session.',
    'Prioritize the newest human messages. Older messages are context only and must not keep a completed task in the title.',
    'Allowed type values: feature, fix, optimize, refactor, test, docs, release, config, explore, discuss.',
    'Return exactly one JSON object: {"type":"<type>","summary":"<summary>"}.',
    'Return no Markdown, code fence, explanation, date, or extra key.',
    'Keep the summary in the language of the recent messages.',
    `Aim for at most ${config.targetWords} non-CJK words or ${config.targetCjkCharacters} CJK characters.`,
  ].join('\n')
}

/**
 * Saved override passed to resolveFeatureModel. Unlike modelRouteOverride,
 * this does not trim or re-apply the 250/80 caps: stored rows are already
 * normalized, and a whitespace-only id must stay a miss (not a trimmed hit)
 * so the host-default fallback is unchanged.
 */
export function titleModelRoute(route: TitleModelRoute | undefined): ModelRoute | undefined {
  if (!route?.provider || !route.model) return undefined
  return route.reasoningEffort
    ? { provider: route.provider, model: route.model, reasoningEffort: route.reasoningEffort }
    : { provider: route.provider, model: route.model }
}

export async function generateCurrentTitle(options: {
  llm: LlmTextCaller
  host: unknown
  config: GenerateConfig
  sessionId: string
  messages: readonly TitleMessage[]
  prompt?: string
  model?: TitleModelRoute
  localePreference?: string
  localeMode?: TitleLocaleMode
  signal: AbortSignal
  isCurrent: () => boolean
  now?: Date
}): Promise<GeneratedTitle> {
  options.signal.throwIfAborted()
  if (!options.isCurrent()) {
    throw Object.assign(new Error('dsh-current-title: generation is no longer current'), { code: 'superseded' })
  }
  const selected = selectRecentMessages(
    options.messages,
    options.config.maxRecentMessages,
    options.config.maxInputBytes,
  )
  if (selected.length === 0) throw new Error('dsh-current-title: at least one source message is required')
  const route = resolveFeatureModel(options.host, titleModelRoute(options.model), options.sessionId)
  if (!route) throw new Error('dsh-current-title: 请在插件页选择模型，或设置宿主默认对话模型。')
  // Like the bundled title provider, select the first (least) advertised
  // effort inside prepareCall, before adapter defaults are materialized.
  const callRoute = { provider: route.provider, model: route.model }

  const framedInput = frameMessages(selected)
  const locale = resolveTitleLocale(
    options.localeMode ?? options.config.locale,
    selected.map(message => message.text),
    options.localePreference,
  )
  const sourceVersion = sourceVersionOf(options.sessionId, selected)
  const deadline = new AbortController()
  const timeoutMs = Number.isFinite(options.config.timeoutMs) && options.config.timeoutMs > 0
    ? options.config.timeoutMs : DEFAULT_TIMEOUT_MS
  const timer = setTimeout(() => deadline.abort(new DOMException('Title generation timed out.', 'TimeoutError')), timeoutMs)
  const signal = AbortSignal.any([options.signal, deadline.signal])
  let result
  try {
    result = await callLlmText(options.llm, {
      plugin: PLUGIN_NAME,
      route: callRoute,
      system: systemPrompt(options.config, options.prompt),
      text: framedInput,
      maxTokens: options.config.maxOutputTokens,
      purpose: 'session-title',
      configure: (controls, model) => {
        const effort = model.reasoning?.efforts[0]?.id
        return { ...controls, ...(effort === undefined ? {} : { reasoningEffort: effort }) }
      },
      signal,
      sessionId: options.sessionId,
      isCurrent: options.isCurrent,
    })
    signal.throwIfAborted()
  } catch (error) {
    // The shared caller translates stream cancellation to AbortError. Retain
    // the originating deadline or lifecycle reason at this feature boundary.
    signal.throwIfAborted()
    throw error
  } finally {
    clearTimeout(timer)
  }
  options.signal.throwIfAborted()
  if (!options.isCurrent()) {
    throw Object.assign(new Error('dsh-current-title: generation is no longer current'), { code: 'superseded' })
  }
  const parsed = parseModelTitle(result.text, options.config.targetWords, options.config.targetCjkCharacters)
  const title = normalizeSessionTitle(formatTitle(parsed, locale, options.now ?? new Date()), options.config.maxTitleBytes)
  if (!title) throw new Error('dsh-current-title: title model returned an empty summary')
  return {
    title,
    messageSeqs: selected.map(message => message.seq),
    model: { provider: result.provider, model: result.model },
    sourceVersion,
  }
}
