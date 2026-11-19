import { describe, expect, it } from 'vitest'
import type { ModelMenuChoice } from '@klarkxy/dsh-model-route'
import {
  applyCardDrop, buildPeriodicCards, CARD_WIDTH_DEFAULT, CARD_WIDTH_MAX, CARD_WIDTH_MIN,
  clampCardWidth, DEFAULT_PERIODIC_PREFS, dropModeFromRatio, loadPeriodicPrefs,
  parsePeriodicPrefs, savePeriodicPrefs, type StorageLike,
} from './periodic-store.ts'

const CHOICES: ModelMenuChoice[] = [
  { provider: 'google', model: 'gemini-4-neon', label: 'Google / Gemini 4 Neon', providerLabel: 'Google', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] },
  { provider: 'vertex', model: 'google/gemini-4-neon', label: 'Vertex / Gemini 4 Neon', providerLabel: 'Vertex', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] },
  { provider: 'xai', model: 'grok-4.6', label: 'xAI / Grok 4.6', providerLabel: 'xAI', efforts: [{ id: 'medium', name: 'Medium' }] },
  { provider: 'xai', model: 'grok-4.7', label: 'xAI / Grok 4.7', providerLabel: 'xAI', efforts: [{ id: 'high', name: 'High' }] },
  { provider: 'deepseek', model: 'deepseek-v4.1', label: 'DeepSeek / DeepSeek V4.1', providerLabel: 'DeepSeek', efforts: [] },
]

describe('buildPeriodicCards', () => {
  it('merges identical canonical models from multiple providers into one card while keeping distinct versions separate', () => {
    const cards = buildPeriodicCards(CHOICES, DEFAULT_PERIODIC_PREFS)
    expect(cards.map(card => card.canonicalKey)).toEqual([
      'gemini-4-neon',
      'grok-4.6',
      'grok-4.7',
      'deepseek-v4.1',
    ])
    expect(cards[0]!.routes).toHaveLength(2)
    expect(cards[0]!.short).toBe('Ne')
    expect(cards[1]!.short).toBe('Gr')
    expect(cards[1]!.version).toBe('4.6')
    expect(cards[2]!.short).toBe('Gr')
    expect(cards[2]!.version).toBe('4.7')
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
      'deepseek-v4.1',
    ])
    expect(cards[0]!.short).toBe('G47')
    expect(cards[0]!.customShort).toBe(true)
    expect(cards[0]!.version).toBe('')
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
    })
    expect(parsed).toEqual({
      viewMode: 'list',
      cardWidth: CARD_WIDTH_MAX,
      order: ['a', 'b'],
      aliases: { a: 'VeryLongAlia' },
      providers: { a: 'vertex' },
    })
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
    }
    savePeriodicPrefs(next, storage)
    expect(loadPeriodicPrefs(storage)).toEqual(next)

    backing.set('dsh-model-picker:periodic:v1', '{not-json')
    expect(loadPeriodicPrefs(storage)).toEqual(DEFAULT_PERIODIC_PREFS)
  })
})
