import { Context } from '@deepseek-ai/cordis'
import { useNativeSeat } from '@klarkxy/dsh-plugin-kit/client-utils'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { TitleSettings } from './client.tsx'
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
 * plugin page gates its config section on exactly that set — so the settings UI
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

function fakeClient() {
  const session = store('session-under-test')
  return {
    uiWorkspace: { current: session },
    uiSession: { adapter: { current: store({ key: 'fallback' }) } },
    locale: { getSnapshot: () => ({ active: 'zh' }), subscribe: store('zh').subscribe },
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
  it('renders on the plugin page without reading a Cordis context', async () => {
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

  it('never hands the plugin context to the component', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('./client.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('owner={ctx}')
    expect(source).toContain('<TitleSettings client={client} marker={marker}')
  })
})
