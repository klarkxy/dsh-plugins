import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

describe('documentation locale independence', () => {
  it('keeps the manually selected document language while the shell follows host changes', async () => {
    const dom = new JSDOM('<div id="root"></div>'); const previous = new Map<string, unknown>()
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
      previous.set(key, (globalThis as Record<string, unknown>)[key]); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
    const root = createRoot(dom.window.document.getElementById('root')!); let active = 'zh'
    const listeners = new Set<() => void>()
    let definition!: { factory(require: (id: string) => unknown): { apply(ctx: unknown): void } }
    const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
    runInNewContext(source, { setTimeout, clearTimeout, window: { __ModuleLoader__: { load(value: typeof definition) { definition = value } } } })
    // The static browser entry receives the same React hooks as a mounted host.
    const client = definition.factory(id => id === 'react' ? React : {
      Button: ({ children, onClick }: { children: React.ReactNode; onClick(): void }) => React.createElement('button', { onClick }, children),
      SegmentedTabs: ({ label, value, onChange, items }: { label: string; value: string; onChange(value: string): void; items: Array<{ value: string; label: string }> }) => React.createElement('div', { 'aria-label': label },
        ...items.map(item => React.createElement('button', { key: item.value, 'aria-pressed': value === item.value, onClick: () => onChange(item.value) }, item.label))),
    })
    let render!: () => React.ReactNode
    client.apply({ locale: { getSnapshot: () => ({ active }), subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } } },
      slots: { inject(_key: string, register: () => void) { register() }, register(_spec: unknown, view: typeof render) { render = view } },
    })
    const body = () => dom.window.document.body.textContent!
    const frame = () => dom.window.document.querySelector('iframe')!
    const switchLocale = async (next: string) => { await act(async () => { active = next; listeners.forEach(listener => listener()) }) }
    try {
      await act(async () => root.render(render()))
      expect(frame().src).toBe('https://deepseek-harness.github.io/deepseek-harness/')
      await switchLocale('en')
      expect(frame().src).toBe('https://deepseek-harness.github.io/deepseek-harness/en/')
      expect(body()).toContain('Loading documentation…')
      await act(async () => [...dom.window.document.querySelectorAll('button')].find(button => button.textContent === 'English')!.click())
      await switchLocale('zh')
      expect(frame().src).toBe('https://deepseek-harness.github.io/deepseek-harness/en/')
      expect(body()).toContain('返回文档首页')
      await switchLocale('en')
      await act(async () => [...dom.window.document.querySelectorAll('button')].find(button => button.textContent === '中文')!.click())
      expect(frame().src).toBe('https://deepseek-harness.github.io/deepseek-harness/')
      expect(body()).toContain('Documentation home')
      expect(body()).not.toContain('返回文档首页')
      const pinnedFrame = frame()
      await switchLocale('zh-CN')
      expect(frame()).toBe(pinnedFrame)
      expect(body()).toContain('返回文档首页')
      await switchLocale('en-US')
      expect(frame()).toBe(pinnedFrame)
      expect(frame().title).toBe('DSH development documentation')
      expect(dom.window.document.querySelector('section')!.getAttribute('aria-label')).toBe('DSH documentation browser')
    } finally {
      await act(async () => root.unmount()); expect(listeners.size).toBe(0); dom.window.close()
      for (const [key, value] of previous) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
  })
})
