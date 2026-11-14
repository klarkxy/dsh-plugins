import type { Context } from '@deepseek-ai/cordis'
import type { NativeSurfaceClient } from '@klarkxy/dsh-plugin-kit/client-utils'
import { createPluginReadGate, registerSessionSettingsItem, useFeatureRefresh, useNativeSeat } from '@klarkxy/dsh-plugin-kit/client-utils'
import { Button, IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'
import { installClientPluginLogger } from '@klarkxy/dsh-plugin-kit/client-logger'
import { modelSettingsChangesIdentity } from '@klarkxy/dsh-plugin-kit/contracts'
import { createModelSettingsSubscriber, mountModelSettingsChanges } from '@klarkxy/dsh-plugin-kit/model-settings-client'
import { registerAuxiliaryModelSettings } from '@klarkxy/dsh-plugin-kit/auxiliary-model-client'
import {
  MODEL_CATALOG_INJECT, readModelCatalog, modelMenuEffortLabel, modelMenuEffortOptions, parseModelMenuChoices,
} from '@klarkxy/dsh-model-route'
import { ModelCatalogStatus, ModelMenu, modelMenuCss, useModelCatalog } from '@klarkxy/dsh-model-route/ui'
import { renderModelPicker, useModelMenuAnchor, type RenderFactorySlot } from '@klarkxy/dsh-plugin-kit/model-picker'
import { useCallback, useEffect, useRef, useState } from 'react'
import { RPC_CHANNEL, TITLE_CLIENT_SERVICE, type RpcResult, type TitleCadence, type TitleModelRoute, type TitleStatus } from './contracts.ts'
import {
  createTitleClientWork, promptFieldValue, promptToSave, runTitleRegenerateFlow, runTitleSettingsSave, runTitleStatusLoad,
  shouldSkipTitleRefresh, titleCopy, titleMessage, type TitleClientCall, type TitleClientWork,
} from './client-work.ts'
import { applyMarkerFromStatus, createTitleClientMarker, disposeTitleClientMarker } from './marker.ts'

export const name = 'dsh-current-title-client'
export const inject = ['slots', 'connection', ...MODEL_CATALOG_INJECT, 'sessions', 'locale', 'uiWorkspace', 'uiSession'] as const
export { createTitleClientMarker, disposeTitleClientMarker, applyMarkerFromStatus }

type Client = NativeSurfaceClient & {
  connection: NonNullable<NativeSurfaceClient['connection']> & {
    rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<unknown> }
  }
  remote?: { session?: { modelCatalog?: () => Promise<unknown> } }
}

export function TitleSettings(props: {
  client: Client
  marker: { active: boolean }
  subscribeSettings?: (change: () => void, error?: (message: string) => void) => () => void
  /** Framework-composed factory renderer; absent under direct test renders. */
  renderFactorySlot?: RenderFactorySlot
}) {
  const seat = useNativeSeat(props.client)
  const sessionId = seat.sessionId
  const text = titleCopy[seat.locale]
  // Async work stores canonical defaults; translation belongs to the current render.
  const messages = titleCopy.en
  const [status, setStatus] = useState<TitleStatus>()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  // undefined = not edited; '' is a deliberate clear (built-in instruction).
  const [prompt, setPrompt] = useState<string | undefined>(undefined)
  const loadCatalog = useCallback(() => readModelCatalog(props.client), [props.client])
  const subscribeCatalog = useCallback((change: () => void) => props.client.connection.generation?.subscribe(change), [props.client])
  const catalogState = useModelCatalog(loadCatalog, { subscribe: subscribeCatalog })
  const { refresh: refreshCatalog } = catalogState
  const choices = parseModelMenuChoices(catalogState.catalog, status?.settings?.model)
  const [menuOpen, setMenuOpen] = useState(false)
  const [externalChange, setExternalChange] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [loadingSettings, setLoadingSettings] = useState(true)
  const dirty = useRef(false)
  const external = useRef(false)
  const reading = useRef(false)
  const pending = useRef(false)
  const syncRef = useRef<() => void>(() => {})
  const workRef = useRef<TitleClientWork>(undefined)
  if (!workRef.current) workRef.current = createTitleClientWork()
  const work = workRef.current
  const readGateRef = useRef<ReturnType<typeof createPluginReadGate>>(undefined)
  if (!readGateRef.current) readGateRef.current = createPluginReadGate()
  const readGate = readGateRef.current
  const busyRef = useRef(busy)
  busyRef.current = busy
  const changeBusy = (value: boolean) => {
    busyRef.current = value; setBusy(value)
    if (!value && pending.current) syncRef.current()
  }

  const call: TitleClientCall = (endpoint, payload = {}) => (
    props.client.connection.rpc.call(RPC_CHANNEL, endpoint, payload)
  )
  const readCall: TitleClientCall = (endpoint, payload) => readGate.run(() => call(endpoint, payload))

  function commitMarker(next: TitleStatus | undefined) {
    applyMarkerFromStatus(props.marker, next, true)
  }

  useEffect(() => () => { readGate.reset(); work.dispose() }, [work, readGate])
  useEffect(() => props.client.connection.generation?.subscribe(() => {
    readGate.reset()
    work.beginLoad()
    reading.current = false
    setLoadingSettings(false)
    busyRef.current = false
    setBusy(false)
  }), [props.client, work, readGate])

  useEffect(() => {
    const generation = work.beginLoad()
    reading.current = true; pending.current = false
    setLoadingSettings(true)
    readGate.reset()
    const isCurrent = () => work.isLoad(generation)
    setBusy(false)
    setError('')
    setNote('')
    void runTitleStatusLoad({
      call: readCall,
      sessionId: sessionId || undefined,
      isCurrent,
      failedMessage: messages.failed,
      onStatus: next => { if (!pending.current) setStatus(current => current && external.current ? { ...next, settings: current.settings } : next) },
      onError: message => { if (!pending.current) setError(message) },
      onMarker: commitMarker,
    }).finally(() => {
      if (!work.isLoad(generation)) return
      reading.current = false
      setLoadingSettings(false)
      if (pending.current) syncRef.current()
    })
    return () => { if (work.isLoad(generation)) work.beginLoad() }
  }, [props.client, props.marker, sessionId, work])

  const refreshStatus = useCallback(() => {
    if (!readGate.canRead() || shouldSkipTitleRefresh({ busy: busyRef.current }) || work.disposed) return
    if (reading.current) return
    reading.current = true
    setLoadingSettings(true)
    readGate.reset()
    const token = work.beginRequest()
    void runTitleStatusLoad({
      call: readCall,
      sessionId: sessionId || undefined,
      isCurrent: () => work.isRequest(token) && !shouldSkipTitleRefresh({ busy: busyRef.current }),
      failedMessage: messages.failed,
      onStatus: next => {
        if (pending.current || shouldSkipTitleRefresh({ busy: busyRef.current })) return
        setStatus(current => current && external.current ? { ...next, settings: current.settings } : next)
        setError('')
      },
      onError: message => { if (!pending.current) setError(message) },
      onMarker: next => {
        if (!next || shouldSkipTitleRefresh({ busy: busyRef.current })) return
        commitMarker(next)
      },
    }).finally(() => {
      if (!work.isRequest(token)) return
      reading.current = false
      setLoadingSettings(false)
      if (pending.current) syncRef.current()
    })
  }, [props.client, props.marker, sessionId, work])

  useFeatureRefresh(
    props.client,
    sessionId,
    refreshStatus,
    status?.session?.generating === true && !busy,
    Boolean(sessionId),
  )
  syncRef.current = () => {
    if (work.disposed) return
    if (reading.current || busyRef.current) { pending.current = true; return }
    pending.current = false
    if (dirty.current) { external.current = true; setExternalChange(true); return }
    readGate.reset(); refreshStatus()
  }
  useEffect(() => {
    setSyncError('')
    let live = true
    const stop = props.subscribeSettings?.(() => {
      if (!live) return
      setSyncError('')
      refreshCatalog()
      if (dirty.current && !busyRef.current) { external.current = true; setExternalChange(true) }
      syncRef.current()
    }, message => { if (live) setSyncError(message) })
    return () => { live = false; stop?.() }
  }, [props.subscribeSettings, props.client, refreshCatalog])

  const savedPrompt = status?.settings?.prompt ?? ''
  const savedModel = status?.settings?.model ?? { provider: '', model: '' }
  const follow = !savedModel.provider || !savedModel.model
  const selectedModel = follow ? undefined : choices.find(choice => choice.provider === savedModel.provider && choice.model === savedModel.model)
  const efforts = follow ? [] : modelMenuEffortOptions(selectedModel, savedModel.reasoningEffort)
  const currentLabel = follow ? text.modelDefault : selectedModel?.label ?? `${savedModel.provider} / ${savedModel.model}`
  const selectedEffort = efforts.find(item => item.id === (savedModel.reasoningEffort || ''))
  const effortName = selectedEffort ? modelMenuEffortLabel(selectedEffort, seat.locale) : undefined
  const anchor = useModelMenuAnchor(`${text.model}: ${currentLabel}`, undefined, () => setMenuOpen(false))
  const title = status?.session?.title
  const pinned = status?.session?.pinned === true
  const weOwn = status?.support?.weOwn === true
  const canRegenerate = Boolean(sessionId) && weOwn && !busy && !loadingSettings

  function saveSettings(patch: { model?: TitleModelRoute; cadence?: TitleCadence }) {
    if (!status || busyRef.current || reading.current || external.current) return
    readGate.reset()
    const token = work.beginRequest()
    setError('')
    setNote('')
    void runTitleSettingsSave({
      call,
      ...patch,
      expectedRevision: status.settings.revision,
      isCurrent: () => work.isRequest(token),
      savedMessage: messages.saved,
      failedMessage: messages.failed,
      onBusy: changeBusy,
      onSettings: settings => setStatus(current => current ? { ...current, settings } : current),
      onNote: setNote,
      onError: setError,
    })
  }

  return <section className="current-title-settings ct-root" lang={seat.locale} data-testid="current-title-settings">
    {!status && !error ? <p role="status" className="dsh-ui-hint">{text.loading}</p> : null}
    <article className="dsh-ui-card" data-testid="current-title-session">
      <h3 className="dsh-ui-heading">{text.session}</h3>
      {title
        ? <p translate="no" className="dsh-ui-title dsh-ui-wrap">{title}</p>
        : <p className="dsh-ui-hint">{text.noSession}</p>}
      {pinned ? <p className="dsh-ui-meta">{text.pinned}</p> : null}
      {status?.session?.generating ? <p role="status" className="dsh-ui-hint">{text.generating}</p> : null}
      {status && !weOwn ? <p role="status" className="dsh-ui-hint">{text.inactive}{status.support?.limitation ? ` ${titleMessage(status.support.limitation, seat.locale)}` : ''}</p> : null}
      {error ? <>
        <p role="alert" className="dsh-ui-error dsh-ui-wrap">{titleMessage(error, seat.locale)}</p>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => { readGate.reset(); refreshStatus() }}>
          {text.retry}
        </Button>
      </> : null}
      {note ? <p role="status" className="dsh-ui-notice">{titleMessage(note, seat.locale)}</p> : null}
      {externalChange ? <p role="alert" className="dsh-ui-error">{text.externalChange}</p> : null}
      {syncError ? <p role="status" className="dsh-ui-hint">{text.syncUnavailable}</p> : null}
      <div className="dsh-ui-actions">
        <Button variant="ghost" size="sm" disabled={busy || loadingSettings} onClick={() => {
          setPrompt(undefined); dirty.current = false; external.current = false; setExternalChange(false)
          readGate.reset(); syncRef.current()
        }}>{text.reload}</Button>
        {sessionId ? <Button variant="outline" size="md" disabled={!canRegenerate}
          onClick={() => {
            if (!sessionId) return
            readGate.reset()
            const token = work.beginRequest()
            setError('')
            setNote('')
            void runTitleRegenerateFlow({
              call,
              sessionId,
              isCurrent: () => work.isRequest(token),
              failedMessage: messages.failed,
              onBusy: changeBusy,
              onStatus: setStatus,
              onError: setError,
              onMarker: commitMarker,
            })
          }}>{text.regenerate}</Button> : null}
      </div>
    </article>
    <section className="dsh-ui-section" data-testid="current-title-defaults">
      <h3 className="dsh-ui-heading">{text.defaults}</h3>
      <label className="dsh-ui-field">
      <span className="dsh-ui-label">{text.prompt}</span>
      <textarea
        className="dsh-ui-textarea ct-prompt"
        value={status ? promptFieldValue(prompt, savedPrompt) : ''}
        maxLength={4000}
        rows={5}
        disabled={busy || loadingSettings || !status}
        onChange={event => { dirty.current = true; setPrompt(event.target.value); setNote('') }}
        onBlur={() => {
          if (!status || busyRef.current || reading.current || external.current) return
          const next = promptToSave(prompt, savedPrompt)
          if (next === undefined) { dirty.current = false; setPrompt(undefined); return }
          readGate.reset()
          const token = work.beginRequest()
          setError('')
          void runTitleSettingsSave({
            call,
            prompt: next,
            expectedRevision: status.settings.revision,
            isCurrent: () => work.isRequest(token),
            savedMessage: messages.saved,
            failedMessage: messages.failed,
            onBusy: changeBusy,
            onSettings: settings => { setStatus(current => current ? { ...current, settings } : current); dirty.current = false; setPrompt(undefined) },
            onNote: setNote,
            onError: setError,
          })
        }}
      />
      <span className="dsh-ui-help">{text.promptHint}</span>
    </label>
    <div className="dsh-ui-field">
      <span className="dsh-ui-label">{text.model}</span>
      <ModelCatalogStatus state={catalogState} locale={seat.locale} />
      {renderModelPicker(props.renderFactorySlot, {
        locale: seat.locale,
        disabled: busy || loadingSettings || !status,
        busy: busy || loadingSettings,
        onOpenChange: next => setMenuOpen(next && Boolean(status) && !busy && !loadingSettings),
        listClassName: 'ct-root',
        choices,
        selected: follow ? undefined : { provider: savedModel.provider, model: savedModel.model },
        onPick: picked => saveSettings({ model: { provider: picked.provider, model: picked.model } }),
        leading: [{ id: 'default', label: text.modelDefault, selected: follow }],
        onPickLeading: () => saveSettings({ model: { provider: '', model: '' } }),
        efforts,
        selectedEffort: savedModel.reasoningEffort || '',
        onPickEffort: effort => saveSettings({ model: follow
          ? { provider: '', model: '' }
          : { provider: savedModel.provider, model: savedModel.model, ...(effort ? { reasoningEffort: effort } : {}) } }),
        triggerLabel: currentLabel,
        triggerEffortLabel: !follow && efforts.length ? (effortName ?? text.modelDefault) : undefined,
        modelLabel: text.model,
        modelValue: currentLabel,
        defaultEffortLabel: text.modelDefault,
      }, {
        anchor,
        fallback: <ModelMenu
          locale={seat.locale}
          open={menuOpen && Boolean(status) && !busy && !loadingSettings}
          onOpenChange={next => setMenuOpen(next && Boolean(status) && !busy && !loadingSettings)}
          listClassName="ct-root"
          anchor={<button type="button" className="dsh-model-menu-trigger" disabled={busy || loadingSettings || !status} aria-label={`${text.model}: ${currentLabel}`}>
            <span className="dsh-model-menu-triggerLabel">{currentLabel}</span>
            {!follow && efforts.length ? <span className="dsh-model-menu-triggerEffort">{effortName ?? text.modelDefault}</span> : null}
            <IconChevronDownOutlineRegular className={`dsh-model-menu-chevron${menuOpen ? ' dsh-model-menu-chevronOpen' : ''}`} />
          </button>}
          choices={choices}
          selected={follow ? undefined : { provider: savedModel.provider, model: savedModel.model }}
          onPick={picked => saveSettings({ model: { provider: picked.provider, model: picked.model } })}
          leading={[{ id: 'default', label: text.modelDefault, selected: follow }]}
          onPickLeading={() => saveSettings({ model: { provider: '', model: '' } })}
          efforts={efforts}
          selectedEffort={savedModel.reasoningEffort || ''}
          onPickEffort={effort => saveSettings({ model: follow
            ? { provider: '', model: '' }
            : { provider: savedModel.provider, model: savedModel.model, ...(effort ? { reasoningEffort: effort } : {}) } })}
          modelLabel={text.model}
          modelValue={currentLabel}
          defaultEffortLabel={text.modelDefault}
        />,
      })}
      <p className="dsh-ui-meta">{text.modelHint}</p>
    </div>
    <label className="dsh-ui-field">
      <span className="dsh-ui-label">{text.cadence}</span>
      <select
        className="dsh-ui-select"
        value={status?.settings?.cadence ?? 'all-prompts'}
        disabled={busy || loadingSettings || !status}
        onChange={event => {
          saveSettings({ cadence: event.target.value === 'first-prompt' ? 'first-prompt' : 'all-prompts' })
        }}
      >
        <option value="all-prompts">{text.cadenceAll}</option>
        <option value="first-prompt">{text.cadenceFirst}</option>
      </select>
      </label>
    </section>
  </section>
}

/**
 * The settings row: a named native details group. The content mounts
 * on the first expand only — the shared page must not fire every plugin's
 * model/status requests — and stays mounted afterwards so a collapsed group
 * never drops an unsaved prompt draft or an in-flight write.
 */
export function TitleSettingsItem(props: {
  client: Client
  marker: { active: boolean }
  subscribeSettings?: (change: () => void, error?: (message: string) => void) => () => void
  /** Framework-composed factory renderer; absent under direct test renders. */
  renderFactorySlot?: RenderFactorySlot
}) {
  const seat = useNativeSeat(props.client)
  const text = titleCopy[seat.locale]
  const [visited, setVisited] = useState(false)
  return (
    <details
      className="ct-root ct-item"
      lang={seat.locale}
      data-testid="current-title-settings-item"
      onToggle={event => { if ((event.currentTarget as HTMLDetailsElement).open) setVisited(true) }}
    >
      <summary className="ct-item-summary">
        <span>
          <span className="ct-item-title">{text.label}</span>
          <span className="ct-item-desc">{text.groupHint}</span>
        </span>
        <IconChevronDownOutlineRegular className="ct-item-chevron" aria-hidden="true" />
      </summary>
      {visited ? (
        <div className="ct-item-body">
          <TitleSettings client={props.client} marker={props.marker} subscribeSettings={props.subscribeSettings}
            renderFactorySlot={props.renderFactorySlot} />
        </div>
      ) : null}
    </details>
  )
}

/* The contract owns every type tier, the field rhythm, the focus ring, the
 * select shell and the textarea shell. The only geometry left here is this
 * panel's own: its reading width, a taller prompt box, and the settings
 * group's row geometry (mirroring the native item rows: 16px padding, a 0.5px
 * l2 rule the shell drops on the last item, 24px label-control gutter). */
export const currentTitleOwnCss = `
.ct-root .ct-prompt { min-height: 96px; }
.ct-root.ct-item { padding: 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
.ct-root .ct-item-summary { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 16px 0; list-style: none; cursor: pointer; }
.ct-root .ct-item-summary::-webkit-details-marker { display: none; }
.ct-root .ct-item-summary > span:first-child { min-width: 0; }
.ct-root .ct-item-title { display: block; font-size: 14px; line-height: 20px; color: var(--dsw-alias-label-primary); }
.ct-root .ct-item-desc { display: block; margin-top: 4px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.ct-root .ct-item-chevron { width: 14px; height: 14px; color: var(--dsw-alias-label-secondary); transition: transform 0.15s ease; }
.ct-root.ct-item[open] > .ct-item-summary .ct-item-chevron { transform: rotate(180deg); }
.ct-root .ct-item-body { padding: 0 0 16px; }
`
export const currentTitleStyles = `${officialUiCss('ct-root')}${modelMenuCss}${currentTitleOwnCss}`
const styles = currentTitleStyles

declare module '@deepseek-ai/cordis' {
  interface Context { dshCurrentTitleClient: { active: boolean } }
}

export function apply(ctx: Context): void {
  const client = ctx as unknown as Client
  const packageName = '@klarkxy/dsh-current-title'
  const logger = installClientPluginLogger(ctx, packageName)
  mountModelSettingsChanges(ctx, packageName)
  const settingsSubscriber = createModelSettingsSubscriber(ctx, packageName, modelSettingsChangesIdentity(packageName))
  const subscribeSettings = (change: () => void, error?: (message: string) => void) => settingsSubscriber.subscribe(change, message => {
    logger.warn('settings.subscription-error', 'Title settings subscription reported an error.', undefined, { detail: message })
    error?.(message)
  })
  const marker = createTitleClientMarker()
  ctx.provide(TITLE_CLIENT_SERVICE, marker)
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-plugin', name)
    style.textContent = styles
    document.head.appendChild(style)
    return () => style.remove()
  }, 'current-title.styles')
  // The settings group is one row on the shared Session Management page; the
  // page is root-owned shared infrastructure, so this plugin contributes only
  // its row and never depends on another plugin.
  ctx.effect(() => registerSessionSettingsItem(
    ctx,
    { id: 'current-title', order: 70 },
    // A slot component never receives `ctx`: the host composes its own props, and a
    // Cordis context throws on any undeclared property read (so feeding one back
    // through `useNativeSeat` crashed the entry and abdicated its keyed cell).
    // The client and marker stay in the apply closure instead.
    slotProps => <TitleSettingsItem client={client} marker={marker} subscribeSettings={subscribeSettings}
      renderFactorySlot={(slotProps as { renderFactorySlot?: RenderFactorySlot } | undefined)?.renderFactorySlot} />,
  ), 'current-title.settings')
  // The shared "default auxiliary model" card is root-owned infrastructure:
  // this plugin retains one share while enabled and the card unloads with the
  // last participant, never depending on another plugin.
  ctx.effect(() => registerAuxiliaryModelSettings(ctx), 'current-title.auxiliary-model')
  ctx.effect(() => {
    let live = true
    void client.connection.rpc.call(RPC_CHANNEL, 'status', {}).then(result => {
      const row = result as RpcResult<TitleStatus>
      if (!live) return
      applyMarkerFromStatus(marker, row?.ok ? row.value : undefined, live)
    }).catch(error => {
      logger.debug('marker.status-failed', 'Initial title status RPC failed.', {
        reason: error instanceof Error ? error.message : String(error),
      })
      if (live) applyMarkerFromStatus(marker, undefined, live)
    })
    return () => { live = false; disposeTitleClientMarker(marker) }
  }, 'current-title.marker')
}
