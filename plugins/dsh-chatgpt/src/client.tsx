import type { Context } from '@deepseek-ai/cordis'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'
import { DEFAULT_SETTINGS, PLUGIN_NAME, RPC_CHANNEL, type Login, type RpcResult, type Settings, type Status } from './contracts.ts'

export const name = 'dsh-chatgpt-client'
export const inject = ['slots', 'connection', 'locale'] as const
type Rpc = { call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown> }
type Locale = { getSnapshot(): { active: string }; subscribe(listener: () => void): () => void }
type ClientContext = Context & {
  connection: { rpc: Rpc }
  locale?: Locale
  slots: {
    inject(name: string, callback: () => unknown): () => void
    register(spec: { name: string; key: string; label: string }, render: () => unknown): unknown
  }
}
type SettingsSnapshot = { settings: Settings; revision: number }

/** Authorization links must stay on the account provider, including after URL parsing. */
export function safeAuthorizationUrl(value: string): string | null {
  try {
    const url = new URL(value)
    const allowed = ['openai.com', 'chatgpt.com'].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))
    return url.protocol === 'https:' && allowed && !url.username && !url.password && (!url.port || url.port === '443') ? url.href : null
  } catch { return null }
}

export function LoginDetails({ login, english = false }: { login: Login; english?: boolean }) {
  const url = safeAuthorizationUrl(login.url)
  return <div className="dsh-ui-banner dsh-ui-stack">
    {url ? <a href={url} target="_blank" rel="noopener noreferrer">{english ? 'Continue sign-in' : '继续登录'}</a>
      : <span role="alert">{english ? 'The sign-in link is invalid. Cancel and try again.' : '登录链接无效，请取消后重试。'}</span>}
    {login.code ? <div>{english ? 'Device code: ' : '设备代码：'}<code>{login.code}</code></div> : null}
    <span className="dsh-ui-hint">{english ? 'Complete sign-in in your browser. This page updates automatically.' : '在浏览器中完成登录，此页会自动更新。'}</span>
  </div>
}

export function ChatGptPanel({ rpc, locale }: { rpc: Rpc; locale?: Locale }) {
  const subscribe = useCallback((listener: () => void) => locale?.subscribe(listener) ?? (() => {}), [locale])
  const snapshot = useCallback(() => locale?.getSnapshot().active ?? 'zh', [locale])
  const english = !useSyncExternalStore(subscribe, snapshot, snapshot).startsWith('zh')
  const t = (zh: string, en: string) => english ? en : zh
  const [draft, setDraft] = useState<Settings>({ ...DEFAULT_SETTINGS })
  const [revision, setRevision] = useState<number | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [login, setLogin] = useState<Login | undefined>()
  const [busy, setBusy] = useState<'save' | 'login' | 'cancel' | null>(null)
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState('')
  const [conflict, setConflict] = useState(false)
  const [note, setNote] = useState('')
  const lifetime = useRef<AbortController | null>(null)
  const settingsSequence = useRef(0)
  const statusSequence = useRef(0)
  const ownedLogin = useRef<string | undefined>(undefined)
  const actionRunning = useRef(false)

  async function call<T>(endpoint: string, payload: unknown = {}, signal = lifetime.current?.signal): Promise<T> {
    const result = await rpc.call(RPC_CHANNEL, endpoint, payload, signal) as RpcResult<T>
    if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code })
    return result.value
  }
  const live = () => Boolean(lifetime.current && !lifetime.current.signal.aborted)
  const showError = (error: unknown) => {
    if (!live()) return
    if (error && typeof error === 'object' && 'code' in error && error.code === 'conflict') setConflict(true)
    setFailure(error instanceof Error ? error.message : String(error))
  }
  async function loadSettings() {
    const sequence = ++settingsSequence.current
    setLoading(true)
    try {
      const result = await call<SettingsSnapshot>('settings')
      if (!live() || sequence !== settingsSequence.current) return
      setDraft(result.settings); setRevision(result.revision); setConflict(false)
    } catch (error) { if (sequence === settingsSequence.current) showError(error) }
    finally { if (live() && sequence === settingsSequence.current) setLoading(false) }
  }
  async function refreshStatus() {
    const sequence = ++statusSequence.current
    try {
      const result = await call<Status>('status')
      if (!live() || sequence !== statusSequence.current) return
      setStatus(result); setLogin(result.login)
      if (!result.login || result.login.id !== ownedLogin.current) ownedLogin.current = undefined
    } catch (error) { if (sequence === statusSequence.current) showError(error) }
  }

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    // These are independent reads; status never replaces an edited settings draft.
    void loadSettings(); void refreshStatus()
    return () => {
      controller.abort(); settingsSequence.current++; statusSequence.current++
      if (ownedLogin.current) {
        const expectedLoginId = ownedLogin.current
        ownedLogin.current = undefined
        void rpc.call(RPC_CHANNEL, 'login.cancel', { expectedLoginId }).catch(() => {})
      }
    }
    // The connection owns this panel's lifetime. Locale and form edits do not refetch it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpc])

  useEffect(() => {
    if (!login) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      await refreshStatus()
      if (!stopped) timer = setTimeout(() => void poll(), 2000)
    }
    timer = setTimeout(() => void poll(), 2000)
    return () => { stopped = true; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [login?.id, rpc])

  async function act(kind: 'save' | 'login' | 'cancel', run: () => Promise<void>) {
    if (actionRunning.current || !live()) return
    actionRunning.current = true; setBusy(kind); setFailure(''); setNote('')
    try { await run() } catch (error) { showError(error) }
    finally { actionRunning.current = false; if (live()) setBusy(null) }
  }
  const save = () => act('save', async () => {
    if (revision === null) return
    if (!Number.isInteger(draft.timeoutMs) || draft.timeoutMs < 10_000 || draft.timeoutMs > 1_800_000) {
      throw new Error(t('超时须在 10–1800 秒之间。', 'Timeout must be between 10 and 1800 seconds.'))
    }
    const sequence = ++settingsSequence.current
    const result = await call<SettingsSnapshot>('settings.update', { settings: draft, expectedRevision: revision })
    if (!live() || sequence !== settingsSequence.current) return
    setDraft(result.settings); setRevision(result.revision); setConflict(false)
    setNote(t('已保存。', 'Saved.')); await refreshStatus()
  })
  const startLogin = (kind: Login['kind']) => act('login', async () => {
    ++statusSequence.current
    const result = await call<Login>('login.start', { kind })
    if (!live()) {
      void rpc.call(RPC_CHANNEL, 'login.cancel', { expectedLoginId: result.id }).catch(() => {})
      return
    }
    ++statusSequence.current
    ownedLogin.current = result.id; setLogin(result)
  })
  const cancelLogin = () => act('cancel', async () => {
    if (!ownedLogin.current || ownedLogin.current !== login?.id) return
    ++statusSequence.current
    await call('login.cancel', { expectedLoginId: ownedLogin.current })
    if (!live()) return
    ++statusSequence.current
    ownedLogin.current = undefined; setLogin(undefined); await refreshStatus()
  })
  const edit = (next: Partial<Settings>) => { ++settingsSequence.current; setDraft(current => ({ ...current, ...next })); setNote('') }
  const model = status?.models.find(item => draft.model ? item.id === draft.model : item.isDefault)
  const locked = loading || busy !== null
  const statusLabel = !status ? t('检查中', 'Checking') : !status.available ? t('未找到 Codex', 'Codex unavailable')
    : status.signedIn ? t('已登录', 'Signed in') : t('未登录', 'Signed out')
  return <section className="chatgpt-panel dsh-ui-stack-lg" aria-label="ChatGPT">
    <p className="dsh-ui-hint">{t('使用本机官方 Codex 和 ChatGPT 账户额度。功能是否可用，以实际调用结果为准。', 'Uses official local Codex and your ChatGPT account quota. Capability access is confirmed by an actual call.')}</p>
    <div className="dsh-ui-stack">
      <div className="dsh-ui-row-wrap"><Tag tone={status?.signedIn ? 'success' : 'neutral'}>{statusLabel}</Tag>
        {status?.version ? <span className="dsh-ui-meta">Codex {status.version}</span> : null}
        <Button disabled={busy !== null} onClick={() => { setFailure(''); void refreshStatus() }}>{t('刷新状态', 'Refresh status')}</Button></div>
      {status?.accountLabel || status?.plan ? <p className="dsh-ui-meta">{[status.accountLabel, status.plan].filter(Boolean).join(' · ')}</p> : null}
      {status?.executable ? <span className="dsh-ui-meta dsh-ui-wrap">{status.executable}</span> : null}
      {status?.error ? <p className="dsh-ui-error" role="alert">{status.error}</p> : null}
      <div className="dsh-ui-actions">
        <Button disabled={locked || Boolean(login)} onClick={() => void startLogin('browser')}>{t('浏览器登录', 'Browser sign-in')}</Button>
        <Button disabled={locked || Boolean(login)} onClick={() => void startLogin('device')}>{t('设备代码登录', 'Device code sign-in')}</Button>
        {login?.id === ownedLogin.current && login ? <Button disabled={busy !== null} onClick={() => void cancelLogin()}>{t('取消登录', 'Cancel sign-in')}</Button> : null}
      </div>
      {login ? <LoginDetails login={login} english={english} /> : null}
    </div>
    <div className="dsh-ui-stack">
      <label className="dsh-ui-field"><span className="dsh-ui-label">{t('模型', 'Model')}</span>
        <select className="dsh-ui-select" disabled={locked} value={draft.model} onChange={event => edit({ model: event.target.value, effort: '' })}>
          <option value="">{t('Codex 默认模型', 'Codex default model')}</option>
          {draft.model && !model ? <option value={draft.model}>{draft.model}</option> : null}
          {status?.models.map(item => <option key={item.id} value={item.id}>{item.label}{item.isDefault ? t('（默认）', ' (default)') : ''}</option>)}
        </select></label>
      <label className="dsh-ui-field"><span className="dsh-ui-label">{t('思考强度', 'Reasoning effort')}</span>
        <select className="dsh-ui-select" disabled={locked} value={draft.effort} onChange={event => edit({ effort: event.target.value })}>
          <option value="">{t('模型默认', 'Model default')}</option>
          {draft.effort && !model?.efforts.includes(draft.effort) ? <option value={draft.effort}>{draft.effort}</option> : null}
          {model?.efforts.map(effort => <option key={effort} value={effort}>{effort}</option>)}
        </select></label>
      <label className="dsh-ui-field"><span className="dsh-ui-label">{t('超时（秒）', 'Timeout (seconds)')}</span>
        <Input type="number" min={10} max={1800} step={0.001} disabled={locked} value={draft.timeoutMs / 1000} onChange={event => edit({ timeoutMs: Number(event.target.value) * 1000 })} /></label>
      <label className="dsh-ui-field"><span className="dsh-ui-label">{t('Codex 路径', 'Codex executable')}</span>
        <Input disabled={locked} value={draft.executable} placeholder={t('留空自动查找', 'Leave blank to detect automatically')} onChange={event => edit({ executable: event.target.value })} />
        <span className="dsh-ui-hint">{t('已有 Codex 登录会直接复用。', 'An existing Codex sign-in is reused.')}</span></label>
      <div className="dsh-ui-actions"><Button variant="primary" disabled={locked || revision === null || conflict} onClick={() => void save()}>{busy === 'save' ? t('保存中…', 'Saving…') : t('保存配置', 'Save settings')}</Button>
        <Button disabled={locked} onClick={() => { setFailure(''); setNote(''); void loadSettings() }}>{t('重新加载配置', 'Reload settings')}</Button></div>
    </div>
    {conflict ? <p className="dsh-ui-error" role="alert">{t('配置已在别处修改。请重新加载，再确认更改。', 'Settings changed elsewhere. Reload and review your changes.')}</p> : null}
    {failure ? <p className="dsh-ui-error" role="alert">{failure}</p> : null}
    <p className="dsh-ui-notice" role="status">{loading ? t('加载配置…', 'Loading settings…') : note}</p>
  </section>
}

export function apply(ctx: Context): void {
  const client = ctx as ClientContext
  let locale: Locale | undefined
  try { locale = client.locale } catch { locale = undefined }
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.dataset.plugin = PLUGIN_NAME
    style.textContent = officialUiCss('chatgpt-panel')
    document.head.appendChild(style)
    return () => style.remove()
  }, 'chatgpt.styles')
  ctx.effect(() => client.slots.inject('plugins.bundle.config', () => client.slots.register(
    { name: 'plugins.bundle.config', key: PLUGIN_NAME, label: 'ChatGPT' },
    () => <ChatGptPanel rpc={client.connection.rpc} locale={locale} />,
  )), 'chatgpt.settings')
}
