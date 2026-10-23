import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { expect, it, vi } from 'vitest'
import { FontSettingsPanel } from './client.tsx'
import { type FontRole, type FontThemeSnapshot } from './preferences.ts'

it('reads native edits, writes the text role, resets only panel-controlled roles, and keeps locale live', async () => {
  const dom = new JSDOM('<div id="root"></div>')
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let snapshot: FontThemeSnapshot = { fontSizes: { text: 16, code: 15, terminal: 13 }, fontFamilies: { text: '', code: '', terminal: 'Terminal Mono' } }
  const listeners = new Set<() => void>(), localeListeners = new Set<() => void>()
  const writes: unknown[] = []
  let locale = 'en'
  const publish = () => { for (const fn of listeners) fn() }
  const client = {
    theme: {
      getTheme: () => snapshot,
      setFontSize(role: FontRole, px: number) { writes.push([role, px]); snapshot = { ...snapshot, fontSizes: { ...snapshot.fontSizes, [role]: px } }; publish() },
      setFontFamily(role: FontRole, value: string) { writes.push([role, value]); snapshot = { ...snapshot, fontFamilies: { ...snapshot.fontFamilies, [role]: value } }; publish() },
    },
    locale: { getSnapshot: () => ({ active: locale }), subscribe(fn: () => void) { localeListeners.add(fn); return () => { localeListeners.delete(fn) } } },
    on(_event: string, fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } },
    slots: { inject: () => () => {}, register: () => () => {} },
  }
  const root = createRoot(document.getElementById('root')!)
  async function select(index: number, value: string) {
    await act(async () => { const field = document.querySelectorAll('select')[index]!; field.value = value; field.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
  }
  try {
    await act(async () => root.render(<FontSettingsPanel client={client} />))
    expect(document.querySelectorAll('select')[2]!.value).toBe('16')
    await select(0, 'yahei'); await select(1, 'consolas'); await select(2, '18')
    expect(writes.at(-1)).toEqual(['text', 18])
    expect(snapshot.fontFamilies.code).toBe('Consolas, monospace')
    await act(async () => { snapshot = { ...snapshot, fontSizes: { ...snapshot.fontSizes, text: 20 }, fontFamilies: { ...snapshot.fontFamilies, code: 'Native Mono' } }; publish() })
    expect(document.querySelectorAll('select')[2]!.value).toBe('20')
    expect(document.querySelector('input')!.value).toBe('Native Mono')
    await act(async () => { locale = 'zh'; for (const fn of localeListeners) fn() })
    expect(document.body.textContent).toContain('终端字体和字号')
    await act(async () => document.querySelectorAll('button')[1]!.click())
    expect(snapshot.fontSizes).toEqual({ text: 14, code: 15, terminal: 13 })
    expect(snapshot.fontFamilies).toEqual({ text: '', code: '', terminal: 'Terminal Mono' })
  } finally {
    await act(async () => root.unmount()); vi.unstubAllGlobals(); dom.window.close()
  }
})

it('loads system fonts through the browser API and degrades cleanly without it', async () => {
  const dom = new JSDOM('<div id="root"></div>')
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const snapshot: FontThemeSnapshot = { fontSizes: { text: 14, code: 14, terminal: 14 }, fontFamilies: { text: '', code: '', terminal: '' } }
  const client = {
    theme: { getTheme: () => snapshot, setFontSize() {}, setFontFamily() {} },
    locale: { getSnapshot: () => ({ active: 'zh' }), subscribe: () => () => {} },
    on: () => () => {},
    slots: { inject: () => () => {}, register: () => () => {} },
  }
  const root = createRoot(document.getElementById('root')!)
  try {
    await act(async () => root.render(<FontSettingsPanel client={client} />))
    const loadButton = () => document.querySelectorAll('button')[0]!
    // Duplicates per style are expected from the Local Font Access API.
    vi.stubGlobal('queryLocalFonts', async () => [{ family: 'Test Sans', fullName: '' }, { family: 'Test Sans', fullName: '' }])
    await act(async () => loadButton().click())
    // Both fields share the one enumeration; duplicates collapse per family.
    expect(document.querySelectorAll('option[value="sys:Test Sans"]')).toHaveLength(2)
    expect(document.body.textContent).toContain('已读取 1 款系统字体')
    expect(loadButton().textContent).toBe('重新读取系统字体')

    vi.stubGlobal('queryLocalFonts', undefined)
    await act(async () => loadButton().click())
    expect(document.body.textContent).toContain('系统字体读取被拒绝')
    expect(document.querySelector('option[value="sys:Test Sans"]')).toBeNull()
  } finally {
    await act(async () => root.unmount()); vi.unstubAllGlobals(); dom.window.close()
  }
})
