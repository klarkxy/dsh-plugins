import { Context } from '@deepseek-ai/cordis'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import {
  AUXILIARY_MODEL_SEAT_ID, AUXILIARY_MODEL_SEAT_ORDER, AuxiliaryModelCard,
  auxiliaryModelCss, registerAuxiliaryModelSettings,
} from './auxiliary-model-client.tsx'
import {
  SESSION_SETTINGS_ITEM_SLOT, SESSION_SETTINGS_SECTION_ID, SETTINGS_SECTION_ICON_SLOT,
} from './contracts.ts'
import { OFFICIAL_THEME_TOKEN_NAMES } from './official-ui.ts'

const ok = (value: unknown) => ({ ok: true, value })
const catalog = { groups: [{ id: 'p', name: 'P', models: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }] }

/*
 * The card's slot mechanics run against a real Cordis root: every participant
 * loads its own bundled copy of this module, so the only rendezvous is the
 * root context service — exactly what these tests exercise with one Context
 * and several plugin-shaped child contexts.
 */
interface FakeEntry { spec: Record<string, unknown>; render: unknown }

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(yes => { resolve = yes })
  return { promise, resolve }
}

/** A Cordis root wired like the client harness: slots + a mountable remote. */
function createSharedRoot(registrations: FakeEntry[], remote?: object) {
  const app = new Context()
  const mounts: unknown[] = []
  const unmounts: unknown[] = []
  app.provide('slots', {
    inject(_key: string, callback: () => (() => void) | void) {
      const dispose = callback()
      return () => { dispose?.() }
    },
    register(spec: Record<string, unknown>, render: unknown) {
      const entry: FakeEntry = { spec, render }
      registrations.push(entry)
      return () => {
        const at = registrations.indexOf(entry)
        if (at >= 0) registrations.splice(at, 1)
      }
    },
  })
  app.provide('remote', remote ?? {
    async $mount(contribution: unknown) {
      mounts.push(contribution)
      return async () => { unmounts.push(contribution) }
    },
  })
  return { app, mounts, unmounts }
}

function participantContext(app: Context) {
  return (app as unknown as { extend(meta: object): Context }).extend({})
}

/** Cordis fiber load/dispose takes several scheduler turns; poll, never sleep-race. */
async function until(probe: () => boolean, tries = 50) {
  for (let i = 0; i < tries && !probe(); i++) await new Promise(resolve => setImmediate(resolve))
  expect(probe()).toBe(true)
}

const auxRows = (registrations: FakeEntry[]) =>
  registrations.filter(entry => entry.spec.name === SESSION_SETTINGS_ITEM_SLOT && entry.spec.id === AUXILIARY_MODEL_SEAT_ID)
const sectionRows = (registrations: FakeEntry[]) =>
  registrations.filter(entry => entry.spec.name === 'settings.section' && entry.spec.id === SESSION_SETTINGS_SECTION_ID)
const iconRows = (registrations: FakeEntry[]) =>
  registrations.filter(entry => entry.spec.name === SETTINGS_SECTION_ICON_SLOT && entry.spec.id === SESSION_SETTINGS_SECTION_ID)

describe('shared auxiliary model card seat', () => {
  it('mounts once for several participants and unmounts with the last one', async () => {
    const registrations: FakeEntry[] = []
    const { app, mounts, unmounts } = createSharedRoot(registrations)
    const first = participantContext(app)
    const second = participantContext(app)

    const disposeA = registerAuxiliaryModelSettings(first)
    const disposeB = registerAuxiliaryModelSettings(second)
    // The card alone creates the shared column: one section entry declaring
    // the item slot, one auxiliary-model row inside it, one shared nav icon.
    expect(auxRows(registrations)).toHaveLength(1)
    expect(auxRows(registrations)[0].spec).toMatchObject({
      name: SESSION_SETTINGS_ITEM_SLOT, id: AUXILIARY_MODEL_SEAT_ID, order: AUXILIARY_MODEL_SEAT_ORDER,
    })
    expect(sectionRows(registrations)).toHaveLength(1)
    expect(sectionRows(registrations)[0].spec.children)
      .toEqual({ [SESSION_SETTINGS_ITEM_SLOT]: { kind: 'list', scope: 'root' } })
    expect(iconRows(registrations)).toHaveLength(1)
    expect(iconRows(registrations)[0].spec.priority).toBe(AUXILIARY_MODEL_SEAT_ORDER)
    // No legacy footer seat: the card never registers into settings.models.footer.
    expect(registrations.some(entry => entry.spec.name === 'settings.models.footer')).toBe(false)
    // The serialized lease mounts the client-side watch contribution once.
    await until(() => mounts.length === 1)

    // First participant gone: the shared card stays.
    disposeA()
    expect(auxRows(registrations)).toHaveLength(1)
    // Repeated release is a no-op, never an unbalance.
    disposeA()
    expect(auxRows(registrations)).toHaveLength(1)
    disposeB()
    expect(auxRows(registrations)).toHaveLength(0)
    // The column and icon the card retained leave with it.
    expect(sectionRows(registrations)).toHaveLength(0)
    expect(iconRows(registrations)).toHaveLength(0)
    // The last release closes the lease: the fiber's effect unmounts the
    // contribution before the tail settles.
    await until(() => unmounts.length === mounts.length)
  })

  it('re-establishes a clean card after a full teardown', async () => {
    const registrations: FakeEntry[] = []
    const { app, mounts, unmounts } = createSharedRoot(registrations)
    const disposeFirst = registerAuxiliaryModelSettings(participantContext(app))
    expect(auxRows(registrations)).toHaveLength(1)
    await until(() => mounts.length === 1)
    disposeFirst()
    expect(auxRows(registrations)).toHaveLength(0)
    expect(sectionRows(registrations)).toHaveLength(0)
    await until(() => unmounts.length === mounts.length)
    // The lease left the store synchronously, so the next acquire remounts
    // cleanly instead of failing on "already registered".
    registerAuxiliaryModelSettings(participantContext(app))
    expect(auxRows(registrations)).toHaveLength(1)
    expect(sectionRows(registrations)).toHaveLength(1)
    await until(() => mounts.length === 2)
    expect(auxRows(registrations)).toHaveLength(1)
  })

  it('serializes mounts and unmounts: a remount waits for a still-pending unmount', async () => {
    const registrations: FakeEntry[] = []
    const unmountGates: Array<ReturnType<typeof deferred>> = []
    const { app, mounts, unmounts } = createSharedRoot(registrations, {
      async $mount(contribution: unknown) {
        mounts.push(contribution)
        const gate = deferred()
        unmountGates.push(gate)
        return async () => { await gate.promise; unmounts.push(contribution) }
      },
    })
    const disposeFirst = registerAuxiliaryModelSettings(participantContext(app))
    await until(() => mounts.length === 1)

    // The unmount is deliberately held: a remount issued right now must queue
    // behind it on the coordinator tail, not overlap a second contribution.
    disposeFirst()
    registerAuxiliaryModelSettings(participantContext(app))
    expect(mounts).toHaveLength(1)
    for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve))
    expect(mounts).toHaveLength(1)
    expect(unmounts).toHaveLength(0)
    expect(auxRows(registrations)).toHaveLength(1)
    unmountGates[0].resolve()
    await until(() => mounts.length === 2)
    expect(unmounts).toHaveLength(1)
  })

  it('never mounts at all when release beats the queued mount', async () => {
    const registrations: FakeEntry[] = []
    const unmountGates: Array<ReturnType<typeof deferred>> = []
    const { app, mounts, unmounts } = createSharedRoot(registrations, {
      async $mount(contribution: unknown) {
        mounts.push(contribution)
        const gate = deferred()
        unmountGates.push(gate)
        return async () => { await gate.promise; unmounts.push(contribution) }
      },
    })
    // A second incarnation queues its mount behind the held unmount, then its
    // only participant releases before the tail reaches it — the queued mount
    // must be skipped entirely instead of mounting into a dead service.
    const disposeFirst = registerAuxiliaryModelSettings(participantContext(app))
    await until(() => mounts.length === 1)
    disposeFirst()
    registerAuxiliaryModelSettings(participantContext(app))()
    for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve))
    expect(mounts).toHaveLength(1)
    unmountGates[0].resolve()
    for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve))
    expect(mounts).toHaveLength(1)
    expect(unmounts).toHaveLength(1)
    expect(auxRows(registrations)).toHaveLength(0)
    expect(sectionRows(registrations)).toHaveLength(0)
  })
})

interface StoredRow { revision: number; model: { provider: string; model: string; reasoningEffort?: string } | null }

async function mountCard(run: (dom: JSDOM, rpc: ReturnType<typeof vi.fn>, stored: StoredRow) => Promise<void>, options: {
  stored?: StoredRow
  get?: () => Promise<unknown>
  subscribe?: (change: () => void, error?: (message: string) => void) => () => void
} = {}) {
  const dom = new JSDOM('<html><head></head><body><div id="root"></div></body></html>')
  const previous = new Map<string, PropertyDescriptor | undefined>()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, Node: dom.window.Node,
    Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  dom.window.HTMLElement.prototype.scrollIntoView = () => {}
  const root = createRoot(dom.window.document.getElementById('root')!)
  const stored: StoredRow = options.stored ?? { revision: 3, model: { provider: 'p', model: 'a' } }
  const rpc = vi.fn(async (_channel: string, endpoint: string, payload?: { model?: StoredRow['model']; expectedRevision?: number }) => {
    switch (endpoint) {
      case 'defaults.get':
        if (options.get) return options.get()
        return ok(structuredClone(stored))
      case 'defaults.set': {
        if (payload?.expectedRevision !== stored.revision) {
          return { ok: false, error: { code: 'auxiliary-model/conflict', message: 'Auxiliary model settings changed; reload and retry' } }
        }
        stored.revision += 1
        stored.model = payload?.model && payload.model.provider ? structuredClone(payload.model) : null
        return ok(structuredClone(stored))
      }
      default: return { ok: false, error: { code: 'auxiliary-model/unknown-endpoint', message: endpoint } }
    }
  })
  const client = {
    connection: {
      rpc: { call: (channel: string, endpoint: string, payload?: unknown) => rpc(channel, endpoint, payload as never) },
      generation: { subscribe: () => () => {} },
    },
    remote: { session: { modelCatalog: async () => catalog } },
    locale: { getSnapshot: () => ({ active: 'en' }), subscribe: () => () => {} },
  }
  try {
    await act(async () => root.render(createElement(AuxiliaryModelCard, {
      client: client as never,
      subscribe: options.subscribe,
    })))
    await act(async () => { await Promise.resolve() })
    await run(dom, rpc, stored)
  } finally {
    await act(async () => root.unmount())
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
    dom.window.close()
  }
}

describe('AuxiliaryModelCard', () => {
  it('renders the stored pick and saves a new model over the shared channel', async () => {
    await mountCard(async (dom, rpc, stored) => {
      expect(dom.window.document.querySelector('[data-testid="auxiliary-model-settings"]')).toBeTruthy()
      const trigger = dom.window.document.querySelector<HTMLButtonElement>('.dsh-model-menu-trigger')!
      expect(trigger.textContent).toContain('P / A')
      // Drill into the model pane and pick B: one write with the shown revision.
      await act(async () => trigger.click())
      await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click())
      const row = [...dom.window.document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
        .find(item => item.textContent?.includes('B'))
      expect(row).toBeTruthy()
      await act(async () => row!.click())
      expect(stored.model).toEqual({ provider: 'p', model: 'b' })
      const [, endpoint, payload] = rpc.mock.calls.find(([, ep]) => ep === 'defaults.set')!
      expect(endpoint).toBe('defaults.set')
      expect(payload).toMatchObject({ model: { provider: 'p', model: 'b' }, expectedRevision: 3 })
      expect(dom.window.document.body.textContent).toContain('Saved.')
    })
  })

  it('clears the override through the leading follow row', async () => {
    await mountCard(async (dom, _rpc, stored) => {
      const trigger = dom.window.document.querySelector<HTMLButtonElement>('.dsh-model-menu-trigger')!
      await act(async () => trigger.click())
      await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click())
      const leading = [...dom.window.document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
        .find(item => item.textContent?.includes('Follow session or host default'))
      expect(leading).toBeTruthy()
      await act(async () => leading!.click())
      expect(stored.model).toBeNull()
      expect(dom.window.document.querySelector<HTMLButtonElement>('.dsh-model-menu-trigger')!.textContent)
        .toContain('Follow session or host default')
    })
  })

  it('shows a retry state when the stored row cannot be read', async () => {
    await mountCard(async dom => {
      expect(dom.window.document.body.textContent).toContain('Could not load model settings.')
      expect([...dom.window.document.querySelectorAll('button')].some(item => item.textContent === 'Retry')).toBe(true)
    }, { get: async () => ({ ok: false, error: { code: 'internal', message: 'storage gone' } }) })
  })

  it('maps a revision race to the stale copy instead of a generic failure', async () => {
    await mountCard(async (dom, _rpc, stored) => {
      const trigger = dom.window.document.querySelector<HTMLButtonElement>('.dsh-model-menu-trigger')!
      await act(async () => trigger.click())
      await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click())
      const row = [...dom.window.document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
        .find(item => item.textContent?.includes('B'))
      // Another window already advanced the revision behind this card.
      stored.revision += 1
      await act(async () => row!.click())
      expect(dom.window.document.body.textContent).toContain('Settings were changed elsewhere; refresh and retry.')
    }, { stored: { revision: 4, model: { provider: 'p', model: 'a' } } })
  })

  it('re-reads the row when the shared change stream invalidates', async () => {
    let change: (() => void) | undefined
    const subscribe = vi.fn((next: () => void) => { change = next; return () => {} })
    await mountCard(async (dom, rpc) => {
      const reads = () => rpc.mock.calls.filter(([, ep]) => ep === 'defaults.get').length
      expect(reads()).toBe(1)
      await act(async () => { change?.() })
      expect(reads()).toBe(2)
      expect(subscribe).toHaveBeenCalled()
    }, { subscribe })
  })

  it('surfaces an unavailable change stream without breaking the card', async () => {
    const subscribe = (_change: () => void, error?: (message: string) => void) => {
      error?.('Model settings sync service unavailable')
      return () => {}
    }
    await mountCard(async dom => {
      expect(dom.window.document.querySelector('[data-testid="auxiliary-model-settings"]')).toBeTruthy()
      expect(dom.window.document.body.textContent).toContain('Automatic refresh unavailable')
    }, { subscribe })
  })

  it('renders nothing service-dependent during SSR', () => {
    const client = {
      connection: { rpc: { call: async () => ok({ revision: 1, model: null }) }, generation: { subscribe: () => () => {} } },
      remote: {},
      locale: { getSnapshot: () => ({ active: 'zh' }), subscribe: () => () => {} },
    }
    const html = renderToStaticMarkup(createElement(AuxiliaryModelCard, { client: client as never }))
    expect(html).toContain('data-testid="auxiliary-model-settings"')
    expect(html).toContain('默认辅助模型')
  })

  it('ships only theme-token colors in its stylesheet', () => {
    const allowed = new Set(OFFICIAL_THEME_TOKEN_NAMES)
    // Only var(--token) references count: class modifiers like .dsh-ui-card--flat
    // carry a double hyphen but are selectors, not custom properties.
    for (const [, token] of auxiliaryModelCss.matchAll(/var\((--[\w-]+)/g)) {
      expect(allowed.has(token), `unexpected theme token ${token}`).toBe(true)
    }
    expect(auxiliaryModelCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(auxiliaryModelCss).not.toMatch(/\brgba?\(/)
  })
})
