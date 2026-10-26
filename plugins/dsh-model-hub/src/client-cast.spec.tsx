import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { CastPage, type CastApi, type CastState } from './client-cast.tsx'
import type { CastCommit } from './cast.ts'

const catalog = { groups: [{ id: 'p', name: 'Provider', models: [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }] }] }
const state: CastState = {
  enabled: true,
  revision: 5,
  tendencyRevision: 2,
  routes: [
    { provider: 'p', model: 'one', tendency: 'reviews' },
    { provider: 'p', model: 'two' },
  ],
}
function api(overrides: Partial<CastApi> = {}): CastApi {
  return {
    getCast: vi.fn(async () => state),
    setCastEnabled: vi.fn(async () => ({ committed: true as const })),
    addCastRoute: vi.fn(async () => ({ committed: true as const })),
    setCastRoute: vi.fn(async () => ({ committed: true as const })),
    removeCastRoute: vi.fn(async () => ({ committed: true as const })),
    setCastTendency: vi.fn(async () => state),
    listRunning: vi.fn(async () => ({ revision: 0, entries: [] })),
    modelCatalog: vi.fn(async () => catalog),
    ...overrides,
  }
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

const render = (root: Root, client: CastApi, locale = 'en') => act(async () => root.render(createElement(CastPage, { api: client, locale })))
const castSwitch = (dom: JSDOM) => dom.window.document.querySelector<HTMLButtonElement>('button[role="switch"]')!
const triggers = (dom: JSDOM) => Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>('.dsh-model-menu-trigger'))
const tendencies = (dom: JSDOM) => Array.from(dom.window.document.querySelectorAll<HTMLInputElement>('input[aria-label^="Task tendency"], input[aria-label$="的任务倾向"]'))
const removes = (dom: JSDOM) => Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>('button[aria-label^="Remove"], button[aria-label^="移除 "]'))
const refreshButton = (dom: JSDOM) => Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>('.cast-head button')).find(button => /^(Refresh|Refreshing…|刷新|正在刷新…)$/.test(button.textContent || ''))!
async function choose(dom: JSDOM, trigger: HTMLButtonElement, name = 'Two') {
  await act(async () => trigger.click())
  await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click())
  const option = Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')).find(button => button.textContent === name)!
  await act(async () => option.click())
}

describe('subagent cast tab', () => {
  it('refreshes after native commit and uses only the revision read from the host for later writes', async () => mounted(async (dom, root) => {
    let current = state
    const client = api({ getCast: vi.fn(async () => current), setCastEnabled: vi.fn(async payload => {
      current = { ...current, enabled: payload.enabled, revision: 17 }
      return { committed: true }
    }) })
    await render(root, client)
    await act(async () => castSwitch(dom).click())
    expect(client.getCast).toHaveBeenCalledTimes(2)
    expect(castSwitch(dom).getAttribute('aria-checked')).toBe('false')
    expect(castSwitch(dom).disabled).toBe(false)
    expect(dom.window.document.querySelector('[role="status"]')).toBeNull()
    await choose(dom, triggers(dom)[0]!)
    expect(client.setCastRoute).toHaveBeenCalledWith({ index: 0, route: { provider: 'p', model: 'two' }, expectedRevision: 17 })
  }))

  it('reports native commit separately from failed refresh, locks stale controls and recovers without replay', async () => mounted(async (dom, root) => {
    let current = state, readFailed = false
    const client = api({ getCast: vi.fn(async () => { if (readFailed) throw Error('descriptor read failed after commit'); return current }),
      setCastEnabled: vi.fn(async payload => {
        current = { ...current, enabled: payload.enabled, revision: 23 }; readFailed = true
        return { committed: true }
      }),
    })
    await render(root, client)
    await act(async () => castSwitch(dom).click())
    expect(client.setCastEnabled).toHaveBeenCalledTimes(1)
    expect(client.getCast).toHaveBeenCalledTimes(2)
    expect(dom.window.document.querySelector('[role="alert"]')!.textContent).toContain('Saved; cast refresh failed: descriptor read failed after commit')
    expect(dom.window.document.body.textContent).not.toContain('Not saved')
    expect(castSwitch(dom).getAttribute('aria-checked')).toBe('true')
    expect(castSwitch(dom).disabled).toBe(true)
    expect(triggers(dom).every(button => button.disabled)).toBe(true)
    expect(removes(dom).every(button => button.disabled)).toBe(true)
    expect(tendencies(dom).every(input => input.disabled)).toBe(true)
    readFailed = false
    await act(async () => refreshButton(dom).click())
    expect(client.setCastEnabled).toHaveBeenCalledTimes(1)
    expect(castSwitch(dom).getAttribute('aria-checked')).toBe('false')
    expect(castSwitch(dom).disabled).toBe(false)
    expect(dom.window.document.querySelector('[role="alert"]')).toBeNull()
    await act(async () => castSwitch(dom).click())
    expect(client.setCastEnabled).toHaveBeenLastCalledWith({ enabled: true, expectedRevision: 23 })
  }))

  it('ends saving after the commit acknowledgement while a slow native refresh is pending', async () => mounted(async (dom, root) => {
    const next = deferred<CastState>(), save = deferred<CastCommit>()
    const client = api({ getCast: vi.fn(async () => state).mockResolvedValueOnce(state).mockImplementationOnce(() => next.promise),
      setCastEnabled: vi.fn(() => save.promise),
    })
    await render(root, client)
    await act(async () => castSwitch(dom).click())
    expect(dom.window.document.body.textContent).toContain('Saving…')
    await act(async () => save.resolve({ committed: true }))
    expect(dom.window.document.body.textContent).toContain('Saved. List changes apply to new conversations.')
    expect(dom.window.document.body.textContent).not.toContain('Saving…')
    expect(castSwitch(dom).disabled).toBe(true)
    await act(async () => next.resolve({ ...state, enabled: false, revision: 50 }))
    expect(castSwitch(dom).getAttribute('aria-checked')).toBe('false')
    expect(castSwitch(dom).disabled).toBe(false)
  }))
  it('renders the enabled state with one row per route, tendency drafts and the add control', async () => mounted(async (dom, root) => {
    await render(root, api())
    expect(castSwitch(dom).getAttribute('aria-checked')).toBe('true')
    expect(castSwitch(dom).getAttribute('aria-label')).toBe('Enable subagent cast')
    expect(dom.window.document.body.textContent).toContain('Task tendencies guide delegation.')
    expect(dom.window.document.body.textContent).toContain('Existing conversations and their subagents keep their saved lists.')
    expect(triggers(dom)).toHaveLength(3)
    expect(triggers(dom)[0]!.textContent).toContain('Provider / One')
    expect(triggers(dom)[1]!.textContent).toContain('Provider / Two')
    expect(triggers(dom)[2]!.textContent).toContain('Add model…')
    expect(tendencies(dom).map(input => input.value)).toEqual(['reviews', ''])
    expect(removes(dom).map(button => button.getAttribute('aria-label'))).toEqual(['Remove p / one', 'Remove p / two'])
  }))

  it('renders the empty state and a switched-off cast in zh', async () => mounted(async (dom, root) => {
    await render(root, api({ getCast: vi.fn(async () => ({ enabled: false, revision: 1, routes: [] })) }), 'zh-CN')
    expect(castSwitch(dom).getAttribute('aria-checked')).toBe('false')
    expect(castSwitch(dom).getAttribute('aria-label')).toBe('启用子代理阵容')
    expect(dom.window.document.body.textContent).toContain('名单修改对新建会话生效，已有会话及其子代理沿用原名单。')
    expect(dom.window.document.body.textContent).toContain('先添加模型，再启用显式模型选择。移除最后一个模型会关闭开关。')
    expect(triggers(dom)).toHaveLength(1)
    expect(triggers(dom)[0]!.textContent).toContain('添加模型…')
    expect(castSwitch(dom).disabled).toBe(true)
  }))

  it('allows switching off an existing enabled empty cast and keeps native controls during tendency failure', async () => mounted(async (dom, root) => {
    const client = api({ getCast: async () => ({ enabled: true, revision: 2, routes: [], tendencyError: 'store damaged' }) })
    await render(root, client)
    expect(castSwitch(dom).disabled).toBe(false)
    expect(triggers(dom)[0]!.disabled).toBe(false)
    expect(dom.window.document.querySelector('[role="alert"]')!.textContent).toContain('original file is preserved')
    await act(async () => castSwitch(dom).click())
    expect(client.setCastEnabled).toHaveBeenCalledWith({ enabled: false, expectedRevision: 2 })
  }))

  it('preserves a dirty draft and its old revision on remote changes, then explicitly rebases on user refresh', async () => mounted(async (dom, root) => {
    let changed!: () => void, current = state
    const client = api({ getCast: async () => current,
      subscribeChanges: onChange => { changed = onChange; return () => {} },
      setCastTendency: vi.fn(async payload => {
        if (payload.expectedRevision !== current.tendencyRevision) throw Error('Cast tendencies changed; refresh and retry')
        return current = { ...current, tendencyRevision: payload.expectedRevision + 1, routes: [{ ...current.routes[0]!, tendency: payload.tendency }, current.routes[1]!] }
      }),
    })
    await render(root, client)
    await act(async () => Simulate.change(tendencies(dom)[0]!, { target: { value: 'local draft' } } as never))
    current = { ...state, tendencyRevision: 3, routes: [{ ...state.routes[0]!, tendency: 'remote note' }, state.routes[1]!] }
    await act(async () => changed())
    expect(tendencies(dom)[0]!.value).toBe('local draft')
    expect(dom.window.document.body.textContent).toContain('Currently saved: remote note')
    await act(async () => Simulate.blur(tendencies(dom)[0]!))
    expect(client.setCastTendency).toHaveBeenCalledExactlyOnceWith({ provider: 'p', model: 'one', tendency: 'local draft', expectedRevision: 2 })
    expect(dom.window.document.body.textContent).toContain('your draft is preserved')
    await act(async () => dom.window.document.querySelector<HTMLButtonElement>('.cast-banner button')!.click())
    expect(tendencies(dom)[0]!.value).toBe('local draft')
    expect(client.setCastTendency).toHaveBeenCalledTimes(1)
    await act(async () => Simulate.blur(tendencies(dom)[0]!))
    expect(client.setCastTendency).toHaveBeenLastCalledWith({ provider: 'p', model: 'one', tendency: 'local draft', expectedRevision: 3 })
    expect(tendencies(dom)[0]!.value).toBe('local draft')
    expect(dom.window.document.querySelector('[role="alert"]')).toBeNull()
  }))

  it('keeps drafts when an earlier route is removed and updates clean rows on notification', async () => mounted(async (dom, root) => {
    let changed!: () => void, current = state
    const client = api({ getCast: async () => current, subscribeChanges: onChange => { changed = onChange; return () => {} } })
    await render(root, client)
    await act(async () => Simulate.change(tendencies(dom)[1]!, { target: { value: 'second draft' } } as never))
    current = { ...state, revision: 6, tendencyRevision: 3, routes: [{ ...state.routes[1]!, index: 0, tendency: 'remote' }] }
    await act(async () => changed())
    expect(tendencies(dom)).toHaveLength(1)
    expect(tendencies(dom)[0]!.value).toBe('second draft')
    expect(dom.window.document.body.textContent).toContain('Currently saved: remote')
  }))

  it('shows the loading state before the first read resolves', async () => mounted(async (dom, root) => {
    const pending = deferred<CastState>()
    await render(root, api({ getCast: vi.fn(() => pending.promise) }))
    expect(dom.window.document.body.textContent).toContain('Loading…')
    expect(castSwitch(dom).disabled).toBe(true)
    await act(async () => pending.resolve(state))
    expect(dom.window.document.body.textContent).not.toContain('Loading…')
    expect(castSwitch(dom).disabled).toBe(false)
  }))

  it('rejects malformed catalogs and recovers through localized retry without mutating the cast', async () => mounted(async (dom, root) => {
    const modelCatalog = vi.fn(async (): Promise<unknown> => ({ ok: true, value: catalog }))
      .mockResolvedValueOnce({ groups: [{ id: 'p', models: null }] })
    const client = api({ modelCatalog })
    await render(root, client, 'zh-CN')
    expect(dom.window.document.body.textContent).toContain('Invalid model catalog')
    expect(triggers(dom).every(button => button.disabled)).toBe(true)
    const retry = Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === '重试')!
    expect(retry).toBeDefined()
    await act(async () => retry.click())
    expect(dom.window.document.querySelector('[role="alert"]')).toBeNull()
    expect(triggers(dom)[0]!.textContent).toContain('Provider / One')
    expect(triggers(dom).every(button => !button.disabled)).toBe(true)
    expect(client.getCast).toHaveBeenCalledTimes(2)
    expect(client.listRunning).toHaveBeenCalledTimes(2)
    expect(client.setCastRoute).not.toHaveBeenCalled()
    expect(client.setCastEnabled).not.toHaveBeenCalled()
  }))

  it('retains available cast choices and identifies a partial provider failure', async () => mounted(async (dom, root) => {
    await render(root, api({ modelCatalog: async () => ({ ok: true, value: {
      ...catalog, failures: [{ id: 'offline', name: 'Offline provider', message: 'Sign in required' }],
    } }) }))
    expect(dom.window.document.querySelector('.dsh-model-catalog-status [role="status"]')!.textContent).toContain('Offline provider: Sign in required')
    expect(triggers(dom)[0]!.textContent).toContain('Provider / One')
    expect(triggers(dom).every(button => !button.disabled)).toBe(true)
  }))

  it('toggles the enabled switch with the CAS revision', async () => mounted(async (dom, root) => {
    const client = api()
    await render(root, client)
    await act(async () => castSwitch(dom).click())
    expect(client.setCastEnabled).toHaveBeenCalledTimes(1)
    expect(client.setCastEnabled).toHaveBeenCalledWith({ enabled: false, expectedRevision: 5 })
  }))

  it('changes a route model through the menu with its index and revision', async () => mounted(async (dom, root) => {
    const client = api()
    await render(root, client)
    await choose(dom, triggers(dom)[0]!)
    expect(client.setCastRoute).toHaveBeenCalledTimes(1)
    expect(client.setCastRoute).toHaveBeenCalledWith({ index: 0, route: { provider: 'p', model: 'two' }, expectedRevision: 5 })
  }))

  it('saves a tendency on blur only when it changed, and clears it with an empty string', async () => mounted(async (dom, root) => {
    const client = api()
    await render(root, client)
    const first = tendencies(dom)[0]!
    await act(async () => Simulate.blur(first))
    expect(client.setCastTendency).not.toHaveBeenCalled()
    await act(async () => Simulate.change(first, { target: { value: 'code review' } } as never))
    await act(async () => Simulate.blur(first))
    expect(client.setCastTendency).toHaveBeenCalledTimes(1)
    expect(client.setCastTendency).toHaveBeenCalledWith({ provider: 'p', model: 'one', tendency: 'code review', expectedRevision: 2 })
    const second = tendencies(dom)[1]!
    await act(async () => Simulate.blur(second))
    expect(client.setCastTendency).toHaveBeenCalledTimes(1)
  }))

  it('removes a route and adds a picked model with the CAS revision', async () => mounted(async (dom, root) => {
    const client = api()
    await render(root, client)
    await act(async () => removes(dom)[0]!.click())
    expect(client.removeCastRoute).toHaveBeenCalledWith({ index: 0, expectedRevision: 5 })
    await choose(dom, triggers(dom)[2]!)
    expect(client.addCastRoute).toHaveBeenCalledTimes(1)
    expect(client.addCastRoute).toHaveBeenCalledWith({ route: { provider: 'p', model: 'two' }, expectedRevision: 5 })
  }))

  it('addresses writes by the host raw route index, not the array position', async () => mounted(async (dom, root) => {
    const skewed: CastState = { enabled: true, revision: 9, routes: [
      { index: 1, provider: 'p', model: 'one' },
      { index: 3, provider: 'p', model: 'two' },
    ] }
    const client = api({
      getCast: vi.fn(async () => skewed),
      setCastRoute: vi.fn(async () => ({ committed: true as const })),
      removeCastRoute: vi.fn(async () => ({ committed: true as const })),
    })
    await render(root, client)
    await choose(dom, triggers(dom)[0]!)
    expect(client.setCastRoute).toHaveBeenCalledWith({ index: 1, route: { provider: 'p', model: 'two' }, expectedRevision: 9 })
    await act(async () => removes(dom)[1]!.click())
    expect(client.removeCastRoute).toHaveBeenCalledWith({ index: 3, expectedRevision: 9 })
  }))

  it('surfaces a duplicate add rejection and clears it on refresh', async () => mounted(async (dom, root) => {
    const addCastRoute = vi.fn(async () => { throw new Error('Route already exists') })
    const client = api({ addCastRoute })
    await render(root, client)
    await choose(dom, triggers(dom)[2]!)
    expect(dom.window.document.querySelector('[role="alert"]')!.textContent).toContain('Route already exists')
    expect(castSwitch(dom).disabled).toBe(true)
    await act(async () => dom.window.document.querySelector<HTMLButtonElement>('.cast-banner button')!.click())
    expect(client.getCast).toHaveBeenCalledTimes(2)
    expect(dom.window.document.querySelector('[role="alert"]')).toBeNull()
    expect(castSwitch(dom).disabled).toBe(false)
  }))

  it('flags a revision conflict, locks the page and recovers via the banner refresh', async () => mounted(async (dom, root) => {
    const setCastRoute = vi.fn(async () => { throw new Error('Settings changed; refresh and retry') })
    const client = api({ setCastRoute })
    await render(root, client)
    await choose(dom, triggers(dom)[0]!)
    const banner = dom.window.document.querySelector('[role="alert"]')!
    expect(banner.textContent).toContain('Cast settings changed elsewhere; your draft is preserved. Refresh, review, then try again.')
    expect(banner.textContent).not.toContain('Settings changed; refresh and retry')
    expect(castSwitch(dom).disabled).toBe(true)
    expect(triggers(dom).every(button => button.disabled)).toBe(true)
    expect(tendencies(dom).every(input => input.disabled)).toBe(true)
    expect(removes(dom).every(button => button.disabled)).toBe(true)
    await act(async () => banner.querySelector<HTMLButtonElement>('button')!.click())
    expect(client.getCast).toHaveBeenCalledTimes(2)
    expect(setCastRoute).toHaveBeenCalledTimes(1)
    expect(dom.window.document.querySelector('[role="alert"]')).toBeNull()
    expect(castSwitch(dom).disabled).toBe(false)
  }))

  it('locks every control while a tendency write is in flight', async () => mounted(async (dom, root) => {
    const write = deferred<CastState>()
    const client = api({ setCastTendency: vi.fn(() => write.promise) })
    await render(root, client)
    const input = tendencies(dom)[0]!
    await act(async () => Simulate.change(input, { target: { value: 'triage' } } as never))
    await act(async () => Simulate.blur(input))
    expect(dom.window.document.body.textContent).toContain('Saving…')
    expect(castSwitch(dom).disabled).toBe(true)
    expect(triggers(dom).every(button => button.disabled)).toBe(true)
    expect(tendencies(dom).every(row => row.disabled)).toBe(true)
    expect(refreshButton(dom).disabled).toBe(true)
    await act(async () => write.resolve({ ...state, routes: [{ ...state.routes[0]!, tendency: 'triage' }, state.routes[1]!] }))
    expect(castSwitch(dom).disabled).toBe(false)
    expect(tendencies(dom)[0]!.value).toBe('triage')
  }))

  it('renders running subagents with routes, adapter-default efforts, pending and remote rows', async () => mounted(async (dom, root) => {
    const client = api({
      listRunning: vi.fn(async () => ({ revision: 3, entries: [
        { id: 'child-one', label: 'reviewer', parentSessionId: 'parent', local: true, startedAt: 10,
          route: { provider: 'deepseek', model: 'chat', reasoningEffort: 'high' } },
        { id: 'child-two', local: true, startedAt: 20,
          route: { provider: 'openai', model: 'gpt-5', reasoningEffort: 'medium' }, effortIsAdapterDefault: true },
        { id: 'child-three', label: 'queued', local: true, startedAt: 30 },
        { id: 'child-four', label: 'remote-run', local: false, startedAt: 40 },
      ] })),
    })
    await render(root, client)
    const body = dom.window.document.body.textContent || ''
    expect(body).toContain('Running subagents')
    expect(body).toContain('reviewer')
    expect(body).toContain('deepseek / chat · high')
    expect(body).toContain('child-two')
    expect(body).toContain('openai / gpt-5 · medium (adapter default)')
    expect(body).toContain('No model request yet')
    expect(body).toContain('Remote subagent; route unavailable')
    expect(body).not.toContain('No subagents are running.')
  }))

  it('renders the empty running state and surfaces a running read failure in zh', async () => mounted(async (dom, root) => {
    await render(root, api(), 'zh-CN')
    expect(dom.window.document.body.textContent).toContain('运行中的子代理')
    expect(dom.window.document.body.textContent).toContain('当前没有运行中的子代理。')
  }))

  it('surfaces a running read failure without blocking the cast controls', async () => mounted(async (dom, root) => {
    const client = api({ listRunning: vi.fn(async () => { throw new Error('registry gone') }) })
    await render(root, client)
    expect(dom.window.document.body.textContent).toContain('Running state failed: registry gone')
    expect(castSwitch(dom).disabled).toBe(false)
  }))

  it('refetches the running list on change notifications', async () => mounted(async (dom, root) => {
    let changed!: () => void
    const client = api({ subscribeChanges: onChange => { changed = onChange; return () => {} } })
    await render(root, client)
    expect(client.listRunning).toHaveBeenCalledTimes(1)
    await act(async () => changed())
    expect(client.listRunning).toHaveBeenCalledTimes(2)
  }))

  it('refreshes on a change notification and reports sync failures', async () => mounted(async (dom, root) => {
    let changed!: () => void, failed!: (message: string) => void
    const client = api({
      subscribeChanges: (onChange, onError) => { changed = onChange; failed = onError!; return () => {} },
    })
    await render(root, client)
    await act(async () => changed())
    expect(client.getCast).toHaveBeenCalledTimes(2)
    await act(async () => failed('Model settings sync service unavailable'))
    expect(dom.window.document.querySelector('[role="alert"]')!.textContent).toContain('Live sync unavailable: Model settings sync service unavailable')
  }))
})
