import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import {
  SubagentCatalogAction, SubagentHeaderLineage, subagentCatalogCopy,
  type SubagentAddress, type SubagentSessionsState,
} from './client-subagent-catalog.tsx'
import { apply } from './client.tsx'

/* One session store: five children with different route states. */
const STATE: SubagentSessionsState = {
  byId: {
    root: { id: 'root', title: 'Root' },
    child1: { id: 'child1', title: 'Reviewer', projectionValues: { modelSelection: { lastUsed: { provider: 'p', model: 'reasoner', reasoningEffort: 'high' } } } },
    child2: { id: 'child2', title: 'Planner', projectionValues: { modelSelection: { lastUsed: null, next: { provider: 'p', model: 'pending-model' } } } },
    child3: { id: 'child3', title: 'Remote' },
    child4: { id: 'child4', title: 'Plain', projectionValues: { modelSelection: { lastUsed: { provider: 'p', model: 'plain' } } } },
    child5: { id: 'child5', title: 'Cold' },
    grand1: { id: 'grand1', title: 'Grandchild' },
  },
  projectionsBySession: {
    root: {
      state: 'ready',
      values: {
        subagentCatalog: [
          { id: 'child1', label: 'Reviewer', mode: 'one-shot' },
          { id: 'child2', label: 'Planner', mode: 'continuable' },
          { id: 'child3', label: 'Remote', mode: 'external' },
          { id: 'child4', label: 'Plain', mode: 'one-shot' },
          { id: 'child5', label: 'Cold', mode: 'one-shot' },
        ],
      },
    },
    child1: { state: 'ready', values: { subagentCatalog: [{ id: 'grand1', label: 'Grandchild', mode: 'one-shot' }] } },
  },
}

type CatalogProps = Parameters<typeof SubagentCatalogAction>[0]

function catalogProps(overrides: Partial<CatalogProps> = {}): CatalogProps {
  return {
    sessionId: 'root',
    useSessions: <T,>(selector: (state: SubagentSessionsState) => T): T => selector(STATE),
    useSessionStatus: <T,>(selector: (state: ReadonlyMap<string, { running?: boolean }>) => T): T => selector(new Map()),
    openChild: vi.fn(),
    openChildAside: vi.fn(),
    refreshProjection: vi.fn(),
    locale: 'en',
    hostT: (key, params) => `${key}${params ? ` ${JSON.stringify(params)}` : ''}`,
    ...overrides,
  }
}

async function mounted(run: (dom: JSDOM, root: Root) => Promise<void>) {
  const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>')
  const previous = new Map<string, PropertyDescriptor | undefined>()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, Node: dom.window.Node,
    Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    IS_REACT_ACT_ENVIRONMENT: true })) {
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

/** Open the catalog popup of the first rendered cell. */
async function openCatalog(dom: JSDOM): Promise<void> {
  const trigger = dom.window.document.querySelector<HTMLButtonElement>('[aria-haspopup="tree"]')!
  await act(async () => trigger.click())
}

/** The readout line of every rendered catalog row. */
function routeLines(dom: JSDOM): string[] {
  return Array.from(dom.window.document.querySelectorAll('.mh-route')).map(node => node.textContent ?? '')
}

describe('subagent catalog model readout', () => {
  it('shows the model and effort each child actually used, with the default effort', async () => mounted(async (dom, root) => {
    await act(async () => root.render(createElement(SubagentCatalogAction, catalogProps())))
    await openCatalog(dom)
    const lines = routeLines(dom)
    expect(lines[0]).toBe('reasoner · high')
    // A selection without an effort reports the model default.
    expect(lines[3]).toBe('plain · Default')
  }))

  it('never presents a pending selection or an unreadable child as a used route', async () => mounted(async (dom, root) => {
    await act(async () => root.render(createElement(SubagentCatalogAction, catalogProps())))
    await openCatalog(dom)
    const lines = routeLines(dom)
    // `next` is the selection for the next request; it is not a used route.
    expect(lines[1]).toBe('No model request yet')
    // An external child's route is not readable from this session.
    expect(lines[2]).toBe('Not applicable')
    expect(dom.window.document.body.textContent).not.toContain('pending-model')
    expect(dom.window.document.body.textContent).not.toContain('Reasoner')
  }))

  it('shows only the model basename, with the full route on hover', async () => mounted(async (dom, root) => {
    const state = structuredClone(STATE)
    state.byId.child1!.projectionValues!.modelSelection!.lastUsed = { provider: 'magpie-anthropic', model: 'minimax-code/MiniMax-M3.1-Flash', reasoningEffort: 'high' }
    await act(async () => root.render(createElement(SubagentCatalogAction, catalogProps({ useSessions: selector => selector(state) }))))
    await openCatalog(dom)
    const route = dom.window.document.querySelector<HTMLElement>('.mh-route')!
    expect(route.textContent).toBe('MiniMax-M3.1-Flash · high')
    expect(route.title).toBe('magpie-anthropic / minimax-code/MiniMax-M3.1-Flash · high')
  }))

  it('asks the host once for a child whose projections are not loaded', async () => {
    await mounted(async (dom, root) => {
      const refreshProjection = vi.fn()
      await act(async () => root.render(createElement(SubagentCatalogAction, catalogProps({ refreshProjection }))))
      await openCatalog(dom)
      expect(routeLines(dom)[4]).toBe('Loading…')
      expect(refreshProjection).toHaveBeenCalledTimes(1)
      expect(refreshProjection).toHaveBeenCalledWith('child5')
      // A re-render must not turn the unreadable child into a request loop.
      await act(async () => root.render(createElement(SubagentCatalogAction, catalogProps({ refreshProjection }))))
      expect(refreshProjection).toHaveBeenCalledTimes(1)
    })
  })

  it('keeps the readout out of the treeitem open action', async () => mounted(async (dom, root) => {
    const openChild = vi.fn<(address: SubagentAddress) => void>()
    await act(async () => root.render(createElement(SubagentCatalogAction, catalogProps({ openChild }))))
    await openCatalog(dom)
    const row = dom.window.document.querySelector<HTMLElement>('[role="treeitem"]')!
    expect(row.getAttribute('aria-label')).toContain('reasoner · high')
    await act(async () => row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
    expect(openChild).toHaveBeenCalledTimes(1)
    expect(openChild).toHaveBeenCalledWith({ parentSessionId: 'root', childSessionId: 'child1', mode: 'one-shot' })
  }))

  it('reports a failed projection read and lets the user retry', async () => mounted(async (dom, root) => {
    const refreshProjection = vi.fn()
    const state = structuredClone(STATE)
    state.projectionsBySession.child5 = { state: 'error', error: { message: 'offline' }, values: {} }
    await act(async () => root.render(createElement(SubagentCatalogAction, catalogProps({ refreshProjection, useSessions: selector => selector(state) }))))
    await openCatalog(dom)
    expect(routeLines(dom)[4]).toBe('Could not load model information. Click to retry.')
    expect(refreshProjection).not.toHaveBeenCalled()
    await act(async () => dom.window.document.querySelector<HTMLButtonElement>('.mh-route-retry')!.click())
    expect(refreshProjection).toHaveBeenCalledExactlyOnceWith('child5')
  }))

  it('keeps the readout inside the card without a separate action', async () => mounted(async (dom, root) => {
    const openChild = vi.fn<(address: SubagentAddress) => void>()
    await act(async () => root.render(createElement(SubagentCatalogAction, catalogProps({ openChild }))))
    await openCatalog(dom)
    const line = dom.window.document.querySelector<HTMLElement>('.mh-route')!
    expect(line.closest('[role="treeitem"]')).not.toBeNull()
    await act(async () => line.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
    expect(openChild).toHaveBeenCalledTimes(1)
  }))

  it('keeps the lineage switcher and the descendant count on a child session', async () => mounted(async (dom, root) => {
    await act(async () => root.render(createElement(SubagentHeaderLineage, {
      ...catalogProps(),
      lineageSessionId: 'child1',
      displayTitle: 'Reviewer',
      useSession: <T,>(selector: (session: { subagent?: { address?: { childSessionId?: string; parentSessionId?: string } } }) => T): T =>
        selector({ subagent: { address: { childSessionId: 'child1', parentSessionId: 'root' } } }),
    })))
    const triggers = Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>('[aria-haspopup="tree"]'))
    // The ancestor switcher and the child's own descendant count.
    expect(triggers).toHaveLength(2)
    expect(triggers[0]!.getAttribute('aria-label')).toBe('switcher.aria {"title":"Reviewer"}')
    expect(triggers[1]!.getAttribute('aria-label')).toBe('count.total.one {"count":1}')
  }))

  it('drops a projection read that settles after the cell unmounted', async () => mounted(async (dom, root) => {
    const errors: unknown[][] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args) })
    try {
      let settle!: () => void
      const pending = new Promise<void>((yes) => { settle = yes })
      const refreshProjection = vi.fn(() => pending)
      await act(async () => root.render(createElement(SubagentCatalogAction, catalogProps({ refreshProjection }))))
      await openCatalog(dom)
      expect(refreshProjection).toHaveBeenCalledTimes(1)
      await act(async () => root.render(null))
      settle()
      await pending
      expect(dom.window.document.body.textContent).toBe('')
      expect(errors).toEqual([])
    } finally {
      spy.mockRestore()
    }
  }))

  it('clears its pending hover timers when the cell unmounts', async () => {
    vi.useFakeTimers()
    try {
      await mounted(async (dom, root) => {
        const setSpy = vi.spyOn(globalThis, 'setTimeout')
        const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
        await act(async () => root.render(createElement(SubagentCatalogAction, catalogProps())))
        const before = new Set(setSpy.mock.results.map(result => result.value))
        const trigger = dom.window.document.querySelector<HTMLButtonElement>('[aria-haspopup="tree"]')!
        await act(async () => { trigger.dispatchEvent(new dom.window.Event('pointerover', { bubbles: true })) })
        const opened = setSpy.mock.results.map(result => result.value).filter(id => !before.has(id))
        expect(opened.length).toBeGreaterThan(0)
        await act(async () => root.render(null))
        expect(opened.some(id => clearSpy.mock.calls.some(call => call[0] === id))).toBe(true)
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('registers both host catalog cells under the host ids at a lower priority', async () => {
    const waiting: Array<() => void> = []
    const registered: Array<{ options: Record<string, unknown>; component: unknown }> = []
    const cleanup: Array<() => void | Promise<void>> = []
    await apply({
      slots: {
        inject: (name: string, fn: () => void) => { waiting.push(fn) },
        register: (options: Record<string, unknown>, component: unknown) => { registered.push({ options, component }) },
      },
      connection: { rpc: { call: async () => ({ ok: true, value: [] }) } },
      remote: { session: { modelCatalog: async () => ({ ok: true, value: {} }) }, $mount: async () => async () => {} },
      effect: (callback: () => () => void | Promise<void>) => { cleanup.push(callback()) },
      inject(dependencies: string[], callback?: (scope: unknown) => void) {
        if (dependencies.length === 1 && dependencies[0] === 'remote') {
          callback?.({ remote: { $mount: async () => async () => {} }, effect(run: () => () => void | Promise<void>) { cleanup.push(run()) } })
        }
        return { dispose() {} }
      },
      locale: {
        bind(namespace: string) {
          expect(namespace).toBe('subagent')
          return (key: string, params?: Record<string, string | number>) => `${key}${params ? ` ${JSON.stringify(params)}` : ''}`
        },
      },
      sessions: { refreshProjections: async () => {} },
      uiWorkspace: { openSession: () => {} },
      sidebarRight: { openResource: () => {} },
      get: () => undefined,
    } as never)
    waiting.forEach(fn => fn())
    const actions = registered.find(entry => entry.options.name === 'conversation.session.header.actions')
    const lineage = registered.find(entry => entry.options.name === 'conversation.session.header.lineage')
    expect(actions?.options).toMatchObject({ id: 'subagent-catalog', order: 10, priority: -10 })
    expect(actions?.component).toBe(SubagentCatalogAction)
    expect(lineage?.options).toMatchObject({ name: 'conversation.session.header.lineage', priority: -10 })
    expect(lineage?.component).toBe(SubagentHeaderLineage)
    for (const dispose of cleanup.reverse()) await dispose()
  })

  it('keeps the catalog copy bilingual and complete', () => {
    expect(Object.keys(subagentCatalogCopy.zh)).toEqual(Object.keys(subagentCatalogCopy.en))
    for (const key of Object.keys(subagentCatalogCopy.en)) {
      expect(subagentCatalogCopy.en[key as keyof typeof subagentCatalogCopy.en], `en.${key}`).not.toMatch(/[\u3400-\u9fff]/)
    }
  })
})
