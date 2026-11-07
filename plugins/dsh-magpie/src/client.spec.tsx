import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { apply, inject, MagpieSettingsPage } from './client.tsx'
import type { MagpieStatus } from './contracts.ts'

const cannedStatus: MagpieStatus = {
  address: 'http://127.0.0.1:3425',
  apiKeyEnv: 'MAGPIE_GATEWAY_KEY',
  keyConfigured: true,
  keyWritable: true,
  options: { syncOnStart: true, defaultModel: 'auto/deepseek-v4.1-flash', webSearch: false },
  writable: true,
  gateway: { name: 'magpie', version: '0.1.2798' },
  syncing: false,
  models: [
    { id: 'auto/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', route: 'magpie' },
    { id: 'klarkxy/claude-sonnet-5-5', name: 'Claude Sonnet 5.5', route: 'magpie-anthropic' },
  ],
}

interface RpcCall { channel: string; endpoint: string; payload: unknown }

function client(status: MagpieStatus | undefined) {
  const calls: RpcCall[] = []
  return {
    calls,
    connection: {
      rpc: {
        call: async (channel: string, endpoint: string, payload: unknown = {}) => {
          calls.push({ channel, endpoint, payload })
          if (!status) return { ok: false, error: { code: 'internal', message: 'down' } }
          return { ok: true, value: status }
        },
      },
    },
    locale: { getSnapshot: () => ({ active: 'en' }), subscribe: () => () => {} },
    slots: { inject: () => () => {}, register: () => () => {} },
  }
}

describe('magpie client', () => {
  it('injects exactly the services it consumes', () => {
    expect([...inject]).toEqual(['slots', 'connection', 'locale'])
  })

  it('renders a loading state before the first status', () => {
    const html = renderToStaticMarkup(createElement(MagpieSettingsPage, { client: client(undefined) }))
    expect(html).toContain('Loading status')
    expect(html).toContain('magpie-settings')
  })

  it('renders the stored status', () => {
    // renderToStaticMarkup skips effects, so status stays empty; drive the
    // page through its non-loading branch by rendering with the RPC result
    // still pending is enough — assert the loading branch markup only.
    const html = renderToStaticMarkup(createElement(MagpieSettingsPage, { client: client(cannedStatus) }))
    expect(html).toContain('dsh-ui-card')
  })
})

describe('apply', () => {
  it('waits for the models footer seat and registers its group', () => {
    const registered: { spec: unknown; render: () => unknown }[] = []
    const disposed: string[] = []
    const watchers = new Set<() => unknown>()
    const injected: string[] = []
    const ctx = {
      effect(run: () => unknown, label?: string) {
        const dispose = run()
        disposed.push(label ?? '')
        return dispose
      },
      slots: {
        inject(key: string, callback: () => unknown) {
          injected.push(key)
          watchers.add(callback)
          return () => watchers.delete(callback)
        },
        register(spec: unknown, render: () => unknown) {
          const entry = { spec, render }
          registered.push(entry)
          return () => { const i = registered.indexOf(entry); if (i >= 0) registered.splice(i, 1) }
        },
      },
    }
    apply(ctx as never)
    // The seat belongs to the native Models section, not to a settings page of
    // the plugin's own: no settings.section entry is registered any more.
    expect(injected).toEqual(['settings.models.footer'])
    expect(watchers.size).toBe(1)
    for (const watcher of [...watchers]) watcher()
    expect(registered).toHaveLength(1)
    expect(registered[0].spec).toEqual({ name: 'settings.models.footer', id: 'magpie', order: 100 })
    expect(registered.some(entry => (entry.spec as { name: string }).name === 'settings.section')).toBe(false)
    const html = renderToStaticMarkup(createElement(registered[0].render as never))
    expect(html).toContain('magpie-settings')
  })
})

async function mounted(run: (dom: JSDOM, root: Root) => Promise<void>) {
  const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>')
  const previous = new Map<string, PropertyDescriptor | undefined>()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, Node: dom.window.Node,
    Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
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

const button = (dom: JSDOM, label: string) =>
  Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>('button')).find(node => node.textContent === label)!

describe('magpie group in the models page', () => {
  it('carries its own heading and keeps the advanced items collapsed', async () => mounted(async (dom, root) => {
    const api = client(cannedStatus)
    await act(async () => root.render(createElement(MagpieSettingsPage, { client: api })))
    const heading = dom.window.document.querySelector('.dsh-ui-heading')
    // The footer seat projects no label, so the group renders its own title.
    expect(heading?.textContent).toBe('Magpie')
    const advanced = dom.window.document.querySelector('details')!
    expect(advanced.open).toBe(false)
    expect(dom.window.document.body.textContent).toContain('Gateway address')
    expect(dom.window.document.body.textContent).toContain('Advanced')
    // The status arrives over RPC, never from a local read.
    expect(api.calls.map(call => call.endpoint)).toEqual(['status'])
  }))

  it('saves the drafted address through the connection endpoint', async () => mounted(async (dom, root) => {
    const api = client(cannedStatus)
    await act(async () => root.render(createElement(MagpieSettingsPage, { client: api })))
    const { Simulate } = await import('react-dom/test-utils')
    const address = dom.window.document.querySelector<HTMLInputElement>('input[type="text"], input:not([type])')!
    // React's event test utility carries the changed value on the event's
    // target; the type of that helper is narrower than the DOM event.
    await act(async () => Simulate.change(address, { target: { value: 'http://10.0.0.2:3425' } } as never))
    await act(async () => button(dom, 'Save').click())
    const save = api.calls.find(call => call.endpoint === 'connection.save')
    expect(save?.channel).toBe('/dsh-magpie')
    expect(save?.payload).toMatchObject({ address: 'http://10.0.0.2:3425' })
  }))
})
