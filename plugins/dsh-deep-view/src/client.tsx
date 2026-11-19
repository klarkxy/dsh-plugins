import type { Context } from '@deepseek-ai/cordis'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from 'react'
import { Button, MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'
import { checkShownView, validateViewAnswer } from './core/index.js'
import { createClientPluginLogger, installClientPluginLogger } from '@klarkxy/dsh-plugin-kit/client-logger'
import { PLUGIN_NAME, RPC_CHANNEL, VIEW_OWNER, isRecord, type PendingView, type RpcResult, type ShownView, type ViewNode, type ViewPresentation } from './contracts.ts'
import type { ToolViewProps, ToolArgsView, ReplyViewProps, ReplySnapshot } from './runtime.ts'
import { WidgetCard, type Answer } from './widget.tsx'
import { viewStyles } from './styles.ts'
import { mathStyles } from './math-styles.ts'
import { richStyles } from './rich-styles.ts'
import { vendorCss } from './vendor-css.generated.ts'
import { checkedAnswer, replyAnswers, sameAnswers } from './answers.ts'
import { uiEn, uiZh } from './copy.ts'
import { createViewStateStore, useLatestPending, useLiveSnapshot, useViewPending, useViewProgress, useViewStatus, useViewT, useViewValues } from './client-state.ts'
import { answerText } from './answer-text.ts'
import { fillComposerDraft, type ComposerActions, type FillDraft, type InputSnapshot } from './draft.ts'
import { DeepViewFence, type DeepViewFenceProps } from './fence.tsx'

export const name = 'dsh-deep-view-client'
export const inject = ['slots', 'connection', 'locale'] as const
export const LOCALE = 'deep-view'

export { uiEn, uiZh } from './copy.ts'
type UiKey = keyof typeof uiZh
export type UiT = (key: UiKey, params?: Record<string, unknown>) => string
const viewT = (t: UiT): ((key: string, params?: Record<string, unknown>) => string) => (key, params) => {
  const keys: Record<string, UiKey> = {
    Copy: 'copy', Copied: 'copied', Footnotes: 'footnotes', Chart: 'chart', 'Chart options': 'chartOptions',
    'View as chart': 'viewAsChart', 'View as table': 'viewAsTable', 'Copy data': 'copyData', 'Chart {n}': 'chartNumber',
    Value: 'value', Series: 'series', View: 'view', Sources: 'sources', Progress: 'progress', 'Your answer': 'yourAnswer',
    'Local preview only; this card does not send an answer.': 'local',
    Options: 'options', Submit: 'submit', Cancel: 'cancel', Confirm: 'confirm', Send: 'send', Selected: 'selected',
    sending: 'sending', filling: 'filling', filled: 'filled', fillFailed: 'fillFailed', fillDraft: 'fillDraft', waitingDock: 'waitingDock', expired: 'expired', dismissFailed: 'dismissFailed', 'Dismiss view': 'dismissView',
    draftConflict: 'draftConflict', replaceDraft: 'replaceDraft', appendDraft: 'appendDraft', 'Fill composer': 'fillDraft', Steps: 'steps',
    'Composing interface…': 'composing', 'Point values': 'pointValues',
    'Node graph': 'nodeGraph', 'Select a node': 'selectNode', 'Nothing to explore': 'nothingToExplore',
    '{n} selected: {values}': 'selectedValues', 'Drag to select a range; double-click to clear': 'exploreIntervalHint',
    'Click points to select; double-click to clear': 'explorePointHint', 'The chart could not be drawn.': 'exploreFailed',
    'Data: {n} rows': 'dataRows', 'Showing {shown} of {n} rows': 'dataTruncated', Map: 'map', 'Map marker': 'mapMarker',
    'Zoom in': 'zoomIn', 'Zoom out': 'zoomOut', 'Reset bearing to north': 'resetBearing', 'Map is unavailable in this environment.': 'mapUnavailable',
    'Map failed to load.': 'mapFailed', 'You can still pick a location below.': 'mapFallback', Locations: 'locations',
  }
  return keys[key] ? t(keys[key], params) : key.replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? `{${name}}`))
}

// WidgetCard's Markdown prop is runtime-neutral (labels: unknown); adapt the
// official component once here instead of weakening the widget contract.
function ViewMarkdown(props: Parameters<typeof MarkdownText>[0]) {
  return <MarkdownText {...props} />
}
export function useMarkdownLabels(t: UiT): MarkdownLabels {
  return useMemo(() => ({ code: { copyLabel: t('copy'), copiedLabel: t('copied'), toolbarLabels: { codeLabel: t('code'), wrapLabel: t('wrap'), unwrapLabel: t('unwrap') } }, footnotes: t('footnotes') }), [t])
}

// 'tool.call.toolview' owner contract (dsh-client-ui-tool 0.2.2 slots.d.ts):
// phase 'preparing'|'start' carry a call block whose args is a lazy
// PartialArguments view; 'result' carries a ToolResultNode whose `meta` is the
// persisted output.presentationMeta and whose args may be empty when the call
// left the loaded window.
function isArgsView(value: unknown): value is ToolArgsView {
  return isRecord(value) && typeof value.text === 'function' && typeof value.value === 'function'
}
function argField(args: ToolArgsView | undefined, key: string): unknown {
  if (!isArgsView(args)) return undefined
  const value = args.value(key)
  return value !== undefined ? value : args.text(key)
}
export function readToolCall(props: Pick<ToolViewProps, 'phase' | 'block'>): { presentation?: ViewPresentation; title: unknown; view: unknown; viewReady: boolean; phase: string; isError: boolean } {
  const block = props.block
  const phase = props.phase ?? (block.kind === 'tool-result' ? 'result' : 'start')
  const isError = phase === 'result' && block.isError === true
  const meta = phase === 'result' || block.kind === 'tool-result' ? block.meta : undefined
  if (isRecord(meta) && meta.owner === VIEW_OWNER) {
    const shown = checkShownView(meta.title, meta.view) as ShownView | { error: string }
    if ('error' in shown) return { title: meta.title, view: meta.view, viewReady: true, phase, isError: true }
    return { presentation: { owner: VIEW_OWNER, ...shown, ...(typeof meta.viewId === 'string' ? { viewId: meta.viewId } : {}), awaitReply: meta.awaitReply === true, ...(typeof meta.revision === 'number' && Number.isSafeInteger(meta.revision) && meta.revision > 0 ? { revision: meta.revision } : {}) }, title: meta.title, view: meta.view, viewReady: true, phase, isError }
  }
  const args = block.args
  const title = argField(args, 'title')
  const viewReady = phase !== 'preparing' || isArgsView(args) && args.complete('view')
  const view = viewReady ? argField(args, 'view') : undefined
  return { title, view, viewReady, phase, isError }
}
type ViewStore = ReturnType<typeof createViewStateStore>
type SharedViewProps = ToolViewProps & {
  restoredAnswer?: Answer
  call(endpoint: string, payload: unknown): Promise<unknown>
  store: ViewStore
  surface?: 'inline' | 'dock' | 'history' | 'standalone'
  /** Display views keep the first message position and read the latest snapshot. */
  liveSnapshot?: boolean
  fillDraft?: FillDraft
}
export function ToolCallView(props: SharedViewProps) {
  const t = useViewT(props.store, props.t) as UiT
  const labels = useMarkdownLabels(t)
  const read = useMemo(() => readToolCall(props), [props.block, props.phase])
  const requestedId = read.presentation?.viewId ?? (typeof argField(props.block.args, 'view_id') === 'string' ? argField(props.block.args, 'view_id') as string : props.callId)
  const live = useLiveSnapshot(props.store, props.sessionId, requestedId)
  const shown = useMemo(() => {
    if (props.liveSnapshot && live) return { ...live, awaitReply: live.interactive }
    if (read.presentation) return read.presentation
    if (!read.viewReady || read.phase === 'preparing') return undefined
    const checked = checkShownView(read.title, read.view) as ShownView | { error: string }
    return 'error' in checked ? undefined : { ...checked, awaitReply: checked.interactive }
  }, [read.presentation, read.viewReady, read.phase, read.title, read.view, live, props.liveSnapshot])
  const snapshotId = live?.id ?? requestedId
  const sharedValues = useViewValues(props.store, props.sessionId, snapshotId)
  const onValuesChange = useCallback((values: Record<string, unknown>) => props.store.setValues(props.sessionId, snapshotId, values), [props.store, props.sessionId, snapshotId])
  useEffect(() => {
    if (!shown || shown.revision === undefined) return
    props.store.setSnapshot({ id: snapshotId, sessionId: props.sessionId, title: shown.title, view: shown.view,
      interactive: shown.interactive, revision: shown.revision,
      callId: props.callId, originCallId: props.callId })
  }, [shown, snapshotId, props.store, props.sessionId, props.callId])
  const pending = useViewPending(props.store, props.sessionId, props.callId)
  const status = useViewStatus(props.store, props.callId)
  const [localAnswer, setAnswer] = useState<Answer | null>(null)
  const [draftChoice, setDraftChoice] = useState<{ action: string; values: Record<string, unknown> } | null>(null)
  const restored = useMemo(() => shown
    ? checkedAnswer(props.restoredAnswer, read.presentation?.viewId, shown.view, shown.revision) : null,
  [props.restoredAnswer, read.presentation?.viewId, shown])
  const answer = restored ?? localAnswer
  const sequence = useRef(0)
  const callId = props.callId
  useEffect(() => {
    const seq = ++sequence.current
    if (restored || !read.presentation?.awaitReply || !callId) {
      props.store.clearPending(props.sessionId, callId)
      return
    }
    void props.call('pending', { sessionId: props.sessionId, callId }).then(result => {
      if (sequence.current !== seq) return
      const envelope = result as RpcResult<PendingView | null> | undefined
      if (envelope?.ok) {
        if (envelope.value && (!envelope.value.callId || envelope.value.callId === callId)) props.store.setPending(envelope.value)
        else props.store.clearPending(props.sessionId, callId)
      }
    }).catch(() => {})
    return () => { sequence.current += 1 }
  }, [props.call, props.sessionId, callId, read.presentation?.awaitReply, read.presentation?.viewId, restored, props.store])
  // Keep one editable owner. The inline occurrence is the durable home after
  // the turn; the composer dock only borrows it while work is still running.
  const standalone = props.surface === 'standalone' || props.surface === undefined
  const running = props.useSession?.(snapshot => snapshot.running) ?? false
  const editable = standalone || props.surface === 'dock' || (props.surface === 'history' && !running)
  const canAnswer = shown?.awaitReply === true && pending !== undefined && answer === null && status?.state !== 'filled' && editable
  const submit = useCallback((action: string, values: Record<string, unknown>) => {
    if (!pending || !canAnswer || status?.state === 'sending') return
    props.store.setStatus(callId, { state: 'sending', text: t('sending'), copyKey: 'sending' })
    void props.call('reply', { sessionId: props.sessionId, viewId: pending.id, revision: pending.revision, action, values }).then(result => {
      const envelope = result as RpcResult | undefined
      if (envelope?.ok) {
        setAnswer({ id: pending.id, action, values, revision: pending.revision })
        props.store.clearPending(props.sessionId, callId)
        props.store.setStatus(callId, undefined)
      } else {
        createClientPluginLogger(PLUGIN_NAME).warn('reply.rejected', 'Deep View reply was rejected by host.', undefined, {
          sessionId: props.sessionId, viewId: pending.id, code: envelope && !envelope.ok ? envelope.error.code : null,
        })
        props.store.setStatus(callId, { state: 'failed', text: envelope && !envelope.ok && envelope.error.code === 'stale' ? t('expired') : t('answerFailed'), copyKey: envelope && !envelope.ok && envelope.error.code === 'stale' ? 'expired' : 'answerFailed' })
        if (envelope && !envelope.ok && envelope.error.code === 'stale') props.store.clearPending(props.sessionId, callId)
      }
    }).catch(error => {
      createClientPluginLogger(PLUGIN_NAME).error('reply.transport-error', 'Deep View reply RPC failed.', error, {
        sessionId: props.sessionId, viewId: pending.id,
      })
      props.store.setStatus(callId, { state: 'failed', text: t('answerFailed'), copyKey: 'answerFailed' })
    })
  }, [props.call, props.sessionId, pending, canAnswer, status?.state, props.store, callId, t])
  const input = props.useInput?.(value => value) ?? { draft: '', phase: 'plain' as const }
  const fill = useCallback(async (action: string, values: Record<string, unknown>, replace = false) => {
    if (!pending || !canAnswer || status?.state === 'filling') return
    const checked = validateViewAnswer(pending.view, action, values)
    if (checked.error !== undefined) {
      props.store.setStatus(callId, { state: 'failed', text: String(checked.error) })
      return
    }
    const text = answerText(pending, action, checked)
    props.store.setStatus(callId, { state: 'filling', text: t('filling'), copyKey: 'filling' })
    let accepted = false
    try {
      accepted = props.fillDraft
        ? await props.fillDraft({ sessionId: props.sessionId, text, viewId: pending.id }) === 'filled'
        : fillComposerDraft(input, props.inputActions, text, replace)
    } catch { accepted = false }
    setDraftChoice(null)
    props.store.setStatus(callId, accepted
      ? { state: 'filled', text: t('filled'), copyKey: 'filled' }
      : { state: 'failed', text: t('fillFailed'), copyKey: 'fillFailed' })
  }, [pending, canAnswer, status?.state, props.store, props.fillDraft, props.inputActions, props.sessionId, callId, input, t])
  const dismiss = useCallback(() => {
    if (!pending || !canAnswer) return
    props.store.clearPending(props.sessionId, callId)
    void props.call('dismiss', { sessionId: props.sessionId, viewId: pending.id }).catch(error => {
      createClientPluginLogger(PLUGIN_NAME).warn('dismiss.failed', 'Deep View dismiss RPC failed.', error, { sessionId: props.sessionId, viewId: pending.id })
      props.store.setStatus(callId, { state: 'failed', text: t('dismissFailed'), copyKey: 'dismissFailed' })
    })
  }, [pending, canAnswer, props.store, props.sessionId, callId, props.call])
  if (read.phase === 'preparing') return <div className="dvui-root dvui-tool-loading" role="status">{t('preparing')}</div>
  if (read.isError || !shown) {
    if (read.phase !== 'result' && !read.isError) return <div className="dvui-root dvui-tool-loading" role="status">{t('preparing')}</div>
    return <div className="dvui-root dvui-tool-error" role="status">{t(read.isError ? 'error' : 'invalid')}</div>
  }
  const busy = status?.state === 'sending' || status?.state === 'filling'
  const inactive = shown.awaitReply && (!canAnswer || !editable)
  return <div className="dvui-root">
    <WidgetCard title={shown.title} view={shown.view} ButtonComponent={Button}
      onSubmit={canAnswer ? submit : undefined}
      onFillDraft={canAnswer && (props.fillDraft || props.inputActions) ? (action, values) => {
        if (!props.fillDraft && input.draft.trim() !== '') setDraftChoice({ action, values })
        else void fill(action, values)
      } : undefined}
      onDismiss={canAnswer ? dismiss : undefined} busy={busy}
      settled={answer !== null || inactive} answer={answer} t={viewT(t)} labels={labels} Markdown={ViewMarkdown}
      localOnly={answer === null && shown.interactive && !canAnswer}
      localNote={pending && !editable && running ? t('waitingDock') : undefined}
      values={sharedValues} onValuesChange={onValuesChange} />
    {status ? <p className={status.state === 'failed' ? 'dvui-tool-error' : 'dvui-status'} role={status.state === 'failed' ? 'alert' : 'status'}>{status.copyKey ? t(status.copyKey) : status.text}</p> : null}
    {draftChoice ? <div className="dvui-draft-choice" role="group" aria-label={t('draftConflict')}>
      <p>{t('draftConflict')}</p><div className="dvui-actions">
        <Button variant="primary" onClick={() => void fill(draftChoice.action, draftChoice.values, true)}>{t('replaceDraft')}</Button>
        <Button onClick={() => void fill(draftChoice.action, draftChoice.values)}>{t('appendDraft')}</Button>
        <Button onClick={() => setDraftChoice(null)}>{t('cancel')}</Button>
      </div>
    </div> : null}
  </div>
}

export function isActivityView(view: ViewNode): boolean {
  return view.type === 'progress' || view.type === 'steps' || (view.children ?? []).some(isActivityView)
}

export function ActivityDock(props: ToolViewProps & { call(endpoint: string, payload: unknown): Promise<unknown>; store: ViewStore }) {
  const pending = useLatestPending(props.store, props.sessionId)
  const progress = useViewProgress(props.store, props.sessionId)
  const running = props.useSession?.(snapshot => snapshot.running) ?? true
  const latestMessage = props.useChat?.(snapshot => snapshot.order.at(-1))
  const status = useViewStatus(props.store, pending?.callId ?? '')
  const t = useViewT(props.store, props.t) as UiT
  const labels = useMarkdownLabels(t)
  const pendingBlock = useMemo(() => pending ? { callId: pending.callId!, kind: 'tool-result' as const,
    meta: { owner: VIEW_OWNER, viewId: pending.id, title: pending.title, view: pending.view, interactive: true, awaitReply: true, revision: pending.revision } } : undefined, [pending])
  useEffect(() => { if (!running) props.store.clearProgress(props.sessionId) }, [running, props.store, props.sessionId])
  useEffect(() => {
    if (!pending?.callId || latestMessage === undefined) return
    let current = true
    void props.call('pending', { sessionId: props.sessionId, callId: pending.callId }).then(result => {
      if (!current) return
      const envelope = result as RpcResult<PendingView | null> | undefined
      if (envelope?.ok && !envelope.value) props.store.clearPending(props.sessionId, pending.callId!)
    }).catch(() => {})
    return () => { current = false }
  }, [latestMessage, pending?.callId, props.call, props.sessionId, props.store])
  if (running && pending && status?.state !== 'filled') {
    return <div className="dvui-root dvui-dock"><ToolCallView {...props} key={pending.id} callId={pending.callId!} phase="result"
      block={pendingBlock!}
      store={props.store} surface="dock" /></div>
  }
  if (running && progress) return <div className="dvui-root dvui-dock dvui-activity"><WidgetCard key={progress.callId} title={progress.title} view={progress.view} ButtonComponent={Button} t={viewT(t)} labels={labels} Markdown={ViewMarkdown} /></div>
  return null
}


/** Collect only this turn's successfully persisted cards, including PTC children.
 * The turn index also covers hidden process rows; no all-history scan or DOM
 * relocation is needed. Result metadata works even when arguments were evicted.
 */
export function replyCards(snapshot: ReplySnapshot, turn: number): ToolViewProps['block'][] {
  const cards: ToolViewProps['block'][] = []
  const seen = new Set<string>()
  const visit = (block: ToolViewProps['block']) => {
    if (block.kind === 'tool-result' && !block.isError && !seen.has(block.callId)
      && isRecord(block.meta) && block.meta.owner === VIEW_OWNER) {
      const read = readToolCall({ phase: 'result', block })
      if (read.presentation && !read.isError) { seen.add(block.callId); cards.push(block) }
    }
    for (const child of block.subCalls ?? []) visit(child)
  }
  for (const key of snapshot.locations.getTurn(turn)) {
    const node = snapshot.nodes.get(key)
    if (node?.kind === 'tool-call' && node.data?.root) visit(node.data.root)
  }
  return cards
}

const sameCards = (left: ToolViewProps['block'][], right: ToolViewProps['block'][]) =>
  left.length === right.length && left.every((block, index) => block === right[index])

/** Native turn surface: answers and revised final snapshots settle at the tail;
 * initial display views stay at their tool position while work is running. */
export function ReplyView(props: ReplyViewProps & { store: ViewStore }) {
  const cards = props.useChat(snapshot => {
    const latest = new Map<string, ToolViewProps['block']>()
    for (const block of replyCards(snapshot, props.turn.turn)) {
      const read = readToolCall({ phase: 'result', block })
      const presentation = read.presentation
      if (!presentation || presentation.awaitReply !== true && (presentation.revision ?? 1) <= 1) continue
      const id = presentation.viewId ?? block.callId
      const previous = latest.get(id)
      if (!previous || (readToolCall({ phase: 'result', block: previous }).presentation?.revision ?? 1) < (presentation.revision ?? 1)) latest.set(id, block)
    }
    return [...latest.values()]
  }, sameCards)
  const answers = props.useChat(replyAnswers, sameAnswers)
  if (props.turn.status !== 'closed' || cards.length === 0) return null
  return <div className="dvui-root" data-deep-view-reply>{cards.map(block =>
    <ToolCallView key={`${props.sessionId}:${block.callId}`} sessionId={props.sessionId} callId={block.callId}
      phase="result" block={block} t={props.t} call={props.call} store={props.store} surface="history"
      inputActions={props.inputActions} useInput={props.useInput} useSession={props.useSession} useChat={props.useChat}
      restoredAnswer={isRecord(block.meta) && typeof block.meta.viewId === 'string' ? answers.get(block.meta.viewId) : undefined} />)}</div>
}

/** While the turn is running the real card lives here; the tail owns settled history. */
export function ToolCallStatus(props: ToolViewProps & { store: ViewStore; call(endpoint: string, payload: unknown): Promise<unknown> }) {
  const t = useViewT(props.store, props.t)
  const read = useMemo(() => readToolCall(props), [props.block, props.phase])
  const running = props.useSession?.(snapshot => snapshot.running) ?? props.phase !== 'result'
  const progress = useViewProgress(props.store, props.sessionId)
  const shown = useMemo(() => {
    if (read.presentation) return read.presentation
    if (!read.viewReady || read.phase === 'preparing') return undefined
    const checked = checkShownView(read.title, read.view) as ShownView | { error: string }
    return 'error' in checked ? undefined : { ...checked, awaitReply: checked.interactive }
  }, [read.presentation, read.viewReady, read.phase, read.title, read.view])
  const live = useLiveSnapshot(props.store, props.sessionId, read.presentation?.viewId)
  // A superseded result still owns its canonical snapshot. Commit it here even
  // though only the first tool position renders the live display.
  useEffect(() => {
    const snapshot = read.presentation
    if (!snapshot?.viewId || snapshot.revision === undefined) return
    props.store.setSnapshot({ id: snapshot.viewId, sessionId: props.sessionId, title: snapshot.title,
      view: snapshot.view, interactive: snapshot.interactive, revision: snapshot.revision,
      callId: props.callId, originCallId: props.callId })
  }, [read.presentation, props.store, props.sessionId, props.callId])
  useEffect(() => {
    if (!running || !shown || !isActivityView(shown.view)) {
      props.store.clearProgress(props.sessionId)
      return
    }
    props.store.setProgress(props.sessionId, { callId: props.callId, title: shown.title, view: shown.view })
    return () => {
      if (props.store.progress(props.sessionId)?.callId === props.callId) props.store.clearProgress(props.sessionId)
    }
  }, [running, shown, props.store, props.sessionId, props.callId])
  const superseded = live !== undefined && live.originCallId !== props.callId && live.id === read.presentation?.viewId
  const tailOwned = !running && shown?.awaitReply === false && (live?.revision ?? shown?.revision ?? 1) > 1
  if (read.phase !== 'preparing' && !read.isError && shown && !superseded && !tailOwned
    && (!running || (!isActivityView(shown.view) && progress?.callId !== props.callId))
    && (running || !shown.awaitReply)) {
    return <ToolCallView {...props} surface="inline" liveSnapshot={live?.originCallId === props.callId} />
  }
  return <div className="dvui-root dvui-tool-loading" role="status">{t(read.isError ? 'error'
    : read.phase === 'result' && !read.presentation ? 'invalid'
    : read.phase === 'result' ? 'prepared' : 'preparing')}</div>
}

/** Client service name other plugins read to draw show_view cards in their own surfaces. */
export const CARDS_SERVICE = 'dshDeepView'

export type CardProps = {
  sessionId: string
  callId: string
  /** The committed result's presentation metadata, when the call has finished. */
  presentation?: unknown
  /** Raw call arguments while the result is pending. */
  title?: unknown
  view?: unknown
  failed?: boolean
  /** The human's committed answer, restored from history. */
  answer?: Answer
  inputActions?: ComposerActions
  useInput?<T>(selector: (snapshot: InputSnapshot) => T, equal?: (left: T, right: T) => boolean): T
  /** Optional adapter for plugin-owned chat panels. It never sends the draft. */
  fillDraft?: FillDraft
}
export type DeepViewCards = { Card(props: CardProps): ReactElement; readonly store: ViewStore }

function staticArgs(values: Record<string, unknown>): ToolArgsView {
  return {
    has: key => values[key] !== undefined,
    complete: key => values[key] !== undefined,
    text: key => typeof values[key] === 'string' ? values[key] as string : undefined,
    value: key => values[key],
  }
}

/** One show_view card for a plugin-drawn chat: same card, same answer channel as the host chat. */
export function createCards(call: (endpoint: string, payload: unknown) => Promise<unknown>, locale: { getSnapshot?(): { active?: string }; subscribe?(listener: () => void): () => void } | undefined): DeepViewCards {
  const subscribe = (listener: () => void) => locale?.subscribe?.(listener) ?? (() => {})
  const active = () => locale?.getSnapshot?.().active ?? 'en'
  const store = createViewStateStore(locale)
  function Card(props: CardProps) {
    const language = useSyncExternalStore(subscribe, active)
    const t = useMemo<UiT>(() => {
      const table: Record<string, string> = language.toLowerCase().startsWith('zh') ? uiZh : uiEn
      return (key, params) => (table[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? `{${name}}`))
    }, [language])
    const block = useMemo(() => props.presentation !== undefined
      ? { callId: props.callId, kind: 'tool-result' as const, meta: props.presentation, isError: false }
      : props.failed
        ? { callId: props.callId, kind: 'tool-result' as const, isError: true }
        : { callId: props.callId, args: staticArgs({ title: props.title, view: props.view }) },
    [props.callId, props.presentation, props.failed, props.title, props.view])
    const phase = props.presentation !== undefined || props.failed ? 'result' : 'start'
    return <ToolCallView sessionId={props.sessionId} callId={props.callId} phase={phase} block={block} t={t as ToolViewProps['t']} call={call} store={store} surface="standalone"
      inputActions={props.inputActions} useInput={props.useInput} fillDraft={props.fillDraft} {...props.answer ? { restoredAnswer: props.answer } : {}} />
  }
  return { Card, store }
}

export function DeepViewFenceSlot(props: DeepViewFenceProps) {
  return <div className="dvui-root" data-deep-view-inline><DeepViewFence {...props} /></div>
}

type Client = Context & {
  connection: { rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<unknown> } }
  slots: {
    inject(key: string, callback: () => unknown): () => void
    register(spec: Record<string, unknown>, render: unknown): () => void
  }
  locale: { register(namespace: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): () => void; getSnapshot?(): { active?: string }; subscribe?(listener: () => void): () => void }
  provide(name: string, value: unknown): void
}
export function apply(ctx: Context): void {
  const client = ctx as unknown as Client
  installClientPluginLogger(ctx, PLUGIN_NAME)
  const call = (endpoint: string, payload: unknown) => client.connection.rpc.call(RPC_CHANNEL, endpoint, payload)
  const cards = createCards(call, client.locale)
  client.provide(CARDS_SERVICE, cards)
  const store = cards.store
  ctx.effect(() => client.locale.register(LOCALE, { zh: { ...uiZh }, en: { ...uiEn } }), 'deep-view.locale')
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-plugin', PLUGIN_NAME)
    style.textContent = officialUiCss(['dvui-root']) + viewStyles + mathStyles + richStyles + vendorCss
    document.head.appendChild(style)
    return () => style.remove()
  }, 'deep-view.styles')
  ctx.effect(() => client.slots.inject('tool.call.toolview', () => client.slots.register({
    name: 'tool.call.toolview', key: 'show_view', locale: LOCALE,
    inject: () => ({ call, store }),
  }, ToolCallStatus)), 'deep-view.tool')
  for (const language of ['deepui', 'deep-view']) ctx.effect(() => client.slots.inject('conversation.chat.markdown.fence', () => client.slots.register({
    name: 'conversation.chat.markdown.fence', id: 'deep-view', key: language, locale: LOCALE,
  }, DeepViewFenceSlot)), `deep-view.fence.${language}`)
  ctx.effect(() => client.slots.inject('conversation.input.dock', () => client.slots.register({
    name: 'conversation.input.dock', id: 'deep-view', order: 12, locale: LOCALE,
    inject: () => ({ call, store }),
  }, ActivityDock)), 'deep-view.dock')
  ctx.effect(() => client.slots.inject('conversation.chat.turnTail', () => client.slots.register({
    name: 'conversation.chat.turnTail', id: 'deep-view', order: 20, locale: LOCALE,
    inject: () => ({ call, store }),
  }, ReplyView)), 'deep-view.reply')
}
