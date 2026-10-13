import type { Context } from '@deepseek-ai/cordis'
import type { NativeSurfaceClient } from '@klarkxy/dsh-plugin-kit/client-utils'
import { createPluginReadGate, useFeatureRefresh, useNativeSeat } from '@klarkxy/dsh-plugin-kit/client-utils'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'
import { createModelSettingsSubscriber } from '@klarkxy/dsh-plugin-kit/model-settings-client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { RPC_CHANNEL, TITLE_CLIENT_SERVICE, type RpcResult, type TitleCadence, type TitleModelRoute, type TitleStatus } from './contracts.ts'
import {
  createTitleClientWork, promptFieldValue, promptToSave, runTitleRegenerateFlow, runTitleSettingsSave, runTitleStatusLoad,
  shouldSkipTitleRefresh, titleCopy, titleMessage, type TitleClientCall, type TitleClientWork,
} from './client-work.ts'
import { applyMarkerFromStatus, createTitleClientMarker, disposeTitleClientMarker } from './marker.ts'

export const name = 'dsh-current-title-client'
export const inject = ['slots', 'connection', 'remote', 'remote.session', 'sessions', 'locale', 'uiWorkspace', 'uiSession'] as const
export { createTitleClientMarker, disposeTitleClientMarker, applyMarkerFromStatus }

type Client = NativeSurfaceClient & {
  connection: NonNullable<NativeSurfaceClient['connection']> & {
    rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<unknown> }
  }
  remote?: { session?: { modelCatalog?: () => Promise<unknown> } }
  slots: {
    inject(key: string, callback: () => unknown): () => void
    register(spec: { name: string; key: string }, render: unknown): () => void
  }
}

interface CatalogChoice {
  provider: string
  model: string
  label: string
}

function catalogChoices(value: unknown, selected: TitleModelRoute): CatalogChoice[] {
  const envelope = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
  // Host remote calls resolve to a result envelope ({ ok, value }); accept the bare catalog too.
  const root = (envelope?.ok === true && envelope.value && typeof envelope.value === 'object' && !Array.isArray(envelope.value)
    ? envelope.value as Record<string, unknown>
    : undefined) ?? envelope ?? {}
  const groups = Array.isArray(root.groups) ? root.groups : []
  const choices: CatalogChoice[] = []
  for (const group of groups) {
    if (!group || typeof group !== 'object') continue
    const row = group as Record<string, unknown>
    const provider = typeof row.id === 'string' ? row.id : ''
    const providerName = typeof row.name === 'string' && row.name ? row.name : provider
    if (!provider || !Array.isArray(row.models)) continue
    for (const model of row.models) {
      if (!model || typeof model !== 'object') continue
      const item = model as Record<string, unknown>
      const id = typeof item.id === 'string' ? item.id : ''
      if (!id) continue
      const name = typeof item.name === 'string' && item.name ? item.name : id
      choices.push({ provider, model: id, label: `${providerName} / ${name}` })
    }
  }
  if (selected.provider && selected.model && !choices.some(item => item.provider === selected.provider && item.model === selected.model)) {
    choices.push({ provider: selected.provider, model: selected.model, label: `${selected.provider} / ${selected.model}` })
  }
  return choices
}

export function TitleSettings(props: {
  client: Client
  marker: { active: boolean }
  subscribeSettings?: (change: () => void, error?: (message: string) => void) => () => void
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
  const [choices, setChoices] = useState<CatalogChoice[]>([])
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
    const catalog = props.client.remote?.session?.modelCatalog
    if (!catalog) return undefined
    let live = true
    void catalog().then(value => {
      if (live) setChoices(catalogChoices(value, status?.settings.model ?? { provider: '', model: '' }))
    }).catch(() => { if (live) setChoices([]) })
    return () => { live = false }
  }, [props.client, status?.settings.model.provider, status?.settings.model.model])

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
      if (dirty.current && !busyRef.current) { external.current = true; setExternalChange(true) }
      syncRef.current()
    }, message => { if (live) setSyncError(message) })
    return () => { live = false; stop?.() }
  }, [props.subscribeSettings, props.client])

  const savedPrompt = status?.settings.prompt ?? ''
  const savedModel = status?.settings.model ?? { provider: '', model: '' }
  const selectableChoices = choices.some(choice => choice.provider === savedModel.provider && choice.model === savedModel.model)
    ? choices : [...choices, ...catalogChoices({}, savedModel)]
  const modelKey = savedModel.provider && savedModel.model ? `${savedModel.provider}\u001f${savedModel.model}` : ''
  const title = status?.session?.title
  const pinned = status?.session?.pinned === true
  const weOwn = status?.support.weOwn === true
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

  return <section className="current-title-settings ct-root dsh-ui-panel" lang={seat.locale} data-testid="current-title-settings">
    {!status && !error ? <p role="status" className="dsh-ui-hint">{text.loading}</p> : null}
    {title ? <p translate="no" className="dsh-ui-title dsh-ui-wrap">{title}</p> : null}
    {pinned ? <p className="dsh-ui-meta">{text.pinned}</p> : null}
    {status?.session?.generating ? <p role="status" className="dsh-ui-hint">{text.generating}</p> : null}
    {status && !weOwn ? <p role="status" className="dsh-ui-hint">{text.inactive}{status.support.limitation ? ` ${titleMessage(status.support.limitation, seat.locale)}` : ''}</p> : null}
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
    <label className="dsh-ui-field">
      <span className="dsh-ui-label">{text.prompt}</span>
      <textarea
        className="ct-prompt"
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
    <label className="dsh-ui-field">
      <span className="dsh-ui-label">{text.model}</span>
      <select
        className="dsh-ui-select"
        value={modelKey}
        disabled={busy || loadingSettings || !status}
        onChange={event => {
          const value = event.target.value
          const choice = selectableChoices.find(item => `${item.provider}\u001f${item.model}` === value)
          saveSettings({
            model: choice ? { provider: choice.provider, model: choice.model } : { provider: '', model: '' },
          })
        }}
      >
        <option value="">{text.modelDefault}</option>
        {selectableChoices.map(choice => (
          <option key={`${choice.provider}\u001f${choice.model}`} value={`${choice.provider}\u001f${choice.model}`}>{choice.label}</option>
        ))}
      </select>
    </label>
    <label className="dsh-ui-field">
      <span className="dsh-ui-label">{text.cadence}</span>
      <select
        className="dsh-ui-select"
        value={status?.settings.cadence ?? 'all-prompts'}
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
}

/* The contract owns every type tier, the field rhythm, the focus ring and the
 * select shell. The only geometry left here is this panel's own: its reading
 * width, and the prompt box — the one control the primitives do not ship, which
 * borrows the select's 34px / 0.5px l4 / radius-md shell at a taller size. */
const styles = `${officialUiCss('ct-root')}
.ct-root { max-width: 760px; }
.ct-prompt {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 96px;
  resize: vertical;
  padding: 8px 12px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-3);
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary);
}
.ct-prompt:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
.ct-prompt::placeholder { color: var(--dsw-alias-label-dimmed); }
`

declare module '@deepseek-ai/cordis' {
  interface Context { dshCurrentTitleClient: { active: boolean } }
}

export function apply(ctx: Context): void {
  const client = ctx as unknown as Client
  const settingsSubscriber = createModelSettingsSubscriber(ctx, '@klarkxy/dsh-current-title')
  const subscribeSettings = (change: () => void, error?: (message: string) => void) => settingsSubscriber.subscribe(change, error)
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
  ctx.effect(() => client.slots.inject('plugins.bundle.config', () => client.slots.register(
    { name: 'plugins.bundle.config', key: '@klarkxy/dsh-current-title' },
    // A slot component never receives `ctx`: the host composes its own props, and a
    // Cordis context throws on any undeclared property read (so feeding one back
    // through `useNativeSeat` crashed the entry and abdicated the keyed cell).
    // The client and marker stay in the apply closure instead.
    () => <TitleSettings client={client} marker={marker} subscribeSettings={subscribeSettings} />,
  )), 'current-title.settings')
  ctx.effect(() => {
    let live = true
    void client.connection.rpc.call(RPC_CHANNEL, 'status', {}).then(result => {
      const row = result as RpcResult<TitleStatus>
      if (!live) return
      applyMarkerFromStatus(marker, row?.ok ? row.value : undefined, live)
    }).catch(() => { if (live) applyMarkerFromStatus(marker, undefined, live) })
    return () => { live = false; disposeTitleClientMarker(marker) }
  }, 'current-title.marker')
}
