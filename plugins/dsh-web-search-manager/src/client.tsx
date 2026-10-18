import { localErrorText } from './client-error.ts'
import type { Context } from '@deepseek-ai/cordis'
import { Button, Input, SegmentedTabs, StateDot, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'
import { createPluginReadGate } from '@klarkxy/dsh-plugin-kit/client-utils'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { PROVIDER_PRICING_CHECKED, providerDisplayLabel, searchProviderInfo, usesBundledPricing } from './provider-info.ts'
import {
  WEB_SEARCH_RPC_CHANNEL, WEB_MANAGER_OWNER, safeConfigurationUrl,
  providerKey, type ProviderKind, type ProviderView, type RpcResult, type WebSettings, type WebStatus,
} from './contracts.ts'

export const name = 'dsh-web-search-manager-client'
export const inject = ['slots', 'connection', 'remote', 'remote.credentials', 'locale'] as const

interface Credentials {
  describe(refs: string[]): Promise<RpcResult<Record<string, { configured: boolean; writable: boolean; source?: string }>>>
  set(ref: string, value: string): Promise<RpcResult<unknown>>
  unset(ref: string): Promise<RpcResult<unknown>>
}
interface Client {
  connection: { rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<unknown> }; generation?: { subscribe(listener: () => void): () => void } }
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

export const STATUS_REFRESH_MS = 3000

export function isPageHidden(hidden?: boolean): boolean {
  if (hidden) return true
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

export function canStartStatusRead(input: {
  source: 'user' | 'poll'
  mounted: boolean
  hidden: boolean
  busy: boolean
  reordering: boolean
  reading: boolean
}): boolean {
  if (!input.mounted) return false
  if (input.source === 'poll') {
    return !input.hidden && !input.busy && !input.reordering && !input.reading
  }
  return true
}

export function isExternalConfigurationUrl(url: string): boolean {
  return /^https:\/\//i.test(url)
}

export function shouldApplyPolledStatus(input: {
  requestId: number
  latestRequestId: number
  busy: boolean
  reordering: boolean
  hidden: boolean
  currentRevision?: number
  incomingRevision: number
}): boolean {
  if (input.hidden || input.busy || input.reordering) return false
  if (input.requestId !== input.latestRequestId) return false
  if (input.currentRevision !== undefined && input.incomingRevision < input.currentRevision) return false
  return true
}

export function bindStatusRefresh(options: {
  intervalMs?: number
  isHidden: () => boolean
  tick: () => Promise<void>
  setIntervalFn?: typeof setInterval
  clearIntervalFn?: typeof clearInterval
  addListener?: (type: string, listener: () => void) => void
  removeListener?: (type: string, listener: () => void) => void
}): () => void {
  const intervalMs = options.intervalMs ?? STATUS_REFRESH_MS
  let inFlight = false
  let stopped = false
  const run = async () => {
    if (stopped || inFlight || options.isHidden()) return
    inFlight = true
    try { await options.tick() }
    finally { inFlight = false }
  }
  const timer = (options.setIntervalFn ?? setInterval)(() => { void run() }, intervalMs)
  const onVisible = () => { if (!options.isHidden()) void run() }
  const add = options.addListener ?? ((type, listener) => {
    if (typeof document !== 'undefined') document.addEventListener(type, listener)
  })
  const remove = options.removeListener ?? ((type, listener) => {
    if (typeof document !== 'undefined') document.removeEventListener(type, listener)
  })
  add('visibilitychange', onVisible)
  return () => {
    stopped = true
    ;(options.clearIntervalFn ?? clearInterval)(timer)
    remove('visibilitychange', onVisible)
  }
}

export function isProviderOn(status: WebStatus, provider: ProviderView): boolean {
  if (provider.kind === 'fetch') {
    return status.fetchActive && selectedBackend(status, 'fetch')?.id === provider.id
  }
  return status.searchActive && selectedSearchBackend(status)?.id === provider.id
}

export function dormantSearchPlaceholder(id: string): ProviderView { return dormantPlaceholder(id, 'search') }
function dormantPlaceholder(id: string, kind: ProviderKind): ProviderView {
  return { id, label: id, description: '', billing: 'unknown', kind, configured: false, calls: 0, failures: 0, configurationOwned: false }
}
function isRegistered(status: WebStatus, id: string, kind: ProviderKind): boolean {
  return status.providers.some(provider => provider.kind === kind && provider.id === id)
}
export function isRegisteredSearch(status: WebStatus, id: string): boolean { return isRegistered(status, id, 'search') }
function providerOrder(settings: WebSettings, kind: ProviderKind): string[] {
  return kind === 'search' ? settings.searchOrder : settings.fetchOrder
}
function catalogBackends(status: WebStatus, kind: ProviderKind): ProviderView[] {
  const byId = new Map(status.providers.filter(provider => provider.kind === kind).map(provider => [provider.id, provider]))
  const rows: ProviderView[] = []
  const seen = new Set<string>()
  for (const id of providerOrder(status.settings, kind)) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    rows.push(byId.get(id) ?? dormantPlaceholder(id, kind))
  }
  for (const provider of byId.values()) if (!seen.has(provider.id)) rows.push(provider)
  return rows
}
export function catalogSearchBackends(status: WebStatus): ProviderView[] { return catalogBackends(status, 'search') }
export function searchBackends(status: WebStatus): ProviderView[] {
  return catalogSearchBackends(status).filter(provider => status.settings.searchOrder.includes(provider.id))
}
function selectedBackend(status: WebStatus, kind: ProviderKind): ProviderView | undefined {
  return providerOrder(status.settings, kind).flatMap(id => status.providers.find(provider => provider.kind === kind && provider.id === id) ?? []).find(provider => provider.configured)
}
export function selectedSearchBackend(status: WebStatus): ProviderView | undefined { return selectedBackend(status, 'search') }
export function droppedDormantIds(settings: WebSettings, order: readonly string[], providers: readonly ProviderView[], kind: ProviderKind = 'search'): string[] {
  const known = new Set(providers.filter(provider => provider.kind === kind).map(provider => provider.id))
  return [...new Set(providerOrder(settings, kind).filter(id => id && !known.has(id) && !order.includes(id)))]
}

export type ConfigurationAccess =
  | { kind: 'owned' }
  | { kind: 'link'; url: string }
  | { kind: 'owner'; name: string }
  | { kind: 'unknown' }

export function configurationAccess(provider: ProviderView): ConfigurationAccess {
  if (ownsProviderConfiguration(provider)) return { kind: 'owned' }
  const url = safeConfigurationUrl(provider.configurationUrl)
  if (url) return { kind: 'link', url }
  if (provider.configurationOwner?.trim()) return { kind: 'owner', name: provider.configurationOwner }
  return { kind: 'unknown' }
}

function AppLink({ url, label, children }: { url: string; label: string; children: string }) {
  const external = isExternalConfigurationUrl(url)
  return <a href={url} {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})} aria-label={label}
    onClick={event => {
      if (!external) return
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
    return Boolean(ownsProviderConfiguration(provider) && provider.credentialRef && typed && writable[provider.credentialRef] !== false)
  })
}

export function ownsProviderConfiguration(provider: Pick<ProviderView, 'configurationOwned' | 'configurationOwner'>): boolean {
  if (typeof provider.configurationOwned === 'boolean') return provider.configurationOwned
  return !provider.configurationOwner || provider.configurationOwner === WEB_MANAGER_OWNER
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
    inUse: '当前使用', available: '可用', unavailable: '暂不可用', dormant: '未加载，保留选择',
    signup: '去注册', pricing: '费用说明', website: '官网', openConfig: '打开配置',
    needsKey: '待配置 Key', sharedKey: '与其他设置共用凭据',
    keyConfigured: '已配置，留空不替换', keyPlaceholder: '输入 API Key',
    saveKey: '保存 Key', deleteKey: '删除 Key', confirmDelete: '确认删除 Key？',
    test: '测试连接（可能计费）', unsaved: '有未保存的修改', save: '保存',
    saveHint: '开关与排序立即生效；Key 与限制需保存。',
    maxResults: '每条查询结果上限', maxQueries: '每次调用查询上限',
    timeoutMs: '请求超时（毫秒）', maxFetchChars: '正文字符上限',
    fetchTitle: '网页读取', fetchProvider: '读取服务', fetchBackends: '读取后端', needFetchBackend: '需选择并配置读取服务。', ownerSettings: '配置入口：',
    unknownOwner: '请在服务所属插件中配置',
  },
  en: {
    tabsLabel: 'Web search settings', tabProviders: 'Search services', tabLimits: 'Request limits',
    loading: 'Loading settings…', loadFailed: 'Could not load settings: ', reconnect: 'Reconnect',
    failed: 'Operation failed.', readOnly: 'Read-only credential; cannot save.',
    keyDeleted: 'Key deleted.', keySaved: 'Key saved.', saved: 'Saved.',
    storageFailed: 'Save failed; network access is paused until you save again.',
    empty: 'No search backends yet; enable a provider.', toolTitle: 'Web search', needBackend: 'Needs a search service with a key.',
    backends: 'Search backends', dragPrefix: 'Reorder ', dragHint: 'Drag to reorder, or use arrow keys',
    inUse: 'In use', available: 'Available', unavailable: 'Unavailable', dormant: 'Not loaded; selection kept',
    signup: 'Sign up', pricing: 'Pricing', website: 'Website', openConfig: 'Open configuration',
    needsKey: 'Key required', sharedKey: 'Shares a credential with other settings',
    keyConfigured: 'Configured; empty keeps it', keyPlaceholder: 'Enter API key',
    saveKey: 'Save key', deleteKey: 'Delete key', confirmDelete: 'Delete this key?',
    test: 'Test connection (may be billed)', unsaved: 'Unsaved changes', save: 'Save',
    saveHint: 'Switches and order apply now; keys and limits need saving.',
    maxResults: 'Max results/query', maxQueries: 'Max queries/call',
    timeoutMs: 'Request timeout (ms)', maxFetchChars: 'Max text chars',
    fetchTitle: 'Read web pages', fetchProvider: 'Fetch service', fetchBackends: 'Fetch backends', needFetchBackend: 'Choose and configure a fetch service.', ownerSettings: 'Configure in: ',
    unknownOwner: 'Configure this service in its plugin',
  },
} as const

type Copy = (typeof copy)['zh'] | (typeof copy)['en']

// Keep action outcomes as data so a language switch also updates existing notices.
type UiMessage = string | { key: keyof Copy } | { sources: number } | { moved: string; kind: ProviderKind; position: number } | { invalid: LimitKey[] }
class UiError extends Error {
  constructor(readonly key: keyof Copy) { super(key) }
}

function uiMessage(message: UiMessage, locale: 'zh' | 'en', providers: ProviderView[] = []): string {
  if (typeof message === 'string') return localErrorText(message, locale)
  if ('key' in message) return copy[locale][message.key]
  if ('sources' in message) return testOkText(locale, message.sources)
  if ('moved' in message) {
    const provider = providers.find(item => item.id === message.moved && item.kind === message.kind)
    return movedText(locale, provider ? providerDisplayLabel(provider, locale) : message.moved, message.position)
  }
  return message.invalid.map(key => {
    const [, min, max] = LIMITS.find(item => item[0] === key)!
    return limitInvalidText(locale, copy[locale][key], min, max)
  }).join(' ')
}

function movedText(locale: 'zh' | 'en', label: string, position: number): string {
  return locale === 'zh' ? `${label} 已移至第 ${position} 位` : `${label} moved to position ${position}`
}
function pricingCheckedText(locale: 'zh' | 'en', date: string): string {
  return locale === 'zh'
    ? `内置适配器价格核对于 ${date}，额度与费用以供应商账户为准。`
    : `Bundled adapter prices checked on ${date}; your provider account is authoritative.`
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
export function immediateUpdate(
  settings: WebSettings,
  on: boolean,
  order: string[],
  providers?: readonly ProviderView[],
  remove: readonly string[] = [],
  kind: ProviderKind = 'search',
): Omit<WebSettings, 'revision'> {
  let searchOrder = order
  if (providers) {
    const known = new Set(providers.filter(provider => provider.kind === kind).map(provider => provider.id))
    const removed = new Set(remove)
    const following = order.filter(id => !removed.has(id))
    if (following.some(id => !known.has(id))) searchOrder = following
    else {
      searchOrder = providerOrder(settings, kind).flatMap(id => {
        if (removed.has(id)) return []
        return known.has(id) ? following.splice(0, 1) : [id]
      })
      searchOrder.push(...following)
    }
  }
  return { ...editable(settings), ...(kind === 'search' ? { searchOrder, searchEnabled: on } : { fetchOrder: searchOrder, fetchEnabled: on }) }
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
type PendingOrder = { kind: ProviderKind; order: string[] }

export function NetworkSearchSettings({ client, hidden }: { client: Client; hidden?: boolean }) {
  const locale = useHostLocale(client)
  const text: Copy = copy[locale]
  const tabsId = useId()
  const [tab, setTab] = useState<'providers' | 'limits'>('providers')
  const [status, setStatus] = useState<WebStatus>()
  const [limitDraft, setLimitDraft] = useState<Record<LimitKey, string>>()
  const [invalid, setInvalid] = useState<Partial<Record<LimitKey, boolean>>>({})
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [pendingOrder, setPendingOrder] = useState<PendingOrder | null>(null)
  const [dragSource, setDragSource] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [sortAnnouncement, setSortAnnouncement] = useState<UiMessage>('')
  const [note, setNote] = useState<UiMessage>('')
  const [error, setError] = useState<UiMessage>('')
  const [loadError, setLoadError] = useState<UiMessage>('')
  const [writable, setWritable] = useState<Record<string, boolean>>({})
  const statusRef = useRef(status)
  statusRef.current = status
  const pendingRef = useRef<PendingOrder | null>(null)
  const dragRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const handleRefs = useRef(new Map<string, HTMLButtonElement>())
  const refocusRef = useRef<string | null>(null)
  const busyRef = useRef(false)
  const hiddenRef = useRef(hidden)
  hiddenRef.current = hidden
  const requestSeq = useRef(0)
  const mountedRef = useRef(true)
  const readingRef = useRef(false)
  const readingRequest = useRef(0)
  const statusRead = useRef(Promise.resolve())
  const readGateRef = useRef<ReturnType<typeof createPluginReadGate>>(undefined)
  if (!readGateRef.current) readGateRef.current = createPluginReadGate()
  const readGate = readGateRef.current

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
  function pollBlocked(): boolean {
    return !canStartStatusRead({
      source: 'poll',
      mounted: mountedRef.current,
      hidden: isPageHidden(hiddenRef.current),
      busy: busyRef.current,
      reordering: pendingRef.current !== null || dragRef.current !== null,
      reading: readingRef.current,
    })
  }
  async function describeOwned(next: WebStatus, mine: number) {
    const refs = next.providers.flatMap(provider => ownsProviderConfiguration(provider) && provider.credentialRef ? [provider.credentialRef] : [])
    if (!refs.length) return
    const credentials = unwrap(await readGate.run(() => client.remote.credentials.describe(refs)))
    if (!mountedRef.current || mine !== requestSeq.current) return
    setWritable(Object.fromEntries(Object.entries(credentials).map(([ref, value]) => [ref, value.writable])))
  }
  async function load(resetDraft = false, source: 'user' | 'poll' = 'user') {
    if (source === 'poll' && !readGate.canRead()) return
    if (source === 'user') { readGate.reset(); requestSeq.current += 1 }
    while (readingRef.current) {
      if (source === 'poll' || !mountedRef.current) return
      await statusRead.current
    }
    if (!mountedRef.current) return
    if (source === 'poll' && pollBlocked()) return
    const mine = ++requestSeq.current
    readingRef.current = true
    readingRequest.current = mine
    let release = () => {}
    statusRead.current = new Promise<void>(resolve => { release = resolve })
    try {
      const next = unwrap(await readGate.run(() => client.connection.rpc.call(WEB_SEARCH_RPC_CHANNEL, 'status', {})) as RpcResult<WebStatus>)
      if (!mountedRef.current || mine !== requestSeq.current) return next
      if (source === 'poll' && !shouldApplyPolledStatus({
        requestId: mine, latestRequestId: requestSeq.current,
        busy: busyRef.current, reordering: pendingRef.current !== null || dragRef.current !== null,
        hidden: isPageHidden(hiddenRef.current),
        currentRevision: statusRef.current?.settings.revision,
        incomingRevision: next.settings.revision,
      })) return next
      adopt(next, resetDraft)
      setLoadError('')
      await describeOwned(next, mine)
      return next
    } catch (cause) {
      if (!mountedRef.current || mine !== requestSeq.current) return
      setLoadError(cause instanceof Error && cause.message ? cause.message : { key: 'failed' })
      if (source === 'poll') return
      throw cause
    } finally {
      if (readingRequest.current === mine) readingRef.current = false
      release()
    }
  }
  useEffect(() => {
    mountedRef.current = true
    readGate.reset()
    void load().catch(cause => setLoadError(cause instanceof Error && cause.message ? cause.message : { key: 'failed' }))
    const bind = () => bindStatusRefresh({
      isHidden: () => isPageHidden(hiddenRef.current),
      tick: async () => { await load(false, 'poll').catch(() => {}) },
    })
    let stop = bind()
    const stopConnection = client.connection.generation?.subscribe(() => {
      readGate.reset()
      requestSeq.current += 1
      readingRef.current = false
      statusRead.current = Promise.resolve()
      stop()
      stop = bind()
      void load(false, 'poll')
    })
    return () => {
      mountedRef.current = false
      readGate.reset()
      requestSeq.current += 1
      stop()
      stopConnection?.()
      if (timerRef.current === undefined) return
      clearTimeout(timerRef.current)
      const current = statusRef.current
      const next = pendingRef.current
      if (current && next) {
        void call('update', { settings: immediateUpdate(current.settings, next.kind === 'search' ? current.settings.searchEnabled : current.settings.fetchEnabled, next.order, current.providers, [], next.kind), expectedRevision: current.settings.revision }).catch(() => {})
      }
    }
  }, [client])

  useEffect(() => {
    if (hidden) return
    if (!statusRef.current) return
    void load(false, 'poll').catch(() => {})
  }, [hidden])

  // Keep keyboard focus on the handle that was just moved.
  useLayoutEffect(() => {
    const id = refocusRef.current
    if (!id) return
    refocusRef.current = null
    const handle = handleRefs.current.get(id)
    if (handle && document.activeElement !== handle) handle.focus()
  })

  async function action(run: () => Promise<void>) {
    if (busyRef.current) return
    readGate.reset()
    requestSeq.current += 1
    busyRef.current = true
    setBusy(true); setNote(''); setError('')
    try { await run() }
    catch (cause) { setError(cause instanceof UiError ? { key: cause.key } : cause instanceof Error && cause.message ? cause.message : { key: 'failed' }); await load().catch(() => {}) }
    finally { busyRef.current = false; setBusy(false) }
  }

  /** Switches and reorders: settings only, applied at once. */
  function runImmediate(on: boolean, order: string[], remove: readonly string[] = [], kind: ProviderKind = 'search') {
    clearTimeout(timerRef.current); timerRef.current = undefined
    pendingRef.current = null
    void action(async () => {
      const current = statusRef.current
      if (!current) return
      const next = await call<WebStatus>('update', {
        settings: immediateUpdate(current.settings, on, order, current.providers, remove, kind),
        expectedRevision: current.settings.revision,
      })
      adopt(next)
      await load()
    }).then(() => { if (pendingRef.current === null) setPendingOrder(null) })
  }

  /** Writes every typed key. Explicit actions only (Save, Save key, Test). */
  async function saveKeys(only?: ProviderView) {
    if (!status) return
    for (const provider of status.providers) {
      if (only && providerKey(provider.kind, provider.id) !== providerKey(only.kind, only.id)) continue
      const snapshot = keys[providerKey(provider.kind, provider.id)] ?? ''
      const typed = snapshot.trim()
      if (!ownsProviderConfiguration(provider) || !provider.credentialRef || !typed) continue
      if (writable[provider.credentialRef] === false) throw new UiError('readOnly')
      unwrap(await client.remote.credentials.set(provider.credentialRef, typed))
      setKeys(current => current[providerKey(provider.kind, provider.id)] === snapshot ? { ...current, [providerKey(provider.kind, provider.id)]: '' } : current)
    }
  }

  async function saveKeysForKind(kind: ProviderKind) {
    for (const provider of statusRef.current?.providers ?? []) if (provider.kind === kind) await saveKeys(provider)
  }

  async function removeKey(provider: ProviderView) {
    if (!ownsProviderConfiguration(provider) || !provider.credentialRef || provider.credentialShared || !status) return
    unwrap(await client.remote.credentials.unset(provider.credentialRef))
    setKeys(current => ({ ...current, [providerKey(provider.kind, provider.id)]: '' }))
    await load()
    setNote({ key: 'keyDeleted' })
  }

  if (!status || !limitDraft) {
    return <section className="web-search-settings ws-root dsh-ui-panel">
      {loadError
        ? <p role="alert" className="dsh-ui-error">{text.loadFailed}{uiMessage(loadError, locale, status?.providers)}</p>
        : <p role="status" className="dsh-ui-hint">{text.loading}</p>}
      {loadError ? <div className="dsh-ui-actions"><Button variant="outline" size="sm" disabled={busy}
        onClick={() => void action(async () => { await load() })}>{text.reconnect}</Button></div> : null}
    </section>
  }

  const saved = status
  const savedLimits = limitTexts(saved.settings)
  const limitsDirty = LIMITS.some(([key]) => limitDraft[key] !== savedLimits[key])
  const keysDirty = Object.values(keys).some(value => value.trim())
  const reordering = pendingOrder !== null || dragSource !== null

  function move(kind: ProviderKind, id: string, nextIndex: number, keyboard = false) {
    if (pendingRef.current && pendingRef.current.kind !== kind) return
    const order = pendingRef.current?.order ?? providerOrder(statusRef.current!.settings, kind)
    const index = order.indexOf(id)
    if (busy || index < 0 || nextIndex < 0 || nextIndex >= order.length || index === nextIndex) return
    const next = [...order]
    const [item] = next.splice(index, 1)
    next.splice(nextIndex, 0, item)
    pendingRef.current = { kind, order: next }
    setPendingOrder({ kind, order: next })
    if (keyboard) refocusRef.current = providerKey(kind, id)
    setSortAnnouncement({ moved: id, kind, position: nextIndex + 1 })
    clearTimeout(timerRef.current)
    const delay = keyboard ? REORDER_DEBOUNCE_MS : 0
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined
      const batched = pendingRef.current
      const current = statusRef.current
      if (batched && current) runImmediate(batched.kind === 'search' ? current.settings.searchEnabled : current.settings.fetchEnabled, batched.order, [], batched.kind)
    }, delay)
  }

  function endDrag() {
    dragRef.current = null
    setDragSource(null)
    setDropTarget(null)
  }

  function saveAll() {
    const parsed: Partial<Record<LimitKey, number>> = {}
    const nextInvalid: Partial<Record<LimitKey, boolean>> = {}
    const messages: LimitKey[] = []
    for (const [key, min, max] of LIMITS) {
      const value = parseLimit(limitDraft![key], min, max)
      if (value === undefined) { nextInvalid[key] = true; messages.push(key) }
      else parsed[key] = value
    }
    setInvalid(nextInvalid)
    if (messages.length) { setNote(''); setError({ invalid: messages }); return }
    void action(async () => {
      await saveKeys()
      const current = statusRef.current!
      const next = await call<WebStatus>('update', {
        settings: { ...editable(current.settings), ...parsed },
        expectedRevision: current.settings.revision,
      })
      adopt(next, true)
      await load()
      setNote({ key: 'saved' })
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
    <span className="ws-sr-only" role="status" aria-live="polite">{uiMessage(sortAnnouncement, locale, saved.providers)}</span>
    {error && <p role="alert" className="dsh-ui-error">{uiMessage(error, locale, saved.providers)}</p>}
    {loadError ? <div className="dsh-ui-stack">
      <p role="alert" className="dsh-ui-error">{text.loadFailed}{uiMessage(loadError, locale, status?.providers)}</p>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void action(async () => { await load() })}>{text.reconnect}</Button>
    </div> : null}
    {note && <p role="status" className="dsh-ui-notice">{uiMessage(note, locale, saved.providers)}</p>}
    {saved.storageFailed && <p role="alert" className="dsh-ui-banner dsh-ui-banner--danger">{text.storageFailed}</p>}
    <div role="tabpanel" id={tabsId + '-providers-panel'} aria-labelledby={tabsId + '-providers-tab'}
      hidden={tab !== 'providers'} tabIndex={0}>
      {(['search', 'fetch'] as const).map(kind => {
        const order = pendingOrder?.kind === kind ? pendingOrder.order : providerOrder(saved.settings, kind)
        const catalog = catalogBackends(saved, kind)
        const backends = [...order.flatMap(id => catalog.find(provider => provider.id === id) ?? []), ...catalog.filter(provider => !order.includes(provider.id))]
        const selected = selectedBackend(saved, kind)
        const on = kind === 'search' ? saved.settings.searchEnabled : saved.settings.fetchEnabled
        const canEnable = order.some(id => saved.providers.some(provider => provider.kind === kind && provider.id === id && provider.configured))
        const sortingOther = pendingOrder !== null && pendingOrder.kind !== kind
        const locked = busy || sortingOther || Boolean(dragSource && !dragSource.startsWith(kind + ':'))
        const title = kind === 'search' ? text.toolTitle : text.fetchTitle
        return backends.length === 0 ? (kind === 'search' ? <p key={kind} className="dsh-ui-empty">{text.empty}</p> : null) : <article key={kind}
        className="web-search-card dsh-ui-card dsh-ui-card--flat"
        data-testid={kind === 'search' ? 'web-search-tool' : 'web-search-fetch'}
        data-on={on ? 'true' : 'false'}>
        <header className="ws-card-head">
          <div>
            <h3 className="dsh-ui-title">{title}</h3>
            {!canEnable && <p className="dsh-ui-hint">{kind === 'search' ? text.needBackend : text.needFetchBackend}</p>}
          </div>
          <Switch
            checked={on}
            label={title}
            disabled={locked || dragSource !== null || (!on && !canEnable)}
            onChange={next => runImmediate(next, order, [], kind)}
          />
        </header>
        <ol className="web-search-rank" aria-label={kind === 'search' ? text.backends : text.fetchBackends}>
          {backends.map(provider => {
            const participating = order.includes(provider.id)
            const rank = order.indexOf(provider.id)
            const dormant = !isRegistered(saved, provider.id, kind)
            const active = !dormant && (kind === 'search' ? saved.searchActive : saved.fetchActive) && selected?.id === provider.id
            const info = kind === 'search' || (ownsProviderConfiguration(provider) && provider.id === 'firecrawl') ? searchProviderInfo(provider, locale) : {
              description: ownsProviderConfiguration(provider) && provider.id === 'http-managed'
                && provider.description === '优先匿名 Jina Reader 读取，失败后本机 HTTP 直连；无需 Key。' && locale === 'en'
                ? 'Reads with anonymous Jina Reader first, then direct HTTP if needed; no key required.' : provider.description,
              pricing: provider.pricing ?? '', pricingUrl: provider.pricingUrl,
            }
            const owned = ownsProviderConfiguration(provider)
            const access = configurationAccess(provider)
            const needsKey = owned && Boolean(provider.credentialRef)
            const shared = Boolean(provider.credentialShared)
            const showKey = !dormant && needsKey && participating && (!shared || !provider.configured)
            const canSort = participating && order.length > 1
            const readOnly = writable[provider.credentialRef ?? ''] === false
            const typedKey = (keys[providerKey(provider.kind, provider.id)] ?? '').trim()
            const availability = dormant ? 'dormant' : provider.configured ? 'available' : 'unavailable'
            return <li key={provider.id} className={active ? 'is-active' : undefined} data-testid={`web-${kind}-rank-${provider.id}`}
              data-availability={availability}
              data-in-use={active || undefined}
              data-dragging={dragSource === providerKey(kind, provider.id) || undefined}
              data-drop={dropTarget === providerKey(kind, provider.id) && dragSource ? (order.indexOf(dragSource.slice(kind.length + 1)) < rank ? 'after' : 'before') : undefined}
              onDragOver={event => {
                if (locked || !canSort || !dragSource?.startsWith(kind + ':') || dragSource === providerKey(kind, provider.id)) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setDropTarget(providerKey(kind, provider.id))
              }}
              onDragLeave={event => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null)
              }}
              onDrop={event => {
                if (locked || !canSort || !dragSource?.startsWith(kind + ':')) return
                event.preventDefault()
                move(kind, dragSource.slice(kind.length + 1), rank)
                endDrag()
              }}>
              {canSort ? <Button variant="ghost" size="sm" className="web-search-drag-handle"
                ref={(element: HTMLButtonElement | null) => {
                  if (element) handleRefs.current.set(providerKey(kind, provider.id), element)
                  else handleRefs.current.delete(providerKey(kind, provider.id))
                }}
                icon={<svg width="16" height="20" viewBox="0 0 16 20" fill="currentColor" aria-hidden="true">
                  <circle cx="5" cy="5" r="1.5" /><circle cx="11" cy="5" r="1.5" />
                  <circle cx="5" cy="10" r="1.5" /><circle cx="11" cy="10" r="1.5" />
                  <circle cx="5" cy="15" r="1.5" /><circle cx="11" cy="15" r="1.5" />
                </svg>}
                draggable={!locked} aria-disabled={locked}
                aria-label={text.dragPrefix + providerDisplayLabel(provider, locale)}
                title={text.dragHint}
                onDragStart={event => {
                  if (locked || (pendingRef.current && pendingRef.current.kind !== kind)) { event.preventDefault(); return }
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData(`application/x-dsh-${kind}-provider`, provider.id)
                  const row = event.currentTarget.closest('li')
                  if (row) event.dataTransfer.setDragImage(row, 16, 16)
                  dragRef.current = providerKey(kind, provider.id)
                  requestSeq.current += 1
                  setDragSource(providerKey(kind, provider.id))
                  setSortAnnouncement('')
                }}
                onDragEnd={endDrag}
                onKeyDown={event => {
                  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                  event.preventDefault()
                  move(kind, provider.id, rank + (event.key === 'ArrowUp' ? -1 : 1), true)
                }} /> : <span className="web-search-rank-index">{participating ? rank + 1 : '—'}</span>}
              <div className="web-search-provider">
                <div className="web-search-provider-heading">
                  <strong className="dsh-ui-heading">{providerDisplayLabel(provider, locale)}</strong>
                  <span className="ws-provider-note">
                    <StateDot state={dormant ? 'idle' : provider.configured ? 'done' : 'warning'} />
                    <span>{dormant ? text.dormant : provider.configured ? text.available : text.unavailable}</span>
                  </span>
                  {active && <Tag tone="success">{text.inUse}</Tag>}
                  {provider.signupUrl && <AppLink url={provider.signupUrl} label={providerDisplayLabel(provider, locale) + ' ' + text.signup}>{text.signup}</AppLink>}
                </div>
                <div className="web-search-provider-info">
                  {info.description ? <p>{info.description}</p> : null}
                  {info.pricing || info.pricingUrl ? <p>{info.pricing}{info.pricingUrl && <> <AppLink url={info.pricingUrl}
                    label={providerDisplayLabel(provider, locale) + ' ' + text.pricing}>{provider.id === 'ddg' ? text.website : text.pricing}</AppLink></>}</p> : null}
                </div>
                {access.kind === 'link' ? <p className="dsh-ui-hint"><AppLink url={access.url} label={text.openConfig}>{text.openConfig}</AppLink></p>
                  : access.kind === 'owner' ? <p className="dsh-ui-hint">{text.ownerSettings}{access.name}</p>
                    : access.kind === 'unknown' ? <p className="dsh-ui-hint">{text.unknownOwner}</p>
                      : null}
                {shared && participating && owned ? <small className="dsh-ui-meta">{provider.credentialHint === '与模型设置共用 Key'
                  ? locale === 'zh' ? provider.credentialHint : 'Shares a key with model settings'
                  : owned && provider.id === 'firecrawl' && locale === 'en' ? 'Search and page reads share a Firecrawl key'
                    : provider.credentialHint ?? text.sharedKey}</small> : null}
                {showKey ? <label className="dsh-ui-field">
                  <span className="dsh-ui-label">API Key</span>
                  <Input className="ws-input" type="password" autoComplete="off" spellCheck={false}
                    disabled={busy || reordering || readOnly}
                    value={keys[providerKey(provider.kind, provider.id)] ?? ''}
                    placeholder={provider.configured ? text.keyConfigured : text.keyPlaceholder}
                    onChange={event => setKeys(current => ({ ...current, [providerKey(provider.kind, provider.id)]: event.target.value }))} />
                </label> : null}
                {showKey || (needsKey && !shared && provider.configured) ? <div className="dsh-ui-actions">
                  {showKey ? <Button variant="outline" size="sm" disabled={busy || reordering || readOnly || !typedKey}
                    onClick={() => void action(async () => { await saveKeys(provider); await load(); setNote({ key: 'keySaved' }) })}>
                    {text.saveKey}</Button> : null}
                  {needsKey && !shared && provider.configured ? <ConfirmButton
                    disabled={busy || reordering || readOnly}
                    label={text.deleteKey} confirmLabel={text.confirmDelete}
                    onConfirm={() => void action(() => removeKey(provider))} /> : null}
                </div> : null}
              </div>
              <div className="web-search-rank-move">
                <Switch
                  checked={participating}
                  label={providerDisplayLabel(provider, locale)}
                  disabled={locked || dragSource !== null}
                  onChange={next => {
                    const following = next ? [...order, provider.id] : order.filter(id => id !== provider.id)
                    runImmediate(
                      on && following.some(id => saved.providers.some(item => item.kind === kind && item.id === id && item.configured)),
                      following,
                      droppedDormantIds(saved.settings, following, saved.providers, kind),
                      kind,
                    )
                  }} />
              </div>
            </li>
          })}
        </ol>
        {kind === 'search' && backends.some(usesBundledPricing) ? <p className="dsh-ui-hint">{pricingCheckedText(locale, PROVIDER_PRICING_CHECKED)}</p> : null}
        {on && kind === 'search' ? <div className="dsh-ui-actions">
          <Button variant="outline" size="md" disabled={busy || reordering} onClick={() => void action(async () => {
            // Testing is explicit, so typed keys are saved first and the request uses them.
            await saveKeysForKind('search')
            const result = await call<{ sources: number }>('test')
            await load()
            setNote({ sources: result.sources })
          })}>{text.test}</Button>
        </div> : null}
      </article>
      })}

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
  }, (props?: { hidden?: boolean }) => <NetworkSearchSettings client={client} hidden={props?.hidden} />)), 'web-search-manager.settings')
}
