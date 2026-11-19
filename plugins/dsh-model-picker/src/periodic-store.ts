/**
 * State and persistence helpers for the periodic card grid view in
 * `@klarkxy/dsh-model-picker`.
 *
 * Pure data operations so grouping, 3-zone drag reorder (insert before /
 * swap / insert after), width clamping, alias overrides and storage round-trips
 * are straightforward to test without a browser.
 */
import { modelMenuShortName, type ModelMenuChoice } from '@klarkxy/dsh-model-route'
import { canonicalModelKey, resolveModelPreset, type ModelFamily } from './model-presets.ts'

export type PickerViewMode = 'cards' | 'list'
export type CardDropMode = 'before' | 'swap' | 'after'

export const CARD_WIDTH_MIN = 136
export const CARD_WIDTH_MAX = 240
export const CARD_WIDTH_DEFAULT = 168
export const STORAGE_KEY = 'dsh-model-picker:periodic:v1'

export interface PeriodicPrefs {
  readonly viewMode: PickerViewMode
  readonly cardWidth: number
  /** Ordered canonical model keys chosen by the user. */
  readonly order: readonly string[]
  /** User-edited short names keyed by canonical model key. */
  readonly aliases: Readonly<Record<string, string>>
  /** Preferred provider id per canonical model key. */
  readonly providers: Readonly<Record<string, string>>
}

export const DEFAULT_PERIODIC_PREFS: PeriodicPrefs = {
  viewMode: 'cards',
  cardWidth: CARD_WIDTH_DEFAULT,
  order: [],
  aliases: {},
  providers: {},
}

export interface PeriodicCardEntry {
  readonly canonicalKey: string
  /** Display short symbol (user alias if set, else preset/derived symbol). */
  readonly short: string
  /** Whether `short` came from a user override (hides auto version superscript). */
  readonly customShort: boolean
  /** Auto-derived version superscript (e.g. `4.6`, `4.7`). */
  readonly version: string
  /** Full readable model name shown in small text beneath the symbol. */
  readonly fullName: string
  readonly family: ModelFamily
  /** All provider routes offering this canonical model. */
  readonly routes: readonly ModelMenuChoice[]
  /** Active route shown in the card's provider dropdown and effort strip. */
  readonly activeRoute: ModelMenuChoice
}

export function clampCardWidth(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return CARD_WIDTH_DEFAULT
  return Math.max(CARD_WIDTH_MIN, Math.min(CARD_WIDTH_MAX, Math.round(num)))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sanitizeStringRecord(value: unknown, maxLen: number): Record<string, string> {
  if (!isRecord(value)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== 'string') continue
    const trimmed = v.trim()
    if (trimmed) out[k] = trimmed.slice(0, maxLen)
  }
  return out
}

export function parsePeriodicPrefs(raw: unknown): PeriodicPrefs {
  if (!isRecord(raw)) return DEFAULT_PERIODIC_PREFS
  const viewMode: PickerViewMode = raw.viewMode === 'list' ? 'list' : 'cards'
  const cardWidth = clampCardWidth(raw.cardWidth)
  const order = Array.isArray(raw.order)
    ? [...new Set(raw.order.filter((item): item is string => typeof item === 'string' && item.trim() !== ''))]
    : []
  const aliases = sanitizeStringRecord(raw.aliases, 12)
  const providers = sanitizeStringRecord(raw.providers, 200)
  return { viewMode, cardWidth, order, aliases, providers }
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function defaultStorage(): StorageLike | undefined {
  try {
    return typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : undefined
  } catch {
    return undefined
  }
}

export function loadPeriodicPrefs(storage: StorageLike | undefined = defaultStorage()): PeriodicPrefs {
  if (!storage) return DEFAULT_PERIODIC_PREFS
  try {
    const text = storage.getItem(STORAGE_KEY)
    if (!text) return DEFAULT_PERIODIC_PREFS
    return parsePeriodicPrefs(JSON.parse(text))
  } catch {
    return DEFAULT_PERIODIC_PREFS
  }
}

export function savePeriodicPrefs(prefs: PeriodicPrefs, storage: StorageLike | undefined = defaultStorage()): void {
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // Storage may be full or restricted; keep in-memory state working.
  }
}

/**
 * Cross-occurrence store owning the shared `STORAGE_KEY`: one in-memory
 * snapshot, one persistence path, and a `storage` listener so sibling
 * occurrences (or another tab) never overwrite each other with stale
 * snapshots. Modeled on `createConversationFontStore` in dsh-font.
 */
export interface PeriodicPrefsStore {
  get(): PeriodicPrefs
  set(prefs: PeriodicPrefs): void
  subscribe(fn: () => void): () => void
}

export function createPeriodicPrefsStore(storage: StorageLike | undefined = defaultStorage()): PeriodicPrefsStore {
  let current = loadPeriodicPrefs(storage)
  const listeners = new Set<() => void>()
  let detachStorage: (() => void) | undefined

  function notify(): void {
    for (const fn of [...listeners]) fn()
  }

  function attach(): void {
    if (detachStorage || typeof window === 'undefined') return
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== STORAGE_KEY && event.key !== null) return
      current = loadPeriodicPrefs(storage)
      notify()
    }
    window.addEventListener('storage', onStorage)
    detachStorage = () => window.removeEventListener('storage', onStorage)
  }

  return {
    get: () => current,
    set(prefs) {
      current = prefs
      savePeriodicPrefs(prefs, storage)
      notify()
    },
    subscribe(fn) {
      if (listeners.size === 0) attach()
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
        if (listeners.size === 0) {
          detachStorage?.()
          detachStorage = undefined
        }
      }
    },
  }
}

/**
 * Module-level singleton: every occurrence of the picker (composer seat,
 * settings pages) resolves the same store, so `STORAGE_KEY` has exactly one
 * owner per browser context. Swap in a fresh store for tests.
 */
let periodicPrefsStore: PeriodicPrefsStore | undefined

export function periodicStore(): PeriodicPrefsStore {
  if (!periodicPrefsStore) periodicPrefsStore = createPeriodicPrefsStore()
  return periodicPrefsStore
}

/** Test hook: replace the singleton (or restore it with `undefined`). */
export function setPeriodicStoreForTests(store: PeriodicPrefsStore | undefined): void {
  periodicPrefsStore = store
}

/**
 * Group flat catalog choices into periodic cards:
 * - Multiple providers exposing the same canonical model merge into one card.
 * - Distinct model versions stay separate cards.
 * - Card order follows `prefs.order`, appending any new catalog models in
 *   their original catalog order.
 */
export function buildPeriodicCards(
  choices: readonly ModelMenuChoice[],
  prefs: PeriodicPrefs,
  selected?: { readonly provider: string; readonly model: string },
): PeriodicCardEntry[] {
  const buckets = new Map<string, ModelMenuChoice[]>()
  for (const choice of choices) {
    const key = canonicalModelKey(choice.model) || choice.model
    const list = buckets.get(key)
    if (list) list.push(choice)
    else buckets.set(key, [choice])
  }

  const catalogOrder = [...buckets.keys()]
  const rank = new Map<string, number>()
  prefs.order.forEach((key, index) => rank.set(key, index))
  const orderedKeys = [...catalogOrder].sort((a, b) => {
    const ra = rank.get(a)
    const rb = rank.get(b)
    if (ra !== undefined && rb !== undefined) return ra - rb
    if (ra !== undefined) return -1
    if (rb !== undefined) return 1
    return 0
  })

  return orderedKeys.map(canonicalKey => {
    const routes = buckets.get(canonicalKey)!
    const selectedMatch = selected
      ? routes.find(route => route.provider === selected.provider && route.model === selected.model)
      : undefined
    const preferredProvider = prefs.providers[canonicalKey]
    const preferredMatch = preferredProvider
      ? routes.find(route => route.provider === preferredProvider)
      : undefined
    const activeRoute = selectedMatch ?? preferredMatch ?? routes[0]!
    const fullName = modelMenuShortName(activeRoute)
    const preset = resolveModelPreset(activeRoute.model, fullName)
    const alias = prefs.aliases[canonicalKey]
    return {
      canonicalKey,
      short: alias || preset.short,
      customShort: Boolean(alias),
      version: alias ? '' : preset.version,
      fullName,
      family: preset.family,
      routes,
      activeRoute,
    }
  })
}

/**
 * Apply a 3-zone drag-and-drop reorder over an ordered key list:
 * - `'before'`: remove source and insert immediately before target.
 * - `'after'`: remove source and insert immediately after target.
 * - `'swap'`: swap source and target in place without shifting other items.
 */
export function applyCardDrop(
  keys: readonly string[],
  fromIndex: number,
  toIndex: number,
  mode: CardDropMode,
): string[] {
  const next = [...keys]
  if (fromIndex < 0 || fromIndex >= next.length || toIndex < 0 || toIndex >= next.length || fromIndex === toIndex) {
    return next
  }
  if (mode === 'swap') {
    const temp = next[fromIndex]!
    next[fromIndex] = next[toIndex]!
    next[toIndex] = temp
    return next
  }
  let insertIndex = mode === 'before' ? toIndex : toIndex + 1
  const [moved] = next.splice(fromIndex, 1)
  if (fromIndex < insertIndex) insertIndex -= 1
  next.splice(insertIndex, 0, moved!)
  return next
}

/** Determine 3-zone drop mode from pointer horizontal ratio inside a card (0..1). */
export function dropModeFromRatio(ratio: number): CardDropMode {
  if (ratio < 0.28) return 'before'
  if (ratio > 0.72) return 'after'
  return 'swap'
}
