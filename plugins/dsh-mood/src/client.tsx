import type { Context } from '@deepseek-ai/cordis'
import { useFeatureRefresh, useNativeSeat, type NativeSurfaceClient } from '@klarkxy/dsh-plugin-kit/client-utils'
import {
  modelMenuChoiceKey, modelMenuEffortOptions, parseModelMenuChoiceKey, parseModelMenuChoices, type ModelMenuChoice,
} from '@klarkxy/dsh-plugin-kit/model-menu'
import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'
import {
  CHAT_EVENTS_SLOT, MOOD_PLUGIN, MOOD_RPC_CHANNEL, defaultModelRoute,
  type MoodLocale, type MoodModelRoute, type MoodStatus, type RpcResult, type TaskContract,
} from './contracts.ts'
import { readinessLabel } from './contracts.ts'

export const name = 'dsh-mood-client'
export const inject = ['slots', 'connection', 'remote', 'remote.session', 'sessions', 'locale', 'uiWorkspace', 'uiSession'] as const

type Client = NativeSurfaceClient & {
  connection: {
    rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<unknown> }
    generation?: { subscribe(listener: () => void): () => void }
  }
  remote?: { session?: { modelCatalog?: () => Promise<unknown> } }
  slots: {
    inject(key: string, callback: () => unknown): () => void
    register(spec: { name: string; id: string; label: string; order: number } | { name: string; key: string }, render: unknown): () => void
  }
}

export interface MoodSeatProps { sessionId?: string; locale?: MoodLocale; hidden?: boolean }

/** `fallback` is the localized message used when the response is not an RpcResult at all. */
function unwrap<T>(result: RpcResult<T> | unknown, fallback = 'Request failed.'): T {
  const row = result as RpcResult<T>
  if (!row || typeof row !== 'object' || !('ok' in row)) throw new Error(fallback)
  if (!row.ok) throw new Error(row.error.message)
  return row.value
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

export function copy(locale: MoodLocale) {
  if (locale === 'en') return {
    settings: 'Requirement clarification',
    model: 'Requirement analysis model', modelDefault: 'Default model', modelEffort: 'Reasoning effort',
    modelEffortDefault: 'Default', modelHint: 'Leave empty to use the current session model, then the default chat model.',
    loading: 'Summarizing…', modelLoadFailed: 'Unable to load settings.', saveFailed: 'Unable to save settings.',
    requestFailed: 'Request failed.', loadFailed: 'Unable to load the task summary.', actionFailed: 'Something went wrong.',
    hint: 'Summarizes what you asked for in a session so the assistant can work without extra questions.',
    card: 'Task summary', amend: 'Edit', reanalyze: 'Summarize requirements', retry: 'Retry original request', save: 'Save', cancel: 'Cancel',
    empty: 'No task summary yet. Use “Summarize requirements” to create one.', goal: 'Goal', evidence: 'Based on', questions: 'Open questions',
    evidenceFallback: (seq: number) => `Chat message #${seq}`, separator: ': ',
    recovery: 'An older version kept one request you can retry. It does not block new work or grant approval.',
    sessionHint: 'Open a session to summarize its requirements.',
  }
  return {
    settings: '需求澄清',
    model: '需求梳理模型', modelDefault: '默认模型', modelEffort: '思考强度',
    modelEffortDefault: '默认', modelHint: '留空则使用当前会话模型，再回落到默认对话模型。',
    loading: '正在梳理…', modelLoadFailed: '无法读取设置。', saveFailed: '无法保存设置。',
    requestFailed: '请求失败。', loadFailed: '无法读取任务摘要。', actionFailed: '操作失败。',
    hint: '整理你在会话中提出的要求，让助手少问多做。',
    card: '任务摘要', amend: '修改', reanalyze: '梳理需求', retry: '按原请求重试', save: '保存', cancel: '取消',
    empty: '还没有任务摘要。点“梳理需求”生成一份。', goal: '目标', evidence: '依据', questions: '待确认的问题',
    evidenceFallback: (seq: number) => `会话消息 #${seq}`, separator: '：',
    recovery: '旧版本保留了一条可以重试的请求。它不会阻塞新任务，也不代表已获执行授权。',
    sessionHint: '打开一个会话后，可梳理该会话的需求。',
  }
}

export function shouldShowCard(hidden: boolean, contract: TaskContract | undefined, pendingManual: boolean, recovery = false): boolean {
  if (hidden) return false
  return pendingManual || recovery || Boolean(contract && contract.readiness !== 'stale' && contract.evidence.some(ref => ref.kind === 'manual'))
}

export function isCurrentMoodRequest(input: {
  mounted: boolean; sessionId: string; viewSessionId: string; requestId: number; latestRequestId: number
}): boolean {
  return input.mounted && input.sessionId === input.viewSessionId && input.requestId === input.latestRequestId
}

export function shouldSkipMoodRefresh(input: { busy: boolean; editing?: boolean }): boolean {
  return input.busy || input.editing === true
}

/** Read-only status peek; never interrupts an in-flight edit or write. */
export async function peekMoodStatus(input: {
  call: (endpoint: string, payload: unknown) => Promise<unknown>
  sessionId: string; requestId: number; latestRequestId: () => number; viewSessionId: () => string
  mounted: () => boolean; busy: () => boolean; editing?: () => boolean
}): Promise<MoodStatus | undefined> {
  if (shouldSkipMoodRefresh({ busy: input.busy(), editing: input.editing?.() === true })) return undefined
  if (!input.sessionId || input.requestId === 0) return undefined
  try {
    const next = unwrap<MoodStatus>(await input.call('status', { sessionId: input.sessionId }))
    if (shouldSkipMoodRefresh({ busy: input.busy(), editing: input.editing?.() === true })) return undefined
    if (!isCurrentMoodRequest({
      mounted: input.mounted(), sessionId: input.sessionId, viewSessionId: input.viewSessionId(),
      requestId: input.requestId, latestRequestId: input.latestRequestId(),
    })) return undefined
    return next
  } catch { return undefined }
}

export function shouldOfferRecovery(status: MoodStatus | undefined): boolean {
  return Boolean(status?.session?.held)
}

function MoodContractCard({ client, sessionId, locale, hidden, surface = 'chat' }: MoodSeatProps & {
  client: Client; surface?: 'chat' | 'settings'
}) {
  const text = copy(locale === 'en' ? 'en' : 'zh')
  const [status, setStatus] = useState<MoodStatus>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [goal, setGoal] = useState('')
  const headingId = useId()
  const requestId = useRef(0)
  const viewSession = useRef(sessionId ?? '')
  const liveRef = useRef(true)
  const busyRef = useRef(false)
  const editingRef = useRef(false)
  busyRef.current = busy
  editingRef.current = editing

  async function call<T>(endpoint: string, payload: unknown): Promise<T> {
    return unwrap(await client.connection.rpc.call(MOOD_RPC_CHANNEL, endpoint, payload) as RpcResult<T>, text.requestFailed)
  }
  function current(view: string, id: number): boolean {
    return isCurrentMoodRequest({ mounted: liveRef.current, sessionId: view, viewSessionId: viewSession.current, requestId: id, latestRequestId: requestId.current })
  }
  useEffect(() => { liveRef.current = true; return () => { liveRef.current = false } }, [])
  useEffect(() => {
    viewSession.current = sessionId ?? ''
    const id = ++requestId.current
    setStatus(undefined); setEditing(false); setError(''); setBusy(false)
    if (!sessionId) return
    let mounted = true
    void call<MoodStatus>('status', { sessionId }).then(next => {
      if (!mounted || !current(sessionId, id)) return
      setStatus(next); setGoal(next.session?.contract?.goal ?? '')
    }).catch(cause => {
      if (mounted && current(sessionId, id)) setError(errorText(cause, text.loadFailed))
    })
    return () => { mounted = false }
  }, [client, sessionId])

  useFeatureRefresh(client, sessionId ?? '', () => {
    void peekMoodStatus({
      call: (endpoint, payload) => client.connection.rpc.call(MOOD_RPC_CHANNEL, endpoint, payload),
      sessionId: viewSession.current, requestId: requestId.current,
      latestRequestId: () => requestId.current, viewSessionId: () => viewSession.current,
      mounted: () => liveRef.current, busy: () => busyRef.current, editing: () => editingRef.current,
    }).then(next => {
      if (!next) return
      setStatus(next)
      if (!editingRef.current) setGoal(next.session?.contract?.goal ?? '')
    })
  }, Boolean(status?.session?.pendingManual) && !busy, Boolean(sessionId) && (surface === 'settings' || !hidden))

  const contract = status?.session?.contract
  const pendingManual = Boolean(status?.session?.pendingManual)
  const recovery = shouldOfferRecovery(status)
  if (surface !== 'settings' && !shouldShowCard(Boolean(hidden), contract, pendingManual, recovery)) return null

  async function action(endpoint: string, payload: unknown) {
    if (busyRef.current) return
    const id = requestId.current, view = viewSession.current
    busyRef.current = true; setBusy(true); setError('')
    try {
      const next = await call<MoodStatus>(endpoint, payload)
      if (!current(view, id)) return
      setStatus(next); setGoal(next.session?.contract?.goal ?? '')
      if (endpoint === 'edit') setEditing(false)
    } catch (cause) {
      if (current(view, id)) setError(errorText(cause, text.actionFailed))
    } finally {
      if (current(view, id)) { busyRef.current = false; setBusy(false) }
    }
  }

  return <article className="mood-card dsh-ui-card" data-testid="mood-contract-card" data-session={sessionId || undefined}>
    {error ? <p role="alert" className="dsh-ui-error">{error}</p> : null}
    {pendingManual ? <p role="status" className="dsh-ui-hint">{text.loading}</p> : null}
    {recovery ? <p role="status" className="dsh-ui-banner dsh-ui-banner--info">{text.recovery}</p> : null}
    <details open={surface === 'settings' || recovery || pendingManual || undefined}>
      <summary className="mood-summary dsh-ui-heading">{text.card}{contract?.goal ? `${text.separator}${contract.goal.slice(0, 60)}` : ''}</summary>
      <div className="mood-details dsh-ui-stack">
        {contract ? <p className="dsh-ui-meta">{readinessLabel(contract.readiness, locale === 'en' ? 'en' : 'zh')}</p> : null}
        <p className="dsh-ui-wrap">{contract?.goal ? `${text.goal}${text.separator}${contract.goal}` : text.empty}</p>
        {contract?.evidence.length ? <section className="dsh-ui-readonly">
          <h4 className="dsh-ui-label" id={`${headingId}-evidence`}>{text.evidence}</h4>
          <ul className="mood-items dsh-ui-compact" aria-labelledby={`${headingId}-evidence`}>
            {contract.evidence.map((item, index) => <li key={`${item.kind}-${item.seq}-${index}`}>{item.excerpt ?? text.evidenceFallback(item.seq)}</li>)}
          </ul>
        </section> : null}
        {contract?.questions.length ? <section className="dsh-ui-readonly">
          <h4 className="dsh-ui-label" id={`${headingId}-questions`}>{text.questions}</h4>
          <ul className="mood-items dsh-ui-compact" aria-labelledby={`${headingId}-questions`}>
            {contract.questions.map((question, index) => <li key={index}>{question}</li>)}
          </ul>
        </section> : null}
        {(status?.session?.clarification ?? []).filter(item => item.status === 'answered').map(item => (
          <p className="dsh-ui-wrap" key={item.id}>{item.question}{item.answer ? ` → ${item.answer}` : ''}</p>
        ))}
        {editing ? <label className="dsh-ui-field">
          <span className="dsh-ui-label">{text.goal}</span>
          <textarea className="mood-text" aria-label={text.goal} rows={3} value={goal} disabled={busy}
            onChange={event => setGoal(event.target.value)} />
        </label> : null}
        <div className="dsh-ui-actions">
          <Button variant="primary" size="sm" disabled={busy || !contract} onClick={() => {
            if (editing && contract && sessionId) {
              void action('edit', { sessionId, expectedRevision: contract.revision, patch: { goal } })
            } else setEditing(true)
          }}>{editing ? text.save : text.amend}</Button>
          {editing ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => {
            // Discard the draft and restore the stored goal.
            setGoal(contract?.goal ?? ''); setEditing(false)
          }}>{text.cancel}</Button> : null}
          <Button variant="outline" size="sm" disabled={busy || !sessionId} onClick={() => {
            if (sessionId) void action('manual', { sessionId })
          }}>{text.reanalyze}</Button>
          {recovery ? <Button variant="outline" size="sm" disabled={busy || !sessionId} onClick={() => {
            if (sessionId) void action('retry', { sessionId })
          }}>{text.retry}</Button> : null}
        </div>
      </div>
    </details>
  </article>
}

export function moodPanelKey(sessionId: string, locale: MoodLocale): string { return `${sessionId}:${locale}` }

/** Plugin-page model select for the one analysis purpose this plugin registers. */
function MoodModelMenu({ client, locale }: { client: Client; locale: MoodLocale }) {
  const text = copy(locale)
  const [status, setStatus] = useState<MoodStatus>()
  const [choices, setChoices] = useState<ModelMenuChoice[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const route = status?.settings.model ?? defaultModelRoute()
  const selected = choices.find(item => item.provider === route.provider && item.model === route.model)
  const efforts = modelMenuEffortOptions(selected, route.reasoningEffort)

  // Load once per client/locale. Saving only updates `status`, so it must not refetch;
  // the catalog is parsed against the saved route read here.
  useEffect(() => {
    let live = true
    void (async () => {
      let saved: MoodModelRoute = defaultModelRoute()
      try {
        const next = unwrap<MoodStatus>(await client.connection.rpc.call(MOOD_RPC_CHANNEL, 'status', {}), text.requestFailed)
        if (!live) return
        setStatus(next)
        saved = next.settings.model ?? saved
      } catch (cause) {
        if (live) setError(errorText(cause, text.modelLoadFailed))
      }
      try {
        const value = await client.remote?.session?.modelCatalog?.()
        if (live) setChoices(parseModelMenuChoices(value, saved))
      } catch {
        if (live) setChoices([])
      }
    })()
    return () => { live = false }
  }, [client, locale])

  async function save(next: MoodModelRoute): Promise<void> {
    if (!status) return
    setBusy(true); setError('')
    try {
      const value = unwrap<MoodStatus>(await client.connection.rpc.call(MOOD_RPC_CHANNEL, 'model', {
        expectedRevision: status.settings.revision, model: next,
      }))
      setStatus(value)
    } catch (cause) {
      setError(errorText(cause, text.saveFailed))
      const fresh = await client.connection.rpc.call(MOOD_RPC_CHANNEL, 'status', {}).then(result => {
        try { return unwrap<MoodStatus>(result) } catch { return undefined }
      }).catch(() => undefined)
      if (fresh) setStatus(fresh)
    } finally {
      setBusy(false)
    }
  }

  return <section className="dsh-ui-stack" data-testid="mood-model">
    {error && <p role="alert" className="dsh-ui-error">{error}</p>}
    <label className="dsh-ui-field">
      <span className="dsh-ui-label">{text.model}</span>
      <select
        className="dsh-ui-select"
        value={modelMenuChoiceKey(route.provider, route.model)}
        disabled={busy || !status}
        onChange={event => {
          const key = event.target.value
          if (!key) { void save(defaultModelRoute()); return }
          const parsed = parseModelMenuChoiceKey(key)
          if (parsed) void save(parsed)
        }}
      >
        <option value="">{text.modelDefault}</option>
        {choices.map(choice => (
          <option key={modelMenuChoiceKey(choice.provider, choice.model)} value={modelMenuChoiceKey(choice.provider, choice.model)}>
            {choice.label}
          </option>
        ))}
      </select>
    </label>
    {selected && efforts.length > 0 && (
      <label className="dsh-ui-field">
        <span className="dsh-ui-label">{text.modelEffort}</span>
        <select
          className="dsh-ui-select"
          value={route.reasoningEffort ?? ''}
          disabled={busy}
          onChange={event => void save({ ...route, reasoningEffort: event.target.value || undefined })}
        >
          <option value="">{text.modelEffortDefault}</option>
          {efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
        </select>
      </label>
    )}
    <p className="dsh-ui-help">{text.modelHint}</p>
  </section>
}

/**
 * Plugin page: model menu plus the current session's task summary, which is the
 * persistent entry to "Summarize requirements" (the chat card only appears once
 * a summary was requested). The host page already shows the plugin title.
 */
export function MoodSettings({ client, props }: { client: Client; props: unknown }) {
  const seat = useNativeSeat(client, props)
  const text = copy(seat.locale)
  return <div className="mood-settings-root dsh-ui-panel" data-testid="mood-settings-root" data-session={seat.sessionId || undefined}>
    <section className="mood-settings dsh-ui-card" data-testid="mood-settings">
      <p className="dsh-ui-hint">{text.hint}</p>
      <MoodModelMenu client={client} locale={seat.locale} />
    </section>
    {seat.sessionId
      ? <MoodContractCard key={`contract:${moodPanelKey(seat.sessionId, seat.locale)}`} client={client}
          sessionId={seat.sessionId} locale={seat.locale} surface="settings" />
      : <p className="dsh-ui-empty">{text.sessionHint}</p>}
  </div>
}

export function MoodChatCard({ client, props }: { client: Client; props: unknown }) {
  const seat = useNativeSeat(client, props)
  if (seat.hidden || !seat.sessionId) return null
  return <MoodContractCard key={moodPanelKey(seat.sessionId, seat.locale)} client={client}
    sessionId={seat.sessionId} locale={seat.locale} hidden={seat.hidden} />
}

const css = `${officialUiCss(['mood-settings-root', 'mood-card'])}
/* The card and the plugin page take their measure and rhythm from the contract;
 * only the native disclosure header, the evidence lists and the multi-line
 * field — none of which the primitives cover — keep geometry here. */
.mood-settings-root { max-width: 760px; }
.mood-summary { cursor: pointer; list-style: revert; overflow-wrap: anywhere; }
.mood-details { margin-top: 12px; }
.mood-items {
  display: grid;
  gap: 4px;
  margin: 0;
  padding-inline-start: 1.2em;
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}
.mood-text {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 8px 10px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-3);
  font: inherit;
  color: var(--dsw-alias-label-primary);
  resize: vertical;
}
.mood-text:focus-visible { outline: none; border-color: var(--dsw-alias-state-business-primary); }
.mood-text:disabled { color: var(--dsw-alias-label-tertiary); }
`

export function apply(ctx: Context): void {
  const client = ctx as unknown as Client
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-plugin', '@klarkxy/dsh-mood'); style.textContent = css
    document.head.appendChild(style)
    return () => style.remove()
  }, 'dsh-mood.styles')
  ctx.effect(() => client.slots.inject('plugins.bundle.config', () => client.slots.register(
    { name: 'plugins.bundle.config', key: MOOD_PLUGIN },
    (props: unknown) => <MoodSettings client={client} props={props} />,
  )), 'dsh-mood.settings')
  ctx.effect(() => client.slots.inject(CHAT_EVENTS_SLOT, () => client.slots.register({
    name: CHAT_EVENTS_SLOT, id: 'mood', order: 10, label: copy('zh').settings,
  }, (props: unknown) => <MoodChatCard client={client} props={props} />)), 'dsh-mood.card')
}
