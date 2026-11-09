import type { Context } from '@deepseek-ai/cordis'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { checkShownView } from './core/index.js'
import { PLUGIN_NAME, RPC_CHANNEL, VIEW_OWNER, isRecord, type PendingView, type RpcResult, type ShownView, type ViewPresentation } from './contracts.ts'
import type { ToolViewProps, ToolArgsView, ReplyViewProps, ReplySnapshot } from './runtime.ts'
import { WidgetCard, type Answer } from './widget.tsx'
import { viewStyles } from './styles.ts'
import { checkedAnswer, replyAnswers, sameAnswers } from './answers.ts'

export const name = 'dsh-deep-view-client'
export const inject = ['slots', 'connection', 'locale'] as const
export const LOCALE = 'deep-view'

export const uiZh = {
  copy: '复制', copied: '已复制', footnotes: '脚注', code: '代码', wrap: '自动换行', unwrap: '不换行',
  prepared: '卡片将在最终回复中显示', preparing: '正在准备视图…', error: '视图未能显示', invalid: '视图数据无效',
  local: '仅本地预览；此卡片不会发送回答。', answerFailed: '回答未能发送，请重试。',
  chart: '图表', chartOptions: '图表选项', viewAsChart: '查看图表', viewAsTable: '查看表格', copyData: '复制数据',
  chartNumber: '图表 {n}', value: '值', series: '系列', view: '视图', sources: '来源', progress: '进度', yourAnswer: '你的回答',
  options: '选项', submit: '提交', cancel: '取消', confirm: '确认', send: '发送', selected: '已选择',
}
export const uiEn: Record<keyof typeof uiZh, string> = {
  copy: 'Copy', copied: 'Copied', footnotes: 'Footnotes', code: 'Code', wrap: 'Wrap lines', unwrap: 'Do not wrap lines',
  prepared: 'The card will appear in the final reply', preparing: 'Preparing view…', error: 'The view could not be shown', invalid: 'Invalid view data',
  local: 'Local preview only; this card does not send an answer.', answerFailed: 'The answer could not be sent; try again.',
  chart: 'Chart', chartOptions: 'Chart options', viewAsChart: 'View as chart', viewAsTable: 'View as table', copyData: 'Copy data',
  chartNumber: 'Chart {n}', value: 'Value', series: 'Series', view: 'View', sources: 'Sources', progress: 'Progress', yourAnswer: 'Your answer',
  options: 'Options', submit: 'Submit', cancel: 'Cancel', confirm: 'Confirm', send: 'Send', selected: 'Selected',
}
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
      else setFailed(true)
    }).catch(() => setFailed(true)).finally(() => setBusy(false))
  }, [props.call, props.sessionId, pending, busy])
  if (read.phase === 'preparing') return <div className="dvui-root dvui-tool-loading" role="status">{t('preparing')}</div>
  if (read.isError || !shown) {
    // A settled error or a call without a valid view argument renders the
    // honest fallback; an in-flight call still argues a loading state.
    if (read.phase !== 'result' && !read.isError) return <div className="dvui-root dvui-tool-loading" role="status">{t('preparing')}</div>
    return <div className="dvui-root dvui-tool-error" role="status">{t(read.isError ? 'error' : 'invalid')}</div>
  }
  const canAnswer = shown.awaitReply && pending !== null && answer === null
  return <div className="dvui-root"><WidgetCard title={shown.title} view={shown.view} onSubmit={canAnswer ? submit : undefined} busy={busy} settled={answer !== null || !canAnswer} answer={answer} t={viewT(t)} labels={labels} Markdown={ViewMarkdown} localOnly={answer === null && !canAnswer && shown.interactive} />{failed ? <p className="dvui-tool-error" role="alert">{t('answerFailed')}</p> : null}</div>
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

type Client = Context & {
  connection: { rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<unknown> } }
  slots: {
    inject(key: string, callback: () => unknown): () => void
    register(spec: Record<string, unknown>, render: unknown): () => void
  }
  locale: { register(namespace: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): () => void }
}
export function apply(ctx: Context): void {
  const client = ctx as unknown as Client
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
