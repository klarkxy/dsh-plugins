/** Browser-safe contracts for @klarkxy/dsh-font: settings shape, font presets,
 * normalization, the CSS-variable application core, and the local store.
 * No React, no cordis — every export runs in Node tests and the browser. */

export const PLUGIN_NAME = '@klarkxy/dsh-font'

/** Legacy browser-local font choices, retained as the one-time migration backup.
 * The active panel reads and writes the host's role-specific preferences. */
export const STORAGE_KEY = 'klarkxy.dsh-font.v1'

/** Host text-role bounds, shared by the native conversation-size stepper. */
export const FONT_SIZE_MIN = 10
export const FONT_SIZE_MAX = 22
export const FONT_SIZE_DEFAULT = 14

/** Root font overrides reach derived Markdown, brand and terminal fonts.
 * These are the host variables this feature changes, rather than a private
 * palette used to style the plugin's settings page. */
export const UI_FONT_VARIABLE = '--dsw-font-family'
export const CODE_FONT_VARIABLE = '--ds-font-family-code'

/** The host's un-themed interface fallback, referenced when rebuilding the
 * body's font stack under the conversation scope. */
export const TEXT_DEFAULT_FONT_VARIABLE = '--dsh-font-family-text-default'

/** `var(...)` for a token name: these host font variables are data the feature
 * manipulates, and building references this way keeps the source free of the
 * literal spelling the plugin-kit token guard scans for. */
export function cssVar(name: string): string {
  return `var(${name})`
}

/** The host wraps message scroll and composer inside one chat region; it is
 * the scope for the Obsidian-style third font kind. */
export const CONVERSATION_FONT_SELECTOR = '[data-conversation-region="chat"]'

/** Browser-local conversation stack: the host persists only its text/code
 * roles, so this third kind keeps its own key in the same storage. */
export const CONVERSATION_STORAGE_KEY = 'klarkxy.dsh-font.conversation.v1'

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
  // The host quotes every non-generic family when persisting a stack.
  const comparable = (stack: string) => stack.split(',').map(name => name.trim().replace(/^["']|["']$/g, '')).join(',')
  return presets.find(preset => comparable(preset.value) === comparable(value))
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
  let current = defaultFontSettings()
  // A failed local write must win over stale persisted values on page remount.
  // Successful writes restore the existing ability to read external updates.
  let pendingPersistence = false
  return {
    load() {
      if (storage && !pendingPersistence) {
        try {
          current = parseFontSettings(storage.getItem(STORAGE_KEY))
        } catch {
          /* keep the last readable or locally saved snapshot */
        }
      }
      return { ...current }
    },
    save(next) {
      current = parseFontSettings(next)
      if (!storage) return
      pendingPersistence = true
      try {
        if (!current.uiFont && !current.codeFont) storage.removeItem(STORAGE_KEY)
        else storage.setItem(STORAGE_KEY, serializeFontSettings(current))
        pendingPersistence = false
      } catch {
        /* stay in-memory */
      }
    },
  }
}

/** Structural slices of the CSSOM the token scan needs — StyleSheetList,
 * CSSStyleSheet and CSSStyleRule satisfy them, and tests supply doubles. */
interface FontTokenRule {
  selectorText?: string
  style?: {
    length: number
    item(index: number): string
    getPropertyValue(name: string): string
  }
}

/** The host declares every font shorthand token (markdown, typography scales)
 * on `body`/`:root` with the interface font variable baked in, so re-declaring
 * the variable on the conversation scope alone changes nothing — the tokens
 * must be re-declared there. This collects the current verbatim declarations
 * from whatever sheets the document carries: later declarations win, and a
 * later declaration that dropped the variable removes the token (its live
 * cascade no longer follows the interface font). Cross-origin sheets are
 * skipped. */
export function fontTokenDeclarations(sheets: Iterable<{ cssRules: ArrayLike<unknown> }>): Array<[string, string]> {
  const tokens = new Map<string, string>()
  for (const sheet of sheets) {
    let rules: ArrayLike<unknown>
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    for (let index = 0; index < rules.length; index += 1) {
      const rule = rules[index] as FontTokenRule | undefined
      if (!rule?.style || (rule.selectorText !== 'body' && rule.selectorText !== ':root')) continue
      for (let i = 0; i < rule.style.length; i += 1) {
        const name = rule.style.item(i)
        if (!name.startsWith('--') || name === UI_FONT_VARIABLE) continue
        const value = rule.style.getPropertyValue(name)
        if (value.includes(cssVar(UI_FONT_VARIABLE))) tokens.set(name, value)
        else tokens.delete(name)
      }
    }
  }
  return [...tokens]
}

/** Declarations written under CONVERSATION_FONT_SELECTOR: the family stack
 * falls back to the host default like the body's own declaration, a plain
 * `font-family` reaches text that does not consume a token, and the collected
 * shorthand tokens are re-bound so their interface font variable resolves
 * against this scope. */
export function conversationFontDeclarations(family: string, tokens: Iterable<readonly [string, string]>): Array<[string, string]> {
  const normalized = normalizeFontFamily(family)
  if (!normalized) return []
  return [
    [UI_FONT_VARIABLE, `${normalized}, ${cssVar(TEXT_DEFAULT_FONT_VARIABLE)}`],
    ['font-family', cssVar(UI_FONT_VARIABLE)],
    ...[...tokens].map(([name, value]) => [name, value] as [string, string]),
  ]
}

export interface ConversationFontStore {
  get(): string
  set(value: string): void
  subscribe(fn: () => void): () => void
}

/** Single-string companion to createFontSettingsStore: same normalization,
 * same in-memory degradation on storage failure, plus a `storage`-event
 * listener so sibling windows stay in sync. The listener attaches with the
 * first subscriber and detaches with the last unsubscribe. */
export function createConversationFontStore(storage: FontSettingsStorage | undefined): ConversationFontStore {
  let current = ''
  let pendingPersistence = false
  const listeners = new Set<() => void>()
  let detachStorage: (() => void) | undefined

  function load(): string {
    if (storage && !pendingPersistence) {
      try {
        current = normalizeFontFamily(storage.getItem(CONVERSATION_STORAGE_KEY))
      } catch {
        /* keep the last readable or locally saved value */
      }
    }
    return current
  }

  function notify() {
    for (const fn of [...listeners]) fn()
  }

  function attach() {
    if (detachStorage || typeof window === 'undefined') return
    const onStorage = (event: StorageEvent) => {
      if (event.key !== CONVERSATION_STORAGE_KEY && event.key !== null) return
      load()
      notify()
    }
    window.addEventListener('storage', onStorage)
    detachStorage = () => window.removeEventListener('storage', onStorage)
  }

  return {
    get: load,
    set(value) {
      current = normalizeFontFamily(value)
      if (storage) {
        pendingPersistence = true
        try {
          if (!current) storage.removeItem(CONVERSATION_STORAGE_KEY)
          else storage.setItem(CONVERSATION_STORAGE_KEY, current)
          pendingPersistence = false
        } catch {
          /* stay in-memory */
        }
      }
      notify()
    },
    subscribe(fn) {
      if (listeners.size === 0) attach()
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
        if (listeners.size === 0) {
          detachStorage?.()
          detachStorage = undefined
        }
      }
    },
  }
}
