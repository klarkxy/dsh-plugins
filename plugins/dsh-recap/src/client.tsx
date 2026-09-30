import type { Context } from '@deepseek-ai/cordis'
import { CHAT_EVENTS_SLOT } from '@klarkxy/dsh-plugin-kit/contracts'
import { useFeatureRefresh, useNativeSeat, type NativeSurfaceClient } from '@klarkxy/dsh-plugin-kit/client-utils'
import {
  modelMenuChoiceKey, modelMenuEffortOptions, parseModelMenuChoiceKey, parseModelMenuChoices, type ModelMenuChoice,
} from '@klarkxy/dsh-plugin-kit/model-menu'
import { useEffect, useId, useRef, useState } from 'react'
import { Button, Input, StateDot, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'
import {
  RECAP_PLUGIN, RECAP_RPC_CHANNEL, defaultSettings,
  type RecapCard, type RecapModelRoute, type RecapSettings, type RecapStatus, type RpcResult,
} from './contracts.ts'
import {
  createRecapClientWork, shouldRequestIdleReturn, shouldSkipRecapAutoRefresh, type RecapClientWork,
} from './idle.ts'

export const name = 'dsh-recap-client'
export const inject = ['slots', 'connection', 'remote', 'remote.session', 'sessions', 'locale', 'uiWorkspace', 'uiSession'] as const
export {
  createRecapClientWork, isCurrentRecapRequest, shouldRequestIdleReturn, shouldSkipRecapAutoRefresh,
  nextActivityTimestamp,
} from './idle.ts'
export { CHAT_EVENTS_SLOT }

type RpcCaller = { call(channel: string, endpoint: string, payload: unknown): Promise<unknown> }
type SlotHandle = {
  inject(key: string, callback: () => unknown): () => void
  register(spec: { name: string; id: string; label: string; order: number } | { name: string; key: string }, render: unknown): () => void
}
type RecapClient = Context & NativeSurfaceClient & {
  connection: { rpc: RpcCaller; generation?: { subscribe(listener: () => void): () => void } }
  remote?: { session?: { modelCatalog?: () => Promise<unknown> } }
  slots: SlotHandle
}

export function recapHasRunningGeneration(cards: readonly RecapCard[]): boolean {
  return cards.some(card => card.generation === 'running')
}

export function recapSeatProps(props: unknown): { sessionId: string; locale?: string; hidden: boolean } | undefined {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return undefined
  const record = props as Record<string, unknown>
  const nested = record.owner && typeof record.owner === 'object' ? record.owner as Record<string, unknown> : undefined
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId : typeof nested?.sessionId === 'string' ? nested.sessionId : undefined
  if (!sessionId) return undefined
  const locale = typeof record.locale === 'string' ? record.locale : typeof nested?.locale === 'string' ? nested.locale : undefined
  const hidden = record.hidden === true || nested?.hidden === true
  return locale ? { sessionId, locale, hidden } : { sessionId, hidden }
}

export function recapCardKey(seat: { sessionId: string; locale?: string }): string {
  return `${seat.sessionId}:${seat.locale ?? ''}`
}

function unwrap<T>(result: RpcResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

export async function recapCall<T>(rpc: RpcCaller, endpoint: string, payload: unknown = {}): Promise<T> {
  return unwrap(await rpc.call(RECAP_RPC_CHANNEL, endpoint, payload) as RpcResult<T>)
}

function copy(locale: string | undefined, zh: string, en: string): string {
  return locale === 'en' ? en : zh
}

export async function runRecapStatusLoad(input: {
  rpc: RpcCaller
  sessionId?: string
  isCurrent: () => boolean
  failedMessage: string
  onStatus: (status: RecapStatus) => void
  onError: (message: string) => void
}): Promise<void> {
  try {
    const status = await recapCall<RecapStatus>(input.rpc, 'status', input.sessionId ? { sessionId: input.sessionId } : {})
    if (!input.isCurrent()) return
    input.onStatus(status)
  } catch (cause) {
    if (!input.isCurrent()) return
    input.onError(cause instanceof Error && cause.message ? cause.message : input.failedMessage)
  }
}

/** Recap's single user-facing name, shared by the chat seat label and copy. */
export function recapTitle(locale: string | undefined): string {
  return copy(locale, '回顾', 'Recap')
}

/** Maps every generation outcome to a dot state instead of reading anything non-running as done. */
export function recapGenerationDot(generation: RecapCard['generation']): 'ongoing' | 'error' | 'warning' | 'idle' | 'done' {
  switch (generation) {
    case 'running': return 'ongoing'
    case 'failed': return 'error'
    case 'cancelled': return 'warning'
    case 'superseded': return 'idle'
    default: return 'done'
  }
}

export function recapGenerationLabel(generation: RecapCard['generation'], locale: string | undefined): string {
  switch (generation) {
    case 'running': return copy(locale, '生成中', 'Generating')
    case 'failed': return copy(locale, '生成失败', 'Failed')
    case 'cancelled': return copy(locale, '已取消', 'Cancelled')
    case 'superseded': return copy(locale, '已被新回顾替代', 'Replaced by a newer recap')
    default: return copy(locale, '已完成', 'Done')
  }
}

/**
 * The chat seat stays a quiet lifecycle controller until there is something to
 * show: stored cards or a generation in flight. Only then does it render the card UI.
 */
export function recapCardVisible(input: { hidden?: boolean; cards: readonly RecapCard[] }): boolean {
  // A running generation always belongs to a stored card, so "has cards" covers both cases.
  return !input.hidden && input.cards.length > 0
}

export async function runRecapAct(input: {
  rpc: RpcCaller
  sessionId: string
  endpoint: 'cancel' | 'retry' | 'refresh'
  cardId?: string
  isCurrent: () => boolean
  failedMessage: string
  onBusy: (busy: boolean) => void
  onStatus: (status: RecapStatus) => void
  onError: (message: string) => void
}): Promise<void> {
  if (!input.isCurrent()) return
  input.onBusy(true)
  try {
    const payload = input.endpoint === 'refresh'
      ? { sessionId: input.sessionId }
      : { cardId: input.cardId, sessionId: input.sessionId }
    await recapCall(input.rpc, input.endpoint, payload)
    if (!input.isCurrent()) return
    const status = await recapCall<RecapStatus>(input.rpc, 'status', { sessionId: input.sessionId })
    if (!input.isCurrent()) return
    input.onStatus(status)
  } catch (cause) {
    if (!input.isCurrent()) return
    input.onError(cause instanceof Error ? cause.message : input.failedMessage)
  } finally {
    if (!input.isCurrent()) return
    input.onBusy(false)
  }
}

export async function runRecapIdleReturn(input: {
  rpc: RpcCaller
  sessionId: string
  isCurrent: () => boolean
  failedMessage: string
  onStatus: (status: RecapStatus) => void
  onError: (message: string) => void
  onActivity: () => void
}): Promise<void> {
  if (!input.isCurrent()) return
  try {
    await recapCall(input.rpc, 'idle.return', { sessionId: input.sessionId })
    if (!input.isCurrent()) return
    const status = await recapCall<RecapStatus>(input.rpc, 'status', { sessionId: input.sessionId })
    if (!input.isCurrent()) return
    input.onActivity()
    input.onStatus(status)
  } catch {
    if (!input.isCurrent()) return
    input.onError(input.failedMessage)
  }
}

const css = `${officialUiCss(['dsh-recap-card', 'dsh-recap-settings'])}
/* The two surfaces take their measure and rhythm from the contract; what stays
 * here is the native <details> header the primitives do not cover, and the
 * generated body, which is prose rather than the monospaced code block the
 * contract's own code well is for. */
.dsh-recap-card, .dsh-recap-settings { max-width: 760px; }
.dsh-recap-sr {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
.dsh-recap-summary { display: flex; align-items: center; gap: 8px; min-width: 0; cursor: pointer; }
.dsh-recap-body {
  margin: 0;
  font: inherit;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--dsw-alias-label-secondary);
}
`

/** Retry; when it would overwrite a finished recap, a second click within 3s confirms. */
function RetryButton(props: { locale?: string; disabled?: boolean; confirm: boolean; onRetry(): void }) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const disarm = () => { clearTimeout(timer.current); setArmed(false) }
  const confirmLabel = copy(props.locale, '再点一次以覆盖当前回顾', 'Click again to replace this recap')
  return <>
    <Button variant="outline" size="sm" disabled={props.disabled} onBlur={disarm}
      onClick={() => {
        if (props.confirm && !armed) {
          setArmed(true)
          timer.current = setTimeout(() => setArmed(false), 3000)
          return
        }
        disarm()
        props.onRetry()
      }}>{armed ? confirmLabel : copy(props.locale, '重新生成', 'Regenerate')}</Button>
    <span role="status" className="dsh-recap-sr">{armed ? confirmLabel : ''}</span>
  </>
}

export function RecapEventsCard({
  client, sessionId, locale, hidden, idle = true, quiet = false,
}: {
  client: RecapClient
  sessionId: string
  locale?: string
  hidden?: boolean
  idle?: boolean
  quiet?: boolean
}) {
  const rpc = client.connection.rpc
  const [cards, setCards] = useState<RecapCard[]>([])
  const [error, setError] = useState('')
  const [cardsOn, setCardsOn] = useState(true)
  const [busy, setBusy] = useState(false)
  const lastActivityAt = useRef(Date.now())
  const idleMs = useRef(defaultSettings().idleReturnMs)
  const cardsEnabled = useRef(true)
  const busyRef = useRef(false)
  const workRef = useRef<RecapClientWork>(undefined)
  if (!workRef.current) workRef.current = createRecapClientWork()
  const work = workRef.current

  function markBusy(value: boolean) {
    busyRef.current = value
    setBusy(value)
  }

  function applyStatus(status: RecapStatus) {
    idleMs.current = status.settings.idleReturnMs
    cardsEnabled.current = status.settings.cardsEnabled
    setCardsOn(status.settings.cardsEnabled)
    setCards(status.cards)
    setError('')
  }

  useEffect(() => () => { work.dispose() }, [work])

  useEffect(() => {
    const generation = work.beginLoad()
    lastActivityAt.current = Date.now()
    busyRef.current = false
    setBusy(false)
    setError('')
    setCards([])
    void runRecapStatusLoad({
      rpc,
      sessionId,
      isCurrent: () => work.isLoad(generation),
      failedMessage: copy(locale, '无法读取回顾。', 'Could not load recap.'),
      onStatus: applyStatus,
      onError: setError,
    })
    return () => { if (work.isLoad(generation)) work.beginLoad() }
  }, [rpc, sessionId, locale, work])

  useEffect(() => {
    if (hidden || !idle || typeof document === 'undefined') return undefined
    const requestIdle = () => {
      const token = work.beginRequest()
      void runRecapIdleReturn({
        rpc,
        sessionId,
        isCurrent: () => work.isRequest(token),
        failedMessage: copy(locale, '闲置回顾失败。', 'Idle recap failed.'),
        onStatus: applyStatus,
        onError: setError,
        onActivity: () => { lastActivityAt.current = Date.now() },
      })
    }
    const maybeIdleReturn = () => {
      if (!shouldRequestIdleReturn({
        now: Date.now(),
        lastUserActivityAt: lastActivityAt.current,
        idleReturnMs: idleMs.current,
        cardsEnabled: cardsEnabled.current,
        visible: document.visibilityState === 'visible',
        hidden: false,
        focused: document.hasFocus(),
      })) return
      requestIdle()
    }
    const onPointer = () => { lastActivityAt.current = Date.now() }
    const onKey = () => { lastActivityAt.current = Date.now() }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    window.addEventListener('focus', maybeIdleReturn)
    document.addEventListener('visibilitychange', maybeIdleReturn)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('focus', maybeIdleReturn)
      document.removeEventListener('visibilitychange', maybeIdleReturn)
    }
  }, [rpc, sessionId, locale, hidden, idle, work])

  function refreshCards() {
    if (shouldSkipRecapAutoRefresh({ busy: busyRef.current, disposed: work.disposed })) return
    const token = work.snapshot()
    void runRecapStatusLoad({
      rpc,
      sessionId,
      isCurrent: () => work.isRequest(token) && !busyRef.current,
      failedMessage: copy(locale, '无法读取回顾。', 'Could not load recap.'),
      onStatus: applyStatus,
      onError: setError,
    })
  }

  useFeatureRefresh(
    client,
    sessionId,
    refreshCards,
    recapHasRunningGeneration(cards),
    Boolean(sessionId) && hidden !== true,
  )

  function act(endpoint: 'cancel' | 'retry' | 'refresh', cardId?: string) {
    const token = work.beginRequest()
    void runRecapAct({
      rpc,
      sessionId,
      endpoint,
      cardId,
      isCurrent: () => work.isRequest(token),
      failedMessage: copy(locale, '操作失败。', 'Action failed.'),
      onBusy: markBusy,
      onStatus: applyStatus,
      onError: setError,
    })
  }

  // `quiet` keeps the seat a background controller: nothing renders until there is a card to show.
  if (quiet ? !recapCardVisible({ hidden, cards }) : hidden) return null
  if (!cardsOn && cards.length === 0 && !error) return null
  const running = recapHasRunningGeneration(cards)
  return <section className="dsh-recap-card dsh-ui-stack" data-session={sessionId} aria-label={recapTitle(locale)}>
    {error ? <p role="alert" className="dsh-ui-error">{error}</p> : null}
    {cardsOn ? <div className="dsh-ui-actions">
      <Button variant="primary" size="sm" disabled={busy || running}
        onClick={() => act('refresh')}>{copy(locale, '生成回顾', 'Generate recap')}</Button>
      <span role="status" className="dsh-ui-hint">{running ? copy(locale, '正在生成回顾…', 'Generating recap…') : ''}</span>
    </div> : null}
    {cards.map(card => (
      <details className="dsh-ui-card dsh-ui-card--flat" key={card.id}>
        <summary className="dsh-recap-summary">
          <StateDot state={recapGenerationDot(card.generation)} />
          <span className="dsh-ui-heading dsh-ui-truncate">{card.title}</span>
          <span className="dsh-ui-meta">{recapGenerationLabel(card.generation, locale)}</span>
        </summary>
        <pre className="dsh-recap-body">{card.body}</pre>
        <div className="dsh-ui-actions">
          {card.generation === 'running'
            ? <Button variant="outline" size="sm" disabled={busy} onClick={() => act('cancel', card.id)}>{copy(locale, '取消', 'Cancel')}</Button>
            : <RetryButton locale={locale} disabled={busy}
              // Retrying a finished recap replaces its text, so that one path asks first.
              confirm={card.generation === 'idle' && Boolean(card.body.trim())}
              onRetry={() => act('retry', card.id)} />}
        </div>
      </details>
    ))}
  </section>
}

function RecapBackgroundSeat({ client, ...props }: { client: RecapClient } & Record<string, unknown>) {
  const seat = useNativeSeat(client, props)
  if (!seat.sessionId) return null
  return <RecapEventsCard key={recapCardKey(seat)} client={client} sessionId={seat.sessionId} locale={seat.locale} hidden={seat.hidden} quiet />
}

/** One purpose's model select: empty choice keeps the shared role/chat-model default. */
function RecapModelSelect(props: {
  locale: string
  label: string
  route: RecapModelRoute
  choices: ModelMenuChoice[]
  busy: boolean
  onChange: (route: RecapModelRoute) => void
}) {
  const optionsId = useId()
  const selected = props.choices.find(
    item => item.provider === props.route.provider && item.model === props.route.model,
  )
  const efforts = modelMenuEffortOptions(selected, props.route.reasoningEffort)
  return <>
    <label className="dsh-ui-field" htmlFor={optionsId}>
      <span className="dsh-ui-label">{props.label}</span>
      <select
        id={optionsId}
        className="dsh-ui-select"
        value={modelMenuChoiceKey(props.route.provider, props.route.model)}
        disabled={props.busy}
        onChange={event => {
          const key = event.target.value
          if (!key) { props.onChange({ provider: '', model: '' }); return }
          const parsed = parseModelMenuChoiceKey(key)
          if (parsed) props.onChange(parsed)
        }}
      >
        <option value="">{copy(props.locale, '默认模型', 'Default model')}</option>
        {props.choices.map(choice => (
          <option key={modelMenuChoiceKey(choice.provider, choice.model)} value={modelMenuChoiceKey(choice.provider, choice.model)}>
            {choice.label}
          </option>
        ))}
      </select>
    </label>
    {selected && efforts.length > 0 && (
      <label className="dsh-ui-field" htmlFor={`${optionsId}-effort`}>
        <span className="dsh-ui-label">{copy(props.locale, '思考强度', 'Reasoning effort')}</span>
        <select
          id={`${optionsId}-effort`}
          className="dsh-ui-select"
          value={props.route.reasoningEffort ?? ''}
          disabled={props.busy}
          onChange={event => props.onChange({ ...props.route, reasoningEffort: event.target.value || undefined })}
        >
          <option value="">{copy(props.locale, '默认', 'Default')}</option>
          {efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
        </select>
      </label>
    )}
  </>
}

function RecapToggle(props: {
  locale: string; label: string; hint: string; checked: boolean; busy: boolean; onChange(next: boolean): void
}) {
  return <div className="dsh-ui-toggle-row">
    <div className="dsh-ui-toggle-text">
      <span className="dsh-ui-toggle-label">{props.label}</span>
      <span className="dsh-ui-hint">{props.hint}</span>
    </div>
    <Switch checked={props.checked} label={props.label} disabled={props.busy} onChange={props.onChange} />
  </div>
}

/** Minutes bounds mirror the server schema (60_000..180 * 60_000 ms). */
export const RECAP_IDLE_MIN_MINUTES = 1
export const RECAP_IDLE_MAX_MINUTES = 180

/** Parses the minutes field; undefined when out of range or not a whole number. */
export function parseIdleMinutes(text: string): number | undefined {
  const minutes = Number(text.trim())
  if (!Number.isInteger(minutes) || minutes < RECAP_IDLE_MIN_MINUTES || minutes > RECAP_IDLE_MAX_MINUTES) return undefined
  return minutes * 60_000
}

function IdleMinutesField(props: { locale: string; value: number; busy: boolean; onCommit(ms: number): void }) {
  const id = useId()
  const [text, setText] = useState(String(Math.round(props.value / 60_000)))
  useEffect(() => { setText(String(Math.round(props.value / 60_000))) }, [props.value])
  const parsed = parseIdleMinutes(text)
  const invalid = parsed === undefined
  const commit = () => { if (parsed !== undefined && parsed !== props.value) props.onCommit(parsed) }
  return <div className="dsh-ui-field">
    <label className="dsh-ui-label" htmlFor={id}>{copy(props.locale, '离开多久后生成回顾（分钟）', 'Recap after being away (minutes)')}</label>
    <Input id={id} className="dsh-ui-control" inputMode="numeric" value={text} disabled={props.busy}
      aria-invalid={invalid || undefined} aria-describedby={`${id}-hint`}
      onChange={event => setText(event.target.value)} onBlur={commit}
      onKeyDown={event => { if (event.key === 'Enter') commit() }} />
    <p id={`${id}-hint`} className={invalid ? 'dsh-ui-error' : 'dsh-ui-hint'}>
      {copy(props.locale, `填写 ${RECAP_IDLE_MIN_MINUTES}–${RECAP_IDLE_MAX_MINUTES} 之间的整数。`, `A whole number from ${RECAP_IDLE_MIN_MINUTES} to ${RECAP_IDLE_MAX_MINUTES}.`)}
    </p>
  </div>
}

/** Plugin-page settings row: recap abilities, idle interval and model picks. */
export function RecapSettingsPanel({ client, ...props }: { client: RecapClient } & Record<string, unknown>) {
  const seat = useNativeSeat(client, props)
  const locale = seat.locale
  const [status, setStatus] = useState<RecapStatus>()
  const [choices, setChoices] = useState<ModelMenuChoice[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  const call = (endpoint: string, payload: unknown) => client.connection.rpc.call(RECAP_RPC_CHANNEL, endpoint, payload)

  useEffect(() => {
    let live = true
    void call('status', {}).then(async value => {
      const result = value as RpcResult<RecapStatus>
      if (!live) return
      if (!result || result.ok !== true) {
        setError(result && result.ok === false && result.error.message ? result.error.message : copy(locale, '无法读取回顾设置。', 'Unable to load recap settings.'))
        return
      }
      setStatus(result.value)
      setError('')
      void client.remote?.session?.modelCatalog?.()
        ?.then(catalog => { if (live) setChoices(parseModelMenuChoices(catalog, result.value.settings.displayModel)) })
        .catch(() => { if (live) setChoices([]) })
    }).catch(cause => { if (live) setError(cause instanceof Error && cause.message ? cause.message : copy(locale, '无法读取回顾设置。', 'Unable to load recap settings.')) })
    return () => { live = false }
  }, [client, locale])

  async function save(patch: Partial<Omit<RecapSettings, 'revision'>>): Promise<void> {
    if (!status) return
    const draft = { ...defaultSettings(), ...status.settings, ...patch }
    setBusy(true); setError(''); setNote('')
    try {
      const value = await call('update', {
        expectedRevision: status.settings.revision,
        settings: {
          cardsEnabled: draft.cardsEnabled,
          checkpointsEnabled: draft.checkpointsEnabled,
          semanticCheckpointsEnabled: draft.semanticCheckpointsEnabled,
          idleReturnMs: draft.idleReturnMs,
          displayModel: draft.displayModel,
          checkpointModel: draft.checkpointModel,
        },
      })
      const result = value as RpcResult<RecapStatus>
      if (!result || result.ok !== true) throw new Error(result && !result.ok ? result.error.message : 'failed')
      setStatus(result.value)
      setNote(copy(locale, '已保存。', 'Saved.'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy(locale, '保存失败。', 'Save failed.'))
    } finally {
      setBusy(false)
    }
  }

  if (!status) {
    return <section className="dsh-recap-settings dsh-ui-panel" data-testid="recap-settings">
      {error
        ? <p role="alert" className="dsh-ui-error">{error}</p>
        : <p role="status" className="dsh-ui-hint">{copy(locale, '正在读取设置…', 'Loading settings…')}</p>}
    </section>
  }

  return <section className="dsh-recap-settings dsh-ui-panel" data-testid="recap-settings">
    {error && <p role="alert" className="dsh-ui-error">{error}</p>}
    {note && <p role="status" className="dsh-ui-notice">{note}</p>}
    <RecapToggle locale={locale} busy={busy}
      label={copy(locale, '回顾卡片', 'Recap cards')}
      hint={copy(locale, '长对话结束或离开一段时间后回来时，生成一段回顾。', 'Writes a short recap after long turns or when you come back.')}
      checked={status.settings.cardsEnabled}
      onChange={next => void save({ cardsEnabled: next })} />
    <RecapToggle locale={locale} busy={busy}
      label={copy(locale, '任务检查点', 'Task checkpoints')}
      hint={copy(locale, '在关键节点提醒助手当前进度。', 'Reminds the assistant of progress at key points.')}
      checked={status.settings.checkpointsEnabled}
      onChange={next => void save({ checkpointsEnabled: next })} />
    <RecapToggle locale={locale} busy={busy || !status.settings.checkpointsEnabled}
      label={copy(locale, '语义检查点', 'Semantic checkpoints')}
      hint={copy(locale, '用模型总结检查点内容，需先开启任务检查点。', 'Uses a model to summarize checkpoints. Needs task checkpoints on.')}
      checked={status.settings.semanticCheckpointsEnabled}
      onChange={next => void save({ semanticCheckpointsEnabled: next })} />
    <IdleMinutesField locale={locale} busy={busy || !status.settings.cardsEnabled}
      value={status.settings.idleReturnMs}
      onCommit={ms => void save({ idleReturnMs: ms })} />
    <RecapModelSelect
      locale={locale}
      label={copy(locale, '回顾卡片模型', 'Recap card model')}
      route={status.settings.displayModel}
      choices={choices}
      busy={busy}
      onChange={route => void save({ displayModel: route })}
    />
    <RecapModelSelect
      locale={locale}
      label={copy(locale, '语义检查点模型', 'Semantic checkpoint model')}
      route={status.settings.checkpointModel}
      choices={choices}
      busy={busy}
      onChange={route => void save({ checkpointModel: route })}
    />
    <p className="dsh-ui-help">{copy(locale, '留空则使用当前会话模型，再回落到宿主默认对话模型。', 'Leave empty to use the current session model, then the host default chat model.')}</p>
  </section>
}

export function apply(ctx: Context): void {
  const client = ctx as RecapClient
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-plugin', '@klarkxy/dsh-recap')
    style.textContent = css
    document.head.appendChild(style)
    return () => style.remove()
  }, 'dsh-recap.styles')
  ctx.effect(() => client.slots.inject('plugins.bundle.config', () => client.slots.register(
    { name: 'plugins.bundle.config', key: RECAP_PLUGIN },
    () => <RecapSettingsPanel client={client} />,
  )), 'dsh-recap.settings')
  ctx.effect(() => client.slots.inject(CHAT_EVENTS_SLOT, () => client.slots.register({
    name: CHAT_EVENTS_SLOT, id: 'recap', order: 40, label: recapTitle(undefined),
  }, (props: unknown) => <RecapBackgroundSeat client={client} {...(props as object)} />)), 'dsh-recap.background')
}
