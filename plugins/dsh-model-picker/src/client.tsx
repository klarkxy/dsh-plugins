/**
 * Model picker, browser half.
 *
 * Two surfaces ride one component:
 *
 * - `klarkxy.model-picker` (root Factory): the searchable model picker with a
 *   reasoning-effort slider that feature plugins mount through
 *   `renderFactorySlot`. Its props are pure data and callbacks so consumers
 *   never take a runtime dependency on this package — while the definition is
 *   absent the renderer resolves the caller's `options.fallback`.
 * - `conversation.input.model` (single/session, priority -2): the composer
 *   model seat, shadowing the shipped entry (priority 0) and a reasoning-slider
 *   entry (priority -1). The ledger keeps every occupant, so unmounting this
 *   entry restores the previous winner — the native or reference seat returns
 *   automatically on disable/uninstall. The label child slot stays declared by
 *   the shadowed native entry, which means only it may render it; like
 *   reasoning-slider this seat renders the model name verbatim.
 *
 * The seat drives the same per-session ModelDirectory the native seat and the
 * /model popup share (catalog load, selection submission, pending/error
 * projection), so selection semantics stay host-owned.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { FactoryComponentPropsOf, FactoryLocalComponent } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelDirectoryState, ModelSelectInjected } from '@deepseek-ai/dsh-client-ui-model-selection/client'
/* Type-only merges: client Context services and the composer slot contract. */
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { IconChevronDownOutlineRegular, IconDataOutlineRegular, IconWarningOutlineRegular, StateDot, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { modelMenuEffortLabel, type ModelMenuChoice } from '@klarkxy/dsh-model-route'
import { ModelMenu, modelMenuCss } from '@klarkxy/dsh-model-route/ui'
import {
  MODEL_PICKER_ANCHOR_SLOT, MODEL_PICKER_FACTORY,
  type ModelPickerAnchorProps, type ModelPickerProps,
} from '@klarkxy/dsh-model-route/model-picker'
import { EffortPreference } from './effort-preference.ts'

export const name = 'dsh-model-picker-client'
export const inject = ['slots', 'locale', 'sessions'] as const

/* The seat's cell: the native entry holds priority 0, reasoning-slider -1.
 * -2 makes this seat the winner while both are registered. */
const MODEL_SEAT_PRIORITY = -2

/* --------------------------------------------------------------------------
 * Locale
 * ------------------------------------------------------------------------ */

const NS = 'model-picker'
export const dictZh = {
  'trigger.fallback': '请选择模型',
  'trigger.aria': '选择模型，当前 {model}',
  'trigger.ariaEffort': '选择模型，当前 {model}，推理等级 {effort}',
  'menu.model': '模型',
  'menu.effort': '推理等级',
  'effort.providerDefault': '跟随模型默认',
  'search.placeholder': '搜索模型…',
  'search.clear': '清除搜索',
  'search.empty': '没有匹配的模型。',
  'empty.models': '暂无可用模型',
  'status.loading': '正在刷新模型列表…',
  'error.action': '模型操作失败：{message}',
  'action.retry': '重试',
  'warning.unroutable': '当前模型不在可用目录中',
}
export const dictEn = {
  'trigger.fallback': 'Select model',
  'trigger.aria': 'Select model, current {model}',
  'trigger.ariaEffort': 'Select model, current {model}, reasoning effort {effort}',
  'menu.model': 'Model',
  'menu.effort': 'Effort',
  'effort.providerDefault': 'Default',
  'search.placeholder': 'Search models…',
  'search.clear': 'Clear search',
  'search.empty': 'No matching models.',
  'empty.models': 'No models available.',
  'status.loading': 'Refreshing model list…',
  'error.action': 'Model operation failed: {message}',
  'action.retry': 'Retry',
  'warning.unroutable': 'The selected model is not in the available catalog',
}
type PickerKey = keyof typeof dictZh
type Translate = (key: PickerKey, params?: Record<string, unknown>) => string

function template(text: string, params?: Record<string, unknown>): string {
  return params ? text.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`)) : text
}

/** Copy resolver for tests and for faces that never got a framework `t`. */
export function pickerCopy(locale: string | undefined): Translate {
  const dict = locale?.toLowerCase().startsWith('zh') ? dictZh : dictEn
  return (key, params) => template(dict[key], params)
}

/* --------------------------------------------------------------------------
 * Styles — token whitelist only, scoped under .dsh-model-picker
 * ------------------------------------------------------------------------ */

export const modelPickerCss = `${modelMenuCss}
.dsh-model-picker-status {
  display: flex; flex-direction: column; gap: 4px; flex: none;
}
.dsh-model-picker-statusRow {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  border-radius: var(--dsw-radius-md); padding: 5px 7px;
  color: var(--dsw-alias-state-error-primary);
  background: var(--dsw-alias-interactive-bg-hover-danger);
  font-size: 12px; line-height: 18px;
}
.dsh-model-picker-statusRow[data-tone="warn"] {
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-model-picker-statusText { min-width: 0; flex: 1; overflow-wrap: anywhere; }
.dsh-model-picker-retry {
  color: inherit; font: inherit; font-weight: 600; cursor: pointer;
  background: none; border: none; padding: 0 2px; flex: none;
}
.dsh-model-picker-retry:hover:not(:disabled) { text-decoration: underline; }
.dsh-model-picker-retry:disabled { opacity: 0.6; cursor: default; }
.dsh-model-picker-triggerIcon { display: var(--dsh-composer-model-icon-display, none); flex: none; }
`

/* --------------------------------------------------------------------------
 * Catalog shape adapters
 * ------------------------------------------------------------------------ */

/** Directory provider groups → flat ModelMenu choices. */
export function directoryChoices(groups: ModelDirectoryState['groups'], bound?: { provider: string; model: string }): ModelMenuChoice[] {
  const choices: ModelMenuChoice[] = []
  for (const group of groups) {
    const providerName = group.name || group.id
    for (const model of group.models) {
      choices.push({
        provider: group.id,
        model: model.id,
        label: `${providerName} / ${model.name || model.id}`,
        providerLabel: providerName,
        efforts: (model.reasoning?.efforts ?? []).map(effort => ({ id: effort.id, name: effort.name || effort.id })),
      })
    }
  }
  if (bound?.provider && bound.model && !choices.some(item => item.provider === bound.provider && item.model === bound.model)) {
    choices.push({ provider: bound.provider, model: bound.model, label: `${bound.provider} / ${bound.model}`, efforts: [] })
  }
  return choices
}

function reasoningOf(groups: ModelDirectoryState['groups'], provider: string, model: string) {
  return groups.find(group => group.id === provider)?.models.find(entry => entry.id === model)?.reasoning
}

/** Route key only when the saved model is absent from the catalog. Effort-only
 * snapshot updates must not change this — a new `current` object is not a new list. */
function outsideCatalogKey(groups: ModelDirectoryState['groups'], current: { provider: string; model: string } | null): string {
  if (!current) return ''
  for (const group of groups) {
    if (group.id !== current.provider) continue
    if (group.models.some(model => model.id === current.model)) return ''
  }
  return `${current.provider}\0${current.model}`
}

/* Model picks submit provider+model verbatim: the adapter resolves its own
 * default effort — see the native ModelSelect.choose path. */

/* --------------------------------------------------------------------------
 * Default anchor (the trigger rendered in place of the caller's row)
 * ------------------------------------------------------------------------ */

export type AnchorComponent = (props: ModelPickerAnchorProps & Record<string, unknown>) => ReactNode

/**
 * DOM attributes the anchor forwards: framework-stamped ARIA, identity and
 * style fields, and event handlers. Everything else in the local props —
 * injected kit members and hook objects — never reaches the DOM.
 */
const TRIGGER_FORWARD = /^(aria-|data-|id$|className$|style$|title$|role$|tabIndex$|on[A-Z])/

/**
 * The trigger every occurrence gets unless the caller selects its own
 * `anchor` local component. It mirrors the composer's model pill: icon +
 * label + effort caption + chevron (spinner while busy).
 */
function DefaultTrigger(props: ModelPickerAnchorProps & Record<string, unknown>): ReactNode {
  const { open, disabled, busy, label, effortLabel, className, ...rest } = props as ModelPickerAnchorProps & Record<string, unknown>
  const forward: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(rest)) if (TRIGGER_FORWARD.test(key)) forward[key] = value
  return <button
    type="button"
    {...forward}
    className={`dsh-model-menu-trigger${className ? ` ${className}` : ''}`}
    disabled={disabled || undefined}
    title={effortLabel ? `${label} · ${effortLabel}` : label}
  >
    <IconDataOutlineRegular className="dsh-model-picker-triggerIcon" size={16} />
    <span className="dsh-model-menu-triggerLabel">{label}</span>
    {effortLabel !== undefined
      ? <span className="dsh-model-menu-triggerEffort">{effortLabel}</span>
      : null}
    {busy
      ? <StateDot state="ongoing" />
      : <IconChevronDownOutlineRegular className={`dsh-model-menu-chevron${open ? ' dsh-model-menu-chevronOpen' : ''}`} />}
  </button>
}

/* --------------------------------------------------------------------------
 * Factory definition component
 * ------------------------------------------------------------------------ */

type ModelPickerComponentProps = FactoryComponentPropsOf<'klarkxy.model-picker'>

/**
 * One picker occurrence. `props` is the consumer's ModelPickerProps plus the
 * framework seats (`t`, `useFactorySlot`, injected hooks). Open state is per
 * occurrence; a `disabled` rise closes the menu and every pick is gated so a
 * busy or disabled picker can never select.
 */
export function ModelPicker(props: ModelPickerComponentProps): ReactNode {
  const { t, useFactorySlot, useActiveLocale, ...input } = props as ModelPickerComponentProps & ModelPickerProps
  const activeLocale = useActiveLocale ? String(useActiveLocale(snapshot => snapshot.active)) : 'en'
  const [open, setOpen] = useState(false)
  /* `disabled` locks the trigger and every menu action but must not close an
   * already-open card: consumers pulse it with their save state, and the
   * picker's contract keeps the menu mounted so a selection never loses the
   * search, scroll, or the open slider. `busy` (selecting/loading) is softer —
   * the menu stays open so a failure can surface; only actions are gated. */
  const disabled = input.disabled === true
  /* input.busy = an owner's in-flight submission (rows gated, menu stays).
   * status.busy = data loading — it renders a banner row, never a gate. */
  const busy = input.busy === true
  const gatedRef = useRef(disabled || busy)
  gatedRef.current = disabled || busy
  const setMenuOpenRef = useRef((next: boolean): void => {})
  setMenuOpenRef.current = (next: boolean): void => {
    if (disabled && next) return
    setOpen(next)
    input.onOpenChange?.(next)
  }
  const setMenuOpen = (next: boolean): void => setMenuOpenRef.current(next)

  const language = input.locale ?? activeLocale
  const selected = input.selected
  const selectedChoice = useMemo(
    () => input.choices.find(choice => choice.provider === selected?.provider && choice.model === selected.model),
    [input.choices, selected?.provider, selected?.model])
  const triggerLabel = input.triggerLabel ?? selectedChoice?.label ?? (selected ? `${selected.provider} / ${selected.model}` : t('trigger.fallback'))
  const effortRows = input.efforts ?? []
  const selectedEffort = input.selectedEffort ?? ''
  /* An unset effort shows the provider-default caption, matching the slider's
   * default row — never the resolved default's own name. */
  const triggerEffortLabel = input.triggerEffortLabel
    ?? (selectedEffort
      ? modelMenuEffortLabel(effortRows.find(row => row.id === selectedEffort) ?? { id: selectedEffort, name: selectedEffort }, language)
      : effortRows.length > 0 ? input.defaultEffortLabel ?? t('effort.providerDefault') : undefined)

  /* The status banner occupies the menu's own header seat: a retry row for the
   * whole-request error and one warn row per provider-local failure. The
   * loading row only renders while there is nothing to pick — a refresh of an
   * already-populated catalog stays silent so a background reload (e.g. the
   * settings/document-updated fan-out after every saved selection) never
   * re-lays out the menu or steals the slider's DOM. */
  const status = input.status
  const loading = status?.busy === true && input.choices.length === 0
  const menuHeader = status && (loading || status.error || status.warning || (status.failures?.length ?? 0) > 0)
    ? <div className="dsh-model-picker-status" role={status.error ? 'alert' : 'status'}>
        {loading
          ? <div className="dsh-model-picker-statusRow" data-tone="info">
              <span className="dsh-model-picker-statusText">{t('status.loading')}</span>
            </div>
          : null}
        {status.warning
          ? <div className="dsh-model-picker-statusRow" data-tone="warn">
              <span className="dsh-model-picker-statusText">{status.warning}</span>
            </div>
          : null}
        {status.error
          ? <div className="dsh-model-picker-statusRow">
              <span className="dsh-model-picker-statusText">{t('error.action', { message: status.error })}</span>
              {status.retry ? <button type="button" className="dsh-model-picker-retry" disabled={disabled} onClick={() => status.retry?.()}>{input.retryLabel ?? t('action.retry')}</button> : null}
            </div>
          : null}
        {(status.failures ?? []).map(failure => <div key={failure.id} className="dsh-model-picker-statusRow" data-tone="warn">
          <span className="dsh-model-picker-statusText">{failure.name || failure.id}: {failure.message}</span>
          {status.retry ? <button type="button" className="dsh-model-picker-retry" disabled={disabled} onClick={() => status.retry?.()}>{input.retryLabel ?? t('action.retry')}</button> : null}
        </div>)}
      </div>
    : undefined

  const gate = <A extends unknown[]>(fn: ((...args: A) => void) | undefined): ((...args: A) => void) =>
    (...args) => { if (!gatedRef.current) fn?.(...args) }

  const Anchor = useFactorySlot(MODEL_PICKER_ANCHOR_SLOT, DefaultTrigger as FactoryLocalComponent<'klarkxy.model-picker', 'anchor'>)
  const anchor = <Anchor
    open={open}
    disabled={disabled}
    busy={busy}
    label={triggerLabel}
    effortLabel={triggerEffortLabel}
    className={input.triggerClassName}
    aria-label={triggerEffortLabel
      ? t('trigger.ariaEffort', { model: triggerLabel, effort: triggerEffortLabel })
      : t('trigger.aria', { model: triggerLabel })}
  />

  return <>
    <style>{modelPickerCss}</style>
    <ModelMenu
      locale={language}
      open={open}
      onOpenChange={setMenuOpen}
      anchor={anchor}
      choices={input.choices}
      selected={input.selected}
      onPick={gate(input.onPick)}
      leading={input.leading ?? []}
      onPickLeading={gate(input.onPickLeading)}
      menuHeader={menuHeader}
      disabled={disabled}
      busy={busy}
      efforts={effortRows}
      selectedEffort={selectedEffort}
      onPickEffort={gate(input.onPickEffort)}
      modelLabel={input.modelLabel ?? t('menu.model')}
      modelValue={input.modelValue ?? triggerLabel}
      effortLabel={input.effortLabel ?? t('menu.effort')}
      defaultEffortLabel={input.defaultEffortLabel ?? t('effort.providerDefault')}
      searchPlaceholder={input.searchPlaceholder ?? t('search.placeholder')}
      emptyLabel={input.emptyLabel ?? (input.choices.length === 0 ? t('empty.models') : t('search.empty'))}
      clearSearchLabel={input.clearSearchLabel ?? t('search.clear')}
      initialPane={input.initialPane ?? 'model'}
      alwaysShowSearch={input.alwaysShowSearch ?? true}
      reasoningSlider={input.reasoningSlider ?? true}
      closeOnPick={false}
      closeOnDisable={false}
      listClassName={`dsh-model-picker${input.listClassName ? ` ${input.listClassName}` : ''}`}
      className="dsh-model-picker"
    />
  </>
}

/* --------------------------------------------------------------------------
 * Composer seat
 * ------------------------------------------------------------------------ */

interface SeatProps {
  sessionId: string
  locked: boolean
  t: Translate
}

/** The seat's injected face equals the native ModelSelectInjected. */
type InjectedSeatProps = SeatProps & ModelSelectInjected & {
  renderFactorySlot?: (name: string, props: unknown, options?: { fallback?: ReactNode }) => ReactNode
}

/**
 * The composer model seat: the same injected face the native entry exposes,
 * rendered through the shared factory so the composer and every consumer
 * share one picker implementation. The bare ModelMenu below is the last-ditch
 * path for a missing factory — the seat never loses its control.
 */
export function ComposerModelSeat(props: InjectedSeatProps): ReactNode {
  const { t } = props
  const directory = props.directory
  /* Subscribe by directory identity. A fresh closure every render makes
   * useSyncExternalStore resubscribe on each pass; the snapshot itself stays
   * the store's cached value, so this is not what jumps the menu, but the
   * resubscribe is needless churn on the selection that already re-renders. */
  const subscribeDirectory = useCallback((onStoreChange: () => void) => directory.subscribe(onStoreChange), [directory])
  const snapshotDirectory = useCallback(() => directory.getSnapshot(), [directory])
  const state = useSyncExternalStore(subscribeDirectory, snapshotDirectory, snapshotDirectory)
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const rootRef = useRef<HTMLSpanElement | null>(null)

  const groups = state.groups
  const current = state.current
  const outsideKey = outsideCatalogKey(groups, current)
  const choices = useMemo(() => directoryChoices(
    groups,
    outsideKey === '' ? undefined : { provider: outsideKey.slice(0, outsideKey.indexOf('\0')), model: outsideKey.slice(outsideKey.indexOf('\0') + 1) },
  ), [groups, outsideKey])
  const selectedChoice = choices.find(choice => choice.provider === current?.provider && choice.model === current.model)
  const reasoning = current ? reasoningOf(groups, current.provider, current.model) : undefined
  /* The slider offers only efforts the catalog actually advertises — a saved
   * effort the model no longer declares is displayed, never listed. */
  const efforts = useMemo(() => [...(selectedChoice?.efforts ?? [])], [selectedChoice])
  const busy = state.status === 'selecting' || state.pending !== null

  /* Mount and every open refresh the shared directory, mirroring the native
   * seat — without this the catalog may sit idle forever. */
  useEffect(() => { props.load() }, [props.load])
  const onMenuOpenChange = (next: boolean): void => { if (next) props.load() }

  const report = (error: { code: string; message: string }): void => {
    toastSeq.current += 1
    setToast({ seq: toastSeq.current, text: t('error.action', { message: `${error.code}: ${error.message}` }) })
  }
  const submit = (selection: { provider: string; model: string; reasoningEffort?: string }): void => {
    void props.select(selection).then(result => {
      if (result !== undefined && !result.ok) report(result.error)
    }).catch(error => report({ code: 'model-picker/error', message: error instanceof Error ? error.message : String(error) }))
  }
  /* A saved route that left the catalog stays displayable but is not
   * routable: the synthetic row is disabled so the user cannot "select" a
   * model the host cannot dispatch to — matching the native seat's posture. */
  const unroutable = state.routable === false && current !== null
  const pickModel = (route: { provider: string; model: string }): void => {
    if (current?.provider === route.provider && current.model === route.model) return
    if (unroutable && route.provider === current.provider && route.model === current.model) return
    /* Native semantics: switching models submits provider+model only and lets
     * the adapter apply its own default effort. */
    submit({ provider: route.provider, model: route.model })
  }
  const pickEffort = (effort: string | undefined): void => {
    if (!current) return
    if ((current.reasoningEffort ?? undefined) === effort) return
    submit({ provider: current.provider, model: current.model, ...(effort === undefined ? {} : { reasoningEffort: effort }) })
  }

  const modelName = selectedChoice
    ? (selectedChoice.label.split(' / ').slice(1).join(' / ') || selectedChoice.model)
    : current?.model ?? t('trigger.fallback')
  /* Trigger caption: a saved effort shows its label; nothing saved shows the
   * provider-default caption when the model declares efforts (matching the
   * slider's default row) or the retained caption when the model is gone. */
  const effortLabel = reasoning === undefined
    ? state.retainedEffort
    : current?.reasoningEffort !== undefined
      ? modelMenuEffortLabel(reasoning.efforts.find(row => row.id === current?.reasoningEffort) ?? { id: current?.reasoningEffort ?? '', name: current?.reasoningEffort ?? '' }, undefined)
      : reasoning.efforts.length > 0 || reasoning.defaultEffort !== undefined
        ? t('effort.providerDefault')
        : undefined

  if (!props.available) return null

  const fallback = <ModelMenuFallback
    t={t}
    state={state}
    choices={choices}
    efforts={efforts}
    savedEffort={current?.reasoningEffort}
    effortLabel={effortLabel}
    modelName={modelName}
    locked={props.locked}
    busy={busy}
    onPick={pickModel}
    onPickEffort={pickEffort}
    onOpen={onMenuOpenChange}
    onRetry={() => props.load()}
  />

  const pickerProps: ModelPickerProps = {
    choices,
    selected: current ? { provider: current.provider, model: current.model } : undefined,
    onPick: pickModel,
    efforts,
    selectedEffort: current?.reasoningEffort ?? '',
    onPickEffort: pickEffort,
    disabled: props.locked,
    busy,
    triggerLabel: modelName,
    triggerEffortLabel: effortLabel,
    onOpenChange: onMenuOpenChange,
    status: {
      error: state.error,
      busy: state.status === 'loading',
      warning: unroutable ? t('warning.unroutable') : undefined,
      failures: state.failures,
      retry: () => props.load(),
    },
  }

  return <span ref={rootRef} className="dsh-model-picker">
    {props.renderFactorySlot ? props.renderFactorySlot(MODEL_PICKER_FACTORY, pickerProps, { fallback }) : fallback}
    {toast !== null && <Toast
      // Toast already renders through its own body portal; keying by seq
      // restarts the banner for a fresh error.
      key={toast.seq}
      text={toast.text}
      icon={<IconWarningOutlineRegular />}
      anchor={rootRef.current?.closest('[data-composer-card]') ?? rootRef.current}
      onDone={() => setToast(null)}
    />}
  </span>
}

/** Bare-menu fallback used only if the factory never registered. */
function ModelMenuFallback(props: {
  t: Translate
  state: ModelDirectoryState
  choices: ModelMenuChoice[]
  efforts: { id: string; name: string }[]
  savedEffort: string | undefined
  effortLabel: string | undefined
  modelName: string
  locked: boolean
  busy: boolean
  onPick(route: { provider: string; model: string }): void
  onPickEffort(effort: string | undefined): void
  onOpen(next: boolean): void
  onRetry(): void
}): ReactNode {
  const { t, state } = props
  const [open, setOpen] = useState(false)
  useEffect(() => { if (props.locked) setOpen(false) }, [props.locked])
  const gated = props.locked || props.busy
  const unroutable = state.routable === false && state.current !== null
  /* Same quiet-refresh rule as the factory face: the loading banner exists
   * for the initial (empty) load only. */
  const loading = state.status === 'loading' && props.choices.length === 0
  const menuHeader = (loading || state.error || unroutable || state.failures.length > 0)
    ? <div className="dsh-model-picker-status" role={state.error ? 'alert' : 'status'}>
        {loading
          ? <div className="dsh-model-picker-statusRow" data-tone="info">
              <span className="dsh-model-picker-statusText">{t('status.loading')}</span>
            </div>
          : null}
        {unroutable
          ? <div className="dsh-model-picker-statusRow" data-tone="warn">
              <span className="dsh-model-picker-statusText">{t('warning.unroutable')}</span>
            </div>
          : null}
        {state.error
          ? <div className="dsh-model-picker-statusRow">
              <span className="dsh-model-picker-statusText">{t('error.action', { message: state.error })}</span>
              <button type="button" className="dsh-model-picker-retry" disabled={gated} onClick={props.onRetry}>{t('action.retry')}</button>
            </div>
          : null}
        {state.failures.map(failure => <div key={failure.id} className="dsh-model-picker-statusRow" data-tone="warn">
          <span className="dsh-model-picker-statusText">{failure.name || failure.id}: {failure.message}</span>
          <button type="button" className="dsh-model-picker-retry" disabled={gated} onClick={props.onRetry}>{t('action.retry')}</button>
        </div>)}
      </div>
    : undefined
  return <>
    <style>{modelPickerCss}</style>
    <ModelMenu
      locale="en"
      open={open && !props.locked}
      onOpenChange={next => {
        if (props.locked) return
        setOpen(next)
        if (next) props.onOpen(next)
      }}
      anchor={<DefaultTrigger open={open} disabled={gated} busy={props.busy} label={props.modelName} effortLabel={props.effortLabel} aria-label={props.effortLabel ? t('trigger.ariaEffort', { model: props.modelName, effort: props.effortLabel }) : t('trigger.aria', { model: props.modelName })} />}
      choices={props.choices}
      selected={state.current ? { provider: state.current.provider, model: state.current.model } : undefined}
      onPick={route => { if (!gated) props.onPick(route) }}
      menuHeader={menuHeader}
      disabled={props.locked}
      busy={props.busy}
      efforts={props.efforts}
      selectedEffort={props.savedEffort ?? ''}
      onPickEffort={effort => { if (!gated) props.onPickEffort(effort) }}
      modelLabel={t('menu.model')}
      modelValue={props.modelName}
      effortLabel={t('menu.effort')}
      defaultEffortLabel={t('effort.providerDefault')}
      searchPlaceholder={t('search.placeholder')}
      emptyLabel={t('empty.models')}
      clearSearchLabel={t('search.clear')}
      initialPane="model"
      alwaysShowSearch
      reasoningSlider
      closeOnPick={false}
      listClassName="dsh-model-picker"
      className="dsh-model-picker"
    />
  </>
}

/* --------------------------------------------------------------------------
 * Plugin apply
 * ------------------------------------------------------------------------ */

/**
 * Wrap one per-session `ModelDirectory.select` with the page-lifetime effort
 * memory: a cross-route pick with no explicit effort re-attaches the route's
 * last successful human pick (only while the catalog still declares it), and
 * every confirmed selection records its effort so the Host default save —
 * `sessionController.selectModel` persists the complete selection through
 * `agentDefaultModel.saveSelection` — keeps the effort for new Sessions that
 * follow the default. Memory updates strictly on `result.ok === true`; a
 * failure leaves the remembered route untouched. Exported for the wiring spec.
 */
export function createPreferredSelect(
  directory: { store: ModelSelectInjected['directory']; select: ModelSelectInjected['select'] },
  preference: EffortPreference,
): ModelSelectInjected['select'] {
  return async selection => {
    const state = directory.store.getSnapshot()
    const current = state.current
    const sameRoute = current !== null && current.provider === selection.provider && current.model === selection.model
    let final = selection
    if (!sameRoute && selection.reasoningEffort === undefined) {
      const reasoning = state.groups
        .find(group => group.id === selection.provider)?.models
        .find(model => model.id === selection.model)?.reasoning
      const effort = preference.resolve(selection, reasoning === undefined ? undefined : { efforts: reasoning.efforts.map(row => row.id) })
      if (effort !== undefined) final = { ...selection, reasoningEffort: effort }
    }
    const result = await directory.select(final)
    if (result?.ok === true) preference.remember(final, final.reasoningEffort)
    return result
  }
}

export function apply(ctx: Context): void {
  /* Page-lifetime memory of the last successful explicit effort per route.
   * Scoped to this apply: multiple client contexts (HMR, parallel roots)
   * each own their own. */
  const preference = new EffortPreference()

  ctx.effect(() => {
    /* The untyped single-locale form: the typed register demands every
     * installed language dictionary, while the plugin ships zh + en. */
    const zh = ctx.locale?.register(NS, 'zh', dictZh)
    const en = ctx.locale?.register(NS, 'en', dictEn)
    return () => { zh?.(); en?.() }
  })

  ctx.slots.registerFactory({
    name: MODEL_PICKER_FACTORY,
    scope: 'root',
    locale: NS,
    inject: () => ({ hooks: { activeLocale: ctx.locale } }),
    slots: { [MODEL_PICKER_ANCHOR_SLOT]: { scope: 'root' } },
  }, ModelPicker as never)

  /* The seat waits on the model-selection service instead of probing it once:
   * if the resolver plugin mounts later, this fiber re-runs and registers;
   * if it unloads, the seat entry is disposed and the native occupant shows. */
  ctx.inject(['modelDirectories'], scope => {
    const directories = scope.modelDirectories
    scope.slots.inject('conversation.input.model', () => scope.slots.register({
      name: 'conversation.input.model',
      priority: MODEL_SEAT_PRIORITY,
      locale: NS,
      inject: (sessionId): ModelSelectInjected => {
        const unavailable: ModelSelectInjected = {
          available: false,
          directory: {
            getSnapshot: () => EMPTY_STATE,
            subscribe: () => () => {},
            update: () => {},
            set: () => {},
          },
          load: () => {},
          resolveText: text => ctx.locale?.resolveText(text) ?? String(text),
          select: async () => undefined,
        }
        if (scope.sessions?.subagentAddress?.(sessionId) !== undefined) return unavailable
        try {
          const directory = directories.directoryFor(sessionId)
          return {
            available: true,
            directory: directory.store,
            load: () => { void directory.load().catch(() => {}) },
            resolveText: text => ctx.locale?.resolveText(text) ?? String(text),
            select: createPreferredSelect(directory, preference),
          }
        } catch {
          return unavailable
        }
      },
    }, ComposerModelSeat as never))
  })
}

const EMPTY_STATE: ModelDirectoryState = { current: null, routable: null, groups: [], failures: [], status: 'idle', pending: null, error: null }
