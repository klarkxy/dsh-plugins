import type { Context } from '@deepseek-ai/cordis'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button, DisclosureRow, IconSettingsOutlineRegular, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'
import { createModelSettingsSubscriber } from '@klarkxy/dsh-plugin-kit/model-settings-client'
import { DEFAULT_SETTINGS, PLUGIN_NAME, RPC_CHANNEL, type RpcResult, type Settings, type Status } from './contracts.ts'
import { capabilityLabel, clientMessage } from './client-copy.ts'

export const name = 'dsh-minimax-code-client'
export const inject = ['slots', 'connection', 'locale'] as const
type Rpc = { call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown> }
type Locale = { getSnapshot(): { active: string }; subscribe(listener: () => void): () => void }
type SettingsSnapshot = { settings: Settings; revision: number }
type ClientContext = Context & {
  connection: { rpc: Rpc }; locale?: Locale
  slots: {
    inject(name: string, callback: () => unknown): () => void
    register(spec: { name: string; key: string; label: string }, render: () => unknown): unknown
  }
}

export function MiniMaxCodePanel({ rpc, locale, subscribeSettings }: { rpc: Rpc; locale?: Locale; subscribeSettings?: (change: () => void, error?: (message: string) => void) => () => void }) {
  const subscribe = useCallback((listener: () => void) => locale?.subscribe(listener) ?? (() => {}), [locale])
  const snapshot = useCallback(() => locale?.getSnapshot().active ?? 'en', [locale])
  const english = !useSyncExternalStore(subscribe, snapshot, snapshot).startsWith('zh')
  const t = (zh: string, en: string) => english ? en : zh
  const [draft, setDraft] = useState<Settings>({ ...DEFAULT_SETTINGS })
  const [seconds, setSeconds] = useState(String(DEFAULT_SETTINGS.timeoutMs / 1000))
  const [revision, setRevision] = useState<number | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(true)
  const [settingsError, setSettingsError] = useState<unknown>(null)
  const [statusError, setStatusError] = useState<unknown>(null)
  const [conflict, setConflict] = useState(false)
  const [saved, setSaved] = useState(false)
  const [syncError, setSyncError] = useState('')
  // Everything editable is an override of a working auto default; keep the
  // page zero-configuration and tuck the overrides behind one disclosure row.
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const toggleAdvanced = useCallback(() => setAdvancedOpen(open => !open), [])
  const lifetime = useRef<AbortController | null>(null)
  const settingsRunning = useRef(false)
  const statusRunning = useRef(false)
  const dirty = useRef(false)
  const pending = useRef(false)
  const refreshSettingsRef = useRef<() => void>(() => {})
  const live = (controller: AbortController) => controller === lifetime.current && !controller.signal.aborted
  async function call<T>(endpoint: string, payload: unknown, controller: AbortController): Promise<T> {
    const result = await rpc.call(RPC_CHANNEL, endpoint, payload, controller.signal) as RpcResult<T>
    if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code })
    return result.value
  }
  async function loadSettings() {
    const controller = lifetime.current
    if (!controller || !live(controller) || settingsRunning.current) { pending.current = true; return }
    settingsRunning.current = true; pending.current = false; setLoading(true); setSettingsError(null); setSaved(false)
    try {
      const result = await call<SettingsSnapshot>('settings', {}, controller)
      if (!live(controller)) return
      if (pending.current) return
      setDraft(result.settings); setSeconds(String(result.settings.timeoutMs / 1000))
      setRevision(result.revision); setConflict(false); dirty.current = false
    } catch (error) { if (live(controller) && !pending.current) setSettingsError(error) }
    finally {
      if (live(controller)) {
        settingsRunning.current = false; setLoading(false)
        if (pending.current) refreshSettingsRef.current()
      }
    }
  }
  refreshSettingsRef.current = () => {
    if (!lifetime.current || lifetime.current.signal.aborted) return
    if (settingsRunning.current) { pending.current = true; return }
    pending.current = false
    if (dirty.current) { setConflict(true); return }
    void loadSettings()
  }
  async function refreshStatus() {
    const controller = lifetime.current
    if (!controller || !live(controller) || statusRunning.current) return
    statusRunning.current = true; setChecking(true); setStatusError(null)
    try {
      const result = await call<Status>('status', {}, controller)
      if (live(controller)) setStatus(result)
    } catch (error) { if (live(controller)) { setStatus(null); setStatusError(error) } }
    finally { if (live(controller)) { statusRunning.current = false; setChecking(false) } }
  }
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller; settingsRunning.current = false; statusRunning.current = false
    dirty.current = false; pending.current = false
    setRevision(null); setStatus(null); setConflict(false); setSaving(false); setSyncError('')
    // Independent reads: status never replaces an edited settings draft.
    void loadSettings(); void refreshStatus()
    return () => controller.abort()
    // The connection owns the request lifetime; locale changes do not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpc])
  useEffect(() => {
    setSyncError('')
    let active = true
    const stop = subscribeSettings?.(() => { if (active) { setSyncError(''); refreshSettingsRef.current() } }, message => { if (active) setSyncError(message) })
    return () => { active = false; stop?.() }
  }, [subscribeSettings, rpc])
  async function save() {
    const controller = lifetime.current
    if (!controller || !live(controller) || settingsRunning.current || revision === null || conflict) return
    settingsRunning.current = true; setSaving(true); setSettingsError(null); setSaved(false)
    try {
      const timeoutSeconds = Number(seconds)
      const timeoutMs = Math.round(timeoutSeconds * 1000)
      if (!seconds.trim() || !Number.isInteger(timeoutMs) || timeoutSeconds !== timeoutMs / 1000 || timeoutMs < 10_000 || timeoutMs > 1_800_000) {
        throw new Error('Timeout must be between 10 and 1800 seconds.')
      }
      const result = await call<SettingsSnapshot>('settings.update', { settings: { ...draft, timeoutMs }, expectedRevision: revision }, controller)
      if (!live(controller)) return
      setDraft(result.settings); setSeconds(String(result.settings.timeoutMs / 1000))
      setRevision(result.revision); setConflict(false); setSaved(true); dirty.current = false
    } catch (error) {
      if (!live(controller)) return
      if (error && typeof error === 'object' && 'code' in error && error.code === 'conflict') setConflict(true)
      else setSettingsError(error)
    } finally {
      if (live(controller)) {
        settingsRunning.current = false; setSaving(false)
        if (pending.current) refreshSettingsRef.current()
      }
    }
  }
  const edit = (next: Partial<Settings>) => { dirty.current = true; setDraft(current => ({ ...current, ...next })); setSaved(false) }
  const locked = loading || saving
  return <section className="minimax-code-panel dsh-ui-stack-lg" lang={english ? 'en' : 'zh'} aria-label="MiniMax Code">
    <p className="dsh-ui-hint">{t('复用官方 MiniMax Code 登录。媒体功能需要已登录的 MiniMax Code 正在运行；网页搜索使用官方 mcode 的独立搜索配置。', 'Reuses official MiniMax Code sign-in. Media tools require a running, signed-in MiniMax Code host; web search uses a dedicated search configuration in official mcode.')}</p>
    <div className="dsh-ui-stack" aria-busy={checking}>
      <div className="dsh-ui-row-wrap">
        <Tag tone={status?.available ? 'success' : 'neutral'}>{checking ? t('检查中', 'Checking') : status?.available ? t('已连接', 'Connected') : t('不可用', 'Unavailable')}</Tag>
        {status ? <Tag tone={status.authenticated === true ? 'success' : 'neutral'}>{t('媒体：', 'Media: ')}{status.authenticated === null ? t('登录状态未知', 'Sign-in unknown') : status.authenticated ? t('已登录', 'Signed in') : t('未登录', 'Signed out')}</Tag> : null}
        {status?.version ? <span className="dsh-ui-meta">MiniMax Code {status.version}</span> : null}
        <Button disabled={checking || saving} onClick={() => void refreshStatus()}>{t('刷新状态', 'Refresh status')}</Button>
      </div>
      {status?.executable ? <span className="dsh-ui-meta dsh-ui-wrap">{status.executable}</span> : null}
      {status?.error ? <p className="dsh-ui-error" role="alert">{clientMessage(status.error.message, english)}</p> : null}
      {statusError ? <p className="dsh-ui-error" role="alert">{t('状态读取失败：', 'Could not read status: ')}{clientMessage(statusError, english)}</p> : null}
      {status?.capabilities.length ? <ul className="minimax-capabilities" aria-label={t('功能状态', 'Capability status')}>
        {status.capabilities.map(item => <li key={item.id} className="dsh-ui-row-wrap">
          <span>{capabilityLabel(item.id, english)}</span>
          <Tag tone={item.available ? 'success' : 'neutral'}>{item.available ? t('可用', 'Available') : t('不可用', 'Unavailable')}</Tag>
          {item.reason ? <span className="dsh-ui-hint dsh-ui-wrap">{clientMessage(item.reason, english)}</span> : null}
        </li>)}
      </ul> : null}
    </div>
    <DisclosureRow icon={<IconSettingsOutlineRegular />} title={t('高级设置', 'Advanced settings')} open={advancedOpen} expandable expandOnRowClick onToggle={toggleAdvanced} className="minimax-advanced">
      <div className="dsh-ui-stack" aria-busy={locked}>
        <label className="dsh-ui-field"><span className="dsh-ui-label">{t('媒体工具路径', 'Media tools executable')}</span>
          <Input disabled={locked} value={draft.toolsExecutable} placeholder={t('留空自动查找', 'Leave blank to detect automatically')} onChange={event => edit({ toolsExecutable: event.target.value })} /></label>
        <label className="dsh-ui-field"><span className="dsh-ui-label">{t('mcode 搜索路径', 'mcode search executable')}</span>
          <Input disabled={locked} value={draft.codeExecutable} placeholder={t('留空自动查找', 'Leave blank to detect automatically')} onChange={event => edit({ codeExecutable: event.target.value })} /></label>
        <label className="dsh-ui-field"><span className="dsh-ui-label">{t('搜索专用配置目录（可选）', 'Dedicated search profile directory (optional)')}</span>
          <Input disabled={locked} value={draft.searchDataDir} placeholder={t('留空使用现有 MiniMax 配置', 'Leave blank to use the existing MiniMax profile')} onChange={event => edit({ searchDataDir: event.target.value })} />
          <span className="dsh-ui-hint">{t('若现有配置启用了 MCP 或可执行扩展，可选择已通过官方 CLI 登录的独立目录；插件不会复制登录凭据。搜索登录状态在实际调用时验证。', 'If the existing profile has MCP or executable extensions, select a separate directory already signed in through the official CLI. This plugin does not copy login credentials. Search sign-in is verified when a request runs.')}</span></label>
        <label className="dsh-ui-field"><span className="dsh-ui-label">{t('区域', 'Region')}</span>
          <select className="dsh-ui-select" disabled={locked} value={draft.region} onChange={event => edit({ region: event.target.value as Settings['region'] })}>
            <option value="auto">{t('自动', 'Automatic')}</option>
            <option value="cn">{t('中国', 'China')}</option>
            <option value="global">{t('全球', 'Global')}</option>
          </select></label>
        <label className="dsh-ui-field"><span className="dsh-ui-label">{t('超时（秒）', 'Timeout (seconds)')}</span>
          <Input type="number" min={10} max={1800} step={0.001} disabled={locked} value={seconds} onChange={event => { dirty.current = true; setSeconds(event.target.value); setSaved(false) }} /></label>
      </div>
    </DisclosureRow>
    <div className="dsh-ui-stack" aria-busy={locked}>
      <div className="dsh-ui-actions">
        <Button variant="primary" disabled={locked || revision === null || conflict} onClick={() => void save()}>{saving ? t('保存中…', 'Saving…') : t('保存配置', 'Save settings')}</Button>
        <Button disabled={locked} onClick={() => void loadSettings()}>{t('重新加载配置', 'Reload settings')}</Button>
      </div>
    </div>
    {conflict ? <p className="dsh-ui-error" role="alert">{t('配置已在别处修改。请重新加载，再确认更改。', 'Settings changed elsewhere. Reload and review your changes.')}</p> : null}
    {syncError ? <p className="dsh-ui-hint" role="status">{t('自动刷新不可用，请重新加载配置。', 'Automatic refresh unavailable; reload settings manually.')}</p> : null}
    {settingsError ? <p className="dsh-ui-error" role="alert">{clientMessage(settingsError, english)}</p> : null}
    <p className="dsh-ui-notice" role="status">{loading ? t('加载配置…', 'Loading settings…') : saved ? t('已保存。', 'Saved.') : ''}</p>
  </section>
}

export function apply(ctx: Context): void {
  const client = ctx as ClientContext
  const settingsSubscriber = createModelSettingsSubscriber(ctx, PLUGIN_NAME)
  const subscribeSettings = (change: () => void, error?: (message: string) => void) => settingsSubscriber.subscribe(change, error)
  let locale: Locale | undefined
  try { locale = client.locale } catch { locale = undefined }
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.dataset.plugin = PLUGIN_NAME; style.textContent = officialUiCss('minimax-code-panel') + `
      .minimax-code-panel .minimax-capabilities { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: 10px 20px; padding: 0; margin: 0; list-style: none; }
      .minimax-code-panel .minimax-capabilities > li { min-width: 0; align-items: flex-start; }
      .minimax-code-panel .minimax-advanced > .dsh-ui-stack { padding-top: 8px; }
    `
    document.head.appendChild(style)
    return () => style.remove()
  }, 'minimax-code.styles')
  ctx.effect(() => client.slots.inject('plugins.bundle.config', () => client.slots.register(
    { name: 'plugins.bundle.config', key: PLUGIN_NAME, label: 'MiniMax Code' },
    () => <MiniMaxCodePanel rpc={client.connection.rpc} locale={locale} subscribeSettings={subscribeSettings} />,
  )), 'minimax-code.settings')
}
