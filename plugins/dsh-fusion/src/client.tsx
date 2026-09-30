import type { Context } from '@deepseek-ai/cordis'
import { CHAT_EVENTS_SLOT } from '@klarkxy/dsh-plugin-kit/contracts'
import { useNativeSeat, type NativeSurfaceClient } from '@klarkxy/dsh-plugin-kit/client-utils'
import {
  modelMenuChoiceKey, modelMenuEffortOptions, parseModelMenuChoiceKey, parseModelMenuChoices, type ModelMenuChoice,
} from '@klarkxy/dsh-plugin-kit/model-menu'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import {
  Button, DisclosureRow, Modal, PathLabel, Tag,
  IconChecklistOutlineRegular, IconEditOutlineRegular, IconUsersOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  FUSION_PLUGIN, FUSION_RPC_CHANNEL, defaultModelRoute, type FusionCandidate, type FusionCandidateAction,
  type FusionPreview, type FusionSettings, type FusionStatus, type FusionTask, type RpcResult,
} from './contracts.ts'
import { acceptedCandidate, actionIdentity, activityLabel, canAdopt, currentTask, isCurrentAction, notifyAppliedReceipt, reconciledReceipt, taskAnchorTurn, type ObservedPendingApplication, type TurnEntry } from './client-projection.ts'
import { FusionClientStore, type FusionClientSources, type FusionEventSource } from './client-store.ts'
import { taskView, type FusionLocale } from './presentation.ts'
import { fusionClientStyles } from './client-styles.ts'

export const name = 'dsh-fusion-client'
export const inject = ['slots', 'connection', 'remote', 'remote.session', 'sessions', 'locale', 'uiWorkspace', 'uiSession'] as const
export const NATIVE_TURN_TAIL_SLOT = 'conversation.chat.turnTail'

type FusionClient = Omit<NativeSurfaceClient, 'sessions' | 'connection'> & {
  connection: FusionClientSources['connection']
  remote?: { session?: { modelCatalog?: () => Promise<unknown> } }
  slots: {
    inject(key: string, register: () => unknown): () => void
    register(spec: { name: string; id: string; order: number; label: string | (() => string) } | { name: string; key: string }, render: unknown): () => void
  }
  sidebarRight?: { openResource(address: string, options?: { kind?: string; preferNewPane?: boolean }): void }
  sessions: {
    binding?(sessionId: string): { eventSource: FusionEventSource & { getSnapshot(): { entries: readonly TurnEntry[] } } } | undefined
  }
}

function label(locale: FusionLocale, zh: string, en: string): string { return locale === 'zh' ? zh : en }
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error) }

export function candidateAction(sessionId: string, task: FusionTask, candidate: FusionCandidate): FusionCandidateAction {
  return { sessionId, taskId: task.id, taskRevision: task.revision, candidateId: candidate.id, hash: candidate.hash }
}

export function canRecover(task: FusionTask): boolean {
  return ['interrupted', 'review', 'decision'].includes(task.state)
    && Boolean(task.reportIds.at(-1)?.startsWith(`${task.revision}:`))
}

export function canResume(task: FusionTask): boolean {
  return ['decision', 'interrupted', 'failed'].includes(task.state) && task.delivery !== 'pending' && task.cleanup !== 'pending'
}

function useStatus(store: FusionClientStore, sessionId: string) {
  const subscribe = useCallback((listener: () => void) => sessionId ? store.subscribe(sessionId, listener) : () => {}, [store, sessionId])
  const snapshot = useCallback(() => store.snapshot(sessionId), [store, sessionId])
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

function ExactPreview({ preview, locale }: { preview: FusionPreview; locale: FusionLocale }) {
  return <div className="dsh-ui-stack">
    <PathLabel path={preview.path} />
    <div className="dsh-fusion-compare">
      <section className="dsh-ui-stack">
        <h4 className="dsh-ui-heading">{label(locale, '当前原文', 'Current file')}</h4>
        <pre className="dsh-ui-code">{preview.before}</pre>
      </section>
      <section className="dsh-ui-stack">
        <h4 className="dsh-ui-heading">{label(locale, '采用后全文', 'Exact result')}</h4>
        <pre className="dsh-ui-code">{preview.after}</pre>
      </section>
    </div>
  </div>
}

function PreviewDialog(props: {
  preview: FusionPreview; locale: FusionLocale; busy: boolean; onClose(): void; onApply(): void
}) {
  const title = label(props.locale, '审阅写入内容', 'Review exact change')
  // The official Modal owns the mask, the blur, the panel card, the shared
  // top-Esc and focus restoration (useModalLayer), so no manual restore here.
  return <Modal
    open
    onClose={() => { if (!props.busy) props.onClose() }}
    title={title}
    closeLabel={label(props.locale, '关闭预览', 'Close preview')}
    className="dsh-fusion-modal"
    contentClassName="dsh-fusion-modal-content"
    footer={<>
      <Button variant="ghost" onClick={props.onClose} disabled={props.busy}>
        {label(props.locale, '返回', 'Back')}
      </Button>
      <Button variant="primary" onClick={props.onApply} disabled={props.busy}>
        {props.busy ? label(props.locale, '正在应用…', 'Applying…') : label(props.locale, '确认采用', 'Apply change')}
      </Button>
    </>}
  >
    {/* The Modal portals to document.body, so the contract's descendant-scoped
     * rules need a root of their own inside the dialog. */}
    <div className="dsh-fusion-root">
      <div className="dsh-ui-stack">
        <ExactPreview preview={props.preview} locale={props.locale} />
        <p className="dsh-ui-hint">{label(props.locale, '确认后将按当前文件版本写入；原文变化会阻止应用。', 'Confirming writes against this file version; changes to the source will block application.')}</p>
      </div>
    </div>
  </Modal>
}

function FusionTaskCard(props: {
  client: FusionClient; store: FusionClientStore; status: FusionStatus; sessionId: string; locale: FusionLocale; native: boolean; loadError?: string; onApplied?: (path: string) => void
}) {
  const { client, store, status, sessionId, locale, native } = props
  const pair = status.pair
  const task = currentTask(pair)
  const [expanded, setExpanded] = useState(false)
  const [acceptanceOpen, setAcceptanceOpen] = useState(false)
  const [candidateOpen, setCandidateOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<FusionPreview>()
  const [feedback, setFeedback] = useState('')
  // Inline two-step confirmation for the destructive actions.
  const [confirming, setConfirming] = useState<'' | 'dismiss' | 'cancel'>('')
  const mounted = useRef(true)
  const current = useRef('')
  const busyRef = useRef(false)
  const candidate = task?.candidates.at(-1)
  current.current = task ? actionIdentity(sessionId, task, candidate) : ''
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { setError(''); setPreview(undefined); setFeedback(''); setBusy(''); setConfirming(''); busyRef.current = false }, [sessionId, task?.id, task?.revision, task?.state, task?.updatedAt, task?.adoption, candidate?.hash])
  useEffect(() => {
    if (!task || !candidate || !preview) return
    if (preview.candidateId !== candidate.id || preview.hash !== candidate.hash || !pair || !canAdopt(pair, task) || props.loadError || status.error) setPreview(undefined)
  }, [task, candidate, pair, preview, props.loadError, status.error])
  // Every hook must run before the early return below, or React sees a
  // different hook count when a task appears or disappears.
  // DisclosureRow compares its props shallowly, so the toggles stay stable.
  const toggleAcceptance = useCallback(() => setAcceptanceOpen(value => !value), [])
  const toggleCandidate = useCallback(() => setCandidateOpen(value => !value), [])
  if (!pair || !task || pair.leadSessionId !== sessionId) return null
  const view = taskView(pair, task, locale)
  const staleStatus = Boolean(props.loadError || status.error)
  const allowed = !staleStatus && canAdopt(pair, task)
  const accepted = acceptedCandidate(task)
  const key = actionIdentity(sessionId, task, candidate)
  const isCurrent = () => isCurrentAction(mounted.current, key, current.current)
  const identity = { sessionId, taskId: task.id, taskRevision: task.revision }

  async function call(endpoint: string, payload: unknown): Promise<unknown> {
    const result = await client.connection.rpc.call(FUSION_RPC_CHANNEL, endpoint, payload) as RpcResult
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }

  async function act(endpoint: string, payload: unknown, success?: (value: unknown) => void): Promise<void> {
    if (!isCurrent() || busyRef.current || staleStatus) return
    busyRef.current = true; setBusy(endpoint); setError('')
    store.invalidate(sessionId)
    try {
      const value = await call(endpoint, payload)
      if (isCurrent()) success?.(value)
    } catch (cause) {
      if (isCurrent()) setError(errorText(cause))
    } finally {
      if (isCurrent()) { busyRef.current = false; setBusy('') }
      await store.refresh(sessionId)
    }
  }

  // Preview is a read, but must retain the exact Host version returned by the command.
  async function loadPreview(): Promise<void> {
    if (!allowed || !candidate || candidate.id !== accepted?.id || busyRef.current || !isCurrent()) return
    busyRef.current = true; setBusy('preview'); setError('')
    try {
      const value = await call('preview', candidateAction(sessionId, task!, candidate)) as FusionPreview
      if (isCurrent() && value.candidateId === candidate.id && value.hash === candidate.hash) setPreview(value)
    } catch (cause) {
      if (isCurrent()) setError(errorText(cause))
    } finally {
      if (isCurrent()) { busyRef.current = false; setBusy('') }
    }
  }

  async function applyPreview(): Promise<void> {
    if (!preview || staleStatus || !allowed || !candidate || preview.candidateId !== candidate.id || preview.hash !== candidate.hash) return
    const exactPreview = preview
    await act('apply', { ...candidateAction(sessionId, task!, candidate), expectedVersion: exactPreview.version }, value => {
      const confirmed = notifyAppliedReceipt({ value, task: task!, candidate, preview: exactPreview, isCurrent,
        notify: receipt => { if (props.onApplied) store.announceApplied(sessionId, receipt.id, receipt.path, props.onApplied) },
      })
      if (!confirmed) throw new Error(label(locale, '宿主未确认当前预览已应用，请刷新状态核对。',
        'The Host did not confirm this exact preview. Refresh status to inspect the result.'))
      setPreview(undefined)
    })
  }

  function openChild(): void {
    try { if (!client.sidebarRight) throw new Error(label(locale, '原生侧栏不可用。', 'Native sidebar unavailable.'))
      client.sidebarRight.openResource(view.executionAddress, { kind: 'subagentchat', preferNewPane: true }) }
    catch (cause) { setError(errorText(cause)) }
  }

  function onFeedbackKey(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Escape') { setFeedback(''); event.currentTarget.blur() }
  }

  const recoverable = !staleStatus && canRecover(task) && (task.delivery === 'uncertain' || task.state === 'interrupted' || !task.notifiedReportId)
  const resumable = !staleStatus && canResume(task)
  const latestReview = task.reviews.at(-1)
  return <div className="dsh-fusion-root">
    <article className={`dsh-ui-card dsh-fusion-card${native ? ' is-native' : ''}`} data-session={sessionId} aria-label={label(locale, '协作任务', 'Collaboration task')}>
    <div className="dsh-ui-row-wrap">
      <Tag tone="quiet">{label(locale, '协作', 'Collaboration')}</Tag>
      <strong className="dsh-fusion-title dsh-ui-wrap" title={task.brief.title}>{task.brief.title}</strong>
      <span className="dsh-ui-spacer" />
      <span role="status"><Tag tone="outline">{view.status}</Tag></span>
      <Button variant="ghost" size="sm" aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}>{expanded ? label(locale, '收起', 'Collapse') : label(locale, '详情', 'Details')}</Button>
    </div>
    {view.detail ? <p className="dsh-ui-compact dsh-ui-wrap">{view.detail}</p> : null}
    {status.activity ? <p className="dsh-ui-meta dsh-ui-wrap">
      {label(locale, '统筹', 'Lead')}: {activityLabel(status.activity.lead, locale)} · {label(locale, '副驾', 'Sidekick')}: {activityLabel(status.activity.sidekick, locale)}
    </p> : null}
    {status.usage && (status.usage.leadTokens !== null || status.usage.sidekickTokens !== null) ?
      <p className="dsh-ui-meta dsh-ui-wrap">{label(locale, '原生会话累计 token', 'Native session tokens')} ·
        {status.usage.leadTokens !== null ? ` ${label(locale, '统筹', 'Lead')} ${status.usage.leadTokens.toLocaleString()}` : ''}
        {status.usage.sidekickTokens !== null ? ` ${label(locale, '副驾', 'Sidekick')} ${status.usage.sidekickTokens.toLocaleString()}` : ''}
      </p> : null}
    {error || props.loadError ? <p className="dsh-ui-error dsh-ui-wrap" role="alert">{error || props.loadError}</p> : null}
    {props.loadError ? <div className="dsh-ui-actions">
      <Button variant="ghost" onClick={() => void store.refresh(sessionId)}>{label(locale, '重试读取', 'Retry status')}</Button>
    </div> : null}
    {expanded ? <div className="dsh-ui-section">
      <p className="dsh-ui-compact dsh-ui-wrap">{task.brief.goal}</p>
      <p className="dsh-ui-meta dsh-ui-wrap">{label(locale, '副驾模型', 'Sidekick model')}: {pair.route.provider} / {pair.route.model}{pair.route.reasoningEffort ? ` · ${pair.route.reasoningEffort}` : ''}</p>
      {task.brief.acceptance.length ? <DisclosureRow
        icon={<IconChecklistOutlineRegular />}
        title={label(locale, '验收要求', 'Acceptance')}
        open={acceptanceOpen}
        expandable
        expandOnRowClick
        onToggle={toggleAcceptance}
      ><ul className="dsh-fusion-list">
        {task.brief.acceptance.map((item, index) => <li key={index}>{item}</li>)}
      </ul></DisclosureRow> : null}
      {candidate ? <DisclosureRow
        icon={<IconEditOutlineRegular />}
        title={view.candidateLabel ?? label(locale, '候选', 'Candidate')}
        open={candidateOpen}
        expandable
        expandOnRowClick
        onToggle={toggleCandidate}
      ><div className="dsh-ui-stack">
        <p className="dsh-ui-compact dsh-ui-wrap dsh-fusion-report">{candidate.report}</p>
        <pre className="dsh-ui-code dsh-fusion-candidate">{candidate.text}</pre>
      </div></DisclosureRow> : task.decision ? <p className="dsh-ui-compact dsh-ui-wrap">{task.decision}</p> : null}
      {latestReview ? <p className="dsh-ui-meta dsh-ui-wrap">
        {label(locale, '统筹审查', 'Lead review')}: {latestReview.verdict === 'accept' ? label(locale, '通过', 'Accepted')
          : latestReview.verdict === 'revise' ? label(locale, '要求修改', 'Revision requested') : label(locale, '未通过', 'Rejected')}
        {latestReview.feedback ? ` · ${latestReview.feedback}` : ''}
      </p> : null}
      {task.delivery === 'uncertain' ? <p className="dsh-ui-banner" role="status">{task.reportIds.length
        ? label(locale, '报告通知结果不确定。请核对原生记录，再明确重送已保存的报告。',
          'Report notification is uncertain. Inspect native history, then explicitly re-notify the Lead of the saved report.')
        : label(locale, '初次交接结果不确定。请核对副驾会话，勿直接重发同一任务。',
          'Initial admission is uncertain. Inspect the Sidekick session before starting another task.')}</p> : null}
      {task.application?.state === 'pending' ? <p className="dsh-ui-banner">{label(locale,
        '写入结果待宿主核对，请刷新状态后再操作。', 'The Host is reconciling the write. Refresh status before acting.')}</p> : null}
      {native ? <div className="dsh-ui-actions">
        <Button variant="ghost" icon={<IconUsersOutlineRegular />} onClick={openChild}>
          {label(locale, '查看副驾会话', 'Open Sidekick session')}
        </Button>
      </div> : null}
    </div> : null}
    <div className="dsh-ui-actions">
      {allowed && !confirming ? <Button variant="primary" disabled={Boolean(busy)} onClick={() => void loadPreview()}>
        {label(locale, '预览采用', 'Preview adoption')}</Button> : null}
      {allowed && candidate && !confirming ? <Button variant="outline" disabled={Boolean(busy)}
        onClick={() => setConfirming('dismiss')}>
        {label(locale, '放弃候选', 'Dismiss candidate')}</Button> : null}
      {view.canStop && !confirming ? <Button variant="outline" disabled={Boolean(busy) || staleStatus}
        onClick={() => setConfirming('cancel')}>{label(locale, '停止协作任务', 'Stop task')}</Button> : null}
      {confirming ? <div className="dsh-ui-stack" role="group">
        <p className="dsh-ui-hint dsh-ui-wrap">{confirming === 'dismiss'
          ? label(locale, '放弃后此候选不可再采用，副驾需重新提交。', 'The candidate can no longer be adopted; the Sidekick must submit again.')
          : label(locale, '停止后副驾将中止当前任务，已保存的候选不受影响。', 'The Sidekick stops this task; saved candidates are kept.')}</p>
        <div className="dsh-ui-actions">
          <Button variant="ghost" disabled={Boolean(busy)} onClick={() => setConfirming('')}>{label(locale, '取消', 'Cancel')}</Button>
          <Button variant="primary" disabled={Boolean(busy) || (confirming === 'cancel' && staleStatus)}
            onClick={() => {
              const next = confirming
              setConfirming('')
              if (next === 'dismiss' && candidate) void act('dismiss', candidateAction(sessionId, task!, candidate))
              else if (next === 'cancel') void act('cancel', identity)
            }}>
            {confirming === 'dismiss' ? label(locale, '确认放弃', 'Dismiss') : label(locale, '确认停止', 'Stop task')}</Button>
        </div>
      </div> : null}
      {recoverable ? <Button variant="outline" disabled={Boolean(busy)}
        onClick={() => void act('recover', identity)}>{label(locale, '重送已保存报告', 'Re-notify saved report')}</Button> : null}
      {task.cleanup === 'failed' || task.adoption === 'conflict' ? <Button variant="outline" disabled={Boolean(busy)}
        onClick={() => void store.refresh(sessionId)}>{label(locale, '刷新状态', 'Refresh status')}</Button> : null}
    </div>
    {resumable ? <div className="dsh-ui-stack">
      <label className="dsh-ui-label" htmlFor={`dsh-fusion-feedback-${task.id}`}>{label(locale, '给统筹的后续要求', 'Feedback to Lead')}</label>
      <textarea className="dsh-fusion-input" id={`dsh-fusion-feedback-${task.id}`} value={feedback} onChange={event => setFeedback(event.target.value)}
        onKeyDown={onFeedbackKey} rows={2} maxLength={4000} />
      <div className="dsh-ui-actions">
        <Button variant="primary" disabled={Boolean(busy) || !feedback.trim()}
          onClick={() => void act('resume', { ...identity, feedback: feedback.trim() }, () => setFeedback(''))}>
          {label(locale, '继续协作', 'Continue collaboration')}</Button>
      </div>
    </div> : null}
    {preview ? <PreviewDialog preview={preview} locale={locale} busy={busy === 'apply'}
      onClose={() => setPreview(undefined)} onApply={() => void applyPreview()} /> : null}
    </article>
  </div>
}

function appliedOwnerCallback(owner: unknown): ((path: string) => void) | undefined {
  if (!owner || typeof owner !== 'object') return undefined
  const row = owner as Record<string, unknown>
  const nested = row.owner && typeof row.owner === 'object' ? row.owner as Record<string, unknown> : undefined
  const callback = row.onApplied ?? nested?.onApplied
  return typeof callback === 'function' ? callback as (path: string) => void : undefined
}

function FusionSeat(props: { client: FusionClient; store: FusionClientStore; native: boolean; owner: unknown }) {
  const { client, store, native, owner } = props
  const seat = useNativeSeat(client, owner)
  const snapshot = useStatus(store, seat.sessionId)
  const task = currentTask(snapshot.status?.pair)
  const onApplied = native ? undefined : appliedOwnerCallback(owner)
  const observedPending = useRef<ObservedPendingApplication>()
  useEffect(() => {
    if (!onApplied || !seat.sessionId || seat.hidden || snapshot.error) { observedPending.current = undefined; return }
    const application = task?.application
    if (application?.state === 'pending' && task) {
      observedPending.current = { sessionId: seat.sessionId, taskId: task.id, id: application.id,
        path: application.path, candidateId: application.candidateId, candidateHash: application.candidateHash }
      return
    }
    const receipt = reconciledReceipt(observedPending.current, seat.sessionId, task)
    observedPending.current = undefined
    if (receipt) store.announceApplied(seat.sessionId, receipt.id, receipt.path, onApplied)
  }, [onApplied, seat.sessionId, seat.hidden, snapshot.error, task?.id, task?.adoption, task?.application, store])
  if (!seat.sessionId || seat.hidden) return null
  if (native && client.uiWorkspace.current) return null
  if (!native && !client.uiWorkspace.current) return null
  if (native) {
    const row = owner && typeof owner === 'object' ? owner as Record<string, unknown> : {}
    const turn = row.turn && typeof row.turn === 'object' ? (row.turn as { turn?: number }).turn : undefined
    const entries = client.sessions.binding?.(seat.sessionId)?.eventSource.getSnapshot().entries ?? []
    const anchor = task ? taskAnchorTurn(task, entries) : entries.map(item => item.event.data?.turn).filter(value => typeof value === 'number').at(-1)
    if (turn === undefined || anchor !== turn) return null
  }
  if (!snapshot.status) return snapshot.error ? <div className="dsh-fusion-root">
    <section className="dsh-ui-card dsh-fusion-card" role="alert">
      <strong className="dsh-ui-heading">{label(seat.locale, '协作状态读取失败', 'Collaboration status unavailable')}</strong>
      <p className="dsh-ui-error dsh-ui-wrap">{snapshot.error}</p>
      <div className="dsh-ui-actions">
        <Button variant="ghost" onClick={() => void store.refresh(seat.sessionId)}>{label(seat.locale, '重试', 'Retry')}</Button>
      </div>
    </section>
  </div> : null
  if (!snapshot.status.available) return <div className="dsh-fusion-root">
    <section className="dsh-ui-card dsh-fusion-card" role="status">
      <strong className="dsh-ui-heading">{label(seat.locale, '协作暂不可用', 'Collaboration unavailable')}</strong>
      <p className="dsh-ui-compact dsh-ui-wrap">{snapshot.status.error ?? label(seat.locale, '检查插件或模型配置后刷新。', 'Check plugin or model configuration, then refresh.')}</p>
      <div className="dsh-ui-actions">
        <Button variant="ghost" onClick={() => void store.refresh(seat.sessionId)}>{label(seat.locale, '刷新状态', 'Refresh status')}</Button>
      </div>
    </section>
  </div>
  if (!task) return native ? null : <div className="dsh-fusion-root">
    <section className="dsh-ui-card dsh-fusion-card" aria-label={label(seat.locale, '协作', 'Collaboration')}>
      <strong className="dsh-ui-heading">{label(seat.locale, '协作', 'Collaboration')}</strong>
      <p className="dsh-ui-compact dsh-ui-wrap">{snapshot.status.error ?? (snapshot.status.configured
        ? label(seat.locale, '与统筹继续对话；需要时由统筹交给副驾。', 'Continue with the Lead; the Lead hands work to the Sidekick when needed.')
        : label(seat.locale, '副驾模型尚未配置，请在插件页的「协作」设置中选择。', 'Choose the Sidekick model in this plugin’s settings on the Plugins page.'))}</p>
      {snapshot.status.error ? <div className="dsh-ui-actions">
        <Button variant="ghost" onClick={() => void store.refresh(seat.sessionId)}>{label(seat.locale, '刷新状态', 'Refresh status')}</Button>
      </div> : null}
    </section>
  </div>
  return <FusionTaskCard client={client} store={store} status={snapshot.status} loadError={snapshot.error} onApplied={onApplied}
    sessionId={seat.sessionId} locale={seat.locale} native={native} />
}

/** The native turn-tail slot is session scoped. Its own SessionSnapshot identifies subagent children. */
function NativeFusionSeat(props: { client: FusionClient; store: FusionClientStore; owner: unknown }) {
  const row = props.owner && typeof props.owner === 'object' ? props.owner as Record<string, unknown> : {}
  const useSession = row.useSession as ((select: (snapshot: { subagent: unknown }) => boolean) => boolean) | undefined
  // The pinned native slot always injects useSession, so the hook is called on
  // every render. Without it, the fallback reports "child" and fails closed before any Lead RPC.
  const isChild = (useSession ?? (() => true))(snapshot => Boolean(snapshot.subagent))
  if (isChild) return null
  return <FusionSeat client={props.client} store={props.store} native owner={props.owner} />
}

/** Plugin-page settings row: the model used when a new Fusion pair is created. */
export function FusionSettingsPanel({ client }: { client: FusionClient }) {
  const subscribeLocale = useCallback((listener: () => void) => client.locale.subscribe(listener), [client])
  const readLocale = useCallback(() => client.locale.getSnapshot().active, [client])
  const locale: FusionLocale = String(useSyncExternalStore(subscribeLocale, readLocale, readLocale)).startsWith('zh') ? 'zh' : 'en'
  const failed = label(locale, '无法读取协作设置。', 'Could not load collaboration settings.')
  const optionsId = useId()
  const [settings, setSettings] = useState<FusionSettings>()
  const [choices, setChoices] = useState<ModelMenuChoice[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const route = settings?.model ?? defaultModelRoute()
  const selected = choices.find(item => item.provider === route.provider && item.model === route.model)
  const efforts = modelMenuEffortOptions(selected, route.reasoningEffort)

  const call = useCallback(
    (endpoint: string, payload: unknown) => client.connection.rpc.call(FUSION_RPC_CHANNEL, endpoint, payload),
    [client],
  )

  useEffect(() => {
    let live = true
    void call('settings', {}).then(async value => {
      if (!live) return
      const result = value as RpcResult<FusionSettings>
      if (!result || result.ok !== true) {
        setError(result && !result.ok && result.error?.message ? result.error.message : failed)
        return
      }
      setSettings(result.value)
      void client.remote?.session?.modelCatalog?.()
        ?.then(catalog => { if (live) setChoices(parseModelMenuChoices(catalog, result.value.model)) })
        .catch(() => { if (live) setChoices([]) })
    }).catch(() => { if (live) setError(failed) })
    return () => { live = false }
  }, [call, client, failed])

  async function save(next: { provider: string; model: string; reasoningEffort?: string }): Promise<void> {
    if (!settings) return
    setBusy(true); setError(''); setNote('')
    try {
      const value = await call('settings.update', {
        expectedRevision: settings.revision,
        model: { provider: next.provider, model: next.model, ...(next.reasoningEffort ? { reasoningEffort: next.reasoningEffort } : {}) },
      })
      const result = value as RpcResult<FusionSettings>
      if (!result || result.ok !== true) {
        throw new Error(result && !result.ok && result.error?.message ? result.error.message : label(locale, '保存失败。', 'Could not save.'))
      }
      setSettings(result.value)
      setNote(label(locale, '已保存。', 'Saved.'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return <section className="fusion-settings" data-testid="fusion-settings">
    {error && <p role="alert" className="dsh-ui-error">{error}</p>}
    {note && <p role="status" className="dsh-ui-notice">{note}</p>}
    <label className="dsh-ui-field" htmlFor={optionsId}>
      <span className="dsh-ui-label">{label(locale, '副驾模型', 'Sidekick model')}</span>
      <select
        id={optionsId}
        className="dsh-ui-select"
        value={modelMenuChoiceKey(route.provider, route.model)}
        disabled={busy || !settings}
        onChange={event => {
          const key = event.target.value
          if (!key) { void save(defaultModelRoute()); return }
          const parsed = parseModelMenuChoiceKey(key)
          if (parsed) void save(parsed)
        }}
      >
        <option value="">{label(locale, '默认模型', 'Default model')}</option>
        {choices.map(choice => (
          <option key={modelMenuChoiceKey(choice.provider, choice.model)} value={modelMenuChoiceKey(choice.provider, choice.model)}>
            {choice.label}
          </option>
        ))}
      </select>
    </label>
    {selected && efforts.length > 0 && (
      <label className="dsh-ui-field" htmlFor={`${optionsId}-effort`}>
        <span className="dsh-ui-label">{label(locale, '思考强度', 'Reasoning effort')}</span>
        <select
          id={`${optionsId}-effort`}
          className="dsh-ui-select"
          value={route.reasoningEffort ?? ''}
          disabled={busy}
          onChange={event => void save({ ...route, reasoningEffort: event.target.value || undefined })}
        >
          <option value="">{label(locale, '默认', 'Default')}</option>
          {efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
        </select>
      </label>
    )}
    {!settings && !error ? <p role="status" className="dsh-ui-hint">{label(locale, '正在读取设置…', 'Loading settings…')}</p> : null}
    <p className="dsh-ui-help">{label(locale, '新建副驾时生效；已有副驾保持其创建时的模型。',
      'Applies to newly created Sidekicks; existing ones keep the model they were created with.')}</p>
  </section>
}

export function apply(ctx: Context): void {
  const client = ctx as unknown as FusionClient
  const store = new FusionClientStore(client)
  /* Slot labels accept a thunk the host re-reads on every projection, so the text follows the active locale. */
  const slotLabel = (): string => label(
    String(client.locale?.getSnapshot?.().active ?? 'zh').startsWith('zh') ? 'zh' : 'en', '协作', 'Collaboration')
  ctx.effect(() => () => store.dispose(), 'dsh-fusion-client.store')
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-plugin', '@klarkxy/dsh-fusion')
    style.textContent = fusionClientStyles
    document.head.appendChild(style)
    return () => style.remove()
  }, 'dsh-fusion-client.styles')
  ctx.effect(() => client.slots.inject('plugins.bundle.config', () => client.slots.register(
    { name: 'plugins.bundle.config', key: FUSION_PLUGIN },
    () => <FusionSettingsPanel client={client} />,
  )), 'dsh-fusion-client.settings')
  ctx.effect(() => client.slots.inject(CHAT_EVENTS_SLOT, () => client.slots.register({
    name: CHAT_EVENTS_SLOT, id: 'fusion', order: 30, label: slotLabel,
  }, (owner: unknown) => <FusionSeat key={seatKey(owner)} client={client} store={store} native={false} owner={owner} />)),
  'dsh-fusion-client.editor')
  // The Editor shell has no native right sidebar; register this seat only in native Web.
  ctx.inject(['sidebarRight'], scope => {
    const nativeClient = scope as unknown as FusionClient
    return nativeClient.slots.inject(NATIVE_TURN_TAIL_SLOT, () => nativeClient.slots.register({
      name: NATIVE_TURN_TAIL_SLOT, id: 'fusion', order: 30, label: slotLabel,
    }, (owner: unknown) => <NativeFusionSeat client={nativeClient} store={store} owner={owner} />))
  })
}

function seatKey(owner: unknown): string {
  if (!owner || typeof owner !== 'object') return ''
  const row = owner as Record<string, unknown>
  const source = row.owner && typeof row.owner === 'object' ? row.owner as Record<string, unknown> : row
  return typeof source.sessionId === 'string' ? source.sessionId : ''
}
