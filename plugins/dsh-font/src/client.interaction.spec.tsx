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
