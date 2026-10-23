import * as React from 'react'
import { Button, Input, Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Shortcuts } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { NormalizedBinding, ShortcutBinding } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import type { FixedBindingsModel } from './fixed-bindings.ts'
import { fixedDispatchIssue } from './fixed-dispatch.ts'
import { Keycaps, Recorder, type SelectorHook } from './settings.tsx'

type Snapshot = ReturnType<FixedBindingsModel['state']['getSnapshot']>
type SaveResult = ReturnType<FixedBindingsModel['setSlot']>
type Operation = { type: 'set' | 'reset-slot'; id: string; slot: number; binding: ShortcutBinding | null }
  | { type: 'reset'; id: string } | { type: 'reset-all' }
interface Draft { operation: Operation; revision: string; result?: SaveResult; resultBase?: Snapshot; reviewed?: boolean }
export interface FixedSettingsProps {
  useFixedBindings: SelectorHook<Snapshot>
  model: Pick<FixedBindingsModel, 'setSlot' | 'clear' | 'reset' | 'resetAll' | 'describeSlot' | 'resetSlot'>
  recording: Shortcuts['recording']
  locale: 'zh' | 'en'
  query?: string
}

const copy = {
  en: {
    title: 'Additional shortcuts', editable: 'Editable', customized: 'Customized', defaults: 'Default',
    original: 'Original key', effective: 'Effective key', slot: 'Binding', unbound: 'Unbound', edit: 'Edit', unbind: 'Unbind',
    restore: 'Restore', restoreRow: 'Restore action defaults', resetAll: 'Reset all additional shortcuts',
    resetConfirm: 'Restore every additional shortcut to its original keys?', resetHint: 'This resets all binding slots in this section.',
    record: 'Record shortcut', draft: 'Your draft', save: 'Save', retry: 'Retry save', saving: 'Saving…', cancel: 'Cancel',
    sequence: 'Choose one key without modifiers (for example F8). Press the effective key twice in succession to stop the response. Record one press.',
    unsupported: 'Editing unavailable', adapter: 'This action or its original keys changed and cannot be adapted. Its original behavior remains active.',
    search: 'Search additional shortcuts', empty: 'No matching additional shortcuts.', saved: 'Shortcut saved.',
    unavailable: 'Shortcut configuration is unavailable. Editing is disabled.', conflicts: 'Conflicts with',
    stale: 'Shortcuts changed after this draft was opened. Review the effective keys and your draft before retrying.',
    review: 'I reviewed the current configuration', failed: 'Operation failed. Your draft is preserved.',
    invalid: 'The binding is invalid. Your draft is preserved.', conflict: 'Resolve the shortcut conflict before saving. Your draft is preserved.',
    'storage-error': 'The configuration could not be read or saved. Your draft is preserved.', disposed: 'Shortcuts are no longer available. Your draft is preserved.',
  },
  zh: {
    title: '其他快捷键', editable: '可编辑', customized: '已修改', defaults: '默认',
    original: '原始键', effective: '生效键', slot: '绑定', unbound: '未绑定', edit: '改键', unbind: '解绑',
    restore: '恢复', restoreRow: '恢复此动作默认键', resetAll: '重置全部其他快捷键',
    resetConfirm: '将其他快捷键全部恢复为原始键？', resetHint: '此操作会重置本区所有绑定槽位。',
    record: '录制快捷键', draft: '你的草稿', save: '保存', retry: '重试保存', saving: '正在保存…', cancel: '取消',
    sequence: '只能选择不带修饰键的单键（例如 F8），仍连续按两次生效键以停止回复。录制时只需按一次。',
    unsupported: '暂不可编辑', adapter: '此动作或原始键已发生变化，暂无法适配；原始行为保持生效。',
    search: '搜索其他快捷键', empty: '没有匹配的其他快捷键。', saved: '快捷键已保存。',
    unavailable: '快捷键配置不可用，已禁用编辑。', conflicts: '冲突命令',
    stale: '草稿打开后快捷键已发生变化。请核对生效键和草稿，再明确重试。',
    review: '我已核对当前配置', failed: '操作失败，草稿已保留。',
    invalid: '绑定无效，草稿已保留。', conflict: '请先解决快捷键冲突，草稿已保留。',
    'storage-error': '无法读取或保存配置，草稿已保留。', disposed: '快捷键已不可用，草稿已保留。',
  },
} as const
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)
const bindingText = (binding: ShortcutBinding | null | undefined, unbound: string) => binding
  ? [...binding.modifiers, binding.code, ...(binding.secondCode ? [binding.secondCode] : [])].join(' + ') : unbound

/** Each fixed binding retains its slot identity, including explicitly unbound slots. */
export function FixedSettings({ useFixedBindings, model, recording, locale, query }: FixedSettingsProps) {
  const state = useFixedBindings(value => value)
  const t = copy[locale]
  const [search, setSearch] = React.useState('')
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const [capture, setCapture] = React.useState(false)
  const [intercepting, setIntercepting] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const mounted = React.useRef(true)
  const focusTarget = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const reportError = React.useCallback((message: string) => { if (mounted.current) setError(message) }, [])
  const released = React.useCallback(() => { if (mounted.current) setIntercepting(false) }, [])
  React.useEffect(() => { if (draft && !capture && !intercepting) focusTarget.current?.focus() }, [Boolean(draft), capture, intercepting])

  // A save response can precede the selector update. Show its current values but
  // require the live selector to catch up before accepting a reviewed revision.
  const latest = draft?.result && state === draft.resultBase ? draft.result.snapshot : state
  const ready = state.error === null && latest.error === null
  const stale = Boolean(draft && (draft.revision !== latest.revision || draft.result?.status === 'stale'))
  const selectedId = draft && draft.operation.type !== 'reset-all' ? draft.operation.id : undefined
  const selected = latest.rows.find(row => row.id === selectedId)
  const dispatchReason = (row: Snapshot['rows'][number]) => {
    const issue = fixedDispatchIssue(row)
    if (!issue) return ''
    return fixedDispatchIssue({ id: row.id, group: row.group, original: row.original }) ? t.adapter : t.sequence
  }
  const candidateIssue = (operation: Operation, snapshot: Snapshot): string => {
    if (operation.type !== 'set') return '' // Recovery stays available for obsolete catalog entries.
    const row = snapshot.rows.find(item => item.id === operation.id)
    if (!row) return t.adapter
    // UI drafts come from normalized catalog entries or physical key recording.
    const bindings = row.bindings.map((binding, slot) => slot === operation.slot ? operation.binding as NormalizedBinding | null : binding)
    return dispatchReason({ ...row, bindings })
  }
  const selectedIssue = selected ? dispatchReason(selected) : ''
  const labels = new Map(state.rows.map(row => [String(row.id), row.label]))
  const names = (ids: readonly string[]) => ids.map(id => labels.get(id) ?? id).join(', ')
  let preview: ReturnType<FixedBindingsModel['describeSlot']> | undefined
  let validation = ''
  if (draft && (draft.operation.type === 'set' || draft.operation.type === 'reset-slot')) {
    try {
      preview = model.describeSlot(draft.operation.id, draft.operation.slot, draft.operation.binding)
      if (preview.issue) validation = `${t.invalid} ${preview.issue}`
      validation = candidateIssue(draft.operation, latest) || validation
    } catch (cause) { validation = `${t.failed} ${errorText(cause)}` }
  }
  const conflicts = preview?.conflicts ?? []
  const disabled = !ready || busy || intercepting
  const keyText = (keys: readonly string[] | undefined) => keys?.length ? keys.join(' ') : t.unbound
  const open = (operation: Operation) => {
    const value = { operation, revision: state.revision }
    setDraft(value); setError(''); setNotice('')
    return value
  }
  const close = () => { if (!busy) { setCapture(false); setDraft(null) } }
  const save = async (value: Draft) => {
    if (!ready || busy || intercepting) return
    const issue = candidateIssue(value.operation, latest)
    if (issue) { setError(issue); return }
    setBusy(true); setError(''); setNotice('')
    const operation = value.operation
    try {
      const result = await (operation.type === 'reset-all' ? model.resetAll(value.revision)
        : operation.type === 'reset' ? model.reset(operation.id, value.revision)
          : operation.type === 'reset-slot' ? model.resetSlot(operation.id, operation.slot, value.revision)
            : model.setSlot(operation.id, operation.slot, operation.binding, value.revision))
      if (!mounted.current) return
      if (result.status === 'saved') { setDraft(null); setNotice(t.saved) }
      else {
        setDraft({ ...value, result, resultBase: state })
        if (result.status !== 'stale') setError(`${t[result.status]}${result.message ? ` ${result.message}` : ''}`)
      }
    } catch (cause) { reportError(`${t.failed} ${errorText(cause)}`) }
    finally { if (mounted.current) setBusy(false) }
  }
  // Save without opening the editor. A rejected write still opens so the result can be reviewed.
  const quick = (operation: Operation) => {
    const value = { operation, revision: state.revision }
    void (async () => {
      if (!ready || busy || intercepting) return
      const issue = candidateIssue(value.operation, latest)
      if (issue) { setDraft(value); setError(issue); setNotice(''); return }
      setBusy(true); setError(''); setNotice('')
      const current = value.operation
      try {
        const result = await (current.type === 'reset-all' ? model.resetAll(value.revision)
          : current.type === 'reset' ? model.reset(current.id, value.revision)
            : current.type === 'reset-slot' ? model.resetSlot(current.id, current.slot, value.revision)
              : model.setSlot(current.id, current.slot, current.binding, value.revision))
        if (!mounted.current) return
        if (result.status === 'saved') setNotice(t.saved)
        else {
          setDraft({ ...value, result, resultBase: state })
          if (result.status !== 'stale') setError(`${t[result.status]}${result.message ? ` ${result.message}` : ''}`)
        }
      } catch (cause) {
        if (!mounted.current) return
        setDraft(value); reportError(`${t.failed} ${errorText(cause)}`)
      } finally { if (mounted.current) setBusy(false) }
    })()
  }
  const needle = (query ?? search).trim().toLocaleLowerCase()
  const shown = state.rows.filter(row => [row.label, row.id, ...row.keys, row.keys.join(''), row.keys.join('+'),
    ...row.bindingKeys.flat(), ...row.bindingKeys.map(keys => keys.join('')), ...row.bindingKeys.map(keys => keys.join('+')),
    ...row.original.bindings.map(binding => bindingText(binding, t.unbound))]
    .some(value => value.toLocaleLowerCase().includes(needle)))
  const currentSlot = draft && (draft.operation.type === 'set' || draft.operation.type === 'reset-slot') ? draft.operation.slot : undefined

  return <section className="shortcuts-fixed-root dsh-ui-section dsh-ui-stack" aria-label={t.title}>
    <div className="shortcuts-section-head">
      <div className="shortcuts-section-title">
        <strong className="dsh-ui-heading">{t.title}</strong>
        <Tag tone="neutral">{shown.length}</Tag>
      </div>
      <div className="dsh-ui-row-wrap">
        {query === undefined && <Input aria-label={t.search} placeholder={t.search} value={search} onChange={event => setSearch(event.currentTarget.value)} className="shortcuts-search" />}
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => open({ type: 'reset-all' })}>{t.resetAll}</Button>
      </div>
    </div>
    {!ready && <div role="alert" className="dsh-ui-banner dsh-ui-banner--danger"><p>{t.unavailable} {latest.error ?? state.error}</p></div>}
    {error && !draft && <p role="alert" className="dsh-ui-error">{error}</p>}
    {notice && <p role="status" className="dsh-ui-notice">{notice}</p>}
    {shown.map(row => {
      const issue = dispatchReason(row)
      return <div className="dsh-ui-card dsh-ui-stack shortcuts-fixed-card" data-command-id={row.id} key={row.id}>
      <div className="shortcuts-fixed-header">
        <div className="shortcuts-label">
          <div className="dsh-ui-row-wrap">
            <strong className="dsh-ui-heading">{row.label}</strong>
            <Tag tone={issue ? 'warning' : 'outline'}>{issue ? t.unsupported : t.editable}</Tag>
            <Tag tone={row.modified ? 'info' : 'quiet'}>{row.modified ? t.customized : t.defaults}</Tag>
          </div>
          <span className="shortcuts-id">{row.id}</span>
        </div>
        <div className="dsh-ui-actions">
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => quick({ type: 'reset', id: row.id })}>{t.restoreRow}</Button>
        </div>
      </div>
      {row.id === 'response.stop' && <p className="dsh-ui-hint">{t.sequence}</p>}
      {issue && <p role="alert" className="dsh-ui-error">{issue}</p>}
      <div className="shortcuts-slots">
        {Array.from({ length: Math.max(row.original.bindings.length, row.bindings.length, 1) }, (_, slot) => <div key={slot} className="shortcuts-slot-card" data-binding-slot={slot}>
          <div className="shortcuts-slot-meta">
            <Tag tone="neutral">{t.slot} {slot + 1}</Tag>
            <span className="shortcuts-slot-pair">{t.original}{': '}<kbd>{bindingText(row.original.bindings[slot], t.unbound)}</kbd></span>
            <span className="shortcuts-slot-pair">{t.effective}{': '}<Keycaps keys={row.bindingKeys[slot]} unbound={t.unbound} /></span>
          </div>
          <div className="dsh-ui-actions">
            <Button variant="outline" size="sm" disabled={disabled || Boolean(issue)} onClick={() => open({ type: 'set', id: row.id, slot, binding: row.bindings[slot] ?? null })}>{t.edit}</Button>
            <Button variant="ghost" size="sm" disabled={disabled || Boolean(issue)} onClick={() => quick({ type: 'set', id: row.id, slot, binding: null })}>{t.unbind}</Button>
            <Button variant="ghost" size="sm" disabled={disabled} onClick={() => quick({ type: 'reset-slot', id: row.id, slot, binding: row.original.bindings[slot] ?? null })}>{t.restore}</Button>
          </div>
        </div>)}
      </div>
      {row.conflicts.length > 0 && <p role="alert" className="dsh-ui-error">{t.conflicts}: {names(row.conflicts)}</p>}
    </div>})}
    {!shown.length && <p className="dsh-ui-empty">{t.empty}</p>}
    <Modal open={draft !== null} onClose={close} closeLabel={t.cancel}
      title={draft?.operation.type === 'reset-all' ? t.resetAll : `${t.edit}: ${selected?.label ?? ''}`}
      className="shortcuts-fixed-root" contentClassName="dsh-ui-stack"
      footer={draft ? <div className="dsh-ui-actions dsh-ui-actions-end">
        <Button variant="ghost" disabled={busy} onClick={close}>{t.cancel}</Button>
        <Button ref={draft.operation.type === 'set' ? undefined : focusTarget} variant="primary" disabled={disabled || stale || Boolean(validation) || conflicts.length > 0} onClick={() => void save(draft)}>
          {busy ? t.saving : draft.reviewed ? t.retry : draft.operation.type === 'reset-all' ? t.resetAll : t.save}
        </Button>
      </div> : undefined}>
      {draft && <>
        {draft.operation.type === 'reset-all' ? <><p>{t.resetConfirm}</p><p className="dsh-ui-hint">{t.resetHint}</p></> : <>
          <div className="shortcuts-draft-summary">
            <div className="shortcuts-draft-item">
              <span className="dsh-ui-meta">{t.original}{': '}</span>
              {currentSlot === undefined ? <Keycaps keys={selected?.keys} unbound={t.unbound} /> : <kbd>{bindingText(selected?.original.bindings[currentSlot], t.unbound)}</kbd>}
            </div>
            <div className="shortcuts-draft-item">
              <span className="dsh-ui-meta">{t.effective}{': '}</span>
              {currentSlot === undefined ? <kbd>{selected?.bindingKeys.map(keyText).join(' / ')}</kbd> : <Keycaps keys={selected?.bindingKeys[currentSlot]} unbound={t.unbound} />}
            </div>
            <div className="shortcuts-draft-item">
              <span className="dsh-ui-meta">{t.draft}{': '}</span>
              {draft.operation.type === 'reset' ? <Tag tone="info">{t.restoreRow}</Tag> : <Keycaps keys={preview?.keys} unbound={t.unbound} />}
            </div>
          </div>
          {selected?.id === 'response.stop' && <p className="dsh-ui-hint">{t.sequence}</p>}
        </>}
        {draft.operation.type === 'set' && <Button ref={focusTarget} variant="outline" disabled={disabled || Boolean(selectedIssue)} onClick={() => { setError(''); setIntercepting(true); setCapture(true) }}>{t.record}</Button>}
        {capture && <Recorder recording={recording} pair={false} allowEscape locale={locale}
          onCapture={binding => {
            setDraft(value => value && value.operation.type === 'set' ? { ...value, operation: { ...value.operation, binding }, result: value.result?.status === 'stale' ? value.result : undefined } : value)
            setCapture(false)
          }} onCancel={() => setCapture(false)} onError={reportError} onReleased={released} />}
        {!ready && <p role="alert" className="dsh-ui-error">{t.unavailable} {latest.error ?? state.error}</p>}
        {validation && <p role="alert" className="dsh-ui-error">{validation}</p>}
        {conflicts.length > 0 && <p role="alert" className="dsh-ui-error">{t.conflicts}: {names(conflicts)}</p>}
        {stale && <div className="dsh-ui-banner"><p role="alert">{t.stale}</p>
          <div className="dsh-ui-actions">
            <Button variant="outline" size="sm" disabled={disabled || state.revision !== latest.revision} onClick={() => { setDraft({ ...draft, revision: state.revision, result: undefined, reviewed: true }); setError('') }}>{t.review}</Button>
          </div>
        </div>}
        {error && <p role="alert" className="dsh-ui-error">{error}</p>}
      </>}
    </Modal>
  </section>
}
