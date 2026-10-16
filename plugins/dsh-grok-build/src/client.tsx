import type { Context } from '@deepseek-ai/cordis'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button, Checkbox, DisclosureRow, IconSettingsOutlineRegular, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'
import { createModelSettingsSubscriber } from '@klarkxy/dsh-plugin-kit/model-settings-client'
import { DEFAULT_SETTINGS, PLUGIN_NAME, RPC_CHANNEL, type RpcResult, type Settings, type Status } from './contracts.ts'
import { capabilityLabel, clientMessage } from './client-copy.ts'

export const name = 'dsh-grok-build-client'
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

export function GrokBuildPanel({ rpc, locale, subscribeSettings }: { rpc: Rpc; locale?: Locale; subscribeSettings?: (change: () => void, error?: (message: string) => void) => () => void }) {
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
  // Executable and timeout are overrides of reliable auto defaults; keep them
  // behind a disclosure row so the page stays zero-configuration.
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
  return <section className="grok-build-panel dsh-ui-stack-lg" lang={english ? 'en' : 'zh'} aria-label="Grok Build">
    <p className="dsh-ui-hint">{t('复用本机官方 Grok Build 的登录，保留 CLI 默认模型。', 'Reuses your official local Grok Build sign-in and CLI default model.')}</p>
    <div className="dsh-ui-stack" aria-busy={checking}>
      <div className="dsh-ui-row-wrap">
        <Tag tone={status?.available ? 'success' : 'neutral'}>{checking ? t('检查中', 'Checking') : status?.available ? t('已连接', 'Connected') : t('不可用', 'Unavailable')}</Tag>
        {status ? <Tag tone={status.authenticated === true ? 'success' : 'neutral'}>{status.authenticated === null ? t('登录状态未知', 'Sign-in unknown') : status.authenticated ? t('已登录', 'Signed in') : t('未登录', 'Signed out')}</Tag> : null}
        {status?.version ? <span className="dsh-ui-meta">Grok Build {status.version}</span> : null}
        <Button disabled={checking || saving} onClick={() => void refreshStatus()}>{t('刷新状态', 'Refresh status')}</Button>
      </div>
      {status?.executable ? <span className="dsh-ui-meta dsh-ui-wrap">{status.executable}</span> : null}
      {status?.error ? <p className="dsh-ui-error" role="alert">{status.error.message}</p> : null}
      {statusError ? <p className="dsh-ui-error" role="alert">{t('状态读取失败：', 'Could not read status: ')}{clientMessage(statusError, english)}</p> : null}
      {status?.capabilities.length ? <ul className="grok-capabilities" aria-label={t('功能状态', 'Capability status')}>
        {status.capabilities.map(item => <li key={item.id} className="dsh-ui-row-wrap">
          <span>{capabilityLabel(item.id, english)}</span>
          <Tag tone={item.available ? 'success' : 'neutral'}>{item.available ? t('可用', 'Available') : t('不可用', 'Unavailable')}</Tag>
          {item.reason ? <span className="dsh-ui-hint dsh-ui-wrap">{item.reason}</span> : null}
        </li>)}
      </ul> : null}
    </div>
    <div className="dsh-ui-stack" aria-busy={locked}>
      <div className="dsh-ui-stack">
        <Checkbox disabled={locked} checked={draft.allowNativeMediaFiles} onChange={checked => edit({ allowNativeMediaFiles: checked })} label={t('允许 Grok 原生工具读取媒体文件', 'Allow native Grok tools to read media files')} />
        <p className="dsh-ui-hint">{t('图片编辑和参考图视频需要此项。插件检查指定输入并增加前置检查，但官方 CLI 在检查钩子故障时会放行；启用后按本机 Grok CLI 的文件访问权限运行。', 'Required for image editing and reference-based video. The plugin checks supplied inputs and adds a pre-tool guard, but the official CLI allows execution if its hook runner fails. These tools run with the local Grok CLI’s file access permissions.')}</p>
      </div>
      <DisclosureRow icon={<IconSettingsOutlineRegular />} title={t('高级设置', 'Advanced settings')} open={advancedOpen} expandable expandOnRowClick onToggle={toggleAdvanced} className="grok-advanced">
        <div className="dsh-ui-stack">
          <label className="dsh-ui-field"><span className="dsh-ui-label">{t('Grok Build 路径', 'Grok Build executable')}</span>
            <Input disabled={locked} value={draft.executable} placeholder={t('留空自动查找', 'Leave blank to detect automatically')} onChange={event => edit({ executable: event.target.value })} /></label>
          <label className="dsh-ui-field"><span className="dsh-ui-label">{t('超时（秒）', 'Timeout (seconds)')}</span>
            <Input type="number" min={10} max={1800} step={0.001} disabled={locked} value={seconds} onChange={event => { dirty.current = true; setSeconds(event.target.value); setSaved(false) }} /></label>
        </div>
      </DisclosureRow>
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
    style.dataset.plugin = PLUGIN_NAME; style.textContent = officialUiCss('grok-build-panel') + `
      .grok-build-panel .grok-capabilities { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: 10px 20px; padding: 0; margin: 0; list-style: none; }
      .grok-build-panel .grok-capabilities > li { min-width: 0; align-items: flex-start; }
      .grok-build-panel .grok-advanced > .dsh-ui-stack { padding-top: 8px; }
    `
    document.head.appendChild(style)
    return () => style.remove()
  }, 'grok-build.styles')
  ctx.effect(() => client.slots.inject('plugins.bundle.config', () => client.slots.register(
    { name: 'plugins.bundle.config', key: PLUGIN_NAME, label: 'Grok Build' },
    () => <GrokBuildPanel rpc={client.connection.rpc} locale={locale} subscribeSettings={subscribeSettings} />,
  )), 'grok-build.settings')
}
