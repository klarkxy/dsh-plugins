import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { HubPage, type HubEntry } from './client.tsx'
import type { FieldCommit } from './owners.ts'

type Api = Parameters<typeof HubPage>[0]['api']
const catalog = { groups: [{ id: 'p', name: 'Provider', models: [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }] }] }
const entry = (model = 'one', revision = 1): HubEntry[] => [{ ns: 'owner', revision, fields: [{ path: ['model'], via: 'contribution', current: { provider: 'p', model } }] }]
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function api(overrides: Partial<Api> = {}) {
  let changed!: () => void, failed!: (message: string) => void
  const unsubscribe = vi.fn()
  const client: Api = { list: vi.fn(async () => entry()), modelCatalog: vi.fn(async () => catalog), setField: vi.fn(async () => ({ committed: true as const, ns: 'owner' })),
    subscribeChanges: vi.fn((onChange, onError) => { changed = onChange; failed = onError!; return unsubscribe }), ...overrides }
  return { client, change: () => changed(), fail: (message: string) => failed(message), unsubscribe }
}
async function mounted(run: (dom: JSDOM, root: Root) => Promise<void>) {
  const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>')
  const previous = new Map<string, PropertyDescriptor | undefined>()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, Node: dom.window.Node,
    Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  dom.window.HTMLElement.prototype.scrollIntoView = () => {}
  const root = createRoot(dom.window.document.getElementById('root')!)
  try { await run(dom, root) } finally {
    await act(async () => root.unmount())
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
    dom.window.close()
  }
}
const render = (root: Root, client: Api, view?: string) => act(async () => root.render(createElement(HubPage, { api: client, locale: 'en', view })))
const trigger = (dom: JSDOM) => dom.window.document.querySelector<HTMLButtonElement>('.dsh-model-menu-trigger')!
async function choose(dom: JSDOM) {
  await act(async () => trigger(dom).click())
  await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click())
  const option = [...dom.window.document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(button => button.textContent === 'Two')!
  await act(async () => option.click())
}

describe('model hub invalidation workflow', () => {
  it('does no hidden summary reads or subscriptions and disposes the visible page', async () => mounted(async (_dom, root) => {
    const h = api()
    await render(root, h.client, 'summary')
    expect(h.client.list).not.toHaveBeenCalled()
    expect(h.client.modelCatalog).not.toHaveBeenCalled()
    expect(h.client.subscribeChanges).not.toHaveBeenCalled()
    await render(root, h.client)
    expect(h.client.subscribeChanges).toHaveBeenCalledTimes(1)
    await render(root, h.client, 'summary')
    expect(h.unsubscribe).toHaveBeenCalledTimes(1)
  }))

  it('coalesces notifications during reads and follows them with the latest snapshot', async () => mounted(async (dom, root) => {
    const first = deferred<HubEntry[]>()
    const list = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(entry('two', 2))
    const h = api({ list })
    await render(root, h.client)
    await act(async () => { h.change(); h.change(); h.change() })
    expect(list).toHaveBeenCalledTimes(1)
    await act(async () => { first.resolve(entry()) })
    expect(list).toHaveBeenCalledTimes(2)
    expect(trigger(dom).textContent).toContain('Provider / Two')
  }))

  it('queues refresh during a write, uses the fresh revision, and never replays a rejected mutation', async () => mounted(async (dom, root) => {
    const write = deferred<FieldCommit>()
    const list = vi.fn(async () => entry('one', 1)), setField = vi.fn(() => write.promise)
    const h = api({ list, setField })
    await render(root, h.client)
    await choose(dom)
    expect(setField).toHaveBeenCalledTimes(1)
    expect(setField.mock.calls[0]![0].expectedRevision).toBe(1)
    list.mockResolvedValue(entry('two', 7))
    await act(async () => { h.change(); h.change() })
    expect(list).toHaveBeenCalledTimes(1)
    await act(async () => write.reject(new Error('CAS conflict')))
    expect(list).toHaveBeenCalledTimes(2)
    expect(setField).toHaveBeenCalledTimes(1)
    expect(trigger(dom).textContent).toContain('Provider / Two')
  }))

  it('reports sync failure, clears it on recovery and ignores callbacks from a retired API', async () => mounted(async (dom, root) => {
    const first = api(), second = api()
    await render(root, first.client)
    await act(async () => first.fail('sync unavailable'))
    expect(dom.window.document.body.textContent).toContain('sync unavailable')
    await act(async () => first.change())
    expect(dom.window.document.body.textContent).not.toContain('sync unavailable')
    await render(root, second.client)
    await act(async () => { first.change(); first.fail('old lifetime') })
    expect(first.unsubscribe).toHaveBeenCalledTimes(1)
    expect(second.client.list).toHaveBeenCalledTimes(1)
    expect(dom.window.document.body.textContent).not.toContain('old lifetime')
  }))
})
