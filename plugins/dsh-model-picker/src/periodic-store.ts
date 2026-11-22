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
  /** Canonical keys pinned to the front of the grid. */
  readonly favorites: readonly string[]
  /** Canonical keys hidden from the grid until the toolbar toggle reveals them. */
  readonly hidden: readonly string[]
}

export const DEFAULT_PERIODIC_PREFS: PeriodicPrefs = {
  viewMode: 'cards',
  cardWidth: CARD_WIDTH_DEFAULT,
  order: [],
  aliases: {},
  providers: {},
  favorites: [],
  hidden: [],
}

export interface PeriodicCardEntry {
  readonly canonicalKey: string
  /** Display short name (user alias if set, else preset/derived name). */
  readonly short: string
  /** Whether `short` came from a user override (hides auto version and suffix). */
  readonly customShort: boolean
  /** Auto-derived numeric version superscript (e.g. `4.6`, `4.7`). */
  readonly version: string
  /** Full model qualifier shown in small text (e.g. `Flash`, `Pro`). */
  readonly suffix: string
  /** Full readable model name shown in small text beneath the short name. */
  readonly fullName: string
  readonly family: ModelFamily
  /** All provider routes offering this canonical model. */
  readonly routes: readonly ModelMenuChoice[]
  /** Active route shown in the card's provider dropdown and effort strip. */
  readonly activeRoute: ModelMenuChoice
  /** Pinned to the front of the grid via the context menu. */
  readonly favorite: boolean
  /** Hidden via the context menu; rendered only when revealed or selected. */
  readonly hidden: boolean
  /** 1-based index in the arranged visible list — the stable sequence number. */
  readonly position: number
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
  const sanitizeKeys = (value: unknown): string[] => Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim() !== ''))]
    : []
  const order = sanitizeKeys(raw.order)
  const aliases = sanitizeStringRecord(raw.aliases, 12)
  const providers = sanitizeStringRecord(raw.providers, 200)
  const favorites = sanitizeKeys(raw.favorites)
  const hidden = sanitizeKeys(raw.hidden)
  return { viewMode, cardWidth, order, aliases, providers, favorites, hidden }
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
 *   their original catalog order; favorites then stable-partition to the front.
 * - Hidden cards drop out unless `options.showHidden` or the card serves the
 *   currently selected route. `position` numbers the returned visible list so
 *   it stays stable while a query filter hides cards.
 */
export function buildPeriodicCards(
  choices: readonly ModelMenuChoice[],
  prefs: PeriodicPrefs,
  selected?: { readonly provider: string; readonly model: string },
  options?: { readonly showHidden?: boolean },
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

  // Favorites keep their relative order and lead the grid (stable sort).
  const favoriteSet = new Set(prefs.favorites)
  orderedKeys.sort((a, b) => Number(favoriteSet.has(b)) - Number(favoriteSet.has(a)))
  const hiddenSet = new Set(prefs.hidden)
  const showHidden = options?.showHidden === true

  const entries = orderedKeys.map(canonicalKey => {
    const routes = buckets.get(canonicalKey)!
    const selectedMatch = selected
      ? routes.find(route => route.provider === selected.provider && route.model === selected.model)
      : undefined
    const preferredProvider = Object.hasOwn(prefs.providers, canonicalKey) ? prefs.providers[canonicalKey] : undefined
    const preferredMatch = preferredProvider
      ? routes.find(route => route.provider === preferredProvider)
      : undefined
    const activeRoute = selectedMatch ?? preferredMatch ?? routes[0]!
    const fullName = modelMenuShortName(activeRoute)
    const preset = resolveModelPreset(activeRoute.model, fullName)
    // Model ids are untrusted catalog keys: do not read inherited Object
    // properties such as `constructor` as saved preferences.
    const alias = Object.hasOwn(prefs.aliases, canonicalKey) ? prefs.aliases[canonicalKey] : undefined
    return {
      canonicalKey,
      short: alias || preset.short,
      customShort: Boolean(alias),
      version: alias ? '' : preset.version,
      suffix: alias ? '' : (preset.suffix ?? ''),
      fullName,
      family: preset.family,
      routes,
      activeRoute,
      favorite: favoriteSet.has(canonicalKey),
      hidden: hiddenSet.has(canonicalKey),
      position: 0,
    }
  })

  const servesSelected = (entry: { routes: readonly ModelMenuChoice[] }): boolean =>
    selected !== undefined
    && entry.routes.some(route => route.provider === selected.provider && route.model === selected.model)

  return entries
    .filter(entry => !entry.hidden || showHidden || servesSelected(entry))
    .map((entry, index) => ({ ...entry, position: index + 1 }))
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

/** Move `key` to the first or last slot; a no-op copy when the key is absent. */
export function moveCardKey(keys: readonly string[], key: string, mode: 'first' | 'last'): string[] {
  const index = keys.indexOf(key)
  if (index < 0) return [...keys]
  const next = [...keys]
  next.splice(index, 1)
  if (mode === 'first') next.unshift(key)
  else next.push(key)
  return next
}

/** Toggle membership of `key` in a key list (favorites, hidden). */
export function toggleKey(list: readonly string[], key: string): string[] {
  return list.includes(key) ? list.filter(item => item !== key) : [...list, key]
}

/**
 * Fold a reordered subset back into the full arrangement: subset keys keep
 * the slots they occupied in `fullKeys`, filled in the new subset order, so
 * drag-dropping while filtered or with hidden cards never strands the
 * non-visible cards.
 */
export function mergeSubsetOrder(fullKeys: readonly string[], reorderedSubset: readonly string[]): string[] {
  const queue = [...reorderedSubset]
  const inSubset = new Set(reorderedSubset)
  return fullKeys.map(key => (inSubset.has(key) && queue.length > 0 ? queue.shift()! : key))
}

const FILTER_SEPARATOR = /[\s\-_./:]/g

function normalizeFilterText(text: string): string {
  return text.normalize('NFKC').toLowerCase()
}

/**
 * Multi-token AND filter over a card's short name, version, suffix, full name,
 * canonical key, and every route's model/label/provider fields. Each token matches the
 * NFKC-lowercased haystack either verbatim or against a "compact" form with
 * `[\s\-_./:]` stripped, so `gpt5` finds `gpt-5`.
 * An empty or whitespace query passes the list through.
 */
export function filterPeriodicCards(cards: readonly PeriodicCardEntry[], query: string): PeriodicCardEntry[] {
  const trimmed = query.trim()
  if (!trimmed) return [...cards]
  const tokens = normalizeFilterText(trimmed).split(/\s+/)
    .map(token => ({ plain: token, compact: token.replace(FILTER_SEPARATOR, '') }))
  return cards.filter(card => {
    const raw = [
      card.short, card.version, card.suffix, card.fullName, card.canonicalKey,
      ...card.routes.flatMap(route => [route.model, route.label, route.providerLabel ?? '', route.provider]),
    ].join(' ')
    const plain = normalizeFilterText(raw)
    const compact = plain.replace(FILTER_SEPARATOR, '')
    return tokens.every(token => plain.includes(token.plain) || compact.includes(token.compact))
  })
}
