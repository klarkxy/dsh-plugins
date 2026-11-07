import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { SubagentModelsPage } from './client.tsx'
import { castCopy } from './client-cast.tsx'
import { hubMessage, hubMessages } from './client-copy.ts'

async function mounted(run: (dom: JSDOM, root: Root) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>')
  const previous = new Map<string, PropertyDescriptor | undefined>()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, Node: dom.window.Node,
    Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  dom.window.HTMLElement.prototype.scrollIntoView = () => {}
  const root = createRoot(dom.window.document.getElementById('root')!)
  try { await run(dom, root) } finally {
    await act(async () => root.unmount()); dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
}

describe('subagent settings locale', () => {
  it('updates the settings in place without resetting a tendency draft', async () => mounted(async (dom, root) => {
    let active = 'en', changed = () => {}
    const listeners = new Set<() => void>()
    const locale = { getSnapshot: () => ({ active }), subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } } }
    const state = { enabled: true, revision: 1, tendencyRevision: 0, routes: [{ provider: 'p', model: 'one', tendency: 'Reviews' }] }
    const api = { getCast: vi.fn(async () => state), modelCatalog: vi.fn(async () => ({ groups: [] })), subscribeChanges: (fn: () => void) => { changed = fn; return () => {} } }
    await act(async () => root.render(<SubagentModelsPage locale={locale} api={api} />))
    const input = dom.window.document.querySelector<HTMLInputElement>('.cast-row-tendency input')!
    await act(async () => Simulate.change(input, { target: { value: 'Local draft' } }))
    await act(async () => { active = 'zh-CN'; listeners.forEach(fn => fn()) })
    expect(input.value).toBe('Local draft')
    expect(dom.window.document.body.textContent).toContain('思考强度')
    await act(async () => changed())
    expect(input.value).toBe('Local draft')
    expect(api.getCast).toHaveBeenCalledTimes(2)
    expect(api.modelCatalog).toHaveBeenCalledTimes(2)
  }))

  it('keeps diagnostics bilingual and preserves unknown messages', () => {
    expect(Object.keys(castCopy.zh)).toEqual(Object.keys(castCopy.en))
    for (const key of Object.keys(castCopy.en)) {
      const value = castCopy.en[key as keyof typeof castCopy.en]
      expect(typeof value === 'function' ? value('LABEL', 'EXTRA') : value).not.toMatch(/[\u3400-\u9fff]/)
    }
    for (const language of ['zh', 'en'] as const) expect(hubMessage('Remote 原样', language)).toBe('Remote 原样')
    for (const [zh, en] of hubMessages) expect(hubMessage(zh, 'en')).toBe(en)
  })
})
