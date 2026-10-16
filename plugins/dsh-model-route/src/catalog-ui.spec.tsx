import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { ModelCatalogStatus, useModelCatalog, type ModelCatalogState, type UseModelCatalogOptions } from './ui.tsx'

const catalog = (id = 'one', failures: ModelCatalogState['failures'] = []) => ({ groups: [{ id: 'p', models: [{ id }] }], failures })
function deferred() {
  let resolve!: (value: unknown) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function mounted(run: (root: Root, dom: JSDOM) => Promise<void>) {
  const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>')
  const previous = new Map<string, PropertyDescriptor | undefined>()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  const root = createRoot(dom.window.document.getElementById('root')!)
  try { await run(root, dom) } finally {
    await act(async () => root.unmount())
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
    dom.window.close()
  }
}

function harness(load: () => Promise<unknown>) {
  let state!: ModelCatalogState
  function Harness({ options, locale }: { options?: UseModelCatalogOptions; locale?: string }) {
    state = useModelCatalog(load, options)
    return <ModelCatalogStatus state={state} locale={locale} />
  }
  return { Harness, state: () => state }
}

describe('shared model catalog state', () => {
  it('shows sync and async errors, retries, and retains last good data and warnings', async () => mounted(async (root, dom) => {
    const failures = [{ id: 'bad', name: 'Broken provider', message: 'expired token' }]
    const initial = catalog('saved', failures)
    const load = vi.fn<() => Promise<unknown>>().mockImplementationOnce(() => { throw { message: 'offline' } })
      .mockRejectedValueOnce(new Error('still offline')).mockResolvedValueOnce({ ok: true, value: catalog('fresh') })
    const h = harness(load)
    await act(async () => root.render(<h.Harness options={{ initialCatalog: initial }} />))
    expect(h.state().error).toBe('offline')
    expect(h.state().catalog).toBe(initial)
    expect(h.state().choices[0]?.model).toBe('saved')
    expect(dom.window.document.body.textContent).toContain('Broken provider: expired token')
    await act(async () => dom.window.document.querySelector<HTMLButtonElement>('button')!.click())
    expect(h.state().error).toBe('still offline')
    await act(async () => h.state().refresh())
    expect(h.state().error).toBe('')
    expect(h.state().choices[0]?.model).toBe('fresh')
    expect(h.state().failures).toEqual([])
    expect(dom.window.document.body.textContent).toBe('')
  }))

  it('rejects malformed responses and failed envelopes without losing the seed', async () => mounted(async root => {
    const load = vi.fn().mockResolvedValueOnce({ groups: 'bad' }).mockResolvedValueOnce({ ok: false, error: { message: 'denied' } })
    const h = harness(load)
    await act(async () => root.render(<h.Harness options={{ initialCatalog: catalog('saved') }} />))
    expect(h.state().error).toContain('Invalid model catalog')
    await act(async () => h.state().refresh())
    expect(h.state().error).toBe('denied')
    expect(h.state().choices[0]?.model).toBe('saved')
  }))

  it('keeps the newest request authoritative across refresh races', async () => mounted(async root => {
    const first = deferred(), second = deferred(), third = deferred()
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise)
    const h = harness(load)
    await act(async () => root.render(<h.Harness />))
    expect(h.state().loading).toBe(true)
    let next!: Promise<void>
    await act(async () => { next = h.state().refresh() })
    await act(async () => first.reject(new Error('stale failure')))
    expect(h.state().loading).toBe(true)
    expect(h.state().error).toBe('')
    await act(async () => { second.resolve(catalog('newest')); await next })
    expect(h.state().choices[0]?.model).toBe('newest')
    await act(async () => { next = h.state().refresh() })
    expect(h.state().choices[0]?.model).toBe('newest')
    await act(async () => { third.reject(new Error('refresh failed')); await next })
    expect(h.state().error).toBe('refresh failed')
    expect(h.state().choices[0]?.model).toBe('newest')
  }))

  it('ignores older success after a newer failure and ignores unmounted completions', async () => mounted(async root => {
    const first = deferred(), second = deferred(), third = deferred()
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise)
    const h = harness(load)
    await act(async () => root.render(<h.Harness options={{ initialCatalog: catalog('seed') }} />))
    await act(async () => { void h.state().refresh() })
    await act(async () => second.reject(new Error('new failure')))
    await act(async () => first.resolve(catalog('stale')))
    expect(h.state().choices[0]?.model).toBe('seed')
    expect(h.state().error).toBe('new failure')
    await act(async () => { void h.state().refresh() })
    await act(async () => root.render(null))
    const last = h.state()
    await act(async () => third.resolve(catalog('unmounted')))
    expect(h.state()).toBe(last)
    await h.state().refresh()
    expect(load).toHaveBeenCalledTimes(3)
  }))

  it('refreshes on focus and subscription, removes listeners, and respects disabled state', async () => mounted(async (root, dom) => {
    const load = vi.fn().mockResolvedValue(catalog())
    let notify!: () => void
    const cleanup = vi.fn()
    const subscribe = vi.fn((listener: () => void) => { notify = listener; return cleanup })
    const h = harness(load)
    await act(async () => root.render(<h.Harness options={{ enabled: false, subscribe }} />))
    expect(h.state().loading).toBe(false)
    await h.state().refresh()
    expect(load).not.toHaveBeenCalled()
    await act(async () => root.render(<h.Harness options={{ enabled: true, subscribe }} />))
    expect(load).toHaveBeenCalledTimes(1)
    await act(async () => notify())
    await act(async () => dom.window.dispatchEvent(new dom.window.Event('focus')))
    expect(load).toHaveBeenCalledTimes(3)
    await act(async () => root.render(<h.Harness options={{ enabled: false, subscribe }} />))
    expect(cleanup).toHaveBeenCalledTimes(1)
    await act(async () => { notify(); dom.window.dispatchEvent(new dom.window.Event('focus')) })
    expect(load).toHaveBeenCalledTimes(3)
  }))

  it('does not refetch stable loaders and survives StrictMode cleanup', async () => mounted(async root => {
    const first = deferred(), second = deferred()
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    let state!: ModelCatalogState
    function Inline() { state = useModelCatalog(load); return null }
    await act(async () => root.render(<StrictMode><Inline /></StrictMode>))
    expect(load).toHaveBeenCalledTimes(2)
    await act(async () => { second.resolve(catalog('latest')) })
    await act(async () => { first.resolve(catalog('old')) })
    expect(state.choices[0]?.model).toBe('latest')
    await act(async () => root.render(<StrictMode><Inline /></StrictMode>))
    expect(load).toHaveBeenCalledTimes(2)
  }))

  it('invalidates in-flight requests when the loader source changes', async () => mounted(async root => {
    const old = deferred(), current = deferred()
    const oldLoad = vi.fn(() => old.promise), currentLoad = vi.fn(() => current.promise)
    let state!: ModelCatalogState
    function Source({ load }: { load: () => Promise<unknown> }) { state = useModelCatalog(load); return null }
    await act(async () => root.render(<Source load={oldLoad} />))
    await act(async () => root.render(<Source load={currentLoad} />))
    await act(async () => old.resolve(catalog('old-client')))
    expect(state.loading).toBe(true)
    expect(state.choices).toEqual([])
    await act(async () => current.resolve(catalog('current-client')))
    expect(state.choices[0]?.model).toBe('current-client')
  }))

  it('clears last-good models when changing to a failing catalog source', async () => mounted(async root => {
    const oldLoad = vi.fn(async () => catalog('old-client'))
    const failedLoad = vi.fn(async () => { throw new Error('new client offline') })
    let state!: ModelCatalogState
    function Source({ load }: { load: () => Promise<unknown> }) { state = useModelCatalog(load); return null }
    await act(async () => root.render(<Source load={oldLoad} />))
    expect(state.choices[0]?.model).toBe('old-client')
    await act(async () => root.render(<Source load={failedLoad} />))
    expect(state.error).toBe('new client offline')
    expect(state.catalog).toBeUndefined()
    expect(state.choices).toEqual([])
    expect(state.failures).toEqual([])
  }))

  it('renders bilingual loading, errors and partial warnings with the official retry button', async () => mounted(async (root, dom) => {
    const refresh = vi.fn(async () => {})
    const state = { loading: true, error: 'offline', failures: [{ id: 'p', name: 'Provider', message: 'timeout' }], refresh }
    await act(async () => root.render(<ModelCatalogStatus state={state} locale="zh-CN" />))
    expect(dom.window.document.body.textContent).toContain('正在加载模型')
    expect(dom.window.document.body.textContent).toContain('部分提供商')
    const button = dom.window.document.querySelector<HTMLButtonElement>('button')!
    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe('重试')
    await act(async () => root.render(<ModelCatalogStatus state={{ ...state, loading: false }} locale="en-US" />))
    expect(dom.window.document.body.textContent).toContain('Unable to load models: offline')
    expect(dom.window.document.body.textContent).toContain('Some providers could not load their models')
    await act(async () => button.click())
    expect(refresh).toHaveBeenCalledTimes(1)
  }))
})
