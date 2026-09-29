/** Browser-safe contracts. Shared RPC/result types stay on @klarkxy/dsh-plugin-kit. */
export type { RpcResult } from '@klarkxy/dsh-plugin-kit/contracts'

export const PLUGIN_NAME = '@klarkxy/dsh-current-title'
export const FEATURE_ID = 'current-title'
export const PROVIDER_ID = '@klarkxy/dsh-current-title'
export const PURPOSE_ID = 'current-title.generate'
export const RPC_CHANNEL = '/dsh-current-title'
export const TITLE_CLIENT_SERVICE = 'dshCurrentTitleClient'
export const PROMPT_VERSION = 'current-title.v2'
export const SCHEMA_VERSION = 'title-json.v1'
export const CONTRACT_VERSION = 1
export const SETTINGS_KEY = 'current'
export const MAX_PROMPT_CHARS = 4000

export const DEFAULT_MAX_RECENT_MESSAGES = 8
export const DEFAULT_TARGET_WORDS = 5
export const DEFAULT_TARGET_CJK = 10
export const DEFAULT_MAX_INPUT_BYTES = 4096
export const DEFAULT_MAX_OUTPUT_TOKENS = 256
export const DEFAULT_TIMEOUT_MS = 60_000
export const DEFAULT_MAX_TITLE_BYTES = 80

export type TitleLocaleMode = 'auto' | 'zh' | 'en'
export type TitleSourceKind = 'fallback' | 'provider' | 'user'
/** Automatic generation cadence: every eligible message, or only the first. */
export type TitleCadence = 'all-prompts' | 'first-prompt'

export interface TitleMessage {
  readonly seq: number
  readonly text: string
}

export interface TitleSnapshot {
  readonly title: string
  readonly messageSeqs: readonly number[]
  readonly source: { readonly kind: TitleSourceKind; readonly provider?: string }
  readonly eventSeq: number
  readonly updatedAt: number
}

/** Empty provider and model means the shared weak role. Both must be set together. */
export interface TitleModelRoute {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface TitleSettings {
  revision: number
  locale: TitleLocaleMode
  /** Empty keeps the built-in title instruction. */
  prompt: string
  model: TitleModelRoute
  cadence: TitleCadence
}

export interface TitleSupport {
  nativeOwner: string | null
  weOwn: boolean
  limitation?: string
}

export interface TitleStatus {
  settings: TitleSettings
  support: TitleSupport
  session?: {
    sessionId: string
    title?: string
    sourceKind?: TitleSourceKind
    generating: boolean
    pinned: boolean
  }
}

export interface TitleClientMarker {
  active: boolean
}

export interface GenerateConfig {
  readonly maxRecentMessages: number
  readonly locale: TitleLocaleMode
  readonly targetWords: number
  readonly targetCjkCharacters: number
  readonly maxInputBytes: number
  readonly maxOutputTokens: number
  readonly timeoutMs: number
  readonly maxTitleBytes: number
}

export function defaultModelRoute(): TitleModelRoute {
  return { provider: '', model: '' }
}

export function defaultSettings(locale: TitleLocaleMode = 'auto'): TitleSettings {
  return { revision: 0, locale, prompt: '', model: defaultModelRoute(), cadence: 'all-prompts' }
}

export function normalizeCadence(value: unknown): TitleCadence {
  return value === 'first-prompt' ? 'first-prompt' : 'all-prompts'
}

export function normalizePrompt(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\u0000/gu, '').trim().slice(0, MAX_PROMPT_CHARS)
}

export function normalizeModelRoute(value: unknown): TitleModelRoute {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultModelRoute()
  const route = value as Record<string, unknown>
  const provider = typeof route.provider === 'string' ? route.provider.trim() : ''
  const model = typeof route.model === 'string' ? route.model.trim() : ''
  const effort = typeof route.reasoningEffort === 'string' ? route.reasoningEffort.trim() : ''
  if (!provider || !model || provider.length > 250 || model.length > 250) return defaultModelRoute()
  return effort && effort.length <= 80 ? { provider, model, reasoningEffort: effort } : { provider, model }
}

export function defaultGenerateConfig(locale: TitleLocaleMode = 'auto'): GenerateConfig {
  return {
    maxRecentMessages: DEFAULT_MAX_RECENT_MESSAGES,
    locale,
    targetWords: DEFAULT_TARGET_WORDS,
    targetCjkCharacters: DEFAULT_TARGET_CJK,
    maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxTitleBytes: DEFAULT_MAX_TITLE_BYTES,
  }
}

export function isTitleLocaleMode(value: unknown): value is TitleLocaleMode {
  return value === 'auto' || value === 'zh' || value === 'en'
}
