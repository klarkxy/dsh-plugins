import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { QuickReviewAction } from './client.tsx'

/**
 * Renders the header action for real (see client-render.spec.tsx in
 * dsh-current-title for the same mount): the popover's model pick reaches
 * `start` through `onModelChange`, so an in-flight settings.save can never
 * silently reroute a review.
 */

function mount(): { dom: JSDOM; root: Root; restore: () => Promise<void> } {
  const dom = new JSDOM('<div id="root"></div>')
  const previous = new Map<string, unknown>()
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node, MouseEvent: dom.window.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous.set(key, (globalThis as Record<string, unknown>)[key])
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  const root = createRoot(dom.window.document.getElementById('root')!)
  return {
    dom,
    root,
    restore: async () => {
      await act(async () => root.unmount())
      dom.window.close()
      for (const [key, value] of previous) {
        Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
      }
    },
  }
}

function fakeClient() {
  return {
    connection: { generation: { subscribe: () => () => {} } },
    locale: { getSnapshot: () => ({ active: 'zh' }), subscribe: () => () => {} },
  }
}

describe('quick review action', () => {
  it('sends the picker-reported model with start instead of racing settings.update', async () => {
    const { dom, root, restore } = mount()
    try {
      const calls: { endpoint: string; payload: Record<string, unknown> }[] = []
      const call = async (endpoint: string, payload: Record<string, unknown>) => {
        calls.push({ endpoint, payload })
        if (endpoint === 'settings') {
          return { ok: true, value: { revision: 0, model: { provider: 'p1', model: 'm1' } } }
        }
        if (endpoint === 'scope') return { ok: true, value: { kind: 'workspace' } }
        if (endpoint === 'start') {
          return { ok: true, value: { reviewSessionId: 'review-1', scope: { kind: 'workspace' }, model: { provider: 'p1', model: 'm1' } } }
        }
        return { ok: true, value: {} }
      }
      const useSession = ((selector: (snapshot: Record<string, unknown>) => unknown) => selector({})) as never
      const t = ((key: string) => key) as never
      const document = dom.window.document
      await act(async () => {
        root.render(
          <QuickReviewAction
            sessionId="s1"
            useSession={useSession}
            call={call}
            t={t}
            client={fakeClient() as never}
          />,
        )
      })
      const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="title"]')!
      expect(trigger).not.toBeNull()
      await act(async () => {
        trigger.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      })
      // The picker's settings load reports its stored route via onModelChange.
      await vi.waitFor(() => expect(calls.some(entry => entry.endpoint === 'settings')).toBe(true))
      await act(async () => { await Promise.resolve() })
      const startButton = [...document.querySelectorAll('button')]
        .find(button => button.textContent === 'reviewAction')!
      expect(startButton).not.toBeNull()
      await act(async () => {
        startButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
        await Promise.resolve()
      })
      await vi.waitFor(() => expect(calls.some(entry => entry.endpoint === 'start')).toBe(true))
      const start = calls.find(entry => entry.endpoint === 'start')!
      expect(start.payload).toMatchObject({
        sourceSessionId: 's1',
        model: { provider: 'p1', model: 'm1' },
      })
    } finally {
      await restore()
    }
  })
})
