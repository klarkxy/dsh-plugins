import type { Context } from '@deepseek-ai/cordis'
import type { NativeSurfaceClient } from '@klarkxy/dsh-plugin-kit/client-utils'
import { useFeatureRefresh, useNativeSeat } from '@klarkxy/dsh-plugin-kit/client-utils'
import { useCallback, useEffect, useRef, useState } from 'react'
import { RPC_CHANNEL, TITLE_CLIENT_SERVICE, type RpcResult, type TitleModelRoute, type TitleStatus } from './contracts.ts'
import {
  createTitleClientWork, runTitleRegenerateFlow, runTitleSettingsSave, runTitleStatusLoad,
  shouldSkipTitleRefresh, titleCopy, type TitleClientCall, type TitleClientWork,
} from './client-work.ts'
import { applyMarkerFromStatus, createTitleClientMarker, disposeTitleClientMarker } from './marker.ts'

export const name = 'dsh-current-title-client'
export const inject = ['slots', 'connection', 'remote', 'sessions', 'locale', 'uiWorkspace', 'uiSession'] as const
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
  efforts: ReadonlyArray<{ id: string; name: string }>
}

function catalogChoices(value: unknown, selected: TitleModelRoute): CatalogChoice[] {
  const root = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
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
      const reasoning = item.reasoning && typeof item.reasoning === 'object' ? item.reasoning as Record<string, unknown> : undefined
      const efforts = Array.isArray(reasoning?.efforts)
        ? reasoning.efforts.flatMap(effort => {
          if (!effort || typeof effort !== 'object') return []
          const entry = effort as Record<string, unknown>
          return typeof entry.id === 'string' && entry.id ? [{ id: entry.id, name: typeof entry.name === 'string' && entry.name ? entry.name : entry.id }] : []
        })
        : []
      choices.push({ provider, model: id, label: `${providerName} / ${name}`, efforts })
    }
  }
  if (selected.provider && selected.model && !choices.some(item => item.provider === selected.provider && item.model === selected.model)) {
    choices.push({ provider: selected.provider, model: selected.model, label: `${selected.provider} / ${selected.model}`, efforts: [] })
  }
  return choices
}

export function TitleSettings(props: {
  client: Client
  marker: { active: boolean }
  owner?: unknown
}) {
  const seat = useNativeSeat(props.client, props.owner)
  const sessionId = seat.sessionId
  const text = titleCopy[seat.locale]
  const [status, setStatus] = useState<TitleStatus>()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [prompt, setPrompt] = useState('')
  const [choices, setChoices] = useState<CatalogChoice[]>([])
  const workRef = useRef<TitleClientWork>(undefined)
  if (!workRef.current) workRef.current = createTitleClientWork()
  const work = workRef.current
  const busyRef = useRef(busy)
  busyRef.current = busy

  const call: TitleClientCall = (endpoint, payload = {}) => (
    props.client.connection.rpc.call(RPC_CHANNEL, endpoint, payload)
  )

  function commitMarker(next: TitleStatus | undefined) {
    applyMarkerFromStatus(props.marker, next, true)
  }

  useEffect(() => () => { work.dispose() }, [work])

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
    const isCurrent = () => work.isLoad(generation)
    setBusy(false)
    setError('')
    setNote('')
    void runTitleStatusLoad({
      call,
      sessionId: sessionId || undefined,
      isCurrent,
      failedMessage: text.failed,
      onStatus: setStatus,
      onError: setError,
      onMarker: commitMarker,
    })
    return () => { if (work.isLoad(generation)) work.beginLoad() }
  }, [props.client, props.marker, sessionId, text.failed, work])

  const refreshStatus = useCallback(() => {
    if (shouldSkipTitleRefresh({ busy: busyRef.current }) || work.disposed) return
    const generation = work.captureLoad()
    void runTitleStatusLoad({
      call,
      sessionId: sessionId || undefined,
      isCurrent: () => work.isLoad(generation) && !shouldSkipTitleRefresh({ busy: busyRef.current }),
      failedMessage: text.failed,
      onStatus: next => {
        if (shouldSkipTitleRefresh({ busy: busyRef.current })) return
        setStatus(next)
      },
      onError: () => {},
      onMarker: next => {
        if (shouldSkipTitleRefresh({ busy: busyRef.current })) return
        commitMarker(next)
      },
    })
  }, [props.client, props.marker, sessionId, text.failed, work])

  useFeatureRefresh(
    props.client,
    sessionId,
    refreshStatus,
    status?.session?.generating === true && !busy,
    Boolean(sessionId),
  )

  const savedPrompt = status?.settings.prompt ?? ''
  const savedModel = status?.settings.model ?? { provider: '', model: '' }
  const modelKey = savedModel.provider && savedModel.model ? `${savedModel.provider}\u001f${savedModel.model}` : ''
  const title = status?.session?.title
  const pinned = status?.session?.pinned === true
  const weOwn = status?.support.weOwn === true
  const canRegenerate = Boolean(sessionId) && weOwn && !busy

  return <section className="current-title-settings" data-testid="current-title-settings">
    {!status && !error ? <p role="status">{seat.locale === 'en' ? 'Loading title settings…' : '正在读取标题设置…'}</p> : null}
    {title ? <p translate="no">{title}</p> : null}
    {pinned ? <p className="current-title-meta">{text.pinned}</p> : null}
    {status?.session?.generating ? <p role="status">{text.generating}</p> : null}
    {status && !weOwn ? <p role="status">{text.inactive}{status.support.limitation ? ` ${status.support.limitation}` : ''}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {note ? <p role="status">{note}</p> : null}
    {sessionId ? <button type="button" disabled={!canRegenerate} aria-label={text.regenerate}
      onClick={() => {
        if (!sessionId) return
        const token = work.beginRequest()
        setError('')
        setNote('')
        void runTitleRegenerateFlow({
          call,
          sessionId,
          isCurrent: () => work.isRequest(token),
          failedMessage: text.failed,
          onBusy: setBusy,
          onStatus: setStatus,
          onError: setError,
          onMarker: commitMarker,
        })
      }}>{text.regenerate}</button> : null}
    <label>
      {text.prompt}
      <textarea
        value={status ? prompt || savedPrompt : ''}
        maxLength={4000}
        rows={5}
        disabled={busy || !status}
        aria-label={text.prompt}
        placeholder={text.promptHint}
        onChange={event => { setPrompt(event.target.value); setNote('') }}
        onBlur={() => {
          if (!status) return
          const next = (prompt || savedPrompt).trim()
          if (next === savedPrompt) return
          const token = work.beginRequest()
          setError('')
          void runTitleSettingsSave({
            call,
            prompt: next,
            expectedRevision: status.settings.revision,
            isCurrent: () => work.isRequest(token),
            savedMessage: text.saved,
            failedMessage: text.failed,
            onBusy: setBusy,
            onSettings: settings => { setStatus(current => current ? { ...current, settings } : current); setPrompt(settings.prompt) },
            onNote: setNote,
            onError: setError,
          })
        }}
      />
      <span className="current-title-meta">{text.promptHint}</span>
    </label>
    <label>
      {text.model}
      <select
        value={modelKey}
        disabled={busy || !status}
        aria-label={text.model}
        onChange={event => {
          if (!status) return
          const value = event.target.value
          const choice = choices.find(item => `${item.provider}\u001f${item.model}` === value)
          const model: TitleModelRoute = choice
            ? { provider: choice.provider, model: choice.model }
            : { provider: '', model: '' }
          const token = work.beginRequest()
          setError('')
          setNote('')
          void runTitleSettingsSave({
            call,
            model,
            expectedRevision: status.settings.revision,
            isCurrent: () => work.isRequest(token),
            savedMessage: text.saved,
            failedMessage: text.failed,
            onBusy: setBusy,
            onSettings: settings => setStatus(current => current ? { ...current, settings } : current),
            onNote: setNote,
            onError: setError,
          })
        }}
      >
        <option value="">{text.modelDefault}</option>
        {choices.map(choice => (
          <option key={`${choice.provider}\u001f${choice.model}`} value={`${choice.provider}\u001f${choice.model}`}>{choice.label}</option>
        ))}
      </select>
    </label>
    <label>
      {text.cadence}
      <select
        value={status?.settings.cadence ?? 'all-prompts'}
        disabled={busy || !status}
        aria-label={text.cadence}
        onChange={event => {
          if (!status) return
          const cadence = event.target.value === 'first-prompt' ? 'first-prompt' as const : 'all-prompts' as const
          const token = work.beginRequest()
          setError('')
          setNote('')
          void runTitleSettingsSave({
            call,
            cadence,
            expectedRevision: status.settings.revision,
            isCurrent: () => work.isRequest(token),
            savedMessage: text.saved,
            failedMessage: text.failed,
            onBusy: setBusy,
            onSettings: settings => setStatus(current => current ? { ...current, settings } : current),
            onNote: setNote,
            onError: setError,
          })
        }}
      >
        <option value="all-prompts">{text.cadenceAll}</option>
        <option value="first-prompt">{text.cadenceFirst}</option>
      </select>
    </label>
  </section>
}

const styles = `
.current-title-settings{display:grid;gap:8px;color:inherit;font:400 var(--font-size-2,14px)/1.5 var(--default-font-family,system-ui,sans-serif)}
.current-title-settings p{margin:0}
.current-title-settings p[translate="no"]{overflow-wrap:anywhere}
.current-title-meta{font-size:var(--font-size-1,13px);color:var(--gray-11,inherit)}
.current-title-settings button{min-height:34px;padding:6px 12px;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:8px;background:transparent;color:inherit;cursor:pointer;font:inherit;justify-self:start;transition:background-color 150ms ease,color 150ms ease,border-color 150ms ease,box-shadow 150ms ease,transform 150ms ease}
.current-title-settings button:hover:not(:disabled){background:var(--gray-3,color-mix(in srgb,currentColor 6%,transparent));border-color:color-mix(in srgb,currentColor 35%,transparent)}
.current-title-settings button:active:not(:disabled){transform:scale(.97)}
.current-title-settings button:disabled{opacity:.45;cursor:not-allowed}
.current-title-settings label{display:grid;gap:6px}
.current-title-settings textarea,.current-title-settings select{width:100%;box-sizing:border-box;border:1px solid var(--gray-6,color-mix(in srgb,currentColor 18%,transparent));border-radius:8px;background:transparent;color:inherit;font:inherit;padding:8px}
.current-title-settings textarea{min-height:96px;resize:vertical}
.current-title-settings :focus-visible{outline:2px solid currentColor;outline-offset:3px}
@media(prefers-reduced-motion:reduce){.current-title-settings button{transition:none}}
`

declare module '@deepseek-ai/cordis' {
  interface Context { dshCurrentTitleClient: { active: boolean } }
}

export function apply(ctx: Context): void {
  const client = ctx as unknown as Client
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
    () => <TitleSettings client={client} marker={marker} owner={ctx} />,
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
