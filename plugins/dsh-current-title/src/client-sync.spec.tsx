import { act } from 'react'
import { Simulate } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { TitleSettings } from './client.tsx'
vi.mock('@klarkxy/dsh-plugin-kit/client-utils', async original => ({ ...await original<typeof import('@klarkxy/dsh-plugin-kit/client-utils')>(), useNativeSeat: () => ({ sessionId: '', locale: 'en' }), useFeatureRefresh: () => {} }))
const ok = (value: unknown) => ({ ok: true, value })
const status = (revision: number, model = '') => ({ settings: { revision, prompt: 'Saved prompt', model: { provider: model ? 'p' : '', model }, cadence: 'all-prompts' }, support: { weOwn: true } })
const deferred = () => { let resolve!: (value: unknown) => void; let reject!: (error: Error) => void; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
async function mount(run: (dom: JSDOM, render: (call: ReturnType<typeof vi.fn>) => Promise<void>, notify: () => Promise<void>, fail: () => Promise<void>) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>'); const previous = new Map<string, unknown>()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })) { previous.set(key, (globalThis as Record<string, unknown>)[key]); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }) }
  const root = createRoot(dom.window.document.getElementById('root')!); const marker = { active: true }; let change = () => {}, error = (_message: string) => {}
  const subscribeSettings = (listener: () => void, failed?: (message: string) => void) => { change = listener; error = failed ?? error; return () => { change = () => {}; error = () => {} } }
  try { await run(dom, async call => { await act(async () => root.render(<TitleSettings client={{ connection: { rpc: { call } } } as never} marker={marker} subscribeSettings={subscribeSettings} />)) }, async () => { await act(async () => change()) }, async () => { await act(async () => error('Unavailable')) }) }
  finally { await act(async () => root.unmount()); dom.window.close(); for (const [key, value] of previous) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }) }
}
describe('Title settings invalidation', () => {
  it('refreshes clean settings and blocks prompt blur after an external change until discard', async () => {
    let current = status(1); const call = vi.fn(async () => ok(current))
    await mount(async (dom, render, notify) => {
      await render(call); current = status(2, 'new'); await notify()
      expect(dom.window.document.querySelector('select')!.value).toBe('p\u001fnew')
      const textarea = dom.window.document.querySelector('textarea')!
      await act(async () => Simulate.change(textarea, { target: { value: 'My draft' } } as never))
      current = status(3, 'other'); await notify()
      expect(textarea.value).toBe('My draft'); expect(dom.window.document.body.textContent).toContain('Prompt draft preserved')
      await act(async () => Simulate.blur(textarea))
      expect(call.mock.calls).toHaveLength(2)
      await act(async () => [...dom.window.document.querySelectorAll('button')].find(button => button.textContent === 'Reload (discard draft)')!.click())
      expect(textarea.value).toBe('Saved prompt'); expect(dom.window.document.querySelector('select')!.value).toBe('p\u001fother')
    })
  })
  it('queues read invalidation and ignores a replaced client read failure', async () => {
    const first = deferred(); let reads = 0
    const call = vi.fn(async () => ++reads === 1 ? first.promise : ok(status(2, 'new')))
    await mount(async (dom, render, notify) => {
      await render(call); await notify(); await notify(); expect(reads).toBe(1)
      await act(async () => first.resolve(ok(status(1))))
      expect(reads).toBe(2); expect(dom.window.document.querySelector('select')!.value).toBe('p\u001fnew')
      const old = deferred(); await render(vi.fn(() => old.promise))
      await render(vi.fn(async () => ok(status(4, 'current'))))
      await act(async () => old.reject(new Error('Old failure')))
      expect(dom.window.document.querySelector('select')!.value).toBe('p\u001fcurrent'); expect(dom.window.document.body.textContent).not.toContain('Could not read')
    })
  })
  it('queues notifications during prompt save, reads the latest once, and exposes refresh fallback', async () => {
    const save = deferred(); let current = status(1)
    const call = vi.fn(async (_channel, endpoint) => endpoint === 'settings' ? save.promise : ok(current))
    await mount(async (dom, render, notify, fail) => {
      await render(call); const textarea = dom.window.document.querySelector('textarea')!
      await act(async () => Simulate.change(textarea, { target: { value: 'Edit' } } as never))
      await act(async () => Simulate.blur(textarea))
      expect(call.mock.calls[1]![1]).toBe('settings')
      current = status(3, 'latest'); await notify(); await notify()
      expect(call.mock.calls.filter(args => args[1] === 'status')).toHaveLength(1)
      await act(async () => save.resolve(ok({ ...status(2).settings, prompt: 'Edit' })))
      expect(call.mock.calls.filter(args => args[1] === 'status')).toHaveLength(2)
      expect(textarea.value).toBe('Saved prompt'); expect(dom.window.document.querySelector('select')!.value).toBe('p\u001flatest')
      expect(call.mock.calls.filter(args => args[1] === 'settings')).toHaveLength(1)
      await fail(); expect(dom.window.document.body.textContent).toContain('Automatic refresh unavailable')
    })
  })
})
