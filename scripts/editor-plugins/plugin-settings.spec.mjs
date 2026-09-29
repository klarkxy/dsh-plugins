import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { apply as memory } from '../../plugins/dsh-memory/src/client.tsx'
import { apply as webSearch } from '../../plugins/dsh-web-search-manager/src/client.tsx'
import { apply as zhihu } from '../../plugins/dsh-zhihu/src/client.tsx'

const slot = 'plugins.bundle.config'
const forbidden = ['settings.section', 'settings.plugins.tab', 'dsh-editor.settings.models', 'dsh-editor.settings.zhihu']
const statusChannels = ['/dsh-memory', '/dsh-web-search', '/zhihu']

function host(initial = []) {
  const declared = new Set(initial)
  const watchers = new Map()
  const registered = []
  const injected = []
  const effects = []
  const calls = []
  const credentials = { describe: async () => ({ ok: true, value: {} }), set: async () => { throw new Error('Unexpected credential write') }, unset: async () => { throw new Error('Unexpected credential delete') } }
  const ctx = {
    effect(run) { const dispose = run(); if (typeof dispose === 'function') effects.push(dispose) },
    connection: { rpc: { call: async (channel, endpoint) => { calls.push([channel, endpoint]); return { ok: true, value: { enabled: true } } } } },
    remote: { credentials, llm: {}, settings: {}, session: {} },
    sessions: {}, uiWorkspace: {},
    uiSession: { adapter: { current: { getSnapshot: () => ({}), subscribe: () => () => {} } } },
    locale: { getSnapshot: () => ({ active: 'en' }), subscribe: () => () => {} },
    slots: {
      inject(name, run) {
        injected.push(name)
        let child
        const watch = {
          attach() { child ??= run() },
          detach() { child?.(); child = undefined },
        }
        const list = watchers.get(name) ?? new Set()
        watchers.set(name, list); list.add(watch)
        if (declared.has(name)) watch.attach()
        return () => { watch.detach(); list.delete(watch) }
      },
      register(spec, render) {
        const entry = { spec, render }
        registered.push(entry)
        return () => { const index = registered.indexOf(entry); if (index >= 0) registered.splice(index, 1) }
      },
    },
  }
  return {
    ctx, registered, injected, calls,
    declare(name) { declared.add(name); for (const watcher of watchers.get(name) ?? []) watcher.attach() },
    undeclare(name) { declared.delete(name); for (const watcher of watchers.get(name) ?? []) watcher.detach() },
    dispose() {
      for (const dispose of effects.splice(0).reverse()) dispose()
      // Cordis also disposes direct slots.inject() registrations owned by this context.
      for (const listeners of watchers.values()) { for (const watcher of listeners) watcher.detach(); listeners.clear() }
    },
  }
}

const plugins = [
  ['@klarkxy/dsh-memory', memory],
  ['@klarkxy/dsh-web-search-manager', webSearch], ['@klarkxy/dsh-zhihu', zhihu],
]
const settle = () => new Promise(resolve => setImmediate(resolve))

describe('plugin settings page registrations', () => {
  for (const [pkg, apply] of plugins) {
    it(`${pkg} waits for its keyed page, survives redeclaration, and unloads cleanly`, async () => {
      const h = host([...forbidden, 'shell.overlay'])
      apply(h.ctx)
      await settle()
      expect(h.injected.filter(name => forbidden.includes(name))).toEqual([])
      expect(h.registered.filter(entry => entry.spec.name === slot)).toEqual([])
      h.declare(slot)
      const configs = () => h.registered.filter(entry => entry.spec.name === slot)
      expect(configs().map(entry => entry.spec)).toEqual([
        pkg === '@klarkxy/dsh-zhihu'
          // Zhihu keeps its native page order and label from the earlier migration.
          ? { name: slot, key: pkg, order: 120, label: '知乎' }
          : { name: slot, key: pkg },
      ])
      // Registering or opening a settings page must not perform inference or write data.
      expect(h.calls.every(([channel, endpoint]) => statusChannels.includes(channel) && endpoint === 'status')).toBe(true)
      const html = renderToStaticMarkup(createElement(configs()[0].render, { view: 'page' }))
      expect(html.length).toBeGreaterThan(0)
      if (pkg === '@klarkxy/dsh-zhihu') {
        expect(html).toContain('zhihu-settings-embed')
        expect(html).not.toContain('data-testid="zhihu-open"')
      }
      expect(h.calls.every(([channel, endpoint]) => statusChannels.includes(channel) && endpoint === 'status')).toBe(true)
      h.undeclare(slot)
      expect(configs()).toEqual([])
      h.declare(slot); h.declare(slot)
      expect(configs()).toHaveLength(1)
      h.dispose(); h.dispose(); h.declare(slot)
      expect(h.registered).toEqual([])
    })

    it(`${pkg} cancels a pending registration on unload`, async () => {
      const h = host()
      apply(h.ctx)
      await settle()
      h.dispose()
      h.declare(slot)
      expect(h.registered).toEqual([])
    })
  }

  it('keeps Zhihu credentials only on its plugin page without a chat dock', () => {
    const source = readFileSync(new URL('../../plugins/dsh-zhihu/src/client.tsx', import.meta.url), 'utf8')
    // The Zhihu chat overlay was removed; credentials live solely in the
    // plugins.bundle.config seat, so no duplicate settings can resurface.
    expect(source).not.toContain('shell.overlay')
    expect(source).not.toContain('OVERLAY_TABS')
    expect(source).toContain('plugins.bundle.config')
  })
})
