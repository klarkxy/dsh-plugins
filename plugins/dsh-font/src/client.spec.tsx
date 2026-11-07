import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import {
  CODE_FONT_PRESETS, CONVERSATION_STORAGE_KEY, STORAGE_KEY, TEXT_DEFAULT_FONT_VARIABLE,
  UI_FONT_PRESETS, UI_FONT_VARIABLE, createConversationFontStore, cssVar,
} from './contracts.ts'
import { FontField, FontSettingsGroup, FontSizeField, apply, fontCopy, inject } from './client.tsx'

describe('font client contract', () => {
  it('injects exactly the services it consumes and localizes its copy', () => {
    expect([...inject]).toEqual(['slots', 'theme', 'locale'])
    expect(fontCopy('zh').label).toBe('字体')
    expect(fontCopy('en').label).toBe('Font')
    expect(fontCopy('zh').resetFonts).toBe('恢复默认字体')
    expect(fontCopy('en').resetFonts).toBe('Reset fonts')
    expect(fontCopy('zh').resetSizes).toBe('恢复默认字号')
    expect(fontCopy('en').resetSizes).toBe('Reset font sizes')
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

function mountClient(options: { locale?: string; storage?: Record<string, string> } = {}) {
  const fixture = documentFixture()
  vi.stubGlobal('document', fixture.document)
  vi.stubGlobal('localStorage', memoryStorage(options.storage))
  const effects: Array<{ run: () => (() => void) | void; label?: string; dispose: (() => void) | void }> = []
  const injected: string[] = []
  const registrations: Array<{ spec: Record<string, unknown>; render: unknown }> = []
  const listeners = new Set<() => void>()
  let snapshot = { fontSizes: { text: 14, code: 11, terminal: 13 }, fontFamilies: { text: '', code: '', terminal: '' } }
  const sizes: Array<[string, number]> = []
  const families: Array<[string, string]> = []
  const context = {
    effect(run: () => (() => void) | void, label?: string) { effects.push({ run, label, dispose: run() }) },
    slots: {
      inject(key: string, callback: () => unknown) { injected.push(key); callback(); return () => {} },
      register(spec: Record<string, unknown>, callback: unknown) { registrations.push({ spec, render: callback }); return () => {} },
    },
    theme: {
      getTheme: () => snapshot,
      setFontSize(role: 'text' | 'code' | 'terminal', px: number) { sizes.push([role, px]); snapshot = { ...snapshot, fontSizes: { ...snapshot.fontSizes, [role]: px } } },
      setFontFamily(role: 'text' | 'code' | 'terminal', value: string) { families.push([role, value]); snapshot = { ...snapshot, fontFamilies: { ...snapshot.fontFamilies, [role]: value } } },
    },
    locale: {
      getSnapshot: () => ({ active: options.locale ?? 'zh-CN' }),
      subscribe: () => () => {},
    },
    on(_event: string, listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  apply(context as never)
  return { fixture, effects, sizes, families, listeners, registrations, injected, change: () => { for (const listener of listeners) listener() } }
}

/** The panel's minimal client double — same shape mountClient applies. */
function clientDouble(options: { locale?: string; families?: { text?: string; code?: string; terminal?: string }; sizes?: { text?: number; code?: number; terminal?: number } } = {}) {
  const snapshot = {
    fontSizes: { text: 14, code: 11, terminal: 13, ...options.sizes },
    fontFamilies: { text: '', code: '', terminal: '', ...options.families },
  }
  return {
    theme: {
      getTheme: () => snapshot,
      setFontSize() {},
      setFontFamily() {},
    },
    locale: { getSnapshot: () => ({ active: options.locale ?? 'zh-CN' }), subscribe: () => () => {} },
    on: () => () => {},
    slots: { inject: () => () => {}, register: () => () => {} },
  }
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
        getTheme: () => ({ fontSizes: { text: 14, code: 11, terminal: 13 }, fontFamilies: { text: '', code: '', terminal: '' } }),
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
      expect(rule.style.getPropertyValue(UI_FONT_VARIABLE)).toBe(`"Serif", serif, ${cssVar(TEXT_DEFAULT_FONT_VARIABLE)}`)
      expect(rule.style.getPropertyValue('font-family')).toBe(cssVar(UI_FONT_VARIABLE))
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

  it('registers its own settings section and waits on the General list for the shadow', () => {
    const mounted = mountClient()
    expect(mounted.injected).toEqual(['settings.section', 'settings.general.item', 'settings.section.icon'])
    expect(mounted.registrations).toHaveLength(3)
    const section = mounted.registrations[0].spec
    expect(section).toMatchObject({ name: 'settings.section', id: 'font', order: 5 })
    expect(typeof section.label).toBe('function')
    expect((section.label as () => string)()).toBe('字体')
    const shadow = mounted.registrations[1].spec
    expect(shadow).toEqual({ name: 'settings.general.item', id: 'font-size', order: 11, priority: -10 })
    // The shadow component replaces the native cell's render output with nothing.
    expect((mounted.registrations[1].render as () => ReactNode)()).toBeNull()
    // The nav icon mirrors the section id and renders the owner {size, active}
    // props as an aria-hidden currentColor svg of the requested edge.
    const icon = mounted.registrations[2]
    expect(icon.spec).toMatchObject({ name: 'settings.section.icon', id: 'font', order: 5 })
    const iconElement = (icon.render as (props: unknown) => { type: string; props: Record<string, unknown> })({ size: 18, active: true })
    expect(iconElement.type).toBe('svg')
    expect(iconElement.props['aria-hidden']).toBe('true')
    expect(iconElement.props.width).toBe(18)
    expect(iconElement.props.stroke).toBe('currentColor')
    // No General-section item of its own: the plugin contributes no 'font' row.
    expect(mounted.registrations.some(entry => entry.spec.name === 'settings.general.item' && entry.spec.id === 'font')).toBe(false)
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

describe('native font-size cell shadowing', () => {
  /**
   * Real SlotCore lifecycle. The shadow nests two declaration waits:
   * settings.section gates the font page and the second wait itself, and
   * settings.general.item gates the shadow entry — so the native cell is
   * hidden exactly while the font page exists, and only for as long as the
   * General column is declared.
   */

  /** Minimal declaration-lifetime wait: runs the callback while the key is
   * declared, collects its disposers on collapse, redeclare, or stop. The
   * callback's own nested inject controllers die with it, mirroring how the
   * runtime installs callback work under the caller's ctx.effect. */
  function declarationInject(core: SlotCore, key: string, callback: () => unknown): () => void {
    let active: (() => void) | undefined
    let epoch = -1
    let stopped = false
    const reconcile = () => {
      if (stopped) return
      const nextEpoch = core.specDynamic(key) === undefined ? -1 : core.declarationEpoch(key)
      if (nextEpoch === epoch) return
      epoch = nextEpoch
      active?.()
      active = undefined
      if (epoch === -1) return
      const created = callback()
      // One disposer or an iterable of them.
      const disposers = created === undefined || created === null ? []
        : Array.isArray(created) ? created : [created]
      active = () => { for (const dispose of [...disposers].reverse()) (dispose as (() => void) | undefined)?.() }
    }
    const unsubscribe = core.subscribeDeclaration(key, reconcile)
    reconcile()
    return () => { stopped = true; unsubscribe(); active?.(); active = undefined }
  }

  function mountWithCore(core: SlotCore) {
    vi.stubGlobal('document', documentFixture().document)
    vi.stubGlobal('localStorage', memoryStorage())
    const disposers: Array<(() => void) | void> = []
    const context = {
      effect(run: () => (() => void) | void) { const dispose = run(); disposers.push(dispose); return dispose },
      slots: {
        inject: (key: string, callback: () => unknown) => {
          const stop = declarationInject(core, key, callback)
          disposers.push(stop)
          return stop
        },
        register: (spec: Record<string, unknown>, render: unknown) => core.register(spec as never, render as never),
      },
      theme: {
        getTheme: () => ({ fontSizes: { text: 14, code: 11, terminal: 13 }, fontFamilies: { text: '', code: '', terminal: '' } }),
        setFontSize() {},
        setFontFamily() {},
      },
      locale: { getSnapshot: () => ({ active: 'zh-CN' }), subscribe: () => () => {} },
      on: () => () => {},
    }
    apply(context as never)
    return { unload: () => { for (const dispose of [...disposers].reverse()) dispose?.() } }
  }

  /** Declare a child list slot through a root entry, like the shell declares
   * the settings seats through its children table. `priority` separates
   * coexisting root declarations so a test can collapse one at a time. */
  function declareListSlot(core: SlotCore, key: string, priority = 0) {
    return core.register({ name: 'root', priority, children: { [key]: { kind: 'list', scope: 'root' } } }, () => 'decl')
  }

  /** Host-side topology: the sections list, the General section declaring the
   * item list through its children table, and the native font-size cell at
   * the default priority. */
  function hostSeats(core: SlotCore) {
    const native = () => 'native font-size cell'
    const disposeShell = declareListSlot(core, 'settings.section')
    const disposeGeneral = core.register({
      name: 'settings.section', id: 'general', order: 0,
      children: { 'settings.general.item': { kind: 'list', scope: 'root' } },
    }, () => 'general section')
    core.register({ name: 'settings.general.item', id: 'font-size', order: 11 }, native)
    return { native, disposeShell, disposeGeneral }
  }

  it('shadows the native cell while the font section lives and restores it on unload', () => {
    const core = new SlotCore()
    const { native } = hostSeats(core)
    expect(core.entriesOfSlot('settings.general.item').map(entry => entry.component)).toEqual([native])
    const mounted = mountWithCore(core)
    // The same-id shadow wins its cell; the native entry stays on the ledger.
    expect(core.entries('settings.general.item')).toHaveLength(2)
    const winner = core.entriesOfSlot('settings.general.item')
    expect(winner).toHaveLength(1)
    expect(winner[0].options.priority).toBe(-10)
    expect(winner[0].component()).toBeNull()
    expect(core.entriesOfSlot('settings.section').some(entry => entry.options.id === 'font')).toBe(true)
    mounted.unload()
    expect(core.entriesOfSlot('settings.general.item').map(entry => entry.component)).toEqual([native])
    expect(core.entriesOfSlot('settings.section').some(entry => entry.options.id === 'font')).toBe(false)
  })

  it('installs the shadow only after the General list is declared and re-shadows on redeclare', () => {
    const core = new SlotCore()
    declareListSlot(core, 'settings.section')
    const mounted = mountWithCore(core)
    // The font page registers immediately; the general wait holds because the
    // item list is undeclared — nothing shadows anything yet.
    expect(core.entriesOfSlot('settings.section').some(entry => entry.options.id === 'font')).toBe(true)
    expect(core.entries('settings.general.item')).toHaveLength(0)
    // The General section arrives later: the nested wait installs the shadow.
    const { native, disposeGeneral } = (() => {
      const native = () => 'native font-size cell'
      const disposeGeneral = core.register({
        name: 'settings.section', id: 'general', order: 0,
        children: { 'settings.general.item': { kind: 'list', scope: 'root' } },
      }, () => 'general section')
      core.register({ name: 'settings.general.item', id: 'font-size', order: 11 }, native)
      return { native, disposeGeneral }
    })()
    expect(core.entriesOfSlot('settings.general.item')[0].options.priority).toBe(-10)
    expect(core.entries('settings.general.item')).toHaveLength(2)
    // A collapse of the General section retracts the item list and the shadow
    // with it; a redeclare puts the shadow back over the native cell.
    disposeGeneral()
    expect(core.entries('settings.general.item')).toHaveLength(0)
    core.register({
      name: 'settings.section', id: 'general', order: 0,
      children: { 'settings.general.item': { kind: 'list', scope: 'root' } },
    }, () => 'general section')
    core.register({ name: 'settings.general.item', id: 'font-size', order: 11 }, native)
    expect(core.entriesOfSlot('settings.general.item')[0].options.priority).toBe(-10)
    mounted.unload()
    expect(core.entriesOfSlot('settings.general.item').map(entry => entry.component)).toEqual([native])
  })

  it('restores the native cell when the settings.section declaration collapses', () => {
    const core = new SlotCore()
    // The two declarations live under different root entries so the sections
    // list can collapse while the General item list survives.
    const disposeSections = declareListSlot(core, 'settings.section')
    const disposeItemList = declareListSlot(core, 'settings.general.item', 1)
    core.register({ name: 'settings.general.item', id: 'font-size', order: 11 }, () => 'native')
    core.register({ name: 'settings.section', id: 'placeholder', order: 99 }, () => null)
    const mounted = mountWithCore(core)
    expect(core.entriesOfSlot('settings.general.item')[0].options.priority).toBe(-10)
    // The sections list collapses (e.g. the shell entry leaves): the font
    // page and its nested shadow wait die together.
    disposeSections()
    expect(core.entriesOfSlot('settings.general.item')).toHaveLength(1)
    expect(core.entriesOfSlot('settings.general.item')[0].options.priority ?? 0).toBe(0)
    mounted.unload()
    disposeItemList()
  })

  it('leaves the native cell alone while the settings.section slot is undeclared', () => {
    const core = new SlotCore()
    const disposeItemList = declareListSlot(core, 'settings.general.item')
    core.register({ name: 'settings.general.item', id: 'font-size', order: 11 }, () => 'native')
    const mounted = mountWithCore(core)
    // The outer wait is still pending: no section page and no shadow.
    expect(core.entriesOfSlot('settings.general.item')).toHaveLength(1)
    expect(core.entriesOfSlot('settings.general.item')[0].options.priority ?? 0).toBe(0)
    expect(core.entriesOfSlot('settings.section')).toHaveLength(0)
    mounted.unload()
    disposeItemList()
  })
})

describe('font settings page', () => {
  it('renders every family and size row in Chinese without an expander', () => {
    const client = clientDouble()
    const conversation = createConversationFontStore(undefined)
    const html = renderToStaticMarkup(<FontSettingsGroup client={client} conversation={conversation} />)
    expect(html).toContain('data-testid="font-settings"')
    expect(html).toContain('界面字体')
    expect(html).toContain('对话字体')
    expect(html).toContain('代码字体')
    expect(html).toContain('终端字体')
    expect(html).toContain('字号大小')
    expect(html).toContain('代码字号')
    expect(html).toContain('终端字号')
    expect(html).toContain('仅影响会话内容')
    expect(html.match(/<select\b/g)).toHaveLength(4)
    expect(html.match(/font-stepper-value/g)).toHaveLength(3)
    expect(html).not.toContain('aria-expanded')
  })

  it('renders all controls expanded in English with the native stepper labels', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const dom = new JSDOM('<div id="root"></div>')
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    const client = clientDouble({ locale: 'en', families: { text: '"My Font", sans-serif' } })
    const conversation = createConversationFontStore(undefined)
    const root = createRoot(document.getElementById('root')!)
    try {
      await act(async () => root.render(<FontSettingsGroup client={client} conversation={conversation} />))
      const text = document.body.textContent!
      expect(text).toContain('Interface font')
      expect(text).toContain('Conversation font')
      expect(text).toContain('Same as interface font')
      expect(text).toContain('Code font')
      expect(text).toContain('Terminal font')
      expect(text).toContain('Font size')
      expect(text).toContain('Code font size')
      expect(text).toContain('Terminal font size')
      expect(document.querySelectorAll('select')).toHaveLength(4)
      // A stored custom stack opens its own input.
      expect(document.querySelector('input')!.value).toBe('"My Font", sans-serif')
      // The native stepper's aria labels are per-role.
      expect(document.querySelector('button[aria-label="Increase font size"]')).not.toBeNull()
      expect(document.querySelector('button[aria-label="Decrease code font size"]')).not.toBeNull()
      expect(document.querySelector('button[aria-label="Increase terminal font size"]')).not.toBeNull()
    } finally {
      await act(async () => root.unmount())
      vi.unstubAllGlobals()
      dom.window.close()
    }
  })

  it('lists preset stacks inside the fields', () => {
    const html = renderToStaticMarkup(<FontField
      label="代码字体"
      help="help"
      value={CODE_FONT_PRESETS.find(p => p.id === 'jetbrains-mono')!.value}
      presets={CODE_FONT_PRESETS}
      locale="zh"
      generic="monospace"
      defaultLabel="默认"
      customLabel="自定义…"
      customPlaceholder="placeholder"
      systemGroupLabel="系统字体"
      onCommit={() => {}}
    />)
    expect(html).toContain('JetBrains Mono')
    expect(html).toContain('value="jetbrains-mono"')
  })

  it('clamps the stepper at the role bounds', () => {
    const html = (value: number) => renderToStaticMarkup(<FontSizeField
      label="字号大小"
      help="help"
      role="text"
      value={value}
      locale="zh"
      increaseLabel="增大字号"
      decreaseLabel="减小字号"
      unit="px"
      onCommit={() => {}}
    />)
    expect(html(22)).toContain('disabled')
    expect(html(14)).toContain('>14</span>')
    expect(html(10)).toContain('disabled')
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
