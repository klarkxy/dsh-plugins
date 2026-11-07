import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { Button, Input, SegmentedTabs, Switch, IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { modelRouteKey, parseModelRouteKey, parseModelMenuChoices } from '@klarkxy/dsh-model-route'
import { ModelMenu, ModelCatalogStatus, useModelCatalog } from '@klarkxy/dsh-model-route/ui'
import { DEFAULT_COMPACT_MINUTES, DEFAULT_RECAP_MINUTES, type AutoContinueMode, type ConfigView } from './contracts.ts'
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
  autoContinueMode: AutoContinueMode
  autoContinueMax: string
  /** '' follows the default auxiliary model. */
  model: string
  /** '' follows the default auxiliary model for the ghost. */
  ghostModel: string
  /** '' follows the default auxiliary model for the auto-continue judge. */
  judgeModel: string
  /** '' follows the default auxiliary model for read_session handoff summaries. */
  handoffModel: string
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
    autoContinueMode: values.autoContinueMode,
    autoContinueMax: String(values.autoContinueMax),
    model: values.model === null ? '' : modelRouteKey(values.model.provider, values.model.model),
    ghostModel: values.ghostModel === null ? '' : modelRouteKey(values.ghostModel.provider, values.ghostModel.model),
    judgeModel: values.judgeModel === null ? '' : modelRouteKey(values.judgeModel.provider, values.judgeModel.model),
    handoffModel: values.handoffModel === null ? '' : modelRouteKey(values.handoffModel.provider, values.handoffModel.model),
  }
}

/** Enabled thresholds are whole minutes of at least 1. 0 stays the stored "off" value and is not a valid enabled draft. */
function minutesOf(text: string): number | undefined {
  if (!/^[1-9]\d*$/.test(text.trim())) return undefined
  const value = Number.parseInt(text.trim(), 10)
  return Number.isSafeInteger(value) && value >= 1 ? value : undefined
}

/** Automatic continuations per human message: a whole number from 1 to 10. */
function autoMaxOf(text: string): number | undefined {
  if (!/^\d+$/.test(text.trim())) return undefined
  const value = Number.parseInt(text.trim(), 10)
  return Number.isSafeInteger(value) && value >= 1 && value <= 10 ? value : undefined
}

function sameDraft(left: DraftState, right: DraftState): boolean {
  return left.recapEnabled === right.recapEnabled
    && left.recapMinutes === right.recapMinutes
    && left.compactEnabled === right.compactEnabled
    && left.compactMinutes === right.compactMinutes
    && left.continueText === right.continueText
    && left.continueMode === right.continueMode
    && left.autoContinueMode === right.autoContinueMode
    && left.autoContinueMax === right.autoContinueMax
    && left.model === right.model
    && left.ghostModel === right.ghostModel
    && left.judgeModel === right.judgeModel
    && left.handoffModel === right.handoffModel
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
  const [judgeMenuOpen, setJudgeMenuOpen] = useState(false)
  const [handoffMenuOpen, setHandoffMenuOpen] = useState(false)
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
  // Keep every draft route visible through catalog refreshes and partial outages.
  const selectedRoute = parseModelRouteKey(draft.model)
  const ghostRoute = parseModelRouteKey(draft.ghostModel)
  const judgeRoute = parseModelRouteKey(draft.judgeModel)
  const handoffRoute = parseModelRouteKey(draft.handoffModel)
  const selectableChoices = parseModelMenuChoices(catalog.catalog)
  for (const bound of [selectedRoute, ghostRoute, judgeRoute, handoffRoute]) {
    if (bound && !selectableChoices.some(choice => choice.provider === bound.provider && choice.model === bound.model)) {
      selectableChoices.push({ provider: bound.provider, model: bound.model, label: `${bound.provider} / ${bound.model}`, efforts: [] })
    }
  }
  const routeLabel = (key: string) =>
    selectableChoices.find(choice => modelRouteKey(choice.provider, choice.model) === key)?.label ?? copy('modelFollowOption')
  const selectedLabel = routeLabel(draft.model)
  const ghostLabel = routeLabel(draft.ghostModel)
  const judgeLabel = routeLabel(draft.judgeModel)
  const handoffLabel = routeLabel(draft.handoffModel)
  const recapMinutes = draft.recapEnabled ? minutesOf(draft.recapMinutes) : 0
  const compactMinutes = draft.compactEnabled ? minutesOf(draft.compactMinutes) : 0
  const autoContinueMax = autoMaxOf(draft.autoContinueMax)
  const recapInvalid = recapMinutes === undefined
  const compactInvalid = compactMinutes === undefined
  const autoMaxInvalid = autoContinueMax === undefined
  const invalid = recapInvalid || compactInvalid || autoMaxInvalid
  const fixedPanelId = `${tabsId}-fixed-panel`
  const autoPanelId = `${tabsId}-auto-panel`
  const save = () => {
    if (invalid) return
    const routePatch = (key: 'model' | 'ghostModel' | 'judgeModel' | 'handoffModel') => {
      // An untouched selector must not replace a route carrying an effort.
      // A different model deliberately starts without the old model's effort.
      if (draft[key] === baseline.current?.[key]) return {}
      const parsed = parseModelRouteKey(draft[key])
      return { [key]: parsed === undefined ? null : { provider: parsed.provider, model: parsed.model } }
    }
    // Keep the draft protected until the confirmed snapshot matches it.
    // A rejected save or an in-flight settings notification must not discard it.
    setExternalChange(false)
    void props.model.save({
      recapMinutes,
      compactMinutes,
      continueText: draft.continueText,
      continueMode: draft.continueMode,
      autoContinueMode: draft.autoContinueMode,
      autoContinueMax: autoContinueMax!,
      ...routePatch('model'),
      ...routePatch('ghostModel'),
      ...routePatch('judgeModel'),
      ...routePatch('handoffModel'),
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
        <section className="dsm-setting" aria-labelledby={`${tabsId}-auto-continue-heading`}>
          <header className="dsm-setting-header">
            <h3 id={`${tabsId}-auto-continue-heading`} className="dsh-ui-title">{copy('autoContinueGroup')}</h3>
          </header>
          <div className="dsm-feature-options">
            <label className="dsh-ui-field">
              <span className="dsh-ui-label">{copy('autoContinueDefaultLabel')}</span>
              <select
                className="dsh-ui-select"
                value={draft.autoContinueMode}
                onChange={event => edit({ ...draft, autoContinueMode: event.target.value as AutoContinueMode })}
              >
                <option value="off">{copy('autoContinueOff')}</option>
                <option value="cautious">{copy('autoContinueCautious')}</option>
                <option value="bold">{copy('autoContinueBold')}</option>
              </select>
              <span className="dsh-ui-hint">{copy('autoContinueDefaultHint')}</span>
            </label>
            <div>
              <label className="dsh-ui-field">
                <span className="dsh-ui-label">{copy('autoContinueMaxLabel')}</span>
                <span className="dsm-minutes-control">
                  <Input
                    className="dsm-minutes"
                    value={draft.autoContinueMax}
                    inputMode="numeric"
                    aria-invalid={autoMaxInvalid || undefined}
                    aria-describedby={autoMaxInvalid ? `${tabsId}-auto-max-error` : undefined}
                    onChange={event => edit({ ...draft, autoContinueMax: event.target.value })}
                  />
                </span>
              </label>
              <p className="dsh-ui-hint">{copy('autoContinueMaxHint')}</p>
              {autoMaxInvalid ? <p id={`${tabsId}-auto-max-error`} className="dsh-ui-error" role="alert">{copy('autoContinueMaxInvalid')}</p> : null}
            </div>
            <div className="dsh-ui-field dsm-model-field">
              <span className="dsh-ui-label">{copy('judgeModelLabel')}</span>
              <ModelMenu
                locale={props.locale}
                open={judgeMenuOpen}
                onOpenChange={setJudgeMenuOpen}
                listClassName={FREE_CHAT_ROOT}
                anchor={<button type="button" className="dsh-model-menu-trigger" aria-label={`${copy('judgeModelLabel')}: ${judgeLabel}`} aria-haspopup="menu" aria-expanded={judgeMenuOpen}>
                  <span className="dsh-model-menu-triggerLabel">{judgeLabel}</span>
                  <IconChevronDownOutlineRegular className={`dsh-model-menu-chevron${judgeMenuOpen ? ' dsh-model-menu-chevronOpen' : ''}`} />
                </button>}
                choices={selectableChoices}
                selected={judgeRoute}
                onPick={route => edit({ ...draft, judgeModel: modelRouteKey(route.provider, route.model) })}
                leading={[{ id: 'follow', label: copy('modelFollowOption'), selected: !judgeRoute }]}
                onPickLeading={() => edit({ ...draft, judgeModel: '' })}
                modelValue={judgeLabel}
              />
              <span className="dsh-ui-hint">{copy('judgeModelHint')}</span>
            </div>
          </div>
        </section>
        <section className="dsm-setting" aria-labelledby={`${tabsId}-handoff-heading`}>
          <header className="dsm-setting-header">
            <h3 id={`${tabsId}-handoff-heading`} className="dsh-ui-title">{copy('handoffGroup')}</h3>
          </header>
          <div className="dsm-feature-options">
            <div className="dsh-ui-field dsm-model-field">
              <span className="dsh-ui-label">{copy('handoffModelLabel')}</span>
              <ModelMenu
                locale={props.locale}
                open={handoffMenuOpen}
                onOpenChange={setHandoffMenuOpen}
                listClassName={FREE_CHAT_ROOT}
                anchor={<button type="button" className="dsh-model-menu-trigger" aria-label={`${copy('handoffModelLabel')}: ${handoffLabel}`} aria-haspopup="menu" aria-expanded={handoffMenuOpen}>
                  <span className="dsh-model-menu-triggerLabel">{handoffLabel}</span>
                  <IconChevronDownOutlineRegular className={`dsh-model-menu-chevron${handoffMenuOpen ? ' dsh-model-menu-chevronOpen' : ''}`} />
                </button>}
                choices={selectableChoices}
                selected={handoffRoute}
                onPick={route => edit({ ...draft, handoffModel: modelRouteKey(route.provider, route.model) })}
                leading={[{ id: 'follow', label: copy('modelFollowOption'), selected: !handoffRoute }]}
                onPickLeading={() => edit({ ...draft, handoffModel: '' })}
                modelValue={handoffLabel}
              />
              <span className="dsh-ui-hint">{copy('handoffModelHint')}</span>
            </div>
          </div>
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
