import type { Context } from '@deepseek-ai/cordis'
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import {
  Modal,
  Pill,
  SegmentedTabs,
  StateDot,
  type SegmentedTab,
} from '@deepseek-ai/dsh-client-ui-primitives';
import { translator, useHostLocale, useT, ZhihuLocaleContext, type HostLocaleService, type Translate } from './client-locale.ts'
import { ZHIHU_CREDENTIAL_REF, ZHIHU_RPC_CHANNEL, type ZhihuRpcResult } from './contracts.ts'
import { createZhihuClientState, type ZhihuClientState } from './client-state.ts'
import { zhihuClientStyles } from './client-styles.ts'
import { hostComponentsFromRenderProps, renderInput, renderSelect, zhihuQueryKeyDown, type HostButton, type HostInput, type HostSelect } from './client-host-ui.tsx'
import { ZhihuButton, ZhihuDetails } from './client-host-ui.tsx'
import { openPlatformOptions, ZhihuOpenPlatformSection } from './client-open-platform.tsx'
import type { ZhihuOpenPlatformOperation } from './open-platform.ts'
import { ZhihuQuotaSection } from './client-quota.tsx'

export const name = 'dsh-zhihu-client'
export const inject = ['slots', 'connection', 'remote', 'remote.credentials', 'locale'] as const

const PACKAGE_NAME = '@klarkxy/dsh-zhihu'
const SLOT_ORDER = 120
const SLOT_LABEL = '知乎'

/* 活动暗示:三点呼吸(参数改写自 Amicro pulse-dots,MIT);装饰 aria-hidden,
   关键帧在 client-styles.ts,reduced-motion 停循环后保留静态点。 */
const activityDots = () => <span className="zhihu-dots" aria-hidden="true">
  <i />
  <i />
  <i />
</span>

type RpcCaller = {
  call: (channel: string, endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>
}

/** Wire view of one credential reference (structurally value-free). */
type CredentialView = { configured: boolean; source?: string; writable: boolean }

type CredentialsApi = {
  describe: (request: { refs: string[] }) => Promise<ZhihuRpcResult<{ credentials: Record<string, CredentialView> }>>
  set: (request: { ref: string; value: string }) => Promise<ZhihuRpcResult<Record<string, never>>>
  unset: (request: { ref: string }) => Promise<ZhihuRpcResult<Record<string, never>>>
}

type SlotHandle = {
  inject: (key: string, callback: () => unknown) => () => void
  register: (spec: { name: string; key: string; order?: number; label?: string }, render: unknown) => unknown
}

type RemoteCredentials = {
  describe(refs: string[]): Promise<ZhihuRpcResult<Record<string, CredentialView>>>
  set(ref: string, value: string): Promise<ZhihuRpcResult<void | Record<string, never>>>
  unset(ref: string): Promise<ZhihuRpcResult<void | Record<string, never>>>
}

type ZhihuClientContext = Context & {
  slots: SlotHandle
  connection: { rpc: RpcCaller }
  remote: { credentials: RemoteCredentials }
  locale?: HostLocaleService
}

function wrapCredentials(remote: RemoteCredentials): CredentialsApi {
  return {
    async describe({ refs }) {
      const result = await remote.describe(refs)
      if (!result.ok) return result
      return { ok: true, value: { credentials: result.value } }
    },
    set: ({ ref, value }) => remote.set(ref, value) as Promise<ZhihuRpcResult<Record<string, never>>>,
    unset: ({ ref }) => remote.unset(ref) as Promise<ZhihuRpcResult<Record<string, never>>>,
  }
}

const ZHIHU_CONSOLE_URL = 'https://developer.zhihu.com'
const KB_MANAGE_URL = 'https://zhida.zhihu.com/repositories/square'

function injectStyles(): HTMLStyleElement | null {
  if (typeof document === 'undefined') return null
  const style = document.createElement('style')
  style.setAttribute('data-plugin', '@klarkxy/dsh-zhihu')
  style.setAttribute('data-dsh-zhihu-styles', '')
  style.textContent = zhihuClientStyles
  document.head.appendChild(style)
  return style
}

/** Only http(s) links may render as anchors; anything else degrades to text. */
function safeUrl(url: string): string | null {
  return /^https?:\/\//i.test(url) ? url : null;
}

type Failure = { kind: 'credential' | 'network' | 'request'; text: string }

/** Credential absence and transport failure read differently from a plain bad request. */
function failureOf(code: string, message: string, t: Translate = translator()): Failure {
  if (code === 'token-missing') {
    return { kind: 'credential', text: t('未配置知乎 Access Secret 或凭证不可用，请到「设置」页配置。', 'Zhihu Access Secret is missing or unavailable. Set it on the Settings tab.') }
  }
  return { kind: 'request', text: t(`请求失败：${message}`, `Request failed: ${message}`) }
}

function networkFailure(cause: unknown, t: Translate = translator()): Failure {
  const detail = cause instanceof Error ? cause.message : String(cause)
  return { kind: 'network', text: t(`网络或连接失败：${detail}`, `Network or connection failed: ${detail}`) }
}

/**
 * One external-link behaviour for the whole page: an http(s) anchor that the
 * desktop bridge opens in the system browser when present, and a plain new tab
 * otherwise. Anything that is not http(s) degrades to text.
 */
export function ExternalLink(props: { url: string; children: ReactNode; className?: string }): ReactNode {
  const url = safeUrl(props.url)
  if (!url) return <span className={props.className}>{props.children}</span>
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    const bridge = (globalThis as { dshWindow?: { openExternal?(url: string): void } }).dshWindow
    if (bridge?.openExternal) { event.preventDefault(); bridge.openExternal(url) }
  }
  return (
    <a className={props.className ?? 'zhihu-link'} href={url} target="_blank" rel="noreferrer noopener" onClick={open}>
      {props.children}
    </a>
  )
}

// ---------------------------------------------------------------------------
// 搜索
// ---------------------------------------------------------------------------

type Mode = 'search' | 'global' | 'hot' | 'knowledge' | 'ask'

const MODES: readonly Mode[] = ['search', 'global', 'hot', 'knowledge', 'ask']

function modeLabel(mode: Mode, t: Translate): string {
  switch (mode) {
    case 'search': return t('站内搜索', 'Zhihu search')
    case 'global': return t('全网搜索', 'Web search')
    case 'hot': return t('知乎热榜', 'Trending')
    case 'knowledge': return t('知识库检索', 'Knowledge base search')
    case 'ask': return t('直答', 'Direct answer')
  }
}

function testOptions(t: Translate) {
  return [
    ...MODES.map(value => ({ value, label: modeLabel(value, t) })),
    ...openPlatformOptions(t).filter(option => option.value !== 'quota'),
  ]
}

export const TEST_OPTIONS = testOptions(translator('zh'))
type TestOperation = Mode | Exclude<ZhihuOpenPlatformOperation, 'quota'>

export function ZhihuTestSelector({ value, onChange, Select }: {
  value: TestOperation; onChange(value: TestOperation): void; Select?: HostSelect
}) {
  const t = useT()
  const options = testOptions(t)
  return renderSelect(Select, {
    'aria-label': t('测试功能', 'Feature to test'), value, options,
    onChange: next => { if (options.some(option => option.value === next)) onChange(next as TestOperation) },
  }, 'dsh-ui-select')
}

const MODE_ENDPOINT: Record<Mode, string> = {
  search: 'search',
  global: 'global.search',
  hot: 'hot.list',
  knowledge: 'knowledge.search',
  ask: 'ask',
}

// Mirrors ZHIHU_ASK_MODELS in ./operations.ts; the backend validates the value
// and falls back to its own default when the model is unknown.
const ASK_MODELS = [
  { value: 'zhida-thinking-1p5', zh: '思考', en: 'Thinking' },
  { value: 'zhida-fast-1p5', zh: '快速', en: 'Fast' },
  { value: 'zhida-agent', zh: '智能体', en: 'Agent' },
] as const
type AskModel = (typeof ASK_MODELS)[number]['value']

const SCOPE_OPTIONS = [
  { value: 'public', zh: '公开库', en: 'Public' },
  { value: 'personal', zh: '个人库', en: 'Personal' },
  { value: 'subscription', zh: '订阅库', en: 'Subscribed' },
] as const
type RecallScope = (typeof SCOPE_OPTIONS)[number]['value']

type SearchItem = {
  title: string
  type: string
  url: string
  summary: string
  votes: number
  comments: number
  author: string
  editTime: string
}

type HotItem = { title: string; url: string; summary: string }
type KnowledgeItem = { docName: string; originUrl: string; snippets: string[] }
type AskAnswer = { query: string; model: string; content: string; reasoning: string }

type SearchOutcome =
  | { mode: 'search' | 'global'; items: SearchItem[]; emptyReason?: string }
  | { mode: 'hot'; items: HotItem[] }
  | { mode: 'knowledge'; items: KnowledgeItem[] }
  | { mode: 'ask'; answer: AskAnswer }

function objectItems(value: unknown): Record<string, unknown>[] | null {
  if (typeof value !== 'object' || value === null) return null
  const items = (value as { items?: unknown }).items
  if (!Array.isArray(items)) return null
  return items.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function parseOutcome(mode: Mode, value: unknown): SearchOutcome | null {
  if (mode === 'ask') {
    if (typeof value !== 'object' || value === null) return null
    const row = value as Record<string, unknown>
    if (typeof row.content !== 'string') return null
    return {
      mode: 'ask',
      answer: {
        query: text(row.query),
        model: text(row.model),
        content: row.content,
        reasoning: text(row.reasoning),
      },
    }
  }
  const items = objectItems(value)
  if (items === null) return null
  if (mode === 'hot') {
    return {
      mode: 'hot',
      items: items.map((item) => ({ title: text(item.title, '—'), url: text(item.url), summary: text(item.summary) })),
    }
  }
  if (mode === 'knowledge') {
    return {
      mode: 'knowledge',
      items: items.map((item) => ({
        docName: text(item.docName, '—'),
        originUrl: text(item.originUrl),
        snippets: Array.isArray(item.snippets) ? item.snippets.filter((s): s is string => typeof s === 'string') : [],
      })),
    }
  }
  const emptyReason = typeof (value as { emptyReason?: unknown }).emptyReason === 'string'
    ? (value as { emptyReason: string }).emptyReason
    : undefined
  return {
    mode,
    emptyReason,
    items: items.map((item) => ({
      title: text(item.title, '—'),
      type: text(item.type),
      url: text(item.url),
      summary: text(item.summary),
      votes: typeof item.votes === 'number' ? item.votes : 0,
      comments: typeof item.comments === 'number' ? item.comments : 0,
      author: text(item.author),
      editTime: text(item.editTime),
    })),
  }
}

function LinkOrText(props: { url: string; label: string; className?: string }): ReactNode {
  return <ExternalLink url={props.url} className={props.className}>{props.label}</ExternalLink>
}

function OutcomeView(props: { outcome: SearchOutcome; stale: boolean }): ReactNode {
  const { outcome, stale } = props
  const t = useT()
  const staleBanner = stale ? <div className="dsh-ui-banner" role="status">
    {t('查询已变化，结果对应旧查询，请重新搜索。', 'The query changed; results are from the previous query. Search again.')}
  </div> : null
  let body: ReactNode = null
  let summary = ''
  if (outcome.mode === 'ask') {
    summary = t(`直答（${outcome.answer.model || '默认模型'}）`, `Direct answer (${outcome.answer.model || 'default model'})`)
    body = <div>
      {outcome.answer.reasoning
        ? <details className="zhihu-ask-reasoning dsh-ui-card dsh-ui-card--flat">
        <summary className="dsh-ui-heading">
          {t('思考过程', 'Reasoning')}
        </summary>
        <p className="dsh-ui-help">
          {outcome.answer.reasoning}
        </p>
      </details>
        : null}
      <p className="zhihu-ask-content dsh-ui-wrap">
        {outcome.answer.content}
      </p>
    </div>
  } else if (outcome.items.length === 0) {
    const reason = outcome.mode === 'search' || outcome.mode === 'global' ? outcome.emptyReason : undefined
    return (
      <div data-testid="zhihu-results" className="dsh-ui-stack">
        {staleBanner}
        <p className="dsh-ui-empty">
          {t(`未找到相关结果${reason ? `（${reason}）` : ''}。`, `No results${reason ? ` (${reason})` : ''}.`)}
        </p>
      </div>
    );
  } else if (outcome.mode === 'knowledge') {
    summary = t(`知识库检索共 ${outcome.items.length} 条`, `${outcome.items.length} knowledge base results`)
    body = <ul className="dsh-ui-list">
      {outcome.items.map((item, index) => <li key={`${item.docName}:${index}`} className="dsh-ui-card dsh-ui-card--flat dsh-ui-list-row">
        <span className="dsh-ui-list-name">
          {item.docName}
        </span>
        {item.originUrl && safeUrl(item.originUrl)
          ? <LinkOrText url={item.originUrl} label={item.originUrl} />
          : null}
        {item.snippets.map((snippet, snippetIndex) =>
          <span key={snippetIndex} className="zhihu-result-snippet dsh-ui-help">
            {snippet}
          </span>)}
      </li>)}
    </ul>
  } else if (outcome.mode === 'hot') {
    summary = t(`知乎热榜共 ${outcome.items.length} 条`, `${outcome.items.length} trending items`)
    body = <ul className="dsh-ui-list">
      {outcome.items.map((item, index) => <li key={`${index}`} className="dsh-ui-card dsh-ui-card--flat dsh-ui-list-row">
        <LinkOrText
          url={item.url}
          label={item.title}
          className="dsh-ui-list-name zhihu-link" />
        {item.summary ? <span className="dsh-ui-meta">
          {item.summary}
        </span> : null}
      </li>)}
    </ul>
  } else {
    summary = t(`${modeLabel(outcome.mode, t)}共 ${outcome.items.length} 条`, `${modeLabel(outcome.mode, t)}: ${outcome.items.length} results`)
    body = <ul className="dsh-ui-list">
      {outcome.items.map((item, index) => <li key={`${item.title}:${index}`} className="dsh-ui-card dsh-ui-card--flat dsh-ui-list-row">
        <LinkOrText
          url={item.url}
          label={item.title}
          className="dsh-ui-list-name zhihu-link" />
        <span className="dsh-ui-list-desc">
          {t(
            `${item.type || '内容'} · ${item.author || '匿名'} · 赞同 ${item.votes} · 评论 ${item.comments}${item.editTime ? ` · ${item.editTime}` : ''}`,
            `${item.type || 'Content'} · ${item.author || 'Anonymous'} · ${item.votes} upvotes · ${item.comments} comments${item.editTime ? ` · ${item.editTime}` : ''}`,
          )}
        </span>
        {item.summary ? <span className="dsh-ui-meta">
          {item.summary}
        </span> : null}
      </li>)}
    </ul>
  }
  return (
    <div data-testid="zhihu-results" className="dsh-ui-stack">
      {staleBanner}
      <p className="dsh-ui-heading">
        {summary}
      </p>
      {body}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 设置（凭证）
// ---------------------------------------------------------------------------

const LEGAL_API_KEY = /^[\x21-\x7E]+$/
const ENV_LINE = /^[A-Z][A-Z0-9_]*=[^=]/

function keyFailure(draft: string): 'blank' | 'illegal' | undefined {
  if (draft.length === 0) return undefined
  const value = draft.trim()
  if (value.length === 0) return 'blank'
  if (ENV_LINE.test(value) || !LEGAL_API_KEY.test(value)) return 'illegal'
  return undefined
}

type CredentialLoad =
  | { status: 'loading' }
  | { status: 'ready'; credential: CredentialView | undefined }
  | { status: 'error'; error: string }

/**
 * Track mount lifetime so late resolves after tab change/close never touch
 * state. Setup re-marks alive so StrictMode effect replay (mount → cleanup →
 * setup) does not leave the flag stuck at false. Used only where the callee
 * (the credentials API) takes no AbortSignal — sections whose rpc.call accepts
 * a signal use a per-section gate instead.
 */
function useAlive() {
  const alive = useRef(false)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  return alive
}

/**
 * Collapsible detail block. The primitive owns the row chrome; the body keeps
 * the contract's help tier so a long explanation never sits in the page flow.
 */
export function CapabilitiesNote(props: { defaultOpen?: boolean }): ReactNode {
  const t = useT()
  return (
    <ZhihuDetails title={t('可用能力', 'Capabilities')} defaultOpen={props.defaultOpen} testId="zhihu-capabilities">
      <li>{t('测试：站内搜索、全网搜索、热榜、直答、知识库检索与问题创作查询。', 'Test: Zhihu search, web search, trending, direct answers, knowledge base search, question and creator queries.')}</li>
      <li>{t('问题与创作：问题推荐、回答摘要、本人已发布内容及评论、账号与单篇创作数据。', 'Questions and creator: question recommendations, answer summaries, your published content and comments, account and per-post stats.')}</li>
      <li>{t('统计：本地记录的每日调用、失败与结果条数。', 'Stats: daily calls, failures and result counts recorded locally.')}</li>
      <li>{t('官方用量：知乎返回的官方剩余额度。', 'Official quota: the remaining quota Zhihu reports.')}</li>
      <li>{t('知识库：读取列表与上传参考资料，文件进入知乎云端。', 'Knowledge base: list bases and upload references; files go to Zhihu cloud.')}</li>
      <li>{t('全部能力共用此 Access Secret，不支持 OAuth 身份切换。', 'Every feature shares this Access Secret; OAuth identity switching is not supported.')}</li>
      <li>{t('模型工具需在 Agent 中加载 ', 'For model tools, load ')}<code>@klarkxy/dsh-zhihu/tools</code>{t('，仅配置密钥不会启用工具。', ' in the Agent; a key alone does not enable them.')}</li>
      <li>{t('请求手动触发（官方用量在打开页签时加载），不会自动重试。', 'Requests run only when you trigger them (official quota loads when its tab opens) and are never retried automatically.')}</li>
    </ZhihuDetails>
  )
}

function SettingsShell(props: { children?: ReactNode }): ReactNode {
  const t = useT()
  // Credentials lead the tab; what the plugin can do is secondary and folded.
  return (
    <section className="dsh-ui-stack" data-testid="zhihu-settings" aria-label={t('知乎凭证设置', 'Zhihu credential settings')}>
      {props.children}
      <CapabilitiesNote />
    </section>
  );
}

/** Which credential action is in flight; the two never share a spinner. */
export type CredentialAction = 'save' | 'clear' | null

function SettingsSection(props: { credentials: CredentialsApi; Button?: HostButton; Input?: HostInput }): ReactNode {
  const { credentials } = props
  const t = useT()
  const alive = useAlive()
  const [state, setState] = useState<CredentialLoad>({ status: 'loading' })
  const [keyDraft, setKeyDraft] = useState('')
  const [pending, setPending] = useState<CredentialAction>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [note, setNote] = useState<string | undefined>(undefined)
  const busy = pending !== null
  // Typing again means the previous "saved" note no longer describes the field.
  const editDraft = (value: string) => { setKeyDraft(value); setNote(undefined) }

  const load = useCallback(async (): Promise<void> => {
    setState((current) => (current.status === 'ready' ? current : { status: 'loading' }))
    try {
      const result = await credentials.describe({ refs: [ZHIHU_CREDENTIAL_REF] })
      if (!alive.current) return
      if (!result.ok) { setState({ status: 'error', error: result.error.message }); return }
      setState({ status: 'ready', credential: result.value.credentials[ZHIHU_CREDENTIAL_REF] })
    } catch (cause) {
      if (!alive.current) return
      setState({ status: 'error', error: cause instanceof Error ? cause.message : String(cause) })
    }
  }, [credentials, alive])

  useEffect(() => { void load() }, [load])

  if (state.status === 'loading') {
    return (
      <SettingsShell>
        <p className="dsh-ui-loading" role="status">
          {activityDots()}
          {t('正在读取凭证状态…', 'Loading credential status…')}
        </p>
      </SettingsShell>
    );
  }

  if (state.status === 'error') {
    return (
      <SettingsShell>
        <p className="dsh-ui-error" role="alert">
          {t(`读取失败：${state.error}`, `Could not load: ${state.error}`)}
        </p>
        <div className="dsh-ui-actions">
          <ZhihuButton host={props.Button} onClick={() => void load()}>
            {t('重试', 'Retry')}
          </ZhihuButton>
        </div>
      </SettingsShell>
    );
  }

  const credential = state.credential
  const keyLocked = credential?.writable === false
  const configured = credential?.configured === true
  const draftFailure = keyFailure(keyDraft)
  const keyValue = keyDraft.trim()

  const statusText = keyLocked
    ? t('由环境变量提供（只读）', 'Provided by an environment variable (read-only)')
    : configured
      ? t(`已保存${credential?.source ? `（来源：${credential.source}）` : ''}`, `Saved${credential?.source ? ` (source: ${credential.source})` : ''}`)
      : t('未配置', 'Not set')
  // A locked key needs the reader's attention but is not a failure, so it takes
  // the warning dot rather than the error one the old palette drew it with.
  const dotState = keyLocked ? 'warning' : configured ? 'done' : 'idle'
  const placeholder = keyLocked
    ? t('由环境变量提供，无法在界面修改', 'Set by an environment variable; cannot be edited here')
    : configured
      ? t('已保存，输入新密钥可覆盖', 'Saved. Enter a new key to replace it')
      : t('粘贴知乎开放平台 Access Secret', 'Paste your Zhihu Open Platform Access Secret')

  const save = async (): Promise<void> => {
    if (keyLocked || draftFailure !== undefined || keyValue.length === 0 || busy) return
    setPending('save')
    setFailure(undefined)
    setNote(undefined)
    try {
      const result = await credentials.set({ ref: ZHIHU_CREDENTIAL_REF, value: keyValue })
      if (!alive.current) return
      if (!result.ok) { setFailure(result.error.message); return }
      setKeyDraft('')
      setNote(t('已保存。', 'Saved.'))
      await load()
    } catch (cause) {
      if (!alive.current) return
      setFailure(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (alive.current) setPending(null)
    }
  }

  // Runs only from the confirmation dialog; the button just opens it.
  const clear = async (): Promise<void> => {
    setConfirmClear(false)
    if (keyLocked || !configured || busy) return
    setPending('clear')
    setFailure(undefined)
    setNote(undefined)
    try {
      const result = await credentials.unset({ ref: ZHIHU_CREDENTIAL_REF })
      if (!alive.current) return
      if (!result.ok) { setFailure(result.error.message); return }
      setKeyDraft('')
      setNote(t('已清除。', 'Cleared.'))
      await load()
    } catch (cause) {
      if (!alive.current) return
      setFailure(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (alive.current) setPending(null)
    }
  }

  return (
    <SettingsShell>
      <dl className="dsh-ui-readonly">
        <dt>
          {t('状态', 'Status')}
        </dt>
        <dd className="dsh-ui-row">
          <StateDot state={dotState} />
          {statusText}
        </dd>
      </dl>
      <div className="dsh-ui-field">
        <div className="dsh-ui-label-row">
          <span className="dsh-ui-label" id="zhihu-access-secret-label">Access Secret</span>
          <ExternalLink url={ZHIHU_CONSOLE_URL}>{t('获取密钥', 'Get a key')}</ExternalLink>
        </div>
        {renderInput(props.Input, {
          type: 'password',
          className: 'zhihu-input',
          value: keyDraft,
          placeholder,
          disabled: busy || keyLocked,
          'aria-label': 'Access Secret',
          onChange: editDraft,
        })}
        {draftFailure === undefined
          ? null
          : <p className="dsh-ui-error" role="alert">
          {draftFailure === 'blank'
            ? t('密钥不能只包含空白字符。', 'The key cannot be only whitespace.')
            : t('密钥含非法字符（应为可打印 ASCII，且不是 ENV 赋值行）。', 'The key has invalid characters (use printable ASCII, not an ENV assignment line).')}
        </p>}
      </div>
      {failure !== undefined ? <p className="dsh-ui-error" role="alert">
        {failure}
      </p> : null}
      {note !== undefined ? <p className="dsh-ui-notice" role="status">
        {note}
      </p> : null}
      <div className="dsh-ui-actions">
        <ZhihuButton
          host={props.Button}
          variant="danger"
          className="zhihu-button-danger"
          disabled={busy || keyLocked || !configured}
          onClick={() => setConfirmClear(true)}>
          {pending === 'clear' ? <Fragment>
            {activityDots()}
            {t('清除中…', 'Clearing…')}
          </Fragment> : t('清除', 'Clear')}
        </ZhihuButton>
        <ZhihuButton
          host={props.Button}
          variant="primary"
          disabled={busy || keyLocked || keyValue.length === 0 || draftFailure !== undefined}
          onClick={() => void save()}>
          {pending === 'save' ? <Fragment>
            {activityDots()}
            {t('保存中…', 'Saving…')}
          </Fragment> : t('保存', 'Save')}
        </ZhihuButton>
      </div>
      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title={t('清除 Access Secret？', 'Clear Access Secret?')}
        closeLabel={t('关闭', 'Close')}
        // The dialog portals to body; its own element carries the plugin root
        // class so the contract classes inside it resolve.
        className="zhihu-panel"
        footer={<div className="dsh-ui-actions">
          <ZhihuButton host={props.Button} onClick={() => setConfirmClear(false)}>{t('取消', 'Cancel')}</ZhihuButton>
          <ZhihuButton host={props.Button} variant="danger" className="zhihu-button-danger" onClick={() => void clear()}>
            {t('清除', 'Clear')}
          </ZhihuButton>
        </div>}>
        <p className="dsh-ui-help">
          {t('清除后，搜索、工具和知识库请求会失败，直到重新保存密钥。', 'Search, tools and knowledge base requests will fail until you save a key again.')}
        </p>
      </Modal>
    </SettingsShell>
  );
}

// ---------------------------------------------------------------------------
// 用量
// ---------------------------------------------------------------------------

const USAGE_DAYS = 30

type DailyUsage = { date: string; calls: number; failures: number; results: number }

function isUsageSummary(value: unknown): value is { days: DailyUsage[] } {
  if (typeof value !== 'object' || value === null) return false
  return Array.isArray((value as { days?: unknown }).days)
}

/** Local calendar day, kept in the client bundle so it does not pull the node usage domain. */
function localDayKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** `2026-09-15` → `9/15`, so axis labels stay short and do not clip. */
export function formatUsageDate(date: string): string {
  const parts = date.split('-')
  if (parts.length !== 3) return date
  const month = Number(parts[1])
  const day = Number(parts[2])
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || day < 1) return date
  return `${month}/${day}`
}

export type UsageTotals = {
  todayCalls: number
  calls: number
  failures: number
  results: number
  active: DailyUsage[]
}

export function summarizeUsage(days: readonly DailyUsage[], today: string): UsageTotals {
  let todayCalls = 0
  let calls = 0
  let failures = 0
  let results = 0
  const active: DailyUsage[] = []
  for (const day of days) {
    calls += day.calls
    failures += day.failures
    results += day.results
    if (day.date === today) todayCalls = day.calls
    if (day.calls > 0) active.push(day)
  }
  return { todayCalls, calls, failures, results, active: active.slice().reverse() }
}

const TICK_MIN_GAP = 3

/** Sparse windows label active days; nearby ticks collapse so labels do not overlap. */
export function usageChartTicks(days: readonly { calls: number }[]): number[] {
  const last = days.length - 1
  if (last < 0) return []
  if (last === 0) return [0]
  const chosen: number[] = []
  const accept = (index: number): void => {
    if (chosen.some((item) => Math.abs(item - index) < TICK_MIN_GAP)) return
    chosen.push(index)
  }
  const lastHasCalls = (days[last]?.calls ?? 0) > 0
  if (lastHasCalls) accept(last)
  accept(0)
  const active = days
    .map((day, index) => ({ index, calls: day.calls }))
    .filter((row) => row.calls > 0)
    .sort((left, right) => right.calls - left.calls || left.index - right.index)
  if (active.length > 0 && active.length <= 6) {
    for (const row of active) accept(row.index)
  } else {
    accept(Math.round(last / 3))
    accept(Math.round((2 * last) / 3))
  }
  if (!lastHasCalls) accept(last)
  return chosen.sort((left, right) => left - right)
}

function usageYTicks(maxCalls: number): number[] {
  if (maxCalls <= 1) return [0, 1]
  if (maxCalls === 2) return [0, 1, 2]
  const mid = Math.round(maxCalls / 2)
  return mid === 0 || mid === maxCalls ? [0, maxCalls] : [0, mid, maxCalls]
}

const CHART_WIDTH = 600
const CHART_HEIGHT = 176
const CHART_PAD = { top: 20, right: 12, bottom: 24, left: 36 }

/** Indexes whose bar prints its count: the first maximum and the latest active day. */
export function usageValueLabels(days: readonly { calls: number }[]): Set<number> {
  const chosen = new Set<number>()
  let max = -1
  let maxIndex = -1
  let latest = -1
  days.forEach((day, index) => {
    if (day.calls <= 0) return
    if (day.calls > max) { max = day.calls; maxIndex = index }
    latest = index
  })
  if (maxIndex >= 0) chosen.add(maxIndex)
  if (latest >= 0) chosen.add(latest)
  return chosen
}

function UsageChart(props: { days: DailyUsage[]; totals: UsageTotals }): ReactNode {
  const t = useT()
  const days = props.days
  const maxCalls = Math.max(1, ...days.map((day) => day.calls))
  const plotLeft = CHART_PAD.left
  const plotRight = CHART_WIDTH - CHART_PAD.right
  const plotTop = CHART_PAD.top
  const plotBottom = CHART_HEIGHT - CHART_PAD.bottom
  const plotWidth = plotRight - plotLeft
  const plotHeight = plotBottom - plotTop
  const slot = plotWidth / days.length
  const barWidth = Math.max(2, Math.min(14, slot - 2))

  const grid = usageYTicks(maxCalls).map((value) => {
    const y = plotBottom - (value / maxCalls) * plotHeight
    return (
      <g key={`y-${value}`}>
        <line className="zhihu-chart-grid" x1={plotLeft} x2={plotRight} y1={y} y2={y} />
        <text
          className="zhihu-chart-axis"
          x={plotLeft - 6}
          y={y}
          textAnchor="end"
          dominantBaseline="middle">
          {String(value)}
        </text>
      </g>
    );
  })

  const labelled = usageValueLabels(days)
  const bars = days.map((day, index) => {
    const x = plotLeft + index * slot + (slot - barWidth) / 2
    const okCalls = Math.max(0, day.calls - day.failures)
    const failHeight = (day.failures / maxCalls) * plotHeight
    const okHeight = (okCalls / maxCalls) * plotHeight
    const label = t(
      `${day.date}：调用 ${day.calls} 次，成功 ${okCalls} 次，失败 ${day.failures} 次，结果 ${day.results} 条`,
      `${day.date}: ${day.calls} calls, ${okCalls} succeeded, ${day.failures} failed, ${day.results} results`,
    )
    const parts: ReactNode[] = [
      <rect
        key="hit"
        className="zhihu-chart-hit"
        x={plotLeft + index * slot}
        y={plotTop}
        width={slot}
        height={plotHeight} />,
    ]
    if (okHeight > 0) {
      parts.push(<rect
        key="ok"
        className="zhihu-chart-bar-ok"
        x={x}
        y={plotBottom - okHeight}
        width={barWidth}
        height={okHeight} />)
    }
    if (failHeight > 0) {
      parts.push(<rect
        key="fail"
        className="zhihu-chart-bar-fail"
        x={x}
        y={plotBottom - okHeight - failHeight}
        width={barWidth}
        height={failHeight} />)
    }
    // Only the busiest day and the latest active day carry a figure; every
    // other bar reads through its tooltip, so the plot stays legible.
    if (day.calls > 0 && labelled.has(index)) {
      parts.push(<text
        key="n"
        className="zhihu-chart-value"
        x={x + barWidth / 2}
        y={plotBottom - okHeight - failHeight - 4}
        textAnchor="middle">
        {String(day.calls)}
      </text>)
    }
    return (
      <g key={day.date}>
        <title>
          {label}
        </title>
        {parts}
      </g>
    );
  })

  const last = days.length - 1
  const ticks = usageChartTicks(days).map((index) => {
    const day = days[index]
    if (!day) return null
    const anchor = index === 0 ? 'start' : index === last ? 'end' : 'middle'
    const tickX = index === 0 ? plotLeft : index === last ? plotRight : plotLeft + index * slot + slot / 2
    return (
      <text
        key={`x-${day.date}-${index}`}
        className="zhihu-chart-tick"
        x={tickX}
        y={CHART_HEIGHT - 6}
        textAnchor={anchor}>
        {formatUsageDate(day.date)}
      </text>
    );
  })

  return (
    <svg
      className="zhihu-chart"
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      role="img"
      aria-label={t(
        `近 ${USAGE_DAYS} 天知乎工具调用 ${props.totals.calls} 次，失败 ${props.totals.failures} 次，结果 ${props.totals.results} 条`,
        `Last ${USAGE_DAYS} days: ${props.totals.calls} Zhihu calls, ${props.totals.failures} failed, ${props.totals.results} results`,
      )}>
      {grid}
      {bars}
      {ticks}
    </svg>
  );
}

type UsageLoad =
  | { status: 'loading' }
  | { status: 'ready'; days: DailyUsage[] }
  | { status: 'error'; error: string }

function UsageSection(props: { rpc: RpcCaller; Button?: HostButton }): ReactNode {
  const { rpc } = props
  const t = useT()
  const gateRef = useRef<ZhihuClientState | null>(null)
  if (!gateRef.current) gateRef.current = createZhihuClientState()
  const gate = gateRef.current
  const [state, setState] = useState<UsageLoad>({ status: 'loading' })

  // Unmount (tab change/panel close/slot collapse): abort the in-flight read.
  useEffect(() => () => gate.cancel(), [gate])

  // Every refresh supersedes the previous one (begin aborts it), so a late
  // response can never overwrite a newer refresh.
  const load = useCallback(async (): Promise<void> => {
    const { ticket, signal } = gate.begin()
    setState({ status: 'loading' })
    try {
      const raw = await rpc.call(ZHIHU_RPC_CHANNEL, 'usage.summary', { days: USAGE_DAYS }, signal)
      if (!gate.isCurrent(ticket)) return
      const result = raw as ZhihuRpcResult
      if (!result.ok) { setState({ status: 'error', error: result.error.message }); return }
      if (!isUsageSummary(result.value)) { setState({ status: 'error', error: 'invalid response shape' }); return }
      setState({ status: 'ready', days: result.value.days })
    } catch (cause) {
      if (!gate.isCurrent(ticket)) return
      setState({ status: 'error', error: cause instanceof Error ? cause.message : String(cause) })
    }
  }, [gate, rpc])

  useEffect(() => { void load() }, [load])

  const sectionLabel = t('知乎调用用量', 'Zhihu call usage')
  if (state.status === 'loading') {
    return (
      <section data-testid="zhihu-usage" aria-label={sectionLabel}>
        <p className="dsh-ui-loading" role="status">
          {activityDots()}
          {t('正在读取用量…', 'Loading usage…')}
        </p>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section className="dsh-ui-stack" data-testid="zhihu-usage" aria-label={sectionLabel}>
        <p className="dsh-ui-error" role="alert">
          {t(`读取失败：${state.error}`, `Could not load: ${state.error}`)}
        </p>
        <div className="dsh-ui-actions">
          <ZhihuButton host={props.Button} onClick={() => void load()}>
            {t('重试', 'Retry')}
          </ZhihuButton>
        </div>
      </section>
    );
  }

  const totals = summarizeUsage(state.days, localDayKey())
  const hasAny = totals.calls > 0
  const times = t('次', '')
  return (
    <section className="dsh-ui-stack" data-testid="zhihu-usage" aria-label={sectionLabel}>
      <p className="dsh-ui-help">
        {t('本地调用计数，非知乎官方额度或费用。', 'Calls recorded locally; not Zhihu official quota or billing.')}
      </p>
      <div className="dsh-ui-actions">
        <ZhihuButton host={props.Button} onClick={() => void load()}>{t('刷新统计', 'Refresh')}</ZhihuButton>
      </div>
      <div className="zhihu-usage-cards">
        <UsageCard label={t('今日调用', 'Today')} value={totals.todayCalls} unit={times} />
        <UsageCard label={t(`近 ${USAGE_DAYS} 天`, `Last ${USAGE_DAYS} days`)} value={totals.calls} unit={times} />
        <UsageCard label={t('失败', 'Failed')} value={totals.failures} unit={times} />
        <UsageCard label={t('结果条数', 'Results')} value={totals.results} unit={t('条', '')} />
      </div>
      {hasAny ? <Fragment>
        <h3 className="dsh-ui-heading">
          {t('每日调用次数', 'Daily calls')}
        </h3>
        <UsageChart days={state.days} totals={totals} />
        <ul className="dsh-ui-row-wrap dsh-ui-meta">
          <li className="dsh-ui-row">
            <span className="zhihu-chart-chip zhihu-chart-chip-ok" aria-hidden="true" />
            {t('成功', 'Succeeded')}
          </li>
          <li className="dsh-ui-row">
            <span className="zhihu-chart-chip zhihu-chart-chip-fail" aria-hidden="true" />
            {t('失败', 'Failed')}
          </li>
        </ul>
        <h3 className="dsh-ui-heading">
          {t('有记录的日期', 'Days with calls')}
        </h3>
        <div className="zhihu-usage-table-wrap">
          <table className="zhihu-usage-table">
            <thead>
              <tr>
                <th scope="col">{t('日期', 'Date')}</th>
                <th scope="col">{t('调用', 'Calls')}</th>
                <th scope="col">{t('成功', 'Succeeded')}</th>
                <th scope="col">{t('失败', 'Failed')}</th>
                <th scope="col">{t('结果条数', 'Results')}</th>
              </tr>
            </thead>
            <tbody>
              {totals.active.map((day) => <tr key={day.date}>
                <th scope="row">
                  {day.date}
                </th>
                <td>
                  {String(day.calls)}
                </td>
                <td>
                  {String(Math.max(0, day.calls - day.failures))}
                </td>
                <td>
                  {String(day.failures)}
                </td>
                <td>
                  {String(day.results)}
                </td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </Fragment> : <p className="dsh-ui-empty">
        {t(`近 ${USAGE_DAYS} 天暂无调用记录。`, `No calls in the last ${USAGE_DAYS} days.`)}
      </p>}
    </section>
  );
}

function UsageCard(props: { label: string; value: number; unit: string }): ReactNode {
  return (
    <div className="dsh-ui-card dsh-ui-card--flat dsh-ui-list-row">
      <span className="dsh-ui-meta">
        {props.label}
      </span>
      <span className="dsh-ui-heading zhihu-usage-value">
        {String(props.value)}
        <span className="dsh-ui-meta">
          {props.unit}
        </span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 知识库
// ---------------------------------------------------------------------------

type KnowledgeBase = { id: string; name: string; isDefault: boolean; contentCount: number }

function isKnowledgeBaseList(value: unknown): value is { bases: KnowledgeBase[] } {
  if (typeof value !== 'object' || value === null) return false
  return Array.isArray((value as { bases?: unknown }).bases)
}

/** 分块 base64,避免一次性展开大字符串。 */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

const KB_ACCEPT = '.pdf,.md,.txt,.ppt,.pptx,.xlsx,.xls,.docx,.doc,.webp,.png,.jpg,.mobi,.epub,.csv,.azw3'
const KB_MAX_BYTES = 20 * 1024 * 1024

type KbListLoad =
  | { status: 'loading' }
  | { status: 'ready'; bases: KnowledgeBase[] }
  | { status: 'error'; failure: Failure }

function formatSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${size} B`
}

function KnowledgeSection(props: { rpc: RpcCaller; Select?: HostSelect; Button?: HostButton }): ReactNode {
  const { rpc } = props
  const t = useT()
  const gateRef = useRef<ZhihuClientState | null>(null)
  if (!gateRef.current) gateRef.current = createZhihuClientState()
  const gate = gateRef.current
  const [list, setList] = useState<KbListLoad>({ status: 'loading' })
  const [baseId, setBaseId] = useState('')
  const [file, setFile] = useState<File | undefined>(undefined)
  const [fileKey, setFileKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  // Unmount (tab change/panel close/slot collapse): abort the in-flight read
  // or upload and stale its ticket.
  useEffect(() => () => gate.cancel(), [gate])

  // Every refresh supersedes the previous one (begin aborts it), so a late
  // response can never overwrite a newer refresh.
  const load = useCallback(async (): Promise<void> => {
    const { ticket, signal } = gate.begin()
    setList({ status: 'loading' })
    try {
      const raw = await rpc.call(ZHIHU_RPC_CHANNEL, 'knowledge.bases', {}, signal)
      if (!gate.isCurrent(ticket)) return
      const result = raw as ZhihuRpcResult
      if (!result.ok) { setList({ status: 'error', failure: failureOf(result.error.code, result.error.message, t) }); return }
      if (!isKnowledgeBaseList(result.value)) { setList({ status: 'error', failure: { kind: 'request', text: t('响应格式与契约不符。', 'The response does not match the expected shape.') } }); return }
      setList({ status: 'ready', bases: result.value.bases })
    } catch (cause) {
      if (!gate.isCurrent(ticket)) return
      setList({ status: 'error', failure: networkFailure(cause, t) })
    }
  }, [gate, rpc, t])

  useEffect(() => { void load() }, [load])

  // 上传只能由用户显式点击触发：选中文件后先出现确认行，绝不自动上传。
  const upload = async (): Promise<void> => {
    if (!file || busy) return
    setFailure(undefined)
    setNote(undefined)
    if (file.size > KB_MAX_BYTES) { setFailure(t('文件超过 20 MB 上限。', 'The file exceeds the 20 MB limit.')); return }
    const { ticket, signal } = gate.begin()
    setBusy(true)
    try {
      const contentBase64 = toBase64(await file.arrayBuffer())
      // Reading bytes can span a close/tab switch; re-verify before any bytes
      // leave the machine.
      if (!gate.isCurrent(ticket)) return
      const raw = await rpc.call(ZHIHU_RPC_CHANNEL, 'knowledge.upload', {
        fileName: file.name,
        contentBase64,
        ...(baseId ? { knowledgeBaseId: baseId } : {}),
      }, signal)
      if (!gate.isCurrent(ticket)) return
      const result = raw as ZhihuRpcResult
      if (!result.ok) { setFailure(t(`上传失败：${result.error.message}`, `Upload failed: ${result.error.message}`)); return }
      setNote(t('已上传到知乎知识库。', 'Uploaded to the Zhihu knowledge base.'))
      setFile(undefined)
      setFileKey((key) => key + 1)
      await load()
    } catch (cause) {
      if (!gate.isCurrent(ticket)) return
      const detail = cause instanceof Error ? cause.message : String(cause)
      setFailure(t(`上传失败：${detail}`, `Upload failed: ${detail}`))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="dsh-ui-stack" data-testid="zhihu-knowledge" aria-label={t('知乎知识库', 'Zhihu knowledge base')}>
      <p className="dsh-ui-help">
        {t('上传参考资料供检索；文件进入知乎云端，勿上传未发表手稿。', 'Upload references for retrieval. Files go to Zhihu cloud, so avoid unpublished drafts.')}
        {' '}
        <ExternalLink url={KB_MANAGE_URL}>{t('管理知识库', 'Manage knowledge bases')}</ExternalLink>
      </p>
      {list.status === 'loading' ? <p className="dsh-ui-loading" role="status">
        {activityDots()}
        {t('正在读取知识库列表…', 'Loading knowledge bases…')}
      </p> : null}
      {list.status === 'error' ? <Fragment>
        <p className="dsh-ui-error" role="alert">{list.failure.text}</p>
        {list.failure.kind !== 'credential'
          ? <div className="dsh-ui-actions">
            <ZhihuButton host={props.Button} onClick={() => void load()}>{t('重试', 'Retry')}</ZhihuButton>
          </div>
          : null}
      </Fragment> : null}
      {list.status === 'ready' ? <div className="dsh-ui-field">
        <label className="dsh-ui-label" htmlFor="zhihu-kb-base">
          {t('目标知识库', 'Target knowledge base')}
        </label>
        <div className="dsh-ui-row">
          {renderSelect(props.Select, {
            id: 'zhihu-kb-base',
            value: baseId,
            disabled: busy,
            'aria-label': t('目标知识库', 'Target knowledge base'),
            onChange: setBaseId,
            options: [
              { value: '', label: t('默认知识库', 'Default knowledge base') },
              ...list.bases.map((base) => ({
                value: base.id,
                label: t(
                  `${base.name}${base.isDefault ? '（默认）' : ''} · ${base.contentCount} 篇`,
                  `${base.name}${base.isDefault ? ' (default)' : ''} · ${base.contentCount} docs`,
                ),
              })),
            ],
          }, 'dsh-ui-select')}
          <ZhihuButton
            host={props.Button}
            disabled={busy}
            onClick={() => void load()}>
            {t('刷新', 'Refresh')}
          </ZhihuButton>
        </div>
        {list.bases.length === 0 ? <p className="dsh-ui-hint">
          {t('暂无可用知识库，将上传到默认知识库。', 'No knowledge bases yet; uploads go to the default one.')}
        </p> : null}
      </div> : null}
      {list.status === 'ready' ? <div className="dsh-ui-field">
        <span className="dsh-ui-label" id="zhihu-kb-file-label">
          {t('参考资料', 'Reference file')}
        </span>
        {/* Visually hidden but still focusable and in the accessibility tree;
            the visible label below is the real trigger, so no script click is needed. */}
        <input
          key={fileKey}
          id="zhihu-kb-file"
          type="file"
          accept={KB_ACCEPT}
          className="zhihu-file"
          aria-labelledby="zhihu-kb-file-label"
          disabled={busy}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setFile(event.target.files?.[0])} />
        <div className="dsh-ui-row">
          <label
            htmlFor="zhihu-kb-file"
            className="zhihu-file-trigger"
            aria-disabled={busy || undefined}>
            {t('选择文件', 'Choose file')}
          </label>
          <span className="dsh-ui-meta dsh-ui-wrap">
            {file ? `${file.name} · ${formatSize(file.size)}` : t('未选择文件（最大 20 MB）', 'No file chosen (max 20 MB)')}
          </span>
        </div>
      </div> : null}
      {list.status === 'ready' && file ? <div className="dsh-ui-banner">
        {t(
          `将「${file.name}」上传到${baseId ? '所选知识库' : '默认知识库'}？文件进入知乎云端。`,
          `Upload "${file.name}" to the ${baseId ? 'selected' : 'default'} knowledge base? It goes to Zhihu cloud.`,
        )}
      </div> : null}
      {list.status === 'ready' ? <div className="dsh-ui-actions">
        <ZhihuButton
          host={props.Button}
          variant="primary"
          disabled={busy || !file}
          onClick={() => void upload()}>
          {busy ? <Fragment>
            {activityDots()}
            {t('上传中…', 'Uploading…')}
          </Fragment> : t('确认上传', 'Upload')}
        </ZhihuButton>
      </div> : null}
      {note ? <p className="dsh-ui-notice" role="status">
        {note}
      </p> : null}
      {failure ? <p className="dsh-ui-error" role="alert">
        {failure}
      </p> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 面板与插槽注册
// ---------------------------------------------------------------------------

type Tab = 'settings' | 'usage' | 'quota' | 'knowledge' | 'test'

function tabLabel(tab: Tab, t: Translate): string {
  switch (tab) {
    case 'settings': return t('设置', 'Settings')
    case 'usage': return t('统计', 'Stats')
    case 'quota': return t('官方用量', 'Official quota')
    case 'knowledge': return t('知识库', 'Knowledge base')
    case 'test': return t('测试', 'Test')
  }
}

export const SETTINGS_TABS: Tab[] = ['settings', 'usage', 'quota', 'knowledge', 'test']

/**
 * Tabs that have been opened stay mounted (hidden when inactive), so their
 * loaded data is cached here instead of being refetched on every switch.
 */
export function nextVisitedTabs(visited: readonly Tab[], next: Tab): Tab[] {
  return visited.includes(next) ? [...visited] : [...visited, next]
}

function ZhihuSettings(props: { rpc: RpcCaller; credentials: CredentialsApi; Select?: HostSelect; Button?: HostButton; Input?: HostInput }) {
  const { rpc, credentials, Select, Button, Input } = props
  const t = useT()
  const gateRef = useRef<ZhihuClientState | null>(null)
  if (!gateRef.current) gateRef.current = createZhihuClientState()
  const gate = gateRef.current
  const [tab, setTab] = useState<Tab>('settings')
  const [visited, setVisited] = useState<Tab[]>(['settings'])
  const [query, setQuery] = useState('')
  const [testOperation, setTestOperation] = useState<TestOperation>('search')
  const isSearchOperation = (MODES as readonly string[]).includes(testOperation)
  const mode: Mode = isSearchOperation ? testOperation as Mode : 'search'
  const [askModel, setAskModel] = useState<AskModel>('zhida-thinking-1p5')
  const [scopes, setScopes] = useState<RecallScope[]>(['public'])
  const [phase, setPhase] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [failure, setFailure] = useState<Failure | null>(null)
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null)
  const [revision, setRevision] = useState(0)
  const [resultRevision, setResultRevision] = useState(0)

  // Unmount (slot collapse, plugin unload): cancel the in-flight request.
  useEffect(() => () => gate.cancel(), [gate])

  const runSearch = useCallback(async () => {
    if (mode !== 'hot' && !query.trim()) return
    const { ticket, signal } = gate.begin()
    setPhase('loading')
    setFailure(null)
    const payload = mode === 'hot'
      ? { limit: 10 }
      : mode === 'ask'
        ? { query: query.trim(), model: askModel }
        : mode === 'knowledge'
          ? { query: query.trim(), limit: 5, recallScopes: scopes }
          : mode === 'global'
            ? { query: query.trim(), count: 10 }
            : { query: query.trim(), count: 5 }
    try {
      const response = await rpc.call(ZHIHU_RPC_CHANNEL, MODE_ENDPOINT[mode], payload, signal) as ZhihuRpcResult
      if (!gate.isCurrent(ticket)) return
      if (response.ok) {
        const parsed = parseOutcome(mode, response.value)
        if (!parsed) {
          setFailure({ kind: 'request', text: t('响应格式与契约不符。', 'The response does not match the expected shape.') })
          setPhase('error')
          return
        }
        setOutcome(parsed)
        setResultRevision(ticket.revision)
        setPhase('done')
      } else if (response.error.code === 'cancelled') {
        setPhase('idle')
      } else {
        setFailure(failureOf(response.error.code, response.error.message, t))
        setPhase('error')
      }
    } catch (cause) {
      if (!gate.isCurrent(ticket)) return
      setFailure(networkFailure(cause, t))
      setPhase('error')
    }
  }, [gate, rpc, mode, query, askModel, scopes, t])

  // Input changes abort the in-flight request (noteInput aborts and stales
  // its ticket) and drop the UI back to idle so a rerun is possible; a stale
  // response arriving later is ignored by the ticket check. A completed result
  // stays visible but renders stale via the revision mismatch.
  const resetToIdle = () => {
    setPhase((current) => (current === 'loading' || current === 'error' ? 'idle' : current))
    setFailure(null)
  }

  const onQueryChange = (value: string) => {
    setQuery(value)
    setRevision(gate.noteInput())
    resetToIdle()
  }

  const onTestOperationChange = (next: TestOperation) => {
    if (next === testOperation) return
    setRevision(gate.noteInput())
    setTestOperation(next)
    setOutcome(null)
    setPhase('idle')
    setFailure(null)
  }

  const onTabChange = (next: Tab) => {
    if (next === tab) return
    gate.cancel()
    setPhase((current) => (current === 'loading' ? 'idle' : current))
    setTab(next)
    setVisited((current) => nextVisitedTabs(current, next))
  }

  const toggleScope = (scope: RecallScope) => {
    // Deselecting the only remaining scope is a no-op the control announces
    // (aria-disabled plus the hint), so it must not stale the current result.
    if (scopes.length === 1 && scopes[0] === scope) return
    setRevision(gate.noteInput())
    resetToIdle()
    setScopes((current) => current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope])
  }

  const onAskModelChange = (next: AskModel) => {
    if (next === askModel) return
    setRevision(gate.noteInput())
    setAskModel(next)
    resetToIdle()
  }

  const onQueryKeyDown = (event: KeyboardEvent) => {
    zhihuQueryKeyDown(event, { disabled: isSearchDisabled(), search: () => { void runSearch() } })
  }

  const isSearchDisabled = () => phase === 'loading' || (mode !== 'hot' && !query.trim())

  const stale = outcome !== null && resultRevision !== revision
  const searchDisabled = isSearchDisabled()

  // The primitive owns the roving tab stop and the arrow-key walk; the panel
  // ids stay the ones the panels below already carry.
  const [firstTab, ...restTabs] = SETTINGS_TABS.map((key): SegmentedTab<Tab> => ({
    value: key,
    label: tabLabel(key, t),
    id: `zhihu-tab-${key}`,
    panelId: `zhihu-tabpanel-${key}`,
  }))
  const tablist = <SegmentedTabs
    value={tab}
    onChange={onTabChange}
    label={t('知乎分区', 'Zhihu sections')}
    className="zhihu-tabs"
    items={[firstTab, ...restTabs]} />
  const panel = (key: Tab, content: ReactNode) => visited.includes(key) || key === tab
    ? <div key={key} id={`zhihu-tabpanel-${key}`} role="tabpanel" aria-labelledby={`zhihu-tab-${key}`}
      hidden={key !== tab} className="dsh-ui-panel">
      {content}
    </div>
    : null
  const testPanel = <div className="dsh-ui-field">
      <ZhihuTestSelector value={testOperation} onChange={onTestOperationChange} Select={Select} />
      {isSearchOperation ? <Fragment>
      <div className="dsh-ui-row">
        {mode === 'ask' ? renderSelect(Select, {
          'aria-label': t('直答模型', 'Answer model'),
          value: askModel,
          onChange: (next) => onAskModelChange(next as AskModel),
          options: ASK_MODELS.map((model) => ({ value: model.value, label: t(model.zh, model.en) })),
        }, 'dsh-ui-select') : null}
      </div>
      {mode === 'knowledge' ? <Fragment>
        <div className="dsh-ui-row-wrap" role="group" aria-label={t('检索范围', 'Search scope')} aria-describedby="zhihu-scope-hint">
          {SCOPE_OPTIONS.map((scope) => {
            const checked = scopes.includes(scope.value)
            // The last selected scope cannot be turned off; say so instead of ignoring the click.
            const locked = checked && scopes.length === 1
            return <Pill
              key={scope.value}
              active={checked}
              role="checkbox"
              aria-checked={checked}
              aria-disabled={locked || undefined}
              onClick={() => toggleScope(scope.value)}>
              {t(scope.zh, scope.en)}
            </Pill>
          })}
        </div>
        <p className="dsh-ui-hint" id="zhihu-scope-hint">{t('至少保留一个检索范围。', 'Keep at least one scope selected.')}</p>
      </Fragment> : null}
      {renderInput(Input, {
        type: 'search',
        className: 'zhihu-input',
        'data-testid': 'zhihu-query',
        'aria-label': t('搜索关键词', 'Search keywords'),
        placeholder: mode === 'hot' ? t('热榜无需关键词', 'Trending needs no keywords') : t('输入关键词…', 'Enter keywords…'),
        value: query,
        disabled: mode === 'hot',
        onChange: onQueryChange,
        onKeyDown: onQueryKeyDown,
      })}
      <div className="dsh-ui-actions">
        <ZhihuButton
          host={Button}
          variant="primary"
          data-testid="zhihu-search"
          disabled={searchDisabled}
          onClick={() => void runSearch()}>
          {mode === 'hot' ? t('获取热榜', 'Get trending') : t('搜索', 'Search')}
        </ZhihuButton>
        {phase === 'loading'
          ? <ZhihuButton
          host={Button}
          onClick={() => { gate.cancel(); setPhase('idle') }}>
          {t('取消', 'Cancel')}
        </ZhihuButton>
          : null}
      </div>
      {/* One live region carries both the idle hint and the loading notice. */}
      <div className={phase === 'loading' ? 'dsh-ui-loading' : 'dsh-ui-hint'} role="status">
        {phase === 'loading' ? <Fragment>
          {activityDots()}
          {t('正在请求知乎…', 'Requesting Zhihu…')}
        </Fragment> : phase === 'idle' && mode !== 'hot' && !query.trim() ? t('输入关键词后搜索。', 'Enter keywords to search.') : null}
      </div>
      {phase === 'error' && failure ? <div className="dsh-ui-error" role="alert">
        {failure.text}
      </div> : null}
      {phase === 'done' && outcome ? <OutcomeView outcome={outcome} stale={stale} /> : null}
      </Fragment> : <ZhihuOpenPlatformSection
        key={testOperation} selectedOperation={testOperation as ZhihuOpenPlatformOperation}
        rpc={rpc} Button={Button} Input={Input} Select={Select} />}
    </div>
  return (
    <section
      className="zhihu-panel zhihu-settings-embed"
      data-testid="zhihu-settings-embed"
      aria-label={t('知乎', 'Zhihu')}>
      {tablist}
      {panel('settings', <SettingsSection credentials={credentials} Button={Button} Input={Input} />)}
      {panel('usage', <UsageSection rpc={rpc} Button={Button} />)}
      {panel('quota', <ZhihuQuotaSection rpc={rpc} Button={Button} />)}
      {panel('knowledge', <KnowledgeSection rpc={rpc} Select={Select} Button={Button} />)}
      {panel('test', testPanel)}
    </section>
  )
}

/** Settings root: resolves the host locale once and hands it to every section. */
function ZhihuSettingsRoot(props: Parameters<typeof ZhihuSettings>[0] & { locale?: HostLocaleService }) {
  const { locale, ...rest } = props
  const active = useHostLocale(locale)
  return <ZhihuLocaleContext.Provider value={active}><ZhihuSettings {...rest} /></ZhihuLocaleContext.Provider>
}

export function apply(ctx: Context): void {
  ctx.effect(() => {
    const style = injectStyles()
    return () => style?.remove()
  }, 'zhihu.styles')
  const client = ctx as ZhihuClientContext
  // `locale` is an optional service: reading it through a Cordis proxy that
  // lacks it throws, so the lookup is guarded and a missing one stays Chinese.
  let locale: HostLocaleService | undefined
  try { locale = client.locale } catch { locale = undefined }
  const settingsRender = (props: unknown) => <ZhihuSettingsRoot
    rpc={client.connection.rpc}
    credentials={wrapCredentials(client.remote.credentials)}
    locale={locale}
    {...hostComponentsFromRenderProps(props)} />
  // DSH 0.1.7-rc.2 renders a bundle's configuration on its Plugins detail page.
  ctx.effect(() => client.slots.inject('plugins.bundle.config', () =>
    client.slots.register({ name: 'plugins.bundle.config', key: PACKAGE_NAME, order: SLOT_ORDER, label: SLOT_LABEL }, settingsRender)), 'zhihu.settings')
}
