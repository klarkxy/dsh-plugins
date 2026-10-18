import { JSDOM } from 'jsdom'
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { apply } from './client.tsx'
import { CONFIG_READ_ENDPOINT, CONTINUE_GHOST_SLOT, CONTINUE_SUGGEST_ENDPOINT, WELCOME_BACK_PREPARE_ENDPOINT, type ConfigView } from './contracts.ts'

const settingsChanges = vi.hoisted(() => ({ listeners: new Set<() => void>() }))
vi.mock('@klarkxy/dsh-plugin-kit/model-settings-client', () => ({
  mountModelSettingsChanges: () => {},
  createModelSettingsSubscriber: () => ({
    subscribe(listener: () => void) {
      settingsChanges.listeners.add(listener)
      return () => { settingsChanges.listeners.delete(listener) }
    },
  }),
}))

/** Session list stub whose current mainView row can be swapped between notifications. */
function sessionList(initial: string) {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    list: {
      getSnapshot: () => ({
        ids: current === '' ? [] : [current],
        byId: current === '' ? {} : { [current]: { id: current, displayTitle: current, running: false, updatedAt: 0, retainedBy: { mainView: 1 } } },
        phase: 'ready' as const,
      }),
      subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
    switchTo(id: string) { current = id; for (const listener of listeners) listener() },
  }
}

describe('presence triggers', () => {
  it('refreshes a mounted idle composer on confirmed changes without opening settings and rejects stale replies', async () => {
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
    const previous = new Map<string, unknown>()
    for (const [key, value] of Object.entries({
      window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
      Node: dom.window.Node, MutationObserver: dom.window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      previous.set(key, (globalThis as Record<string, unknown>)[key])
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
    let config: ConfigView = {
      recapMinutes: 15, compactMinutes: 60, continueText: 'A', continueMode: 'fixed', model: null, ghostModel: null,
    }
    let unload = () => {}
    let renderGhost!: (props: unknown) => ReactNode
    let generation!: () => void
    const events = new Map<string, () => void>()
    let delayed: { resolve(value: unknown): void; signal?: AbortSignal } | undefined
    let holdNext = false
    const call = vi.fn(async (_channel: string, endpoint: string, _payload: unknown, signal?: AbortSignal) => {
      if (endpoint === CONFIG_READ_ENDPOINT) return { ok: true, value: config }
      if (endpoint === CONTINUE_SUGGEST_ENDPOINT) {
        if (holdNext) {
          holdNext = false
          return new Promise(resolve => { delayed = { resolve, signal } })
        }
        return { ok: true, value: config.continueMode === 'auto' ? { text: 'Automatic', seq: 9 } : { text: config.continueText } }
      }
      return { ok: true, value: { show: false } }
    })
    const ctx = {
      effect(fn: () => () => void) { unload = fn() },
      on(name: string, listener: () => void) { events.set(name, listener); return () => { events.delete(name) } },
      locale: { getSnapshot: () => ({ active: 'en' }), subscribe: () => () => {} },
      sessions: { list: sessionList('alpha').list },
      connection: {
        rpc: { call },
        generation: { subscribe(listener: () => void) { generation = listener; return () => {} } },
      },
      slots: {
        inject: (_key: string, fn: () => () => void) => fn(),
        register(spec: { name: string }, render: (props: unknown) => ReactNode) {
          if (spec.name === CONTINUE_GHOST_SLOT) renderGhost = render
          return () => {}
        },
      },
    }
    const root = createRoot(dom.window.document.getElementById('root')!)
    const placeholder = () => dom.window.document.querySelector('[data-composer-placeholder]')!.textContent
    const suggestCount = () => call.mock.calls.filter(([, endpoint]) => endpoint === CONTINUE_SUGGEST_ENDPOINT).length
    try {
      await act(async () => {
        apply(ctx as never)
        const Ghost = renderGhost
        root.render(<div data-composer-card="">
          <div data-composer-input="" data-placeholder="Native" />
          <div data-composer-placeholder="">Native</div>
          <Ghost sessionId="alpha"
            useInput={(select: (value: unknown) => unknown) => select({ draft: '', phase: 'plain', attachmentIds: [] })}
            useSession={(select: (value: unknown) => unknown) => select({ blank: false })}
          />
        </div>)
        dom.window.dispatchEvent(new dom.window.Event('focus'))
      })
      expect(settingsChanges.listeners.size).toBe(1)
      expect(placeholder()).toBe('A')
      config = { ...config, continueText: 'B' }
      await act(async () => { for (const listener of settingsChanges.listeners) listener() })
      expect(placeholder()).toBe('B')

      // Invalidate while a previous request is still waiting; its eventual
      // response must never replace the new mode's line.
      config = { ...config, continueText: 'waiting' }
      holdNext = true
      await act(async () => { for (const listener of settingsChanges.listeners) listener() })
      expect(delayed).toBeDefined()
      config = { ...config, continueMode: 'auto' }
      await act(async () => { for (const listener of settingsChanges.listeners) listener() })
      expect(delayed!.signal?.aborted).toBe(true)
      expect(placeholder()).toBe('Automatic')
      await act(async () => { delayed!.resolve({ ok: true, value: { text: 'stale A' } }) })
      expect(placeholder()).toBe('Automatic')

      config = { ...config, continueMode: 'fixed', continueText: 'Generation refresh' }
      await act(async () => { generation() })
      expect(placeholder()).toBe('Generation refresh')
      config = { ...config, continueText: 'Reset refresh' }
      await act(async () => { events.get('connection/reset')!() })
      expect(placeholder()).toBe('Reset refresh')
      config = { ...config, continueText: 'Focus refresh' }
      await act(async () => { dom.window.dispatchEvent(new dom.window.Event('focus')) })
      expect(placeholder()).toBe('Focus refresh')
      const count = suggestCount()
      await act(async () => { for (const listener of settingsChanges.listeners) listener() })
      expect(suggestCount()).toBe(count)
      await act(async () => { unload(); root.unmount() })
      expect(settingsChanges.listeners.size).toBe(0)
    } finally {
      await act(async () => { unload(); root.unmount() })
      for (const [key, value] of previous) {
        if (value === undefined) delete (globalThis as Record<string, unknown>)[key]
        else Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
      }
      dom.window.close()
    }
  })

  it('rechecks a visible session at the threshold and clears the periodic check on unload', async () => {
    vi.useFakeTimers()
    const previousDocument = globalThis.document
    const previousWindow = globalThis.window
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
    Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window })
    Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document })
    let unload = () => {}
    let minutes = 60
    const prepared: number[] = []
    const ctx = {
      inject(deps: string[], callback?: (scope: unknown) => void) {
        if (deps[0] === 'remote') callback?.({ remote: { $mount: async () => async () => {} }, effect() {} })
        return { dispose() {} }
      },
      effect(callback: () => () => void) { unload = callback() },
      slots: { inject: (_key: string, callback: () => () => void) => callback(), register: () => () => {} },
      locale: { getSnapshot: () => ({ active: 'en' }), subscribe: () => () => {} },
      sessions: { list: sessionList('alpha').list },
      connection: { rpc: { call: async (_channel: string, endpoint: string) => {
        if (endpoint === CONFIG_READ_ENDPOINT) return { ok: true, value: {
          recapMinutes: minutes, compactMinutes: minutes, continueText: '', continueMode: 'fixed', model: null, ghostModel: null,
        } }
        if (endpoint === WELCOME_BACK_PREPARE_ENDPOINT) prepared.push(minutes)
        return { ok: true, value: { show: false } }
      } } },
      remote: { session: { prompt: vi.fn() } },
    }
    try {
      apply(ctx as never)
      await vi.advanceTimersByTimeAsync(1_500)
      expect(prepared).toEqual([60])
      await vi.advanceTimersByTimeAsync(28_500)
      expect(prepared).toEqual([60, 60])
      minutes = 1
      dom.window.dispatchEvent(new dom.window.Event('focus'))
      await vi.advanceTimersByTimeAsync(0)
      expect(prepared).toEqual([60, 60, 1])
      unload()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(prepared).toEqual([60, 60, 1])
    } finally {
      unload()
      vi.useRealTimers()
      Object.defineProperty(globalThis, 'document', { configurable: true, value: previousDocument })
      Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow })
      dom.window.close()
    }
  })

  it('checks the current session on focus and on a session switch, and removes listeners on unload', async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>')
    const previous = new Map<string, unknown>()
    const assign = (key: string, value: unknown) => {
      previous.set(key, (globalThis as Record<string, unknown>)[key])
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
    assign('window', dom.window)
    assign('document', dom.window.document)
    try {
      const calls: string[] = []
      const sessions = sessionList('alpha')
      let unload = () => {}
      const ctx = {
        inject(deps: string[], callback?: (scope: unknown) => void) {
          if (deps[0] === 'remote') callback?.({ remote: { $mount: async () => async () => {} }, effect() {} })
          return { dispose() {} }
        },
        effect(callback: () => () => void) { unload = callback() },
        slots: {
          inject: (_key: string, callback: () => () => void) => callback(),
          register: () => () => {},
        },
        locale: { getSnapshot: () => ({ active: 'en' }), subscribe: () => () => {} },
        sessions: { list: sessions.list },
        connection: {
          rpc: {
            call: vi.fn(async (_channel: string, endpoint: string, payload: { sessionId?: string }) => {
              if (endpoint === CONFIG_READ_ENDPOINT) return { ok: true, value: {
                recapMinutes: 15, compactMinutes: 60, continueText: '', continueMode: 'fixed', model: null, ghostModel: null,
              } }
              if (endpoint === WELCOME_BACK_PREPARE_ENDPOINT) calls.push(payload.sessionId ?? '')
              return { ok: true, value: { show: false } }
            }),
          },
        },
        remote: { session: { prompt: vi.fn() } },
      }
      const addSpy = vi.spyOn(dom.window, 'addEventListener')
      const removeSpy = vi.spyOn(dom.window, 'removeEventListener')
      apply(ctx as never)
      expect(addSpy).toHaveBeenCalledWith('focus', expect.any(Function))
      dom.window.dispatchEvent(new dom.window.Event('focus'))
      await vi.waitFor(() => { expect(calls).toEqual(['alpha']) })
      // Let the first check's ticket settle (the calls push happens inside the RPC,
      // before the in-flight guard releases) before switching sessions.
      await new Promise(resolve => setTimeout(resolve, 20))
      sessions.switchTo('beta')
      await vi.waitFor(() => { expect(calls).toEqual(['alpha', 'beta']) })
      unload()
      expect(removeSpy).toHaveBeenCalledWith('focus', expect.any(Function))
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete (globalThis as Record<string, unknown>)[key]
        else Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
      }
      dom.window.close()
    }
  })
})
