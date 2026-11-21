import { describe, expect, it } from 'vitest'
import type { ModelMenuChoice } from '@klarkxy/dsh-model-route'
import {
  applyCardDrop, buildPeriodicCards, CARD_WIDTH_DEFAULT, CARD_WIDTH_MAX, CARD_WIDTH_MIN,
  clampCardWidth, createPeriodicPrefsStore, DEFAULT_PERIODIC_PREFS, dropModeFromRatio,
  filterPeriodicCards, loadPeriodicPrefs, mergeSubsetOrder, moveCardKey, parsePeriodicPrefs,
  savePeriodicPrefs, STORAGE_KEY, toggleKey, type PeriodicPrefs, type StorageLike,
} from './periodic-store.ts'

/* Minimal window stub: the store attaches its cross-tab `storage` listener on
 * the first subscribe and detaches with the last unsubscribe. */
type StorageEventHandler = (event: { key: string | null }) => void
const storageEvents = {
  handlers: new Set<StorageEventHandler>(),
  get size() { return this.handlers.size },
  emit(event: { key: string | null }) { for (const fn of [...this.handlers]) fn(event) },
}
;(globalThis as Record<string, unknown>).window = {
  addEventListener(type: string, fn: StorageEventHandler) {
    if (type === 'storage') storageEvents.handlers.add(fn)
  },
  removeEventListener(type: string, fn: StorageEventHandler) {
    if (type === 'storage') storageEvents.handlers.delete(fn)
  },
}

const CHOICES: ModelMenuChoice[] = [
  { provider: 'google', model: 'gemini-4-neon', label: 'Google / Gemini 4 Neon', providerLabel: 'Google', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] },
  { provider: 'vertex', model: 'google/gemini-4-neon', label: 'Vertex / Gemini 4 Neon', providerLabel: 'Vertex', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] },
  { provider: 'xai', model: 'grok-4.6', label: 'xAI / Grok 4.6', providerLabel: 'xAI', efforts: [{ id: 'medium', name: 'Medium' }] },
  { provider: 'xai', model: 'grok-4.7', label: 'xAI / Grok 4.7', providerLabel: 'xAI', efforts: [{ id: 'high', name: 'High' }] },
  { provider: 'deepseek', model: 'deepseek-v4.1-flash', label: 'DeepSeek / DeepSeek V4.1 Flash', providerLabel: 'DeepSeek', efforts: [] },
]

describe('buildPeriodicCards', () => {
  it('merges identical canonical models from multiple providers into one card while keeping distinct versions separate', () => {
    const cards = buildPeriodicCards(CHOICES, DEFAULT_PERIODIC_PREFS)
    expect(cards.map(card => card.canonicalKey)).toEqual([
      'gemini-4-neon',
      'grok-4.6',
      'grok-4.7',
      'deepseek-v4.1-flash',
    ])
    expect(cards[0]!.routes).toHaveLength(2)
    expect(cards[0]!.short).toBe('Neon')
    expect(cards[1]!.short).toBe('Grok')
    expect(cards[1]!.version).toBe('4.6')
    expect(cards[2]!.short).toBe('Grok')
    expect(cards[2]!.version).toBe('4.7')
    expect(cards[3]).toMatchObject({ short: 'DeepSeek', version: '4.1', suffix: 'Flash' })
  })

  it('respects user order, provider preference, active selection priority, and custom alias overrides', () => {
    const prefs = {
      ...DEFAULT_PERIODIC_PREFS,
      order: ['grok-4.7', 'gemini-4-neon'],
      aliases: { 'grok-4.7': 'G47' },
      providers: { 'gemini-4-neon': 'vertex' },
    }
    const cards = buildPeriodicCards(CHOICES, prefs)
    expect(cards.map(card => card.canonicalKey)).toEqual([
      'grok-4.7',
      'gemini-4-neon',
      'grok-4.6',
      'deepseek-v4.1-flash',
    ])
    expect(cards[0]!.short).toBe('G47')
    expect(cards[0]!.customShort).toBe(true)
    expect(cards[0]!.version).toBe('')
    expect(cards[0]!.suffix).toBe('')
    expect(cards[1]!.activeRoute.provider).toBe('vertex')

    // Active session selection takes precedence over stored provider preference.
    const withSelected = buildPeriodicCards(CHOICES, prefs, { provider: 'google', model: 'gemini-4-neon' })
    expect(withSelected[1]!.activeRoute.provider).toBe('google')
  })
})

describe('applyCardDrop & dropModeFromRatio', () => {
  it('maps pointer ratio into left insert (before), center swap, and right insert (after)', () => {
    expect(dropModeFromRatio(0.05)).toBe('before')
    expect(dropModeFromRatio(0.27)).toBe('before')
    expect(dropModeFromRatio(0.28)).toBe('swap')
    expect(dropModeFromRatio(0.5)).toBe('swap')
    expect(dropModeFromRatio(0.72)).toBe('swap')
    expect(dropModeFromRatio(0.73)).toBe('after')
    expect(dropModeFromRatio(0.99)).toBe('after')
  })

  it('inserts before, inserts after, and swaps in place without disturbing unrelated cards', () => {
    const keys = ['a', 'b', 'c', 'd']
    expect(applyCardDrop(keys, 3, 1, 'before')).toEqual(['a', 'd', 'b', 'c'])
    expect(applyCardDrop(keys, 0, 2, 'after')).toEqual(['b', 'c', 'a', 'd'])
    expect(applyCardDrop(keys, 0, 3, 'swap')).toEqual(['d', 'b', 'c', 'a'])
    expect(applyCardDrop(keys, 1, 1, 'swap')).toEqual(['a', 'b', 'c', 'd'])
    expect(applyCardDrop(keys, -1, 2, 'before')).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('prefs persistence & clamping', () => {
  it('clamps card widths and sanitizes untrusted payloads', () => {
    expect(clampCardWidth(80)).toBe(CARD_WIDTH_MIN)
    expect(clampCardWidth(400)).toBe(CARD_WIDTH_MAX)
    expect(clampCardWidth('not-a-number')).toBe(CARD_WIDTH_DEFAULT)

    const parsed = parsePeriodicPrefs({
      viewMode: 'list',
      cardWidth: 999,
      order: ['a', 'a', '', 42, 'b'],
      aliases: { a: '  VeryLongAliasName12345  ', empty: '   ' },
      providers: { a: 'vertex' },
      favorites: ['fav', 'fav', ' ', 7],
      hidden: ['h', 'h', null],
    })
    expect(parsed).toEqual({
      viewMode: 'list',
      cardWidth: CARD_WIDTH_MAX,
      order: ['a', 'b'],
      aliases: { a: 'VeryLongAlia' },
      providers: { a: 'vertex' },
      favorites: ['fav'],
      hidden: ['h'],
    })
  })

  it('defaults favorites/hidden and parses legacy payloads without them', () => {
    expect(DEFAULT_PERIODIC_PREFS.favorites).toEqual([])
    expect(DEFAULT_PERIODIC_PREFS.hidden).toEqual([])
    // Payloads stored before favorites/hidden existed must still parse cleanly.
    const legacy = parsePeriodicPrefs({
      viewMode: 'cards',
      cardWidth: 180,
      order: ['grok-4.7'],
      aliases: { 'grok-4.7': 'G7' },
      providers: { 'gemini-4-neon': 'vertex' },
    })
    expect(legacy.favorites).toEqual([])
    expect(legacy.hidden).toEqual([])
  })

  it('round-trips through a storage adapter and degrades gracefully on malformed JSON', () => {
    const backing = new Map<string, string>()
    const storage: StorageLike = {
      getItem: key => backing.get(key) ?? null,
      setItem: (key, value) => { backing.set(key, value) },
    }
    const next = {
      viewMode: 'cards' as const,
      cardWidth: 192,
      order: ['grok-4.7', 'grok-4.6'],
      aliases: { 'grok-4.7': 'G7' },
      providers: { 'gemini-4-neon': 'vertex' },
      favorites: ['grok-4.7'],
      hidden: ['deepseek-v4.1-flash'],
    }
    savePeriodicPrefs(next, storage)
    expect(loadPeriodicPrefs(storage)).toEqual(next)

    backing.set(STORAGE_KEY, '{not-json')
    expect(loadPeriodicPrefs(storage)).toEqual(DEFAULT_PERIODIC_PREFS)
  })
})

describe('createPeriodicPrefsStore', () => {
  it('one store instance owns the key: subscribers see each write, and the storage event reloads external changes', () => {
    const backing = new Map<string, string>()
    const storage: StorageLike = {
      getItem: key => backing.get(key) ?? null,
      setItem: (key, value) => { backing.set(key, value) },
    }
    const store = createPeriodicPrefsStore(storage)
    const seen: PeriodicPrefs[] = []
    const detach = store.subscribe(() => seen.push(store.get()))

    // Any occurrence's write is visible to every subscriber immediately and
    // persisted once, instead of being overwritten by a stale snapshot later.
    const next = { ...DEFAULT_PERIODIC_PREFS, cardWidth: 204, viewMode: 'list' as const }
    store.set(next)
    expect(store.get()).toEqual(next)
    expect(seen).toEqual([next])
    expect(JSON.parse(backing.get(STORAGE_KEY) ?? '{}')).toEqual(next)

    // An external change (another tab) reloads through the storage event.
    backing.set(STORAGE_KEY, JSON.stringify({ ...DEFAULT_PERIODIC_PREFS, cardWidth: 240 }))
    storageEvents.emit({ key: STORAGE_KEY })
    expect(store.get().cardWidth).toBe(240)

    detach()
    expect(storageEvents.size).toBe(0)
  })

  it('detaches with the last subscriber and ignores unrelated keys', () => {
    const backing = new Map<string, string>()
    const storage: StorageLike = {
      getItem: key => backing.get(key) ?? null,
      setItem: (key, value) => { backing.set(key, value) },
    }
    const store = createPeriodicPrefsStore(storage)
    const seen: number[] = []
    const detach1 = store.subscribe(() => seen.push(1))
    const detach2 = store.subscribe(() => seen.push(2))
    detach1()
    storageEvents.emit({ key: 'other-key' })
    expect(seen).toEqual([])
    backing.set(STORAGE_KEY, JSON.stringify({ cardWidth: 180 }))
    storageEvents.emit({ key: STORAGE_KEY })
    expect(store.get().cardWidth).toBe(180)
    expect(seen).toEqual([2])
    detach2()
    expect(storageEvents.size).toBe(0)
  })
})

describe('favorites & hidden arrangement', () => {
  it('partitions favorites first while preserving their arranged relative order', () => {
    const prefs = { ...DEFAULT_PERIODIC_PREFS, favorites: ['deepseek-v4.1-flash', 'grok-4.6'] }
    const cards = buildPeriodicCards(CHOICES, prefs)
    // Both favorited cards lead, keeping catalog order between them regardless
    // of the order they were favorited in.
    expect(cards.map(card => card.canonicalKey)).toEqual([
      'grok-4.6',
      'deepseek-v4.1-flash',
      'gemini-4-neon',
      'grok-4.7',
    ])
    expect(cards.map(card => card.favorite)).toEqual([true, true, false, false])
    // A stored user order still applies inside each partition.
    const ordered = buildPeriodicCards(CHOICES, {
      ...DEFAULT_PERIODIC_PREFS,
      favorites: ['deepseek-v4.1-flash'],
      order: ['grok-4.7', 'gemini-4-neon'],
    })
    expect(ordered.map(card => card.canonicalKey)).toEqual([
      'deepseek-v4.1-flash',
      'grok-4.7',
      'gemini-4-neon',
      'grok-4.6',
    ])
  })

  it('excludes hidden cards unless showHidden or they serve the selected route, numbering positions over the visible list', () => {
    const prefs = { ...DEFAULT_PERIODIC_PREFS, hidden: ['grok-4.6', 'deepseek-v4.1-flash'] }

    const hiddenOff = buildPeriodicCards(CHOICES, prefs)
    expect(hiddenOff.map(card => card.canonicalKey)).toEqual(['gemini-4-neon', 'grok-4.7'])
    expect(hiddenOff.map(card => card.position)).toEqual([1, 2])

    const shown = buildPeriodicCards(CHOICES, prefs, undefined, { showHidden: true })
    expect(shown.map(card => card.canonicalKey)).toEqual([
      'gemini-4-neon',
      'grok-4.6',
      'grok-4.7',
      'deepseek-v4.1-flash',
    ])
    expect(shown.map(card => card.hidden)).toEqual([false, true, false, true])
    expect(shown.map(card => card.position)).toEqual([1, 2, 3, 4])

    // The card serving the active selection stays visible even while hidden.
    const withSelected = buildPeriodicCards(CHOICES, prefs, { provider: 'deepseek', model: 'deepseek-v4.1-flash' })
    expect(withSelected.map(card => card.canonicalKey)).toEqual(['gemini-4-neon', 'grok-4.7', 'deepseek-v4.1-flash'])
    expect(withSelected.at(-1)!.position).toBe(3)
  })
})

describe('list helpers: moveCardKey, toggleKey, mergeSubsetOrder', () => {
  it('moves a key to the front or end and returns a copy for missing keys', () => {
    expect(moveCardKey(['a', 'b', 'c'], 'a', 'last')).toEqual(['b', 'c', 'a'])
    expect(moveCardKey(['a', 'b', 'c'], 'c', 'first')).toEqual(['c', 'a', 'b'])
    expect(moveCardKey(['a', 'b', 'c'], 'z', 'first')).toEqual(['a', 'b', 'c'])
  })

  it('toggles key membership preserving order', () => {
    expect(toggleKey(['a', 'b'], 'b')).toEqual(['a'])
    expect(toggleKey(['a', 'b'], 'c')).toEqual(['a', 'b', 'c'])
    expect(toggleKey([], 'a')).toEqual(['a'])
  })

  it('merges a reordered visible subset into its original slots', () => {
    // Slots held by {b, d, e} in the full list get refilled in the new order;
    // non-visible keys stay exactly where they were (drag while filtered).
    expect(mergeSubsetOrder(['a', 'b', 'c', 'd', 'e'], ['e', 'b', 'd'])).toEqual(['a', 'e', 'c', 'b', 'd'])
    expect(mergeSubsetOrder(['a', 'b', 'c', 'd'], ['d', 'b'])).toEqual(['a', 'd', 'c', 'b'])
    expect(mergeSubsetOrder(['a', 'b'], [])).toEqual(['a', 'b'])
  })

  it('keeps a hidden favorite in its slot when a same-partition drop merges back', () => {
    // Full arranged order A,B,C,D with favorites A,B and B hidden: the visible
    // list is A,C,D, and a swap inside it must not displace hidden favorite B.
    const prefs = {
      ...DEFAULT_PERIODIC_PREFS,
      favorites: ['grok-4.6', 'deepseek-v4.1-flash'],
      hidden: ['deepseek-v4.1-flash'],
    }
    const fullKeys = buildPeriodicCards(CHOICES, prefs, undefined, { showHidden: true })
      .map(card => card.canonicalKey)
    expect(fullKeys).toEqual(['grok-4.6', 'deepseek-v4.1-flash', 'gemini-4-neon', 'grok-4.7'])
    const visibleKeys = buildPeriodicCards(CHOICES, prefs).map(card => card.canonicalKey)
    expect(visibleKeys).toEqual(['grok-4.6', 'gemini-4-neon', 'grok-4.7'])

    const nextVisible = applyCardDrop(visibleKeys, 1, 2, 'swap')
    expect(nextVisible).toEqual(['grok-4.6', 'grok-4.7', 'gemini-4-neon'])
    const nextOrder = mergeSubsetOrder(fullKeys, nextVisible)
    expect(nextOrder).toEqual(['grok-4.6', 'deepseek-v4.1-flash', 'grok-4.7', 'gemini-4-neon'])

    const rebuilt = buildPeriodicCards(CHOICES, { ...prefs, order: nextOrder }, undefined, { showHidden: true })
    expect(rebuilt.map(card => card.canonicalKey)).toEqual(nextOrder)
    expect(rebuilt[0]!.canonicalKey).toBe('grok-4.6')
    expect(rebuilt[1]!.canonicalKey).toBe('deepseek-v4.1-flash')
    expect(rebuilt[1]!.hidden).toBe(true)
  })
})

describe('filterPeriodicCards', () => {
  const FILTER_CHOICES: ModelMenuChoice[] = [
    ...CHOICES,
    { provider: 'openai', model: 'gpt-5', label: 'OpenAI / GPT-5', providerLabel: 'OpenAI', efforts: [] },
  ]
  const cards = buildPeriodicCards(FILTER_CHOICES, DEFAULT_PERIODIC_PREFS)
  const keys = (query: string): string[] => filterPeriodicCards(cards, query).map(card => card.canonicalKey)

  it('passes through empty and whitespace queries', () => {
    expect(filterPeriodicCards(cards, '')).toEqual(cards)
    expect(filterPeriodicCards(cards, '   ')).toEqual(cards)
  })

  it('matches short names, full names, suffixes, and provider labels', () => {
    expect(keys('ne')).toEqual(['gemini-4-neon'])
    expect(keys('neon')).toEqual(['gemini-4-neon'])
    expect(keys('vertex')).toEqual(['gemini-4-neon'])
    expect(keys('deepseek')).toEqual(['deepseek-v4.1-flash'])
    expect(keys('flash')).toEqual(['deepseek-v4.1-flash'])
  })

  it('matches the compact form so separator-free queries find dashed models', () => {
    expect(keys('gpt5')).toEqual(['gpt-5'])
    expect(keys('grok46')).toEqual(['grok-4.6'])
    expect(keys('deepseek v4')).toEqual(['deepseek-v4.1-flash'])
  })

  it('ANDs multiple tokens across the haystack', () => {
    expect(keys('grok 4.6')).toEqual(['grok-4.6'])
    expect(keys('openai gpt')).toEqual(['gpt-5'])
    expect(keys('zzz nothing')).toEqual([])
  })
})
