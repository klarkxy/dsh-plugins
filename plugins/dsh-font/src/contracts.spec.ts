import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CODE_FONT_PRESETS, CODE_FONT_VARIABLE, CONVERSATION_FONT_SELECTOR, CONVERSATION_STORAGE_KEY,
  FONT_SIZE_MAX, FONT_SIZE_MIN, STORAGE_KEY, TEXT_DEFAULT_FONT_VARIABLE, UI_FONT_PRESETS, UI_FONT_VARIABLE,
  applyFontSettings, clearFontSettings, conversationFontDeclarations, createConversationFontStore,
  createFontSettingsStore, cssVar, defaultFontSettings,
  fontStackFor, fontTokenDeclarations, normalizeFontFamily, parseFontSettings, presetFor,
  serializeFontSettings, systemFontLabel, uniqueSystemFonts,
} from './contracts.ts'

describe('font family normalization', () => {
  it('keeps quoted names, spaces and digits intact', () => {
    expect(normalizeFontFamily('"Microsoft YaHei", "PingFang SC", sans-serif'))
      .toBe('"Microsoft YaHei", "PingFang SC", sans-serif')
    expect(normalizeFontFamily('"Maple Mono NF CN", monospace')).toBe('"Maple Mono NF CN", monospace')
  })

  it('strips CSS delimiters, control characters and trims', () => {
    expect(normalizeFontFamily('  "Evil"; body { color: red } <script> ')).toBe('"Evil" body  color: red  script')
    expect(normalizeFontFamily(`a${String.fromCharCode(0, 31, 127)}b`)).toBe('ab')
    expect(normalizeFontFamily('\n\t "YaHei" \r\n')).toBe('"YaHei"')
  })

  it('rejects non-strings and caps length', () => {
    expect(normalizeFontFamily(42)).toBe('')
    expect(normalizeFontFamily(null)).toBe('')
    expect(normalizeFontFamily('x'.repeat(400))).toHaveLength(300)
  })
})

describe('settings parsing', () => {
  it('round-trips a valid settings object', () => {
    const settings = { uiFont: '"YaHei", sans-serif', codeFont: '"JetBrains Mono", monospace' }
    expect(parseFontSettings(serializeFontSettings(settings))).toEqual(settings)
  })

  it('falls back to defaults for garbage input', () => {
    expect(parseFontSettings('not json')).toEqual(defaultFontSettings())
    expect(parseFontSettings(null)).toEqual(defaultFontSettings())
    expect(parseFontSettings([])).toEqual(defaultFontSettings())
    expect(parseFontSettings(undefined)).toEqual(defaultFontSettings())
    expect(parseFontSettings('{"uiFont": 7, "codeFont": {}}')).toEqual(defaultFontSettings())
  })

  it('normalizes fields while parsing', () => {
    expect(parseFontSettings({ uiFont: ' "YaHei"; ', codeFont: undefined }))
      .toEqual({ uiFont: '"YaHei"', codeFont: '' })
  })
})

describe('presets', () => {
  it('has unique ids, non-empty stacks and bilingual labels', () => {
    for (const presets of [UI_FONT_PRESETS, CODE_FONT_PRESETS]) {
      expect(new Set(presets.map(preset => preset.id)).size).toBe(presets.length)
      for (const preset of presets) {
        expect(preset.value.length).toBeGreaterThan(0)
        expect(preset.label.zh.length).toBeGreaterThan(0)
        expect(preset.label.en.length).toBeGreaterThan(0)
      }
    }
  })

  it('matches a stored stack back to its preset', () => {
    expect(presetFor('"JetBrains Mono", monospace', CODE_FONT_PRESETS)?.id).toBe('jetbrains-mono')
    expect(presetFor('"Consolas", monospace', CODE_FONT_PRESETS)?.id).toBe('consolas')
    expect(presetFor('"Custom", monospace', CODE_FONT_PRESETS)).toBeUndefined()
    expect(presetFor('', UI_FONT_PRESETS)).toBeUndefined()
  })
})

describe('css variable application', () => {
  /** The rc.2 font tokens in ui-theme base.css. */
  it('targets the host font tokens verbatim', () => {
    expect(UI_FONT_VARIABLE).toBe('--dsw-font-family')
    expect(CODE_FONT_VARIABLE).toBe('--ds-font-family-code')
    expect(CONVERSATION_FONT_SELECTOR).toBe('[data-conversation-region="chat"]')
    expect(FONT_SIZE_MIN).toBe(10)
    expect(FONT_SIZE_MAX).toBe(22)
  })

  function recorder() {
    const calls: string[] = []
    return {
      calls,
      setProperty(name: string, value: string) { calls.push(`set ${name} = ${value}`) },
      removeProperty(name: string) { calls.push(`remove ${name}`) },
    }
  }

  it('sets chosen stacks and removes empty ones', () => {
    const style = recorder()
    applyFontSettings(style, { uiFont: '"YaHei", sans-serif', codeFont: '' })
    expect(style.calls).toEqual([
      'set --dsw-font-family = "YaHei", sans-serif',
      'remove --ds-font-family-code',
    ])
  })

  it('clears both overrides', () => {
    const style = recorder()
    clearFontSettings(style)
    expect(style.calls).toEqual(['remove --dsw-font-family', 'remove --ds-font-family-code'])
  })
})

describe('system font helpers', () => {
  it('builds a safely-quoted stack with the field generic', () => {
    expect(fontStackFor('Microsoft YaHei', 'sans-serif')).toBe('"Microsoft YaHei", sans-serif')
    expect(fontStackFor('JetBrains Mono', 'monospace')).toBe('"JetBrains Mono", monospace')
    expect(fontStackFor('We";\\{ird}', 'sans-serif')).toBe('"Weird", sans-serif')
    expect(fontStackFor('', 'monospace')).toBe('monospace')
  })

  it('dedupes, labels and sorts queryLocalFonts entries', () => {
    const fonts = [
      { family: 'JetBrains Mono', fullName: 'JetBrains Mono Regular', style: 'Regular' },
      { family: 'JetBrains Mono', fullName: 'JetBrains Mono Bold', style: 'Bold' },
      { family: 'DFPShaoNvW5-GB', fullName: '华康少女文字W5(P)', style: 'Regular' },
      { family: 'DFPShaoNvW5-GB', fullName: '华康少女文字W5(P)', style: 'Regular' },
      { family: ' Microsoft YaHei ', fullName: 'Microsoft YaHei' },
      { family: '' },
      { family: 42 },
      null,
      'garbage',
      { fullName: 'no family' },
    ]
    expect(uniqueSystemFonts(fonts)).toEqual([
      // A localized full name that adds information is kept as the alias.
      { family: 'DFPShaoNvW5-GB', fullName: '华康少女文字W5(P)' },
      // "JetBrains Mono Regular" only restates the family: no alias.
      { family: 'JetBrains Mono', fullName: '' },
      { family: 'Microsoft YaHei', fullName: '' },
    ])
    expect(uniqueSystemFonts([])).toEqual([])
  })

  it('leads the picker label with the name the UI locale recognizes', () => {
    const converted = { family: 'DFPShaoNvW5-GB', fullName: '华康少女文字W5(P)' }
    expect(systemFontLabel(converted, 'zh')).toBe('华康少女文字W5(P)（DFPShaoNvW5-GB）')
    expect(systemFontLabel(converted, 'en')).toBe('DFPShaoNvW5-GB（华康少女文字W5(P)）')
    expect(systemFontLabel({ family: 'Inter', fullName: '' }, 'zh')).toBe('Inter')
    expect(systemFontLabel({ family: 'Inter', fullName: '' }, 'en')).toBe('Inter')
  })
})

describe('local store', () => {
  function memoryStorage(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial))
    return {
      data,
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value) },
      removeItem: (key: string) => { data.delete(key) },
    }
  }

  it('loads defaults without storage and survives saves', () => {
    const store = createFontSettingsStore(undefined)
    expect(store.load()).toEqual(defaultFontSettings())
    expect(() => store.save({ uiFont: '"YaHei"', codeFont: '' })).not.toThrow()
    expect(store.load()).toEqual({ uiFont: '"YaHei"', codeFont: '' })
    store.save({ ...store.load(), codeFont: 'Consolas' })
    expect(store.load()).toEqual({ uiFont: '"YaHei"', codeFont: 'Consolas' })
    store.save(defaultFontSettings())
    expect(store.load()).toEqual(defaultFontSettings())
  })

  it('round-trips through storage and drops the key when reset', () => {
    const storage = memoryStorage()
    const store = createFontSettingsStore(storage)
    store.save({ uiFont: '"YaHei", sans-serif', codeFont: '"Fira Code", monospace' })
    expect(store.load()).toEqual({ uiFont: '"YaHei", sans-serif', codeFont: '"Fira Code", monospace' })
    expect(storage.data.has(STORAGE_KEY)).toBe(true)
    store.save({ uiFont: '', codeFont: '' })
    expect(storage.data.has(STORAGE_KEY)).toBe(false)
    expect(store.load()).toEqual(defaultFontSettings())
    expect(createFontSettingsStore(storage).load()).toEqual(defaultFontSettings())
  })

  it('normalizes before writing and tolerates storage failures', () => {
    const storage = memoryStorage({ [STORAGE_KEY]: 'corrupt json' })
    const store = createFontSettingsStore(storage)
    expect(store.load()).toEqual(defaultFontSettings())
    const failing = createFontSettingsStore({
      getItem() { throw new Error('denied') },
      setItem() { throw new Error('denied') },
      removeItem() { throw new Error('denied') },
    })
    expect(failing.load()).toEqual(defaultFontSettings())
    expect(() => failing.save({ uiFont: '"YaHei"', codeFont: '' })).not.toThrow()
    expect(failing.load()).toEqual({ uiFont: '"YaHei"', codeFont: '' })
  })

  it('keeps normalized local writes and resets when stale storage cannot be updated', () => {
    const storage = memoryStorage({ [STORAGE_KEY]: '{"uiFont":"Old","codeFont":"Old code"}' })
    let denied = true
    const store = createFontSettingsStore({ ...storage,
      setItem(key, value) { if (denied) throw new Error('quota'); storage.setItem(key, value) },
      removeItem(key) { if (denied) throw new Error('denied'); storage.removeItem(key) },
    })
    expect(store.load().uiFont).toBe('Old')
    store.save({ ...store.load(), uiFont: '  New;  ' })
    const remounted = store.load()
    expect(remounted.uiFont).toBe('New')
    remounted.uiFont = 'accidental mutation'
    store.save({ ...store.load(), codeFont: 'New code' })
    expect(store.load()).toEqual({ uiFont: 'New', codeFont: 'New code' })
    store.save(defaultFontSettings())
    expect(store.load()).toEqual(defaultFontSettings())
    denied = false
    store.save({ uiFont: 'Persisted', codeFont: '' })
    expect(createFontSettingsStore(storage).load().uiFont).toBe('Persisted')
    storage.setItem(STORAGE_KEY, '{"uiFont":"External"}')
    expect(store.load()).toEqual({ uiFont: 'External', codeFont: '' })
    storage.removeItem(STORAGE_KEY)
    expect(store.load()).toEqual(defaultFontSettings())
  })
})

describe('conversation font tokens', () => {
  const FAMILY = cssVar(UI_FONT_VARIABLE)
  function rule(selector: string, declarations: Record<string, string>) {
    const names = Object.keys(declarations)
    return {
      selectorText: selector,
      style: {
        length: names.length,
        item: (index: number) => names[index] ?? '',
        getPropertyValue: (name: string) => declarations[name] ?? '',
      },
    }
  }
  const sheetOf = (...cssRules: unknown[]) => ({ cssRules })

  it('collects body/:root custom properties that reference the interface font', () => {
    const tokens = fontTokenDeclarations([
      sheetOf(
        rule('body', {
          [UI_FONT_VARIABLE]: cssVar(TEXT_DEFAULT_FONT_VARIABLE),
          '--dsw-font-markdown-base': `14px / 24px ${FAMILY}`,
          '--dsw-font-markdown-base-font-family': FAMILY,
          '--dsw-font-markdown-code-font-family': cssVar(CODE_FONT_VARIABLE),
          '--dsw-font-s-14': `14px/22px ${FAMILY}`,
          '--dsw-alias-settings-card-fill': cssVar('--dsw-alias-bg-layer-2'),
        }),
        rule('.markdown', { '--ignored': FAMILY }),
        rule('body.extra', { '--also-ignored': FAMILY }),
        rule(':root', { '--dsw-font-xl-24': `600 24px/32px ${FAMILY}` }),
      ),
    ])
    expect(tokens).toEqual([
      ['--dsw-font-markdown-base', `14px / 24px ${FAMILY}`],
      ['--dsw-font-markdown-base-font-family', FAMILY],
      ['--dsw-font-s-14', `14px/22px ${FAMILY}`],
      ['--dsw-font-xl-24', `600 24px/32px ${FAMILY}`],
    ])
  })

  it('lets the last declaration win, drops tokens re-declared without the variable, and skips unreadable sheets', () => {
    const hostile = { get cssRules(): never { throw new Error('denied') } }
    const tokens = fontTokenDeclarations([
      hostile,
      sheetOf(
        rule('body', { '--a': `first ${FAMILY}`, '--b': FAMILY }),
        rule('body', { '--a': `later ${FAMILY}` }),
        rule(':root', { '--b': 'static value' }),
      ),
    ])
    expect(tokens).toEqual([['--a', `later ${FAMILY}`]])
  })
})

describe('conversation font declarations', () => {
  const FAMILY = cssVar(UI_FONT_VARIABLE)
  it('writes nothing for an empty family', () => {
    expect(conversationFontDeclarations('', [['--t', 'v']])).toEqual([])
    expect(conversationFontDeclarations(' ; ', [])).toEqual([])
  })

  it('leads with the scoped variable and a plain font-family, then the tokens', () => {
    expect(conversationFontDeclarations(' "Source Han Serif SC", serif ', [['--t', `v ${FAMILY}`]])).toEqual([
      [UI_FONT_VARIABLE, `"Source Han Serif SC", serif, ${cssVar(TEXT_DEFAULT_FONT_VARIABLE)}`],
      ['font-family', FAMILY],
      ['--t', `v ${FAMILY}`],
    ])
  })
})

describe('conversation font store', () => {
  function memoryStorage(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial))
    return {
      data,
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value) },
      removeItem: (key: string) => { data.delete(key) },
    }
  }

  afterEach(() => vi.unstubAllGlobals())

  it('normalizes on write and removes the key when cleared', () => {
    const storage = memoryStorage()
    const store = createConversationFontStore(storage)
    expect(store.get()).toBe('')
    store.set('  "Serif";  ')
    expect(store.get()).toBe('"Serif"')
    expect(storage.data.get(CONVERSATION_STORAGE_KEY)).toBe('"Serif"')
    expect(createConversationFontStore(storage).get()).toBe('"Serif"')
    store.set('')
    expect(storage.data.has(CONVERSATION_STORAGE_KEY)).toBe(false)
    expect(store.get()).toBe('')
  })

  it('keeps the in-memory value when persistence fails', () => {
    const store = createConversationFontStore({
      getItem() { throw new Error('denied') },
      setItem() { throw new Error('denied') },
      removeItem() { throw new Error('denied') },
    })
    expect(store.get()).toBe('')
    expect(() => store.set('"Serif"')).not.toThrow()
    expect(store.get()).toBe('"Serif"')
  })

  it('notifies subscribers on set and on a matching storage event, and detaches after the last unsubscribe', () => {
    const fired = (event: { key: string | null }) => { for (const fn of [...storageEvents]) fn(event) }
    const storageEvents = new Set<(event: { key: string | null }) => void>()
    vi.stubGlobal('window', {
      addEventListener: (type: string, fn: (event: { key: string | null }) => void) => { if (type === 'storage') storageEvents.add(fn) },
      removeEventListener: (_type: string, fn: (event: { key: string | null }) => void) => { storageEvents.delete(fn) },
    })
    const storage = memoryStorage()
    const store = createConversationFontStore(storage)
    expect(storageEvents.size).toBe(0)
    let calls = 0
    const unsubscribe = store.subscribe(() => { calls += 1 })
    expect(storageEvents.size).toBe(1)
    store.set('"Serif"')
    expect(calls).toBe(1)
    storage.setItem(CONVERSATION_STORAGE_KEY, '"External"')
    fired({ key: 'unrelated.key' })
    expect(calls).toBe(1)
    fired({ key: CONVERSATION_STORAGE_KEY })
    expect(calls).toBe(2)
    expect(store.get()).toBe('"External"')
    unsubscribe()
    expect(storageEvents.size).toBe(0)
    store.set('"Again"')
    expect(calls).toBe(2)
  })
})
