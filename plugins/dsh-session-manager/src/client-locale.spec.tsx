import { act, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { apply } from './client.tsx'
import { Config } from './index.ts'
import { failureText } from './ui-copy.ts'
import { DELETE_DIALOG_ID } from './contracts.ts'

describe('session manager live locale', () => {
  it('adds temporary creation to the standard picker without host capabilities, and localizes a failure', async () => {
    const dom = new JSDOM('<div id="root"></div>'), previous = new Map<string, unknown>()
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
      HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
      previous.set(key, (globalThis as Record<string, unknown>)[key])
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
    const root = createRoot(dom.window.document.getElementById('root')!)
    let active = 'en', unload = () => {}, resolve: (value: unknown) => void = () => {}
    const close = vi.fn(), openWorkspace = vi.fn(), listeners = new Set<() => void>()
    const renderers = new Map<string, ComponentType<any>>(), specs: any[] = []
    const allocate = vi.fn(() => new Promise(done => { resolve = done }))
    const ctx = {
      effect(fn: () => () => void) { unload = fn() },
      locale: { getSnapshot: () => ({ active }), subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } } },
      layout: { beginNavigation: () => new AbortController().signal },
      connection: { rpc: { call: allocate } },
      workspaces: { create: vi.fn(async () => ({ workspaceId: 'made' })), rename: vi.fn(async () => {}) },
      uiWorkspace: { openWorkspace },
      slots: { entriesOfSlot: () => [{ component: () => null }], spec: () => ({ kind: 'single', scope: 'root' }), subscribe: () => () => {},
        inject(_key: string, fn: () => () => void) { return fn() },
        register(spec: any, render: ComponentType<any>) { specs.push(spec); renderers.set(spec.id ?? spec.name, render); return () => {} },
      },
    }
    try {
      await act(async () => {
        apply(ctx as never)
        expect(specs.some(spec => spec.name === 'conversation.hero.workspace' && spec.priority === -10)).toBe(true)
        expect(specs.map(spec => spec.name)).not.toContain('conversation.hero.workspace.item')
        const Picker = renderers.get('conversation.hero.workspace')!, Overlay = renderers.get(DELETE_DIALOG_ID)!
        root.render(<><Picker open onClose={close} onPick={() => {}} renderSlot={() => null}
          useWorkspaces={(select: any) => select({ items: [{ workspaceId: 'original', title: 'Existing Workspace' }], phase: 'ready' })} t={(key: string) => key} /><Overlay /></>)
      })
      expect([...dom.window.document.querySelectorAll('[role="menuitem"]')].map(row => row.textContent)).toEqual([
        'Existing Workspace', 'menu.addWorkspace', 'Temporary Workspace',
      ])
      const item = () => [...dom.window.document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].at(-1)!
      expect(item().textContent).toContain('Temporary Workspace')
      await act(async () => { item().click() })
      expect(close).toHaveBeenCalledOnce()
      expect(allocate).toHaveBeenCalledOnce()
      expect(item().disabled).toBe(true)
      const requestId = allocate.mock.calls[0]![2].requestId
      await act(async () => { resolve({ ok: true, value: { requestId, path: '/temporary/one' } }) })
      expect(ctx.workspaces.create).toHaveBeenCalledWith({ path: '/temporary/one' })
      expect(openWorkspace).toHaveBeenCalledWith('made', expect.any(Function))
      expect(item().disabled).toBe(false)
      await act(async () => { active = 'zh'; for (const fn of listeners) fn() })
      expect(item().textContent).toContain('临时工作区')
      await act(async () => { item().click(); resolve({ ok: false, error: { message: 'allocation denied' } }) })
      const dialog = () => dom.window.document.querySelector('[role="dialog"]')!
      expect(dialog().getAttribute('aria-label')).toBe('无法创建临时工作区')
      expect(dialog().textContent).toContain('allocation denied')
      await act(async () => { active = 'en'; for (const fn of listeners) fn() })
      expect(dialog().getAttribute('aria-label')).toBe('Could not create the temporary workspace')
    } finally {
      await act(async () => root.unmount()); unload(); dom.window.close()
      for (const [key, value] of previous) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
    expect(listeners.size).toBe(0)
  })

  it('provides bilingual config descriptions and localizes an unavailable fork', () => {
    for (const field of ['pageChars', 'listLimit', 'searchLimit']) {
      expect(Config.dict![field]!.meta.description).toMatchObject({ zh: expect.stringMatching(/[一-龿]/), en: expect.any(String) })
    }
    expect(failureText('zh', { code: 'session/fork-unavailable' })).toBe('当前版本不能完成这个操作。')
    expect(failureText('en', { code: 'session/fork-unavailable' })).toBe('This runtime cannot complete that action.')
  })
})
