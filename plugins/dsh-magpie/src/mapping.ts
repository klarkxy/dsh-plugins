/**
 * Map a magpie `/v1/models` listing onto the three llm-pi-ai provider routes
 * `magpie dsh <model>` writes (`magpie`, `magpie-responses`,
 * `magpie-anthropic`), so either tool can replace the other.
 */
import type { PiAiModelProfile, PiAiProviderProfile, PiAiReasoningEfforts } from '@deepseek-ai/dsh-llm-pi-ai'
import { ROUTES, STREAM_IDLE_TIMEOUT_MS, type RouteKind, type RouteName } from './contracts.ts'

/** One entry of the magpie `/v1/models` reply, fields beyond this shape ignored. */
export interface MagpieModelEntry {
  id?: unknown
  type?: unknown
  owned_by?: unknown
  magpie_label?: unknown
  display_name?: unknown
  context_length?: unknown
  context_window?: unknown
  max_output_tokens?: unknown
  modalities?: unknown
  reasoning_levels?: unknown
  supported_reasoning_levels?: unknown
  native_endpoints?: unknown
}

type Protocol = RouteKind

const REASONING_EFFORTS: Record<string, [key: string, value: string]> = {
  none: ['off', 'none'],
  minimal: ['minimal', 'minimal'],
  low: ['low', 'low'],
  medium: ['medium', 'medium'],
  high: ['high', 'high'],
  xhigh: ['xhigh', 'xhigh'],
  max: ['max', 'max'],
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Text models only: typed non-models and output modality lists without 'text' are skipped. */
export function isSelectableModel(entry: MagpieModelEntry): boolean {
  if (typeof entry.id !== 'string' || !entry.id) return false
  if (entry.type !== undefined && entry.type !== 'model') return false
  const output = (entry.modalities as { output?: unknown } | undefined)?.output
  if (output !== undefined && !strings(output).includes('text')) return false
  return true
}

/** Which wire protocol this model prefers, from its declared native endpoints. */
export function endpointProtocol(entry: MagpieModelEntry): Protocol | undefined {
  const endpoints = strings(entry.native_endpoints)
  if (endpoints.includes('/v1/chat/completions')) return 'completions'
  if (endpoints.includes('/v1/responses')) return 'responses'
  if (endpoints.includes('/v1/messages')) return 'anthropic'
  return undefined
}

/**
 * Models that declare no native endpoints inherit the unanimous protocol of
 * same-owner models that do declare one; a split owner falls back to
 * completions, matching `magpie dsh`.
 */
export function modelProtocol(entry: MagpieModelEntry, siblings: readonly MagpieModelEntry[]): Protocol {
  const own = endpointProtocol(entry)
  if (own) return own
  const protocols = new Set(
    siblings
      .filter(item => item !== entry && item.owned_by === entry.owned_by)
      .map(item => endpointProtocol(item))
      .filter((protocol): protocol is Protocol => protocol !== undefined),
  )
  return protocols.size === 1 ? [...protocols][0] : 'completions'
}

function reasoningEfforts(entry: MagpieModelEntry): PiAiReasoningEfforts | undefined {
  const levels = entry.reasoning_levels !== undefined
    ? strings(entry.reasoning_levels)
    : (entry.supported_reasoning_levels as readonly { effort?: unknown }[] | undefined)
      ?.map(item => item?.effort).filter((item): item is string => typeof item === 'string')
  if (!levels) return undefined
  const efforts: Record<string, string> = {}
  for (const level of levels) {
    const mapped = REASONING_EFFORTS[level]
    if (mapped && efforts[mapped[0]] === undefined) efforts[mapped[0]] = mapped[1]
  }
  return Object.keys(efforts).length ? efforts : undefined
}

function modelProfile(entry: MagpieModelEntry, protocol: Protocol): PiAiModelProfile {
  const id = entry.id as string
  const contextWindow = number(entry.context_length) ?? number(entry.context_window)
  let maxTokens = number(entry.max_output_tokens)
  if (maxTokens !== undefined && contextWindow !== undefined) {
    // Output cap at 7/16 of the window, matching what magpie writes for most models.
    maxTokens = Math.min(maxTokens, Math.floor(contextWindow * 7 / 16))
  }
  const declared = strings((entry.modalities as { input?: unknown } | undefined)?.input)
    .filter((item): item is 'text' | 'image' => item === 'text' || item === 'image')
  const profile: PiAiModelProfile = {
    id,
    name: typeof entry.magpie_label === 'string' ? entry.magpie_label
      : typeof entry.display_name === 'string' ? entry.display_name : id,
    input: declared.length ? declared : ['text'],
  }
  if (contextWindow !== undefined) profile.contextWindow = contextWindow
  if (maxTokens !== undefined) profile.maxTokens = maxTokens
  const efforts = reasoningEfforts(entry)
  if (efforts) profile.reasoningEfforts = efforts
  if (protocol === 'responses') profile.compat = { supportsStrictMode: true }
  else if (protocol === 'anthropic' && /claude/i.test(id)) profile.compat = { forceAdaptiveThinking: true }
  return profile
}

const ROUTE_PROFILE: Record<Protocol, (root: string, apiKeyEnv: string, models: PiAiModelProfile[]) => PiAiProviderProfile> = {
  completions: (root, apiKeyEnv, models) => ({
    displayName: 'Magpie', apiKeyEnv, api: 'openai-completions', baseURL: `${root}/v1`, models,
  }),
  responses: (root, apiKeyEnv, models) => ({
    displayName: 'Magpie · Responses', apiKeyEnv, api: 'openai-responses', baseURL: `${root}/v1`, models,
  }),
  anthropic: (root, apiKeyEnv, models) => ({
    displayName: 'Magpie · Anthropic', apiKeyEnv, api: 'anthropic-messages', baseURL: root, models,
  }),
}

/**
 * Build the `llm-pi-ai` providers dict for one gateway listing. Listing order
 * is kept; a duplicated id keeps its first entry; an empty route is omitted.
 */
export function buildRoutes(
  listing: { data?: readonly MagpieModelEntry[] } | readonly MagpieModelEntry[],
  root: string,
  apiKeyEnv: string,
): Partial<Record<RouteName, PiAiProviderProfile>> {
  const entries = Array.isArray(listing) ? listing : ((listing as { data?: readonly MagpieModelEntry[] }).data ?? [])
  const seen = new Set<string>()
  const grouped: Record<Protocol, PiAiModelProfile[]> = { completions: [], responses: [], anthropic: [] }
  for (const entry of entries) {
    if (!isSelectableModel(entry) || seen.has(entry.id as string)) continue
    seen.add(entry.id as string)
    const protocol = modelProtocol(entry, entries)
    grouped[protocol].push(modelProfile(entry, protocol))
  }
  const routes: Partial<Record<RouteName, PiAiProviderProfile>> = {}
  for (const protocol of ['completions', 'responses', 'anthropic'] as const) {
    const models = grouped[protocol]
    if (!models.length) continue
    routes[ROUTES[protocol]] = { ...ROUTE_PROFILE[protocol](root, apiKeyEnv, models), streamIdleTimeoutMs: STREAM_IDLE_TIMEOUT_MS }
  }
  return routes
}
