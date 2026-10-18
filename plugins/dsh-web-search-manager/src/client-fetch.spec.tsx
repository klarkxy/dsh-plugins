import { act } from 'react'
import { Simulate } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NetworkSearchSettings } from './client.tsx'
import { defaultSettings, type ProviderView, type WebSettings, type WebStatus } from './contracts.ts'

const provider = (id: string, kind: 'search' | 'fetch', patch: Partial<ProviderView> = {}): ProviderView => ({
  id, kind, label: `${kind} ${id}`, description: '', billing: 'none', configured: true,
  configurationOwned: false, calls: 0, failures: 0, ...patch,
})
afterEach(() => vi.useRealTimers())

async function mount(providers: ProviderView[], settings: Partial<WebSettings> = {}) {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true })
  const previous = new Map<string, unknown>()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, (globalThis as Record<string, unknown>)[key])
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  const root = createRoot(dom.window.document.getElementById('root')!)
  let current: WebStatus = { settings: { ...defaultSettings(), searchOrder: ['same', 'other'], fetchOrder: ['same', 'gone', 'other'], ...settings }, providers, searchActive: true, fetchActive: true, storageFailed: false }
  let fail = false
  let hold: (() => void) | undefined
  const updates: WebSettings[] = []
  const ready = (kind: 'search' | 'fetch') => (kind === 'search' ? current.settings.searchOrder : current.settings.fetchOrder).find(id => providers.some(p => p.id === id && p.kind === kind && p.configured)) ?? ''
  const refresh = () => {
    current.settings.fetchProvider = ready('fetch')
    current.fetchActive = current.settings.fetchEnabled && Boolean(ready('fetch'))
    current.searchActive = current.settings.searchEnabled && Boolean(ready('search'))
  }
  refresh()
  const call = vi.fn(async (_channel: string, endpoint: string, payload: unknown) => {
    if (endpoint === 'update') {
      const input = payload as { settings: WebSettings }
      updates.push(input.settings)
      if (hold) await new Promise<void>(resolve => { hold = resolve })
      if (fail) throw new Error('save failed')
      current = { ...current, settings: { ...input.settings, revision: current.settings.revision + 1 } }
      refresh()
    }
    return { ok: true, value: structuredClone(current) }
  })
  const set = vi.fn(async () => ({ ok: true, value: undefined }))
  const credentials = { set, unset: vi.fn(async () => ({ ok: true, value: undefined })), describe: vi.fn(async () => ({ ok: true, value: Object.fromEntries(providers.filter(p => p.credentialRef).map(p => [p.credentialRef!, { writable: true, configured: p.configured }])) })) }
  await act(async () => root.render(<NetworkSearchSettings client={{ connection: { rpc: { call } }, remote: { credentials }, locale: { getSnapshot: () => ({ active: 'en' }), subscribe: () => () => {} } } as never} />))
  const row = (kind: 'search' | 'fetch', id: string) => dom.window.document.querySelector<HTMLElement>(`[data-testid="web-${kind}-rank-${id}"]`)!
  const toggle = (kind: 'search' | 'fetch', id: string) => row(kind, id).querySelector<HTMLButtonElement>('[role="switch"]')!
  const handle = (kind: 'search' | 'fetch', id: string) => row(kind, id).querySelector<HTMLButtonElement>('.web-search-drag-handle')!
  const ids = (kind: 'search' | 'fetch') => [...dom.window.document.querySelectorAll(`[data-testid^="web-${kind}-rank-"]`)].map(node => node.getAttribute('data-testid')!.replace(`web-${kind}-rank-`, ''))
  const click = async (element: HTMLElement) => act(async () => element.click())
  const arrow = async (kind: 'search' | 'fetch', id: string, key: string) => act(async () => Simulate.keyDown(handle(kind, id), { key }))
  return { dom, row, toggle, handle, ids, click, arrow, call, updates, set, credentials,
    get current() { return current },
    fail(value: boolean) { fail = value },
    hold() { hold = () => {} },
    async release() { await act(async () => { hold?.(); hold = undefined }) },
    async close() {
      await act(async () => root.unmount())
      dom.window.close()
      for (const [key, value] of previous) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    },
  }
}

const providers = () => ['search', 'fetch'].flatMap(kind => ['same', 'other', 'new'].map(id => provider(id, kind as 'search' | 'fetch', id === 'new' ? { configurationUrl: '/plugins/owner' } : {})))

describe('fetch provider settings UI', () => {
  it('persists keyboard and drag sorting, preserves dormant selections and isolates matching search ids', async () => {
    vi.useFakeTimers()
    const ui = await mount(providers())
    try {
      expect(ui.toggle('fetch', 'new').getAttribute('aria-checked')).toBe('false')
      expect(ui.row('fetch', 'new').querySelector('a')!.getAttribute('href')).toBe('/plugins/owner')
      expect(ui.row('fetch', 'gone').dataset.availability).toBe('dormant')
      expect(ui.row('fetch', 'same').dataset.inUse).toBe('true')
      ui.handle('fetch', 'same').focus()
      await ui.arrow('fetch', 'same', 'ArrowDown')
      expect(ui.ids('fetch')).toEqual(['gone', 'same', 'other', 'new'])
      expect(ui.dom.window.document.activeElement).toBe(ui.handle('fetch', 'same'))
      expect(ui.ids('search')).toEqual(['same', 'other', 'new'])
      expect(ui.toggle('search', 'same').disabled).toBe(true)
      await act(async () => vi.advanceTimersByTimeAsync(500))
      expect(ui.current.settings.fetchOrder).toEqual(['gone', 'same', 'other'])
      expect(ui.current.settings.searchOrder).toEqual(['same', 'other'])
      const transfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), setDragImage: vi.fn() }
      await act(async () => Simulate.dragStart(ui.handle('fetch', 'other'), { dataTransfer: transfer } as never))
      await act(async () => Simulate.drop(ui.row('fetch', 'gone'), { dataTransfer: transfer } as never))
      await act(async () => vi.advanceTimersByTimeAsync(0))
      expect(ui.current.settings.fetchOrder).toEqual(['other', 'gone', 'same'])
      expect(ui.row('fetch', 'other').dataset.inUse).toBe('true')
      await ui.click(ui.toggle('fetch', 'gone'))
      expect(ui.current.settings.fetchOrder).toEqual(['other', 'same'])
      expect(ui.row('fetch', 'gone')).toBeNull()
      await ui.click(ui.toggle('fetch', 'new'))
      expect(ui.current.settings.fetchOrder).toEqual(['other', 'same', 'new'])
      const master = ui.dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Read web pages"]')!
      await ui.click(master)
      expect(ui.current.settings.fetchEnabled).toBe(false)
      expect(ui.current.settings.searchEnabled).toBe(true)
      expect(ui.row('fetch', 'other').dataset.inUse).toBeUndefined()
      await ui.click(master)
      expect(ui.current.settings.fetchEnabled).toBe(true)
    } finally { await ui.close() }
  })

  it('restores failed sorting, blocks polling and other writes, and retains unsaved limits and kind-scoped keys', async () => {
    vi.useFakeTimers()
    const owned = providers().map(p => p.id === 'same' ? { ...p, configurationOwned: true, credentialRef: `${p.kind}:same` } : p)
    const ui = await mount(owned)
    try {
      const input = (kind: 'search' | 'fetch') => ui.row(kind, 'same').querySelector<HTMLInputElement>('input[type="password"]')!
      await act(async () => Simulate.change(input('search'), { target: { value: 'search-draft' } } as never))
      await act(async () => Simulate.change(input('fetch'), { target: { value: 'fetch-draft' } } as never))
      const limit = ui.dom.window.document.querySelector<HTMLInputElement>('input[min="1"][max="20"]')!
      await act(async () => Simulate.change(limit, { target: { value: '9' } } as never))
      ui.fail(true)
      await ui.arrow('fetch', 'same', 'ArrowDown')
      ui.hold()
      await act(async () => vi.advanceTimersByTimeAsync(500))
      const calls = ui.call.mock.calls.length
      await act(async () => vi.advanceTimersByTimeAsync(6000))
      expect(ui.call.mock.calls).toHaveLength(calls)
      expect(ui.toggle('search', 'same').disabled).toBe(true)
      expect(ui.updates[0].maxResults).toBe(5)
      expect(ui.set).not.toHaveBeenCalled()
      await ui.release()
      expect(ui.ids('fetch')).toEqual(['same', 'gone', 'other', 'new'])
      expect(ui.dom.window.document.querySelector('[role="alert"]')!.textContent).toContain('save failed')
      expect(limit.value).toBe('9')
      expect(input('search').value).toBe('search-draft')
      expect(input('fetch').value).toBe('fetch-draft')
      ui.fail(false)
      const saveFetchKey = [...ui.row('fetch', 'same').querySelectorAll('button')].find(button => button.textContent === 'Save key')!
      await ui.click(saveFetchKey)
      expect(ui.set.mock.calls).toEqual([['fetch:same', 'fetch-draft']])
      expect(input('fetch').value).toBe('')
      expect(input('search').value).toBe('search-draft')
      expect(limit.value).toBe('9')
    } finally { await ui.close() }
  })

  it('translates bundled fetch copy while retaining external descriptions', async () => {
    const description = '优先匿名 Jina Reader 读取，失败后本机 HTTP 直连；无需 Key。'
    const ui = await mount([
      provider('http-managed', 'fetch', { label: '网页读取', description, configurationOwned: true }),
      provider('external', 'fetch', { description }),
    ], { fetchOrder: ['http-managed'] })
    try {
      expect(ui.row('fetch', 'http-managed').textContent).toContain('Reads with anonymous Jina Reader first')
      expect(ui.row('fetch', 'external').textContent).toContain(description)
      expect(ui.row('fetch', 'http-managed').querySelectorAll('.web-search-provider-info p')).toHaveLength(1)
    } finally { await ui.close() }
  })

  it('skips unready rows and disables fetch when its final ready participant is removed', async () => {
    const ui = await mount([provider('same', 'fetch', { configured: false }), provider('other', 'fetch'), provider('new', 'fetch')])
    try {
      expect(ui.row('fetch', 'same').dataset.availability).toBe('unavailable')
      expect(ui.row('fetch', 'other').dataset.inUse).toBe('true')
      await ui.click(ui.toggle('fetch', 'other'))
      expect(ui.current.settings.fetchEnabled).toBe(false)
      expect(ui.current.settings.fetchOrder).toEqual(['same', 'gone'])
      const master = ui.dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Read web pages"]')!
      expect(master.disabled).toBe(true)
      await ui.click(ui.toggle('fetch', 'new'))
      expect(ui.current.settings.fetchEnabled).toBe(false)
      expect(master.disabled).toBe(false)
      await ui.click(master)
      expect(ui.current.settings.fetchEnabled).toBe(true)
      expect(ui.row('fetch', 'new').dataset.inUse).toBe('true')
    } finally { await ui.close() }
  })
})
