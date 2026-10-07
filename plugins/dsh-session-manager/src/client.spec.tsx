import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { COPY_THREAD_FAILED, COPY_THREAD_LABEL, copyMenuState, copyThreadId } from './copy-action.ts'
import { COPY_THREAD_MENU_ID, COPY_THREAD_MENU_ORDER, USER_ACTIONS_SLOT } from './contracts.ts'
import { CopyThreadMenuItem, apply } from './client.tsx'

const captured = vi.hoisted(() => ({ onSelect: undefined as undefined | (() => Promise<void> | void) }))

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@deepseek-ai/dsh-client-ui-primitives')
  const React = await import('react')
  return {
    ...actual,
    MenuItemButton({ children, onSelect }: { children: React.ReactNode; onSelect: () => Promise<void> | void }) {
      captured.onSelect = onSelect
      return React.createElement('button', { type: 'button', role: 'menuitem', onClick: onSelect }, children)
    },
  }
})

describe('copy thread id', () => {
  it('copies the session id from the menu row and keeps a visible failure open', async () => {
    expect(copyMenuState(false, 'zh').failure).toBe(COPY_THREAD_FAILED.zh)
    expect(copyMenuState(false, 'en').failure).toBe(COPY_THREAD_FAILED.en)
    const writes: string[] = []
    const close = vi.fn()
    const html = renderToStaticMarkup(
      <CopyThreadMenuItem
        sessionId="session-7"
        locale="en"
        writeText={async value => { writes.push(value) }}
        useMenuOpenState={() => [true, close]}
      />,
    )
    expect(html).toContain('role="menuitem"')
    expect(html).toContain(COPY_THREAD_LABEL.en)
    await captured.onSelect?.()
    expect(writes).toEqual(['session-7'])
    expect(close).toHaveBeenCalledWith(false)

    close.mockClear()
    const failed = renderToStaticMarkup(
      <CopyThreadMenuItem
        sessionId="session-7"
        locale="zh"
        writeText={async () => { throw new Error('denied') }}
        useMenuOpenState={() => [true, close]}
      />,
    )
    expect(failed).toContain(COPY_THREAD_LABEL.zh)
    await captured.onSelect?.()
    expect(close).not.toHaveBeenCalled()
    await expect(copyThreadId('session-7', async () => { throw new Error('denied') })).rejects.toThrow('denied')
  })

  it('removes the menu row when the client unloads', () => {
    const disposed: string[] = []
    let unload = () => {}
    const specs: Array<Record<string, unknown>> = []
    const ctx = {
      effect(callback: () => () => void) { unload = callback() },
      slots: {
        inject(_key: string, callback: () => () => void) {
          const inner = callback()
          return () => { disposed.push('inject'); inner() }
        },
        register(spec: Record<string, unknown>) {
          specs.push(spec)
          return () => disposed.push(String(spec['id'] ?? spec['key']))
        },
      },
      locale: { getSnapshot: () => ({ active: 'zh-CN' }), subscribe: () => () => {} },
    }
    apply(ctx as never)
    expect(disposed).toEqual([])
    expect(specs).toContainEqual({
      name: 'sidebar.workspaces.session.menu.item',
      id: COPY_THREAD_MENU_ID,
      order: COPY_THREAD_MENU_ORDER,
    })
    expect(specs.map(spec => spec['name'])).toEqual([
      'sidebar.workspaces.session.menu.item',
      'sidebar.workspaces.session.menu.item',
      'main',
      'sidebar.panellist',
      USER_ACTIONS_SLOT,
      'shell.overlay',
    ])
    unload()
    expect(disposed.filter(item => item === 'inject')).toHaveLength(6)
    expect(disposed).toContain(COPY_THREAD_MENU_ID)
  })

  it('reads the sidebar label from the locale snapshot when an earlier subscriber runs first', () => {
    let active = 'zh-CN'
    const listeners: Array<() => void> = []
    let label = () => ''
    let seen = ''
    listeners.push(() => { seen = label() })
    const ctx = {
      effect(callback: () => () => void) { callback() },
      slots: {
        inject(_key: string, callback: () => () => void) {
          callback()
          return () => {}
        },
        register(spec: { label?: () => string }) {
          if (typeof spec.label === 'function') label = spec.label
          return () => {}
        },
      },
      locale: {
        getSnapshot: () => ({ active }),
        subscribe(listener: () => void) {
          listeners.push(listener)
          return () => {}
        },
      },
    }
    apply(ctx as never)
    active = 'en'
    for (const listener of listeners) listener()
    expect(seen).toBe('Free chat')
    expect(label()).toBe('Free chat')
  })
})
