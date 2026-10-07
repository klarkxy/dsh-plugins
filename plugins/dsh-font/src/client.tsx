import type { Context } from '@deepseek-ai/cordis'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'
import { useState, useSyncExternalStore } from 'react'
import {
  CODE_FONT_PRESETS, FONT_SIZE_DEFAULT, FONT_SIZE_MAX, FONT_SIZE_MIN, PLUGIN_NAME,
  UI_FONT_PRESETS,
  applyFontSettings, clearFontSettings, createFontSettingsStore, fontStackFor, normalizeFontFamily,
  presetFor, systemFontLabel, uniqueSystemFonts,
  type FontGenericFamily, type FontPreset, type FontSettings, type FontSettingsStorage, type FontSettingsStore,
  type SystemFontFamily,
} from './contracts.ts'

export const name = 'dsh-font-client'
export const inject = ['slots', 'theme', 'locale'] as const

interface ThemeSnapshotLike {
  fontSize: number
}

interface ThemeLike {
  getTheme(): ThemeSnapshotLike
  setFontSize(px: number): void
}

type Client = {
  theme: ThemeLike
  locale: { getSnapshot(): { active: string }; subscribe(fn: () => void): () => void }
  slots: {
    inject(key: string, callback: () => unknown): () => void
    register(spec: { name: string; key: string; label?: string }, render: unknown): () => void
  }
  on(event: 'theme/change', listener: (snapshot: ThemeSnapshotLike) => void): () => void
}

const COPY = {
  zh: {
    label: '字体',
    uiFont: '界面字体',
    codeFont: '代码字体',
    fontSize: '会话字号',
    defaultOption: '默认',
    customOption: '自定义…',
    customUiPlaceholder: '例如 "Microsoft YaHei", sans-serif',
    customCodePlaceholder: '例如 "JetBrains Mono", monospace',
    uiHelp: '作用于整个界面的文字。自定义时输入完整的 font-family 字体栈，留空恢复默认。',
    codeHelp: '作用于代码块、行内代码与终端的等宽字体。',
    sizeHelp: '与「设置 → 通用」中的字号同步，范围 10–22。',
    loadFonts: '读取系统字体',
    reloadFonts: '重新读取系统字体',
    loadingFonts: '正在读取系统字体…',
    fontsLoaded: (count: number) => `已读取 ${count} 款系统字体；新装字体后点「重新读取」刷新列表。`,
    fontsPartial: '列表来自浏览器枚举：仅安装到当前用户的字体可能不在其中，可以直接输入字体名使用。',
    fontsDenied: '系统字体读取被拒绝或当前环境不支持，仍可手动输入字体名。',
    systemGroup: '系统字体',
    reset: '全部恢复默认',
    summary: (ui: string, code: string, size: number) => `界面 ${ui} · 代码 ${code} · ${size}px`,
    defaultName: '默认',
  },
  en: {
    label: 'Font',
    uiFont: 'Interface font',
    codeFont: 'Code font',
    fontSize: 'Conversation font size',
    defaultOption: 'Default',
    customOption: 'Custom…',
    customUiPlaceholder: 'e.g. "Microsoft YaHei", sans-serif',
    customCodePlaceholder: 'e.g. "JetBrains Mono", monospace',
    uiHelp: 'Applies to all interface text. For a custom value enter a full font-family stack; empty restores the default.',
    codeHelp: 'Monospace font for code blocks, inline code and terminals.',
    sizeHelp: 'Synced with Settings → General; 10–22 px.',
    loadFonts: 'Load system fonts',
    reloadFonts: 'Reload system fonts',
    loadingFonts: 'Loading system fonts…',
    fontsLoaded: (count: number) => `${count} installed fonts loaded; choose “Reload system fonts” after installing new ones.`,
    fontsPartial: 'The list comes from the browser’s enumeration: fonts installed only for the current user may be missing — you can still type the family name directly.',
    fontsDenied: 'Access to system fonts was denied or is unsupported here; you can still type a font name.',
    systemGroup: 'Installed fonts',
    reset: 'Reset all to defaults',
    summary: (ui: string, code: string, size: number) => `${ui} · ${code} · ${size}px`,
    defaultName: 'Default',
  },
} as const

export function fontCopy(locale: 'zh' | 'en') {
  return COPY[locale]
}

/* The panel's own geometry only: reading width, and the custom-stack input row
 * rhythm. Everything visual comes from the contract recipes and primitives. */
const styles = `${officialUiCss('font-root')}
.font-root { max-width: 760px; }
.font-custom { margin-top: 8px; }
`

function readStorage(): FontSettingsStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

function useLocale(client: Client): 'zh' | 'en' {
  const getSnapshot = () => (client.locale.getSnapshot().active.startsWith('zh') ? 'zh' : 'en') as 'zh' | 'en'
  return useSyncExternalStore(
    fn => client.locale.subscribe(fn),
    getSnapshot,
    getSnapshot,
  )
}

function useFontSize(client: Client): number {
  return useSyncExternalStore(
    fn => client.on('theme/change', () => fn()),
    () => client.theme.getTheme().fontSize,
    () => client.theme.getTheme().fontSize,
  )
}

function presetMode(value: string, presets: readonly FontPreset[]): string {
  return presetFor(value, presets)?.id ?? (value ? 'custom' : '')
}

export function FontField(props: {
  label: string
  help: string
  value: string
  presets: readonly FontPreset[]
  locale: 'zh' | 'en'
  generic: FontGenericFamily
  systemFonts?: readonly SystemFontFamily[]
  defaultLabel: string
  customLabel: string
  customPlaceholder: string
  systemGroupLabel: string
  onCommit(value: string): void
}) {
  // undefined = not editing; the input otherwise shows the committed stack.
  const [draft, setDraft] = useState<string | undefined>(undefined)
  // With an empty (default) value nothing matches "custom" on its own, so the
  // choice itself must be remembered until a stack is committed.
  const [customOpen, setCustomOpen] = useState(false)
  const mode = customOpen ? 'custom' : presetMode(props.value, props.presets)

  function commitDraft() {
    if (draft === undefined) return
    const next = normalizeFontFamily(draft)
    setDraft(undefined)
    if (!next) setCustomOpen(false)
    if (next !== props.value) props.onCommit(next)
  }

  return <label className="dsh-ui-field">
    <span className="dsh-ui-label">{props.label}</span>
    <select
      className="dsh-ui-select"
      value={mode}
      onChange={event => {
        const id = event.target.value
        setDraft(undefined)
        if (id === 'custom') { setCustomOpen(true); return }
        setCustomOpen(false)
        if (id.startsWith('sys:')) { props.onCommit(fontStackFor(id.slice(4), props.generic)); return }
        const preset = props.presets.find(item => item.id === id)
        props.onCommit(preset ? preset.value : '')
      }}
    >
      <option value="">{props.defaultLabel}</option>
      {props.presets.map(preset => (
        <option key={preset.id} value={preset.id}>{preset.label[props.locale]}</option>
      ))}
      <option value="custom">{props.customLabel}</option>
      {props.systemFonts && props.systemFonts.length > 0 ? <optgroup label={props.systemGroupLabel}>
        {props.systemFonts.map(item => <option key={item.family} value={`sys:${item.family}`}>{systemFontLabel(item, props.locale)}</option>)}
      </optgroup> : null}
    </select>
    {mode === 'custom' ? <span className="font-custom">
      <Input
        value={draft ?? props.value}
        placeholder={props.customPlaceholder}
        onChange={event => setDraft(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={event => { if (event.key === 'Enter') commitDraft() }}
      />
    </span> : null}
    <span className="dsh-ui-help">{props.help}</span>
  </label>
}

export function FontSettingsPanel(props: {
  client: Client
  store: FontSettingsStore
  view?: 'summary' | 'page'
}) {
  const locale = useLocale(props.client)
  const text = COPY[locale]
  const [settings, setSettings] = useState<FontSettings>(() => props.store.load())
  const fontSize = useFontSize(props.client)
  // System font list is shared by both fields: one permission prompt, one list.
  const [fontList, setFontList] = useState<{ state: 'idle' | 'loading' | 'ready' | 'denied'; families: readonly SystemFontFamily[] }>(
    { state: 'idle', families: [] },
  )

  async function loadSystemFonts() {
    if (fontList.state === 'loading') return
    // Every click re-enumerates: fonts installed after the first read appear
    // on the next one (the button relabels to "reload" once a list exists).
    // Local Font Access API: Chromium-only and gated behind a permission
    // prompt; anything else (Firefox, Safari, denied permission, Electron
    // policy) falls through to the preset + manual-input flow unchanged.
    const query = (globalThis as { queryLocalFonts?: () => Promise<readonly unknown[]> }).queryLocalFonts
    if (typeof query !== 'function') { setFontList({ state: 'denied', families: [] }); return }
    setFontList(current => ({ state: 'loading', families: current.families }))
    try {
      const fonts = await query()
      setFontList({ state: 'ready', families: uniqueSystemFonts(fonts) })
    } catch {
      setFontList(current => ({ state: 'denied', families: current.families }))
    }
  }

  function update(patch: Partial<FontSettings>) {
    const next: FontSettings = {
      uiFont: normalizeFontFamily(patch.uiFont ?? settings.uiFont),
      codeFont: normalizeFontFamily(patch.codeFont ?? settings.codeFont),
    }
    props.store.save(next)
    if (typeof document !== 'undefined') applyFontSettings(document.documentElement.style, next)
    setSettings(next)
  }

  const uiName = presetFor(settings.uiFont, UI_FONT_PRESETS)?.label[locale] ?? (settings.uiFont || text.defaultName)
  const codeName = presetFor(settings.codeFont, CODE_FONT_PRESETS)?.label[locale] ?? (settings.codeFont || text.defaultName)

  if (props.view === 'summary') {
    return <span className="font-root" data-testid="font-summary">{text.summary(uiName, codeName, fontSize)}</span>
  }

  const sizes: number[] = []
  for (let px = FONT_SIZE_MIN; px <= FONT_SIZE_MAX; px += 1) sizes.push(px)

  return <section className="font-root dsh-ui-panel" data-testid="font-settings">
    <FontField
      label={text.uiFont}
      help={text.uiHelp}
      value={settings.uiFont}
      presets={UI_FONT_PRESETS}
      locale={locale}
      generic="sans-serif"
      systemFonts={fontList.families}
      defaultLabel={text.defaultOption}
      customLabel={text.customOption}
      customPlaceholder={text.customUiPlaceholder}
      systemGroupLabel={text.systemGroup}
      onCommit={value => update({ uiFont: value })}
    />
    <FontField
      label={text.codeFont}
      help={text.codeHelp}
      value={settings.codeFont}
      presets={CODE_FONT_PRESETS}
      locale={locale}
      generic="monospace"
      systemFonts={fontList.families}
      defaultLabel={text.defaultOption}
      customLabel={text.customOption}
      customPlaceholder={text.customCodePlaceholder}
      systemGroupLabel={text.systemGroup}
      onCommit={value => update({ codeFont: value })}
    />
    <label className="dsh-ui-field">
      <span className="dsh-ui-label">{text.fontSize}</span>
      <select
        className="dsh-ui-select"
        value={fontSize}
        onChange={event => {
          const px = Number(event.target.value)
          if (Number.isInteger(px) && px >= FONT_SIZE_MIN && px <= FONT_SIZE_MAX && px !== fontSize) {
            // The theme service is the only write entry; it validates again and
            // persists through the host settings scope, and theme/change keeps
            // this panel in sync with the native Settings → General stepper.
            try { props.client.theme.setFontSize(px) } catch { /* out-of-range guard already applied */ }
          }
        }}
      >
        {sizes.map(px => <option key={px} value={px}>{px}px</option>)}
      </select>
      <span className="dsh-ui-help">{text.sizeHelp}</span>
    </label>
    <div className="dsh-ui-actions">
      <Button variant="outline" size="md" disabled={fontList.state === 'loading'}
        onClick={() => { void loadSystemFonts() }}>
        {fontList.state === 'loading' ? text.loadingFonts : fontList.state === 'ready' ? text.reloadFonts : text.loadFonts}
      </Button>
      <Button variant="outline" size="md" onClick={() => {
        update({ uiFont: '', codeFont: '' })
        if (fontSize !== FONT_SIZE_DEFAULT) props.client.theme.setFontSize(FONT_SIZE_DEFAULT)
      }}>{text.reset}</Button>
    </div>
    {fontList.state === 'ready' ? <p role="status" className="dsh-ui-hint">{text.fontsLoaded(fontList.families.length)}</p> : null}
    {fontList.state === 'ready' ? <p role="status" className="dsh-ui-hint">{text.fontsPartial}</p> : null}
    {fontList.state === 'denied' ? <p role="status" className="dsh-ui-hint">{text.fontsDenied}</p> : null}
  </section>
}

export function apply(ctx: Context): void {
  const client = ctx as unknown as Client & { effect: Context['effect'] }
  const store = createFontSettingsStore(readStorage())
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-plugin', PLUGIN_NAME)
    style.textContent = styles
    document.head.appendChild(style)
    return () => style.remove()
  }, 'font.styles')
  // Apply the stored stacks at boot. Inline custom properties on <html> win the
  // cascade over ui-theme's :root stylesheet, and every derived token
  // (--dsw-font-markdown-code*, brand font, terminal) resolves dynamically.
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    applyFontSettings(document.documentElement.style, store.load())
    return () => clearFontSettings(document.documentElement.style)
  }, 'font.apply')
  ctx.effect(() => client.slots.inject('plugins.bundle.config', () => client.slots.register(
    { name: 'plugins.bundle.config', key: PLUGIN_NAME, label: COPY.zh.label },
    (slotProps: { view?: 'summary' | 'page' }) =>
      <FontSettingsPanel client={client} store={store} view={slotProps?.view} />,
  )), 'font.settings')
}
