/**
 * Magpie's group inside the native Models settings page.
 *
 * The host's `settings.models.footer` seat renders after the provider rows and
 * the add-provider button of the Models section, and it projects no label — so
 * the group carries its own visible heading. The connection pair stays open;
 * the rest (default model, web search, sync at startup, disconnect) sits behind
 * one advanced disclosure, so the models page keeps a single compact block
 * instead of a page of its own.
 *
 * All state comes from the host over the plugin RPC channel; the page only
 * drafts the address and the key field, never touches settings files itself.
 */
import type { Context } from '@deepseek-ai/cordis'
import { Button, Input, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  PLUGIN_NAME, RPC_CHANNEL, RPC_ENDPOINTS,
  type MagpieStatus, type RpcResult, type TestResult,
} from './contracts.ts'

export const name = 'dsh-magpie-client'
export const inject = ['slots', 'connection', 'locale'] as const

interface Client {
  connection: { rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<unknown> } }
  locale?: { getSnapshot(): { active: string }; subscribe(listener: () => void): () => void }
  slots: {
    inject(key: string, callback: () => unknown): () => void
    register(spec: { name: string; id: string; order?: number }, render: unknown): () => void
  }
}

const styles = `${officialUiCss('.mgp-root')}
.mgp-root .mgp-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex-wrap: wrap; min-width: 0; }
.mgp-root .mgp-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.mgp-root .mgp-grow { flex: 1 1 220px; min-width: 0; }
.mgp-root .mgp-danger { color: var(--dsw-alias-state-error-primary); }
/* The advanced disclosure: a plain details/summary, so it opens without any
 * script and keeps the keyboard behaviour the platform gives it. */
.mgp-root .mgp-advanced { border-top: 0.5px solid var(--dsw-alias-border-l2); padding-top: 8px; min-width: 0; }
.mgp-root .mgp-advanced > summary { display: inline-flex; align-items: center; gap: 6px; width: fit-content; cursor: pointer; list-style: none; font-size: 12px; line-height: 18px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.mgp-root .mgp-advanced > summary::-webkit-details-marker { display: none; }
.mgp-root .mgp-advanced > summary::before { content: ''; width: 5px; height: 5px; border-right: 1.5px solid currentcolor; border-bottom: 1.5px solid currentcolor; transform: rotate(-45deg) translate(-1px, -1px); transition: transform 120ms ease; }
.mgp-root .mgp-advanced[open] > summary::before { transform: rotate(45deg) translate(-1px, -1px); }
.mgp-root .mgp-advanced > summary:hover { color: var(--dsw-alias-label-primary); }
.mgp-root .mgp-advanced-body { display: flex; flex-direction: column; gap: 12px; padding-top: 12px; min-width: 0; }
`

const copy = {
  zh: {
    loading: '正在读取状态…', failed: '操作失败：', retry: '重试',
    title: 'Magpie', intro: '连接本机、局域网或远程的 magpie 网关，把它的模型加入本 profile 的模型列表。',
    address: '网关地址', addressHelp: '本机、局域网或远程的 magpie 网关，例如 http://127.0.0.1:3425。',
    key: '网关 Key', keyHelp: '非本机网关需要 Key；本机网关留空会自动使用占位 Key。',
    keyPlaceholder: '输入网关 Key', keyConfigured: '已保存', keyClear: '清除',
    test: '测试', save: '保存', saved: '已保存。',
    syncNow: '立即同步', syncing: '正在同步…', syncOnStart: '启动时同步', syncOnStartHelp: '每次启动本 profile 时同步一次。',
    lastSync: '上次同步', never: '从未同步', models: (n: number) => `${n} 个模型`,
    warnings: '警告', readonlyHint: '当前 profile 的设置只读，无法写入。',
    defaultModel: '默认模型', defaultModelHelp: '把某个 magpie 模型设为新会话的默认模型。',
    keepCurrent: '不更改', webSearch: '网络搜索', webSearchHelp: '通过网关用所选模型执行网络搜索。',
    sameAsDefault: '与默认模型相同', disconnect: '断开连接', confirmDisconnect: '确认断开？',
    disconnectHelp: '移除三条 magpie 供应商路由并还原默认模型与网络搜索；已保存的 Key 保留。',
    testOk: (n: number) => `连接正常，网关返回 ${n} 个模型。`, notConnected: '尚未连接。',
    advanced: '高级设置',
  },
  en: {
    loading: 'Loading status…', failed: 'Action failed: ', retry: 'Retry',
    title: 'Magpie', intro: 'Point DSH at a magpie gateway on this computer, your LAN, or elsewhere, and its models join this profile.',
    address: 'Gateway address', addressHelp: 'A magpie gateway on this computer, your LAN, or elsewhere, e.g. http://127.0.0.1:3425.',
    key: 'Gateway key', keyHelp: 'Non-local gateways need a key; a local gateway uses a placeholder automatically.',
    keyPlaceholder: 'Enter gateway key', keyConfigured: 'Saved', keyClear: 'Clear',
    test: 'Test', save: 'Save', saved: 'Saved.',
    syncNow: 'Sync now', syncing: 'Syncing…', syncOnStart: 'Sync at startup', syncOnStartHelp: 'Run one sync every time this profile starts.',
    lastSync: 'Last sync', never: 'Never synced', models: (n: number) => `${n} models`,
    warnings: 'Warnings', readonlyHint: 'Settings are read-only in this profile; nothing can be written.',
    defaultModel: 'Default model', defaultModelHelp: 'Promote a magpie model to the default for new conversations.',
    keepCurrent: "Don't change", webSearch: 'Web search', webSearchHelp: 'Run web search through the gateway with the selected model.',
    sameAsDefault: 'Same as default model', disconnect: 'Disconnect', confirmDisconnect: 'Confirm disconnect?',
    disconnectHelp: 'Removes the three magpie provider routes and reverts the default model and web search; the saved key is kept.',
    testOk: (n: number) => `Connection OK: the gateway returned ${n} models.`, notConnected: 'Not connected yet.',
    advanced: 'Advanced',
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
      const next = await call<MagpieStatus>(RPC_ENDPOINTS.status)
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
    return <section className="mgp-root dsh-ui-card" data-testid="magpie-settings">
      <span className="dsh-ui-heading">{text.title}</span>
      {error
        ? <p role="alert" className="dsh-ui-error">{text.failed}{error}</p>
        : <p role="status" className="dsh-ui-hint">{text.loading}</p>}
      <div className="dsh-ui-actions">
        <Button variant="ghost" size="sm" disabled={Boolean(busy)} onClick={() => void load()}>{text.retry}</Button>
      </div>
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
  const gatewaySummary = status.gateway
    ? `${status.gateway.name}${status.gateway.version ? ` ${status.gateway.version}` : ''} · ${text.models(models.length)}`
    : text.notConnected

  return <section className="mgp-root dsh-ui-card" data-testid="magpie-settings">
    <div className="mgp-head">
      <span className="dsh-ui-heading">{text.title}</span>
      <span className="dsh-ui-meta">{gatewaySummary}</span>
    </div>
    <p className="dsh-ui-help">{text.intro}</p>
    {status.writable === false ? <p role="status" className="dsh-ui-hint">{text.readonlyHint}</p> : null}
    {error ? <p role="alert" className="dsh-ui-error">{text.failed}{error}</p> : null}
    {note ? <p role="status" className="dsh-ui-notice">{note}</p> : null}

    <div className="dsh-ui-fields-grid">
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
              refresh(await call<MagpieStatus>(RPC_ENDPOINTS.saveConnection, { clearKey: true }))
              setNote(text.saved)
            })}>{text.keyClear}</Button> : null}
        </span>
        <span className="dsh-ui-help">{text.keyHelp}</span>
      </label>
    </div>

    <div className="dsh-ui-actions">
      <Button variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => void action('test', async () => {
        if (addressDirty || keyDraft) {
          refresh(await call<MagpieStatus>(RPC_ENDPOINTS.saveConnection, {
            address, apiKey: keyDraft || undefined,
          }))
          setKeyDraft(''); setAddressDirty(false)
        }
        const result = await call<TestResult>(RPC_ENDPOINTS.test)
        setNote(text.testOk(result.models))
        await load()
      })}>{text.test}</Button>
      <Button variant="primary" size="sm" disabled={Boolean(busy) || (!addressDirty && !keyDraft)} onClick={() => void action('save', async () => {
        refresh(await call<MagpieStatus>(RPC_ENDPOINTS.saveConnection, { address, apiKey: keyDraft || undefined }))
        setKeyDraft(''); setAddressDirty(false); setNote(text.saved)
      })}>{text.save}</Button>
      <Button variant="outline" size="sm" disabled={Boolean(busy) || status.syncing} onClick={() => void action('sync', async () => {
        refresh(await call<MagpieStatus>(RPC_ENDPOINTS.sync))
        setNote(text.saved)
      })}>{status.syncing ? text.syncing : text.syncNow}</Button>
    </div>

    <details className="mgp-advanced">
      <summary>{text.advanced}</summary>
      <div className="mgp-advanced-body">
        <label className="dsh-ui-field">
          <span className="dsh-ui-label">{text.defaultModel}</span>
          <select className="dsh-ui-select" value={status.options.defaultModel ?? ''} disabled={Boolean(busy)}
            onChange={event => void action('options', async () => {
              refresh(await call<MagpieStatus>(RPC_ENDPOINTS.setOptions, { defaultModel: event.target.value || null }))
            })}>
            <option value="">{text.keepCurrent}</option>
            {defaultChoices.map(id => <option key={id} value={id}>{modelLabel(id)}</option>)}
          </select>
          <span className="dsh-ui-help">{text.defaultModelHelp}</span>
        </label>

        <div className="dsh-ui-toggle-row">
          <span className="dsh-ui-toggle-text">
            <span className="dsh-ui-toggle-label">{text.webSearch}</span>
            <span className="dsh-ui-help">{text.webSearchHelp}</span>
          </span>
          <Switch checked={status.options.webSearch} disabled={Boolean(busy)} label={text.webSearch}
            onChange={next => void action('options', async () => {
              refresh(await call<MagpieStatus>(RPC_ENDPOINTS.setOptions, { webSearch: next }))
            })} />
        </div>
        {status.options.webSearch ? <label className="dsh-ui-field">
          <select className="dsh-ui-select" value={status.options.webSearchModel ?? ''} disabled={Boolean(busy)}
            onChange={event => void action('options', async () => {
              refresh(await call<MagpieStatus>(RPC_ENDPOINTS.setOptions, { webSearchModel: event.target.value || null }))
            })}>
            <option value="">{text.sameAsDefault}</option>
            {models.map(model => <option key={model.id} value={model.id}>{model.name ?? model.id}</option>)}
          </select>
        </label> : null}

        <div className="dsh-ui-toggle-row">
          <span className="dsh-ui-toggle-text">
            <span className="dsh-ui-toggle-label">{text.syncOnStart}</span>
            <span className="dsh-ui-help">{text.syncOnStartHelp}</span>
          </span>
          <Switch checked={status.options.syncOnStart} disabled={Boolean(busy)} label={text.syncOnStart}
            onChange={next => void action('options', async () => {
              refresh(await call<MagpieStatus>(RPC_ENDPOINTS.setOptions, { syncOnStart: next }))
            })} />
        </div>

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

        <div className="mgp-row">
          <div className="mgp-grow">
            <span className="dsh-ui-label">{text.disconnect}</span>
            <p className="dsh-ui-help">{text.disconnectHelp}</p>
          </div>
          <ConfirmButton label={text.disconnect} confirmLabel={text.confirmDisconnect} disabled={Boolean(busy)}
            onConfirm={() => void action('disconnect', async () => {
              refresh(await call<MagpieStatus>(RPC_ENDPOINTS.disconnect))
              setNote(text.saved)
            })} />
        </div>
      </div>
    </details>
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
  // The Models section owns this seat: the group appears under the provider
  // rows, and the host re-runs the registration whenever that section mounts.
  // A merged group seat carries no label — the host projects none — so the
  // group renders its own heading above.
  ctx.effect(() => client.slots.inject('settings.models.footer', () => client.slots.register(
    { name: 'settings.models.footer', id: 'magpie', order: 100 },
    () => <MagpieSettingsPage client={client} />,
  )), 'magpie.settings')
}
