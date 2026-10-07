import { describe, expect, it } from 'vitest'
import {
  CODE_FONT_PRESETS, CODE_FONT_VARIABLE, FONT_SIZE_MAX, FONT_SIZE_MIN, STORAGE_KEY, UI_FONT_PRESETS, UI_FONT_VARIABLE,
  applyFontSettings, clearFontSettings, createFontSettingsStore, defaultFontSettings,
  fontStackFor, normalizeFontFamily, parseFontSettings, presetFor, serializeFontSettings, systemFontLabel, uniqueSystemFonts,
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
    expect(presetFor('"Custom", monospace', CODE_FONT_PRESETS)).toBeUndefined()
    expect(presetFor('', UI_FONT_PRESETS)).toBeUndefined()
  })
})

describe('css variable application', () => {
  /** The whole feature hinges on these two host token names (ui-theme base.css). */
  it('targets the host font tokens verbatim', () => {
    expect(UI_FONT_VARIABLE).toBe('--dsw-font-family')
    expect(CODE_FONT_VARIABLE).toBe('--ds-font-family-code')
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
  })

  it('round-trips through storage and drops the key when reset', () => {
    const storage = memoryStorage()
    const store = createFontSettingsStore(storage)
    store.save({ uiFont: '"YaHei", sans-serif', codeFont: '"Fira Code", monospace' })
    expect(store.load()).toEqual({ uiFont: '"YaHei", sans-serif', codeFont: '"Fira Code", monospace' })
    expect(storage.data.has(STORAGE_KEY)).toBe(true)
    store.save({ uiFont: '', codeFont: '' })
    expect(storage.data.has(STORAGE_KEY)).toBe(false)
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
  })
})
