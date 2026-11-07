import type { Context } from '@deepseek-ai/cordis'
import { migrateFontPreferences, type FontRole, type FontTheme, type FontThemeSnapshot } from './preferences.ts'
import { Button, IconChevronDownOutlineRegular, IconChevronUpOutlineRegular, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'
import { IconFontSettings, registerSettingsSectionIcon } from '@klarkxy/dsh-plugin-kit/client-utils'
import { useId, useState, useSyncExternalStore } from 'react'
import {
  CODE_FONT_PRESETS, CONVERSATION_FONT_SELECTOR, FONT_SIZE_SPECS,
  PLUGIN_NAME, UI_FONT_PRESETS,
  conversationFontDeclarations, createConversationFontStore, createFontSettingsStore,
  fontStackFor, fontTokenDeclarations, normalizeFontFamily,
  presetFor, systemFontLabel, uniqueSystemFonts,
  type ConversationFontStore, type FontGenericFamily, type FontPreset, type FontSettings,
  type FontSettingsStorage, type SystemFontFamily,
} from './contracts.ts'

export const name = 'dsh-font-client'
export const inject = ['slots', 'theme', 'locale'] as const

/** The settings.section contribution spec: the shell nav reads id/order/label
 * (label may be a thunk resolved at read time); owner props carry `close`. */
interface SettingsSectionSpec {
  name: 'settings.section'
  id: string
  order: number
  label: () => string
}
/** A cell inside a declared list slot: id + order, with priority deciding which
 * entry renders when several share one id (lowest wins). */
interface SettingsItemSpec {
  name: string
  id: string
  order: number
  priority?: number
}

type Client = {
  theme: FontTheme
  locale: { getSnapshot(): { active: string }; subscribe(fn: () => void): () => void }
  slots: {
    inject(key: string, callback: () => unknown): () => void
    register(spec: SettingsSectionSpec | SettingsItemSpec, render: unknown): () => void
  }
  on(event: 'theme/change', listener: (snapshot: FontThemeSnapshot) => void): () => void
}

const COPY = {
  zh: {
    label: '字体',
    uiFont: '界面字体',
    conversationFont: '对话字体',
    codeFont: '代码字体',
    terminalFont: '终端字体',
    textSize: '字号大小',
    textSizeHelp: '仅影响会话内容的字号',
    codeSize: '代码字号',
    codeSizeHelp: '用于代码块、行内代码与工具输出',
    terminalSize: '终端字号',
    terminalSizeHelp: '用于侧栏终端',
    increaseSize: (label: string) => `增大${label}`,
    decreaseSize: (label: string) => `减小${label}`,
    sizeUnit: 'px',
    defaultOption: '默认',
    followUi: '跟随界面字体',
    customOption: '自定义…',
    customUiPlaceholder: '例如 "Microsoft YaHei", sans-serif',
    customConversationPlaceholder: '例如 "Source Han Serif SC", serif',
    customCodePlaceholder: '例如 "JetBrains Mono", monospace',
    customTerminalPlaceholder: '例如 "Cascadia Mono", monospace',
    uiHelp: '作用于整个界面的文字，对话字体跟随它时也包括对话区。自定义时输入完整的 font-family 字体栈，留空恢复默认。',
    conversationHelp: '作用于对话区的消息和输入框，适合为长文单独选择字体（如衬线体）。仅保存在当前浏览器。',
    codeHelp: '作用于代码块、行内代码与工具输出。',
    terminalHelp: '作用于侧栏终端，与代码字体独立。',
    loadFonts: '读取系统字体',
    reloadFonts: '重新读取系统字体',
    loadingFonts: '正在读取系统字体…',
    fontsLoaded: (count: number) => `已读取 ${count} 款系统字体；新装字体后点「重新读取」刷新列表。`,
    fontsPartial: '列表来自浏览器枚举：仅安装到当前用户的字体可能不在其中，可以直接输入字体名使用。',
    fontsDenied: '系统字体读取被拒绝或当前环境不支持，仍可手动输入字体名。',
    systemGroup: '系统字体',
    resetFonts: '恢复默认字体',
    resetSizes: '恢复默认字号',
  },
  en: {
    label: 'Font',
    uiFont: 'Interface font',
    conversationFont: 'Conversation font',
    codeFont: 'Code font',
    terminalFont: 'Terminal font',
    textSize: 'Font size',
    textSizeHelp: 'Only affects conversation content',
    codeSize: 'Code font size',
    codeSizeHelp: 'Used for code blocks, inline code, and tool output',
    terminalSize: 'Terminal font size',
    terminalSizeHelp: 'Used for the sidebar terminal',
    increaseSize: (label: string) => `Increase ${label.toLowerCase()}`,
    decreaseSize: (label: string) => `Decrease ${label.toLowerCase()}`,
    sizeUnit: 'px',
    defaultOption: 'Default',
    followUi: 'Same as interface font',
    customOption: 'Custom…',
    customUiPlaceholder: 'e.g. "Microsoft YaHei", sans-serif',
    customConversationPlaceholder: 'e.g. "Source Han Serif SC", serif',
    customCodePlaceholder: 'e.g. "JetBrains Mono", monospace',
    customTerminalPlaceholder: 'e.g. "Cascadia Mono", monospace',
    uiHelp: 'Applies to all interface text, including the conversation while the conversation font follows it. For a custom value enter a full font-family stack; empty restores the default.',
    conversationHelp: 'Applies to messages and the input box in the conversation, e.g. a serif face for long text. Saved in this browser only.',
    codeHelp: 'Applies to code blocks, inline code, and tool output.',
    terminalHelp: 'Applies to the sidebar terminal, independent of the code font.',
    loadFonts: 'Load system fonts',
    reloadFonts: 'Reload system fonts',
    loadingFonts: 'Loading system fonts…',
    fontsLoaded: (count: number) => `${count} installed fonts loaded; choose “Reload system fonts” after installing new ones.`,
    fontsPartial: 'The list comes from the browser’s enumeration: fonts installed only for the current user may be missing — you can still type the family name directly.',
    fontsDenied: 'Access to system fonts was denied or is unsupported here; you can still type a font name.',
    systemGroup: 'Installed fonts',
    resetFonts: 'Reset fonts',
    resetSizes: 'Reset font sizes',
  },
} as const

export function fontCopy(locale: 'zh' | 'en') {
  return COPY[locale]
}

/* The rows mirror the native Settings → General item geometry (16px padding,
 * 0.5px l2 hairline, 14/22 title over a 12/18 description, a 240px trailing
 * control) so the group reads like the General column — no card, no page
 * chrome. Everything visual still comes from the shared recipes and tokens.
 * The stepper reproduces the native FontSizeRow pill: centered value, hover or
 * focus-within reveals the up/down arrow column, px unit label after the pill. */
const styles = `${officialUiCss('font-root')}
.font-root .font-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 16px 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
.font-root .font-row-text { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; padding-right: 40px; }
.font-root .font-row-title { font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary); }
.font-root .font-row-desc { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.font-root .font-row-control { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.font-root .font-select { flex: 0 1 240px; width: auto; }
.font-root .font-custom { flex: 1 1 100%; }
.font-root .font-stepper { display: inline-flex; align-items: center; justify-content: center; min-width: 72px; height: 36px; position: relative; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-module-platform); }
.font-root .font-stepper-value { min-width: 18px; text-align: center; font-variant-numeric: tabular-nums; font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary); }
.font-root .font-stepper-unit { font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-secondary); }
.font-root .font-stepper-arrows { position: absolute; right: 8px; display: flex; flex-direction: column; gap: 2px; opacity: 0; }
.font-root .font-stepper:focus-within .font-stepper-arrows { opacity: 1; }
@media (hover:hover) { .font-root .font-stepper:hover .font-stepper-arrows { opacity: 1; } }
@media (hover:none) { .font-root .font-stepper-arrows { opacity: 1; } }
.font-root .font-stepper-arrow { width: 17px; height: 12px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border: none; border-radius: var(--dsw-radius-sm); background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 75%, transparent); color: var(--dsw-alias-label-primary); cursor: pointer; }
@media (hover:hover) { .font-root .font-stepper-arrow:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-1); } }
.font-root .font-stepper-arrow:disabled { color: var(--dsw-alias-label-caption); cursor: default; }
/* The last row keeps the hairline off the page's bottom edge, mirroring the
 * host's own last-child rule inside a settings column. */
.font-root > :last-child, .font-root > :last-child > :last-child { border-bottom: none; }
@media (max-width: 767px) {
  .font-root .font-row-text { padding-right: 16px; }
  .font-root .font-select { flex: 0 1 auto; width: 240px; max-width: 100%; }
}
`

function readStorage(): FontSettingsStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

function useLocale(client: Client): 'zh' | 'en' {
  const getSnapshot = () => (client.locale.getSnapshot().active.toLowerCase().startsWith('zh') ? 'zh' : 'en') as 'zh' | 'en'
  return useSyncExternalStore(
    fn => client.locale.subscribe(fn),
    getSnapshot,
    getSnapshot,
  )
}

function presetMode(value: string, presets: readonly FontPreset[]): string {
  return presetFor(value, presets)?.id ?? (value ? 'custom' : '')
}

/** One font-family row in the native compact shape: title and description on
 * the left, a preset picker on the trailing edge, the custom stack input
 * wrapping to a full line when the picker is on Custom. */
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
  const labelId = useId()
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

  return <div className="font-row">
    <div className="font-row-text">
      <div className="font-row-title" id={labelId}>{props.label}</div>
      <div className="font-row-desc">{props.help}</div>
    </div>
    <div className="font-row-control">
      <select
        className="dsh-ui-select font-select"
        aria-labelledby={labelId}
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
    </div>
    {mode === 'custom' ? <span className="font-custom">
      <Input
        value={draft ?? props.value}
        placeholder={props.customPlaceholder}
        aria-label={props.label}
        onChange={event => setDraft(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={event => { if (event.key === 'Enter') commitDraft() }}
      />
    </span> : null}
  </div>
}

/** One font-size row in the native stepper shape: title and description on the
 * left, a pill holding the centered value with a hover/focus-revealed up/down
 * arrow column, and the px unit label after it. The displayed value follows
 * the persisted setting through the theme service, never the click echo, and
 * the arrows clamp at the role's host bounds instead of asking the service to
 * reject an out-of-range write. */
export function FontSizeField(props: {
  label: string
  help: string
  role: FontRole
  value: number
  locale: 'zh' | 'en'
  increaseLabel: string
  decreaseLabel: string
  unit: string
  onCommit(role: FontRole, px: number): void
}) {
  const labelId = useId()
  const { min, max } = FONT_SIZE_SPECS[props.role]
  return <div className="font-row">
    <div className="font-row-text">
      <div className="font-row-title" id={labelId}>{props.label}</div>
      <div className="font-row-desc">{props.help}</div>
    </div>
    <div className="font-row-control">
      <div className="font-stepper">
        <span className="font-stepper-value" aria-labelledby={labelId}>{props.value}</span>
        <span className="font-stepper-arrows">
          <button
            type="button"
            className="font-stepper-arrow"
            aria-label={props.increaseLabel}
            disabled={props.value >= max}
            onClick={() => props.onCommit(props.role, props.value + 1)}
          >
            <IconChevronUpOutlineRegular size={9} />
          </button>
          <button
            type="button"
            className="font-stepper-arrow"
            aria-label={props.decreaseLabel}
            disabled={props.value <= min}
            onClick={() => props.onCommit(props.role, props.value - 1)}
          >
            <IconChevronDownOutlineRegular size={9} />
          </button>
        </span>
      </div>
      <span className="font-stepper-unit">{props.unit}</span>
    </div>
  </div>
}

/** The plugin's own settings page (Settings → Font): every font control in one
 * column — interface family, conversation family + content size, code family +
 * size, terminal family + size — followed by the shared actions. It writes the
 * same theme service entries the native General font-size cell uses, so sizes
 * and families stay in sync with any other writer (keyboard zoom included). */
export function FontSettingsGroup(props: {
  client: Client
  conversation: ConversationFontStore
}) {
  const locale = useLocale(props.client)
  const text = COPY[locale]
  const snapshot = useSyncExternalStore(
    fn => props.client.on('theme/change', () => fn()),
    () => props.client.theme.getTheme(),
    () => props.client.theme.getTheme(),
  )
  const settings: FontSettings = { uiFont: snapshot.fontFamilies.text, codeFont: snapshot.fontFamilies.code }
  const terminalFont = snapshot.fontFamilies.terminal
  const conversationFont = useSyncExternalStore(
    fn => props.conversation.subscribe(fn),
    () => props.conversation.get(),
    () => props.conversation.get(),
  )
  // System font list is shared by the font fields: one permission prompt, one list.
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

  function updateFamily(role: FontRole, value: string) {
    props.client.theme.setFontFamily(role, normalizeFontFamily(value))
  }
  function updateSize(role: FontRole, px: number) {
    props.client.theme.setFontSize(role, px)
  }

  const sizeField = (role: FontRole, label: string, help: string) => (
    <FontSizeField
      label={label}
      help={help}
      role={role}
      value={snapshot.fontSizes[role]}
      locale={locale}
      increaseLabel={text.increaseSize(label)}
      decreaseLabel={text.decreaseSize(label)}
      unit={text.sizeUnit}
      onCommit={updateSize}
    />
  )

  return <div className="font-root" role="group" aria-label={text.label} data-testid="font-settings">
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
      onCommit={value => updateFamily('text', value)}
    />
    <FontField
      label={text.conversationFont}
      help={text.conversationHelp}
      value={conversationFont}
      presets={UI_FONT_PRESETS}
      locale={locale}
      generic="sans-serif"
      systemFonts={fontList.families}
      defaultLabel={text.followUi}
      customLabel={text.customOption}
      customPlaceholder={text.customConversationPlaceholder}
      systemGroupLabel={text.systemGroup}
      onCommit={value => props.conversation.set(value)}
    />
    {sizeField('text', text.textSize, text.textSizeHelp)}
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
      onCommit={value => updateFamily('code', value)}
    />
    {sizeField('code', text.codeSize, text.codeSizeHelp)}
    <FontField
      label={text.terminalFont}
      help={text.terminalHelp}
      value={terminalFont}
      presets={CODE_FONT_PRESETS}
      locale={locale}
      generic="monospace"
      systemFonts={fontList.families}
      defaultLabel={text.defaultOption}
      customLabel={text.customOption}
      customPlaceholder={text.customTerminalPlaceholder}
      systemGroupLabel={text.systemGroup}
      onCommit={value => updateFamily('terminal', value)}
    />
    {sizeField('terminal', text.terminalSize, text.terminalSizeHelp)}
    <div className="font-row">
      <div className="font-row-text">
        {fontList.state === 'ready' ? <div className="font-row-desc" role="status">{text.fontsLoaded(fontList.families.length)}</div> : null}
        {fontList.state === 'ready' ? <div className="font-row-desc" role="status">{text.fontsPartial}</div> : null}
        {fontList.state === 'denied' ? <div className="font-row-desc" role="status">{text.fontsDenied}</div> : null}
      </div>
      <div className="font-row-control">
        <Button variant="outline" size="sm" disabled={fontList.state === 'loading'}
          onClick={() => { void loadSystemFonts() }}>
          {fontList.state === 'loading' ? text.loadingFonts : fontList.state === 'ready' ? text.reloadFonts : text.loadFonts}
        </Button>
        <Button variant="outline" size="sm" onClick={() => {
          updateFamily('text', '')
          updateFamily('code', '')
          updateFamily('terminal', '')
          props.conversation.set('')
        }}>{text.resetFonts}</Button>
        <Button variant="outline" size="sm" onClick={() => {
          updateSize('text', FONT_SIZE_SPECS.text.default)
          updateSize('code', FONT_SIZE_SPECS.code.default)
          updateSize('terminal', FONT_SIZE_SPECS.terminal.default)
        }}>{text.resetSizes}</Button>
      </div>
    </div>
  </div>
}

export function apply(ctx: Context): void {
  const client = ctx as unknown as Client & { effect: Context['effect'] }
  const store = createFontSettingsStore(readStorage())
  const conversation = createConversationFontStore(readStorage())
  migrateFontPreferences(client.theme, store, readStorage())
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-plugin', PLUGIN_NAME)
    style.textContent = styles
    document.head.appendChild(style)
    return () => style.remove()
  }, 'font.styles')
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-plugin', PLUGIN_NAME)
    style.setAttribute('data-font-role', 'conversation')
    document.head.appendChild(style)
    const write = () => {
      const sheet = style.sheet
      if (!sheet) return
      while (sheet.cssRules.length > 0) sheet.deleteRule(0)
      const declarations = conversationFontDeclarations(
        conversation.get(),
        fontTokenDeclarations(document.styleSheets ?? []),
      )
      if (declarations.length === 0) return
      sheet.insertRule(`${CONVERSATION_FONT_SELECTOR}{}`)
      const rule = sheet.cssRules[0] as CSSStyleRule
      for (const [name, value] of declarations) rule.style.setProperty(name, value)
    }
    write()
    const unsubscribe = conversation.subscribe(write)
    return () => { unsubscribe(); style.remove() }
  }, 'font.conversation')
  // Fonts get their own settings section, not a General item row. The
  // shadowing entry waits on the General item list separately and lives inside
  // the section callback's lifetime: a same-id entry at lower priority renders
  // nothing in the native font-size cell's place, so the cell is hidden exactly
  // while both the Font page and the General column exist — section collapse
  // or plugin unload cancels the wait and the native cell renders again (and
  // a late or re-declared General section re-installs it). The native entry is
  // never touched; shadowing is the slot ledger's own override semantics.
  ctx.effect(() => client.slots.inject('settings.section', () => [
    client.slots.register(
      {
        name: 'settings.section',
        id: 'font',
        order: 5,
        label: () => (client.locale.getSnapshot().active.toLowerCase().startsWith('zh') ? COPY.zh.label : COPY.en.label),
      },
      () => <FontSettingsGroup client={client} conversation={conversation} />,
    ),
    client.slots.inject('settings.general.item', () => client.slots.register(
      { name: 'settings.general.item', id: 'font-size', order: 11, priority: -10 },
      () => null,
    )),
    // Nav icon seat is separate from the section list; nesting its wait inside
    // the section's keeps the letter-A bound to this page's exact lifetime.
    registerSettingsSectionIcon(ctx, 'font', 5, IconFontSettings),
  ]), 'font.settings')
}
