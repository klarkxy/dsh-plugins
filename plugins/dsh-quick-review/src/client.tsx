import type { Context } from '@deepseek-ai/cordis'
import type { ISessions, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {
  PropsRenderFactories, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  MODEL_CATALOG_INJECT, readModelCatalog, modelMenuEffortLabel, modelMenuEffortOptions, parseModelMenuChoices,
} from '@klarkxy/dsh-model-route'
import { ModelCatalogStatus, ModelMenu, modelMenuCss, useModelCatalog } from '@klarkxy/dsh-model-route/ui'
import { renderModelPicker, useModelMenuAnchor, type RenderFactorySlot } from '@klarkxy/dsh-plugin-kit/model-picker'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Button, IconChevronDownOutlineRegular, IconRefreshOutlineRegular, Tooltip, useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives'
import { useAnchoredPosition } from './anchored-position.ts'
import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'
import { installClientPluginLogger } from '@klarkxy/dsh-plugin-kit/client-logger'
import {
  PLUGIN_NAME, QUICK_REVIEW_CLIENT_SERVICE, RESOURCE_PROTOCOL, REVIEW_TAB_ID, RPC_CHANNEL,
  parseReviewAddress, reviewAddress,
  type QuickReviewSettings, type ReviewModelRoute, type ReviewScope, type ReviewStartValue,
  type ReviewState, type ReviewStatus, type ReviewStatusValue, type RpcResult,
} from './contracts.ts'

export const name = 'dsh-quick-review-client'
export const inject = ['slots', 'connection', 'locale', 'sessions', 'sidebarRight', 'resources', 'sidebarRightTabs', ...MODEL_CATALOG_INJECT] as const

const NS = 'dsh-quick-review.action'

const zh = {
  action: '评审',
  title: '快速评审',
  reviewAction: '开始评审',
  model: '模型',
  modelDefault: '默认模型',
  modelHint: '留空跟随宿主默认对话模型。',
  focus: '关注点（可选）',
  focusPlaceholder: '例如：重点看并发与错误处理',
  scopeSession: '本会话改动了 {n} 个文件',
  scopeWorkspace: '宿主未记录本会话的改动，将评审工作区全部未提交改动',
  scopeLoading: '正在读取改动范围…',
  running: '评审中',
  starting: '正在创建评审会话…',
  statusRunning: '评审进行中',
  statusSent: '结果已发回主会话',
  statusFailed: '评审未成功发回',
  resend: '再次发回主会话',
  resending: '正在发回…',
  refresh: '刷新',
  failed: '操作失败',
  disabled: '插件已停用',
  busy: '已有评审在进行',
  stale: '设置已更新，请刷新后重试',
  noModel: '未选择模型且宿主没有默认模型',
  noSession: '会话不在线',
  invalidRequest: '请求无效，请刷新后重试',
  permissionUnavailable: '宿主缺少只读权限预设，已拒绝启动',
  modelUnavailable: '所选模型不可用',
  noCwd: '源会话没有工作区或工作目录',
  setupFailed: '评审会话初始化失败',
  subagentSession: '子代理会话不支持评审',
  noText: '评审会话还没有可发送的回答',
  deliveryUnavailable: '主会话无法接收消息',
  promptFailed: '提示发送失败',
  emptyResponse: '评审没有产出文本',
  deliveryFailed: '发回主会话失败',
  sessionDisposed: '评审会话已关闭',
  turnIncomplete: '评审轮次未完成',
  tabTitle: '快速评审',
}

const en: Record<keyof typeof zh, string> = {
  action: 'Review',
  title: 'Quick Review',
  reviewAction: 'Start review',
  model: 'Model',
  modelDefault: 'Default model',
  modelHint: 'Leave empty to follow the host default chat model.',
  focus: 'Focus (optional)',
  focusPlaceholder: 'e.g. concentrate on concurrency and error handling',
  scopeSession: '{n} files changed by this session',
  scopeWorkspace: 'The host recorded no change summary for this session; all uncommitted workspace changes will be reviewed',
  scopeLoading: 'Reading the review scope…',
  running: 'Reviewing',
  starting: 'Creating the review session…',
  statusRunning: 'Review in progress',
  statusSent: 'Verdict sent to the main session',
  statusFailed: 'Review was not delivered',
  resend: 'Send to main again',
  resending: 'Sending…',
  refresh: 'Refresh',
  failed: 'Operation failed',
  disabled: 'Plugin disabled',
  busy: 'A review is already running',
  stale: 'Settings changed; refresh and retry',
  noModel: 'No model picked and the host has no default model',
  noSession: 'Session is not live',
  invalidRequest: 'Invalid request; refresh and retry',
  permissionUnavailable: 'The host has no read-only preset; review refused',
  modelUnavailable: 'The selected model is unavailable',
  noCwd: 'The source session has no workspace or working directory',
  setupFailed: 'The review session could not be set up',
  subagentSession: 'Subagent sessions cannot be reviewed',
  noText: 'The review has no answer to send yet',
  deliveryUnavailable: 'The main session cannot receive messages',
  promptFailed: 'Prompt failed',
  emptyResponse: 'The review produced no text',
  deliveryFailed: 'Delivery to the main session failed',
  sessionDisposed: 'The review session was closed',
  turnIncomplete: 'The review turn did not complete',
  tabTitle: 'Quick Review',
}

type Key = keyof typeof zh
type Translate = (key: Key) => string

interface ConnectionLike {
  generation?: { subscribe(listener: () => void): () => void }
  rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<unknown> }
}

interface SessionSnapshotLike {
  blank?: boolean
  running?: boolean
  subagent?: unknown
}

interface UseSessionLike {
  <T>(selector: (snapshot: SessionSnapshotLike) => T): T
}

/** A failed RPC keeps its code so the panel can explain a rejection in its own words. */
class RpcError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'RpcError'
    this.code = code
  }
}

async function rpc<T>(
  call: (endpoint: string, payload: unknown) => Promise<unknown>,
  endpoint: string,
  payload: unknown = {},
  fallback = '',
): Promise<T> {
  const result = await call(endpoint, payload) as RpcResult<T> | undefined
  if (!result || result.ok !== true) {
    const failed = result && 'error' in result ? result.error : undefined
    throw new RpcError(failed?.code ?? 'unknown', failed?.message ? failed.message : fallback)
  }
  return result.value
}

function errorText(t: Translate, error: { code: string; message: string }): string {
  const keys: Record<string, Key> = {
    busy: 'busy', stale: 'stale', disposed: 'disabled', 'no-model': 'noModel',
    'session/not-found': 'noSession', 'bad-request': 'invalidRequest', 'not-found': 'invalidRequest',
    cancelled: 'failed',
    'permission-unavailable': 'permissionUnavailable',
    'model-unavailable': 'modelUnavailable',
    'no-cwd': 'noCwd',
    'setup-failed': 'setupFailed',
    'subagent-session': 'subagentSession',
    'no-text': 'noText',
    'delivery-unavailable': 'deliveryUnavailable',
  }
  const key = keys[error.code]
  return key ? t(key) : error.message || t('failed')
}

function panelError(reason: unknown): { code: string; message: string } {
  return reason instanceof RpcError
    ? { code: reason.code, message: reason.message }
    : { code: 'unknown', message: reason instanceof Error ? reason.message : String(reason) }
}

function ReviewIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10.2 10.2L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M5.4 7l1.1 1.1 2.2-2.3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export interface QuickReviewActionProps {
  sessionId: string
  useSession: UseSessionLike
  call: (endpoint: string, payload: unknown) => Promise<unknown>
  t: Translate
  /** Injected by the slot registration; absent in tests that render the button alone. */
  client?: Client
  /** Open the review tab in the right sidebar; injected by the slot registration. */
  openReview?: (address: string) => void
  /** Framework-composed factory renderer; absent in tests that render the button alone. */
  renderFactorySlot?: RenderFactorySlot
}

export function QuickReviewAction({ sessionId, useSession, call, t, client, openReview, renderFactorySlot }: QuickReviewActionProps) {
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<ReviewScope>()
  const [loadingScope, setLoadingScope] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)
  const [focus, setFocus] = useState('')
  const [model, setModel] = useState<ReviewModelRoute | undefined>()
  const [review, setReview] = useState<ReviewStatus | undefined>()
  // Inside a review session itself the action stays hidden.
  const [isReviewSession, setIsReviewSession] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const generationRef = useRef(0)
  const position = useAnchoredPosition({ open, anchorRef: triggerRef, panelRef, gap: 5, margin: 16 })
  const blank = useSession(snapshot => snapshot.blank === true)
  const subagent = useSession(snapshot => snapshot.subagent !== null && snapshot.subagent !== undefined)

  // The settings panel's model menu portals to document.body too, so the
  // dismiss hook would count a pick click as "outside" and close the whole
  // popover before onPick fires — same portal widening as the commit action.
  const panelPortalRef = useMemo((): { current: HTMLElement | null } => ({
    get current() {
      const panel = panelRef.current
      if (!panel) return null
      return {
        contains: (node: Node | null): boolean =>
          panel.contains(node)
          || [...document.querySelectorAll('.qrv-menu-portal')].some(menu => menu.contains(node)),
      } as unknown as HTMLElement
    },
  }), [])

  const changeOpen = useCallback((next: boolean) => {
    setOpen(next)
    if (next) {
      setError(null)
    }
  }, [])

  const positioned = Boolean(position)
  useEffect(() => {
    if (open && positioned) panelRef.current?.focus()
  }, [open, positioned])

  useDismissOnOutsidePointer(rootRef, open, changeOpen, panelPortalRef)

  useEffect(() => {
    generationRef.current += 1
    setOpen(false)
    setScope(undefined)
    setError(null)
    setRunning(false)
    setFocus('')
    setModel(undefined)
    setReview(undefined)
    setIsReviewSession(false)
  }, [sessionId])

  const loadScope = useCallback(async () => {
    const generation = generationRef.current
    setLoadingScope(true)
    setError(null)
    try {
      const next = await rpc<ReviewScope>(call, 'scope', { sourceSessionId: sessionId })
      if (generationRef.current !== generation) return
      setScope(next)
    } catch (reason) {
      if (generationRef.current !== generation) return
      setScope(undefined)
      setError(panelError(reason))
    } finally {
      if (generationRef.current === generation) setLoadingScope(false)
    }
  }, [call, sessionId])

  // Track the latest review for this source session so the button flips to a
  // running chip while one is in flight; polling stops as soon as it settles.
  useEffect(() => {
    if (blank || subagent) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      try {
        const value = await rpc<ReviewStatusValue>(call, 'status', { sourceSessionId: sessionId })
        if (!live) return
        setIsReviewSession(value.isReview === true)
        setReview(value.review)
        if (value.review?.state === 'running') timer = setTimeout(load, 2000)
      } catch {
        if (!live) return
      }
    }
    void load()
    return () => {
      live = false
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [call, sessionId, blank, subagent])

  useEffect(() => {
    if (!open) return
    void loadScope()
  }, [open, loadScope])

  useEffect(() => {
    if (!open) return
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      changeOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('keydown', dismiss)
    return () => document.removeEventListener('keydown', dismiss)
  }, [open, changeOpen])

  const reveal = useCallback((reviewSessionId: string) => {
    openReview?.(reviewAddress(reviewSessionId, sessionId))
  }, [openReview, sessionId])

  const runStart = useCallback(async () => {
    const generation = generationRef.current
    setRunning(true)
    setError(null)
    try {
      const value = await rpc<ReviewStartValue>(call, 'start', {
        sourceSessionId: sessionId,
        ...(model === undefined ? {} : { model }),
        ...(focus.trim() === '' ? {} : { focus: focus.trim() }),
      })
      if (generationRef.current !== generation) return
      setRunning(false)
      changeOpen(false)
      reveal(value.reviewSessionId)
      setReview({
        reviewSessionId: value.reviewSessionId,
        sourceSessionId: sessionId,
        state: 'running',
        model: value.model,
        scope: value.scope,
      })
    } catch (reason) {
      if (generationRef.current !== generation) return
      setError(panelError(reason))
      setRunning(false)
    }
  }, [call, sessionId, focus, model, changeOpen, reveal])

  if (blank || subagent || isReviewSession) return null

  const reviewing = review?.state === 'running'
  const scopeText = scope === undefined
    ? (loadingScope ? t('scopeLoading') : '')
    : scope.kind === 'session'
      ? t('scopeSession').replace('{n}', String(scope.files.length))
      : t('scopeWorkspace')

  return (
    <div ref={rootRef} className="qrv-root">
      {reviewing ? (
        <Tooltip label={t('title')} side="bottom" gap={4}>
          <Button
            variant="ghost"
            size="sm"
            icon={<ReviewIcon />}
            aria-label={t('running')}
            onClick={() => review && reveal(review.reviewSessionId)}
          >
            {t('running')}
          </Button>
        </Tooltip>
      ) : (
        <Tooltip label={t('title')} side="bottom" gap={4}>
          <Button
            ref={triggerRef}
            variant="ghost"
            size="sm"
            icon={<ReviewIcon />}
            aria-label={t('title')}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => changeOpen(!open)}
          >
            {t('action')}
          </Button>
        </Tooltip>
      )}
      {open && createPortal(
        <div
          ref={panelRef}
          className="qrv-root dsh-ui-surface qrv-panel"
          style={position ?? { visibility: 'hidden', left: 0, top: 0 }}
          role="dialog"
          tabIndex={-1}
          aria-label={t('title')}
        >
          <div className="dsh-ui-surface-body">
            <div className="dsh-ui-surface-head">
              <span className="dsh-ui-surface-title">{t('title')}</span>
              <span className="dsh-ui-spacer" />
              <Tooltip label={t('refresh')} side="bottom" gap={4}>
                <Button variant="ghost" size="sm" aria-label={t('refresh')} icon={<IconRefreshOutlineRegular size={14} />}
                  disabled={loadingScope || running} onClick={() => void loadScope()} />
              </Tooltip>
            </div>
            {error !== null && <p className="dsh-ui-error" role="alert">{errorText(t, error)}</p>}
            {scopeText !== '' && (
              <p className={scope?.kind === 'workspace' ? 'dsh-ui-hint dsh-ui-wrap' : 'dsh-ui-meta'} role="status">{scopeText}</p>
            )}
            {client ? (
              <QuickReviewModelPicker
                client={client}
                call={call}
                disabled={running}
                renderFactorySlot={renderFactorySlot}
                onModelChange={setModel}
              />
            ) : null}
            <div className="dsh-ui-field">
              <span className="dsh-ui-label">{t('focus')}</span>
              <textarea
                className="dsh-ui-textarea"
                rows={2}
                value={focus}
                placeholder={t('focusPlaceholder')}
                disabled={running}
                onChange={event => setFocus(event.target.value)}
              />
            </div>
            <Button variant="primary" size="md" disabled={running || loadingScope} onClick={() => void runStart()}>
              {t('reviewAction')}
            </Button>
            {running && <p className="dsh-ui-hint" role="status">{t('starting')}</p>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

/**
 * Model pick embedded in the review popover; the choice persists as the
 * plugin's remembered model. `onModelChange` reports the displayed pick to the
 * parent the moment it settles, so `start` can send it explicitly — an
 * in-flight save can never silently reroute a review.
 */
export function QuickReviewModelPicker(props: {
  client: Client
  call: (endpoint: string, payload: unknown) => Promise<unknown>
  locale?: string
  disabled?: boolean
  renderFactorySlot?: RenderFactorySlot
  onModelChange?: (model: ReviewModelRoute) => void
}) {
  const hostLocale = useHostLocale(props.client)
  const language = String(props.locale ?? hostLocale).toLowerCase().startsWith('zh') ? 'zh' : 'en'
  const text = language === 'zh' ? zh : en
  const [settings, setSettings] = useState<QuickReviewSettings | undefined>(undefined)
  const [error, setError] = useState(false)
  const loadCatalog = useCallback(() => readModelCatalog(props.client), [props.client])
  const subscribeCatalog = useCallback((change: () => void) => props.client.connection.generation?.subscribe(change), [props.client])
  const catalogState = useModelCatalog(loadCatalog, { subscribe: subscribeCatalog })
  const choices = parseModelMenuChoices(catalogState.catalog, settings?.model)
  const [menuOpen, setMenuOpen] = useState(false)
  const operation = useRef({ epoch: 0, active: false })

  useEffect(() => {
    const state = operation.current
    state.epoch++; state.active = true
    setSettings(undefined); setError(false)
    const epoch = state.epoch
    void rpc<QuickReviewSettings>(props.call, 'settings', {}, 'failed').then(next => {
      if (state.active && state.epoch === epoch) {
        setSettings(next)
        props.onModelChange?.(next.model)
      }
    }).catch(() => {
      if (state.active && state.epoch === epoch) setError(true)
    })
    return () => { state.active = false; state.epoch++ }
  }, [props.call, props.onModelChange])

  const save = useCallback((model: ReviewModelRoute) => {
    const state = operation.current
    if (!settings || !state.active) return
    const epoch = state.epoch
    const previous = settings
    const optimistic: QuickReviewSettings = { revision: settings.revision + 1, model }
    setSettings(optimistic)
    props.onModelChange?.(model)
    void rpc<QuickReviewSettings>(props.call, 'settings.update', {
      settings: { model },
      expectedRevision: settings.revision,
    }).then(next => {
      if (state.active && state.epoch === epoch) {
        setSettings(next)
        props.onModelChange?.(next.model)
      }
    }).catch(() => {
      if (state.active && state.epoch === epoch) {
        setSettings(previous)
        props.onModelChange?.(previous.model)
        setError(true)
      }
    })
  }, [props.call, props.onModelChange, settings])

  const locked = props.disabled === true
  const current = settings?.model ?? { provider: '', model: '' }
  const follow = !current.provider || !current.model
  const selected = follow ? undefined : choices.find(item => item.provider === current.provider && item.model === current.model)
  const efforts = follow ? [] : modelMenuEffortOptions(selected, current.reasoningEffort)
  const currentLabel = follow ? text.modelDefault : selected?.label ?? `${current.provider} / ${current.model}`
  const selectedEffort = efforts.find(item => item.id === (current.reasoningEffort || ''))
  const effortName = selectedEffort ? modelMenuEffortLabel(selectedEffort, language) : undefined
  const anchor = useModelMenuAnchor(`${text.model}: ${settings ? currentLabel : ''}`, undefined,
    () => setMenuOpen(false))

  if (!settings) {
    return (
      <section className="qrv-root qrv-settings dsh-ui-stack">
        {error
          ? <p role="alert" className="dsh-ui-error">{text.failed}</p>
          : <p role="status" className="dsh-ui-hint">{text.scopeLoading}</p>}
      </section>
    )
  }

  return (
    <section className="qrv-root qrv-settings dsh-ui-stack" data-testid="quick-review-model">
      <div className="dsh-ui-field">
        <span className="dsh-ui-label">{text.model}</span>
        <ModelCatalogStatus state={catalogState} locale={language} />
        {renderModelPicker(props.renderFactorySlot, {
          locale: language,
          disabled: locked,
          busy: locked,
          onOpenChange: next => setMenuOpen(next && !locked),
          listClassName: 'qrv-root qrv-menu-portal',
          choices,
          selected: follow ? undefined : { provider: current.provider, model: current.model },
          onPick: picked => save({ provider: picked.provider, model: picked.model }),
          onPickWithEffort: (picked, effort) => save({ provider: picked.provider, model: picked.model, ...(effort ? { reasoningEffort: effort } : {}) }),
          leading: [{ id: 'default', label: text.modelDefault, selected: follow }],
          onPickLeading: () => save({ provider: '', model: '' }),
          efforts,
          selectedEffort: current.reasoningEffort || '',
          onPickEffort: effort => save(follow
            ? { provider: '', model: '' }
            : { provider: current.provider, model: current.model, ...(effort ? { reasoningEffort: effort } : {}) }),
          triggerLabel: currentLabel,
          triggerEffortLabel: !follow && efforts.length ? (effortName ?? text.modelDefault) : undefined,
          modelLabel: text.model,
          modelValue: currentLabel,
          defaultEffortLabel: text.modelDefault,
        }, {
          anchor,
          fallback: <ModelMenu
            locale={language}
            open={menuOpen && !locked}
            onOpenChange={next => setMenuOpen(next && !locked)}
            listClassName="qrv-root qrv-menu-portal"
            anchor={<button type="button" className="dsh-model-menu-trigger" disabled={locked} aria-label={`${text.model}: ${currentLabel}`}>
              <span className="dsh-model-menu-triggerLabel">{currentLabel}</span>
              {!follow && efforts.length ? <span className="dsh-model-menu-triggerEffort">{effortName ?? text.modelDefault}</span> : null}
              <IconChevronDownOutlineRegular className={`dsh-model-menu-chevron${menuOpen && !locked ? ' dsh-model-menu-chevronOpen' : ''}`} />
            </button>}
            choices={choices}
            selected={follow ? undefined : { provider: current.provider, model: current.model }}
            onPick={picked => save({ provider: picked.provider, model: picked.model })}
            leading={[{ id: 'default', label: text.modelDefault, selected: follow }]}
            onPickLeading={() => save({ provider: '', model: '' })}
            efforts={efforts}
            selectedEffort={current.reasoningEffort || ''}
            onPickEffort={effort => save(follow
              ? { provider: '', model: '' }
              : { provider: current.provider, model: current.model, ...(effort ? { reasoningEffort: effort } : {}) })}
            modelLabel={text.model}
            modelValue={currentLabel}
            defaultEffortLabel={text.modelDefault}
          />,
        })}
      </div>
      <p className="dsh-ui-meta">{text.modelHint}</p>
      {error && <p role="alert" className="dsh-ui-error">{text.failed}</p>}
    </section>
  )
}

/** Value retained by one live review-chat resource occurrence. */
export interface QuickReviewResource {
  readonly reviewSessionId: string
  readonly sourceSessionId?: string
  readonly reference: SessionReference
}

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    quickReview: unknown
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap {
    quickreview: QuickReviewResource
  }

  interface SlotMap {
    /** Review-session Conversation occurrence hosted by one sidebar review tab. */
    'quick-review.conversation': { kind: 'single'; scope: 'session' }
  }
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => { resolve() }, { once: true })
  })
}

function quickReviewResourceProvider(sessions: ISessions): ResourceProvider<'quickreview'> {
  return {
    protocol: RESOURCE_PROTOCOL,
    async *open(resourceAddress, { signal }) {
      const address = parseReviewAddress(resourceAddress)
      if (address === undefined) throw new Error(`quick-review: invalid resource address "${resourceAddress}"`)
      if (signal.aborted) return
      const reference = sessions.retain(address.reviewSessionId as SessionId, { source: 'quickReview', signal })
      try {
        yield { ok: true, value: { reviewSessionId: address.reviewSessionId, ...(address.sourceSessionId === undefined ? {} : { sourceSessionId: address.sourceSessionId }), reference } }
        await waitForAbort(signal)
      } finally {
        reference.release()
      }
    },
  }
}

/** Fixed Chat selection used by an embedded Conversation occurrence. */
export function FixedChatConversationView(props: ConversationViewsProps) {
  return <>{props.renderSlot('conversation.session', { view: 'chat' })}</>
}

/** Props supplied to the review-session Conversation host. */
export type ReviewConversationPanelProps = PropsRuntime<'quick-review.conversation'> & PropsRenderFactories

/** Render the shared Conversation content for the embedded review Session. */
export function ReviewConversationPanel({
  sessionId, useSession, useConversation, useSessions, renderFactorySlot,
}: ReviewConversationPanelProps) {
  const session = useSession(value => value)
  const conversation = useConversation(value => value)
  const active = conversation.activeTargets.size > 0
    || (!session.blank && !session.awaitingFirstTurn)
    || session.running
  const shellPhase = active ? 'active' : session.promptAttempted ? 'engaging' : 'blank'
  const summaryBlank = useSessions(state => state.byId[sessionId]?.blank)
  const settling = (shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true)
  const hero = shellPhase === 'blank' && (session.openState === 'open' || summaryBlank === true)
  const phase = settling ? 'settling' : hero ? 'hero' : 'active'
  return renderFactorySlot('conversation.content', { variant: 'embedded', phase, hero }, {
    slots: { views: FixedChatConversationView },
  })
}

/** Props supplied to the sidebar review tab body. */
export type QuickReviewTabProps =
  PropsRuntime<'sidebar.right.pane.tab'> & PropsRenderSlots<'quick-review.conversation'>

function stateText(state: ReviewState | undefined, t: Translate): string {
  switch (state) {
    case 'running': return t('statusRunning')
    case 'sent': return t('statusSent')
    case 'failed': return t('statusFailed')
    default: return ''
  }
}

/** The machine-readable record error rendered next to the 'failed' state label. */
function reasonText(error: string | undefined, t: Translate): string {
  if (error === undefined) return ''
  if (error.startsWith('turn-')) return t('turnIncomplete')
  const keys: Record<string, Key> = {
    'prompt-failed': 'promptFailed',
    'empty-response': 'emptyResponse',
    'delivery-failed': 'deliveryFailed',
    'session-disposed': 'sessionDisposed',
  }
  const key = keys[error]
  return key ? t(key) : ''
}

/**
 * The review tab: a status strip (state + resend) above the embedded
 * review-session conversation. `useResource` keeps the review Session
 * retained for the tab's lifetime.
 */
export function QuickReviewTab({ useResource, useTabInfo, SessionProvider, renderSlot, call, t }: QuickReviewTabProps & {
  call?: (endpoint: string, payload: unknown) => Promise<unknown>
  t?: Translate
}) {
  const { tab } = useTabInfo()
  const resource = useResource<'quickreview'>(tab.contentId)
  const parsed = useMemo(() => parseReviewAddress(tab.contentId), [tab.contentId])
  const reviewSessionId = resource.value?.reviewSessionId ?? parsed?.reviewSessionId
  const [status, setStatus] = useState<ReviewStatus | undefined>()
  const [resending, setResending] = useState(false)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)

  const text = useCallback((key: Key) => (t ?? ((k: Key) => en[k]))(key), [t])

  useEffect(() => {
    if (reviewSessionId === undefined || call === undefined) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      try {
        const value = await rpc<ReviewStatusValue>(call, 'status', { reviewSessionId })
        if (!live) return
        setStatus(value.review)
        if (value.review?.state === 'running') timer = setTimeout(load, 2000)
      } catch {
        if (!live) return
      }
    }
    void load()
    return () => {
      live = false
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [call, reviewSessionId])

  const resend = useCallback(async () => {
    if (reviewSessionId === undefined || call === undefined) return
    setResending(true)
    setError(null)
    try {
      const value = await rpc<ReviewStatus>(call, 'resend', { reviewSessionId })
      setStatus(value)
    } catch (reason) {
      setError(panelError(reason))
    } finally {
      setResending(false)
    }
  }, [call, reviewSessionId])

  const label = stateText(status?.state, text)
  const reason = status?.state === 'failed' ? reasonText(status.error, text) : ''
  return (
    <div className="qrv-root qrv-tab" data-quick-review-tab="">
      <div className="qrv-tab-status">
        {label !== '' && <span className="dsh-ui-hint" role="status">{label}{reason !== '' ? ` · ${reason}` : ''}</span>}
        <span className="dsh-ui-spacer" />
        {call !== undefined && (
          <Button
            variant="ghost"
            size="sm"
            disabled={resending || status === undefined || status.state === 'running'}
            onClick={() => void resend()}
          >
            {resending ? text('resending') : text('resend')}
          </Button>
        )}
      </div>
      {error !== null && <p className="dsh-ui-error" role="alert">{errorText(text, error)}</p>}
      {resource.value === undefined
        ? null
        : (
          <SessionProvider session={resource.value.reference}>
            {renderSlot('quick-review.conversation', {})}
          </SessionProvider>
        )}
    </div>
  )
}

export const clientCss = `${officialUiCss('qrv-root')}${modelMenuCss}
/* Only the floating panel's geometry is this plugin's own; material, rounded
 * edges and scrollbar tokens come from the shared contract. The compound
 * .qrv-root.dsh-ui-surface selector keeps anchored left/top from degrading
 * into offsets from a static body position, same as the commit panel. */
.qrv-root.qrv-panel { position: fixed; width: min(340px, calc(100vw - 32px)); max-height: min(480px, calc(100vh - 32px)); overflow: auto; }
.qrv-root .dsh-ui-textarea { width: 100%; resize: vertical; min-height: 44px; }
.qrv-root.qrv-tab { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.qrv-root .qrv-tab-status { display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-bottom: 1px solid var(--dsw-alias-border-subtle, transparent); flex: none; }
.qrv-root.qrv-tab > *:last-child { flex: 1; min-height: 0; }
`

declare module '@deepseek-ai/cordis' {
  interface Context { dshQuickReviewClient: { active: boolean } }
}

type Client = Context & {
  connection: ConnectionLike
  remote?: { session?: { modelCatalog?: () => Promise<unknown> } }
  sessions: ISessions
  resources: { register(provider: ResourceProvider<'quickreview'>): () => void }
  sidebarRight: { openResource(address: string, options?: { preferNewPane?: boolean }): void }
  sidebarRightTabs: { register(definition: SidebarRightTabDefinition): () => void }
  slots: {
    inject(key: string, callback: () => unknown): () => void
    register(spec: { name: string; id: string; order: number; locale: string; inject: () => unknown } | { name: string; key: string; children?: unknown; locale?: string; inject?: () => unknown } | { name: string }, render: unknown): () => void
  }
  locale: {
    register(ns: string, locales: { zh: Record<string, string>; en: Record<string, string> }): () => void
    getSnapshot?(): { active: string }
    subscribe?(listener: () => void): () => void
  }
}

/** Host UI language, following live switches with the host's English fallback. */
function useHostLocale(client: Client): string {
  const subscribe = useCallback(
    (listener: () => void) => client.locale.subscribe?.(listener) ?? (() => {}),
    [client],
  )
  const snapshot = useCallback(() => client.locale.getSnapshot?.().active ?? 'en', [client])
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export function apply(ctx: Context): void {
  const client = ctx as unknown as Client
  installClientPluginLogger(ctx, PLUGIN_NAME)
  ctx.provide(QUICK_REVIEW_CLIENT_SERVICE, { active: true })
  ctx.effect(() => client.locale.register(NS, { zh: { ...zh }, en: { ...en } }), 'quick-review.locale')
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-plugin', name)
    style.textContent = clientCss
    document.head.appendChild(style)
    return () => style.remove()
  }, 'quick-review.styles')
  const call = (endpoint: string, payload: unknown) => client.connection.rpc.call(RPC_CHANNEL, endpoint, payload)
  const openReview = (address: string) => client.sidebarRight.openResource(address, { preferNewPane: true })
  // The sidebar review tab: one resource provider retains the review Session,
  // the tab type claims its addresses, and the tab body embeds the live chat.
  ctx.effect(() => client.resources.register(quickReviewResourceProvider(client.sessions)), 'quick-review.resources')
  ctx.effect(() => client.sidebarRightTabs.register({
    id: REVIEW_TAB_ID,
    kind: RESOURCE_PROTOCOL,
    patterns: [`dsh-resource://${RESOURCE_PROTOCOL}/session/**`],
    priority: 'extension',
    canOpen: address => parseReviewAddress(address) !== undefined,
    title: () => (client.locale.getSnapshot?.().active ?? 'en').startsWith('zh') ? zh.tabTitle : en.tabTitle,
  } satisfies SidebarRightTabDefinition), 'quick-review.sidebar-tab')
  ctx.effect(() => client.slots.inject('sidebar.right.pane.tab', () => client.slots.register({
    name: 'sidebar.right.pane.tab',
    key: REVIEW_TAB_ID,
    locale: NS,
    children: { 'quick-review.conversation': { kind: 'single', scope: 'session' } },
    inject: () => ({ call }),
  }, QuickReviewTab)), 'quick-review.sidebar-body')
  ctx.effect(() => client.slots.inject('quick-review.conversation', () => client.slots.register({
    name: 'quick-review.conversation',
  }, ReviewConversationPanel)), 'quick-review.conversation')
  // Model and focus live inside the review popover itself; there is no
  // settings.section. While a review runs, the button turns into a chip that
  // reveals the sidebar tab instead of opening the popover.
  ctx.effect(() => client.slots.inject('conversation.session.header.actions', () => client.slots.register(
    {
      name: 'conversation.session.header.actions',
      id: 'quick-review',
      order: 20,
      locale: NS,
      inject: () => ({ call, client, openReview }),
    },
    QuickReviewAction,
  )), 'quick-review.slot')
}
