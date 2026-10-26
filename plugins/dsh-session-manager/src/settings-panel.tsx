import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { Button, Input, SegmentedTabs, Switch, IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { modelRouteKey, parseModelRouteKey, parseModelMenuChoices } from '@klarkxy/dsh-model-route'
import { ModelMenu, ModelCatalogStatus, useModelCatalog } from '@klarkxy/dsh-model-route/ui'
import { DEFAULT_COMPACT_MINUTES, DEFAULT_RECAP_MINUTES, type ConfigView } from './contracts.ts'
import type { PresenceConfigModel } from './presence-model.ts'
import { FREE_CHAT_ROOT } from './styles.ts'
import { failureText, uiText, type CopyLocale } from './ui-copy.ts'

interface DraftState {
  recapEnabled: boolean
  recapMinutes: string
  compactEnabled: boolean
  compactMinutes: string
  continueText: string
  continueMode: 'fixed' | 'auto'
  /** '' follows the conversation / host default. */
  model: string
  /** '' follows the conversation / host default for the ghost. */
  ghostModel: string
}

function toDraft(values: ConfigView): DraftState {
  const recapEnabled = values.recapMinutes > 0
  const compactEnabled = values.compactMinutes > 0
  return {
    recapEnabled,
    recapMinutes: String(recapEnabled ? values.recapMinutes : DEFAULT_RECAP_MINUTES),
    compactEnabled,
    compactMinutes: String(compactEnabled ? values.compactMinutes : DEFAULT_COMPACT_MINUTES),
    continueText: values.continueText,
    continueMode: values.continueMode,
    model: values.model === null ? '' : modelRouteKey(values.model.provider, values.model.model),
    ghostModel: values.ghostModel === null ? '' : modelRouteKey(values.ghostModel.provider, values.ghostModel.model),
  }
}

/** Enabled thresholds are whole minutes of at least 1. 0 stays the stored "off" value and is not a valid enabled draft. */
function minutesOf(text: string): number | undefined {
  if (!/^[1-9]\d*$/.test(text.trim())) return undefined
  const value = Number.parseInt(text.trim(), 10)
  return Number.isSafeInteger(value) && value >= 1 ? value : undefined
}

function sameDraft(left: DraftState, right: DraftState): boolean {
  return left.recapEnabled === right.recapEnabled
    && left.recapMinutes === right.recapMinutes
    && left.compactEnabled === right.compactEnabled
    && left.compactMinutes === right.compactMinutes
    && left.continueText === right.continueText
    && left.continueMode === right.continueMode
    && left.model === right.model
    && left.ghostModel === right.ghostModel
}

const missingCatalog = async (): Promise<unknown> => { throw new Error('Model catalog service unavailable') }

/** The bundle config page: edits the cordis plugin config through the host config editor. */
export function SessionManagerSettings(props: {
  model: PresenceConfigModel
  locale: CopyLocale
  modelCatalog?: () => Promise<unknown>
  subscribeCatalog?: (onChange: () => void) => (() => void) | undefined
  subscribeSettings?: (onChange: () => void, onError?: (message: string) => void) => () => void
}): React.ReactElement {
  const snapshot = useSyncExternalStore(props.model.subscribe, props.model.getSnapshot, props.model.getSnapshot)
  const [draft, setDraft] = useState<DraftState | undefined>(undefined)
  const catalog = useModelCatalog(props.modelCatalog ?? missingCatalog, { subscribe: props.subscribeCatalog })
  const [menuOpen, setMenuOpen] = useState(false)
  const [ghostMenuOpen, setGhostMenuOpen] = useState(false)
  const [externalChange, setExternalChange] = useState(false)
  const dirty = useRef(false)
  const baseline = useRef<DraftState>()
  const tabsId = useId()
  const copy = (key: Parameters<typeof uiText>[1]) => uiText(props.locale, key)
  const edit = (next: DraftState) => {
    dirty.current = true
    setDraft(next)
  }
  useEffect(() => {
    if (snapshot.phase === 'loading') void props.model.load()
  }, [props.model, snapshot.phase])
  useEffect(() => {
    if (snapshot.values === undefined) return
    const next = toDraft(snapshot.values)
    setDraft(current => {
      // An external write must not wipe an unsaved draft. The notice stays
      // until the draft matches the reloaded values again.
      if (dirty.current && (current === undefined || !sameDraft(current, next))) return current
      dirty.current = false
      baseline.current = next
      return next
    })
    setExternalChange(dirty.current)
  }, [snapshot.values])
  // Re-read whenever the Model Hub reports a write from another settings page.
  useEffect(() => props.subscribeSettings?.(() => {
    void props.model.load()
    void catalog.refresh()
  }) ?? (() => {}), [props.model, props.subscribeSettings, catalog.refresh])

  if (snapshot.phase === 'loading') {
    return <p className={`${FREE_CHAT_ROOT} dsh-ui-loading`}>{copy('settingsLoading')}</p>
  }
  if (snapshot.phase === 'unavailable' || draft === undefined) {
    return (
      <p className={`${FREE_CHAT_ROOT} dsh-ui-error`} role="alert">
        {snapshot.failure ? failureText(props.locale, snapshot.failure) : copy('settingsUnavailable')}
      </p>
    )
  }
  // Keep the draft route visible through catalog refreshes and partial outages.
  const selectedRoute = parseModelRouteKey(draft.model)
  const ghostRoute = parseModelRouteKey(draft.ghostModel)
  const selectableChoices = parseModelMenuChoices(catalog.catalog, selectedRoute ?? ghostRoute)
  const selectedLabel = selectableChoices.find(choice => modelRouteKey(choice.provider, choice.model) === draft.model)?.label
    ?? copy('modelFollowOption')
  const ghostLabel = selectableChoices.find(choice => modelRouteKey(choice.provider, choice.model) === draft.ghostModel)?.label
    ?? copy('modelFollowOption')
  const recapMinutes = draft.recapEnabled ? minutesOf(draft.recapMinutes) : 0
  const compactMinutes = draft.compactEnabled ? minutesOf(draft.compactMinutes) : 0
  const recapInvalid = recapMinutes === undefined
  const compactInvalid = compactMinutes === undefined
  const invalid = recapInvalid || compactInvalid
  const fixedPanelId = `${tabsId}-fixed-panel`
  const autoPanelId = `${tabsId}-auto-panel`
  const save = () => {
    if (invalid) return
    const route = parseModelRouteKey(draft.model)
    const ghost = parseModelRouteKey(draft.ghostModel)
    // Keep the draft protected until the confirmed snapshot matches it.
    // A rejected save or an in-flight settings notification must not discard it.
    setExternalChange(false)
    void props.model.save({
      recapMinutes,
      compactMinutes,
      continueText: draft.continueText,
      continueMode: draft.continueMode,
      // An untouched selector must not replace a route carrying an effort.
      // A different model deliberately starts without the old model's effort.
      ...draft.model === baseline.current?.model ? {} : {
        model: route === undefined ? null : { provider: route.provider, model: route.model },
      },
      ...draft.ghostModel === baseline.current?.ghostModel ? {} : {
        ghostModel: ghost === undefined ? null : { provider: ghost.provider, model: ghost.model },
      },
    })
  }
  return (
    <div className={`${FREE_CHAT_ROOT} dsh-ui-page`}>
      <div className="dsm-settings">
        <section className="dsm-setting" aria-labelledby={`${tabsId}-ghost-heading`}>
          <header className="dsm-setting-header">
            <h3 id={`${tabsId}-ghost-heading`} className="dsh-ui-title">{copy('settingsMode')}</h3>
            <p className="dsh-ui-hint">{copy('settingsModeHint')}</p>
          </header>
          <div className="dsm-ghost-controls">
            <div className="dsh-ui-field">
              <span className="dsh-ui-label">{copy('continueSourceLabel')}</span>
              <SegmentedTabs<'fixed' | 'auto'>
                label={copy('continueSourceLabel')}
                items={[
                  { id: `${tabsId}-fixed`, panelId: fixedPanelId, value: 'fixed', label: copy('modeFixed') },
                  { id: `${tabsId}-auto`, panelId: autoPanelId, value: 'auto', label: copy('modeAuto') },
                ]}
                value={draft.continueMode}
                onChange={value => edit({ ...draft, continueMode: value })}
              />
            </div>
            <div
              role="tabpanel"
              id={fixedPanelId}
              aria-labelledby={`${tabsId}-fixed`}
              hidden={draft.continueMode !== 'fixed'}
            >
              {draft.continueMode === 'fixed' ? (
                <label className="dsh-ui-field">
                  <span className="dsh-ui-label">{copy('continueTextLabel')}</span>
                  <Input
                    className="dsm-ghost-input"
                    value={draft.continueText}
                    placeholder={copy('continueTextPlaceholder')}
                    onChange={event => edit({ ...draft, continueText: event.target.value })}
                  />
                </label>
              ) : null}
            </div>
            <div
              role="tabpanel"
              id={autoPanelId}
              aria-labelledby={`${tabsId}-auto`}
              hidden={draft.continueMode !== 'auto'}
            >
              {draft.continueMode === 'auto' ? (
                <div className="dsh-ui-field dsm-model-field">
                  <span className="dsh-ui-label">{copy('ghostModelLabel')}</span>
                  <ModelMenu
                    locale={props.locale}
                    open={ghostMenuOpen}
                    onOpenChange={setGhostMenuOpen}
                    listClassName={FREE_CHAT_ROOT}
                    anchor={<button type="button" className="dsh-model-menu-trigger" aria-label={`${copy('ghostModelLabel')}: ${ghostLabel}`} aria-haspopup="menu" aria-expanded={ghostMenuOpen}>
                      <span className="dsh-model-menu-triggerLabel">{ghostLabel}</span>
                      <IconChevronDownOutlineRegular className={`dsh-model-menu-chevron${ghostMenuOpen ? ' dsh-model-menu-chevronOpen' : ''}`} />
                    </button>}
                    choices={selectableChoices}
                    selected={ghostRoute}
                    onPick={route => edit({ ...draft, ghostModel: modelRouteKey(route.provider, route.model) })}
                    leading={[{ id: 'follow', label: copy('modelFollowOption'), selected: !ghostRoute }]}
                    onPickLeading={() => edit({ ...draft, ghostModel: '' })}
                    modelValue={ghostLabel}
                  />
                </div>
              ) : null}
            </div>
          </div>
          {draft.continueMode === 'auto' ? <p className="dsh-ui-hint">{copy('ghostModelHint')}</p> : null}
        </section>
        <section className="dsm-setting" aria-labelledby={`${tabsId}-return-heading`}>
          <header className="dsm-setting-header">
            <h3 id={`${tabsId}-return-heading`} className="dsh-ui-title">{copy('welcomeBackGroup')}</h3>
          </header>
          <div className="dsm-feature">
            <div className="dsh-ui-toggle-row">
              <span className="dsh-ui-toggle-text">
                <span className="dsh-ui-toggle-label">{copy('recapEnabledLabel')}</span>
                <span className="dsh-ui-hint">{copy('recapEnabledHint')}</span>
              </span>
              <Switch
                label={copy('recapEnabledLabel')}
                checked={draft.recapEnabled}
                onChange={next => edit({ ...draft, recapEnabled: next })}
              />
            </div>
            <div className="dsm-feature-options" data-disabled={draft.recapEnabled ? undefined : 'true'}>
              <div className="dsh-ui-fields-grid">
                <div>
                  <label className="dsh-ui-field">
                    <span className="dsh-ui-label">{copy('recapMinutesLabel')}</span>
                    <span className="dsm-minutes-control">
                      <Input
                        className="dsm-minutes"
                        value={draft.recapMinutes}
                        inputMode="numeric"
                        disabled={!draft.recapEnabled}
                        aria-invalid={recapInvalid || undefined}
                        aria-describedby={recapInvalid ? `${tabsId}-recap-error` : undefined}
                        onChange={event => edit({ ...draft, recapMinutes: event.target.value })}
                      />
                      <span className="dsh-ui-meta">{copy('minutesUnit')}</span>
                    </span>
                  </label>
                  {recapInvalid ? <p id={`${tabsId}-recap-error`} className="dsh-ui-error" role="alert">{copy('minutesInvalid')}</p> : null}
                </div>
                <div className="dsh-ui-field dsm-model-field">
                  <span className="dsh-ui-label">{copy('modelLabel')}</span>
                  <ModelMenu
                    locale={props.locale}
                    open={menuOpen}
                    onOpenChange={setMenuOpen}
                    listClassName={FREE_CHAT_ROOT}
                    anchor={<button type="button" className="dsh-model-menu-trigger" disabled={!draft.recapEnabled} aria-label={`${copy('modelLabel')}: ${selectedLabel}`} aria-haspopup="menu" aria-expanded={menuOpen}>
                      <span className="dsh-model-menu-triggerLabel">{selectedLabel}</span>
                      <IconChevronDownOutlineRegular className={`dsh-model-menu-chevron${menuOpen ? ' dsh-model-menu-chevronOpen' : ''}`} />
                    </button>}
                    choices={selectableChoices}
                    selected={selectedRoute}
                    onPick={route => edit({ ...draft, model: modelRouteKey(route.provider, route.model) })}
                    leading={[{ id: 'follow', label: copy('modelFollowOption'), selected: !selectedRoute }]}
                    onPickLeading={() => edit({ ...draft, model: '' })}
                    modelValue={selectedLabel}
                  />
                </div>
              </div>
              <ModelCatalogStatus state={catalog} locale={props.locale} />
            </div>
          </div>
          <div className="dsm-feature">
            <div className="dsh-ui-toggle-row">
              <span className="dsh-ui-toggle-text">
                <span className="dsh-ui-toggle-label">{copy('compactEnabledLabel')}</span>
                <span className="dsh-ui-hint">{copy('compactEnabledHint')}</span>
              </span>
              <Switch
                label={copy('compactEnabledLabel')}
                checked={draft.compactEnabled}
                onChange={next => edit({ ...draft, compactEnabled: next })}
              />
            </div>
            <div className="dsm-feature-options dsm-compact-options" data-disabled={draft.compactEnabled ? undefined : 'true'}>
              <div>
                <label className="dsh-ui-field">
                  <span className="dsh-ui-label">{copy('compactMinutesLabel')}</span>
                  <span className="dsm-minutes-control">
                    <Input
                      className="dsm-minutes"
                      value={draft.compactMinutes}
                      inputMode="numeric"
                      disabled={!draft.compactEnabled}
                      aria-invalid={compactInvalid || undefined}
                      aria-describedby={compactInvalid ? `${tabsId}-compact-error` : undefined}
                      onChange={event => edit({ ...draft, compactMinutes: event.target.value })}
                    />
                    <span className="dsh-ui-meta">{copy('minutesUnit')}</span>
                  </span>
                </label>
                {compactInvalid ? <p id={`${tabsId}-compact-error`} className="dsh-ui-error" role="alert">{copy('minutesInvalid')}</p> : null}
              </div>
            </div>
          </div>
        </section>
      </div>
      <div className="dsh-ui-form-footer dsm-settings-footer">
        <Button variant="primary" disabled={invalid || snapshot.saving} onClick={save}>
          {snapshot.saving ? copy('settingsSaving') : copy('saveSettings')}
        </Button>
        {snapshot.saved ? <span className="dsh-ui-notice" role="status">{copy('settingsSaved')}</span> : null}
        {externalChange ? <span className="dsh-ui-notice dsh-ui-notice--error" role="alert">{copy('externalChange')}</span> : null}
        {snapshot.failure ? <span className="dsh-ui-notice dsh-ui-notice--error" role="alert">{failureText(props.locale, snapshot.failure)}</span> : null}
      </div>
    </div>
  )
}
