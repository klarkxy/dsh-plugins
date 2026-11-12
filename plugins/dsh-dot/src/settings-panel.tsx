/**
 * Dorothy's settings view, opened from the gear in her panel's header. Every
 * change saves at once; free-text fields save when they lose focus.
 */
import { groupModelMenuChoices, modelMenuShortName, parseModelMenuChoices, type ModelMenuChoice } from '@klarkxy/dsh-plugin-kit/model-menu'
import { Button, Checkbox, IconSearchOutlineRegular, Input, SegmentedTabs, type SegmentedTab } from '@deepseek-ai/dsh-client-ui-primitives'
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { type ApprovalMode, type DotSettings, type ModelChoice, type SettingField, type SettingProposal, type TakeoverMode, type TaskModelRule } from './contracts.ts'
import { t, type CopyLocale, type TextKey } from './ui-copy.ts'

/** null on model, persona or address goes back to the default. */
export type SettingsPatch = { readonly [K in keyof DotSettings]?: K extends 'model' ? ModelChoice | null : K extends 'persona' | 'address' ? string | null : DotSettings[K] }
export type SaveNotice = { readonly kind: 'saved' } | { readonly kind: 'error'; readonly message: string }

export interface SettingsApi {
  setSettings(patch: SettingsPatch): Promise<DotSettings>
  /** Raw host model catalog; parsed here. */
  models(): Promise<unknown>
  settingProposals(signal: AbortSignal): Promise<SettingProposal[]>
  decideSetting(id: string, allow: boolean): Promise<string>
  settings(signal: AbortSignal): Promise<DotSettings>
}

const LocaleContext = createContext<CopyLocale>('zh')

const FOLLOW = ''
const keyOf = (choice: { provider: string; model: string }) => JSON.stringify([choice.provider, choice.model])
/** Entry of the task model list; the host side builds the same key (task-models.ts). */
const taskModelKey = (choice: { provider: string; model: string }) => `${choice.provider}/${choice.model}`

function useModels(api: SettingsApi): { choices?: ModelMenuChoice[]; failed: boolean } {
  const [state, setState] = useState<{ choices?: ModelMenuChoice[]; failed: boolean }>({ failed: false })
  useEffect(() => {
    let live = true
    api.models().then(
      value => { if (live) setState({ choices: parseModelMenuChoices(value), failed: false }) },
      () => { if (live) setState({ failed: true }) },
    )
    return () => { live = false }
  }, [api])
  return state
}

function PadlockGlyph({ locked }: { locked: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3.25" y="7.25" width="9.5" height="6.5" rx="1.6" stroke="currentColor" strokeWidth="1.25" />
      {locked
        ? <path d="M5.25 7.25V5.2a2.75 2.75 0 0 1 5.5 0v2.05" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        : <path d="M5.25 7.25V5.1a2.75 2.75 0 0 1 5.15-1.35" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />}
    </svg>
  )
}

/** Subtle monochrome lock toggle: quiet icon while unlocked, visible badge once locked. */
export function LockToggle({ locale, label, locked, onLock }: { locale: CopyLocale; label: string; locked: boolean; onLock: (locked: boolean) => void }) {
  return (
    <button
      type="button"
      className="dsh-dot-lock"
      data-locked={locked ? '' : undefined}
      aria-label={t(locale, locked ? 'sUnlock' : 'sLock').replace('{field}', label)}
      title={t(locale, locked ? 'sLockTip' : 'sUnlockTip')}
      aria-pressed={locked}
      onClick={() => onLock(!locked)}
    >
      <PadlockGlyph locked={locked} />
      {locked ? <span className="dsh-dot-lock-badge">{t(locale, 'sLockedBadge')}</span> : null}
    </button>
  )
}

function Field({ label, help, helpTone, trailing, children, locked, onLock }: { label: string; help?: string | undefined; helpTone?: 'warn' | undefined; trailing?: ReactNode; children: ReactNode; locked?: boolean; onLock?: (locked: boolean) => void }) {
  const locale = useContext(LocaleContext)
  return (
    <div className="dsh-ui-field">
      <div className="dsh-dot-setting-head">
        <span className="dsh-ui-label">{label}</span>
        <div className="dsh-dot-setting-tools">
          {trailing}
          {onLock ? <LockToggle locale={locale} label={label} locked={locked === true} onLock={onLock} /> : null}
        </div>
      </div>
      {children}
      {help ? <span className={helpTone === 'warn' ? 'dsh-ui-help dsh-ui-warn' : 'dsh-ui-help'}>{help}</span> : null}
    </div>
  )
}

function formatProposalValue(locale: CopyLocale, field: SettingField, value: unknown, choices: readonly ModelMenuChoice[]): { text: string; block: boolean } {
  if (value === null || value === undefined || value === '') {
    return { text: field === 'model' ? t(locale, 'sModelFollow') : t(locale, 'sProposalDefault'), block: false }
  }
  switch (field) {
    case 'model': {
      const route = value as Partial<ModelChoice>
      if (typeof route.provider === 'string' && typeof route.model === 'string') {
        const hit = choices.find(item => item.provider === route.provider && item.model === route.model)
        return { text: hit?.label ?? `${route.provider} / ${route.model}`, block: false }
      }
      break
    }
    case 'scope':
      if (value === 'all' || value === 'tracked') return { text: t(locale, `sScope_${value}`), block: false }
      break
    case 'approvals':
      if (value === 'dot' || value === 'human' || value === 'deny' || value === 'allow') return { text: t(locale, `sApprovals_${value}`), block: false }
      break
    case 'questions':
      if (value === 'dot' || value === 'human' || value === 'off') return { text: t(locale, `sQuestions_${value}`), block: false }
      break
    case 'taskModels': {
      const rule = value as Partial<TaskModelRule>
      if (rule.mode === 'all') return { text: t(locale, 'sTaskModels_all'), block: false }
      if (rule.mode === 'allow' || rule.mode === 'deny') {
        const names = (rule.list ?? []).map(key => choices.find(item => taskModelKey(item) === key)?.label ?? key)
        const prefix = t(locale, `sTaskModels_${rule.mode}`)
        const joined = names.length > 0 ? `${prefix}：${names.join(', ')}` : `${prefix}（${t(locale, 'sProposalDefault')}）`
        return { text: joined, block: joined.length > 56 }
      }
      break
    }
    default:
      break
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return { text, block: field !== 'address' && (text.includes('\n') || text.length > 56) }
}

function Proposals({ locale, api, choices, refresh, onDecided, onCountChange }: { locale: CopyLocale; api: SettingsApi; choices: readonly ModelMenuChoice[]; refresh: number; onDecided: () => void; onCountChange?: (count: number) => void }) {
  const [rows, setRows] = useState<SettingProposal[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    const life = new AbortController()
    const load = () => api.settingProposals(life.signal).then(
      next => { setRows(next); onCountChange?.(next.length); setError('') },
      failure => { if (!life.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)) },
    )
    void load()
    const timer = setInterval(load, 5000)
    return () => { life.abort(); clearInterval(timer) }
  }, [api, refresh, onCountChange])
  const decide = (id: string, allow: boolean) => {
    setError('')
    api.decideSetting(id, allow).then(() => {
      setRows(current => {
        const next = current.filter(row => row.id !== id)
        onCountChange?.(next.length)
        return next
      })
      onDecided()
    }, failure => setError(failure instanceof Error ? failure.message : String(failure)))
  }
  if (rows.length === 0 && !error) return null
  return (
    <div className="dsh-dot-pane-section">
      <h3 className="dsh-dot-pane-section-title">{t(locale, 'sProposals')}</h3>
      {error ? <div className="dsh-ui-error" role="alert">{error}</div> : null}
      <div className="dsh-dot-proposals">
        {rows.map(row => {
          const before = formatProposalValue(locale, row.field, row.before, choices)
          const after = formatProposalValue(locale, row.field, row.after, choices)
          const block = before.block || after.block
          return (
            <section className="dsh-dot-proposal" key={row.id}>
              <div className="dsh-dot-proposal-head">
                <strong>{t(locale, `field_${row.field}` as TextKey)}</strong>
              </div>
              <p className="dsh-dot-proposal-reason">{row.reason}</p>
              {block ? (
                <div className="dsh-dot-proposal-blocks">
                  <div><span>{t(locale, 'sProposalBefore')}</span><pre>{before.text}</pre></div>
                  <div><span>{t(locale, 'sProposalAfter')}</span><pre>{after.text}</pre></div>
                </div>
              ) : (
                <div className="dsh-dot-proposal-inline">
                  <span className="dsh-dot-proposal-chip" title={t(locale, 'sProposalBefore')}>{before.text}</span>
                  <span className="dsh-dot-proposal-arrow" aria-hidden="true">→</span>
                  <span className="dsh-dot-proposal-chip dsh-dot-proposal-chip--next" title={t(locale, 'sProposalAfter')}>{after.text}</span>
                </div>
              )}
              <div className="dsh-ui-actions">
                <Button variant="primary" size="sm" onClick={() => decide(row.id, true)}>{t(locale, 'sApprove')}</Button>
                <Button variant="ghost" size="sm" onClick={() => decide(row.id, false)}>{t(locale, 'sDecline')}</Button>
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function SegmentedChoice<T extends string>({ locale, label, value, options, labelKeyOf, onChange }: {
  locale: CopyLocale
  label: string
  value: T
  options: readonly [T, ...T[]]
  labelKeyOf: (option: T) => TextKey
  onChange: (next: T) => void
}) {
  const baseId = useId()
  const items = useMemo(() => options.map(option => ({
    id: `${baseId}-${option}`,
    panelId: `${baseId}-${option}-panel`,
    value: option,
    label: t(locale, labelKeyOf(option)),
  })) as unknown as readonly [SegmentedTab<T>, ...SegmentedTab<T>[]], [baseId, locale, options, labelKeyOf])
  return (
    <SegmentedTabs<T>
      size="sm"
      label={label}
      items={items}
      value={value}
      onChange={next => { if (next !== value) onChange(next) }}
    />
  )
}

/** A text field that saves when it loses focus, and only when it changed. */
function useDraft(saved: string, save: (text: string) => void): { value: string; dirty: boolean; onChange: (text: string) => void; onBlur: () => void } {
  const [value, setValue] = useState(saved)
  useEffect(() => { setValue(saved) }, [saved])
  const commit = () => { if (value !== saved) save(value) }
  return { value, dirty: value !== saved, onChange: setValue, onBlur: commit }
}

export function SettingsPanel({ locale, api, settings, onSaved, onStatusChange, onProposalCount }: {
  locale: CopyLocale
  api: SettingsApi
  settings?: DotSettings
  onSaved: (next: DotSettings) => void
  onStatusChange?: (status: SaveNotice | undefined) => void
  onProposalCount?: (count: number) => void
}) {
  const models = useModels(api)
  const [status, setStatus] = useState<SaveNotice>()
  const [modelFilter, setModelFilter] = useState('')
  const reportStatus = useCallback((next: SaveNotice | undefined) => {
    setStatus(next)
    onStatusChange?.(next)
  }, [onStatusChange])
  const save = useCallback((patch: SettingsPatch) => {
    reportStatus(undefined)
    api.setSettings(patch).then(
      next => { onSaved(next); reportStatus({ kind: 'saved' }) },
      failure => reportStatus({ kind: 'error', message: failure instanceof Error ? failure.message : String(failure) }),
    )
  }, [api, onSaved, reportStatus])
  const policy = useDraft(settings?.policy ?? '', text => save({ policy: text }))
  const [proposalRefresh, setProposalRefresh] = useState(0)
  const decided = useCallback(() => {
    setProposalRefresh(value => value + 1)
    api.settings(new AbortController().signal).then(onSaved, () => {})
  }, [api, onSaved])

  if (!settings) return <div className="dsh-ui-loading">{t(locale, 'settingsLoading')}</div>

  const chosen = settings.model
  const choices = [...models.choices ?? []]
  if (chosen && !choices.some(choice => choice.provider === chosen.provider && choice.model === chosen.model)) {
    choices.push({ provider: chosen.provider, model: chosen.model, label: `${chosen.provider} / ${chosen.model}`, efforts: [] })
  }
  const modelGroups = groupModelMenuChoices(choices, '')
  const pickModel = (key: string) => {
    if (key === FOLLOW) { save({ model: null }); return }
    const choice = choices.find(item => keyOf(item) === key)
    if (choice) save({ model: { provider: choice.provider, model: choice.model } })
  }
  const approvalModes: readonly [ApprovalMode, ApprovalMode, ApprovalMode, ApprovalMode] = ['dot', 'human', 'deny', 'allow']
  const questionModes: readonly [TakeoverMode, TakeoverMode, TakeoverMode] = ['dot', 'human', 'off']
  const lock = (field: SettingField) => ({ locked: settings?.locks?.[field] === true, onLock: (locked: boolean) => save({ locks: { ...settings?.locks, [field]: locked } }) })

  // Models dot may start tasks on: provider-grouped catalog choices, followed by listed entries the catalog no longer has.
  const rule = settings.taskModels
  const catalogChoices = models.choices ?? []
  const catalogKeys = new Set((models.choices ?? []).map(taskModelKey))
  const filteredGroups = groupModelMenuChoices(catalogChoices, modelFilter)
  const needle = modelFilter.trim().toLowerCase()
  const staleKeys = rule.list.filter(key => !catalogKeys.has(key) && (!needle || key.toLowerCase().includes(needle)))
  const toggleTaskModel = (key: string, checked: boolean) => {
    const list = checked ? [...rule.list.filter(item => item !== key), key] : rule.list.filter(item => item !== key)
    save({ taskModels: { mode: rule.mode, list } })
  }
  const emptyAllowList = rule.mode === 'allow' && rule.list.length === 0
  const modelHelp = models.failed ? t(locale, 'sModelFailed')
    : models.choices ? undefined
    : t(locale, 'sModelLoading')
  const taskModelsHelp = rule.mode !== 'all' && models.failed ? t(locale, 'sModelFailed')
    : emptyAllowList ? t(locale, 'sTaskModelsEmpty')
    : undefined
  const approvalHelp = settings.approvals === 'dot' ? t(locale, 'sApprovalsDesc_dot')
    : settings.approvals === 'allow' ? t(locale, 'sApprovalsDesc_allow')
    : undefined
  const policyActive = settings.approvals === 'dot' || settings.questions === 'dot'

  return (
    <LocaleContext.Provider value={locale}><div className="dsh-dot-pane dsh-dot-settings-pane">
      {!onStatusChange && status?.kind === 'saved' ? <div className="dsh-ui-notice" role="status">{t(locale, 'saved')}</div> : null}
      {!onStatusChange && status?.kind === 'error' ? <div className="dsh-ui-error" role="alert">{t(locale, 'saveFailed')}{status.message}</div> : null}
      <Proposals locale={locale} api={api} choices={choices} refresh={proposalRefresh} onDecided={decided} {...onProposalCount ? { onCountChange: onProposalCount } : {}} />
      <div className="dsh-dot-pane-section">
        <div className="dsh-ui-form">
        <Field label={t(locale, 'sModel')} help={modelHelp} helpTone={models.failed ? 'warn' : undefined} {...lock('model')}>
          <select className="dsh-ui-select" aria-label={t(locale, 'sModel')} value={chosen ? keyOf(chosen) : FOLLOW} onChange={event => pickModel(event.target.value)}>
            <option value={FOLLOW}>{t(locale, 'sModelFollow')}</option>
            {modelGroups.map(group => (
              <optgroup key={group.provider} label={group.name}>
                {group.items.map(choice => <option key={keyOf(choice)} value={keyOf(choice)}>{choice.label}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>
        </div>
      </div>
      <div className="dsh-dot-pane-section">
        <h3 className="dsh-dot-pane-section-title">{t(locale, 'sRequests')}</h3>
        <div className="dsh-ui-form">
        <Field label={t(locale, 'sScope')} {...lock('scope')}>
          <SegmentedChoice locale={locale} label={t(locale, 'sScope')} value={settings.scope} options={['all', 'tracked']} labelKeyOf={opt => `sScope_${opt}`} onChange={next => save({ scope: next })} />
        </Field>
        <Field label={t(locale, 'sApprovals')} help={approvalHelp} {...lock('approvals')}>
          <SegmentedChoice locale={locale} label={t(locale, 'sApprovals')} value={settings.approvals} options={approvalModes} labelKeyOf={opt => `sApprovals_${opt}`} onChange={next => save({ approvals: next })} />
        </Field>
        <Field label={t(locale, 'sQuestions')} help={settings.questions === 'dot' ? t(locale, 'sQuestionsDesc_dot') : undefined} {...lock('questions')}>
          <SegmentedChoice locale={locale} label={t(locale, 'sQuestions')} value={settings.questions} options={questionModes} labelKeyOf={opt => `sQuestions_${opt}`} onChange={next => save({ questions: next })} />
        </Field>
        <Field
          label={t(locale, 'sPolicy')}
          help={policyActive ? undefined : t(locale, 'sPolicyInactiveHelp')}
          trailing={policy.dirty ? <span className="dsh-ui-hint">{t(locale, 'sDraftUnsaved')}</span> : null}
          {...lock('policy')}
        >
          <textarea className="dsh-ui-textarea" aria-label={t(locale, 'sPolicy')} rows={3} maxLength={2000} placeholder={t(locale, 'sPolicyPlaceholder')} value={policy.value} onChange={event => policy.onChange(event.target.value)} onBlur={policy.onBlur} />
        </Field>
        </div>
      </div>
      <div className="dsh-dot-pane-section">
        <h3 className="dsh-dot-pane-section-title">{t(locale, 'sTasks')}</h3>
        <div className="dsh-ui-form">
        <Field label={t(locale, 'sTaskModels')} help={taskModelsHelp} helpTone={taskModelsHelp ? 'warn' : undefined} {...lock('taskModels')}>
          <SegmentedChoice locale={locale} label={t(locale, 'sTaskModels')} value={rule.mode} options={['all', 'allow', 'deny']} labelKeyOf={opt => `sTaskModels_${opt}`} onChange={next => save({ taskModels: { mode: next, list: rule.list } })} />
          {rule.mode === 'all' ? null : (
            <div className="dsh-dot-model-picker" role="group" aria-label={t(locale, `sTaskModels_${rule.mode}`)}>
              <div className="dsh-dot-model-toolbar">
                <Input
                  className="dsh-dot-model-search"
                  icon={<IconSearchOutlineRegular size={13} />}
                  type="search"
                  aria-label={t(locale, 'sTaskModelsFilter')}
                  placeholder={t(locale, 'sTaskModelsFilter')}
                  value={modelFilter}
                  onChange={event => setModelFilter(event.target.value)}
                />
                <span className="dsh-ui-meta">{t(locale, 'sTaskModelsSelected').replace('{n}', String(rule.list.length))}</span>
                {rule.list.length > 0 ? (
                  <Button variant="ghost" size="sm" onClick={() => save({ taskModels: { mode: rule.mode, list: [] } })}>{t(locale, 'sTaskModelsClear')}</Button>
                ) : null}
              </div>
              <div className="dsh-dot-model-list">
                {filteredGroups.length === 0 && staleKeys.length === 0 ? (
                  <div className="dsh-dot-model-empty">{catalogChoices.length === 0 && !models.failed ? t(locale, 'sModelLoading') : t(locale, 'sTaskModelsNoMatch')}</div>
                ) : null}
                {filteredGroups.map(group => (
                  <div className="dsh-dot-model-group" key={group.provider}>
                    <div className="dsh-dot-model-group-title">{group.name}</div>
                    {group.items.map(choice => {
                      const key = taskModelKey(choice)
                      return (
                        <Checkbox
                          key={key}
                          className="dsh-dot-model-item"
                          checked={rule.list.includes(key)}
                          label={modelMenuShortName(choice)}
                          title={choice.label}
                          onChange={checked => toggleTaskModel(key, checked)}
                        />
                      )
                    })}
                  </div>
                ))}
                {staleKeys.length > 0 ? (
                  <div className="dsh-dot-model-group">
                    <div className="dsh-dot-model-group-title">{t(locale, 'sTaskModelsStaleGroup')}</div>
                    {staleKeys.map(key => (
                      <Checkbox
                        key={key}
                        className="dsh-dot-model-item"
                        checked={rule.list.includes(key)}
                        label={`${key} ${t(locale, 'sTaskModelsGone')}`}
                        onChange={checked => toggleTaskModel(key, checked)}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </Field>
        </div>
      </div>
    </div></LocaleContext.Provider>
  )
}

// Selectors spell the root out (.dsh-dot-chat = CHAT_ROOT) so the repository scope check can read them.
export const settingsCss = `
.dsh-dot-chat .dsh-dot-setting-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 22px; }
.dsh-dot-chat .dsh-dot-setting-tools { display: inline-flex; align-items: center; gap: 8px; flex-shrink: 0; }
.dsh-dot-chat .dsh-dot-lock {
  display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; white-space: nowrap; height: 22px; padding: 0 5px;
  border: 0; border-radius: var(--dsw-radius-sm); background: transparent;
  color: var(--dsw-alias-label-tertiary); opacity: 0.55; font: inherit; font-size: 11px; line-height: 16px; cursor: pointer;
  transition: opacity var(--ds-transition-duration, 0.2s) var(--ds-ease-in-out, ease-in-out), background-color var(--ds-transition-duration, 0.2s) var(--ds-ease-in-out, ease-in-out), color var(--ds-transition-duration, 0.2s) var(--ds-ease-in-out, ease-in-out);
}
.dsh-dot-chat .dsh-dot-lock:hover,
.dsh-dot-chat .dsh-dot-lock:focus-visible { opacity: 1; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-dot-chat .dsh-dot-lock[data-locked] { opacity: 1; padding: 0 7px; background: var(--dsw-alias-interactive-bg-active); color: var(--dsw-alias-state-warn-primary); }
.dsh-dot-chat .dsh-dot-lock-badge { font-size: 11px; line-height: 16px; font-weight: 500; }
.dsh-dot-chat .dsh-dot-proposals { display: flex; flex-direction: column; gap: 10px; }
.dsh-dot-chat .dsh-dot-proposal {
  display: flex; flex-direction: column; gap: 8px; padding: 12px 14px;
  border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); box-shadow: var(--dsw-elevation-stroke);
}
.dsh-dot-chat .dsh-dot-proposal-head { display: flex; align-items: center; gap: 6px; font-size: 13px; line-height: 20px; }
.dsh-dot-chat .dsh-dot-proposal-reason { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dsh-dot-chat .dsh-dot-proposal-inline { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; font-size: 12px; line-height: 18px; }
.dsh-dot-chat .dsh-dot-proposal-chip { padding: 2px 8px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.dsh-dot-chat .dsh-dot-proposal-chip--next { color: var(--dsw-alias-label-primary); font-weight: 500; border: 0.5px solid var(--dsw-alias-border-l2); }
.dsh-dot-chat .dsh-dot-proposal-arrow { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.dsh-dot-chat .dsh-dot-proposal-blocks { display: grid; gap: 8px; }
.dsh-dot-chat .dsh-dot-proposal-blocks > div { display: flex; flex-direction: column; gap: 4px; }
.dsh-dot-chat .dsh-dot-proposal-blocks > div > span { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }
.dsh-dot-chat .dsh-dot-proposal-blocks pre {
  margin: 0; max-height: 160px; overflow: auto; padding: 8px 10px; white-space: pre-wrap; overflow-wrap: anywhere;
  background: var(--dsw-alias-bg-layer-2); border-radius: var(--dsw-radius-sm); font: 12px/18px var(--ds-font-family-code); color: var(--dsw-alias-label-primary);
}
.dsh-dot-chat .dsh-dot-model-picker {
  display: flex; flex-direction: column; gap: 8px; margin-top: 4px; padding: 10px;
  border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); box-shadow: var(--dsw-elevation-stroke);
}
.dsh-dot-chat .dsh-dot-model-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsh-dot-chat .dsh-dot-model-toolbar > button { flex-shrink: 0; white-space: nowrap; }
.dsh-dot-chat .dsh-dot-model-search { flex: 1 1 160px; min-width: 0; height: 28px; }
.dsh-dot-chat .dsh-dot-model-list { display: flex; flex-direction: column; gap: 8px; max-height: 220px; overflow-y: auto; padding: 2px; }
.dsh-dot-chat .dsh-dot-model-empty { padding: 12px 8px; text-align: center; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.dsh-dot-chat .dsh-dot-model-group { display: flex; flex-direction: column; gap: 2px; }
.dsh-dot-chat .dsh-dot-model-group-title { padding: 4px 6px 2px; font-size: 11px; line-height: 16px; font-weight: 600; color: var(--dsw-alias-label-tertiary); }
.dsh-dot-chat .dsh-dot-model-item { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: var(--dsw-radius-sm); font-size: 13px; line-height: 20px; cursor: pointer; }
.dsh-dot-chat .dsh-dot-model-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
`
