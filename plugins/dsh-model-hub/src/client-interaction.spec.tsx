import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { SubagentModelsPage } from './client.tsx'

const cast = { enabled: true, revision: 1, tendencyRevision: 0, routes: [{ provider: 'p', model: 'one', tendency: 'Reviews' }] }
const catalog = { groups: [{ id: 'p', name: 'Provider', models: [{ id: 'one', name: 'One' }] }] }

describe('subagent settings integration', () => {
  it('uses only the cast and model-catalog reads and unsubscribes on unmount', async () => {
    const dom = new JSDOM('<div id="root"></div>')
    const previous = new Map<string, PropertyDescriptor | undefined>()
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, Node: dom.window.Node,
      Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
      previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
    let subscribed = 0, unsubscribed = 0
    const api = { getCast: vi.fn(async () => cast), modelCatalog: vi.fn(async () => catalog), subscribeChanges: () => { subscribed++; return () => { unsubscribed++ } } }
    const root: Root = createRoot(dom.window.document.getElementById('root')!)
    try {
      await act(async () => root.render(<SubagentModelsPage locale="zh-CN" api={api} />))
      expect(api.getCast).toHaveBeenCalledTimes(1)
      expect(api.modelCatalog).toHaveBeenCalledTimes(1)
      expect(subscribed).toBe(1)
      expect(dom.window.document.body.textContent).toContain('子代理')
      expect(dom.window.document.body.textContent).not.toContain('字段总览')
      await act(async () => root.unmount())
      expect(unsubscribed).toBe(1)
    } finally {
      if (dom.window.document.getElementById('root')) await act(async () => root.unmount())
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
      dom.window.close()
    }
  })
})
