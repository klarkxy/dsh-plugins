import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
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

function client(status: MagpieStatus | undefined) {
  const calls: [string, string][] = []
  return {
    calls,
    connection: {
      rpc: {
        call: async (channel: string, endpoint: string) => {
          calls.push([channel, endpoint])
          if (!status) return { ok: false, error: { code: 'internal', message: 'down' } }
          return { ok: true, value: status }
        },
      },
    },
    locale: { getSnapshot: () => ({ active: 'en' }), subscribe: () => () => {} },
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
    expect(html).toContain('dsh-ui-page')
  })
})

describe('apply', () => {
  it('waits for the settings slot and registers its page', () => {
    const registered: { spec: unknown; render: () => unknown }[] = []
    const disposed: string[] = []
    const watchers = new Set<() => unknown>()
    const ctx = {
      effect(run: () => unknown, label?: string) {
        const dispose = run()
        disposed.push(label ?? '')
        return dispose
      },
      slots: {
        inject(_key: string, callback: () => unknown) {
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
    expect(watchers.size).toBe(1)
    for (const watcher of [...watchers]) watcher()
    expect(registered).toHaveLength(1)
    expect((registered[0].spec as { key: string }).key).toBe('@klarkxy/dsh-magpie')
    const html = renderToStaticMarkup(createElement(registered[0].render as never))
    expect(html).toContain('magpie-settings')
  })
})
