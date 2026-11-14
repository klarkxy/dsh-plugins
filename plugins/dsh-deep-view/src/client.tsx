import type { Context } from '@deepseek-ai/cordis'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from 'react'
import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { checkShownView } from './core/index.js'
import { createClientPluginLogger, installClientPluginLogger } from '@klarkxy/dsh-plugin-kit/client-logger'
import { PLUGIN_NAME, RPC_CHANNEL, VIEW_OWNER, isRecord, type PendingView, type RpcResult, type ShownView, type ViewPresentation } from './contracts.ts'
import type { ToolViewProps, ToolArgsView, ReplyViewProps, ReplySnapshot } from './runtime.ts'
import { WidgetCard, type Answer } from './widget.tsx'
import { viewStyles } from './styles.ts'
import { checkedAnswer, replyAnswers, sameAnswers } from './answers.ts'
import { uiEn, uiZh } from './copy.ts'

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
  const meta = phase === 'result' ? block.meta : undefined
  if (isRecord(meta) && meta.owner === VIEW_OWNER) {
    const shown = checkShownView(meta.title, meta.view) as ShownView | { error: string }
    if ('error' in shown) return { title: meta.title, view: meta.view, viewReady: true, phase, isError: true }
    return { presentation: { owner: VIEW_OWNER, ...shown, ...(typeof meta.viewId === 'string' ? { viewId: meta.viewId } : {}), awaitReply: meta.awaitReply === true }, title: meta.title, view: meta.view, viewReady: true, phase, isError }
  }
  const args = block.args
  const title = argField(args, 'title')
  const viewReady = phase !== 'preparing' || isArgsView(args) && args.complete('view')
  const view = viewReady ? argField(args, 'view') : undefined
  return { title, view, viewReady, phase, isError }
}
export function ToolCallView(props: ToolViewProps & { restoredAnswer?: Answer; call(endpoint: string, payload: unknown): Promise<unknown> }) {
  const t = props.t as UiT
  const labels = useMarkdownLabels(t)
  const read = useMemo(() => readToolCall(props), [props.block, props.phase])
  const shown = useMemo(() => {
    if (read.presentation) return read.presentation
    if (!read.viewReady || read.phase === 'preparing') return undefined
    const checked = checkShownView(read.title, read.view) as ShownView | { error: string }
    return 'error' in checked ? undefined : { ...checked, awaitReply: checked.interactive }
  }, [read.presentation, read.viewReady, read.phase, read.title, read.view])
  const [pending, setPending] = useState<PendingView | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [localAnswer, setAnswer] = useState<Answer | null>(null)
  const restored = useMemo(() => shown
    ? checkedAnswer(props.restoredAnswer, read.presentation?.viewId, shown.view) : null,
  [props.restoredAnswer, read.presentation?.viewId, shown])
  const answer = restored ?? localAnswer
  const sequence = useRef(0)
  const callId = props.callId
  useEffect(() => {
    const seq = ++sequence.current
    setPending(null)
    setFailed(false)
    if (restored || !read.presentation?.awaitReply || !callId) return
    void props.call('pending', { sessionId: props.sessionId, callId }).then(result => {
      if (sequence.current !== seq) return
      const envelope = result as RpcResult<PendingView | null> | undefined
      if (envelope?.ok) setPending(envelope.value)
    }).catch(() => {})
    return () => { sequence.current += 1 }
  }, [props.call, props.sessionId, callId, read.presentation?.awaitReply, read.presentation?.viewId, restored])
  const submit = useCallback((action: string, values: Record<string, unknown>) => {
    if (!pending || busy) return
    setBusy(true)
    setFailed(false)
    void props.call('reply', { sessionId: props.sessionId, viewId: pending.id, action, values }).then(result => {
      const envelope = result as RpcResult | undefined
      if (envelope?.ok) { setAnswer({ id: pending.id, action, values }); setPending(null) }
      else {
        createClientPluginLogger(PLUGIN_NAME).warn('reply.rejected', 'Deep View reply was rejected by host.', undefined, {
          sessionId: props.sessionId,
          viewId: pending.id,
          code: envelope && !envelope.ok ? envelope.error.code : null,
        })
        setFailed(true)
      }
    }).catch(error => {
      createClientPluginLogger(PLUGIN_NAME).error('reply.transport-error', 'Deep View reply RPC failed.', error, {
        sessionId: props.sessionId,
        viewId: pending.id,
      })
      setFailed(true)
    }).finally(() => setBusy(false))
  }, [props.call, props.sessionId, pending, busy])
  if (read.phase === 'preparing') return <div className="dvui-root dvui-tool-loading" role="status">{t('preparing')}</div>
  if (read.isError || !shown) {
    // A settled error or a call without a valid view argument renders the
    // honest fallback; an in-flight call still argues a loading state.
    if (read.phase !== 'result' && !read.isError) return <div className="dvui-root dvui-tool-loading" role="status">{t('preparing')}</div>
    return <div className="dvui-root dvui-tool-error" role="status">{t(read.isError ? 'error' : 'invalid')}</div>
  }
  const canAnswer = shown.awaitReply && pending !== null && answer === null
  // Display cards never settle their local inputs; only answer cards lock after their reply window closes.
  return <div className="dvui-root"><WidgetCard title={shown.title} view={shown.view} onSubmit={canAnswer ? submit : undefined} busy={busy} settled={answer !== null || (shown.awaitReply && !canAnswer)} answer={answer} t={viewT(t)} labels={labels} Markdown={ViewMarkdown} localOnly={answer === null && !canAnswer && shown.interactive} />{failed ? <p className="dvui-tool-error" role="alert">{t('answerFailed')}</p> : null}</div>
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

/** Native completed-turn surface: always outside the process disclosure. */
export function ReplyView(props: ReplyViewProps) {
  const cards = props.useChat(snapshot => replyCards(snapshot, props.turn.turn), sameCards)
  const answers = props.useChat(replyAnswers, sameAnswers)
  if (props.turn.status !== 'closed' || cards.length === 0) return null
  return <div className="dvui-root" data-deep-view-reply>{cards.map(block =>
    <ToolCallView key={`${props.sessionId}:${block.callId}`} sessionId={props.sessionId} callId={block.callId}
      phase="result" block={block} t={props.t} call={props.call}
      restoredAnswer={isRecord(block.meta) && typeof block.meta.viewId === 'string' ? answers.get(block.meta.viewId) : undefined} />)}</div>
}

/** Tool activity contains status only, never the user's interactive card. */
export function ToolCallStatus(props: ToolViewProps) {
  const read = readToolCall(props)
  return <div className="dvui-root" role="status">{props.t(read.isError ? 'error'
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
}
export type DeepViewCards = { Card(props: CardProps): ReactElement }

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
    return <ToolCallView sessionId={props.sessionId} callId={props.callId} phase={phase} block={block} t={t as ToolViewProps['t']} call={call} {...props.answer ? { restoredAnswer: props.answer } : {}} />
  }
  return { Card }
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
  client.provide(CARDS_SERVICE, createCards((endpoint, payload) => client.connection.rpc.call(RPC_CHANNEL, endpoint, payload), client.locale))
  ctx.effect(() => client.locale.register(LOCALE, { zh: { ...uiZh }, en: { ...uiEn } }), 'deep-view.locale')
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-plugin', PLUGIN_NAME)
    style.textContent = viewStyles
    document.head.appendChild(style)
    return () => style.remove()
  }, 'deep-view.styles')
  ctx.effect(() => client.slots.inject('tool.call.toolview', () => client.slots.register({
    name: 'tool.call.toolview', key: 'show_view', locale: LOCALE,
  }, ToolCallStatus)), 'deep-view.tool')
  ctx.effect(() => client.slots.inject('conversation.chat.turnTail', () => client.slots.register({
    name: 'conversation.chat.turnTail', id: 'deep-view', order: 20, locale: LOCALE,
    inject: () => ({ call: (endpoint: string, payload: unknown) => client.connection.rpc.call(RPC_CHANNEL, endpoint, payload) }),
  }, ReplyView)), 'deep-view.reply')
}
