import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { GitCommitSettingsPanel } from './client.tsx'
const ok = (value: unknown) => ({ ok: true, value })
const settings = (revision: number, model = 'a', reasoningEffort = 'low') => ({ revision, model: { provider: 'p', model, reasoningEffort }, allowFallback: false })
const deferred = () => { let resolve!: (value: unknown) => void; let reject!: (error: Error) => void; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const catalog = { groups: [{ id: 'p', models: ['a', 'b'].map(id => ({ id, reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } })) }] }
async function mount(run: (dom: JSDOM, render: (call: ReturnType<typeof vi.fn>) => Promise<void>, notify: () => Promise<void>, fail: () => Promise<void>) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>'); const previous = new Map<string, unknown>()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })) { previous.set(key, (globalThis as Record<string, unknown>)[key]); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }) }
  const root = createRoot(dom.window.document.getElementById('root')!); let change = () => {}, error = (_message: string) => {}
  const subscribeSettings = (listener: () => void, failed?: (message: string) => void) => { change = listener; error = failed ?? error; return () => { change = () => {}; error = () => {} } }
  try { await run(dom, async call => { await act(async () => root.render(<GitCommitSettingsPanel client={{ connection: { rpc: { call } }, remote: { session: { modelCatalog: async () => catalog } }, locale: {} } as never} locale="en" subscribeSettings={subscribeSettings} />)) }, async () => { await act(async () => change()) }, async () => { await act(async () => error('Unavailable')) }) }
  finally { await act(async () => root.unmount()); dom.window.close(); for (const [key, value] of previous) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }) }
}
describe('Git settings invalidation', () => {
  it('refreshes model and effort, coalesces invalidations during save, and offers manual refresh on failure', async () => {
    let current = settings(1); const save = deferred()
    const call = vi.fn(async (_channel, endpoint) => endpoint === 'settings.update' ? save.promise : ok(current))
    await mount(async (dom, render, notify, fail) => {
      await render(call); current = settings(2, 'b', 'high'); await notify()
      expect([...dom.window.document.querySelectorAll('select')].map(select => select.value)).toEqual(['p\u001fb', 'high'])
      await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[role="switch"]')!.click())
      current = settings(4, 'a', 'high'); await notify(); await notify()
      expect(call.mock.calls.filter(args => args[1] === 'settings')).toHaveLength(2)
      await act(async () => save.resolve(ok(settings(3, 'b', 'low'))))
      expect(call.mock.calls.filter(args => args[1] === 'settings')).toHaveLength(3)
      expect([...dom.window.document.querySelectorAll('select')].map(select => select.value)).toEqual(['p\u001fa', 'high'])
      await fail(); expect(dom.window.document.body.textContent).toContain('Automatic refresh unavailable')
      expect([...dom.window.document.querySelectorAll('button')].some(button => button.textContent === 'Refresh settings')).toBe(true)
    })
  })
  it('coalesces reads and fences an old save failure after client replacement', async () => {
    const first = deferred(), save = deferred(); let reads = 0
    const call = vi.fn(async (_channel, endpoint) => endpoint === 'settings.update' ? save.promise : ++reads === 1 ? first.promise : ok(settings(2, 'b', 'high')))
    await mount(async (dom, render, notify) => {
      await render(call); await notify(); await notify(); expect(reads).toBe(1)
      await act(async () => first.resolve(ok(settings(1))))
      expect(reads).toBe(2); expect(dom.window.document.querySelector('select')!.value).toBe('p\u001fb')
      await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[role="switch"]')!.click())
      await render(vi.fn(async () => ok(settings(9, 'a'))))
      await act(async () => save.reject(new Error('Old save failure')))
      expect(dom.window.document.querySelector('select')!.value).toBe('p\u001fa'); expect(dom.window.document.body.textContent).not.toContain('Settings changed; refresh')
    })
  })
})
