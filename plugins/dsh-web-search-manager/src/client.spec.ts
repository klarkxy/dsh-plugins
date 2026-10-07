import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings, type ProviderView, type WebStatus } from './contracts.ts'
import { searchProviderInfo, usesBundledPricing } from './provider-info.ts'
import {
  bindStatusRefresh, canEnableSearch, canStartStatusRead, catalogSearchBackends, configurationAccess,
  droppedDormantIds, immediateUpdate, isExternalConfigurationUrl, isProviderOn, nextSearchEnabled,
  ownsProviderConfiguration, parseLimit, searchBackends, selectedSearchBackend, shouldApplyPolledStatus,
  STATUS_REFRESH_MS,
} from './client.tsx'

describe('web search settings save semantics', () => {
  it('keeps an empty or out-of-range limit invalid instead of coercing it to 0', () => {
    expect(parseLimit('', 1, 20)).toBeUndefined()
    expect(parseLimit('0', 1, 20)).toBeUndefined()
    expect(parseLimit('21', 1, 20)).toBeUndefined()
    expect(parseLimit('2.5', 1, 20)).toBeUndefined()
    expect(parseLimit(' 8 ', 1, 20)).toBe(8)
  })

  it('writes only order and switches for immediate actions, keeping saved limits', () => {
    const saved = { ...defaultSettings(), revision: 3, maxResults: 7 }
    const next = immediateUpdate(saved, false, ['ddg'])
    expect(next).not.toHaveProperty('revision')
    expect(next.maxResults).toBe(7)
    expect(next.searchOrder).toEqual(['ddg'])
    expect(next.searchEnabled).toBe(false)
    expect(next.fetchEnabled).toBe(true)
  })
})

function provider(partial: Partial<ProviderView> & Pick<ProviderView, 'id' | 'kind'>): ProviderView {
  return {
    label: partial.id, description: '', billing: 'request', configured: true,
    calls: 0, failures: 0, ...partial,
  }
}

function status(patch: Partial<WebStatus> & { settings?: Partial<WebStatus['settings']> }): WebStatus {
  return {
    providers: [], searchActive: false, fetchActive: false, storageFailed: false,
    ...patch, settings: { ...defaultSettings(), ...patch.settings },
  }
}

describe('web search settings cards', () => {
  it('preserves dormant positions through search toggles and keyboard/drag reordering', () => {
    const saved = { ...defaultSettings(), searchOrder: ['a', 'absent', 'b'], fetchProvider: 'custom-fetch', fetchEnabled: true }
    const live = [provider({ id: 'a', kind: 'search' }), provider({ id: 'b', kind: 'search' })]
    expect(immediateUpdate(saved, false, ['b', 'a'], live)).toMatchObject({ searchOrder: ['b', 'absent', 'a'], fetchProvider: 'custom-fetch', fetchEnabled: true })
    expect(immediateUpdate({ ...saved, searchEnabled: false, fetchEnabled: false }, true, ['a', 'b'], live).fetchEnabled).toBe(false)
  })
  it('keeps credentials and fetch selection with their configuration owners', () => {
    const external = provider({ id: 'external', kind: 'search', configurationOwner: 'external-plugin', credentialRef: 'EXTERNAL_KEY', configured: false })
    expect(ownsProviderConfiguration(external)).toBe(false)
    expect(canEnableSearch(['external'], [external], { external: 'unsaved-key' }, {})).toBe(false)
    const saved = { ...defaultSettings(), fetchProvider: 'custom-fetch', fetchEnabled: false }
    expect(immediateUpdate(saved, true, ['ddg'])).toMatchObject({ fetchProvider: 'custom-fetch', fetchEnabled: false })
  })
  it('highlights only the first ready backend actually in use', () => {
    const exa = provider({ id: 'exa', kind: 'search' })
    const official = provider({ id: 'deepseek-official', kind: 'search' })
    const http = provider({ id: 'http', kind: 'fetch' })
    const current = status({
      searchActive: true, fetchActive: true,
      providers: [exa, official, http],
      settings: { searchProvider: 'exa', fetchProvider: 'http', searchEnabled: true, fetchEnabled: true, searchOrder: ['exa'] },
    })
    expect(isProviderOn(current, exa)).toBe(true)
    expect(isProviderOn(current, official)).toBe(false)
    expect(isProviderOn(current, http)).toBe(true)
    expect(isProviderOn(status({
      searchActive: true, providers: [provider({ id: 'exa', kind: 'search', configured: false })],
      settings: { searchEnabled: true, searchProvider: 'exa', searchOrder: ['exa'] },
    }), provider({ id: 'exa', kind: 'search', configured: false }))).toBe(false)
  })

  it('does not highlight a selected provider that is still off', () => {
    const current = status({ settings: { searchProvider: 'exa', searchEnabled: false } })
    expect(isProviderOn(current, provider({ id: 'exa', kind: 'search' }))).toBe(false)
  })

  it('picks one search backend for the single web_search slot', () => {
    const current = status({
      searchActive: true,
      providers: [
        provider({ id: 'exa', kind: 'search' }),
        provider({ id: 'ddg', kind: 'search', billing: 'none' }),
        provider({ id: 'http', kind: 'fetch', billing: 'none' }),
      ],
      settings: { searchProvider: 'exa', searchEnabled: true, searchOrder: ['exa'] },
    })
    expect(searchBackends(current).map(row => row.id)).toEqual(['exa'])
    expect(selectedSearchBackend(current)?.id).toBe('exa')
  })

  it('keeps an unconfigured backend in the explicit order so the key field can show', () => {
    const current = status({
      providers: [
        provider({ id: 'brave', kind: 'search', configured: false, credentialRef: 'search:brave' }),
        provider({ id: 'ddg', kind: 'search', billing: 'none' }),
      ],
      settings: { searchEnabled: false, searchOrder: ['brave'] },
    })
    expect(searchBackends(current).map(row => row.id)).toEqual(['brave'])
    expect(catalogSearchBackends(current).map(row => row.id)).toEqual(['brave', 'ddg'])
  })

  it('only treats ordered backends as enough to enable search', () => {
    const providers = [
      provider({ id: 'ddg', kind: 'search', billing: 'none' }),
      provider({ id: 'brave', kind: 'search', configured: false, credentialRef: 'search:brave' }),
      provider({ id: 'http', kind: 'fetch', billing: 'none' }),
    ]
    expect(canEnableSearch([], providers, {}, {})).toBe(false)
    expect(canEnableSearch(['brave'], providers, {}, {})).toBe(false)
    expect(canEnableSearch(['brave'], providers, { brave: 'sk-test' }, {})).toBe(true)
    expect(canEnableSearch(['brave'], providers, { brave: 'sk-test' }, { 'search:brave': false })).toBe(false)
    expect(canEnableSearch(['brave'], providers, { brave: 'sk-test' }, { 'search:brave': true })).toBe(true)
    expect(canEnableSearch(['ddg'], providers, {}, {})).toBe(true)
    expect(canEnableSearch(['http'], providers, {}, {})).toBe(false)
    expect(canEnableSearch(['absent'], providers, {}, {})).toBe(false)
    expect(canEnableSearch(['absent', 'ddg'], providers, {}, {})).toBe(true)
  })

  it('keeps the master switch off when adding a backend while search is already off', () => {
    const providers = [
      provider({ id: 'brave', kind: 'search', configured: false, credentialRef: 'search:brave' }),
      provider({ id: 'ddg', kind: 'search', billing: 'none' }),
    ]
    expect(nextSearchEnabled(false, ['brave'], providers, { brave: 'sk-test' }, {})).toBe(false)
    expect(nextSearchEnabled(false, ['ddg'], providers, {}, {})).toBe(false)
    expect(nextSearchEnabled(true, ['brave'], providers, {}, {})).toBe(false)
    expect(nextSearchEnabled(true, ['brave'], providers, { brave: 'sk-test' }, {})).toBe(true)
    expect(nextSearchEnabled(true, ['ddg', 'brave'], providers, {}, {})).toBe(true)
    expect(nextSearchEnabled(true, [], providers, {}, {})).toBe(false)
    expect(nextSearchEnabled(true, ['absent'], providers, {}, {})).toBe(false)
  })

  it('keeps unregistered search and fetch choices visible without treating them as ready', () => {
    const current = status({
      providers: [provider({ id: 'brave', kind: 'search' }), provider({ id: 'http', kind: 'fetch' })],
      settings: { searchOrder: ['gone', 'brave', 'also-gone'], fetchProvider: 'missing-fetch' },
    })
    expect(catalogSearchBackends(current).map(row => row.id)).toEqual(['gone', 'brave', 'also-gone'])
    expect(searchBackends(current).map(row => row.id)).toEqual(['gone', 'brave', 'also-gone'])
    expect(searchBackends(current)[0]).toMatchObject({ id: 'gone', configured: false, configurationOwned: false })
    expect(selectedSearchBackend(current)?.id).toBe('brave')
    expect(droppedDormantIds(current.settings, ['brave'], current.providers)).toEqual(['gone', 'also-gone'])
    expect(droppedDormantIds(current.settings, ['gone', 'brave', 'also-gone'], current.providers)).toEqual([])
  })

  it('drops a dormant id only when that removal is explicit', () => {
    const saved = { ...defaultSettings(), searchOrder: ['a', 'absent', 'b'] }
    const live = [provider({ id: 'a', kind: 'search' }), provider({ id: 'b', kind: 'search' })]
    expect(immediateUpdate(saved, true, ['b', 'absent', 'a'], live).searchOrder).toEqual(['b', 'absent', 'a'])
    expect(immediateUpdate(saved, false, ['b', 'a'], live, ['absent']).searchOrder).toEqual(['b', 'a'])
    expect(immediateUpdate(saved, false, [], live, ['absent']).searchOrder).toEqual([])
    expect(immediateUpdate(saved, false, [], live).searchOrder).toEqual(['absent'])
  })

  it('never edits credentials when configurationOwned is false, even without an owner name', () => {
    const native = provider({
      id: 'bare', kind: 'search', configurationOwned: false, credentialRef: 'EXTERNAL_KEY', configured: false,
    })
    expect(ownsProviderConfiguration(native)).toBe(false)
    expect(canEnableSearch(['bare'], [native], { bare: 'typed-key' }, {})).toBe(false)
    expect(ownsProviderConfiguration(provider({ id: 'legacy', kind: 'search' }))).toBe(true)
    expect(ownsProviderConfiguration(provider({ id: 'legacy', kind: 'search', configurationOwned: true }))).toBe(true)
  })
})

describe('configuration access', () => {
  it('uses an explicit safe link and never infers a host route from id, owner, or credential hint', () => {
    expect(configurationAccess(provider({
      id: 'external', kind: 'search', configurationOwned: false, configurationUrl: '/plugins/custom',
      configurationOwner: '@example/plugin', credentialHint: 'https://example.com/guessed',
    }))).toEqual({ kind: 'link', url: '/plugins/custom' })
    expect(configurationAccess(provider({
      id: 'hashed', kind: 'search', configurationOwned: false, configurationUrl: '#/plugin-settings',
    }))).toEqual({ kind: 'link', url: '#/plugin-settings' })
    expect(configurationAccess(provider({
      id: 'https', kind: 'search', configurationOwned: false, configurationUrl: 'https://example.com/settings',
    }))).toEqual({ kind: 'link', url: 'https://example.com/settings' })
    expect(configurationAccess(provider({
      id: 'HTTPS', kind: 'search', configurationOwned: false, configurationUrl: 'HTTPS://example.com/settings',
    }))).toEqual({ kind: 'link', url: 'HTTPS://example.com/settings' })
    expect(isExternalConfigurationUrl('https://example.com/settings')).toBe(true)
    expect(isExternalConfigurationUrl('HTTPS://example.com/settings')).toBe(true)
    expect(isExternalConfigurationUrl('/plugins/custom')).toBe(false)
    expect(isExternalConfigurationUrl('#/plugin-settings')).toBe(false)
    expect(configurationAccess(provider({
      id: 'unsafe', kind: 'search', configurationOwned: false, configurationUrl: 'javascript:alert(1)',
    }))).toEqual({ kind: 'unknown' })
    expect(configurationAccess(provider({
      id: 'named', kind: 'search', configurationOwned: false, configurationOwner: '@example/plugin',
      credentialHint: '/plugins/guessed',
    }))).toEqual({ kind: 'owner', name: '@example/plugin' })
    expect(configurationAccess(provider({
      id: 'bare', kind: 'search', configurationOwned: false, credentialHint: 'Native plugin',
    }))).toEqual({ kind: 'unknown' })
    expect(configurationAccess(provider({ id: 'owned', kind: 'search', configurationOwned: true }))).toEqual({ kind: 'owned' })
  })
})

describe('provider copy and pricing fallback', () => {
  it('prefers live metadata and does not reuse static copy for native ids', () => {
    const nativeBrave = provider({
      id: 'brave', kind: 'search', configurationOwned: false,
      description: 'Native Brave from another plugin', billing: 'none',
    })
    expect(searchProviderInfo(nativeBrave, 'zh')).toEqual({
      description: 'Native Brave from another plugin', pricing: '未提供费用信息',
    })
    expect(searchProviderInfo(nativeBrave, 'en').pricing).toBe('No pricing information provided')
    expect(usesBundledPricing(nativeBrave)).toBe(false)
  })

  it('lets bundled deepseek-managed inherit the old official notes when metadata is empty', () => {
    const managed = provider({
      id: 'deepseek-managed', kind: 'search', configurationOwned: true, description: '',
      billing: 'model-and-tools',
    })
    const info = searchProviderInfo(managed)
    expect(info.description).toMatch(/DeepSeek/)
    expect(info.pricing).toMatch(/Flash/)
    expect(usesBundledPricing(managed)).toBe(true)
    const described = provider({
      id: 'deepseek-managed', kind: 'search', configurationOwned: true,
      description: 'Bundle-owned adapter description', billing: 'model-and-tools',
    })
    expect(searchProviderInfo(described).description).toBe('Bundle-owned adapter description')
    expect(searchProviderInfo(described).pricing).toMatch(/Flash/)
  })

  it('keeps a custom owned adapter description and does not call native services free', () => {
    const custom = provider({
      id: 'custom-search', kind: 'search', configurationOwned: true,
      description: 'Extension description', pricing: 'Custom plan terms',
      pricingUrl: 'https://example.com/pricing',
    })
    expect(searchProviderInfo(custom)).toEqual({
      description: 'Extension description', pricing: 'Custom plan terms',
      pricingUrl: 'https://example.com/pricing',
    })
    expect(usesBundledPricing(custom)).toBe(false)
  })
})

describe('status refresh decisions', () => {
  afterEach(() => { vi.useRealTimers() })

  it('starts a poll only when the page is free, visible, and not already reading', () => {
    const idle = { mounted: true, hidden: false, busy: false, reordering: false, reading: false }
    expect(canStartStatusRead({ ...idle, source: 'poll' })).toBe(true)
    expect(canStartStatusRead({ ...idle, source: 'poll', hidden: true })).toBe(false)
    expect(canStartStatusRead({ ...idle, source: 'poll', busy: true })).toBe(false)
    expect(canStartStatusRead({ ...idle, source: 'poll', reordering: true })).toBe(false)
    expect(canStartStatusRead({ ...idle, source: 'poll', reading: true })).toBe(false)
    expect(canStartStatusRead({ ...idle, source: 'poll', mounted: false })).toBe(false)
    expect(canStartStatusRead({ ...idle, source: 'user', busy: true, reading: true, hidden: true })).toBe(true)
    expect(canStartStatusRead({ ...idle, source: 'user', mounted: false })).toBe(false)
  })

  it('drops stale, busy, hidden, and older-revision poll results', () => {
    const base = {
      requestId: 2, latestRequestId: 2, busy: false, reordering: false, hidden: false,
      currentRevision: 4, incomingRevision: 4,
    }
    expect(shouldApplyPolledStatus(base)).toBe(true)
    expect(shouldApplyPolledStatus({ ...base, requestId: 1 })).toBe(false)
    expect(shouldApplyPolledStatus({ ...base, busy: true })).toBe(false)
    expect(shouldApplyPolledStatus({ ...base, reordering: true })).toBe(false)
    expect(shouldApplyPolledStatus({ ...base, hidden: true })).toBe(false)
    expect(shouldApplyPolledStatus({ ...base, incomingRevision: 3 })).toBe(false)
    expect(shouldApplyPolledStatus({ ...base, incomingRevision: 5 })).toBe(true)
  })

  it('skips overlapping ticks, pauses while hidden, and stops after cleanup', async () => {
    vi.useFakeTimers()
    let hidden = false
    let running = 0
    let overlapping = 0
    let calls = 0
    const listeners = new Map<string, () => void>()
    const tick = async () => {
      running += 1
      overlapping = Math.max(overlapping, running)
      calls += 1
      await new Promise(resolve => { setTimeout(resolve, STATUS_REFRESH_MS * 2) })
      running -= 1
    }
    const stop = bindStatusRefresh({
      intervalMs: STATUS_REFRESH_MS,
      isHidden: () => hidden,
      tick,
      addListener: (type, listener) => { listeners.set(type, listener) },
      removeListener: type => { listeners.delete(type) },
    })
    await vi.advanceTimersByTimeAsync(STATUS_REFRESH_MS)
    await vi.advanceTimersByTimeAsync(STATUS_REFRESH_MS)
    expect(calls).toBe(1)
    expect(overlapping).toBe(1)
    await vi.advanceTimersByTimeAsync(STATUS_REFRESH_MS * 2)
    hidden = true
    const paused = calls
    await vi.advanceTimersByTimeAsync(STATUS_REFRESH_MS * 2)
    expect(calls).toBe(paused)
    hidden = false
    listeners.get('visibilitychange')?.()
    await Promise.resolve()
    expect(calls).toBe(paused + 1)
    stop()
    expect(listeners.size).toBe(0)
    const afterStop = calls
    await vi.advanceTimersByTimeAsync(STATUS_REFRESH_MS * 3)
    expect(calls).toBe(afterStop)
  })
})
