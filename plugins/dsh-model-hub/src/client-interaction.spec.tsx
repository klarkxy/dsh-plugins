import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { HubPage, type HubEntry } from './client.tsx'
import type { FieldCommit } from './owners.ts'

const catalog = { groups: [{ id: 'p', name: 'Provider', models: [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }] }] }
const entries: HubEntry[] = [
  { ns: 'review-plugin', title: 'Review plugin', revision: 3, fields: [{ path: ['reviewer'], label: 'Reviewer', via: 'shape', current: { provider: 'p', model: 'one' } }] },
  { ns: 'summary-plugin', title: 'Summary plugin', revision: 4, fields: [{ path: ['summary'], label: 'Summary', via: 'shape', current: { provider: 'p', model: 'two' } }] },
]
type Props = Parameters<typeof HubPage>[0]
function api(overrides: Partial<Props['api']> = {}): Props['api'] {
  return { list: vi.fn(async () => entries), modelCatalog: vi.fn(async () => catalog), setField: vi.fn(async () => ({ committed: true as const, ns: 'review-plugin' })), ...overrides }
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
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

async function render(root: Root, client: Props['api'], extra: Partial<Props> = {}) {
  await act(async () => root.render(createElement(HubPage, { api: client, locale: 'en', ...extra })))
}
const refreshButton = (dom: JSDOM) => Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>('button')).find(button => /^(Refresh|Refreshing…|刷新|正在刷新…)$/.test(button.textContent || ''))!
const triggers = (dom: JSDOM) => Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>('.dsh-model-menu-trigger'))
async function choose(dom: JSDOM, name = 'Two') {
  await act(async () => triggers(dom)[0]!.click())
  await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click())
  const option = Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')).find(button => button.textContent === name)!
  await act(async () => option.click())
}

describe('mounted model hub', () => {
  it('reports a successful commit separately from a failed refresh and never retries the write', async () => mounted(async (dom, root) => {
    const list = vi.fn(async () => entries).mockResolvedValueOnce(entries).mockRejectedValueOnce(Error('aggregate offline'))
    const client = api({ list })
    await render(root, client)
    await choose(dom)
    expect(client.setField).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledTimes(2)
    expect(dom.window.document.querySelector('[role="alert"]')!.textContent).toContain('Saved; page refresh failed: aggregate offline')
    expect(dom.window.document.body.textContent).not.toContain('Not saved')
    expect(triggers(dom).every(button => button.disabled)).toBe(true)
    await act(async () => refreshButton(dom).click())
    expect(client.setField).toHaveBeenCalledTimes(1)
    expect(dom.window.document.querySelector('[role="alert"]')).toBeNull()
    expect(triggers(dom).every(button => !button.disabled)).toBe(true)
  }))

  it('ends the saving state before a slow aggregate refresh resolves', async () => mounted(async (dom, root) => {
    const refresh = deferred<HubEntry[]>()
    const list = vi.fn(async () => entries).mockImplementationOnce(async () => entries).mockImplementationOnce(() => refresh.promise)
    const client = api({ list })
    await render(root, client)
    await choose(dom)
    expect(dom.window.document.body.textContent).toContain('Saved; refreshing…')
    expect(dom.window.document.body.textContent).not.toContain('Saving…')
    expect(client.setField).toHaveBeenCalledTimes(1)
    await act(async () => refresh.resolve(entries))
  }))
  it('searches plugin titles, field labels and current model names', async () => mounted(async (dom, root) => {
    await render(root, api())
    const input = dom.window.document.querySelector<HTMLInputElement>('input[type="search"]')!
    // React is imported before JSDOM, so use its event test utility rather than
    // relying on environment-dependent input tracking initialization.
    const { Simulate } = await import('react-dom/test-utils')
    for (const [query, expected] of [['review plugin', 'Reviewer'], ['summary', 'Summary'], ['Provider / One', 'Reviewer']]) {
      await act(async () => Simulate.change(input, { target: { value: query } } as never))
      expect(dom.window.document.querySelectorAll('.hub-row')).toHaveLength(1)
      expect(dom.window.document.querySelector('.hub-row-label')!.textContent).toBe(expected)
    }
    await act(async () => Simulate.change(input, { target: { value: 'missing' } } as never))
    expect(dom.window.document.body.textContent).toContain('No matching model fields')
  }))

  it('refreshes both APIs, retains previous rows/catalog on failures, and recovers', async () => mounted(async (dom, root) => {
    const list = vi.fn(async () => entries), modelCatalog = vi.fn(async (): Promise<unknown> => catalog)
    const client = api({ list, modelCatalog })
    await render(root, client)
    list.mockRejectedValueOnce(new Error('fields offline'))
    modelCatalog.mockResolvedValueOnce({ ok: false, error: { message: 'catalog offline' } })
    await act(async () => refreshButton(dom).click())
    expect(list).toHaveBeenCalledTimes(2)
    expect(modelCatalog).toHaveBeenCalledTimes(2)
    expect(triggers(dom)).toHaveLength(2)
    expect(triggers(dom)[0]!.textContent).toContain('Provider / One')
    expect(dom.window.document.body.textContent).toContain('fields offline')
    expect(dom.window.document.body.textContent).toContain('catalog offline')
    await act(async () => refreshButton(dom).click())
    expect(dom.window.document.querySelector('[role="alert"]')).toBeNull()
    expect(list).toHaveBeenCalledTimes(3)
    expect(modelCatalog).toHaveBeenCalledTimes(3)
    modelCatalog.mockRejectedValueOnce(new Error('network gone'))
    await act(async () => refreshButton(dom).click())
    expect(dom.window.document.body.textContent).toContain('network gone')
  }))

  it('rejects malformed refreshes, retains choices and retries both coordinated reads without writing', async () => mounted(async (dom, root) => {
    const modelCatalog = vi.fn(async (): Promise<unknown> => ({ ok: true, value: catalog }))
      .mockResolvedValueOnce(catalog).mockResolvedValueOnce({ ok: true, value: { groups: 'broken' } })
    const client = api({ modelCatalog })
    await render(root, client)
    await act(async () => refreshButton(dom).click())
    expect(dom.window.document.body.textContent).toContain('Invalid model catalog')
    expect(triggers(dom)[0]!.textContent).toContain('Provider / One')
    const retry = Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'Retry')!
    expect(retry).toBeDefined()
    await act(async () => retry.click())
    expect(dom.window.document.querySelector('[role="alert"]')).toBeNull()
    expect(client.list).toHaveBeenCalledTimes(3)
    expect(modelCatalog).toHaveBeenCalledTimes(3)
    expect(client.setField).not.toHaveBeenCalled()
  }))

  it('shows isolated catalog provider failures while retaining available choices', async () => mounted(async (dom, root) => {
    await render(root, api({ modelCatalog: async () => ({ ok: true, value: { ...catalog, failures: [{ id: 'broken', name: 'Broken provider', message: 'Sign in required' }] } }) }))
    expect(dom.window.document.querySelector('.dsh-model-catalog-status [role="status"]')!.textContent).toContain('Broken provider: Sign in required')
    expect(triggers(dom)[0]!.textContent).toContain('Provider / One')
  }))

  it('locks every editor and refresh during a write, rejects same-tick duplicates, and refreshes after CAS errors without replay', async () => mounted(async (dom, root) => {
    const write = deferred<FieldCommit>()
    const setField = vi.fn(() => write.promise)
    const client = api({ setField })
    await render(root, client)
    await act(async () => triggers(dom)[0]!.click())
    await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click())
    const option = Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')).find(button => button.textContent === 'Two')!
    await act(async () => { option.click(); option.click() })
    expect(setField).toHaveBeenCalledTimes(1)
    expect(setField).toHaveBeenCalledWith({ ns: 'review-plugin', path: ['reviewer'], expectedRevision: 3, route: { provider: 'p', model: 'two' } })
    expect(triggers(dom).every(button => button.disabled)).toBe(true)
    expect(refreshButton(dom).disabled).toBe(true)
    await act(async () => write.reject(new Error('Settings changed elsewhere')))
    expect(refreshButton(dom).disabled).toBe(false)
    expect(triggers(dom).every(button => button.disabled)).toBe(true)
    expect(dom.window.document.body.textContent).toContain('Refresh, then choose again')
    await act(async () => refreshButton(dom).click())
    expect(setField).toHaveBeenCalledTimes(1)
    expect(triggers(dom).every(button => !button.disabled)).toBe(true)
    expect(dom.window.document.querySelector('[role="alert"]')).toBeNull()
  }))

  it('locks editing while refreshing and leaves previous data visible', async () => mounted(async (dom, root) => {
    const next = deferred<HubEntry[]>()
    const list = vi.fn(async () => entries).mockImplementationOnce(async () => entries).mockImplementationOnce(() => next.promise)
    await render(root, api({ list }))
    await act(async () => refreshButton(dom).click())
    expect(triggers(dom)).toHaveLength(2)
    expect(triggers(dom).every(button => button.disabled)).toBe(true)
    expect(refreshButton(dom).disabled).toBe(true)
    await act(async () => next.resolve(entries))
    expect(triggers(dom).every(button => !button.disabled)).toBe(true)
  }))

  it('never fetches summary data and reacts to host locale changes without refetching', async () => mounted(async (dom, root) => {
    const listeners = new Set<() => void>()
    let active = 'en'
    const locale = { getSnapshot: () => ({ active }), subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } } }
    const client = api()
    await render(root, client, { view: 'summary', locale })
    expect(client.list).not.toHaveBeenCalled()
    expect(client.modelCatalog).not.toHaveBeenCalled()
    await act(async () => { active = 'zh-CN'; listeners.forEach(fn => fn()) })
    expect(dom.window.document.body.textContent).toContain('一页查看')
    await render(root, client, { locale })
    expect(refreshButton(dom).textContent).toBe('刷新')
    await act(async () => { active = 'en'; listeners.forEach(fn => fn()) })
    expect(refreshButton(dom).textContent).toBe('Refresh')
    expect(client.list).toHaveBeenCalledTimes(1)
    expect(client.modelCatalog).toHaveBeenCalledTimes(1)
  }))

  it('ignores a pending write result after the API changes or page unmounts', async () => mounted(async (dom, root) => {
    const write = deferred<FieldCommit>()
    await render(root, api({ setField: () => write.promise }))
    await choose(dom)
    const fresh = [{ ...entries[1]!, title: 'New owner' }]
    await render(root, api({ list: async () => fresh }))
    await act(async () => write.resolve({ committed: true, ns: 'review-plugin' }))
    expect(dom.window.document.querySelector('.hub-group-title')!.textContent).toBe('New owner')
    expect(dom.window.document.body.textContent).not.toContain('STALE')
    const late = deferred<FieldCommit>()
    await render(root, api({ setField: () => late.promise }))
    await choose(dom)
    await act(async () => root.render(null))
    await act(async () => late.reject(new Error('after unmount')))
    expect(dom.window.document.querySelector('#root')!.textContent).toBe('')
  }))

  it('uses a plugin model domain and respects fixed profiles and unsupported reasoning controls', async () => mounted(async (dom, root) => {
    const ownCatalog = { groups: [{ id: 'own', name: 'Own provider', models: [{ id: 'own-model', name: 'Own model', reasoning: { efforts: [{ id: 'high', name: 'High' }] } }] }] }
    await render(root, api({ list: async () => [{ ns: 'owned', revision: 1, catalog: ownCatalog, fields: [{ path: ['fixed'], via: 'contribution', label: 'Fixed profile', allowFollow: false, marker: { reasoningEffort: false }, current: { provider: 'own', model: 'own-model', reasoningEffort: 'high' } }] }] }))
    expect(triggers(dom)[0]!.textContent).toContain('Own provider / Own model')
    expect(triggers(dom)[0]!.textContent).not.toContain('High')
    await act(async () => triggers(dom)[0]!.click())
    expect(dom.window.document.querySelectorAll('[role="menuitem"]')).toHaveLength(1)
    await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click())
    expect(Array.from(dom.window.document.querySelectorAll('[role="menuitemradio"]')).map(row => row.textContent)).toEqual(['Own model'])
  }))

  it('sends the owner incarnation and uses its localized follow action', async () => mounted(async (dom, root) => {
    const owned: HubEntry[] = [{ ns: 'owned', ownerId: 'owner:1', source: 'owner', revision: 5, fields: [{ path: ['model'], label: 'Owner model', via: 'contribution', followLabel: { zh: '使用默认配置', en: 'Use default profile' } }] }]
    const client = api({ list: async () => owned })
    await render(root, client)
    expect(triggers(dom)[0]!.textContent).toContain('Use default profile')
    await choose(dom)
    expect(client.setField).toHaveBeenCalledWith({ ns: 'owned', ownerId: 'owner:1', path: ['model'], route: { provider: 'p', model: 'two' }, expectedRevision: 5 })
  }))

  it('keeps failed owners visible and blocks an unavailable separate model catalog', async () => mounted(async (dom, root) => {
    await render(root, api({ list: async () => [
      { ns: 'offline-owner', title: 'Offline owner', revision: 0, fields: [], error: 'Read failed' },
      { ...entries[0]!, catalog: null, catalogError: 'Provider unavailable' },
    ] }))
    expect(dom.window.document.querySelectorAll('.hub-group')).toHaveLength(2)
    expect(dom.window.document.body.textContent).toContain('Offline owner')
    expect(dom.window.document.body.textContent).toContain('Read failed')
    expect(dom.window.document.body.textContent).toContain('Provider unavailable')
    expect(triggers(dom)[0]!.disabled).toBe(true)
  }))
})
