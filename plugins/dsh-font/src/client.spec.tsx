import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CODE_FONT_PRESETS, CONVERSATION_STORAGE_KEY, STORAGE_KEY, UI_FONT_PRESETS } from './contracts.ts'
import { FontField, apply, fontCopy, inject } from './client.tsx'

describe('font client contract', () => {
  it('injects exactly the services it consumes and localizes its copy', () => {
    expect([...inject]).toEqual(['slots', 'theme', 'locale'])
    expect(fontCopy('zh').label).toBe('字体')
    expect(fontCopy('en').label).toBe('Font')
    expect(fontCopy('zh').loadFonts).toBe('读取系统字体')
    expect(fontCopy('zh').reloadFonts).toBe('重新读取系统字体')
    expect(fontCopy('zh').fontsLoaded(237)).toContain('237')
    expect(fontCopy('zh').fontsPartial).toContain('当前用户')
    expect(fontCopy('en').fontsLoaded(237)).toContain('237')
    expect(fontCopy('en').fontsPartial).toContain('current user')
    expect(fontCopy('en').systemGroup).toBe('Installed fonts')
  })
})

function documentFixture() {
  const nodes: Array<{ attrs: Map<string, string>; textContent: string; remove(): void }> = []
  const styleCalls: string[] = []
  const values = new Map<string, string>()
  const head = {
    appendChild(node: (typeof nodes)[number]) { nodes.push(node) },
  }
  return {
    nodes,
    styleCalls,
    document: {
      head,
      createElement() {
        return {
          attrs: new Map<string, string>(),
          textContent: '',
          setAttribute(key: string, value: string) { this.attrs.set(key, value) },
          remove() { const i = nodes.indexOf(this as never); if (i >= 0) nodes.splice(i, 1) },
        }
      },
      documentElement: {
        style: {
          getPropertyValue: (name: string) => values.get(name) ?? '',
          getPropertyPriority: () => '',
          setProperty(name: string, value: string) { values.set(name, value); styleCalls.push(`set ${name} = ${value}`) },
          removeProperty(name: string) { values.delete(name); styleCalls.push(`remove ${name}`) },
        },
      },
    },
  }
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
  }
}

function mountClient(options: { locale?: string; storage?: Record<string, string>; fontSize?: number } = {}) {
  const fixture = documentFixture()
  vi.stubGlobal('document', fixture.document)
  vi.stubGlobal('localStorage', memoryStorage(options.storage))
  const effects: Array<{ run: () => (() => void) | void; label?: string; dispose: (() => void) | void }> = []
  let seat = ''
  let registration: unknown
  let render: ((props: unknown) => ReactNode) | undefined
  const sizes: number[] = []
  const listeners = new Set<() => void>()
  let snapshot = { fontSizes: { text: options.fontSize ?? 14, code: 14, terminal: 14 }, fontFamilies: { text: '', code: '', terminal: '' } }
  const families: Array<[string, string]> = []
  const context = {
    effect(run: () => (() => void) | void, label?: string) { effects.push({ run, label, dispose: run() }) },
    slots: {
      inject(key: string, callback: () => unknown) { seat = key; callback(); return () => {} },
      register(spec: unknown, callback: (props: unknown) => ReactNode) { registration = spec; render = callback; return () => {} },
    },
    theme: {
      getTheme: () => snapshot,
      setFontSize(role: 'text' | 'code' | 'terminal', px: number) { sizes.push(px); snapshot = { ...snapshot, fontSizes: { ...snapshot.fontSizes, [role]: px } } },
      setFontFamily(role: 'text' | 'code' | 'terminal', value: string) { families.push([role, value]); snapshot = { ...snapshot, fontFamilies: { ...snapshot.fontFamilies, [role]: value } } },
    },
    locale: {
      getSnapshot: () => ({ active: options.locale ?? 'zh-CN' }),
      subscribe: () => () => {},
    },
    on(_event: string, listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  apply(context as never)
  return { fixture, effects, sizes, families, listeners, change: () => { for (const listener of listeners) listener() },
    getSeat: () => seat, getRegistration: () => registration, getRender: () => render }
}

afterEach(() => vi.unstubAllGlobals())

describe('font client apply', () => {
  it('mounts owned stylesheets and removes them with the effects', () => {
    const { fixture, effects } = mountClient()
    expect(fixture.nodes).toHaveLength(2)
    expect(fixture.nodes[0].attrs.get('data-plugin')).toBe('@klarkxy/dsh-font')
    expect(fixture.nodes[0].textContent.length).toBeGreaterThan(1000)
    expect(fixture.nodes[1].attrs.get('data-font-role')).toBe('conversation')
    for (const effect of effects) effect.dispose?.()
    expect(fixture.nodes).toHaveLength(0)
  })

  it('maintains a conversation stylesheet scoped to the chat region', () => {
    const dom = new JSDOM('<div id="root"></div>', { url: 'https://local.test/' })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('localStorage', dom.window.localStorage)
    const disposes: Array<(() => void) | void> = []
    const context = {
      effect(run: () => (() => void) | void) { disposes.push(run()) },
      slots: {
        inject(_key: string, callback: () => unknown) { callback(); return () => {} },
        register: () => () => {},
      },
      theme: {
        getTheme: () => ({ fontSizes: { text: 14, code: 14, terminal: 14 }, fontFamilies: { text: '', code: '', terminal: '' } }),
        setFontSize() {},
        setFontFamily() {},
      },
      locale: { getSnapshot: () => ({ active: 'zh' }), subscribe: () => () => {} },
      on: () => () => {},
    }
    try {
      apply(context as never)
      const style = dom.window.document.querySelector('style[data-font-role="conversation"]') as HTMLStyleElement
      expect(style).toBeTruthy()
      const sheet = style.sheet!
      expect(sheet.cssRules).toHaveLength(0)
      dom.window.localStorage.setItem(CONVERSATION_STORAGE_KEY, '"Serif", serif')
      dom.window.dispatchEvent(new dom.window.StorageEvent('storage', { key: CONVERSATION_STORAGE_KEY }))
      expect(sheet.cssRules).toHaveLength(1)
      const rule = sheet.cssRules[0] as CSSStyleRule
      expect(rule.selectorText).toBe('[data-conversation-region="chat"]')
      expect(rule.style.getPropertyValue('--dsw-font-family')).toBe('"Serif", serif, var(--dsh-font-family-text-default)')
      expect(rule.style.getPropertyValue('font-family')).toBe('var(--dsw-font-family)')
      dom.window.localStorage.removeItem(CONVERSATION_STORAGE_KEY)
      dom.window.dispatchEvent(new dom.window.StorageEvent('storage', { key: CONVERSATION_STORAGE_KEY }))
      expect(sheet.cssRules).toHaveLength(0)
    } finally {
      for (const dispose of disposes) dispose?.()
      vi.unstubAllGlobals()
      dom.window.close()
    }
  })

  it('migrates stored stacks through the host without document overrides', () => {
    const { fixture, effects, families } = mountClient({
      storage: { [STORAGE_KEY]: '{"uiFont":"Local Sans","codeFont":"Local Mono"}' },
    })
    expect(families).toEqual([['text', 'Local Sans'], ['code', 'Local Mono'], ['terminal', 'Local Mono']])
    expect(fixture.styleCalls).toEqual([])
    for (const effect of effects) effect.dispose?.()
    expect(families).toHaveLength(3)
  })

  it('registers the settings panel under the package key', () => {
    const mounted = mountClient()
    expect(mounted.getSeat()).toBe('plugins.bundle.config')
    expect(mounted.getRegistration()).toMatchObject({ name: 'plugins.bundle.config', key: '@klarkxy/dsh-font' })
  })

  it('stops writing after unload', async () => {
    const mounted = mountClient({ storage: { [STORAGE_KEY]: '{"codeFont":"Local Mono"}' } })
    mounted.change()
    for (const effect of mounted.effects) effect.dispose?.()
    const afterUnload = [...mounted.fixture.styleCalls]
    await Promise.resolve()
    expect(mounted.fixture.styleCalls).toEqual(afterUnload)
    expect(mounted.listeners.size).toBe(0)
  })
})

describe('font settings panel', () => {
  it('renders the four fields in Chinese without a custom input by default', () => {
    const mounted = mountClient()
    const html = renderToStaticMarkup(mounted.getRender()!({ view: 'page' }) as ReactNode)
    expect(html.indexOf('界面字体')).toBeLessThan(html.indexOf('对话字体'))
    expect(html.indexOf('对话字体')).toBeLessThan(html.indexOf('代码字体'))
    expect(html.indexOf('代码字体')).toBeLessThan(html.indexOf('会话字号'))
    expect(html).toContain('跟随界面字体')
    expect(html.match(/<select\b/g)).toHaveLength(4)
    expect(html).not.toContain('dsh-stub-input')
    expect(html).toContain('data-testid="font-settings"')
  })

  it('renders English copy and the custom input when the stack matches no preset', () => {
    const mounted = mountClient({
      locale: 'en',
      storage: { [STORAGE_KEY]: '{"uiFont":"\\"My Font\\", sans-serif"}' },
    })
    const html = renderToStaticMarkup(mounted.getRender()!({ view: 'page' }) as ReactNode)
    expect(html).toContain('Interface font')
    expect(html).toContain('>Conversation font<')
    expect(html).toContain('Same as interface font')
    expect(html).toContain('Code font')
    expect(html).toContain('Conversation font size')
    expect(html).toContain('dsh-stub-input')
    expect(html).toContain('&quot;My Font&quot;, sans-serif')
  })

  it.each([
    ['zh-CN', '默认', '同界面'],
    ['en', 'Default', 'Same as UI'],
  ])('renders the %s summary with preset names and the current size', (locale, defaultName, followUi) => {
    const mounted = mountClient({
      locale,
      storage: { [STORAGE_KEY]: JSON.stringify({ uiFont: '', codeFont: CODE_FONT_PRESETS.find(p => p.id === 'jetbrains-mono')!.value }) },
      fontSize: 16,
    })
    const html = renderToStaticMarkup(mounted.getRender()!({ view: 'summary' }) as ReactNode)
    expect(html).toContain('data-testid="font-summary"')
    expect(html).toContain(defaultName)
    expect(html).toContain(followUi)
    expect(html).toContain('JetBrains Mono')
    expect(html).toContain('16px')
  })
})

describe('system font picker', () => {
  it('offers loaded system families in a dedicated optgroup', () => {
    const html = renderToStaticMarkup(<FontField
      label="界面字体"
      help="help"
      value=""
      presets={UI_FONT_PRESETS}
      locale="zh"
      generic="sans-serif"
      systemFonts={[
        { family: 'Test Sans', fullName: '' },
        { family: 'DFPShaoNvW5-GB', fullName: '华康少女文字W5(P)' },
      ]}
      defaultLabel="默认"
      customLabel="自定义…"
      customPlaceholder="placeholder"
      systemGroupLabel="系统字体"
      onCommit={() => {}}
    />)
    expect(html).toContain('<optgroup label="系统字体">')
    expect(html).toContain('value="sys:Test Sans"')
    // The option value is the exact family CSS needs; a zh UI leads with the zh name.
    expect(html).toContain('value="sys:DFPShaoNvW5-GB"')
    expect(html).toContain('华康少女文字W5(P)（DFPShaoNvW5-GB）')
    // A fresh field starts on Default even with the group present.
    expect(html).not.toContain('dsh-stub-input')
  })
})
