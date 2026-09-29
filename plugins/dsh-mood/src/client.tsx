import type { Context } from '@deepseek-ai/cordis'
import { useFeatureRefresh, useNativeSeat, type NativeSurfaceClient } from '@klarkxy/dsh-plugin-kit/client-utils'
import {
  modelMenuChoiceKey, modelMenuEffortOptions, parseModelMenuChoiceKey, parseModelMenuChoices, type ModelMenuChoice,
} from '@klarkxy/dsh-plugin-kit/model-menu'
import { useEffect, useRef, useState } from 'react'
import {
  CHAT_EVENTS_SLOT, MOOD_PLUGIN, MOOD_RPC_CHANNEL, defaultModelRoute,
  type MoodLocale, type MoodMode, type MoodModelRoute, type MoodStatus, type RpcResult, type TaskContract,
} from './contracts.ts'
import { readinessLabel } from './contracts.ts'

export const name = 'dsh-mood-client'
export const inject = ['slots', 'connection', 'remote', 'sessions', 'locale', 'uiWorkspace', 'uiSession'] as const

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

function unwrap<T>(result: RpcResult<T> | unknown): T {
  const row = result as RpcResult<T>
  if (!row || typeof row !== 'object' || !('ok' in row)) throw new Error('请求失败。')
  if (!row.ok) throw new Error(row.error.message)
  return row.value
}

export function copy(locale: MoodLocale) {
  if (locale === 'en') return {
    settings: 'Requirements', auto: 'Auto', manual: 'Manual', strict: 'Strict',
    model: 'Requirements analysis model', modelDefault: 'Default model', modelEffort: 'Reasoning effort',
    modelEffortDefault: 'Default', modelHint: 'Leave empty to use the current session model, then the host default chat model.',
    loading: 'Summarizing…', modelLoading: 'Loading…', stale: 'Settings changed; refresh and retry.',
    hint: 'Proceed autonomously by default. Investigate first, use safe defaults, and ask only for genuine blockers. Native approvals remain unchanged.',
    card: 'Optional task notes', amend: 'Amend', reanalyze: 'Summarize requirements', retry: 'Retry original', save: 'Save',
    empty: 'No optional task notes.', goal: 'Goal', evidence: 'Evidence', questions: 'Open points',
    recovery: 'A request held by an older Mood version is available for explicit retry. It does not block new work or grant approval.',
    sessionHint: 'Select a session to summarize its requirements on demand.',
  }
  return {
    settings: '需求澄清', auto: '自动', manual: '手动', strict: '严格',
    model: '需求梳理模型', modelDefault: '默认模型', modelEffort: '思考强度',
    modelEffortDefault: '默认', modelHint: '留空则使用当前会话模型，再回落到宿主默认对话模型。',
    loading: '正在梳理…', modelLoading: '正在读取设置…', stale: '设置已更新，请刷新后重试。',
    hint: '默认自主推进：先调查，采用低风险默认方案，仅在真正阻塞时询问。原生权限与审批保持不变。',
    card: '可选任务摘要', amend: '修订', reanalyze: '梳理需求', retry: '按原请求重试', save: '保存',
    empty: '还没有可选任务摘要。', goal: '目标', evidence: '证据', questions: '未决事项',
    recovery: '旧版 Mood 保留了一条可主动重试的请求。它不阻塞新任务，也不代表已获执行授权。',
    sessionHint: '选择一个会话后，可按需梳理该会话的需求。',
  }
}

/** Legacy export; mode selection is no longer shown in the UI. */
export function modeFromKey(current: MoodMode, key: string): MoodMode | undefined {
  const order: MoodMode[] = ['auto', 'manual', 'strict']
  const index = order.indexOf(current)
  if (key === 'Home') return 'auto'
  if (key === 'End') return 'strict'
  if (key === 'ArrowRight' || key === 'ArrowDown') return order[(index + 1) % order.length]
  if (key === 'ArrowLeft' || key === 'ArrowUp') return order[(index + order.length - 1) % order.length]
  return undefined
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
  const requestId = useRef(0)
  const viewSession = useRef(sessionId ?? '')
  const liveRef = useRef(true)
  const busyRef = useRef(false)
  const editingRef = useRef(false)
  busyRef.current = busy
  editingRef.current = editing

  async function call<T>(endpoint: string, payload: unknown): Promise<T> {
    return unwrap(await client.connection.rpc.call(MOOD_RPC_CHANNEL, endpoint, payload) as RpcResult<T>)
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
      if (mounted && current(sessionId, id)) setError(cause instanceof Error ? cause.message : '无法读取任务摘要。')
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
      if (current(view, id)) setError(cause instanceof Error ? cause.message : '操作失败。')
    } finally {
      if (current(view, id)) { busyRef.current = false; setBusy(false) }
    }
  }

  return <article className="mood-card" data-testid="mood-contract-card" data-session={sessionId || undefined}>
    {error ? <p role="alert">{error}</p> : null}
    {pendingManual ? <p role="status">{text.loading}</p> : null}
    {recovery ? <p role="status">{text.recovery}</p> : null}
    <details open={surface === 'settings' || recovery || pendingManual || undefined}>
      <summary>{text.card}{contract?.goal ? `：${contract.goal.slice(0, 60)}` : ''}</summary>
      <div className="mood-details">
        {contract ? <p className="mood-meta">{readinessLabel(contract.readiness)}</p> : null}
        <p>{contract?.goal ? `${text.goal}：${contract.goal}` : text.empty}</p>
        {contract?.evidence.length ? <ul aria-label={text.evidence}>
          {contract.evidence.map((item, index) => <li key={`${item.kind}-${item.seq}-${index}`}>{item.excerpt ?? `#${item.seq}`}</li>)}
        </ul> : null}
        {contract?.questions.length ? <ul aria-label={text.questions}>
          {contract.questions.map((question, index) => <li key={index}>{question}</li>)}
        </ul> : null}
        {(status?.session?.clarification ?? []).filter(item => item.status === 'answered').map(item => (
          <p key={item.id}>{item.question}{item.answer ? ` → ${item.answer}` : ''}</p>
        ))}
        {editing ? <label>{text.goal}<textarea aria-label={text.goal} rows={3} value={goal} disabled={busy}
          onChange={event => setGoal(event.target.value)} /></label> : null}
        <div className="mood-actions">
          <button type="button" disabled={busy || !contract} onClick={() => {
            if (editing && contract && sessionId) {
              void action('edit', { sessionId, expectedRevision: contract.revision, patch: { goal } })
            } else setEditing(true)
          }}>{editing ? text.save : text.amend}</button>
          <button type="button" disabled={busy || !sessionId} onClick={() => {
            if (sessionId) void action('manual', { sessionId })
          }}>{text.reanalyze}</button>
          {recovery ? <button type="button" disabled={busy || !sessionId} onClick={() => {
            if (sessionId) void action('retry', { sessionId })
          }}>{text.retry}</button> : null}
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

  useEffect(() => {
    let live = true
    void client.connection.rpc.call(MOOD_RPC_CHANNEL, 'status', {})
      .then(result => { if (live) setStatus(unwrap<MoodStatus>(result)) })
      .catch(() => { if (live) setError(text.modelLoading) })
    void client.remote?.session?.modelCatalog?.()
      ?.then(value => { if (live) setChoices(parseModelMenuChoices(value, route)) })
      .catch(() => { if (live) setChoices([]) })
    return () => { live = false }
  }, [client, route.provider, route.model])

  async function save(next: MoodModelRoute): Promise<void> {
    if (!status) return
    setBusy(true); setError('')
    try {
      const value = unwrap<MoodStatus>(await client.connection.rpc.call(MOOD_RPC_CHANNEL, 'model', {
        expectedRevision: status.settings.revision, model: next,
      }))
      setStatus(value)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.stale)
      const fresh = await client.connection.rpc.call(MOOD_RPC_CHANNEL, 'status', {}).then(result => {
        try { return unwrap<MoodStatus>(result) } catch { return undefined }
      }).catch(() => undefined)
      if (fresh) setStatus(fresh)
    } finally {
      setBusy(false)
    }
  }

  return <section className="mood-model" data-testid="mood-model">
    {error && <p role="alert" className="mood-meta">{error}</p>}
    <label>
      {text.model}
      <select
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
      <label>
        {text.modelEffort}
        <select
          value={route.reasoningEffort ?? ''}
          disabled={busy}
          onChange={event => void save({ ...route, reasoningEffort: event.target.value || undefined })}
        >
          <option value="">{text.modelEffortDefault}</option>
          {efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
        </select>
      </label>
    )}
    <p className="mood-meta">{text.modelHint}</p>
  </section>
}

/** The plugin page renders the seat; the model menu works without a session. */
function MoodSettingsSeat({ client }: { client: Client }) {
  const seat = useNativeSeat(client, {})
  return <div className="mood-settings-root" data-testid="mood-settings-root">
    <section className="mood-settings" data-testid="mood-settings">
      <h3>{copy(seat.locale).settings}</h3>
      <p className="mood-meta">{copy(seat.locale).hint}</p>
      <MoodModelMenu client={client} locale={seat.locale} />
    </section>
  </div>
}

export function MoodSettings({ client, props }: { client: Client; props: unknown }) {
  const seat = useNativeSeat(client, props)
  const text = copy(seat.locale)
  return <div className="mood-settings-root" data-testid="mood-settings-root" data-session={seat.sessionId || undefined}>
    <section className="mood-settings" data-testid="mood-settings"><h3>{text.settings}</h3><p className="mood-meta">{text.hint}</p>
      <MoodModelMenu client={client} locale={seat.locale} />
    </section>
    {seat.sessionId
      ? <MoodContractCard key={`contract:${moodPanelKey(seat.sessionId, seat.locale)}`} client={client}
          sessionId={seat.sessionId} locale={seat.locale} surface="settings" />
      : <p className="mood-meta">{text.sessionHint}</p>}
  </div>
}

export function MoodChatCard({ client, props }: { client: Client; props: unknown }) {
  const seat = useNativeSeat(client, props)
  if (seat.hidden || !seat.sessionId) return null
  return <MoodContractCard key={moodPanelKey(seat.sessionId, seat.locale)} client={client}
    sessionId={seat.sessionId} locale={seat.locale} hidden={seat.hidden} />
}

const styles = `
.mood-settings-root,.mood-settings,.mood-card,.mood-details{max-width:760px;display:grid;gap:12px;color:inherit;font:400 var(--font-size-2,14px)/1.5 var(--default-font-family,system-ui,sans-serif)}
.mood-settings h3{margin:0;font-size:var(--font-size-3,16px);font-weight:600}
.mood-settings p,.mood-card p{margin:0;line-height:1.5}
.mood-meta{font-size:var(--font-size-1,13px);color:var(--gray-11,inherit)}
.mood-card summary{cursor:pointer;overflow-wrap:anywhere}
.mood-details{margin-top:12px}
.mood-card ul{margin:0;padding-left:1.2em}
.mood-card{padding:10px 14px;border:1px solid var(--gray-6,color-mix(in srgb,currentColor 15%,transparent));border-radius:10px}
.mood-card textarea{box-sizing:border-box;width:100%;min-width:0;padding:8px 10px;border:1px solid var(--gray-6,color-mix(in srgb,currentColor 22%,transparent));border-radius:8px;background:var(--color-surface,transparent);color:inherit;font:inherit}
.mood-actions{display:flex;flex-wrap:wrap;gap:8px}
.mood-card button{min-height:34px;padding:6px 12px;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:8px;background:transparent;color:inherit;cursor:pointer;font:inherit}
.mood-card button:hover:not(:disabled){background:var(--gray-3,color-mix(in srgb,currentColor 6%,transparent))}
.mood-card button:disabled{opacity:.45;cursor:not-allowed}
.mood-card :focus-visible,.mood-settings-root :focus-visible{outline:2px solid var(--accent-9,currentColor);outline-offset:3px}
.mood-model{display:grid;gap:10px;margin-top:8px}
.mood-model label{display:grid;gap:6px;font-size:var(--font-size-2,14px)}
.mood-model select{box-sizing:border-box;width:100%;min-width:0;padding:7px 9px;border:1px solid var(--gray-7,color-mix(in srgb,currentColor 20%,transparent));border-radius:8px;background:var(--color-surface,transparent);color:inherit;font:inherit}
.mood-model select:focus-visible{border-color:var(--accent-9,currentColor);outline:2px solid var(--accent-9,currentColor);outline-offset:1px}
@media(prefers-reduced-motion:reduce){.mood-model select{transition:none}}
`

export function apply(ctx: Context): void {
  const client = ctx as unknown as Client
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-plugin', '@klarkxy/dsh-mood'); style.textContent = styles
    document.head.appendChild(style)
    return () => style.remove()
  }, 'dsh-mood.styles')
  ctx.effect(() => client.slots.inject('plugins.bundle.config', () => client.slots.register(
    { name: 'plugins.bundle.config', key: MOOD_PLUGIN },
    () => <MoodSettingsSeat client={client} />,
  )), 'dsh-mood.settings')
  ctx.effect(() => client.slots.inject(CHAT_EVENTS_SLOT, () => client.slots.register({
    name: CHAT_EVENTS_SLOT, id: 'mood', order: 10, label: '需求约定',
  }, (props: unknown) => <MoodChatCard client={client} props={props} />)), 'dsh-mood.card')
}
