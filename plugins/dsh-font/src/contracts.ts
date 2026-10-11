/** Browser-safe contracts for @klarkxy/dsh-font: settings shape, font presets,
 * normalization, the CSS-variable application core, and the local store.
 * No React, no cordis — every export runs in Node tests and the browser. */

export const PLUGIN_NAME = '@klarkxy/dsh-font'

/** localStorage key. Fonts are a property of the rendering environment (each
 * browser/machine has its own installed fonts), so they persist browser-local,
 * exactly like the host's own GUI preferences (dsh-client-store, ui-theme
 * notes). The conversation font size is NOT stored here: the official
 * `ctx.theme.setFontSize()` entry persists it host-side already. */
export const STORAGE_KEY = 'klarkxy.dsh-font.v1'

/** DSH 0.2.0-rc.2 ui-theme/theme-settings.ts bounds, shared by its native stepper. */
export const FONT_SIZE_MIN = 10
export const FONT_SIZE_MAX = 22
export const FONT_SIZE_DEFAULT = 14

/** DSH rc.2 defines these font stacks on :root. Root inline overrides also
 * reach derived Markdown, brand and terminal font tokens. */
export const UI_FONT_VARIABLE = '--dsw-font-family'
export const CODE_FONT_VARIABLE = '--ds-font-family-code'

export interface FontSettings {
  /** Full CSS font-family stack for the interface; empty keeps the host default. */
  uiFont: string
  /** Full CSS font-family stack for code blocks, inline code and terminals. */
  codeFont: string
}

export function defaultFontSettings(): FontSettings {
  return { uiFont: '', codeFont: '' }
}

/** A raw font-family string is placed into a single CSS declaration via
 * CSSStyleDeclaration.setProperty, which cannot escape the declaration — but
 * trimming control characters and the CSS delimiters keeps pasted garbage from
 * producing a silently-dead value. */
export function normalizeFontFamily(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/[\u0000-\u001F\u007F;{}<>]/g, '')
    .trim()
    .slice(0, 300)
}

export function parseFontSettings(raw: unknown): FontSettings {
  let source = raw
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source)
    } catch {
      return defaultFontSettings()
    }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) return defaultFontSettings()
  const record = source as Record<string, unknown>
  return {
    uiFont: normalizeFontFamily(record.uiFont),
    codeFont: normalizeFontFamily(record.codeFont),
  }
}

export function serializeFontSettings(settings: FontSettings): string {
  return JSON.stringify({
    uiFont: normalizeFontFamily(settings.uiFont),
    codeFont: normalizeFontFamily(settings.codeFont),
  })
}

export interface FontPreset {
  readonly id: string
  readonly label: { readonly zh: string; readonly en: string }
  /** The font-family stack committed when the preset is picked. */
  readonly value: string
}

export const UI_FONT_PRESETS: readonly FontPreset[] = [
  { id: 'yahei', label: { zh: '微软雅黑', en: 'Microsoft YaHei' }, value: '"Microsoft YaHei", "PingFang SC", sans-serif' },
  { id: 'pingfang', label: { zh: '苹方', en: 'PingFang SC' }, value: '"PingFang SC", -apple-system, sans-serif' },
  { id: 'simsun', label: { zh: '宋体', en: 'SimSun' }, value: '"SimSun", "Songti SC", serif' },
  { id: 'kaiti', label: { zh: '楷体', en: 'KaiTi' }, value: '"KaiTi", "Kaiti SC", "STKaiti", serif' },
  { id: 'source-han-sans', label: { zh: '思源黑体', en: 'Source Han Sans' }, value: '"Source Han Sans SC", "Noto Sans CJK SC", "Noto Sans SC", sans-serif' },
  { id: 'source-han-serif', label: { zh: '思源宋体', en: 'Source Han Serif' }, value: '"Source Han Serif SC", "Noto Serif CJK SC", "Noto Serif SC", serif' },
]

export const CODE_FONT_PRESETS: readonly FontPreset[] = [
  { id: 'cascadia', label: { zh: 'Cascadia', en: 'Cascadia' }, value: '"Cascadia Mono", "Cascadia Code", monospace' },
  { id: 'jetbrains-mono', label: { zh: 'JetBrains Mono', en: 'JetBrains Mono' }, value: '"JetBrains Mono", monospace' },
  { id: 'fira-code', label: { zh: 'Fira Code', en: 'Fira Code' }, value: '"Fira Code", monospace' },
  { id: 'consolas', label: { zh: 'Consolas', en: 'Consolas' }, value: 'Consolas, monospace' },
  { id: 'sarasa', label: { zh: '更纱黑体', en: 'Sarasa Mono' }, value: '"Sarasa Mono SC", "Sarasa Term SC", monospace' },
  { id: 'maple-mono', label: { zh: 'Maple Mono', en: 'Maple Mono' }, value: '"Maple Mono NF CN", "Maple Mono", monospace' },
]

export function presetFor(value: string, presets: readonly FontPreset[]): FontPreset | undefined {
  return presets.find(preset => preset.value === value)
}

export type FontGenericFamily = 'sans-serif' | 'monospace'

/** Build the committed stack for a family picked from the system font list.
 * The family name comes from the OS (Local Font Access API); quotes and
 * backslashes are stripped so it can be safely re-quoted as one family. */
export function fontStackFor(family: string, generic: FontGenericFamily): string {
  const cleaned = normalizeFontFamily(family).replace(/["\\]/g, '')
  if (!cleaned) return generic
  return `"${cleaned}", ${generic}`
}

/** A system font offered in the picker: `family` is the exact name CSS
 * matching needs; `fullName` is an informative localized alias (e.g. converted
 * CJK fonts whose family is the Latin alias), '' when it only restates the
 * family ("Microsoft YaHei Regular" adds nothing). */
export interface SystemFontFamily {
  readonly family: string
  readonly fullName: string
}

/** Distinct, normalized, family-sorted entries out of a queryLocalFonts()
 * result (entries carry `family` and `fullName`; duplicates per style are
 * expected). */
export function uniqueSystemFonts(fonts: readonly unknown[]): SystemFontFamily[] {
  const byFamily = new Map<string, string>()
  for (const item of fonts) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const family = normalizeFontFamily(record.family).replace(/["\\]/g, '')
    if (!family || byFamily.has(family)) continue
    const fullName = normalizeFontFamily(record.fullName).replace(/["\\]/g, '')
    byFamily.set(family, fullName && fullName !== family && !fullName.startsWith(`${family} `) ? fullName : '')
  }
  return [...byFamily.entries()]
    .map(([family, fullName]) => ({ family, fullName }))
    .sort((a, b) => a.family.localeCompare(b.family))
}

/** Picker label: the UI locale's recognizable name leads, the alias stays in
 * parentheses because the canonical family is still what a custom input needs. */
export function systemFontLabel(item: SystemFontFamily, locale: 'zh' | 'en'): string {
  if (!item.fullName) return item.family
  return locale === 'zh' ? `${item.fullName}（${item.family}）` : `${item.family}（${item.fullName}）`
}

/** Minimal write face of CSSStyleDeclaration — document.documentElement.style
 * satisfies it, and tests supply a recording double. */
export interface FontStyleTarget {
  setProperty(name: string, value: string): void
  removeProperty(name: string): void
}

export function applyFontSettings(style: FontStyleTarget, settings: FontSettings): void {
  if (settings.uiFont) style.setProperty(UI_FONT_VARIABLE, settings.uiFont)
  else style.removeProperty(UI_FONT_VARIABLE)
  if (settings.codeFont) style.setProperty(CODE_FONT_VARIABLE, settings.codeFont)
  else style.removeProperty(CODE_FONT_VARIABLE)
}

export function clearFontSettings(style: FontStyleTarget): void {
  style.removeProperty(UI_FONT_VARIABLE)
  style.removeProperty(CODE_FONT_VARIABLE)
}

/** Read face required to restore only overrides still owned by this instance. */
export interface OwnedFontStyleTarget extends FontStyleTarget {
  getPropertyValue(name: string): string
  getPropertyPriority(name: string): string
  setProperty(name: string, value: string, priority?: string): void
}

/** Root inline overrides preserve the existing local persistence/unload
 * boundary. Save the underlying value (including !important) on first write
 * or when the host replaces a value, and never retract somebody else's write. */
export function createFontSettingsOverride(style: OwnedFontStyleTarget) {
  const owned = new Map<string, { previous: string; priority: string; value: string }>()
  function release(name: string) {
    const entry = owned.get(name)
    if (!entry) return
    if (style.getPropertyValue(name) === entry.value && style.getPropertyPriority(name) === '') {
      if (entry.previous) style.setProperty(name, entry.previous, entry.priority)
      else style.removeProperty(name)
    }
    owned.delete(name)
  }
  return {
    apply(settings: FontSettings) {
      for (const [name, value] of [
        [UI_FONT_VARIABLE, settings.uiFont],
        [CODE_FONT_VARIABLE, settings.codeFont],
      ] as const) {
        if (!value) { release(name); continue }
        const current = style.getPropertyValue(name)
        const priority = style.getPropertyPriority(name)
        const entry = owned.get(name)
        if (!entry || current !== entry.value || priority !== '') {
          owned.set(name, { previous: current, priority, value: '' })
        }
        style.setProperty(name, value)
        owned.get(name)!.value = style.getPropertyValue(name)
      }
    },
    dispose() { for (const name of [...owned.keys()]) release(name) },
  }
}

export interface FontSettingsStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface FontSettingsStore {
  load(): FontSettings
  save(next: FontSettings): void
}

/** Browser-local persistence. A fully-default setting removes the key so a
 * reset leaves no residue; storage failures (private mode, quota) degrade to
 * in-memory behaviour rather than breaking the panel. */
export function createFontSettingsStore(storage: FontSettingsStorage | undefined): FontSettingsStore {
  return {
    load() {
      if (!storage) return defaultFontSettings()
      try {
        return parseFontSettings(storage.getItem(STORAGE_KEY))
      } catch {
        return defaultFontSettings()
      }
    },
    save(next) {
      if (!storage) return
      const normalized = parseFontSettings(serializeFontSettings(next))
      try {
        if (!normalized.uiFont && !normalized.codeFont) storage.removeItem(STORAGE_KEY)
        else storage.setItem(STORAGE_KEY, serializeFontSettings(normalized))
      } catch {
        /* stay in-memory */
      }
    },
  }
}
