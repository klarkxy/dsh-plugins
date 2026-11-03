/**
 * Settings page for the magpie gateway connection. All state comes from the
 * host over the plugin RPC channel; the page only drafts the address and the
 * key field, never touches settings files itself.
 */
import type { Context } from '@deepseek-ai/cordis'
import { Button, Input, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  PLUGIN_NAME, RPC_CHANNEL,
  type MagpieStatus, type RpcResult, type TestResult,
} from './contracts.ts'

export const name = 'dsh-magpie-client'
export const inject = ['slots', 'connection', 'locale'] as const

interface Client {
  connection: { rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<unknown> } }
  locale?: { getSnapshot(): { active: string }; subscribe(listener: () => void): () => void }
  slots: {
    inject(key: string, callback: () => unknown): () => void
    register(spec: { name: string; key: string }, render: unknown): () => void
  }
}

const styles = `${officialUiCss('.mgp-root')}
.mgp-root .mgp-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.mgp-root .mgp-row > .mgp-grow { flex: 1 1 220px; }
.mgp-root .mgp-danger { color: var(--dsw-alias-state-error-primary); }
`

const copy = {
  zh: {
    loading: '正在读取状态…', failed: '操作失败：', retry: '重试',
    connection: '连接', address: '网关地址', addressHelp: '本机、局域网或远程的 magpie 网关，例如 http://127.0.0.1:3425。',
    key: '网关 Key', keyHelp: '非本机网关需要 Key；本机网关留空会自动使用占位 Key。',
    keyPlaceholder: '输入网关 Key', keyConfigured: '已保存', keyClear: '清除',
    test: '测试', save: '保存', saved: '已保存。',
    sync: '同步', syncNow: '立即同步', syncing: '正在同步…', syncOnStart: '启动时同步', syncOnStartHelp: '每次启动本 profile 时同步一次。',
    lastSync: '上次同步', never: '从未同步', models: (n: number) => `${n} 个模型`,
    warnings: '警告', readonlyHint: '当前 profile 的设置只读，无法写入。',
    defaultModel: '默认模型', defaultModelHelp: '把某个 magpie 模型设为新会话的默认模型。',
    keepCurrent: '不更改', webSearch: '网络搜索', webSearchHelp: '通过网关用所选模型执行网络搜索。',
    sameAsDefault: '与默认模型相同', disconnect: '断开连接', confirmDisconnect: '确认断开？',
    disconnectHelp: '移除三条 magpie 供应商路由并还原默认模型与网络搜索；已保存的 Key 保留。',
    testOk: (n: number) => `连接正常，网关返回 ${n} 个模型。`, notConnected: '尚未连接。',
  },
  en: {
    loading: 'Loading status…', failed: 'Action failed: ', retry: 'Retry',
    connection: 'Connection', address: 'Gateway address', addressHelp: 'A magpie gateway on this computer, your LAN, or elsewhere, e.g. http://127.0.0.1:3425.',
    key: 'Gateway key', keyHelp: 'Non-local gateways need a key; a local gateway uses a placeholder automatically.',
    keyPlaceholder: 'Enter gateway key', keyConfigured: 'Saved', keyClear: 'Clear',
    test: 'Test', save: 'Save', saved: 'Saved.',
    sync: 'Sync', syncNow: 'Sync now', syncing: 'Syncing…', syncOnStart: 'Sync at startup', syncOnStartHelp: 'Run one sync every time this profile starts.',
    lastSync: 'Last sync', never: 'Never synced', models: (n: number) => `${n} models`,
    warnings: 'Warnings', readonlyHint: 'Settings are read-only in this profile; nothing can be written.',
    defaultModel: 'Default model', defaultModelHelp: 'Promote a magpie model to the default for new conversations.',
    keepCurrent: "Don't change", webSearch: 'Web search', webSearchHelp: 'Run web search through the gateway with the selected model.',
    sameAsDefault: 'Same as default model', disconnect: 'Disconnect', confirmDisconnect: 'Confirm disconnect?',
    disconnectHelp: 'Removes the three magpie provider routes and reverts the default model and web search; the saved key is kept.',
    testOk: (n: number) => `Connection OK: the gateway returned ${n} models.`, notConnected: 'Not connected yet.',
  },
} as const

type Copy = (typeof copy)['zh'] | (typeof copy)['en']

class RpcError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'RpcError' }
}

const SYNC_POLL_MS = 1500

function useHostLocale(client: Client): 'zh' | 'en' {
  const subscribe = useCallback((listener: () => void) => client.locale?.subscribe(listener) ?? (() => {}), [client])
  const snapshot = useCallback(() => client.locale?.getSnapshot().active ?? 'zh', [client])
  return String(useSyncExternalStore(subscribe, snapshot, snapshot)).startsWith('zh') ? 'zh' : 'en'
}

function ConfirmButton(props: { label: string; confirmLabel: string; disabled?: boolean; onConfirm(): void }) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const disarm = () => { clearTimeout(timer.current); setArmed(false) }
  return <Button variant="outline" size="sm" className="mgp-danger" disabled={props.disabled}
    onClick={() => {
      if (!armed) { setArmed(true); timer.current = setTimeout(() => setArmed(false), 3000); return }
      disarm(); props.onConfirm()
    }}
    onBlur={disarm}>{armed ? props.confirmLabel : props.label}</Button>
}

export function MagpieSettingsPage({ client }: { client: Client }) {
  const locale = useHostLocale(client)
  const text: Copy = copy[locale]
  const [status, setStatus] = useState<MagpieStatus>()
  const [address, setAddress] = useState('')
  const [addressDirty, setAddressDirty] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [busy, setBusy] = useState<string>('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const mounted = useRef(true)

  const call = useCallback(async <T,>(endpoint: string, payload: unknown = {}): Promise<T> => {
    const result = await client.connection.rpc.call(RPC_CHANNEL, endpoint, payload) as RpcResult<T>
    if (!result.ok) throw new RpcError(result.error.code, result.error.message)
    return result.value
  }, [client])

  const load = useCallback(async () => {
    try {
      const next = await call<MagpieStatus>('status')
      if (!mounted.current) return
      setStatus(next)
      setAddress(current => addressDirty ? current : next.address)
      setError('')
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [call, addressDirty])

  useEffect(() => {
    mounted.current = true
    void load()
    return () => { mounted.current = false }
  }, [load])

  // While a sync runs, poll until it lands so counts and warnings show up.
  useEffect(() => {
    if (!status?.syncing) return
    const timer = setInterval(() => { void load() }, SYNC_POLL_MS)
    return () => clearInterval(timer)
  }, [status?.syncing, load])

  const action = useCallback(async (name: string, run: () => Promise<void>) => {
    if (busy) return
    setBusy(name); setNote(''); setError('')
    try { await run() }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (mounted.current) setBusy('') }
  }, [busy])

  const refresh = (next: MagpieStatus) => { setStatus(next); setAddress(current => addressDirty ? current : next.address) }

  if (!status) {
    return <section className="mgp-root dsh-ui-page dsh-ui-form" data-testid="magpie-settings">
      {error
        ? <p role="alert" className="dsh-ui-error">{text.failed}{error}</p>
        : <p role="status" className="dsh-ui-hint">{text.loading}</p>}
      <Button variant="ghost" size="sm" disabled={Boolean(busy)} onClick={() => void load()}>{text.retry}</Button>
    </section>
  }

  const models = status.models
  const defaultChoices = models.map(model => model.id)
  if (status.options.defaultModel && !defaultChoices.includes(status.options.defaultModel)) {
    defaultChoices.unshift(status.options.defaultModel)
  }
  const modelLabel = (id: string) => {
    const found = models.find(model => model.id === id)
    return found ? `${found.name ?? id} · ${found.route}` : id
  }

  return <section className="mgp-root dsh-ui-page dsh-ui-form" data-testid="magpie-settings">
    {status.writable === false ? <p role="status" className="dsh-ui-hint">{text.readonlyHint}</p> : null}
    {error ? <p role="alert" className="dsh-ui-error">{text.failed}{error}</p> : null}
    {note ? <p role="status" className="dsh-ui-notice">{note}</p> : null}

    <article className="dsh-ui-card">
      <h3 className="dsh-ui-label">{text.connection}</h3>
      <label className="dsh-ui-field">
        <span className="dsh-ui-label">{text.address}</span>
        <Input value={addressDirty ? address : status.address}
          placeholder="http://127.0.0.1:3425"
          onChange={event => { setAddress(event.target.value); setAddressDirty(true) }} />
        <span className="dsh-ui-help">{text.addressHelp}</span>
      </label>
      <label className="dsh-ui-field">
        <span className="dsh-ui-label">{text.key} {status.keyConfigured ? <Tag tone="success">{text.keyConfigured}</Tag> : null}</span>
        <span className="mgp-row">
          <span className="mgp-grow">
            <Input type="password" value={keyDraft} placeholder={text.keyPlaceholder}
              onChange={event => setKeyDraft(event.target.value)} />
          </span>
          {status.keyConfigured ? <Button variant="ghost" size="sm" disabled={Boolean(busy)}
            onClick={() => void action('clear-key', async () => {
              refresh(await call<MagpieStatus>('saveConnection', { clearKey: true }))
              setNote(text.saved)
            })}>{text.keyClear}</Button> : null}
        </span>
        <span className="dsh-ui-help">{text.keyHelp}</span>
      </label>
      <div className="dsh-ui-form-footer mgp-row">
        <Button variant="outline" size="md" disabled={Boolean(busy)} onClick={() => void action('test', async () => {
          if (addressDirty || keyDraft) {
            refresh(await call<MagpieStatus>('saveConnection', {
              address, apiKey: keyDraft || undefined,
            }))
            setKeyDraft(''); setAddressDirty(false)
          }
          const result = await call<TestResult>('test')
          setNote(text.testOk(result.models))
          await load()
        })}>{text.test}</Button>
        <Button variant="primary" size="md" disabled={Boolean(busy) || (!addressDirty && !keyDraft)} onClick={() => void action('save', async () => {
          refresh(await call<MagpieStatus>('saveConnection', { address, apiKey: keyDraft || undefined }))
          setKeyDraft(''); setAddressDirty(false); setNote(text.saved)
        })}>{text.save}</Button>
      </div>
    </article>

    <article className="dsh-ui-card">
      <div className="mgp-row">
        <h3 className="dsh-ui-label mgp-grow">{text.sync}</h3>
        <Button variant="outline" size="md" disabled={Boolean(busy) || status.syncing} onClick={() => void action('sync', async () => {
          refresh(await call<MagpieStatus>('sync'))
          setNote(text.saved)
        })}>{status.syncing ? text.syncing : text.syncNow}</Button>
      </div>
      <label className="dsh-ui-field">
        <span className="mgp-row">
          <Switch checked={status.options.syncOnStart} disabled={Boolean(busy)} label={text.syncOnStart}
            onChange={next => void action('options', async () => {
              refresh(await call<MagpieStatus>('setOptions', { syncOnStart: next }))
            })} />
          <span className="dsh-ui-label">{text.syncOnStart}</span>
        </span>
        <span className="dsh-ui-help">{text.syncOnStartHelp}</span>
      </label>
      <p className="dsh-ui-meta">
        {text.lastSync}: {status.lastSync
          ? `${new Date(status.lastSync.at).toLocaleString()} · ${Object.entries(status.lastSync.routes).map(([route, count]) => `${route}: ${count}`).join(' · ')}`
          : text.never}
      </p>
      {status.lastSync?.warnings.length ? <div>
        <p className="dsh-ui-label">{text.warnings}</p>
        {status.lastSync.warnings.map((warning, index) => <p key={index} className="dsh-ui-hint">{warning}</p>)}
      </div> : null}
      {status.lastError ? <p role="alert" className="dsh-ui-error">{new Date(status.lastError.at).toLocaleString()} · {status.lastError.message}</p> : null}
      {status.gateway ? <p className="dsh-ui-hint">{status.gateway.name}{status.gateway.version ? ` ${status.gateway.version}` : ''} · {text.models(models.length)}</p> : null}
    </article>

    <article className="dsh-ui-card">
      <label className="dsh-ui-field">
        <span className="dsh-ui-label">{text.defaultModel}</span>
        <select className="dsh-ui-select" value={status.options.defaultModel ?? ''} disabled={Boolean(busy)}
          onChange={event => void action('options', async () => {
            refresh(await call<MagpieStatus>('setOptions', { defaultModel: event.target.value || null }))
          })}>
          <option value="">{text.keepCurrent}</option>
          {defaultChoices.map(id => <option key={id} value={id}>{modelLabel(id)}</option>)}
        </select>
        <span className="dsh-ui-help">{text.defaultModelHelp}</span>
      </label>
    </article>

    <article className="dsh-ui-card">
      <div className="mgp-row">
        <span className="dsh-ui-label mgp-grow">{text.webSearch}</span>
        <Switch checked={status.options.webSearch} disabled={Boolean(busy)} label={text.webSearch}
          onChange={next => void action('options', async () => {
            refresh(await call<MagpieStatus>('setOptions', { webSearch: next }))
          })} />
      </div>
      <p className="dsh-ui-help">{text.webSearchHelp}</p>
      {status.options.webSearch ? <label className="dsh-ui-field">
        <select className="dsh-ui-select" value={status.options.webSearchModel ?? ''} disabled={Boolean(busy)}
          onChange={event => void action('options', async () => {
            refresh(await call<MagpieStatus>('setOptions', { webSearchModel: event.target.value || null }))
          })}>
          <option value="">{text.sameAsDefault}</option>
          {models.map(model => <option key={model.id} value={model.id}>{model.name ?? model.id}</option>)}
        </select>
      </label> : null}
    </article>

    <article className="dsh-ui-card">
      <div className="mgp-row">
        <div className="mgp-grow">
          <span className="dsh-ui-label">{text.disconnect}</span>
          <p className="dsh-ui-help">{text.disconnectHelp}</p>
        </div>
        <ConfirmButton label={text.disconnect} confirmLabel={text.confirmDisconnect} disabled={Boolean(busy)}
          onConfirm={() => void action('disconnect', async () => {
            refresh(await call<MagpieStatus>('disconnect'))
            setNote(text.saved)
          })} />
      </div>
    </article>
  </section>
}

export function apply(ctx: Context): void {
  const client = ctx as unknown as Client
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-plugin', PLUGIN_NAME)
    style.textContent = styles
    document.head.appendChild(style)
    return () => style.remove()
  }, 'magpie.styles')
  ctx.effect(() => client.slots.inject('plugins.bundle.config', () => client.slots.register(
    { name: 'plugins.bundle.config', key: PLUGIN_NAME },
    () => <MagpieSettingsPage client={client} />,
  )), 'magpie.settings')
}
