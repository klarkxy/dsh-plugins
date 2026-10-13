import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { ChatGptPanel } from './client.tsx'
import { DEFAULT_SETTINGS } from './contracts.ts'

const ok = (value: unknown) => ({ ok: true, value })
const deferred = () => { let resolve!: (value: unknown) => void; let reject!: (error: Error) => void; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const locale = { getSnapshot: () => ({ active: 'en' }), subscribe: () => () => {} }
async function mount(run: (dom: JSDOM, render: (rpc: { call: ReturnType<typeof vi.fn> }) => Promise<void>, notify: () => Promise<void>, fail: () => Promise<void>) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>')
  const previous = new Map<string, unknown>()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, (globalThis as Record<string, unknown>)[key]); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  const root = createRoot(dom.window.document.getElementById('root')!)
  let change = () => {}, error = (_message: string) => {}
  const subscribeSettings = (next: () => void, failed?: (message: string) => void) => { change = next; error = failed ?? error; return () => { change = () => {}; error = () => {} } }
  try {
    await run(dom, async rpc => { await act(async () => root.render(<ChatGptPanel rpc={rpc} locale={locale} subscribeSettings={subscribeSettings} />)) }, async () => { await act(async () => change()) }, async () => { await act(async () => error('Stream unavailable')) })
  } finally {
    await act(async () => root.unmount()); dom.window.close()
    for (const [key, value] of previous) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
}
const status = { available: true, models: [{ id: 'a', label: 'A', efforts: ['low', 'high'] }, { id: 'b', label: 'B', efforts: ['low', 'high'] }] }
const click = async (dom: JSDOM, label: string) => { await act(async () => [...dom.window.document.querySelectorAll('button')].find(button => button.textContent === label)!.click()) }

describe('ChatGPT settings invalidation', () => {
  it('refreshes clean model and effort without status calls, preserves drafts and exposes fallback', async () => {
    let revision = 1, settings = { ...DEFAULT_SETTINGS, model: 'a', effort: 'low' }
    const call = vi.fn(async (_channel, endpoint) => ok(endpoint === 'settings' ? { settings, revision } : status))
    await mount(async (dom, render, notify, fail) => {
      await render({ call }); const selects = dom.window.document.querySelectorAll('select')
      settings = { ...settings, model: 'b', effort: 'high' }; revision++
      await notify(); expect([...selects].map(select => select.value)).toEqual(['b', 'high'])
      expect(call.mock.calls.filter(args => args[1] === 'status')).toHaveLength(1)
      await act(async () => { selects[1]!.value = 'low'; selects[1]!.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
      settings = { ...settings, effort: 'high' }; revision++
      await notify(); expect(selects[1]!.value).toBe('low'); expect(dom.window.document.body.textContent).toContain('Settings changed elsewhere')
      expect(call.mock.calls.filter(args => args[1] === 'settings')).toHaveLength(2)
      await click(dom, 'Reload settings'); expect(selects[1]!.value).toBe('high')
      expect(call.mock.calls.some(args => args[1] === 'settings.update')).toBe(false)
      await fail(); expect(dom.window.document.body.textContent).toContain('Automatic refresh unavailable')
    })
  })
  it('queues one reread during a save and fences an old save error after RPC replacement', async () => {
    const save = deferred(); let revision = 1
    const call = vi.fn(async (_channel, endpoint) => endpoint === 'settings.update' ? save.promise : ok(endpoint === 'settings' ? { settings: { ...DEFAULT_SETTINGS, effort: revision === 1 ? 'low' : 'high' }, revision } : status))
    await mount(async (dom, render, notify) => {
      const rpc = { call }; await render(rpc)
      await click(dom, 'Save settings'); revision = 3; await notify(); await notify()
      expect(call.mock.calls.filter(args => args[1] === 'settings')).toHaveLength(1)
      await act(async () => save.resolve(ok({ settings: DEFAULT_SETTINGS, revision: 2 })))
      expect(call.mock.calls.filter(args => args[1] === 'settings')).toHaveLength(2)
      expect(dom.window.document.querySelectorAll('select')[1]!.value).toBe('high')
      const old = deferred(); call.mockImplementation(async (_channel, endpoint) => endpoint === 'settings.update' ? old.promise : ok(status))
      await click(dom, 'Save settings')
      await render({ call: vi.fn(async (_channel, endpoint) => ok(endpoint === 'settings' ? { settings: DEFAULT_SETTINGS, revision: 9 } : status)) })
      await act(async () => old.reject(new Error('Old save failure')))
      expect(dom.window.document.body.textContent).not.toContain('Old save failure')
    })
  })
  it('coalesces invalidations during an in-flight read and accepts only the latest snapshot', async () => {
    const first = deferred(); let reads = 0
    const call = vi.fn(async (_channel, endpoint) => endpoint === 'status' ? ok(status) : ++reads === 1 ? first.promise : ok({ settings: { ...DEFAULT_SETTINGS, model: 'b', effort: 'high' }, revision: 2 }))
    await mount(async (dom, render, notify) => {
      await render({ call }); await notify(); await notify(); expect(reads).toBe(1)
      await act(async () => first.resolve(ok({ settings: DEFAULT_SETTINGS, revision: 1 })))
      expect(reads).toBe(2); expect(dom.window.document.querySelectorAll('select')[0]!.value).toBe('b')
    })
  })
})
