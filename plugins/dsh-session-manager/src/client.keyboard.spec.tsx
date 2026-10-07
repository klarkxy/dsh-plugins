import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { CopyThreadMenuItem } from './client.tsx'
import { COPY_THREAD_FAILED } from './copy-action.ts'

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

async function useDom(run: (dom: JSDOM) => Promise<void>): Promise<void> {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const previous = new Map<string, unknown>()
  const assign = (key: string, value: unknown) => {
    previous.set(key, (globalThis as Record<string, unknown>)[key])
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  assign('window', dom.window)
  assign('document', dom.window.document)
  assign('HTMLElement', dom.window.HTMLElement)
  assign('KeyboardEvent', dom.window.KeyboardEvent)
  assign('MouseEvent', dom.window.MouseEvent)
  assign('Node', dom.window.Node)
  assign('IS_REACT_ACT_ENVIRONMENT', true)
  try {
    await run(dom)
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete (globalThis as Record<string, unknown>)[key]
      else Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
    dom.window.close()
  }
}

describe('copy thread id keyboard', () => {
  it('does not copy from composition, modifier, or repeated keys, and copies once from a click', async () => {
    await useDom(async dom => {
      let copies = 0
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(
            <CopyThreadMenuItem
              sessionId="session-7"
              locale="en"
              writeText={async () => { copies += 1 }}
              useMenuOpenState={() => [true, () => {}]}
            />,
          )
        })
        const button = dom.window.document.querySelector<HTMLButtonElement>('[role="menuitem"]')
        expect(button).not.toBeNull()
        const press = (init: KeyboardEventInit) => {
          button!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
        }
        press({ key: 'Enter', repeat: true })
        press({ key: 'Enter', ctrlKey: true })
        press({ key: 'Enter', altKey: true })
        press({ key: 'Enter', metaKey: true })
        press({ key: 'Enter', isComposing: true })
        press({ key: ' ', repeat: true })
        expect(copies).toBe(0)
        await act(async () => {
          button!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
        })
        expect(copies).toBe(1)
        expect(captured.onSelect).toBeTypeOf('function')
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('renders a clipboard failure in the locale that is current while the menu stays open', async () => {
    await useDom(async dom => {
      let locale: 'zh' | 'en' = 'zh'
      let root: Root | undefined
      const render = () => {
        root!.render(
          <CopyThreadMenuItem
            sessionId="session-7"
            locale={locale}
            writeText={async () => { throw new Error('denied') }}
            useMenuOpenState={() => [true, () => {}]}
          />,
        )
      }
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          render()
        })
        const button = () => dom.window.document.querySelector<HTMLButtonElement>('[role="menuitem"]')
        await act(async () => {
          button()!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
        })
        expect(button()!.textContent).toBe(COPY_THREAD_FAILED.zh)
        locale = 'en'
        await act(async () => { render() })
        expect(button()!.textContent).toBe(COPY_THREAD_FAILED.en)
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })
})
