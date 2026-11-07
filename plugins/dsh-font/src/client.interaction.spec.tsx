import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { expect, it, vi } from 'vitest'
import { CONVERSATION_STORAGE_KEY, createConversationFontStore } from './contracts.ts'
import { FontSettingsGroup } from './client.tsx'
import { type FontRole, type FontThemeSnapshot } from './preferences.ts'

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
  }
}

function buttonByText(text: string): HTMLButtonElement {
  const button = [...document.querySelectorAll('button')].find(item => item.textContent === text)
  if (!button) throw new Error(`no button labelled "${text}"`)
  return button
}

function buttonByLabel(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === label)
  if (!button) throw new Error(`no button labelled "${label}"`)
  return button
}

it('renders every role row on its own page: families and sizes write their stores, native edits sync, and the two resets stay independent', async () => {
  const dom = new JSDOM('<div id="root"></div>')
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let snapshot: FontThemeSnapshot = { fontSizes: { text: 16, code: 15, terminal: 13 }, fontFamilies: { text: '', code: '', terminal: 'Terminal Mono' } }
  const listeners = new Set<() => void>(), localeListeners = new Set<() => void>()
  const writes: Array<[FontRole, string | number]> = []
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
  const storage = memoryStorage()
  const conversation = createConversationFontStore(storage)
  const root = createRoot(document.getElementById('root')!)
  async function select(index: number, value: string) {
    await act(async () => { const field = document.querySelectorAll('select')[index]!; field.value = value; field.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
  }
  try {
    await act(async () => root.render(<FontSettingsGroup client={client} conversation={conversation} />))
    // The page shows all four family fields and all three size steppers — no
    // expander; the page itself is the disclosure the General item provided.
    expect(document.querySelectorAll('select')).toHaveLength(4)
    expect(document.querySelectorAll('.font-stepper-value')).toHaveLength(3)
    expect(document.body.textContent).toContain('Terminal font')
    expect(document.body.textContent).toContain('Terminal font size')
    await select(0, 'yahei')
    const themeWrites = writes.length
    await select(1, 'source-han-serif')
    // The conversation field writes its own browser-local store, not a theme role.
    expect(writes.length).toBe(themeWrites)
    expect(conversation.get()).toBe('"Source Han Serif SC", "Noto Serif CJK SC", "Noto Serif SC", serif')
    expect(storage.data.get(CONVERSATION_STORAGE_KEY)).toBe(conversation.get())
    await select(2, 'consolas')
    expect(writes.at(-1)).toEqual(['code', 'Consolas, monospace'])
    expect(snapshot.fontFamilies.code).toBe('Consolas, monospace')
    await select(3, 'cascadia')
    expect(writes.at(-1)).toEqual(['terminal', '"Cascadia Mono", "Cascadia Code", monospace'])
    expect(snapshot.fontFamilies.terminal).toBe('"Cascadia Mono", "Cascadia Code", monospace')
    // Steppers write the same theme entries the native cell used.
    await act(async () => buttonByLabel('Increase font size').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
    expect(writes.at(-1)).toEqual(['text', 17])
    await act(async () => buttonByLabel('Decrease terminal font size').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
    expect(writes.at(-1)).toEqual(['terminal', 12])
    // Native edits elsewhere (another writer into the same settings) reflect
    // back through theme/change.
    await act(async () => { snapshot = { ...snapshot, fontSizes: { ...snapshot.fontSizes, code: 16 }, fontFamilies: { ...snapshot.fontFamilies, code: 'Native Mono' } }; publish() })
    expect(document.querySelector('input')!.value).toBe('Native Mono')
    await act(async () => { locale = 'zh'; for (const fn of localeListeners) fn() })
    expect(document.body.textContent).toContain('终端字体')
    // Reset fonts restores the three host families and the conversation font,
    // leaving every size untouched.
    await act(async () => buttonByText('恢复默认字体').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
    expect(snapshot.fontFamilies).toEqual({ text: '', code: '', terminal: '' })
    expect(conversation.get()).toBe('')
    expect(storage.data.has(CONVERSATION_STORAGE_KEY)).toBe(false)
    expect(snapshot.fontSizes).toEqual({ text: 17, code: 16, terminal: 12 })
    // Reset sizes restores the role defaults only, leaving every family alone.
    snapshot = { ...snapshot, fontFamilies: { ...snapshot.fontFamilies, text: 'Kept Sans' } }
    await act(async () => buttonByText('恢复默认字号').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
    expect(writes.slice(-3)).toEqual([['text', 14], ['code', 11], ['terminal', 13]])
    expect(snapshot.fontFamilies.text).toBe('Kept Sans')
  } finally {
    await act(async () => root.unmount()); vi.unstubAllGlobals(); dom.window.close()
  }
})

it('loads system fonts through the browser API and degrades cleanly without it', async () => {
  const dom = new JSDOM('<div id="root"></div>')
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const snapshot: FontThemeSnapshot = { fontSizes: { text: 14, code: 11, terminal: 13 }, fontFamilies: { text: '', code: '', terminal: '' } }
  const client = {
    theme: { getTheme: () => snapshot, setFontSize() {}, setFontFamily() {} },
    locale: { getSnapshot: () => ({ active: 'zh' }), subscribe: () => () => {} },
    on: () => () => {},
    slots: { inject: () => () => {}, register: () => () => {} },
  }
  const conversation = createConversationFontStore(undefined)
  const root = createRoot(document.getElementById('root')!)
  try {
    await act(async () => root.render(<FontSettingsGroup client={client} conversation={conversation} />))
    // Duplicates per style are expected from the Local Font Access API.
    vi.stubGlobal('queryLocalFonts', async () => [{ family: 'Test Sans', fullName: '' }, { family: 'Test Sans', fullName: '' }])
    await act(async () => buttonByText('读取系统字体').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
    // All four fields share the one enumeration; duplicates collapse per family.
    expect(document.querySelectorAll('option[value="sys:Test Sans"]')).toHaveLength(4)
    expect(document.body.textContent).toContain('已读取 1 款系统字体')
    expect(document.body.textContent).toContain('重新读取系统字体')

    vi.stubGlobal('queryLocalFonts', undefined)
    await act(async () => buttonByText('重新读取系统字体').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
    expect(document.body.textContent).toContain('系统字体读取被拒绝')
    expect(document.querySelector('option[value="sys:Test Sans"]')).toBeNull()
  } finally {
    await act(async () => root.unmount()); vi.unstubAllGlobals(); dom.window.close()
  }
})
