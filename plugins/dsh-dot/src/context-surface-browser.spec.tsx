import { act } from 'react'
import { JSDOM } from 'jsdom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { SurfaceBrowser } from './context-surface-browser.tsx'
import { surfaceParts } from './context-surface.ts'
import type { DotContextNode } from './contracts.ts'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://local.test' })
vi.stubGlobal('window', dom.window)
vi.stubGlobal('document', dom.window.document)
vi.stubGlobal('navigator', dom.window.navigator)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
let createRoot: typeof import('react-dom/client').createRoot
beforeAll(async () => { createRoot = (await import('react-dom/client')).createRoot })
afterEach(() => { document.body.innerHTML = '<div id="root"></div>' })

const nodes: DotContextNode[] = [
  { id: 'system:1', seq: 1, at: 1, category: 'system', tokens: 7, name: 'System prompt', text: 'Be concise' },
  { id: 'tools:2:0', seq: 2, at: 2, category: 'tools', tokens: 15, name: 'dot_read', text: '{"name":"dot_read","description":"Read a session"}' },
  { id: 'user:3', seq: 3, at: 3, category: 'user', tokens: 8, text: 'Hello Dorothy' },
]

describe('current context browser', () => {
  it('shows seven categories and expands current item text and formatted JSON', async () => {
    const root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<SurfaceBrowser locale="zh" surface={{ parts: surfaceParts(nodes), nodes }} />))
    const categories = document.querySelectorAll<HTMLButtonElement>('.dsh-dot-surface-category')
    expect(categories).toHaveLength(7)
    expect(categories[3]!.disabled).toBe(true)
    await act(async () => categories[0]!.click())
    await act(async () => document.querySelector<HTMLButtonElement>('.dsh-dot-surface-node > button')!.click())
    expect(document.querySelector('pre')!.textContent).toBe('Be concise')
    await act(async () => document.querySelectorAll<HTMLButtonElement>('.dsh-dot-surface-category')[1]!.click())
    await act(async () => document.querySelectorAll<HTMLButtonElement>('.dsh-dot-surface-node > button')[1]!.click())
    expect(document.querySelectorAll('pre')[1]!.textContent).toContain('"name": "dot_read"')
    expect(document.body.textContent).not.toContain('Old question')
    await act(async () => root.unmount())
  })
})
