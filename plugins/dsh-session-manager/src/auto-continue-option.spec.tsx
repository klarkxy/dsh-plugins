import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { AutoContinueOption } from './auto-continue-option.tsx'

const ok = (value: unknown) => ({ ok: true, value })
const status = (overrides: Record<string, unknown> = {}) => ({
  sessionId: 's1', role: 'coordinator', mode: 'off', max: 3, revision: 0, locked: false, ...overrides,
})

async function mount(run: (dom: JSDOM, render: (node: React.ReactElement) => Promise<void>) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>')
  const previous = new Map<string, unknown>()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, (globalThis as Record<string, unknown>)[key])
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  const root = createRoot(dom.window.document.getElementById('root')!)
  try {
    await run(dom, async node => { await act(async () => root.render(node)) })
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, value] of previous) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
}

const option = (call: (endpoint: string, payload: unknown) => Promise<unknown>, useSession?: never) => (
  <AutoContinueOption sessionId="s1" call={call} locale="zh" useSession={useSession} />
)

describe('auto-continue hero option', () => {
  it('renders the feature label and annotates the chosen mode', async () => {
    const call = vi.fn(async () => ok(status({ mode: 'cautious', revision: 2 })))
    await mount(async (dom, render) => {
      await render(option(call))
      const chip = dom.window.document.querySelector<HTMLButtonElement>('.smac-chip')!
      expect(chip.textContent).toContain('自动继续 · 谨慎')
      expect(chip.getAttribute('aria-haspopup')).toBe('menu')
      expect(chip.querySelector('[data-icon="chevron-down"]')).not.toBeNull()
      await render(option(vi.fn(async () => ok(status({ revision: 2 })))))
      expect(dom.window.document.querySelector('.smac-chip')!.textContent).toContain('自动继续 · 关闭')
    })
  })

  it('sends the picked mode with expectedRevision through the menu', async () => {
    let current = status({ mode: 'off', revision: 1 })
    const call = vi.fn(async (endpoint: string, payload: { mode?: string } = {}) =>
      endpoint === 'autocontinue.update' ? ok(current = status({ mode: payload.mode, revision: 2 })) : ok(current))
    await mount(async (dom, render) => {
      await render(option(call))
      await act(async () => dom.window.document.querySelector<HTMLButtonElement>('.smac-chip')!.click())
      const item = [...dom.window.document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
        .find(row => row.textContent === '奔放')!
      await act(async () => item.click())
      expect(call).toHaveBeenCalledWith('autocontinue.update', { sessionId: 's1', mode: 'bold', expectedRevision: 1 })
      expect(dom.window.document.querySelector('.smac-chip')!.textContent).toContain('自动继续 · 奔放')
    })
  })

  it('hides on a non-blank or executor session and disables while locked', async () => {
    const call = vi.fn(async () => ok(status()))
    await mount(async (dom, render) => {
      await render(option(call, (select: (v: { blank: boolean }) => unknown) => select({ blank: false }) as never))
      expect(dom.window.document.querySelector('.smac-chip')).toBeNull()
      await render(option(vi.fn(async () => ok(status({ role: 'executor' })))))
      expect(dom.window.document.querySelector('.smac-chip')).toBeNull()
      await render(option(vi.fn(async () => ok(status({ locked: true })))))
      expect(dom.window.document.querySelector<HTMLButtonElement>('.smac-chip')!.disabled).toBe(true)
    })
  })
})
