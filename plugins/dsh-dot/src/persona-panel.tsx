/**
 * Dorothy's persona page in the settings view: how she addresses you, who she
 * is, and the two blocks her prompt carries — the agreements you set and her
 * own cognition. Each part can be edited; changes apply from her next step.
 */
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { useCallback, useEffect, useState } from 'react'
import type { DotSettings, KnowledgeView, SettingField } from './contracts.ts'
import { ADDRESS_MAX_CHARS, DEFAULT_ADDRESS, DEFAULT_PERSONA, PERSONA_MAX_CHARS } from './persona.ts'
import { LockToggle, type SaveNotice, type SettingsApi, type SettingsPatch } from './settings-panel.tsx'
import { formatWhen, t, type CopyLocale } from './ui-copy.ts'

export interface KnowledgeApi {
  knowledge(signal: AbortSignal): Promise<KnowledgeView>
  setAgreements(text: string): Promise<KnowledgeView>
  undoAgreements(): Promise<KnowledgeView>
  setCognition(text: string): Promise<KnowledgeView>
  /** The `at` of the version to return to; taken from a history entry. */
  restoreCognition(at: number): Promise<KnowledgeView>
}

/** One editable text block with its own save and discard. */
function TextBlock({
  locale,
  label,
  placeholder,
  value,
  maxChars,
  rows,
  empty,
  onSave,
  onUndo,
}: {
  locale: CopyLocale
  label: string
  placeholder: string
  value: string
  maxChars: number
  rows: number
  empty?: string
  onSave: (text: string) => void
  onUndo?: (() => void) | undefined
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  const changed = draft !== value
  const over = draft.trim().length > maxChars
  return (
    <>
      <textarea
        className="dsh-ui-textarea dsh-dot-persona-text"
        aria-label={label}
        rows={rows}
        maxLength={maxChars}
        placeholder={placeholder}
        value={draft}
        onChange={event => setDraft(event.target.value)}
      />
      <div className="dsh-dot-memory-bar">
        <span className="dsh-ui-hint dsh-dot-memory-meta" data-over={over ? '' : undefined}>
          {t(locale, 'pCharCount').replace('{n}', String(draft.trim().length)).replace('{max}', String(maxChars))}
        </span>
      </div>
      <div className="dsh-ui-actions">
        <Button variant="primary" size="sm" disabled={!changed || over} onClick={() => onSave(draft)}>{t(locale, 'pSave')}</Button>
        <Button variant="ghost" size="sm" disabled={!changed} onClick={() => setDraft(value)}>{t(locale, 'pDiscard')}</Button>
        <span className="dsh-ui-spacer" />
        {onUndo ? <Button variant="outline" size="sm" onClick={onUndo}>{t(locale, 'pAgreementsUndo')}</Button> : null}
      </div>
      {empty && !value.trim() ? <span className="dsh-ui-help">{empty}</span> : null}
    </>
  )
}

/** The earlier versions of Dorothy's cognition, newest first, each restorable. */
function CognitionHistory({ locale, knowledge, onRestore }: {
  locale: CopyLocale
  knowledge: KnowledgeView
  onRestore: (at: number) => void
}) {
  const history = knowledge.cognition.history
  if (history.length === 0) return <span className="dsh-ui-help">{t(locale, 'pCognitionHistoryEmpty')}</span>
  return (
    <div className="dsh-dot-versions">
      {history.map((version, index) => (
        <div className="dsh-dot-version" key={`${version.at}:${index}`}>
          <div className="dsh-dot-version-head">
            <span className="dsh-dot-version-time">
              {t(locale, 'pCognitionVersionAt').replace('{time}', formatWhen(version.at))}
            </span>
            <span className="dsh-dot-spacer" />
            <Button variant="outline" size="sm" onClick={() => onRestore(version.at)}>
              {t(locale, 'pCognitionRestore')}
            </Button>
          </div>
          <p className="dsh-dot-version-text">{version.text.trim() || t(locale, 'ctxSectionEmpty')}</p>
        </div>
      ))}
    </div>
  )
}

/**
 * Dorothy's knowledge: the agreements you set and her own cognition. The
 * agreements keep one step of undo; the cognition keeps its last versions.
 */
function KnowledgeSection({ locale, api, onStatus, locked, onLock }: {
  locale: CopyLocale
  api: KnowledgeApi
  onStatus: (status: SaveNotice | undefined) => void
  locked: boolean
  onLock: (field: SettingField, locked: boolean) => void
}) {
  const [knowledge, setKnowledge] = useState<KnowledgeView>()
  const [failed, setFailed] = useState<string>()
  useEffect(() => {
    const lifetime = new AbortController()
    api.knowledge(lifetime.signal).then(
      next => { if (!lifetime.signal.aborted) { setKnowledge(next); setFailed(undefined) } },
      failure => { if (!lifetime.signal.aborted) setFailed(failure instanceof Error ? failure.message : String(failure)) },
    )
    return () => lifetime.abort()
  }, [api])
  const run = (work: Promise<KnowledgeView>) => {
    onStatus(undefined)
    work.then(
      next => { setKnowledge(next); setFailed(undefined); onStatus({ kind: 'saved' }) },
      failure => onStatus({ kind: 'error', message: failure instanceof Error ? failure.message : String(failure) }),
    )
  }
  if (knowledge === undefined) {
    return (
      <div className="dsh-dot-pane-section">
        <div className="dsh-ui-form">
          <div className="dsh-ui-field">
            <span className={failed === undefined ? 'dsh-ui-help' : 'dsh-ui-error'}>
              {failed === undefined ? t(locale, 'pKnowledgeLoading') : t(locale, 'pKnowledgeFailed') + failed}
            </span>
          </div>
        </div>
      </div>
    )
  }
  const agreements = knowledge.agreements
  const cognition = knowledge.cognition
  return (
    <>
      <div className="dsh-dot-pane-section">
        <div className="dsh-ui-form">
          <div className="dsh-ui-field">
            <div className="dsh-dot-setting-head">
              <span className="dsh-ui-label">{t(locale, 'pAgreements')}</span>
              <div className="dsh-dot-setting-tools">
                <LockToggle locale={locale} label={t(locale, 'pAgreements')} locked={locked} onLock={next => onLock('memory', next)} />
              </div>
            </div>
            <span className="dsh-ui-help">{t(locale, 'pAgreementsHint')}</span>
            <TextBlock
              locale={locale}
              label={t(locale, 'pAgreements')}
              placeholder={t(locale, 'pAgreementsPlaceholder')}
              value={agreements.text}
              maxChars={agreements.maxChars}
              rows={7}
              empty={t(locale, 'pAgreementsEmpty')}
              onSave={text => run(api.setAgreements(text))}
              {...agreements.canUndo ? { onUndo: () => run(api.undoAgreements()) } : {}}
            />
          </div>
        </div>
      </div>
      <div className="dsh-dot-pane-section">
        <div className="dsh-ui-form">
          <div className="dsh-ui-field">
            <div className="dsh-dot-setting-head">
              <span className="dsh-ui-label">{t(locale, 'pCognition')}</span>
            </div>
            <span className="dsh-ui-help">{t(locale, 'pCognitionHint')}</span>
            <TextBlock
              locale={locale}
              label={t(locale, 'pCognition')}
              placeholder={t(locale, 'pCognitionPlaceholder')}
              value={cognition.text}
              maxChars={cognition.maxChars}
              rows={7}
              empty={t(locale, 'pCognitionEmpty')}
              onSave={text => run(api.setCognition(text))}
            />
            <div className="dsh-dot-setting-head dsh-dot-versions-head">
              <span className="dsh-ui-label">{t(locale, 'pCognitionHistory')}</span>
            </div>
            <CognitionHistory locale={locale} knowledge={knowledge} onRestore={at => run(api.restoreCognition(at))} />
          </div>
        </div>
      </div>
    </>
  )
}

export function PersonaPanel({ locale, api, settings, onSaved, onStatusChange }: {
  locale: CopyLocale
  api: SettingsApi & KnowledgeApi
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
              <span className="dsh-ui-hint">{t(locale, 'pCharCount').replace('{n}', String(persona.length)).replace('{max}', String(PERSONA_MAX_CHARS))}</span>
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
      <KnowledgeSection locale={locale} api={api} onStatus={reportStatus} locked={settings.locks?.memory === true} onLock={onLock} />
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
.dsh-dot-chat .dsh-dot-memory-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; }
.dsh-dot-chat .dsh-dot-memory-meta { flex: none; font-variant-numeric: tabular-nums; }
.dsh-dot-chat .dsh-dot-memory-meta[data-over] { color: var(--dsw-alias-state-error-primary); }
.dsh-dot-chat .dsh-dot-versions-head { margin-top: 14px; }
.dsh-dot-chat .dsh-dot-versions { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; }
.dsh-dot-chat .dsh-dot-version { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-1); }
.dsh-dot-chat .dsh-dot-version-head { display: flex; align-items: center; gap: 8px; }
.dsh-dot-chat .dsh-dot-version-head > button { flex-shrink: 0; white-space: nowrap; }
.dsh-dot-chat .dsh-dot-version-time { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.dsh-dot-chat .dsh-dot-version-text { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 5.4em; overflow-y: auto; }
`
