import { Button, Input, Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { useState } from 'react'
import type { ShortcutBinding } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import { Keycaps, type SelectorHook } from './settings.tsx'
import { bindingFromKey, DEFAULT_WEB_TRIGGER, isLegalTrigger, type TriggerSnapshot } from './web-trigger.ts'

export interface TriggerSettingsProps {
  locale: 'zh' | 'en'
  runtime: 'web' | 'desktop'
  useTrigger: SelectorHook<TriggerSnapshot>
  saveTrigger(binding: ShortcutBinding | null): boolean
  conflicts(binding: ShortcutBinding | null): string[]
  claim(): Promise<string | null>
}

export function TriggerSettings(props: TriggerSettingsProps) {
  const current = props.useTrigger(value => value)
  const [recording, setRecording] = useState(false)
  const [candidate, setCandidate] = useState<ShortcutBinding | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const zh = props.locale === 'zh'
  const unbound = zh ? '未绑定' : 'Unbound'
  const parts = (binding: ShortcutBinding | null) => binding ? [...binding.modifiers, binding.code.replace(/^Key|^Digit/, '')] : []
  const label = (binding: ShortcutBinding | null) => binding ? parts(binding).join(' + ') : unbound
  const currentConflicts = props.runtime === 'web' ? props.conflicts(current.binding) : []
  const candidateConflicts = candidate ? props.conflicts(candidate) : []
  return <section className="dsh-ui-card">
    <div className="shortcuts-section-head">
      <div className="shortcuts-section-title">
        <h3 className="dsh-ui-heading">{zh ? '命令面板快捷入口' : 'Command palette shortcut'}</h3>
        <Tag tone="neutral">{props.runtime === 'desktop' ? (zh ? '桌面端' : 'Desktop') : 'Web'}</Tag>
      </div>
    </div>
    {props.runtime === 'desktop' ? <>
      <p className="dsh-ui-hint">{zh ? '默认 Ctrl+Shift+P。Ctrl+K 已用于会话搜索；下方操作会解除它的占用并绑定命令面板。其他组合可在下方快捷键列表修改。' : 'The default is Ctrl+Shift+P. Ctrl+K belongs to session search; this action unbinds it and assigns the palette. Use the list below for other combinations.'}</p>
      <div className="shortcuts-trigger-bar">
        <Keycaps keys={['Ctrl', '+', 'Shift', '+', 'P']} unbound={unbound} />
        <div className="dsh-ui-actions">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirm(true)}>{zh ? '使用 Ctrl+K' : 'Use Ctrl+K'}</Button>
        </div>
      </div>
    </> : <>
      <p className="dsh-ui-hint">{zh ? '浏览器页面内的额外入口；仅当浏览器将按键送达页面时生效。按 Control、Alt 或 Meta 加字母/数字录入。' : 'An extra page shortcut, available when the browser delivers the keys. Record Control, Alt, or Meta plus a letter or digit.'}</p>
      <div className="shortcuts-trigger-bar">
        <Keycaps keys={parts(current.binding)} unbound={unbound} />
        <div className="dsh-ui-actions">
          <Button variant="outline" size="sm" onClick={() => { setCandidate(null); setRecording(true) }}>{zh ? '改键' : 'Change'}</Button>
          <Button variant="ghost" size="sm" onClick={() => props.saveTrigger(null)}>{zh ? '解绑' : 'Unbind'}</Button>
          <Button variant="ghost" size="sm" onClick={() => { const conflicts = props.conflicts(DEFAULT_WEB_TRIGGER); if (conflicts.length) setError(conflicts.join(', ')); else props.saveTrigger(DEFAULT_WEB_TRIGGER) }}>{zh ? '恢复 Ctrl+Shift+P' : 'Restore Ctrl+Shift+P'}</Button>
        </div>
      </div>
      {currentConflicts.length > 0 && <div role="alert" className="dsh-ui-banner"><p>{zh ? '当前入口因冲突暂停：' : 'Shortcut paused due to conflicts: '}{currentConflicts.join(', ')}</p></div>}
      {current.error && <p role="alert" className="dsh-ui-error">{current.error}</p>}
    </>}
    {error && <p role="alert" className="dsh-ui-error">{error}</p>}
    <Modal open={confirm} closeLabel={zh ? '取消' : 'Cancel'} title={zh ? '将 Ctrl+K 用于命令面板？' : 'Assign Ctrl+K to the palette?'} onClose={() => { if (!busy) setConfirm(false) }}
      className="shortcuts-root" contentClassName="dsh-ui-stack"
      footer={<div className="dsh-ui-actions dsh-ui-actions-end">
        <Button variant="primary" disabled={busy} onClick={async () => { setBusy(true); try { setError(await props.claim()); setConfirm(false) } catch (failure) { setError(String(failure)) } finally { setBusy(false) } }}>{zh ? '确认改用 Ctrl+K' : 'Confirm Ctrl+K'}</Button>
      </div>}>
      <p>{zh ? '会话搜索仍可通过界面使用，也可以在列表中另设快捷键。宿主需要分两次保存，失败时会显示实际状态。' : 'Session search remains available in the interface, and you can assign another key in the list. The host saves this in two steps; failures report the resulting state.'}</p>
    </Modal>
    <Modal open={recording} closeLabel={zh ? '取消' : 'Cancel'} title={zh ? '录制面板快捷键' : 'Record palette shortcut'} onClose={() => setRecording(false)}
      className="shortcuts-root" contentClassName="dsh-ui-stack"
      footer={<div className="dsh-ui-actions dsh-ui-actions-end">
        <Button variant="primary" disabled={!candidate || !isLegalTrigger(candidate) || candidateConflicts.length > 0} onClick={() => { if (candidate && isLegalTrigger(candidate) && props.saveTrigger(candidate)) setRecording(false) }}>{zh ? '保存' : 'Save'}</Button>
      </div>}>
      <div className="dsh-ui-field">
        <Input data-modal-autofocus readOnly value={label(candidate)} aria-label={zh ? '按下新快捷键' : 'Press new shortcut'} className="dsh-ui-control" onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229 || event.repeat || event.getModifierState('AltGraph')) return
          if (event.key === 'Escape') { setRecording(false); return }
          // Unmodified Tab must reach the Save button. Recording it would also store an illegal binding.
          if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) return
          event.preventDefault(); event.stopPropagation(); setCandidate(bindingFromKey(event))
        }} />
      </div>
      {candidate && candidateConflicts.length > 0 && <p role="alert" className="dsh-ui-error">{candidateConflicts.join(', ')}</p>}
      {current.error && <p role="alert" className="dsh-ui-error">{current.error}</p>}
    </Modal>
  </section>
}
