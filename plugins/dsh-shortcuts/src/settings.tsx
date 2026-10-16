import * as React from 'react'
import { Button, Checkbox, Input, Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ShortcutCatalogEntry, ShortcutFixedCatalogEntry, Shortcuts } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { BindingIssue, ShortcutBinding, ShortcutConfigSnapshot, ShortcutEdit, ShortcutRevision, ShortcutSaveResult } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import { SHORTCUTS_STYLES } from './styles.js'
import { FixedSettings, type FixedSettingsProps } from './fixed-settings.tsx'

export type SelectorHook<T> = <S>(selector: (snapshot: T) => S) => S
export interface ShortcutsSettingsProps {
  useCatalog: SelectorHook<readonly ShortcutCatalogEntry[]>
  useFixedCatalog: SelectorHook<readonly ShortcutFixedCatalogEntry[]>
  useConfig: SelectorHook<ShortcutConfigSnapshot>
  describeBinding: Shortcuts['describeBinding']
  edit: Shortcuts['edit']
  recording: Shortcuts['recording']
  runtime: Shortcuts['runtime']
  locale: 'zh' | 'en'
  openPalette: () => void
  fixedSettings?: Pick<FixedSettingsProps, 'useFixedBindings' | 'model'>
}

const copy = {
  en: {
    search: 'Search commands, aliases, keys or IDs', palette: 'Open shortcut palette', resetAll: 'Reset all shortcuts',
    applicationGroup: 'Application shortcuts',
    editable: 'Editable', fixed: 'Read only', modified: 'Customized', defaults: 'Default', unbound: 'Unbound',
    edit: 'Edit', clear: 'Clear', reset: 'Reset', empty: 'No matching shortcuts.', unavailable: 'Shortcut configuration is unavailable. Editing is disabled.',
    loading: 'Loading shortcut configuration…', record: 'Record shortcut', recording: 'Press a physical key combination. Escape cancels recording.',
    waiting: 'Waiting for keyboard recording permission…', pair: 'Record two keys held together (Desktop)',
    pairHint: 'Hold the first key while pressing the second key.', cancel: 'Cancel', stop: 'Cancel recording', save: 'Save', retry: 'Retry save',
    confirmReset: 'Reset every customized shortcut for this device profile?', resetHint: 'Other device profiles are unchanged.',
    conflicts: 'Conflicts with', current: 'Current shortcut', draft: 'Your draft', stale: 'Shortcuts changed after this draft was opened. Review the current shortcut and your draft before retrying.',
    review: 'I reviewed the current configuration', saved: 'Shortcut saved.', saving: 'Saving…',
    invalid: 'The shortcut configuration is invalid.', future: 'The shortcut configuration uses a newer format.', read: 'The shortcut configuration could not be read.',
    'write-failed': 'The shortcut could not be saved. Your draft is preserved.', 'not-ready': 'Shortcuts are not ready. Your draft is preserved.',
    unreadable: 'The configuration could not be read. Your draft is preserved.', conflict: 'Resolve the shortcut conflict before saving.',
    'reserved': 'This shortcut is reserved.', 'unsupported-browser': 'This shortcut is unavailable in this browser.',
    'modifier-required': 'This shortcut requires a modifier key.', 'unsupported-key': 'This physical key is unsupported.',
    release: 'Keyboard recording could not be released', acquire: 'Keyboard recording could not start', failed: 'Operation failed',
  },
  zh: {
    search: '搜索名称、别名、按键或 ID', palette: '打开快捷键面板', resetAll: '重置全部快捷键',
    applicationGroup: '应用快捷键',
    editable: '可编辑', fixed: '只读', modified: '已修改', defaults: '默认', unbound: '未绑定',
    edit: '改键', clear: '清除', reset: '重置', empty: '没有匹配的快捷键。', unavailable: '快捷键配置不可用，已禁用编辑。',
    loading: '正在加载快捷键配置…', record: '录制快捷键', recording: '请按下物理组合键。按 Escape 取消录制。',
    waiting: '正在申请键盘录制权限…', pair: '录制同时按住的双键（桌面端）',
    pairHint: '按住第一个键，再按下第二个键。', cancel: '取消', stop: '取消录制', save: '保存', retry: '重试保存',
    confirmReset: '重置当前设备配置下所有已修改的快捷键？', resetHint: '其他设备配置不受影响。',
    conflicts: '冲突命令', current: '当前快捷键', draft: '你的草稿', stale: '草稿打开后快捷键已发生变化。请核对当前快捷键和草稿，再明确重试。',
    review: '我已核对当前配置', saved: '快捷键已保存。', saving: '正在保存…',
    invalid: '快捷键配置格式无效。', future: '快捷键配置使用了更新的格式。', read: '无法读取快捷键配置。',
    'write-failed': '保存失败，草稿已保留。', 'not-ready': '快捷键尚未就绪，草稿已保留。',
    unreadable: '无法读取配置，草稿已保留。', conflict: '请先解决快捷键冲突。',
    'reserved': '此快捷键已被保留。', 'unsupported-browser': '当前浏览器不支持此快捷键。',
    'modifier-required': '此快捷键需要修饰键。', 'unsupported-key': '不支持此物理按键。',
    release: '无法释放键盘录制', acquire: '无法开始键盘录制', failed: '操作失败',
  },
} as const

interface Draft {
  operation: ShortcutEdit
  revision: ShortcutRevision
  retried?: boolean
  result?: ShortcutSaveResult
}
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)
const modifierCode = /^(Control|Alt|Shift|Meta)(Left|Right)$/

// Native recording is a shared boolean, not a lease API. Keep each acquisition
// and its release together across StrictMode replay and separate settings mounts.
let recordingQueue: Promise<void> = Promise.resolve()

/** Render physical key tokens as individual keycap badges while preserving flat textContent. */
export function Keycaps({ keys, unbound, aria }: { keys: readonly string[] | undefined; unbound: string; aria?: string }) {
  if (!keys?.length) return <span aria-keyshortcuts={aria} className="shortcuts-key-unbound">{unbound}</span>
  return <span aria-keyshortcuts={aria} className="shortcuts-keys">
    {keys.map((key, index) => <React.Fragment key={index}>
      {index > 0 ? ' ' : null}
      {key === '+' ? <span className="shortcuts-key-sep" aria-hidden="true">+</span> : <kbd className="shortcuts-key">{key}</kbd>}
    </React.Fragment>)}
  </span>
}

/** Native interception belongs to this mounted recording attempt, including late acknowledgements. */
export function Recorder({ recording, pair, onCapture, onCancel, onError, onReleased, locale, allowEscape = false }: {
  recording: Shortcuts['recording']; pair: boolean; onCapture: (binding: ShortcutBinding) => void
  onCancel: () => void; onError: (message: string) => void; onReleased: () => void; locale: 'zh' | 'en'; allowEscape?: boolean
}) {
  const t = copy[locale]
  const [ready, setReady] = React.useState(false)
  const target = React.useRef<HTMLDivElement>(null)
  const callbacks = React.useRef({ onCapture, onCancel, onError, onReleased })
  callbacks.current = { onCapture, onCancel, onError, onReleased }
  const generation = React.useRef(0)
  React.useEffect(() => {
    const attempt = ++generation.current
    let disposed = false
    let granted = false
    let stop!: () => void
    const stopped = new Promise<void>(resolve => { stop = resolve })
    const held = new Set<string>()
    const previous = document.activeElement as HTMLElement | null
    setReady(false)
    target.current?.focus()
    const keydown = (event: KeyboardEvent) => {
      // Escape always cancels; IME, AltGraph and auto-repeat never become bindings.
      if (event.isComposing || event.keyCode === 229 || event.getModifierState('AltGraph')) return
      if (event.code === 'Escape' && !allowEscape) {
        event.preventDefault(); event.stopImmediatePropagation(); callbacks.current.onCancel(); return
      }
      if (!granted) return
      event.preventDefault(); event.stopImmediatePropagation()
      if (event.repeat || modifierCode.test(event.code) || !event.code) return
      const modifiers: ShortcutBinding['modifiers'] = [
        ...(event.ctrlKey ? ['control' as const] : []), ...(event.altKey ? ['alt' as const] : []),
        ...(event.shiftKey ? ['shift' as const] : []), ...(event.metaKey ? ['meta' as const] : []),
      ]
      const first = held.values().next().value as string | undefined
      held.add(event.code)
      if (pair && (!first || first === event.code)) return
      granted = false
      callbacks.current.onCapture({ code: pair ? first! : event.code, ...(pair ? { secondCode: event.code } : {}), modifiers })
    }
    const keyup = (event: KeyboardEvent) => { held.delete(event.code) }
    const blur = () => held.clear()
    document.addEventListener('keydown', keydown, true)
    document.addEventListener('keyup', keyup, true)
    window.addEventListener('blur', blur)
    recordingQueue = recordingQueue.then(async () => {
      // An attempt disposed while queued never owned native interception.
      if (!disposed) {
        try {
          await recording(true)
          if (!disposed) { granted = true; setReady(true); await stopped }
        } catch (error) {
          if (!disposed) { callbacks.current.onError(`${t.acquire}: ${errorText(error)}`); callbacks.current.onCancel() }
        } finally {
          try { await recording(false) }
          catch (error) { callbacks.current.onError(`${t.release}: ${errorText(error)}`) }
        }
      }
      // A replay's cleanup must not enable controls for its replacement.
      if (generation.current === attempt) callbacks.current.onReleased()
    })
    return () => {
      disposed = true; granted = false; stop()
      document.removeEventListener('keydown', keydown, true)
      document.removeEventListener('keyup', keyup, true)
      window.removeEventListener('blur', blur)
      if (previous?.isConnected) previous.focus()
    }
  }, [recording, pair, t, allowEscape])
  return <div ref={target} tabIndex={-1} className="dsh-ui-banner dsh-ui-banner--info shortcuts-recorder" role="status">
    <div className="shortcuts-recorder-text">
      <p>{ready ? allowEscape ? locale === 'zh' ? '请按下物理组合键（包括 Esc）。取消请点击按钮。' : 'Press a physical key combination, including Escape. Use the button to cancel.' : t.recording : t.waiting}</p>
      {pair && <p className="dsh-ui-hint">{t.pairHint}</p>}
    </div>
    <Button variant="outline" size="sm" onClick={onCancel}>{t.stop}</Button>
  </div>
}

export function ShortcutsSettings({ useCatalog, useFixedCatalog, useConfig, describeBinding, edit, recording, runtime, locale, openPalette, fixedSettings }: ShortcutsSettingsProps) {
  const catalog = useCatalog(value => value)
  const fixed = useFixedCatalog(value => value)
  const config = useConfig(value => value)
  const t = copy[locale]
  const [query, setQuery] = React.useState('')
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [capture, setCapture] = React.useState(false)
  const [intercepting, setIntercepting] = React.useState(false)
  const [pair, setPair] = React.useState(false)
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const focusTarget = React.useRef<HTMLButtonElement>(null)
  const mounted = React.useRef(true)
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const reportError = React.useCallback((message: string) => { if (mounted.current) setError(message) }, [])
  const released = React.useCallback(() => { if (mounted.current) setIntercepting(false) }, [])
  React.useEffect(() => { if (draft && !capture && !intercepting) focusTarget.current?.focus() }, [Boolean(draft), capture, intercepting])
  const ready = config.status === 'ready' && config.error === null
  const labels = new Map([...catalog, ...fixed].map(row => [row.id, row.label]))
  const names = (ids: readonly string[]) => ids.map(id => labels.get(id as ShortcutCatalogEntry['id']) ?? id).join(', ')
  const selectedId = draft && draft.operation.type !== 'reset-all' ? draft.operation.id : undefined
  const selected = catalog.find(row => row.id === selectedId)
  const latest = draft?.result && draft.result.snapshot.sequence >= config.sequence ? draft.result.snapshot : config
  const stale = Boolean(draft && (draft.revision !== latest.revision || draft.result?.status === 'stale'))
  let preview: ReturnType<Shortcuts['describeBinding']> | undefined
  let validation = ''
  if (draft?.operation.type === 'set') {
    try { preview = describeBinding(draft.operation.binding); if (preview.issue) validation = t[preview.issue] }
    catch (cause) { validation = `${t.failed}: ${errorText(cause)}` }
  }
  const conflicts = preview?.conflicts.filter(id => draft?.operation.type !== 'reset-all' && id !== draft?.operation.id) ?? []
  const resultConflicts = draft?.result?.conflicts?.filter(id => draft.operation.type === 'reset-all' || id !== draft.operation.id) ?? []
  const blocked = !ready || latest.status !== 'ready' || latest.error !== null || busy || intercepting || Boolean(validation) || conflicts.length > 0
  const close = () => { if (!busy) { setCapture(false); setDraft(null) } }
  const open = (operation: ShortcutEdit) => {
    const next = { operation, revision: config.revision }
    setError(''); setNotice(''); setDraft(next)
    return next
  }
  const save = async (value: Draft) => {
    if (!ready || busy || intercepting) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await edit(value.operation, value.revision)
      if (!mounted.current) return
      if (result.status === 'saved') { setDraft(null); setNotice(t.saved) }
      else { setDraft({ ...value, result }); if (result.status !== 'stale') setError(t[result.status]) }
    } catch (cause) { reportError(`${t.failed}: ${errorText(cause)}`) }
    finally { if (mounted.current) setBusy(false) }
  }
  // Save without opening the editor. A rejected write still opens so the result can be reviewed.
  const quick = (operation: ShortcutEdit) => {
    const value = { operation, revision: config.revision }
    void (async () => {
      if (!ready || busy || intercepting) return
      setBusy(true); setError(''); setNotice('')
      try {
        const result = await edit(value.operation, value.revision)
        if (!mounted.current) return
        if (result.status === 'saved') setNotice(t.saved)
        else { setDraft({ ...value, result }); if (result.status !== 'stale') setError(t[result.status]) }
      } catch (cause) {
        if (!mounted.current) return
        setDraft(value); reportError(`${t.failed}: ${errorText(cause)}`)
      } finally { if (mounted.current) setBusy(false) }
    })()
  }
  const needle = query.trim().toLocaleLowerCase()
  const matches = (row: ShortcutCatalogEntry | ShortcutFixedCatalogEntry) =>
    [row.label, row.id, ...row.keys, row.keys.join(''), row.keys.join('+'), ...('aliases' in row ? row.aliases : [])]
      .some(value => value.toLocaleLowerCase().includes(needle))
  const shown = catalog.filter(matches)
  const shownFixed = fixed.filter(matches)
  return <div className="shortcuts-root dsh-ui-stack-lg">
    <style>{SHORTCUTS_STYLES}</style>
    <div className="shortcuts-toolbar">
      <Input aria-label={t.search} placeholder={t.search} value={query} onChange={event => setQuery(event.currentTarget.value)} className="shortcuts-search" />
      <div className="dsh-ui-row-wrap">
        <Button variant="outline" size="sm" onClick={() => openPalette()}>{t.palette}</Button>
        <Button variant="outline" size="sm" disabled={!ready || busy || intercepting} onClick={() => open({ type: 'reset-all' })}>{t.resetAll}</Button>
      </div>
    </div>
    {!ready && <div role="alert" className="dsh-ui-banner"><p>{config.status === 'loading' ? t.loading : `${t.unavailable} ${config.error ? t[config.error] : ''}`}</p></div>}
    {error && <p role="alert" className="dsh-ui-error">{error}</p>}
    {notice && <p role="status" className="dsh-ui-notice">{notice}</p>}
    <div className="dsh-ui-stack" aria-label={t.applicationGroup}>
      <div className="shortcuts-section-head">
        <div className="shortcuts-section-title">
          <h3 className="dsh-ui-heading">{t.applicationGroup}</h3>
          <Tag tone="neutral">{shown.length + (!fixedSettings ? shownFixed.length : 0)}</Tag>
        </div>
      </div>
      {shown.map(row => <div key={row.id} className="shortcuts-row dsh-ui-card" data-command-id={row.id}>
        <div className="shortcuts-label"><strong className="dsh-ui-heading">{row.label}</strong><span className="shortcuts-id">{row.id}</span></div>
        <div className="shortcuts-binding">
          <Keycaps keys={row.keys} unbound={t.unbound} aria={row.aria} />
          <div className="dsh-ui-row-wrap"><Tag>{t.editable}</Tag><Tag tone={row.modified ? 'info' : 'quiet'}>{row.modified ? t.modified : t.defaults}</Tag></div>
          {row.issue && <span className="dsh-ui-error">{t[row.issue]}</span>}
          {row.conflicts.length > 0 && <span className="dsh-ui-error">{t.conflicts}: {names(row.conflicts)}</span>}
        </div>
        <div className="dsh-ui-actions">
          <Button variant="outline" size="sm" disabled={!ready || busy || intercepting} onClick={() => open({ type: 'set', id: row.id, binding: row.binding })}>{t.edit}</Button>
          <Button variant="ghost" size="sm" disabled={!ready || busy || intercepting} onClick={() => quick({ type: 'set', id: row.id, binding: null })}>{t.clear}</Button>
          <Button variant="ghost" size="sm" disabled={!ready || busy || intercepting} onClick={() => quick({ type: 'reset', id: row.id })}>{t.reset}</Button>
        </div>
      </div>)}
      {!fixedSettings && shownFixed.map(row => <div key={row.id} className="shortcuts-row dsh-ui-card" data-command-id={row.id}>
        <div className="shortcuts-label"><strong className="dsh-ui-heading">{row.label}</strong><span className="shortcuts-id">{row.id}</span></div>
        <div className="shortcuts-binding">
          <Keycaps keys={row.keys} unbound={t.unbound} />
          <div className="dsh-ui-row-wrap"><Tag tone="quiet">{t.fixed}</Tag></div>
        </div>
      </div>)}
      {!shown.length && !shownFixed.length && <p className="dsh-ui-empty">{t.empty}</p>}
    </div>
    {fixedSettings && <FixedSettings {...fixedSettings} recording={recording} locale={locale} query={query} />}
    <Modal open={draft !== null} onClose={close} closeLabel={t.cancel} title={draft?.operation.type === 'reset-all' ? t.resetAll : `${t.edit}: ${selected?.label ?? selectedId ?? ''}`}
      className="shortcuts-root" contentClassName="dsh-ui-stack"
      footer={draft ? <div className="dsh-ui-actions dsh-ui-actions-end">
        <Button variant="ghost" disabled={busy} onClick={close}>{t.cancel}</Button>
        <Button ref={draft.operation.type === 'set' ? undefined : focusTarget} variant="primary" disabled={blocked || stale} onClick={() => void save(draft)}>
          {busy ? t.saving : draft.retried ? t.retry : draft.operation.type === 'reset-all' ? t.resetAll : t.save}
        </Button>
      </div> : undefined}>
      {draft && <>
        {draft.operation.type === 'reset-all' ? <><p>{t.confirmReset}</p><p className="dsh-ui-hint">{t.resetHint}</p></> : <div className="shortcuts-draft-summary">
          <div className="shortcuts-draft-item">
            <span className="dsh-ui-meta">{t.current}{': '}</span>
            {selected ? <Keycaps keys={selected.keys} unbound={t.unbound} /> : <span className="shortcuts-key-unbound">{t.unbound}</span>}
          </div>
          <div className="shortcuts-draft-item">
            <span className="dsh-ui-meta">{t.draft}{': '}</span>
            {draft.operation.type === 'reset' ? <Tag tone="info">{t.reset}</Tag> : <Keycaps keys={preview?.keys} unbound={t.unbound} />}
          </div>
        </div>}
        {draft.operation.type === 'set' && <>
          {runtime === 'desktop' && <Checkbox checked={pair} disabled={intercepting || busy} onChange={setPair} label={t.pair} />}
          <Button ref={focusTarget} variant="outline" disabled={!ready || busy || intercepting} onClick={() => { setError(''); setIntercepting(true); setCapture(true) }}>{t.record}</Button>
        </>}
        {capture && <Recorder recording={recording} pair={runtime === 'desktop' && pair} locale={locale}
          onCapture={binding => { setDraft(value => value && value.operation.type === 'set' ? { ...value, operation: { ...value.operation, binding }, result: value.result?.status === 'stale' ? value.result : undefined } : value); setCapture(false) }}
          onCancel={() => setCapture(false)} onError={reportError} onReleased={released} />}
        {validation && <p role="alert" className="dsh-ui-error">{validation}</p>}
        {(conflicts.length > 0 || resultConflicts.length > 0) && <p role="alert" className="dsh-ui-error">{t.conflicts}: {names([...new Set([...conflicts, ...resultConflicts])])}</p>}
        {draft.result?.issue && <p role="alert" className="dsh-ui-error">{t[draft.result.issue as BindingIssue]}</p>}
        {stale && <div className="dsh-ui-banner"><p role="alert">{t.stale}</p>
          <div className="dsh-ui-actions">
            <Button variant="outline" size="sm" disabled={busy || intercepting || !ready || latest.status !== 'ready' || latest.error !== null || config.sequence < latest.sequence || config.revision !== latest.revision}
              onClick={() => { setDraft({ ...draft, revision: config.revision, result: undefined, retried: true }); setError('') }}>{t.review}</Button>
          </div>
        </div>}
        {error && <p role="alert" className="dsh-ui-error">{error}</p>}
      </>}
    </Modal>
  </div>
}
