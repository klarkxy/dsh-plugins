/**
 * Dorothy's persona page in the settings view: how she addresses you and who
 * she is. Each part can be edited and put back to its default; changes apply
 * from her next step.
 */
import { Button, Input, PathLabel, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { useCallback, useEffect, useState } from 'react'
import type { DotSettings, MemoryView, SettingField } from './contracts.ts'
import { ADDRESS_MAX_CHARS, DEFAULT_ADDRESS, DEFAULT_PERSONA, PERSONA_MAX_CHARS } from './persona.ts'
import { LockToggle, type SaveNotice, type SettingsApi, type SettingsPatch } from './settings-panel.tsx'
import { t, type CopyLocale } from './ui-copy.ts'

export interface MemoryApi {
  memory(signal: AbortSignal): Promise<MemoryView>
  setMemory(text: string): Promise<MemoryView>
  undoMemory(): Promise<MemoryView>
}

/** Dorothy's notes: she writes them herself, and the human can read, rewrite and take back the latest change. */
function MemorySection({ locale, api, onStatus, locked, onLock }: { locale: CopyLocale; api: MemoryApi; onStatus: (status: SaveNotice | undefined) => void; locked: boolean; onLock: (field: SettingField, locked: boolean) => void }) {
  const [view, setView] = useState<MemoryView>()
  const [draft, setDraft] = useState('')
  const [failed, setFailed] = useState<string>()
  const take = (next: MemoryView) => { setView(next); setDraft(next.text); setFailed(undefined) }
  useEffect(() => {
    const lifetime = new AbortController()
    api.memory(lifetime.signal).then(take, failure => { if (!lifetime.signal.aborted) setFailed(failure instanceof Error ? failure.message : String(failure)) })
    return () => lifetime.abort()
  }, [api])
  const run = (work: Promise<MemoryView>) => {
    onStatus(undefined)
    work.then(next => { take(next); onStatus({ kind: 'saved' }) }, failure => onStatus({ kind: 'error', message: failure instanceof Error ? failure.message : String(failure) }))
  }
  const changed = view !== undefined && draft !== view.text
  const max = view?.maxChars ?? 0
  const over = view !== undefined && draft.trim().length > max
  return (
    <div className="dsh-dot-pane-section">
      <div className="dsh-ui-form">
        <div className="dsh-ui-field">
          <div className="dsh-dot-setting-head">
            <span className="dsh-ui-label">{t(locale, 'pMemory')}</span>
            <div className="dsh-dot-setting-tools">
              <LockToggle locale={locale} label={t(locale, 'pMemory')} locked={locked} onLock={next => onLock('memory', next)} />
            </div>
          </div>
          {view === undefined
            ? <span className={failed === undefined ? 'dsh-ui-help' : 'dsh-ui-error'}>{failed === undefined ? t(locale, 'pMemoryLoading') : t(locale, 'pMemoryFailed') + failed}</span>
            : (
              <>
                <textarea className="dsh-ui-textarea dsh-dot-persona-text dsh-dot-memory-text" aria-label={t(locale, 'pMemory')} rows={7} placeholder={t(locale, 'pMemoryPlaceholder')}
                  value={draft} onChange={event => setDraft(event.target.value)} />
                <div className="dsh-dot-memory-bar">
                  <span className="dsh-ui-hint dsh-dot-memory-meta" data-over={over ? '' : undefined}>{t(locale, 'pMemoryCount').replace('{n}', String(draft.trim().length)).replace('{max}', String(max))}</span>
                  <PathLabel path={view.path} className="dsh-dot-memory-path" />
                </div>
                <div className="dsh-ui-actions">
                  <Button variant="primary" size="sm" disabled={!changed || over} onClick={() => run(api.setMemory(draft))}>{t(locale, 'pMemorySave')}</Button>
                  <Button variant="ghost" size="sm" disabled={!changed} onClick={() => setDraft(view.text)}>{t(locale, 'pDiscard')}</Button>
                  <span className="dsh-ui-spacer" />
                  <Button variant="outline" size="sm" disabled={!view.canUndo} onClick={() => run(api.undoMemory())}>{t(locale, 'pMemoryUndo')}</Button>
                </div>
              </>
            )}
        </div>
      </div>
    </div>
  )
}

export function PersonaPanel({ locale, api, settings, onSaved, onStatusChange }: {
  locale: CopyLocale
  api: SettingsApi & MemoryApi
  settings?: DotSettings
  onSaved: (next: DotSettings) => void
  onStatusChange?: (status: SaveNotice | undefined) => void
}) {
  const [status, setStatus] = useState<SaveNotice>()
  const savedAddress = settings?.address ?? DEFAULT_ADDRESS
  const savedPersona = settings?.persona ?? DEFAULT_PERSONA
  const [address, setAddress] = useState(savedAddress)
  const [persona, setPersona] = useState(savedPersona)
  useEffect(() => { setAddress(savedAddress) }, [savedAddress])
  useEffect(() => { setPersona(savedPersona) }, [savedPersona])
  const reportStatus = useCallback((next: SaveNotice | undefined) => {
    setStatus(next)
    onStatusChange?.(next)
  }, [onStatusChange])

  const save = (patch: SettingsPatch) => {
    reportStatus(undefined)
    api.setSettings(patch).then(
      next => { onSaved(next); reportStatus({ kind: 'saved' }) },
      failure => reportStatus({ kind: 'error', message: failure instanceof Error ? failure.message : String(failure) }),
    )
  }
  const commitAddress = () => {
    const text = address.trim()
    if (!text) { setAddress(savedAddress); return }
    if (text !== savedAddress) save({ address: text })
  }

  if (!settings) return <div className="dsh-ui-loading">{t(locale, 'settingsLoading')}</div>
  const personaChanged = persona !== savedPersona
  const personaCustom = settings.persona !== undefined
  const addressCustom = settings.address !== undefined
  const onLock = (field: SettingField, locked: boolean) => save({ locks: { ...settings.locks, [field]: locked } })

  return (
    <div className="dsh-dot-pane dsh-dot-settings-pane">
      {!onStatusChange && status?.kind === 'saved' ? <div className="dsh-ui-notice" role="status">{t(locale, 'saved')}</div> : null}
      {!onStatusChange && status?.kind === 'error' ? <div className="dsh-ui-error" role="alert">{t(locale, 'saveFailed')}{status.message}</div> : null}
      <div className="dsh-dot-pane-section">
        <div className="dsh-ui-form">
        <div className="dsh-ui-field">
          <div className="dsh-dot-setting-head">
            <span className="dsh-ui-label">{t(locale, 'pAddress')}</span>
            <div className="dsh-dot-setting-tools">
              <LockToggle locale={locale} label={t(locale, 'pAddress')} locked={settings.locks?.address === true} onLock={next => onLock('address', next)} />
            </div>
          </div>
          <div className="dsh-dot-persona-row">
            <Input aria-label={t(locale, 'pAddress')} maxLength={ADDRESS_MAX_CHARS} placeholder={DEFAULT_ADDRESS} value={address}
              onChange={event => setAddress(event.target.value)} onBlur={commitAddress}
              onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) commitAddress() }} />
            <Button variant="ghost" size="sm" disabled={!addressCustom} onClick={() => save({ address: null })}>{t(locale, 'pRestore')}</Button>
          </div>
        </div>
        <div className="dsh-ui-field">
          <div className="dsh-dot-setting-head">
            <span className="dsh-ui-label">
              {t(locale, 'pPersona')}
              {personaCustom ? <Tag tone="quiet">{t(locale, 'pCustom')}</Tag> : null}
            </span>
            <div className="dsh-dot-setting-tools">
              <span className="dsh-ui-hint">{t(locale, 'pMemoryCount').replace('{n}', String(persona.length)).replace('{max}', String(PERSONA_MAX_CHARS))}</span>
              <LockToggle locale={locale} label={t(locale, 'pPersona')} locked={settings.locks?.persona === true} onLock={next => onLock('persona', next)} />
            </div>
          </div>
          <textarea className="dsh-ui-textarea dsh-dot-persona-text" aria-label={t(locale, 'pPersona')} rows={9} maxLength={PERSONA_MAX_CHARS}
            value={persona} onChange={event => setPersona(event.target.value)} />
          <div className="dsh-ui-actions">
            <Button variant="primary" size="sm" disabled={!personaChanged} onClick={() => save({ persona })}>{t(locale, 'pSave')}</Button>
            <Button variant="ghost" size="sm" disabled={!personaChanged} onClick={() => setPersona(savedPersona)}>{t(locale, 'pDiscard')}</Button>
            <span className="dsh-ui-spacer" />
            <Button variant="outline" size="sm" disabled={!personaCustom && !personaChanged} onClick={() => { setPersona(DEFAULT_PERSONA); save({ persona: null }) }}>{t(locale, 'pRestore')}</Button>
          </div>
        </div>
        </div>
      </div>
      <MemorySection locale={locale} api={api} onStatus={reportStatus} locked={settings.locks?.memory === true} onLock={onLock} />
      <p className="dsh-ui-hint dsh-dot-settings-note">{t(locale, 'pNote')}</p>
    </div>
  )
}

// Selectors spell the root out (.dsh-dot-chat = CHAT_ROOT) so the repository scope check can read them.
export const personaCss = `
.dsh-dot-chat .dsh-dot-persona-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.dsh-dot-chat .dsh-dot-persona-row > :first-child { flex: 1 1 160px; min-width: 0; max-width: 260px; }
.dsh-dot-chat .dsh-dot-persona-row > button { flex-shrink: 0; white-space: nowrap; }
.dsh-dot-chat .dsh-dot-persona-text { min-height: 180px; font-family: inherit; font-size: 13px; line-height: 1.6; }
.dsh-dot-chat .dsh-dot-memory-text { min-height: 140px; }
.dsh-dot-chat .dsh-dot-memory-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; }
.dsh-dot-chat .dsh-dot-memory-meta { flex: none; font-variant-numeric: tabular-nums; }
.dsh-dot-chat .dsh-dot-memory-meta[data-over] { color: var(--dsw-alias-state-error-primary); }
.dsh-dot-chat .dsh-dot-memory-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
`
