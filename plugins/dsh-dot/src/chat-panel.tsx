/**
 * Dorothy's own chat. Her sessions carry the subagent origin, so the host's
 * conversation view never shows them; this panel draws them as one chat instead:
 * messages, tool activity, task updates, deep-view cards, a marker where the
 * conversation moved to a new session segment, and a composer. It long-polls
 * the host feed and redraws on every change.
 */
import {
  Button, DisclosureRow, IconCheckOutlineRegular, IconChecklistOutlineRegular, IconCloseOutlineRegular,
  IconDataOutlineRegular, IconSettingsOutlineRegular, IconUserOutlineRegular,
  MarkdownText, StateDot, Tag, TextShimmer, UserMessageBubble, type MarkdownLabels, type StateDotState, type TagTone,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from 'react'
import { Board } from './board.tsx'
import { filterVisibleChat } from './chat-filter.ts'
import { formatToolDetail, parseNotice, permissionLabel, resolveSessionBadge, summarizeNotice, summarizeToolCall, summarizeToolGroup, type KnownTaskMeta, type NoticeEntry, type SessionBadge, type TaskLookup } from './chat-format.ts'
import { ContextPanel, type ContextApi } from './context-panel.tsx'
import { PersonaPanel, type KnowledgeApi } from './persona-panel.tsx'
import { TrajectoryPanel, type TrajectoryApi } from './trajectory-panel.tsx'
import type { BoardView, ChatItem, ChatSnapshot, DotSettings } from './contracts.ts'
import { SettingsPanel, settingsCss, type SaveNotice, type SettingsApi } from './settings-panel.tsx'
import { t, toolLabel, type CopyLocale } from './ui-copy.ts'
import { DotAvatar } from './whale.tsx'

export const CHAT_ROOT = 'dsh-dot-chat'

const BOARD_POLL_MS = 5_000
const RETRY_MS = 2_000
/** A sent message waits this long to show up in the log before its local echo is dropped. */
const ECHO_MS = 60_000
const STICK_PX = 96

export interface ChatApi extends SettingsApi, ContextApi, TrajectoryApi, KnowledgeApi {
  chat(itemsRev: number, signal: AbortSignal): Promise<ChatSnapshot | undefined>
  wait(rev: number, itemsRev: number, signal: AbortSignal): Promise<ChatSnapshot | undefined>
  say(text: string): Promise<void>
  stop(): Promise<void>
  board(signal: AbortSignal): Promise<BoardView>
  /** Remove one of Dorothy's reminders from the board. */
  removeSchedule(id: string): Promise<boolean>
  settings(signal: AbortSignal): Promise<DotSettings>
}

/** deep-view's client card, read from its service when that plugin is installed. */
export type CardComponent = ComponentType<{ sessionId: string; callId: string; presentation?: unknown; title?: unknown; view?: unknown; failed?: boolean; answer?: { id: string; action: string; values: Record<string, unknown> } }>

interface ChatState {
  readonly snapshot?: ChatSnapshot
  readonly items: readonly ChatItem[]
  readonly answers: NonNullable<ChatSnapshot['answers']>
}

/** Keep the item list across snapshots that leave it out. */
function merge(state: ChatState, next: ChatSnapshot | undefined): ChatState {
  if (!next) return state
  return next.items ? { snapshot: next, items: next.items, answers: next.answers ?? {} } : { ...state, snapshot: next }
}

function useChatFeed(api: ChatApi): { state: ChatState; error?: string; retry: () => void } {
  const [state, setState] = useState<ChatState>({ items: [], answers: {} })
  const [error, setError] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const lifetime = new AbortController()
    let current: ChatState = { items: [], answers: {} }
    const apply = (next: ChatSnapshot | undefined) => { current = merge(current, next); setState(current); setError(undefined) }
    void (async () => {
      while (!lifetime.signal.aborted) {
        try {
          const known = current.snapshot
          apply(known ? await api.wait(known.rev, known.itemsRev, lifetime.signal) : await api.chat(0, lifetime.signal))
        } catch (failure) {
          if (lifetime.signal.aborted) return
          setError(failure instanceof Error ? failure.message : String(failure))
          await new Promise(resolve => setTimeout(resolve, RETRY_MS))
        }
      }
    })()
    return () => lifetime.abort()
  }, [api, attempt])
  return { state, ...error === undefined ? {} : { error }, retry: useCallback(() => setAttempt(value => value + 1), []) }
}

function useBoard(api: ChatApi): [BoardView | undefined, () => void] {
  const [view, setView] = useState<BoardView>()
  const [round, setRound] = useState(0)
  useEffect(() => {
    const lifetime = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = () => {
      api.board(lifetime.signal).then(setView, () => {}).finally(() => {
        if (!lifetime.signal.aborted) timer = setTimeout(run, BOARD_POLL_MS)
      })
    }
    run()
    return () => { lifetime.abort(); if (timer !== undefined) clearTimeout(timer) }
  }, [api, round])
  return [view, useCallback(() => setRound(value => value + 1), [])]
}

function useSettings(api: ChatApi): [DotSettings | undefined, (next: DotSettings) => void] {
  const [settings, setSettings] = useState<DotSettings>()
  useEffect(() => {
    const lifetime = new AbortController()
    api.settings(lifetime.signal).then(setSettings, () => {})
    return () => lifetime.abort()
  }, [api])
  return [settings, setSettings]
}

type Row =
  | { kind: 'item'; item: ChatItem; lead: boolean }
  | { kind: 'tools'; key: string; items: Extract<ChatItem, { kind: 'tool' }>[]; lead: boolean }

/** Consecutive tool calls fold into one activity row; a reply block shows the avatar once. */
function rowsOf(items: readonly ChatItem[]): Row[] {
  const rows: Row[] = []
  let inReply = false
  for (const item of items) {
    // A card that never displayed leaves no trace; the model follows up in text.
    if (item.kind === 'view' && item.failed) continue
    const replyPart = item.kind === 'bot' || item.kind === 'tool' || item.kind === 'view' || item.kind === 'error'
    const lead = replyPart && !inReply
    inReply = replyPart
    const last = rows.at(-1)
    if (item.kind === 'tool' && last?.kind === 'tools') { last.items.push(item); continue }
    rows.push(item.kind === 'tool' ? { kind: 'tools', key: item.key, items: [item], lead } : { kind: 'item', item, lead })
  }
  return rows
}

type SettingsTab = 'settings' | 'persona' | 'context' | 'trajectory'

function SettingsDrawer({ locale, api, settings, tab, trajectoryRev, running, onTab, onSaved, onClose }: { locale: CopyLocale; api: ChatApi; settings?: DotSettings; tab: SettingsTab; trajectoryRev?: number; running: boolean; onTab: (tab: SettingsTab) => void; onSaved: (next: DotSettings) => void; onClose: () => void }) {
  const [saveNotice, setSaveNotice] = useState<SaveNotice>()
  const [proposalCount, setProposalCount] = useState(0)
  useEffect(() => {
    const close = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) onClose() }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [onClose])
  useEffect(() => { setSaveNotice(undefined) }, [tab])
  useEffect(() => {
    if (saveNotice?.kind !== 'saved') return
    const timer = setTimeout(() => setSaveNotice(undefined), 2200)
    return () => clearTimeout(timer)
  }, [saveNotice])
  useEffect(() => {
    const life = new AbortController()
    api.settingProposals(life.signal).then(rows => { if (!life.signal.aborted) setProposalCount(rows.length) }, () => {})
    return () => life.abort()
  }, [api])
  const items: readonly { value: SettingsTab; label: string; title: string; icon: ReactNode }[] = [
    { value: 'settings', label: t(locale, 'settings'), title: t(locale, 'settings'), icon: <IconSettingsOutlineRegular size={14} /> },
    { value: 'persona', label: t(locale, 'tabPersona'), title: t(locale, 'personaTitle'), icon: <IconUserOutlineRegular size={14} /> },
    { value: 'context', label: t(locale, 'tabContext'), title: t(locale, 'ctxTitle'), icon: <IconDataOutlineRegular size={14} /> },
    { value: 'trajectory', label: t(locale, 'viewTrajectory'), title: t(locale, 'trTitle'), icon: <IconChecklistOutlineRegular size={14} /> },
  ]
  const activeItem = items.find(item => item.value === tab) ?? items[0]!
  return (
    <div className="dsh-dot-settings-layer">
      <button type="button" tabIndex={-1} className="dsh-dot-settings-backdrop" aria-label={t(locale, 'closeSettings')} onClick={onClose} />
      <section className="dsh-dot-settings-drawer" role="dialog" aria-label={t(locale, 'settings')}>
        <nav className="dsh-dot-settings-nav" aria-label={t(locale, 'tabsLabel')}>
          <div className="dsh-dot-settings-brand">{t(locale, 'dot')}</div>
          {items.map(item => (
            <button
              key={item.value}
              type="button"
              aria-pressed={tab === item.value}
              aria-controls={`dsh-dot-settings-panel-${item.value}`}
              onClick={() => onTab(item.value)}
            >
              {item.icon}
              <span className="dsh-dot-nav-label">{item.label}</span>
              {item.value === 'settings' && proposalCount > 0 ? <span className="dsh-dot-nav-badge">{proposalCount}</span> : null}
            </button>
          ))}
        </nav>
        <div className="dsh-dot-settings-right">
          <header className="dsh-dot-settings-head">
            <h2 className="dsh-dot-settings-title">{activeItem.title}</h2>
            <span className="dsh-dot-spacer" />
            {saveNotice?.kind === 'saved' ? (
              <span className="dsh-dot-settings-status" role="status">
                <IconCheckOutlineRegular size={13} />
                {t(locale, 'saved')}
              </span>
            ) : null}
            {saveNotice?.kind === 'error' ? (
              <span className="dsh-dot-settings-status dsh-dot-settings-status--error" role="alert">
                {t(locale, 'saveFailed')}{saveNotice.message}
              </span>
            ) : null}
            <Button variant="ghost" size="sm" icon={<IconCloseOutlineRegular size={15} />} aria-label={t(locale, 'closeSettings')} onClick={onClose} />
          </header>
          <div className="dsh-dot-settings-scroll">
            <div className="dsh-dot-settings" data-tab={tab} id={`dsh-dot-settings-panel-${tab}`} role="region" aria-label={activeItem.title}>
              {tab === 'settings'
                ? <SettingsPanel locale={locale} api={api} {...settings ? { settings } : {}} onSaved={onSaved} onStatusChange={setSaveNotice} onProposalCount={setProposalCount} />
                : tab === 'persona'
                  ? <PersonaPanel locale={locale} api={api} {...settings ? { settings } : {}} onSaved={onSaved} onStatusChange={setSaveNotice} />
                  : tab === 'context'
                    ? <ContextPanel locale={locale} api={api} running={running} />
                    : <TrajectoryPanel locale={locale} api={api} {...trajectoryRev === undefined ? {} : { rev: trajectoryRev }} running={running} />}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}


export interface ChatPanelProps {
  readonly locale: CopyLocale
  readonly api: ChatApi
  readonly Card?: CardComponent
  readonly onOpenSession: (sessionId: string) => void
}

export function ChatPanel({ locale, api, Card, onOpenSession }: ChatPanelProps) {
  const { state, error, retry } = useChatFeed(api)
  const [board, refreshBoard] = useBoard(api)
  const removeSchedule = useCallback((id: string) => { void api.removeSchedule(id).then(refreshBoard, refreshBoard) }, [api, refreshBoard])
  const snapshot = state.snapshot
  const running = snapshot?.running === true
  const streaming = snapshot?.streaming ?? ''
  const [echoes, setEchoes] = useState<{ text: string; at: number }[]>([])
  const [sendError, setSendError] = useState<string>()
  const [boardOpen, setBoardOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('settings')
  const [settings, setSettings] = useSettings(api)
  const labels = useMemo<MarkdownLabels>(() => ({ code: { copyLabel: locale === 'zh' ? '复制' : 'Copy', copiedLabel: locale === 'zh' ? '已复制' : 'Copied' }, footnotes: locale === 'zh' ? '脚注' : 'Footnotes' }), [locale])

  // A local echo leaves once the log holds a matching message sent after it.
  // Filtered during render as well, so the frame that brings the logged copy
  // never shows both.
  const delivered = useCallback((echo: { text: string; at: number }) => state.items.some(item => item.kind === 'user' && item.text.trim() === echo.text && item.at >= echo.at - 5_000), [state.items])
  const pendingEchoes = useMemo(() => echoes.filter(echo => !delivered(echo)), [echoes, delivered])
  useEffect(() => {
    if (echoes.length === 0) return
    const now = Date.now()
    const left = echoes.filter(echo => now - echo.at < ECHO_MS && !delivered(echo))
    if (left.length !== echoes.length) setEchoes(left)
  }, [echoes, delivered])

  const send = useCallback(async (text: string) => {
    setSendError(undefined)
    const echo = { text, at: Date.now() }
    setEchoes(list => [...list, echo])
    try { await api.say(text) } catch (failure) {
      setEchoes(list => list.filter(item => item !== echo))
      setSendError(failure instanceof Error ? failure.message : String(failure))
      throw failure
    }
  }, [api])

  const hasStreaming = Boolean(streaming.trim())
  const filtered = useMemo(() => filterVisibleChat(state.items, { streaming: hasStreaming }), [state.items, hasStreaming])
  const rows = useMemo(() => rowsOf(filtered.items), [filtered.items])
  const scroller = useRef<HTMLDivElement>(null)
  const stuck = useRef(true)
  const onScroll = useCallback(() => {
    const el = scroller.current
    if (el) stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX
  }, [])
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stuck.current) el.scrollTop = el.scrollHeight
  }, [rows, streaming, pendingEchoes, running])

  const live = board?.tasks.filter(task => task.status !== 'archived').length ?? 0
  const waiting = board?.pending.length ?? 0
  const tasksBySession = useMemo<TaskLookup>(() => {
    const map = new Map<string, KnownTaskMeta>()
    for (const task of board?.tasks ?? []) map.set(task.sessionId, { title: task.title, ...task.cwd ? { cwd: task.cwd } : {} })
    return map
  }, [board?.tasks])
  const lastTool = rows.at(-1)?.kind === 'tools'
  const showThinking = running && !streaming && !lastTool && !filtered.silentTail

  return (
    <div className={CHAT_ROOT}>
      <header className="dsh-dot-head">
        <DotAvatar size={32} />
        <div className="dsh-dot-head-text">
          <span className="dsh-dot-name">{t(locale, 'dot')}</span>
          <span className="dsh-dot-status" data-running={running ? '' : undefined}>{running ? t(locale, 'working') : t(locale, 'online')}</span>
        </div>
        <span className="dsh-dot-spacer" />
        <Button variant="ghost" size="sm" aria-expanded={boardOpen} onClick={() => setBoardOpen(open => !open)}>
          {t(locale, 'tasks')} {live}{waiting > 0 ? <span className="dsh-dot-badge">{waiting}</span> : null}
        </Button>
        <Button variant="ghost" size="sm" aria-label={t(locale, 'settings')} aria-pressed={settingsOpen} title={t(locale, 'settings')} onClick={() => setSettingsOpen(open => !open)}>
          <GearGlyph />
        </Button>
      </header>
      <div className="dsh-dot-main">
      {boardOpen ? <div className="dsh-dot-boardwrap"><Board locale={locale} view={board} onOpen={onOpenSession} onRetry={() => {}} onRemoveSchedule={removeSchedule} /></div> : null}
      <div className="dsh-dot-scroll" ref={scroller} onScroll={onScroll}>
        <div className="dsh-dot-log">
          {snapshot === undefined && error === undefined ? <div className="dsh-dot-center"><DotAvatar size={56} /><span className="dsh-dot-muted">{t(locale, 'loading')}</span></div> : null}
          {snapshot !== undefined && rows.length === 0 && pendingEchoes.length === 0 && (!running || filtered.silentTail) ? (
            <div className="dsh-dot-center">
              <DotAvatar size={72} />
              <span className="dsh-dot-greeting">{t(locale, 'greeting')}</span>
              <span className="dsh-dot-muted">{t(locale, 'greetingHint')}</span>
            </div>
          ) : null}
          {rows.map(row => <Fragment key={row.kind === 'tools' ? 'tools:' + row.key : row.item.key}>{renderRow(row, { locale, labels, Card, sessionId: snapshot?.sessionId ?? '', answers: state.answers, hiddenRequestIds: filtered.hiddenRequestIds, tasks: tasksBySession, onOpenSession })}</Fragment>)}
          {pendingEchoes.map(echo => <div key={'echo:' + echo.at} className="dsh-dot-user dsh-dot-echo"><UserMessageBubble>{echo.text}</UserMessageBubble></div>)}
          {streaming ? <BotLine lead={!rows.length || rows.at(-1)?.kind === 'item' && (rows.at(-1) as { item: ChatItem }).item.kind !== 'bot'}><MarkdownText text={streaming} streaming labels={labels} variant="body" /></BotLine> : null}
          {showThinking ? <BotLine lead={!lastTool}><TextShimmer active>{t(locale, 'thinking')}</TextShimmer></BotLine> : null}
        </div>
      </div>
      {error !== undefined ? (
        <div className="dsh-dot-banner" role="alert">
          <span>{t(locale, 'loadFailed')}: {error}</span>
          <Button variant="ghost" size="sm" onClick={retry}>{t(locale, 'retry')}</Button>
        </div>
      ) : null}
      <Composer locale={locale} running={running} disabled={snapshot === undefined} onSend={send} onStop={() => { void api.stop() }} {...sendError === undefined ? {} : { error: sendError }} />
      {settingsOpen ? <SettingsDrawer locale={locale} api={api} {...settings ? { settings } : {}} tab={settingsTab} {...snapshot ? { trajectoryRev: snapshot.itemsRev } : {}} running={running} onTab={setSettingsTab} onSaved={setSettings} onClose={() => setSettingsOpen(false)} /> : null}
      </div>
    </div>
  )
}

function BotLine({ lead, children }: { lead: boolean; children: ReactNode }) {
  return (
    <div className="dsh-dot-bot">
      <span className="dsh-dot-gutter">{lead ? <DotAvatar size={28} /> : null}</span>
      <div className="dsh-dot-body">{children}</div>
    </div>
  )
}

interface RenderContext {
  readonly locale: CopyLocale
  readonly labels: MarkdownLabels
  readonly Card?: CardComponent
  readonly sessionId: string
  readonly answers: NonNullable<ChatSnapshot['answers']>
  readonly hiddenRequestIds: ReadonlySet<string>
  readonly tasks: TaskLookup
  readonly onOpenSession: (sessionId: string) => void
}

function renderRow(row: Row, context: RenderContext): ReactNode {
  if (row.kind === 'tools') return <BotLine lead={row.lead}><ToolActivity locale={context.locale} items={row.items} tasks={context.tasks} onOpenSession={context.onOpenSession} /></BotLine>
  const item = row.item
  switch (item.kind) {
    case 'user':
    case 'answer':
      return <div className={'dsh-dot-user' + (item.kind === 'answer' ? ' dsh-dot-answer' : '')}><UserMessageBubble>{item.text}</UserMessageBubble></div>
    case 'notice':
      return <Notice locale={context.locale} text={item.text} hiddenRequestIds={context.hiddenRequestIds} tasks={context.tasks} onOpenSession={context.onOpenSession} />
    case 'segment':
      return <div className="dsh-dot-segment" role="separator"><span>{t(context.locale, 'segmentMark')}</span></div>
    case 'bot':
      return <BotLine lead={row.lead}><MarkdownText text={item.text} labels={context.labels} variant="body" /></BotLine>
    case 'error':
      return <BotLine lead={row.lead}><div className="dsh-dot-turn-error"><StateDot state="error" /><span><strong>{t(context.locale, 'errorTitle')}</strong> {item.text}</span></div></BotLine>
    case 'view': {
      const Card = context.Card
      const viewId = typeof item.presentation?.viewId === 'string' ? item.presentation.viewId : undefined
      const answer = viewId ? context.answers[viewId] : undefined
      return (
        <BotLine lead={row.lead}>
          {Card
            ? <Card sessionId={context.sessionId} callId={item.key} {...item.presentation ? { presentation: item.presentation } : {}} title={item.title} view={item.view} {...item.failed ? { failed: true } : {}} {...answer && viewId ? { answer: { id: viewId, ...answer } } : {}} />
            : <span className="dsh-dot-muted">{t(context.locale, 'cardsMissing')}</span>}
        </BotLine>
      )
    }
    default:
      return null
  }
}

function SessionLink({ badge, locale, onOpen }: { badge: SessionBadge; locale: CopyLocale; onOpen: (sessionId: string) => void }) {
  return (
    <button
      type="button"
      className="dsh-dot-session-btn"
      title={`${t(locale, 'openSessionTip')} · ${badge.tooltip}`}
      onClick={() => onOpen(badge.sessionId)}
    >
      <span className="dsh-dot-session-label">{badge.label}</span>
      <JumpGlyph />
    </button>
  )
}

function RowSummary({ text, tone }: { text: string; tone?: 'normal' | 'muted' | 'error' }) {
  return (
    <>
      <span className="dsh-dot-row-sep" data-shimmer-decoration aria-hidden="true" />
      <span className="dsh-dot-row-summary" data-tone={tone}>{text}</span>
    </>
  )
}

function ToolCallRow({
  item,
  single,
  locale,
  tasks,
  onOpenSession,
}: {
  item: Extract<ChatItem, { kind: 'tool' }>
  single?: boolean
  locale: CopyLocale
  tasks: TaskLookup
  onOpenSession: (sessionId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const toggle = useCallback(() => setOpen(value => !value), [])
  const call = useMemo(() => summarizeToolCall(item, locale, tasks), [item, locale, tasks])
  const detail = useMemo(() => formatToolDetail(item, locale, tasks), [item, locale, tasks])
  const state: StateDotState = item.status === 'running'
    ? 'ongoing'
    : item.status === 'error'
      ? 'error'
      : detail?.tone === 'muted' || call.tone === 'muted'
        ? 'idle'
        : 'done'
  const expandable = detail !== undefined
  const icon = single && item.status !== 'error' ? <ToolGlyph /> : <StateDot state={state} />
  const collapsedNode = call.summary
    ? <RowSummary text={call.summary} {...call.tone ? { tone: call.tone } : {}} />
    : undefined

  return (
    <DisclosureRow
      icon={icon}
      title={toolLabel(locale, item.name)}
      open={open && expandable}
      expandable={expandable}
      onToggle={toggle}
      running={item.status === 'running'}
      expandOnRowClick
      keepContentWhenOpen
      collapsedContent={collapsedNode}
      className="dsh-dot-activity"
      contentClassName="dsh-dot-row-content"
      contentLayoutClassName="dsh-dot-row-layout"
    >
      {detail ? (
        <div className="dsh-dot-tool-body" data-tone={detail.tone} data-multiline={detail.multiline ? '' : undefined}>
          <div className="dsh-dot-tool-text">{detail.text}</div>
          {detail.session ? (
            detail.multiline
              ? <div className="dsh-dot-tool-foot"><SessionLink badge={detail.session} locale={locale} onOpen={onOpenSession} /></div>
              : <SessionLink badge={detail.session} locale={locale} onOpen={onOpenSession} />
          ) : null}
        </div>
      ) : null}
    </DisclosureRow>
  )
}

function ToolActivity({ locale, items, tasks, onOpenSession }: { locale: CopyLocale; items: Extract<ChatItem, { kind: 'tool' }>[]; tasks: TaskLookup; onOpenSession: (sessionId: string) => void }) {
  const [open, setOpen] = useState(false)
  const toggle = useCallback(() => setOpen(value => !value), [])
  const summary = useMemo(() => summarizeToolGroup(items, locale, tasks), [items, locale, tasks])
  if (items.length === 1) {
    return <ToolCallRow item={items[0]!} single locale={locale} tasks={tasks} onOpenSession={onOpenSession} />
  }
  const running = items.some(item => item.status === 'running')
  const latest = items.at(-1)!
  const title = `${toolLabel(locale, latest.name)} · ${items.length} ${t(locale, 'actions')}`
  const collapsedNode = summary ? <RowSummary text={summary} /> : undefined
  return (
    <DisclosureRow
      icon={<ToolGlyph />}
      title={title}
      open={open}
      expandable
      onToggle={toggle}
      running={running}
      expandOnRowClick
      collapsedContent={collapsedNode}
      className="dsh-dot-activity"
      contentClassName="dsh-dot-row-content"
      contentLayoutClassName="dsh-dot-row-layout"
    >
      <div className="dsh-dot-tool-group">
        {items.map(item => (
          <ToolCallRow key={item.key} item={item} locale={locale} tasks={tasks} onOpenSession={onOpenSession} />
        ))}
      </div>
    </DisclosureRow>
  )
}

const NOTICE_TAG_TONE: Record<Exclude<NoticeEntry['kind'], 'reminder'>, TagTone> = {
  approval: 'warning',
  question: 'info',
  'turn-end': 'success',
  error: 'danger',
  archived: 'quiet',
}

function noticeTagLabel(locale: CopyLocale, kind: Exclude<NoticeEntry['kind'], 'reminder'>): string {
  switch (kind) {
    case 'approval': return t(locale, 'approval')
    case 'question': return t(locale, 'question')
    case 'turn-end': return t(locale, 'turnEnd')
    case 'error': return t(locale, 'error')
    case 'archived': return t(locale, 'archived')
  }
}

function NoticeCard({ entry, locale, tasks, onOpenSession }: { entry: NoticeEntry; locale: CopyLocale; tasks: TaskLookup; onOpenSession: (sessionId: string) => void }) {
  if (entry.kind === 'reminder') {
    const timing = [
      entry.due,
      entry.once ? t(locale, 'reminderOnce') : entry.next ? t(locale, 'reminderNext').replace('{when}', entry.next) : undefined,
    ].filter(Boolean).join(' · ')
    return (
      <div className="dsh-dot-notice-entry">
        <div className="dsh-dot-card-head">
          <Tag tone="info">{t(locale, 'reminderTag')}</Tag>
          <span className="dsh-dot-card-subject">{entry.title}</span>
          {entry.late ? <Tag tone="warning">{t(locale, 'lateDelivery')}</Tag> : null}
          {timing ? (
            <>
              <span className="dsh-dot-spacer" />
              <span className="dsh-dot-card-meta">{timing}</span>
            </>
          ) : null}
        </div>
        {entry.prompt ? <div className="dsh-dot-card-body">{entry.prompt}</div> : null}
      </div>
    )
  }

  const badge = resolveSessionBadge(entry.sessionId, tasks, {
    ...entry.taskTitle ? { taskTitle: entry.taskTitle } : {},
    ...entry.cwd ? { cwd: entry.cwd } : {},
  })
  const perm = permissionLabel(locale, entry.permission)
  const hasQuestions = Boolean(entry.questions && entry.questions.length > 0)

  return (
    <div className="dsh-dot-notice-entry" data-kind={entry.kind}>
      <div className="dsh-dot-card-head">
        <Tag tone={NOTICE_TAG_TONE[entry.kind]}>{noticeTagLabel(locale, entry.kind)}</Tag>
        {entry.kind === 'approval' && entry.subject ? <code className="dsh-dot-code-pill">{entry.subject}</code> : null}
        {entry.requestId ? <span className="dsh-dot-req-id">{entry.requestId}</span> : null}
        {perm ? <Tag tone="outline">{perm}</Tag> : null}
        {entry.viaSubagent ? <Tag tone="quiet">{t(locale, 'subagentTag')}</Tag> : null}
        <span className="dsh-dot-spacer" />
        <SessionLink badge={badge} locale={locale} onOpen={onOpenSession} />
      </div>
      {entry.reason ? <div className="dsh-dot-card-body">{entry.reason}</div> : null}
      {entry.description ? <div className="dsh-dot-card-desc">{entry.description}</div> : null}
      {entry.command ? <pre className="dsh-dot-cmd">{entry.command}</pre> : null}
      {hasQuestions ? (
        <div className="dsh-dot-questions">
          {entry.questions!.map(item => (
            <div key={item.id} className="dsh-dot-question-item">
              <div className="dsh-dot-card-body">
                {item.question}
                {item.multiSelect ? <span className="dsh-dot-question-multi">（{t(locale, 'multiSelect')}）</span> : null}
              </div>
              {item.options && item.options.length > 0 ? (
                <div className="dsh-dot-question-opts">
                  {item.options.map(opt => <Tag key={opt} tone="neutral">{opt}</Tag>)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : entry.kind === 'question' && entry.subject ? (
        <div className="dsh-dot-card-body">{entry.subject}</div>
      ) : null}
      {entry.extraArgs && entry.extraArgs.length > 0 ? (
        <div className="dsh-dot-kv-list">
          {entry.extraArgs.map(pair => (
            <div key={pair.key} className="dsh-dot-kv-row">
              <span className="dsh-dot-kv-key">{pair.key}</span>
              <span className="dsh-dot-kv-val">{pair.value}</span>
            </div>
          ))}
        </div>
      ) : null}
      {entry.summary !== undefined ? (
        <div className={'dsh-dot-card-body' + (entry.kind === 'error' ? ' dsh-dot-card-error' : '')}>
          {entry.summary === '(no text)' ? t(locale, 'noReplyText') : entry.summary}
        </div>
      ) : null}
    </div>
  )
}

function Notice({ locale, text, hiddenRequestIds, tasks, onOpenSession }: { locale: CopyLocale; text: string; hiddenRequestIds?: ReadonlySet<string>; tasks: TaskLookup; onOpenSession: (sessionId: string) => void }) {
  const [open, setOpen] = useState(false)
  const toggle = useCallback(() => setOpen(value => !value), [])
  const parsed = useMemo(() => {
    const base = parseNotice(text)
    if (!hiddenRequestIds || hiddenRequestIds.size === 0 || base.isReminder || base.entries.length === 0) return base
    return {
      ...base,
      entries: base.entries.filter(entry => entry.kind === 'reminder' || !entry.requestId || !hiddenRequestIds.has(entry.requestId)),
    }
  }, [text, hiddenRequestIds])
  const summary = useMemo(() => summarizeNotice(parsed, locale, tasks), [parsed, locale, tasks])
  const collapsedNode = summary ? <RowSummary text={summary} /> : undefined
  return (
    <div className="dsh-dot-notice">
      <DisclosureRow
        icon={<BellGlyph />}
        title={t(locale, parsed.isReminder ? 'reminderNotice' : 'notice')}
        open={open}
        expandable
        onToggle={toggle}
        expandOnRowClick
        collapsedContent={collapsedNode}
        contentClassName="dsh-dot-row-content"
        contentLayoutClassName="dsh-dot-row-layout"
      >
        <div className="dsh-dot-notice-list">
          {parsed.entries.length > 0
            ? parsed.entries.map((entry, idx) => <NoticeCard key={idx} entry={entry} locale={locale} tasks={tasks} onOpenSession={onOpenSession} />)
            : <div className="dsh-dot-notice-entry"><div className="dsh-dot-card-body">{parsed.fallback ?? text}</div></div>}
        </div>
      </DisclosureRow>
    </div>
  )
}

function Composer({ locale, running, disabled, error, onSend, onStop }: { locale: CopyLocale; running: boolean; disabled: boolean; error?: string; onSend: (text: string) => Promise<void>; onStop: () => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [text])
  const submit = useCallback(() => {
    const body = text.trim()
    if (!body || busy || disabled) return
    setBusy(true)
    onSend(body).then(() => setText(''), () => {}).finally(() => { setBusy(false); area.current?.focus() })
  }, [text, busy, disabled, onSend])
  const onKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return
    event.preventDefault()
    submit()
  }, [submit])
  return (
    <div className="dsh-dot-composer">
      {error !== undefined ? <div className="dsh-dot-error">{t(locale, 'sendFailed')}{error}</div> : null}
      <div className="dsh-dot-inputrow">
        <textarea
          ref={area}
          className="dsh-dot-input"
          rows={1}
          value={text}
          placeholder={running ? t(locale, 'placeholderRunning') : t(locale, 'placeholder')}
          onChange={event => setText(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
        />
        {running ? <Button variant="outline" size="sm" onClick={onStop}>{t(locale, 'stop')}</Button> : null}
        <Button variant="primary" size="sm" disabled={disabled || busy || !text.trim()} onClick={submit}>{busy ? t(locale, 'sending') : t(locale, 'send')}</Button>
      </div>
    </div>
  )
}

function ToolGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.8 2.6a3.2 3.2 0 0 0 3.6 4.2L8.2 12a1.7 1.7 0 0 1-2.4-2.4l5.2-5.2" />
      <path d="M3 13l1.6-1.6" />
    </svg>
  )
}

function GearGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function BellGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 10.5V7a4 4 0 0 1 8 0v3.5l1 1.5H3z" />
      <path d="M6.6 13.6a1.5 1.5 0 0 0 2.8 0" />
    </svg>
  )
}

function JumpGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 4h6v6" />
      <path d="M12 4L4.5 11.5" />
    </svg>
  )
}

// Selectors spell the root out (.dsh-dot-chat = CHAT_ROOT) so the repository scope check can read them.
export const chatCss = settingsCss + `
.dsh-dot-chat {
  display: flex; flex-direction: column; height: 100%; min-height: 0;
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  padding-top: var(--dsh-frame-top-clearance);
}
.dsh-dot-chat .dsh-dot-head {
  display: flex; align-items: center; gap: 10px; padding: 10px 16px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l1);
}
.dsh-dot-chat .dsh-dot-head > button,
.dsh-dot-chat .dsh-dot-settings-head > button,
.dsh-dot-chat .dsh-dot-inputrow > button,
.dsh-dot-chat .dsh-dot-banner > button,
.dsh-dot-chat .dsh-ui-actions > button { flex-shrink: 0; white-space: nowrap; }
.dsh-dot-chat .dsh-ui-actions { flex-wrap: wrap; }
.dsh-dot-chat .dsh-dot-head-text { display: flex; flex-direction: column; min-width: 0; }
.dsh-dot-chat .dsh-dot-name { font-size: 14px; line-height: 20px; font-weight: 600; }
.dsh-dot-chat .dsh-dot-status { font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }
.dsh-dot-chat .dsh-dot-status[data-running] { color: var(--dsw-alias-state-business-primary); }
.dsh-dot-chat .dsh-dot-spacer { flex: 1; }
.dsh-dot-chat .dsh-dot-badge {
  display: inline-flex; align-items: center; justify-content: center; min-width: 16px; height: 16px;
  margin-left: 6px; padding: 0 4px; border-radius: 8px; font-size: 11px;
  background: var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-label-primary-foreground);
}
.dsh-dot-chat .dsh-dot-boardwrap {
  max-height: 40%; overflow-y: auto; border-bottom: 0.5px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}
.dsh-dot-chat .dsh-dot-scroll { flex: 1; min-height: 0; overflow-y: auto; }
.dsh-dot-chat .dsh-dot-main { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
.dsh-dot-chat .dsh-dot-settings-layer { position: absolute; inset: 0; z-index: 10; display: flex; justify-content: flex-end; overflow: hidden; }
.dsh-dot-chat .dsh-dot-settings-backdrop { position: absolute; inset: 0; padding: 0; border: 0; border-radius: 0; background: var(--dsw-alias-bg-mask-1); cursor: default; }
.dsh-dot-chat .dsh-dot-settings-drawer {
  position: relative; display: flex; width: min(680px, 100%); height: 100%; min-width: 0;
  border-left: 0.5px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base);
  box-shadow: var(--dsw-elevation-prominent); animation: dsh-dot-settings-enter var(--ds-transition-duration, 0.2s) var(--ds-ease-in-out, ease-out);
}
.dsh-dot-chat .dsh-dot-settings-nav {
  flex: 0 0 136px; display: flex; flex-direction: column; gap: 2px; padding: 14px 8px;
  background: var(--dsw-alias-bg-layer-1); border-right: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-dot-chat .dsh-dot-settings-brand {
  padding: 2px 10px 10px; font-size: 12px; line-height: 16px; font-weight: 600;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-dot-chat .dsh-dot-settings-nav button {
  display: flex; align-items: center; gap: 8px; padding: 7px 10px;
  border: 0; border-radius: var(--dsw-radius-sm); background: transparent;
  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; line-height: 20px; text-align: left; cursor: pointer;
}
.dsh-dot-chat .dsh-dot-nav-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-dot-chat .dsh-dot-nav-badge {
  margin-left: auto; display: inline-flex; align-items: center; justify-content: center;
  min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; font-size: 11px; line-height: 16px; font-weight: 500;
  background: var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-label-primary-foreground);
}
.dsh-dot-chat .dsh-dot-settings-nav button:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-dot-chat .dsh-dot-settings-nav button[aria-pressed='true'] { background: var(--dsw-alias-interactive-bg-active); color: var(--dsw-alias-label-primary); font-weight: 500; }
.dsh-dot-chat .dsh-dot-settings-nav button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.dsh-dot-chat .dsh-dot-settings-right { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.dsh-dot-chat .dsh-dot-settings-head {
  display: flex; align-items: center; gap: 10px; min-height: 46px; padding: 8px 16px 8px 24px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base);
}
.dsh-dot-chat .dsh-dot-settings-title { margin: 0; font-size: 14px; line-height: 20px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dsh-dot-chat .dsh-dot-settings-status {
  display: inline-flex; align-items: center; gap: 4px; font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-state-success-primary); max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsh-dot-chat .dsh-dot-settings-status--error { color: var(--dsw-alias-label-error); }
.dsh-dot-chat .dsh-dot-settings-scroll { flex: 1; min-width: 0; overflow-y: auto; overscroll-behavior: contain; container-type: inline-size; }
.dsh-dot-chat .dsh-dot-settings { display: flex; flex-direction: column; padding: 20px 24px 32px; }
.dsh-dot-chat .dsh-dot-settings[data-tab='trajectory'] { padding: 0; }
.dsh-dot-chat .dsh-dot-settings[data-tab='trajectory'] .dsh-dot-tr { flex: none; }
.dsh-dot-chat .dsh-dot-settings[data-tab='trajectory'] .dsh-dot-tr-list { overflow: visible; }
.dsh-dot-chat .dsh-dot-trajectory-wrap { flex: 1; min-height: 0; display: flex; flex-direction: column; }
@keyframes dsh-dot-settings-enter { from { transform: translateX(24px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
@media (max-width: 520px) {
  .dsh-dot-chat .dsh-dot-settings-drawer { flex-direction: column; border-left: 0; }
  .dsh-dot-chat .dsh-dot-settings-nav { flex: none; flex-direction: row; padding: 8px 12px; border-right: 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
  .dsh-dot-chat .dsh-dot-settings-brand { display: none; }
  .dsh-dot-chat .dsh-dot-settings-nav button { flex: 1; justify-content: center; padding: 6px 8px; text-align: center; }
  .dsh-dot-chat .dsh-dot-settings-head { padding: 8px 12px 8px 16px; }
  .dsh-dot-chat .dsh-dot-settings { padding: 16px 16px 28px; }
}
@media (prefers-reduced-motion: reduce) { .dsh-dot-chat .dsh-dot-settings-drawer { animation: none; } }
.dsh-dot-chat .dsh-dot-settings-pane { gap: 0; }
.dsh-dot-chat .dsh-dot-settings-pane > .dsh-ui-notice,
.dsh-dot-chat .dsh-dot-settings-pane > .dsh-ui-error { margin-bottom: 16px; }
.dsh-dot-chat .dsh-dot-pane-section { padding: 18px 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
.dsh-dot-chat .dsh-dot-pane > .dsh-dot-pane-section:first-child { padding-top: 0; }
.dsh-dot-chat .dsh-dot-pane > .dsh-dot-pane-section:last-child { padding-bottom: 0; border-bottom: 0; }
.dsh-dot-chat .dsh-dot-pane-section .dsh-ui-form > .dsh-ui-field:first-child { padding-top: 4px; }
.dsh-dot-chat .dsh-dot-pane-section .dsh-ui-form > .dsh-ui-field:last-child { padding-bottom: 0; }
.dsh-dot-chat .dsh-dot-pane-section-title {
  margin: 0 0 8px; font-size: 12px; line-height: 18px; font-weight: 600;
  color: var(--dsw-alias-label-secondary);
}
.dsh-dot-chat .dsh-dot-settings-note { margin: 0; padding-top: 16px; }
.dsh-dot-chat .dsh-dot-pane { display: flex; flex-direction: column; gap: 12px; }
.dsh-dot-chat .dsh-dot-log {
  display: flex; flex-direction: column; gap: 12px;
  max-width: 760px; margin: 0 auto; padding: 20px 16px 12px;
}
.dsh-dot-chat .dsh-dot-center {
  display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center;
  padding: 48px 24px;
}
.dsh-dot-chat .dsh-dot-greeting { font-size: 16px; line-height: 24px; font-weight: 600; }
.dsh-dot-chat .dsh-dot-muted { font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); max-width: 420px; }
.dsh-dot-chat .dsh-dot-user { display: flex; justify-content: flex-end; padding-left: 48px; }
.dsh-dot-chat .dsh-dot-user > * { max-width: 100%; white-space: pre-wrap; overflow-wrap: anywhere; }
.dsh-dot-chat .dsh-dot-echo { opacity: 0.55; }
.dsh-dot-chat .dsh-dot-bot { display: flex; gap: 10px; align-items: flex-start; }
.dsh-dot-chat .dsh-dot-gutter { flex: 0 0 28px; width: 28px; min-height: 1px; }
.dsh-dot-chat .dsh-dot-body { flex: 1; min-width: 0; padding-top: 3px; }
.dsh-dot-chat .dsh-dot-activity { color: var(--dsw-alias-label-tertiary); }
.dsh-dot-chat .dsh-dot-row-content { flex: 1 1 auto; min-width: 0; }
.dsh-dot-chat .dsh-dot-row-layout { min-width: 0; }
.dsh-dot-chat .dsh-dot-row-sep {
  flex: none; width: 2px; height: 2px; margin: 0 8px;
  border-radius: 1px; background: var(--dsw-alias-label-caption);
}
.dsh-dot-chat .dsh-dot-row-summary {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-caption);
}
.dsh-dot-chat .dsh-dot-row-summary[data-tone="error"] { color: var(--dsw-alias-label-error); }
.dsh-dot-chat .dsh-dot-tool-group {
  display: flex; flex-direction: column; gap: 2px;
  margin: 4px 0 2px 7px; padding-left: 14px;
  border-left: 1px solid var(--dsw-alias-border-l2);
}
.dsh-dot-chat .dsh-dot-tool-body {
  display: flex; align-items: center; gap: 8px;
  margin: 3px 0 4px 22px; padding: 7px 11px; max-height: 200px; overflow-y: auto;
  border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-1);
  font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary);
}
.dsh-dot-chat .dsh-dot-tool-body[data-multiline] { flex-direction: column; align-items: stretch; gap: 6px; }
.dsh-dot-chat .dsh-dot-tool-body[data-tone="muted"] { color: var(--dsw-alias-label-tertiary); }
.dsh-dot-chat .dsh-dot-tool-body[data-tone="error"] { color: var(--dsw-alias-label-error); }
.dsh-dot-chat .dsh-dot-tool-text { flex: 1 1 auto; min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.dsh-dot-chat .dsh-dot-tool-foot { display: flex; justify-content: flex-end; }
.dsh-dot-chat .dsh-dot-notice { padding-left: 38px; color: var(--dsw-alias-label-tertiary); }
.dsh-dot-chat .dsh-dot-notice-list {
  display: flex; flex-direction: column; gap: 10px;
  margin: 4px 0 2px 7px; padding: 2px 0 2px 14px;
  border-left: 1px solid var(--dsw-alias-border-l2);
}
.dsh-dot-chat .dsh-dot-notice-entry { display: flex; flex-direction: column; gap: 5px; color: var(--dsw-alias-label-primary); }
.dsh-dot-chat .dsh-dot-notice-entry + .dsh-dot-notice-entry { padding-top: 10px; border-top: 0.5px solid var(--dsw-alias-border-l1); }
.dsh-dot-chat .dsh-dot-card-head { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; min-width: 0; }
.dsh-dot-chat .dsh-dot-card-subject { font-size: 13px; line-height: 20px; font-weight: 500; color: var(--dsw-alias-label-primary); min-width: 0; overflow-wrap: anywhere; }
.dsh-dot-chat .dsh-dot-code-pill {
  padding: 1px 6px; border-radius: 6px; background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-primary); font: 12px/18px var(--ds-font-family-code);
}
.dsh-dot-chat .dsh-dot-req-id { font: 11px/17px var(--ds-font-family-code); color: var(--dsw-alias-label-tertiary); }
.dsh-dot-chat .dsh-dot-card-meta { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.dsh-dot-chat .dsh-dot-card-body { font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-primary); white-space: pre-wrap; overflow-wrap: anywhere; }
.dsh-dot-chat .dsh-dot-card-error { color: var(--dsw-alias-label-error); }
.dsh-dot-chat .dsh-dot-card-desc { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.dsh-dot-chat .dsh-dot-cmd {
  margin: 0; padding: 7px 10px; max-height: 160px; overflow-y: auto;
  border: 0; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font: 12px/18px var(--ds-font-family-code); white-space: pre-wrap; overflow-wrap: anywhere;
}
.dsh-dot-chat .dsh-dot-questions { display: flex; flex-direction: column; gap: 6px; }
.dsh-dot-chat .dsh-dot-question-item { display: flex; flex-direction: column; gap: 4px; }
.dsh-dot-chat .dsh-dot-question-multi { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.dsh-dot-chat .dsh-dot-question-opts { display: flex; flex-wrap: wrap; gap: 4px; }
.dsh-dot-chat .dsh-dot-kv-list { display: flex; flex-direction: column; gap: 2px; font-size: 12px; line-height: 18px; }
.dsh-dot-chat .dsh-dot-kv-row { display: flex; gap: 6px; min-width: 0; }
.dsh-dot-chat .dsh-dot-kv-key { flex-shrink: 0; font-family: var(--ds-font-family-code); color: var(--dsw-alias-label-tertiary); }
.dsh-dot-chat .dsh-dot-kv-val { min-width: 0; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.dsh-dot-chat .dsh-dot-session-btn {
  display: inline-flex; align-items: center; gap: 3px; max-width: 220px; min-width: 0;
  padding: 1px 6px; border: 0; border-radius: var(--dsw-radius-sm);
  background: transparent; color: var(--dsw-alias-label-tertiary);
  font: inherit; font-size: 12px; line-height: 18px; cursor: pointer;
}
.dsh-dot-chat .dsh-dot-session-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-dot-chat .dsh-dot-session-btn:focus-visible { outline: 1px solid var(--dsw-focus-ring-color); outline-offset: 1px; }
.dsh-dot-chat .dsh-dot-session-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-dot-chat .dsh-dot-turn-error {
  display: flex; align-items: flex-start; gap: 8px; padding: 8px 12px;
  border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--dsw-elevation-stroke); font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-error);
}
.dsh-dot-chat .dsh-dot-turn-error > [data-state] { margin-top: 6px; flex-shrink: 0; }
.dsh-dot-chat .dsh-dot-segment {
  display: flex; align-items: center; gap: 10px; padding: 4px 0;
  font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-tertiary);
}
.dsh-dot-chat .dsh-dot-segment::before, .dsh-dot-chat .dsh-dot-segment::after { content: ''; flex: 1; height: 0.5px; background: var(--dsw-alias-border-l2); }
.dsh-dot-chat .dsh-dot-error { font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-error); }
.dsh-dot-chat .dsh-dot-banner {
  display: flex; align-items: center; gap: 8px; justify-content: center; padding: 6px 16px;
  font-size: 12px; color: var(--dsw-alias-label-error); background: var(--dsw-alias-bg-layer-1);
}
.dsh-dot-chat .dsh-dot-composer {
  display: flex; flex-direction: column; gap: 6px;
  width: 100%; max-width: 760px; margin: 0 auto; padding: 8px 16px 16px; box-sizing: border-box;
}
.dsh-dot-chat .dsh-dot-inputrow {
  display: flex; align-items: flex-end; gap: 8px; padding: 8px 8px 8px 14px;
  border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--dsw-elevation-stroke);
}
.dsh-dot-chat .dsh-dot-input {
  flex: 1; min-width: 0; resize: none; border: 0; outline: none; background: transparent;
  color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; line-height: 22px;
  padding: 3px 0; max-height: 200px;
}
.dsh-dot-chat .dsh-dot-input::placeholder { color: var(--dsw-alias-label-dimmed); }
`
