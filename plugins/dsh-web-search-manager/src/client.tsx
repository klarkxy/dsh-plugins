import type { Context } from '@deepseek-ai/cordis'
import { Button, Input, SegmentedTabs, StateDot, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { PROVIDER_PRICING_CHECKED, searchProviderInfo } from './provider-info.ts'
import {
  WEB_SEARCH_RPC_CHANNEL, pickActiveSearch, resolveSearchOrder,
  type ProviderView, type RpcResult, type WebSettings, type WebStatus,
} from './contracts.ts'

export const name = 'dsh-web-search-manager-client'
export const inject = ['slots', 'connection', 'remote', 'remote.credentials', 'locale'] as const

interface Credentials {
  describe(refs: string[]): Promise<RpcResult<Record<string, { configured: boolean; writable: boolean; source?: string }>>>
  set(ref: string, value: string): Promise<RpcResult<unknown>>
  unset(ref: string): Promise<RpcResult<unknown>>
}
interface Client {
  connection: { rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<unknown> } }
  remote: { credentials: Credentials }
  /** Host UI language. Optional so bare test harnesses fall back to zh. */
  locale?: { getSnapshot(): { active: string }; subscribe(listener: () => void): () => void }
  slots: {
    inject(key: string, callback: () => unknown): () => void
    register(spec: { name: string; key: string }, render: unknown): () => void
  }
}

function unwrap<T>(result: RpcResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}
function editable(settings: WebSettings): Omit<WebSettings, 'revision'> {
  const { revision: _revision, ...rest } = settings
  return rest
}

export function isProviderOn(status: WebStatus, provider: ProviderView): boolean {
  const enabled = provider.kind === 'search' ? status.searchActive : status.fetchActive
  const selected = status.settings[provider.kind === 'search' ? 'searchProvider' : 'fetchProvider']
  return enabled && selected === provider.id
}

export function searchBackends(status: WebStatus): ProviderView[] {
  const all = status.providers.filter(provider => provider.kind === 'search')
  const order = resolveSearchOrder(
    all.map(provider => provider.id),
    status.settings,
    id => Boolean(all.find(provider => provider.id === id)?.credentialRef),
  )
  return order.flatMap(id => all.find(provider => provider.id === id) ?? [])
}

export function catalogSearchBackends(status: WebStatus): ProviderView[] {
  const enabled = searchBackends(status)
  const rest = status.providers.filter(provider => provider.kind === 'search' && !enabled.some(row => row.id === provider.id))
  return [...enabled, ...rest]
}

export function selectedSearchBackend(status: WebStatus): ProviderView | undefined {
  const backends = searchBackends(status)
  const id = pickActiveSearch(backends.map(provider => provider.id), id => Boolean(backends.find(provider => provider.id === id)?.configured))
  return backends.find(provider => provider.id === id)
}

function ExternalLink({ url, label, children }: { url: string; label: string; children: string }) {
  return <a href={url} target="_blank" rel="noreferrer noopener" aria-label={label}
    onClick={event => {
      const bridge = (globalThis as { dshWindow?: { openExternal?(url: string): void } }).dshWindow
      if (bridge?.openExternal) {
        event.preventDefault()
        bridge.openExternal(url)
      }
    }}>{children}</a>
}

export function canEnableSearch(
  order: readonly string[],
  providers: readonly ProviderView[],
  keys: Record<string, string>,
  writable: Record<string, boolean>,
): boolean {
  return order.some(id => {
    const provider = providers.find(item => item.kind === 'search' && item.id === id)
    if (!provider) return false
    if (provider.configured) return true
    const typed = (keys[provider.id] ?? '').trim()
    return Boolean(provider.credentialRef && typed && writable[provider.credentialRef] !== false)
  })
}

export function nextSearchEnabled(
  currentlyEnabled: boolean,
  nextOrder: readonly string[],
  providers: readonly ProviderView[],
  keys: Record<string, string>,
  writable: Record<string, boolean>,
): boolean {
  return currentlyEnabled && canEnableSearch(nextOrder, providers, keys, writable)
}

function ConfirmButton(props: { label: string; confirmLabel: string; disabled?: boolean; onConfirm(): void }) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  function disarm() {
    clearTimeout(timer.current)
    setArmed(false)
  }
  return <Button variant="outline" size="sm" className="ws-danger" disabled={props.disabled} data-armed={armed || undefined}
    onClick={() => {
      if (!armed) {
        setArmed(true)
        timer.current = setTimeout(() => setArmed(false), 3000)
        return
      }
      disarm()
      props.onConfirm()
    }}
    onBlur={disarm}>{armed ? props.confirmLabel : props.label}</Button>
}

const copy = {
  zh: {
    tabsLabel: '网络搜索设置', tabProviders: '搜索服务', tabLimits: '请求限制',
    loading: '正在读取设置…', loadFailed: '读取设置失败：', reconnect: '重新连接',
    failed: '操作失败。', readOnly: '凭据只读，无法保存。',
    keyDeleted: '已删除 Key。', keySaved: '已保存 Key。', saved: '已保存。',
    storageFailed: '保存失败，重新保存前网络访问已暂停。',
    empty: '暂无可用搜索后端，请启用一个供应商。', toolTitle: '联网搜索', needBackend: '需选择搜索服务并配置 Key。',
    backends: '搜索后端', dragPrefix: '拖动排序 ', dragHint: '拖动排序，或用上下方向键',
    inUse: '当前使用', signup: '去注册', pricing: '费用说明', website: '官网',
    needsKey: '待配置 Key', unavailable: '暂不可用', sharedKey: '与其他设置共用凭据',
    keyConfigured: '已配置，留空不替换', keyPlaceholder: '输入 API Key',
    saveKey: '保存 Key', deleteKey: '删除 Key', confirmDelete: '确认删除 Key？',
    test: '测试连接（可能计费）', unsaved: '有未保存的修改', save: '保存',
    saveHint: '开关与排序立即生效；Key 与限制需保存。',
    maxResults: '每条查询结果上限', maxQueries: '每次调用查询上限',
    timeoutMs: '请求超时（毫秒）', maxFetchChars: '正文字符上限',
  },
  en: {
    tabsLabel: 'Web search settings', tabProviders: 'Search services', tabLimits: 'Request limits',
    loading: 'Loading settings…', loadFailed: 'Could not load settings: ', reconnect: 'Reconnect',
    failed: 'Operation failed.', readOnly: 'Read-only credential; cannot save.',
    keyDeleted: 'Key deleted.', keySaved: 'Key saved.', saved: 'Saved.',
    storageFailed: 'Save failed; network access is paused until you save again.',
    empty: 'No search backends yet; enable a provider.', toolTitle: 'Web search', needBackend: 'Needs a search service with a key.',
    backends: 'Search backends', dragPrefix: 'Reorder ', dragHint: 'Drag to reorder, or use arrow keys',
    inUse: 'In use', signup: 'Sign up', pricing: 'Pricing', website: 'Website',
    needsKey: 'Key required', unavailable: 'Unavailable', sharedKey: 'Shares a credential with other settings',
    keyConfigured: 'Configured; empty keeps it', keyPlaceholder: 'Enter API key',
    saveKey: 'Save key', deleteKey: 'Delete key', confirmDelete: 'Delete this key?',
    test: 'Test connection (may be billed)', unsaved: 'Unsaved changes', save: 'Save',
    saveHint: 'Switches and order apply now; keys and limits need saving.',
    maxResults: 'Max results/query', maxQueries: 'Max queries/call',
    timeoutMs: 'Request timeout (ms)', maxFetchChars: 'Max text chars',
  },
} as const

type Copy = (typeof copy)['zh'] | (typeof copy)['en']

function movedText(locale: 'zh' | 'en', label: string, position: number): string {
  return locale === 'zh' ? `${label} 已移至第 ${position} 位` : `${label} moved to position ${position}`
}
function pricingCheckedText(locale: 'zh' | 'en', date: string): string {
  return locale === 'zh' ? `价格核对于 ${date}，额度与费用以供应商账户为准。` : `Prices checked on ${date}; your provider account is authoritative.`
}
function testOkText(locale: 'zh' | 'en', sources: number): string {
  return locale === 'zh' ? `连接正常，返回 ${sources} 条来源。` : `Connection OK: ${sources} sources returned.`
}
function limitInvalidText(locale: 'zh' | 'en', label: string, min: number, max: number): string {
  return locale === 'zh' ? `${label}需为 ${min}–${max} 之间的整数。` : `${label} must be a whole number from ${min} to ${max}.`
}

const LIMITS = [
  ['maxResults', 1, 20],
  ['maxQueries', 1, 5],
  ['timeoutMs', 1000, 120000],
  ['maxFetchChars', 1000, 200000],
] as const
type LimitKey = (typeof LIMITS)[number][0]

/** A limit field's raw text, or `undefined` when it is not a whole number in range. */
export function parseLimit(raw: string, min: number, max: number): number | undefined {
  const text = raw.trim()
  if (!/^\d+$/u.test(text)) return undefined
  const value = Number(text)
  return value >= min && value <= max ? value : undefined
}

/**
 * Settings written by an immediate action (a switch or a reorder). It keeps the
 * saved limits and never includes typed-but-unsaved keys or limit drafts.
 */
export function immediateUpdate(settings: WebSettings, on: boolean, order: string[]): Omit<WebSettings, 'revision'> {
  return { ...editable(settings), searchOrder: order, searchEnabled: on, fetchProvider: 'http', fetchEnabled: on }
}

function limitTexts(settings: WebSettings): Record<LimitKey, string> {
  return {
    maxResults: String(settings.maxResults), maxQueries: String(settings.maxQueries),
    timeoutMs: String(settings.timeoutMs), maxFetchChars: String(settings.maxFetchChars),
  }
}

function useHostLocale(client: Client): 'zh' | 'en' {
  const subscribe = useCallback((listener: () => void) => client.locale?.subscribe(listener) ?? (() => {}), [client])
  const snapshot = useCallback(() => client.locale?.getSnapshot().active ?? 'zh', [client])
  return String(useSyncExternalStore(subscribe, snapshot, snapshot)).startsWith('zh') ? 'zh' : 'en'
}

/** Keyboard reorders are batched: persist once the arrows stop for this long. */
const REORDER_DEBOUNCE_MS = 500

export function NetworkSearchSettings({ client }: { client: Client }) {
  const locale = useHostLocale(client)
  const text: Copy = copy[locale]
  const tabsId = useId()
  const [tab, setTab] = useState<'providers' | 'limits'>('providers')
  const [status, setStatus] = useState<WebStatus>()
  const [limitDraft, setLimitDraft] = useState<Record<LimitKey, string>>()
  const [invalid, setInvalid] = useState<Partial<Record<LimitKey, boolean>>>({})
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null)
  const [dragSource, setDragSource] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [sortAnnouncement, setSortAnnouncement] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [writable, setWritable] = useState<Record<string, boolean>>({})
  const statusRef = useRef(status)
  statusRef.current = status
  const pendingRef = useRef<string[] | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const handleRefs = useRef(new Map<string, HTMLButtonElement>())
  const refocusRef = useRef<string | null>(null)

  async function call<T>(endpoint: string, payload: unknown = {}): Promise<T> {
    return unwrap(await client.connection.rpc.call(WEB_SEARCH_RPC_CHANNEL, endpoint, payload) as RpcResult<T>)
  }
  function adopt(next: WebStatus, resetDraft = false) {
    const previous = statusRef.current
    statusRef.current = next
    setStatus(next)
    setLimitDraft(current => {
      const incoming = limitTexts(next.settings)
      if (!current || !previous || resetDraft) return incoming
      const baseline = limitTexts(previous.settings)
      return Object.fromEntries(LIMITS.map(([key]) =>
        [key, current[key] === baseline[key] ? incoming[key] : current[key]],
      )) as Record<LimitKey, string>
    })
    if (resetDraft) setInvalid({})
  }
  async function load(resetDraft = false) {
    const next = await call<WebStatus>('status')
    adopt(next, resetDraft)
    setLoadError('')
    const refs = next.providers.flatMap(provider => provider.credentialRef ? [provider.credentialRef] : [])
    if (refs.length) {
      const credentials = unwrap(await client.remote.credentials.describe(refs))
      setWritable(Object.fromEntries(Object.entries(credentials).map(([ref, value]) => [ref, value.writable])))
    }
    return next
  }
  useEffect(() => {
    void load().catch(cause => setLoadError(cause instanceof Error && cause.message ? cause.message : text.failed))
  }, [client])

  // A reorder still waiting for its debounce is written on unmount, not dropped.
  useEffect(() => () => {
    if (timerRef.current === undefined) return
    clearTimeout(timerRef.current)
    const current = statusRef.current
    const next = pendingRef.current
    if (current && next) {
      void call('update', { settings: immediateUpdate(current.settings, current.settings.searchEnabled, next), expectedRevision: current.settings.revision }).catch(() => {})
    }
  }, [])

  // Keep keyboard focus on the handle that was just moved.
  useLayoutEffect(() => {
    const id = refocusRef.current
    if (!id) return
    refocusRef.current = null
    const handle = handleRefs.current.get(id)
    if (handle && document.activeElement !== handle) handle.focus()
  })

  async function action(run: () => Promise<void>) {
    setBusy(true); setNote(''); setError('')
    try { await run() }
    catch (cause) { setError(cause instanceof Error && cause.message ? cause.message : text.failed); await load().catch(() => {}) }
    finally { setBusy(false) }
  }

  /** Switches and reorders: settings only, applied at once. */
  function runImmediate(on: boolean, order: string[]) {
    clearTimeout(timerRef.current); timerRef.current = undefined
    pendingRef.current = null
    void action(async () => {
      const current = statusRef.current
      if (!current) return
      const next = await call<WebStatus>('update', { settings: immediateUpdate(current.settings, on, order), expectedRevision: current.settings.revision })
      setStatus(next)
      await load()
    }).then(() => { if (pendingRef.current === null) setPendingOrder(null) })
  }

  /** Writes every typed key. Explicit actions only (Save, Save key, Test). */
  async function saveKeys(only?: ProviderView) {
    if (!status) return
    for (const provider of status.providers) {
      if (provider.kind !== 'search' || (only && provider.id !== only.id)) continue
      const snapshot = keys[provider.id] ?? ''
      const typed = snapshot.trim()
      if (!provider.credentialRef || !typed) continue
      if (writable[provider.credentialRef] === false) throw new Error(text.readOnly)
      unwrap(await client.remote.credentials.set(provider.credentialRef, typed))
      setKeys(current => current[provider.id] === snapshot ? { ...current, [provider.id]: '' } : current)
    }
  }

  async function removeKey(provider: ProviderView) {
    if (!provider.credentialRef || provider.credentialShared || !status) return
    unwrap(await client.remote.credentials.unset(provider.credentialRef))
    setKeys(current => ({ ...current, [provider.id]: '' }))
    await load()
    setNote(text.keyDeleted)
  }

  if (!status || !limitDraft) {
    return <section className="web-search-settings ws-root dsh-ui-panel">
      {loadError
        ? <p role="alert" className="dsh-ui-error">{text.loadFailed}{loadError}</p>
        : <p role="status" className="dsh-ui-hint">{text.loading}</p>}
      {loadError ? <div className="dsh-ui-actions"><Button variant="outline" size="sm" disabled={busy}
        onClick={() => void action(async () => { await load() })}>{text.reconnect}</Button></div> : null}
    </section>
  }

  const saved = status
  const savedOrder = searchBackends(saved).map(provider => provider.id)
  const order = pendingOrder ?? savedOrder
  const catalog = catalogSearchBackends(saved)
  const backends = [
    ...order.flatMap(id => catalog.find(provider => provider.id === id) ?? []),
    ...catalog.filter(provider => !order.includes(provider.id)),
  ]
  const selected = selectedSearchBackend(saved)
  const on = saved.settings.searchEnabled
  // Immediate switches never write typed keys, so only saved keys count here.
  const canEnable = canEnableSearch(order, saved.providers, {}, writable)
  const savedLimits = limitTexts(saved.settings)
  const limitsDirty = LIMITS.some(([key]) => limitDraft[key] !== savedLimits[key])
  const keysDirty = Object.values(keys).some(value => value.trim())
  const reordering = pendingOrder !== null

  function move(id: string, nextIndex: number, keyboard = false) {
    const index = order.indexOf(id)
    if (busy || index < 0 || nextIndex < 0 || nextIndex >= order.length || index === nextIndex) return
    const next = [...order]
    const [item] = next.splice(index, 1)
    next.splice(nextIndex, 0, item)
    pendingRef.current = next
    setPendingOrder(next)
    if (keyboard) refocusRef.current = id
    setSortAnnouncement(movedText(locale, backends.find(provider => provider.id === id)?.label ?? id, nextIndex + 1))
    clearTimeout(timerRef.current)
    const delay = keyboard ? REORDER_DEBOUNCE_MS : 0
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined
      const batched = pendingRef.current
      const current = statusRef.current
      if (batched && current) runImmediate(current.settings.searchEnabled, batched)
    }, delay)
  }

  function endDrag() {
    setDragSource(null)
    setDropTarget(null)
  }

  function saveAll() {
    const parsed: Partial<Record<LimitKey, number>> = {}
    const nextInvalid: Partial<Record<LimitKey, boolean>> = {}
    const messages: string[] = []
    for (const [key, min, max] of LIMITS) {
      const value = parseLimit(limitDraft![key], min, max)
      if (value === undefined) { nextInvalid[key] = true; messages.push(limitInvalidText(locale, text[key], min, max)) }
      else parsed[key] = value
    }
    setInvalid(nextInvalid)
    if (messages.length) { setNote(''); setError(messages.join(' ')); return }
    void action(async () => {
      await saveKeys()
      const current = statusRef.current!
      const next = await call<WebStatus>('update', {
        settings: { ...editable(current.settings), ...parsed, fetchProvider: 'http', fetchEnabled: current.settings.searchEnabled },
        expectedRevision: current.settings.revision,
      })
      adopt(next, true)
      await load()
      setNote(text.saved)
    })
  }

  return <section className="web-search-settings ws-root dsh-ui-panel" data-testid="web-search-settings">
    <SegmentedTabs<'providers' | 'limits'>
      value={tab}
      onChange={setTab}
      label={text.tabsLabel}
      items={[
        { value: 'providers', label: text.tabProviders, id: tabsId + '-providers-tab', panelId: tabsId + '-providers-panel' },
        { value: 'limits', label: text.tabLimits, id: tabsId + '-limits-tab', panelId: tabsId + '-limits-panel' },
      ]}
    />
    <span className="ws-sr-only" role="status" aria-live="polite">{sortAnnouncement}</span>
    {error && <p role="alert" className="dsh-ui-error">{error}</p>}
    {note && <p role="status" className="dsh-ui-notice">{note}</p>}
    {saved.storageFailed && <p role="alert" className="dsh-ui-banner dsh-ui-banner--danger">{text.storageFailed}</p>}
    <div role="tabpanel" id={tabsId + '-providers-panel'} aria-labelledby={tabsId + '-providers-tab'}
      hidden={tab !== 'providers'} tabIndex={0}>
      {backends.length === 0 ? <p className="dsh-ui-empty">{text.empty}</p> : <article
        className="web-search-card dsh-ui-card dsh-ui-card--flat"
        data-testid="web-search-tool"
        data-on={on ? 'true' : 'false'}>
        <header className="ws-card-head">
          <div>
            <h3 className="dsh-ui-title">{text.toolTitle}</h3>
            {!canEnable && <p className="dsh-ui-hint">{text.needBackend}</p>}
          </div>
          <Switch
            checked={on}
            label={text.toolTitle}
            disabled={busy || (!on && !canEnable)}
            onChange={next => runImmediate(next, order)}
          />
        </header>
        <ol className="web-search-rank" aria-label={text.backends}>
          {backends.map(provider => {
            const participating = order.includes(provider.id)
            const rank = order.indexOf(provider.id)
            const active = saved.searchActive && selected?.id === provider.id
            const info = searchProviderInfo(provider)
            const needsKey = Boolean(provider.credentialRef)
            const shared = Boolean(provider.credentialShared)
            const showKey = needsKey && participating && (!shared || !provider.configured)
            const canSort = participating && order.length > 1
            const readOnly = writable[provider.credentialRef ?? ''] === false
            const typedKey = (keys[provider.id] ?? '').trim()
            return <li key={provider.id} className={active ? 'is-active' : undefined} data-testid={`web-search-rank-${provider.id}`}
              data-dragging={dragSource === provider.id || undefined}
              data-drop={dropTarget === provider.id && dragSource ? (order.indexOf(dragSource) < rank ? 'after' : 'before') : undefined}
              onDragOver={event => {
                if (busy || !canSort || !dragSource || dragSource === provider.id) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setDropTarget(provider.id)
              }}
              onDragLeave={event => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null)
              }}
              onDrop={event => {
                if (busy || !canSort || !dragSource) return
                event.preventDefault()
                move(dragSource, rank)
                endDrag()
              }}>
              {canSort ? <Button variant="ghost" size="sm" className="web-search-drag-handle"
                ref={(element: HTMLButtonElement | null) => {
                  if (element) handleRefs.current.set(provider.id, element)
                  else handleRefs.current.delete(provider.id)
                }}
                icon={<svg width="16" height="20" viewBox="0 0 16 20" fill="currentColor" aria-hidden="true">
                  <circle cx="5" cy="5" r="1.5" /><circle cx="11" cy="5" r="1.5" />
                  <circle cx="5" cy="10" r="1.5" /><circle cx="11" cy="10" r="1.5" />
                  <circle cx="5" cy="15" r="1.5" /><circle cx="11" cy="15" r="1.5" />
                </svg>}
                draggable={!busy} aria-disabled={busy}
                aria-label={text.dragPrefix + provider.label}
                title={text.dragHint}
                onDragStart={event => {
                  if (busy) { event.preventDefault(); return }
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('application/x-dsh-search-provider', provider.id)
                  const row = event.currentTarget.closest('li')
                  if (row) event.dataTransfer.setDragImage(row, 16, 16)
                  setDragSource(provider.id)
                  setSortAnnouncement('')
                }}
                onDragEnd={endDrag}
                onKeyDown={event => {
                  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                  event.preventDefault()
                  move(provider.id, rank + (event.key === 'ArrowUp' ? -1 : 1), true)
                }} /> : <span className="web-search-rank-index">{participating ? rank + 1 : '—'}</span>}
              <div className="web-search-provider">
                <div className="web-search-provider-heading">
                  <strong className="dsh-ui-heading">{provider.label}</strong>
                  {active && <Tag tone="success">{text.inUse}</Tag>}
                  {provider.signupUrl && <ExternalLink url={provider.signupUrl} label={provider.label + ' ' + text.signup}>{text.signup}</ExternalLink>}
                </div>
                <div className="web-search-provider-info">
                  <p>{info.description}</p>
                  {/* Pricing stays visible even when a provider is off, so users can compare before enabling. */}
                  <p>{info.pricing}{info.pricingUrl && <> <ExternalLink url={info.pricingUrl}
                    label={provider.label + ' ' + text.pricing}>{provider.id === 'ddg' ? text.website : text.pricing}</ExternalLink></>}</p>
                </div>
                {participating && !provider.configured ? <p className="ws-provider-note">
                  <StateDot state="warning" />
                  <span>{needsKey ? text.needsKey : text.unavailable}</span>
                </p> : null}
                {shared && participating && <small className="dsh-ui-meta">{provider.credentialHint ?? text.sharedKey}</small>}
                {showKey ? <label className="dsh-ui-field">
                  <span className="dsh-ui-label">API Key</span>
                  <Input className="ws-input" type="password" autoComplete="off" spellCheck={false}
                    disabled={busy || readOnly}
                    value={keys[provider.id] ?? ''}
                    placeholder={provider.configured ? text.keyConfigured : text.keyPlaceholder}
                    onChange={event => setKeys(current => ({ ...current, [provider.id]: event.target.value }))} />
                </label> : null}
                {showKey || (needsKey && !shared && provider.configured) ? <div className="dsh-ui-actions">
                  {showKey ? <Button variant="outline" size="sm" disabled={busy || readOnly || !typedKey}
                    onClick={() => void action(async () => { await saveKeys(provider); await load(); setNote(text.keySaved) })}>
                    {text.saveKey}</Button> : null}
                  {needsKey && !shared && provider.configured ? <ConfirmButton
                    disabled={busy || readOnly}
                    label={text.deleteKey} confirmLabel={text.confirmDelete}
                    onConfirm={() => void action(() => removeKey(provider))} /> : null}
                </div> : null}
              </div>
              <div className="web-search-rank-move">
                <Switch
                  checked={participating}
                  label={provider.label}
                  disabled={busy}
                  onChange={next => {
                    const following = next ? [...order, provider.id] : order.filter(id => id !== provider.id)
                    runImmediate(nextSearchEnabled(saved.settings.searchEnabled, following, saved.providers, {}, writable), following)
                  }} />
              </div>
            </li>
          })}
        </ol>
        <p className="dsh-ui-hint">{pricingCheckedText(locale, PROVIDER_PRICING_CHECKED)}</p>
        {on ? <div className="dsh-ui-actions">
          <Button variant="outline" size="md" disabled={busy || reordering} onClick={() => void action(async () => {
            // Testing is explicit, so typed keys are saved first and the request uses them.
            await saveKeys()
            const result = await call<{ sources: number }>('test')
            await load()
            setNote(testOkText(locale, result.sources))
          })}>{text.test}</Button>
        </div> : null}
      </article>}
    </div>
    <div role="tabpanel" id={tabsId + '-limits-panel'} aria-labelledby={tabsId + '-limits-tab'}
      hidden={tab !== 'limits'} tabIndex={0}>
      <fieldset className="web-search-limits" disabled={busy || reordering} aria-label={text.tabLimits}>
        {LIMITS.map(([key, min, max]) => (
          <label key={key} className="ws-limit">
            <span className="dsh-ui-label">{text[key]}</span>
            <Input className="ws-input" type="number" min={min} max={max} step={1} value={limitDraft[key]}
              aria-invalid={invalid[key] || undefined}
              onChange={event => {
                const raw = event.target.value
                setLimitDraft(current => current ? { ...current, [key]: raw } : current)
                setInvalid(current => ({ ...current, [key]: false }))
              }}
              onBlur={() => setInvalid(current => ({ ...current, [key]: parseLimit(limitDraft[key], min, max) === undefined }))} />
            {invalid[key] ? <span className="dsh-ui-error">{limitInvalidText(locale, text[key], min, max)}</span> : null}
          </label>
        ))}
      </fieldset>
    </div>
    <div className="dsh-ui-actions dsh-ui-actions-end">
      <span className="dsh-ui-meta">{limitsDirty || keysDirty ? text.unsaved : text.saveHint}</span>
      <Button variant="primary" size="md" disabled={busy || reordering} onClick={saveAll}>{text.save}</Button>
    </div>
  </section>
}

/* The contract owns the type tiers, the card, the field, the button row, the
 * notice, the focus ring and the state colours. What is left is this panel's own
 * geometry: the reading width, the ranked three-column row, the drag affordance,
 * the drop indicator, the screen-reader-only announcer and the limits grid. */
const styles = `${officialUiCss('ws-root')}
.ws-root { max-width: 760px; }
.ws-card-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding-bottom: 8px; }
.ws-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
.ws-provider-note { display: flex; align-items: center; gap: 6px; }
.web-search-provider { display: grid; gap: 8px; min-width: 0; }
.web-search-provider-info { display: grid; gap: 3px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.web-search-provider-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; min-height: 24px; }
.web-search-settings a { color: var(--dsw-alias-state-business-primary); font-size: 12px; line-height: 18px; text-underline-offset: 3px; }
/* The primitive renders a 32px control in an inline-flex wrapper; a settings
 * field needs it to fill the column it sits in. */
.ws-input { width: 100%; }
.web-search-rank { margin: 0; padding: 0; list-style: none; }
.web-search-rank li {
  position: relative;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
  padding: 14px 0;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}
.web-search-settings button.web-search-drag-handle {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  min-height: 24px;
  padding: 0;
  cursor: grab;
  opacity: 0.65;
}
.web-search-settings button.web-search-drag-handle:hover { opacity: 1; }
.web-search-settings button.web-search-drag-handle:active { cursor: grabbing; }
.web-search-settings button.web-search-drag-handle[aria-disabled='true'] { cursor: wait; opacity: 0.4; }
.web-search-rank li[data-dragging] { opacity: 0.45; }
.web-search-rank li[data-drop]::after { content: ''; position: absolute; left: 0; right: 0; height: 2px; background: var(--dsw-alias-state-business-primary); pointer-events: none; }
.web-search-rank li[data-drop='before']::after { top: -1px; }
.web-search-rank li[data-drop='after']::after { bottom: -1px; }
.web-search-rank-index { color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; line-height: 24px; }
.web-search-rank-move { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; justify-content: flex-end; padding-top: 2px; }
.web-search-limits { margin: 0; border: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 20px; }
/* A two-column grid, so these fields keep the contract's caption and the
 * primitive's control and only own their vertical rhythm — a stacked list is
 * what draws the hairline between fields, and there is nothing to separate. */
.ws-limit { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.ws-danger:hover:not(:disabled),
.ws-danger[data-armed] { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
.ws-danger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger); }
@media (max-width: 560px) { .web-search-rank-move { flex-direction: column; align-items: flex-end; } .web-search-limits { grid-template-columns: minmax(0, 1fr); } }
`

export function apply(ctx: Context): void {
  const client = ctx as unknown as Client
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-plugin', '@klarkxy/dsh-web-search-manager'); style.textContent = styles
    style.dataset.dshWebSearch = ''; document.head.appendChild(style)
    return () => style.remove()
  }, 'web-search-manager.styles')
  ctx.effect(() => client.slots.inject('plugins.bundle.config', () => client.slots.register({
    name: 'plugins.bundle.config', key: '@klarkxy/dsh-web-search-manager',
  }, () => <NetworkSearchSettings client={client} />)), 'web-search-manager.settings')
}
