import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { apply } from './client.tsx'
import { COPY_THREAD_MENU_ID, COPY_THREAD_SHORTCUT_ID, DELETE_DIALOG_ID } from './contracts.ts'
import type { HostShortcuts } from './copy-shortcut.tsx'

const localRequire = createRequire(import.meta.url)
const hostRequire = createRequire(localRequire.resolve('@deepseek-ai/dsh-client-ui-workspace/package.json'))

/** Execute the version-matched published shortcut service, including its real registry,
 * persistence and DOM keyboard adapter. Cordis activation, snapshot stores and composition tracking
 * are supplied by the harness; no plugin-owned keyboard matcher is substituted.
 */
async function withHost(run: (host: any) => Promise<void>, platform = 'Win32') {
  const dom = new JSDOM('<div id="root"></div><textarea></textarea>', { url: 'https://dsh.test/' })
  Object.defineProperty(dom.window.navigator, 'platform', { value: platform })
  const write = vi.fn(async (_id: string) => {})
  Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: write } })
  const previous = new Map<string, unknown>()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, (globalThis as Record<string, unknown>)[key])
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  const stops: (() => void)[] = []
  let Service: any
  ;(dom.window as any).__ModuleLoader__ = { load({ factory }: any) {
    Service = factory((id: string) => id === '@deepseek-ai/cordis' ? { Service: class {} }
      : id === '@deepseek-ai/dsh-client-ui-primitives' ? {
        modalSelector: '[role="dialog"][aria-modal="true"], [role="menu"]',
        observeComposition: () => ({ guards: (event: KeyboardEvent) => event.isComposing, dispose() {} }),
      } : id === '@deepseek-ai/dsh-client-store' ? {
        createSnapshotStore(initial: unknown) {
          let value = initial
          const subscribers = new Set<() => void>()
          return { getSnapshot: () => value,
            set(next: unknown) { value = next; for (const fn of subscribers) fn() },
            subscribe(fn: () => void) { subscribers.add(fn); return () => { subscribers.delete(fn) } },
          }
        },
      } : hostRequire(id))
  } }
  runInNewContext(readFileSync(hostRequire.resolve('@deepseek-ai/dsh-client-shortcuts/client'), 'utf8'), {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    Element: dom.window.Element, MutationObserver: dom.window.MutationObserver, crypto: dom.window.crypto, console,
  })
  const shortcuts: HostShortcuts = new Service({ effect(fn: () => () => void) { stops.push(fn()) },
    locale: { subscribe: () => () => {} } })
  let locale = 'zh', unload = () => {}, current = 'first'
  const renderers = new Map<string, any>()
  const listeners = new Set<() => void>()
  const list = { getSnapshot: () => ({ phase: 'ready', ids: ['first', 'second'], byId: Object.fromEntries(
    ['first', 'second'].map(id => [id, { id, displayTitle: id, running: false, updatedAt: 1, retainedBy: { mainView: current === id ? 1 : 0 } }]),
  ) }), subscribe: () => () => {} }
  const root = createRoot(dom.window.document.getElementById('root')!)
  try {
    await act(async () => {
      apply({ effect(fn: () => () => void) { unload = fn() }, shortcuts, sessions: { list },
        locale: { getSnapshot: () => ({ active: locale }), subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } } },
        slots: { entriesOfSlot: () => [], spec: () => undefined, subscribe: () => () => {},
          inject(_key: string, fn: () => () => void) { return fn() }, register(spec: any, render: any) { renderers.set(spec.id, render); return () => {} } },
      } as never)
      const Overlay = renderers.get(DELETE_DIALOG_ID), Menu = renderers.get(COPY_THREAD_MENU_ID)
      root.render(<><Overlay /><Menu sessionId="second" useMenuOpenState={() => [true, () => {}]} /></>)
    })
    const press = (extra: KeyboardEventInit = {}) => {
      const event = new dom.window.KeyboardEvent('keydown', { key: 'c', code: 'KeyC', ctrlKey: platform === 'Win32',
        metaKey: platform !== 'Win32', altKey: true, bubbles: true, cancelable: true, ...extra })
      dom.window.document.querySelector('textarea')!.dispatchEvent(event)
      return event
    }
    await run({ dom, root, shortcuts, write, press, setCurrent: (id: string) => { current = id },
      setLocale: () => { locale = 'en'; for (const listener of listeners) listener() } })
  } finally {
    await act(async () => root.unmount())
    unload()
    expect(shortcuts.catalog.getSnapshot()).toEqual([])
    for (const stop of stops.reverse()) stop?.()
    dom.window.close()
    for (const [key, value] of previous) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
}

describe('copy thread shortcut in the standard host', () => {
  it('shows the binding, copies the live main session, rejects guarded keys and reports clipboard failure', async () => {
    await withHost(async ({ dom, shortcuts, write, press, setCurrent, setLocale }) => {
      expect(dom.window.document.querySelector('[role="menuitem"]')?.textContent).toContain('Ctrl + Alt + C')
      expect(shortcuts.catalog.getSnapshot()[0].id).toBe(COPY_THREAD_SHORTCUT_ID)
      await act(async () => {
        press({ repeat: true }); press({ isComposing: true }); press({ altKey: false })
      })
      expect(write).not.toHaveBeenCalled()
      await act(async () => { expect(press().defaultPrevented).toBe(true) })
      expect(write).toHaveBeenLastCalledWith('first')
      expect(dom.window.document.querySelector('[role="status"]')?.textContent).toBe('已复制线程 ID')
      setCurrent('second')
      await act(async () => { press() })
      expect(write).toHaveBeenLastCalledWith('second')
      setCurrent('missing')
      await act(async () => { press() })
      expect(write).toHaveBeenCalledTimes(2)
      setCurrent('first'); write.mockRejectedValueOnce(new Error('denied'))
      await act(async () => { press() })
      expect(dom.window.document.querySelector('[role="status"]')?.textContent).toBe('无法复制线程 ID')
      await act(async () => { setLocale() })
      expect(dom.window.document.querySelector('[role="status"]')?.textContent).toBe('Could not copy the thread ID')
    })
  })

  it('uses macOS keys and follows a saved remapping in both dispatch and the menu', async () => {
    await withHost(async ({ dom, shortcuts, write, press }) => {
      expect(dom.window.document.querySelector('[role="menuitem"]')?.textContent).toContain('⌥ ⌘ C')
      await act(async () => { press() })
      expect(write).toHaveBeenCalledWith('first')
      await act(async () => {
        const result = await shortcuts.edit({ type: 'set', id: COPY_THREAD_SHORTCUT_ID as never,
          binding: { code: 'KeyI', modifiers: ['primary', 'alt'] } }, shortcuts.config.getSnapshot().revision)
        expect(result.status).toBe('saved')
      })
      expect(dom.window.document.querySelector('[role="menuitem"]')?.textContent).toContain('⌥ ⌘ I')
      await act(async () => {
        dom.window.dispatchEvent(new dom.window.StorageEvent('storage', { key: 'dsh.keybindings.v1' }))
      })
      expect(shortcuts.config.getSnapshot().status).toBe('ready')
      expect(dom.window.document.querySelector('[role="menuitem"]')?.textContent).toContain('⌥ ⌘ I')
      await act(async () => { press(); press({ key: 'i', code: 'KeyI' }) })
      expect(write).toHaveBeenCalledTimes(2)
    }, 'MacIntel')
  })
})
