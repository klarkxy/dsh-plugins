import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { Input, SegmentedTabs, Switch, IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { modelRouteKey, parseModelMenuChoices } from '@klarkxy/dsh-model-route'
import { ModelMenu, ModelCatalogStatus, useModelCatalog } from '@klarkxy/dsh-model-route/ui'
import { renderModelPicker, useModelMenuAnchor, type RenderFactorySlot } from '@klarkxy/dsh-plugin-kit/model-picker'
import { DEFAULT_COMPACT_MINUTES, DEFAULT_RECAP_MINUTES, type ConfigPatch, type ConfigView } from './contracts.ts'
import type { PresenceConfigModel, PresenceConfigSnapshot } from './presence-model.ts'
import { FREE_CHAT_ROOT } from './styles.ts'
import { failureText, uiText, type CopyLocale, type UiTextKey } from './ui-copy.ts'

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

const missingCatalog = async (): Promise<unknown> => { throw new Error('Model catalog service unavailable') }

interface RowProps {
  model: PresenceConfigModel
  locale: CopyLocale
}

function copy(locale: CopyLocale, key: UiTextKey): string {
  return uiText(locale, key)
}

/**
 * Sparse save-on-change writer shared by every row. Each patch holds only the
 * keys that changed, so an untouched model selector can never overwrite a
 * stored route's reasoningEffort. The single-flight model drops a second save
 * while one is in flight, so edits queue as one merged patch and flush when
 * the current save settles.
 */
interface PatchWriter {
  send(patch: ConfigPatch, row: symbol): void
  /** The row that issued the latest write; only that row shows the save status. */
  lastRow: symbol | undefined
}

// One queue per config model, shared by every row: a per-row queue would leave
// a patch stranded when another row's save holds the single-flight slot.
const writers = new WeakMap<PresenceConfigModel, PatchWriter>()

function writerFor(model: PresenceConfigModel): PatchWriter {
  let writer = writers.get(model)
  if (writer !== undefined) return writer
  let queue: ConfigPatch | undefined
  const flush = () => {
    if (queue === undefined || model.getSnapshot().saving) return
    const patch = queue
    queue = undefined
    void model.save(patch).finally(flush)
  }
  writer = {
    lastRow: undefined,
    send(patch, row) {
      writer!.lastRow = row
      queue = { ...queue, ...patch }
      flush()
    },
  }
  writers.set(model, writer)
  return writer
}

function useConfigPatch(model: PresenceConfigModel): { send: (patch: ConfigPatch) => void; owns: () => boolean } {
  const row = useRef(Symbol('row')).current
  const writer = writerFor(model)
  const send = useCallback((patch: ConfigPatch) => writer.send(patch, row), [writer, row])
  return { send, owns: () => writer.lastRow === row }
}

/**
 * One controlled text/number input bound to a stored string. The draft follows
 * external writes only while untouched — a focused, edited draft is never
 * wiped by a settings reload. The commit runs on blur and Enter: valid input
 * normalizes and saves when it differs; invalid input keeps the draft and its
 * inline error and is never written.
 */
function useTextSetting<T>(props: {
  stored: string
  parse: (draft: string) => { readonly value: T; readonly draft: string } | undefined
  send: (value: T) => void
}): {
  draft: string
  invalid: boolean
  inputProps: {
    value: string
    onChange: (event: { target: { value: string } }) => void
    onBlur: () => void
    onKeyDown: (event: { key: string }) => void
  }
} {
  const [draft, setDraft] = useState(props.stored)
  const seen = useRef(props.stored)
  const touched = useRef(false)
  useEffect(() => {
    if (props.stored === seen.current) return
    seen.current = props.stored
    // Follow the stored value while untouched, or once it caught up with the
    // draft (our own save confirmed); an edited, unsaved draft stays put.
    setDraft(current => {
      if (touched.current && current !== props.stored) return current
      touched.current = false
      return props.stored
    })
  }, [props.stored])
  const commit = useCallback(() => {
    const parsed = props.parse(draft)
    if (parsed === undefined) return
    setDraft(parsed.draft)
    // Normalizing may fold the draft back to the stored value ("015" -> 15);
    // only a real change writes.
    if (parsed.draft === seen.current) {
      touched.current = false
      return
    }
    props.send(parsed.value)
  }, [draft, props.parse, props.send])
  return {
    draft,
    invalid: props.parse(draft) === undefined,
    inputProps: {
      value: draft,
      onChange: event => {
        touched.current = true
        setDraft(event.target.value)
      },
      onBlur: commit,
      onKeyDown: event => { if (event.key === 'Enter') commit() },
    },
  }
}

/** Per-row write status: one line under the controls, only while it has something to say. */
function SaveStatus(props: { snapshot: PresenceConfigSnapshot; locale: CopyLocale; owns: () => boolean }): React.ReactElement | null {
  const { snapshot, locale } = props
  if (!props.owns()) return null
  if (snapshot.saving) return <p className="dsh-ui-notice" role="status">{copy(locale, 'settingsSaving')}</p>
  if (snapshot.failure) return <p className="dsh-ui-notice dsh-ui-notice--error" role="alert">{failureText(locale, snapshot.failure)}</p>
  if (snapshot.saved) return <p className="dsh-ui-notice" role="status">{copy(locale, 'settingsSaved')}</p>
  return null
}

/** Shared loading/unavailable body: every row reads the same config snapshot. */
function useRowGate(props: RowProps): { snapshot: PresenceConfigSnapshot; values?: ConfigView; gate?: React.ReactElement } {
  const snapshot = useSyncExternalStore(props.model.subscribe, props.model.getSnapshot, props.model.getSnapshot)
  useEffect(() => {
    if (snapshot.phase === 'loading') void props.model.load()
  }, [props.model, snapshot.phase])
  if (snapshot.phase === 'loading') {
    return { snapshot, gate: <p className="dsh-ui-loading">{copy(props.locale, 'settingsLoading')}</p> }
  }
  if (snapshot.phase === 'unavailable' || snapshot.values === undefined) {
    return {
      snapshot,
      gate: (
        <p className="dsh-ui-error" role="alert">
          {snapshot.failure ? failureText(props.locale, snapshot.failure) : copy(props.locale, 'settingsUnavailable')}
        </p>
      ),
    }
  }
  return { snapshot, values: snapshot.values }
}

/** 输入框建议 / Composer suggestion row. */
export function ComposerSettings(props: RowProps & CatalogProps): React.ReactElement {
  const { snapshot, values, gate } = useRowGate(props)
  const { send, owns } = useConfigPatch(props.model)
  const tabsId = useId()
  const field = useTextSetting<string>({
    stored: values?.continueText ?? '',
    parse: draft => ({ value: draft.trim(), draft: draft.trim() }),
    send: useCallback(value => send({ continueText: value }), [send]),
  })
  if (gate !== undefined || values === undefined) return gate ?? <></>
  const fixedPanelId = `${tabsId}-fixed-panel`
  const autoPanelId = `${tabsId}-auto-panel`
  return (
    <div className="dsm-settings">
      <div className="dsm-feature">
        <div className="dsh-ui-field">
          <span className="dsh-ui-label">{copy(props.locale, 'continueSourceLabel')}</span>
          <SegmentedTabs<'fixed' | 'auto'>
            label={copy(props.locale, 'continueSourceLabel')}
            items={[
              { id: `${tabsId}-fixed`, panelId: fixedPanelId, value: 'fixed', label: copy(props.locale, 'modeFixed') },
              { id: `${tabsId}-auto`, panelId: autoPanelId, value: 'auto', label: copy(props.locale, 'modeAuto') },
            ]}
            value={values.continueMode}
            onChange={value => { if (value !== values.continueMode) send({ continueMode: value }) }}
          />
        </div>
        <div
          role="tabpanel"
          id={fixedPanelId}
          aria-labelledby={`${tabsId}-fixed`}
          hidden={values.continueMode !== 'fixed'}
        >
          {values.continueMode === 'fixed' ? (
            <label className="dsh-ui-field">
              <span className="dsh-ui-label">{copy(props.locale, 'continueTextLabel')}</span>
              <Input
                className="dsm-text-input"
                placeholder={copy(props.locale, 'continueTextPlaceholder')}
                {...field.inputProps}
              />
            </label>
          ) : null}
        </div>
        <div
          role="tabpanel"
          id={autoPanelId}
          aria-labelledby={`${tabsId}-auto`}
          hidden={values.continueMode !== 'auto'}
        >
          {values.continueMode === 'auto'
            ? <ModelField {...props} field="ghostModel" labelKey="ghostModelLabel" route={values.ghostModel} send={send} />
            : null}
        </div>
        <p className="dsh-ui-hint">{copy(props.locale, 'composerUsageHint')}</p>
        <SaveStatus snapshot={snapshot} locale={props.locale} owns={owns} />
      </div>
    </div>
  )
}

/** 自动继续 / Auto-continue row. */
export function AutoContinueSettings(props: RowProps & CatalogProps): React.ReactElement {
  const { snapshot, values, gate } = useRowGate(props)
  const { send, owns } = useConfigPatch(props.model)
  const errorId = useId()
  const field = useTextSetting<number>({
    stored: String(values?.autoContinueMax ?? ''),
    parse: draft => {
      const value = autoMaxOf(draft)
      return value === undefined ? undefined : { value, draft: String(value) }
    },
    send: useCallback(value => send({ autoContinueMax: value }), [send]),
  })
  if (gate !== undefined || values === undefined) return gate ?? <></>
  return (
    <div className="dsm-settings">
      <div className="dsm-feature">
        <label className="dsh-ui-field">
          <span className="dsh-ui-label">{copy(props.locale, 'autoContinueMaxLabel')}</span>
          <Input
            className="dsm-minutes"
            inputMode="numeric"
            aria-invalid={field.invalid || undefined}
            aria-describedby={field.invalid ? `${errorId}-max-error` : undefined}
            {...field.inputProps}
          />
        </label>
        <p className="dsh-ui-hint">{copy(props.locale, 'autoContinueMaxHint')}</p>
        {field.invalid ? <p id={`${errorId}-max-error`} className="dsh-ui-error" role="alert">{copy(props.locale, 'autoContinueMaxInvalid')}</p> : null}
        <ModelField {...props} field="judgeModel" labelKey="judgeModelLabel" route={values.judgeModel} send={send} />
        <p className="dsh-ui-hint">{copy(props.locale, 'judgeModelHint')}</p>
        <p className="dsh-ui-hint">{copy(props.locale, 'autoContinueModeHint')}</p>
        <SaveStatus snapshot={snapshot} locale={props.locale} owns={owns} />
      </div>
    </div>
  )
}

/** One return-feature block: a switch row and its gated "away for N minutes" input. */
function ThresholdBlock(props: RowProps & {
  field: 'recapMinutes' | 'compactMinutes'
  titleKey: 'recapEnabledLabel' | 'compactEnabledLabel'
  hintKey: 'recapEnabledHint' | 'compactEnabledHint'
  minutes: number | undefined
  fallback: number
  send: (patch: ConfigPatch) => void
  /** Extra options that belong to this feature, gated with its switch. */
  extra?: (enabled: boolean) => React.ReactNode
}): React.ReactElement {
  const enabled = (props.minutes ?? 0) > 0
  const errorId = useId()
  const input = useTextSetting<number>({
    stored: String(enabled ? props.minutes : props.fallback),
    parse: draft => {
      const value = minutesOf(draft)
      return value === undefined ? undefined : { value, draft: String(value) }
    },
    send: useCallback(value => props.send({ [props.field]: value }), [props.send, props.field]),
  })
  const toggle = (next: boolean) => {
    if (next === enabled) return
    if (!next) {
      props.send({ [props.field]: 0 })
      return
    }
    // Enabling saves the shown draft when it is valid, else the feature's default.
    props.send({ [props.field]: minutesOf(input.draft) ?? props.fallback })
  }
  return (
    <div className="dsm-feature">
      <div className="dsh-ui-toggle-row">
        <span className="dsh-ui-toggle-text">
          <span className="dsh-ui-toggle-label">{copy(props.locale, props.titleKey)}</span>
          <span className="dsh-ui-hint">{copy(props.locale, props.hintKey)}</span>
        </span>
        <Switch
          label={copy(props.locale, props.titleKey)}
          checked={enabled}
          onChange={toggle}
        />
      </div>
      <div className="dsm-feature-options" data-disabled={enabled ? undefined : 'true'}>
        <label className="dsh-ui-field">
          <span className="dsm-minutes-control">
            <span className="dsh-ui-label">{copy(props.locale, 'awayMinutesLabel')}</span>
            <Input
              className="dsm-minutes"
              inputMode="numeric"
              disabled={!enabled}
              aria-label={`${copy(props.locale, 'awayMinutesLabel')} ${copy(props.locale, 'minutesUnit')}`}
              aria-invalid={enabled && input.invalid ? true : undefined}
              aria-describedby={enabled && input.invalid ? `${errorId}-minutes-error` : undefined}
              {...input.inputProps}
            />
            <span className="dsh-ui-meta">{copy(props.locale, 'minutesUnit')}</span>
          </span>
        </label>
        {enabled && input.invalid ? <p id={`${errorId}-minutes-error`} className="dsh-ui-error" role="alert">{copy(props.locale, 'minutesInvalid')}</p> : null}
        {props.extra?.(enabled)}
      </div>
    </div>
  )
}

/** 回到会话时 / When you return row. */
export function ReturnSettings(props: RowProps & CatalogProps): React.ReactElement {
  const { snapshot, values, gate } = useRowGate(props)
  const { send, owns } = useConfigPatch(props.model)
  if (gate !== undefined || values === undefined) return gate ?? <></>
  return (
    <div className="dsm-settings">
      <ThresholdBlock
        {...props}
        field="recapMinutes"
        titleKey="recapEnabledLabel"
        hintKey="recapEnabledHint"
        minutes={values.recapMinutes}
        fallback={DEFAULT_RECAP_MINUTES}
        send={send}
        extra={enabled => (
          <ModelField {...props} field="model" labelKey="recapModelLabel" route={values.model} send={send} disabled={!enabled} />
        )}
      />
      <ThresholdBlock
        {...props}
        field="compactMinutes"
        titleKey="compactEnabledLabel"
        hintKey="compactEnabledHint"
        minutes={values.compactMinutes}
        fallback={DEFAULT_COMPACT_MINUTES}
        send={send}
      />
      <SaveStatus snapshot={snapshot} locale={props.locale} owns={owns} />
    </div>
  )
}

type ModelField = 'model' | 'ghostModel' | 'judgeModel' | 'handoffModel'

/** Catalog wiring for the rows that carry a model picker. */
interface CatalogProps {
  modelCatalog?: () => Promise<unknown>
  subscribeCatalog?: (onChange: () => void) => (() => void) | undefined
  /** Framework-composed factory renderer; absent under direct test renders. */
  renderFactorySlot?: RenderFactorySlot
}

/**
 * One feature's model picker. The catalog loads with the row (first expand);
 * a stored route missing from the catalog stays selectable so a refresh or a
 * partial outage never hides the current choice.
 */
function ModelField(props: RowProps & CatalogProps & {
  field: ModelField
  labelKey: UiTextKey
  route: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string } | null
  send: (patch: ConfigPatch) => void
  disabled?: boolean
}): React.ReactElement {
  const catalog = useModelCatalog(props.modelCatalog ?? missingCatalog, { subscribe: props.subscribeCatalog })
  const [open, setOpen] = useState(false)
  const label = copy(props.locale, props.labelKey)
  const selected = props.route === null ? undefined : { provider: props.route.provider, model: props.route.model }
  const choices = parseModelMenuChoices(catalog.catalog)
  if (selected && !choices.some(choice => choice.provider === selected.provider && choice.model === selected.model)) {
    choices.push({ provider: selected.provider, model: selected.model, label: `${selected.provider} / ${selected.model}`, efforts: [] })
  }
  const key = selected === undefined ? '' : modelRouteKey(selected.provider, selected.model)
  const value = choices.find(choice => modelRouteKey(choice.provider, choice.model) === key)?.label
    ?? copy(props.locale, 'modelFollowOption')
  const anchor = useModelMenuAnchor(`${label}: ${value}`, undefined, () => setOpen(false))
  const pick = (route: { provider: string; model: string }) => {
    // Re-picking the same route writes nothing: an unchanged selection
    // must not strip a stored route's reasoningEffort.
    if (selected && route.provider === selected.provider && route.model === selected.model) return
    props.send({ [props.field]: { provider: route.provider, model: route.model } })
  }
  return (
    <div className="dsm-model-field">
      <div className="dsm-model-choice">
      <span className="dsh-ui-label">{label}</span>
      {renderModelPicker(props.renderFactorySlot, {
        locale: props.locale,
        disabled: props.disabled,
        onOpenChange: next => setOpen(next && !props.disabled),
        listClassName: FREE_CHAT_ROOT,
        choices,
        selected,
        onPick: pick,
        leading: [{ id: 'follow', label: copy(props.locale, 'modelFollowOption'), selected: selected === undefined }],
        onPickLeading: () => { if (props.route !== null) props.send({ [props.field]: null }) },
        triggerLabel: value,
        modelValue: value,
      }, {
        anchor,
        fallback: <ModelMenu
          locale={props.locale}
          open={open && !props.disabled}
          onOpenChange={next => setOpen(next && !props.disabled)}
          listClassName={FREE_CHAT_ROOT}
          anchor={<button type="button" className="dsh-model-menu-trigger" disabled={props.disabled} aria-label={`${label}: ${value}`} aria-haspopup="menu" aria-expanded={open}>
            <span className="dsh-model-menu-triggerLabel">{value}</span>
            <IconChevronDownOutlineRegular className={`dsh-model-menu-chevron${open ? ' dsh-model-menu-chevronOpen' : ''}`} />
          </button>}
          choices={choices}
          selected={selected}
          onPick={pick}
          leading={[{ id: 'follow', label: copy(props.locale, 'modelFollowOption'), selected: selected === undefined }]}
          onPickLeading={() => { if (props.route !== null) props.send({ [props.field]: null }) }}
          modelValue={value}
        />,
      })}
      </div>
      <ModelCatalogStatus state={catalog} locale={props.locale} />
    </div>
  )
}

/** 会话交接 / Session handoff row: the model behind read_session handoff summaries. */
export function HandoffSettings(props: RowProps & CatalogProps): React.ReactElement {
  const { snapshot, values, gate } = useRowGate(props)
  const { send, owns } = useConfigPatch(props.model)
  if (gate !== undefined || values === undefined) return gate ?? <></>
  return (
    <div className="dsm-settings">
      <div className="dsm-feature">
        <ModelField {...props} field="handoffModel" labelKey="handoffModelLabel" route={values.handoffModel} send={send} />
        <p className="dsh-ui-hint">{copy(props.locale, 'handoffModelHint')}</p>
        <SaveStatus snapshot={snapshot} locale={props.locale} owns={owns} />
      </div>
    </div>
  )
}

/**
 * 代理操作 / Agent actions row.
 *
 * Two independent switches: each one saves only its own field, so toggling
 * one never rewrites the other. Both default to off, and the agent decides
 * on its own once a switch is on — there is no per-call approval here.
 *
 * The switches share one sparse writer: the config model accepts a single
 * write at a time, so a second click while a save is in flight must queue
 * rather than be dropped. The shared writer merges the pending patches and
 * flushes them once the current save settles.
 */
export function AgentActionsSettings(props: RowProps): React.ReactElement {
  const { snapshot, values, gate } = useRowGate(props)
  const { send, owns } = useConfigPatch(props.model)
  if (gate !== undefined || values === undefined) return gate ?? <></>
  return (
    <div className="dsm-settings">
      <div className="dsm-feature">
        <div className="dsh-ui-toggle-row">
          <span className="dsh-ui-toggle-text">
            <span className="dsh-ui-toggle-label">{copy(props.locale, 'allowSelfForkLabel')}</span>
            <span className="dsh-ui-hint">{copy(props.locale, 'allowSelfForkHint')}</span>
          </span>
          <Switch
            label={copy(props.locale, 'allowSelfForkLabel')}
            checked={values.allowSelfFork === true}
            onChange={next => { send({ allowSelfFork: next }) }}
          />
        </div>
      </div>
      <div className="dsm-feature">
        <div className="dsh-ui-toggle-row">
          <span className="dsh-ui-toggle-text">
            <span className="dsh-ui-toggle-label">{copy(props.locale, 'allowSendMessageLabel')}</span>
            <span className="dsh-ui-hint">{copy(props.locale, 'allowSendMessageHint')}</span>
          </span>
          <Switch
            label={copy(props.locale, 'allowSendMessageLabel')}
            checked={values.allowSendMessage === true}
            onChange={next => { send({ allowSendMessage: next }) }}
          />
        </div>
      </div>
      <SaveStatus snapshot={snapshot} locale={props.locale} owns={owns} />
    </div>
  )
}

/**
 * One collapsible row in the shared Session Management section: a named
 * details group. The body mounts on the first expand only — opening the page
 * must not fire every feature's config and model reads — and stays mounted
 * afterwards so collapsing never drops an in-progress text draft.
 */
export function SessionSettingsDetails(props: {
  testId: string
  titleKey: UiTextKey
  descKey: UiTextKey
  locale: CopyLocale
  children?: React.ReactNode
}): React.ReactElement {
  const [visited, setVisited] = useState(false)
  return (
    <details
      className={`${FREE_CHAT_ROOT} dsm-item`}
      data-testid={props.testId}
      onToggle={event => { if ((event.currentTarget as HTMLDetailsElement).open) setVisited(true) }}
    >
      <summary className="dsm-item-summary">
        <span>
          <span className="dsm-item-title">{copy(props.locale, props.titleKey)}</span>
          <span className="dsm-item-desc">{copy(props.locale, props.descKey)}</span>
        </span>
        <IconChevronDownOutlineRegular className="dsm-item-chevron" aria-hidden="true" />
      </summary>
      {visited ? <div className="dsm-item-body">{props.children}</div> : null}
    </details>
  )
}
