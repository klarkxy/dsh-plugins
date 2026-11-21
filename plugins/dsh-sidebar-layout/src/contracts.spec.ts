import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  STORAGE_KEY,
  createSidebarLayoutStore, nextMode, normalizeMode,
} from './contracts.ts'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('sidebar layout modes', () => {
  it('normalizes unknown values to push and cycles in order', () => {
    expect(normalizeMode('push')).toBe('push')
    expect(normalizeMode('drawer')).toBe('drawer')
    expect(normalizeMode('swap')).toBe('swap')
    expect(normalizeMode('overlay')).toBe('push')
    expect(normalizeMode(null)).toBe('push')
    expect(nextMode('push')).toBe('drawer')
    expect(nextMode('drawer')).toBe('swap')
    expect(nextMode('swap')).toBe('push')
  })
})

describe('sidebar layout mode store', () => {
  it('defaults to push with no stored value', () => {
    const store = createSidebarLayoutStore(memoryStorage())
    expect(store.get()).toBe('push')
    expect(store.getSnapshot()).toBe('push')
  })

  it('persists a non-default mode and restores it', () => {
    const storage = memoryStorage()
    const store = createSidebarLayoutStore(storage)
    store.set('drawer')
    expect(storage.data.get(STORAGE_KEY)).toBe('drawer')
    expect(createSidebarLayoutStore(storage).get()).toBe('drawer')
  })

  it('normalizes an invalid stored value to push', () => {
    const store = createSidebarLayoutStore(memoryStorage({ [STORAGE_KEY]: 'float' }))
    expect(store.get()).toBe('push')
  })

  it('removes the key when reset to push', () => {
    const storage = memoryStorage({ [STORAGE_KEY]: 'swap' })
    const store = createSidebarLayoutStore(storage)
    expect(store.get()).toBe('swap')
    store.set('push')
    expect(storage.data.has(STORAGE_KEY)).toBe(false)
  })

  it('notifies subscribers on set', () => {
    const store = createSidebarLayoutStore(memoryStorage())
    const seen: string[] = []
    store.subscribe(() => seen.push(store.get()))
    store.set('swap')
    expect(seen).toEqual(['swap'])
  })

  it('propagates storage events to subscribers', () => {
    const dom = new JSDOM('', { url: 'https://local.test/' })
    vi.stubGlobal('window', dom.window)
    const storage = memoryStorage()
    const store = createSidebarLayoutStore(storage)
    const seen: string[] = []
    store.subscribe(() => seen.push(store.get()))
    storage.setItem(STORAGE_KEY, 'swap')
    dom.window.dispatchEvent(new dom.window.StorageEvent('storage', { key: STORAGE_KEY }))
    expect(store.get()).toBe('swap')
    expect(seen).toEqual(['swap'])
    dom.window.close()
  })

  it('keeps working without storage and without a window', () => {
    const store = createSidebarLayoutStore(undefined)
    expect(store.get()).toBe('push')
    store.set('drawer')
    expect(store.get()).toBe('drawer')
    const detach = store.subscribe(() => {})
    detach()
  })
})
