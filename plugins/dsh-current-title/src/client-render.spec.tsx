import { Context } from '@deepseek-ai/cordis'
import { SESSION_SETTINGS_ITEM_SLOT, SESSION_SETTINGS_SECTION_ID } from '@klarkxy/dsh-plugin-kit/contracts'
import { useNativeSeat } from '@klarkxy/dsh-plugin-kit/client-utils'
import { act, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { TitleSettings, TitleSettingsItem, apply } from './client.tsx'
import { titleCopy } from './client-work.ts'
import { createTitleClientMarker } from './marker.ts'

/*
 * `@deepseek-ai/dsh-client-ui-primitives` is host-provided, and its published
 * bundle pulls in packages this workspace deliberately does not install. The
 * editor-plugin vitest config points that specifier at a shared double
 * (`scripts/editor-plugins/ui-primitives-stub.tsx`) that renders the same
 * elements, so this spec renders the seat for real — same tags, same props.
 */

/**
 * The settings seat used to receive the plugin's Cordis context as a prop. A
 * Cordis context throws on any undeclared property read, so `useNativeSeat`
 * reading `props.owner` off it crashed the very first render. The host's entry
 * boundary turned that into a one-shot abdication of the keyed cell: the
 * registration stayed on the ledger but dropped out of `entriesOfSlot`, and the
 * settings page gates its section on exactly that set — so the settings UI
 * never rendered again, on this load or any later one.
 *
 * These tests render for real, because a source-text assertion cannot see it.
 */

function store<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } },
  }
}

function fakeClient(locale = 'zh') {
  const session = store('session-under-test')
  return {
    uiWorkspace: { current: session },
    uiSession: { adapter: { current: store({ key: 'fallback' }) } },
    locale: { getSnapshot: () => ({ active: locale }), subscribe: store(locale).subscribe },
    sessions: { binding: () => undefined },
    connection: { generation: { subscribe: () => () => {} }, rpc: { call: async () => ({ ok: true, value: {} }) } },
  }
}

/** A loaded plugin's own context — the object `apply` closes over. */
async function pluginScopedContext(client: ReturnType<typeof fakeClient>) {
  let scoped: Context | undefined
  await new Context().plugin({
    name: 'current-title-client-fixture',
    apply(child) {
      child.provide('locale', { getSnapshot: () => ({ active: 'zh' }), subscribe: () => () => {} })
      child.provide('uiWorkspace', client.uiWorkspace)
      child.provide('uiSession', client.uiSession)
      scoped = child
    },
  })
  return scoped as Context
}

describe('current title settings seat', () => {
  it('renders in the settings section without reading a Cordis context', async () => {
    const client = fakeClient()
    const html = renderToString(<TitleSettings client={client as never} marker={createTitleClientMarker()} />)
    expect(html).toContain('data-testid="current-title-settings"')
  })

  it('tolerates a Cordis context handed to the shared seat resolver', async () => {
    const client = fakeClient()
    const ctx = await pluginScopedContext(client)
    // The failure this pins: the proxy throws rather than yielding undefined,
    // which used to abort the entry and abdicate its keyed cell.
    expect(() => (ctx as unknown as Record<string, unknown>).owner).toThrow(/without inject/)

    function SeatProbe({ owner }: { owner: unknown }) {
      const seat = useNativeSeat(client as never, owner)
      return <p data-seat={seat.sessionId}>{seat.locale}</p>
    }

    // Server rendering uses useSyncExternalStore's server snapshot, so the seat
    // resolves to its inert values; reaching this line at all is the assertion.
    const html = renderToString(<SeatProbe owner={ctx} />)
    expect(html).toContain('<p data-seat="">en</p>')
  })

  it('puts the open session in a labeled card and the defaults beside it', async () => {
    const copy = titleCopy.zh
    const status = {
      settings: { revision: 1, prompt: '', model: { provider: '', model: '' }, cadence: 'all-prompts' },
      support: { weOwn: true, nativeOwner: '@klarkxy/dsh-current-title' },
      session: { sessionId: 'session-under-test', title: '登录回调失败', generating: false, pinned: true },
    }
    const dom = new JSDOM('<div id="root"></div>')
    const previous = new Map<string, unknown>()
    for (const [key, value] of Object.entries({
      window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
      Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      previous.set(key, (globalThis as Record<string, unknown>)[key])
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
    const root = createRoot(dom.window.document.getElementById('root')!)
    try {
      const client = fakeClient()
      client.connection.rpc.call = async () => ({ ok: true, value: status })
      await act(async () => { root.render(<TitleSettings client={client as never} marker={createTitleClientMarker()} />) })
      await act(async () => { await Promise.resolve() })
      const session = dom.window.document.querySelector('[data-testid="current-title-session"]')!
      const defaults = dom.window.document.querySelector('[data-testid="current-title-defaults"]')!
      expect(session.className).toContain('dsh-ui-card')
      expect(session.querySelector('h3')!.textContent).toBe(copy.session)
      expect(session.querySelector('.dsh-ui-title')!.textContent).toBe('登录回调失败')
      expect(session.textContent).toContain(copy.pinned)
      expect(session.querySelector('button')).not.toBeNull()
      expect(session.textContent).toContain(copy.reload)
      expect(defaults.querySelector('h3')!.textContent).toBe(copy.defaults)
      expect(defaults.contains(session)).toBe(false)
      expect(defaults.querySelector('textarea')!.className).toBe('dsh-ui-textarea ct-prompt')
      expect(defaults.textContent).toContain(copy.promptHint)
      expect(copy.promptHint).toContain('离开输入框')
      expect(titleCopy.en.promptHint).toContain('Saves on blur')
      expect(defaults.querySelector('textarea')).not.toBeNull()
      expect(defaults.querySelector('.dsh-model-menu-trigger, select')).not.toBeNull()
      expect(defaults.querySelector('select')).not.toBeNull()
    } finally {
      await act(async () => root.unmount())
      dom.window.close()
      for (const [key, value] of previous) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
  })

  it('explains a missing session instead of rendering a blank title', async () => {
    const dom = new JSDOM('<div id="root"></div>')
    const previous = new Map<string, unknown>()
    for (const [key, value] of Object.entries({
      window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
      Node: dom.window.Node, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      previous.set(key, (globalThis as Record<string, unknown>)[key])
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
    const root = createRoot(dom.window.document.getElementById('root')!)
    try {
      await act(async () => { root.render(<TitleSettings client={fakeClient() as never} marker={createTitleClientMarker()} />) })
      await act(async () => { await Promise.resolve() })
      const html = dom.window.document.body.innerHTML
      expect(html).toContain(titleCopy.zh.session)
      expect(html).toContain(titleCopy.zh.noSession)
      expect(html).not.toContain('class="dsh-ui-title')
      expect(html).toContain(titleCopy.zh.defaults)
    } finally {
      await act(async () => root.unmount())
      dom.window.close()
      for (const [key, value] of previous) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
  })

  it('never hands the plugin context to the component', () => {
    // A slot component never receives `ctx`: the host composes its own props,
    // and a Cordis context throws on any undeclared property read — feeding one
    // back through `useNativeSeat` used to crash the entry and abdicate the
    // keyed cell (see the file header). The seat's render callback must close
    // over the client and marker instead.
    let view: (() => ReactElement) | undefined
    const registered: unknown[] = []
    // The shared page and the shared auxiliary card rendezvous through root
    // services: the fake needs a real provide/get store and a self-referential
    // `.root`, exactly like Cordis's own root context.
    const services = new Map<string, unknown>()
    const root = {
      slots: {
        inject: (_key: string, callback: () => unknown) => { callback(); return () => {} },
        register: (spec: unknown) => { registered.push(spec); return () => {} },
      },
      get: (name: string) => services.get(name),
      provide: (name: string, value: unknown) => {
        services.set(name, value)
        return () => { if (services.get(name) === value) services.delete(name) }
      },
      // mountModelSettingsChanges on the shared card resolves 'remote' lazily.
      inject: () => ({ dispose() {} }),
      root: undefined as unknown,
    }
    root.root = root
    apply({
      provide() {},
      effect: (fn: () => unknown) => { fn() },
      inject: (_deps: string[], callback: (scope: unknown) => void) => callback({ remote: { $mount: async () => async () => {} }, effect() {} }),
      slots: {
        inject: (_key: string, callback: () => unknown) => { callback(); return () => {} },
        // The nav-icon registration follows the row's; `view` keeps the row's
        // render so the no-ctx assertion below still targets the contributed
        // component, not the shared icon.
        register: (spec: unknown, render: () => ReactElement) => {
          registered.push(spec)
          // Only this plugin's row: the shared auxiliary card contributes a
          // second item-slot row through the root slots, and its render must
          // not replace the contributed component under test.
          const row = spec as { name?: string; id?: string }
          if (row.name === SESSION_SETTINGS_ITEM_SLOT && row.id === 'current-title') view = render
          return () => {}
        },
      },
      root,
      connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
      locale: { getSnapshot: () => ({ active: 'zh' }), subscribe: () => () => {} },
    } as never)
    expect(registered).toEqual([
      expect.objectContaining({ name: 'settings.section', id: SESSION_SETTINGS_SECTION_ID, order: 30 }),
      { name: SESSION_SETTINGS_ITEM_SLOT, id: 'current-title', order: 70 },
      { name: 'settings.section.icon', id: SESSION_SETTINGS_SECTION_ID, order: 70, priority: 70 },
      // The shared default-auxiliary-model card joined the same column: one
      // root-owned item row plus its own nav-icon share.
      { name: SESSION_SETTINGS_ITEM_SLOT, id: 'auxiliary-model', order: 55 },
      { name: 'settings.section.icon', id: SESSION_SETTINGS_SECTION_ID, order: 55, priority: 55 },
    ])
    expect(registered.some(spec => (spec as { name?: string }).name === 'settings.models.footer')).toBe(false)
    const element = view!()
    expect(element.type).toBe(TitleSettingsItem)
    expect(element.props).toHaveProperty('client')
    expect(element.props).toHaveProperty('marker')
    expect(element.props).not.toHaveProperty('owner')
  })

  it('mounts the settings body on first expand and keeps it mounted after collapsing', async () => {
    const dom = new JSDOM('<div id="root"></div>')
    const previous = new Map<string, unknown>()
    for (const [key, value] of Object.entries({
      window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
      Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      previous.set(key, (globalThis as Record<string, unknown>)[key])
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
    const root = createRoot(dom.window.document.getElementById('root')!)
    try {
      const client = fakeClient()
      client.connection.rpc.call = async () => ({ ok: true, value: { settings: { revision: 1, prompt: '', model: { provider: '', model: '' }, cadence: 'all-prompts' } } })
      await act(async () => { root.render(<TitleSettingsItem client={client as never} marker={createTitleClientMarker()} />) })
      const details = dom.window.document.querySelector('details')!
      // Collapsed by default: the body is not mounted and no status read ran.
      expect(details.open).toBe(false)
      expect(dom.window.document.querySelector('[data-testid="current-title-settings"]')).toBeNull()
      expect(details.querySelector('summary')!.textContent).toContain(titleCopy.zh.label)
      expect(details.querySelector('summary')!.textContent).toContain(titleCopy.zh.groupHint)
      await act(async () => { details.open = true; details.dispatchEvent(new dom.window.Event('toggle')) })
      await act(async () => { await Promise.resolve() })
      expect(dom.window.document.querySelector('[data-testid="current-title-settings"]')).not.toBeNull()
      // Collapsing keeps the mounted subtree so a prompt draft survives.
      await act(async () => { details.open = false; details.dispatchEvent(new dom.window.Event('toggle')) })
      expect(dom.window.document.querySelector('[data-testid="current-title-settings"]')).not.toBeNull()
    } finally {
      await act(async () => root.unmount())
      dom.window.close()
      for (const [key, value] of previous) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
  })

  it('shows the locale-table loading copy while the status is in flight', async () => {
    const dom = new JSDOM('<div id="root"></div>')
    const previous = new Map<string, unknown>()
    for (const [key, value] of Object.entries({
      window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
      Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      previous.set(key, (globalThis as Record<string, unknown>)[key])
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
    const root = createRoot(dom.window.document.getElementById('root')!)
    try {
      for (const locale of ['zh', 'en'] as const) {
        const client = fakeClient(locale)
        // The status read never settles, so the seat stays on the loading hint.
        client.connection.rpc.call = () => new Promise<never>(() => {})
        await act(async () => root.render(<TitleSettings client={client as never} marker={createTitleClientMarker()} />))
        expect(dom.window.document.querySelector('[data-testid="current-title-settings"]')!.textContent)
          .toContain(titleCopy[locale].loading)
      }
    } finally {
      await act(async () => root.unmount())
      dom.window.close()
      for (const [key, value] of previous) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
  })
})
