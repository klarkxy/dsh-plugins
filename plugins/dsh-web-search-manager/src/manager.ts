import { WebError, type WebFetchProvider, type WebSearchProvider } from '@deepseek-ai/dsh-web'
import { providerError } from './provider-error.ts'
import { observeWebRegistry, type WebRegistry, type NativeProvider } from './web-registry.ts'
import { registerNativeSearch, registerNativeFetch, type ProviderConfiguration } from './native-providers.ts'
import {
  defaultSettings, migrateSearchOrder, pickActiveSearch, providerKey, resolveSearchOrder, validateBaseURL, safeConfigurationUrl,
  type FetchProviderFactory, type ProviderDescriptor, type ProviderKind, type ProviderOptions,
  WEB_MANAGER_OWNER, type SearchProviderFactory, type WebSettings, type WebStatus,
} from './contracts.ts'

export type { WebRegistry } from './web-registry.ts'
export interface ManagerOptions {
  web: WebRegistry
  initial?: Omit<WebSettings, 'searchOrder'> & { searchOrder?: string[] }
  resolveCredential(ref: string): Promise<string | undefined>
  save(settings: WebSettings): Promise<void>
}
type Entry = {
  descriptor: ProviderDescriptor; kind: ProviderKind; configured: boolean
  calls: number; failures: number; provider: NativeProvider; active: Set<AbortController>
}
function fail(code: string, message: string): never { throw new WebError(message, code) }
function bounded(value: number, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || value < min || value > max) fail('WEB_INVALID_CONFIG', `${label}须为 ${min} 至 ${max} 的整数。`)
  return value
}
/** Enforce cancellation even when an extension ignores its cooperative signal. */
async function abortable<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let off = () => {}
  const aborted = new Promise<never>((_, reject) => {
    const onAbort = () => reject(new WebError('网络请求已取消或超时。', 'WEB_ABORTED'))
    signal.addEventListener('abort', onAbort, { once: true })
    off = () => signal.removeEventListener('abort', onAbort)
  })
  try {
    return await Promise.race([Promise.resolve().then(() => { signal.throwIfAborted(); return work() }), aborted])
  } finally { off() }
}

/** Manages consent and provider lifecycle. Selection and execution stay in ctx.web. */
export class WebSearchManager {
  private settings: WebSettings
  private entries = new Map<string, Entry>()
  private listeners = new Set<() => void>()
  private pending = Promise.resolve()
  private epoch = 0
  private suspended = false
  private disposed = false
  private storageFailed = false
  private refreshRevision = 0
  private detach: () => void
  private legacyRegistrations = new Set<() => void>()

  constructor(private readonly options: ManagerOptions) {
    const initial = structuredClone(options.initial ?? defaultSettings())
    this.settings = { ...defaultSettings(), ...initial, searchOrder: migrateSearchOrder(initial) }
    this.detach = observeWebRegistry(options.web, {
      add: (kind, provider) => this.discover(kind, provider),
      remove: (kind, id) => {
        const key = providerKey(kind, id)
        const entry = this.entries.get(key)
        if (entry) { this.abort(entry); this.entries.delete(key); this.notify() }
      },
    })
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private notify(): void {
    for (const listener of this.listeners) {
      try { listener() } catch { /* observer failure cannot authorize a request */ }
    }
  }
  private knownSearchIds(): string[] {
    return [...this.entries.values()].filter(entry => entry.kind === 'search').map(entry => entry.descriptor.id)
  }
  private keyed(id: string): boolean {
    return Boolean(this.entries.get(providerKey('search', id))?.descriptor.credentialRef)
  }
  private configured(id: string): boolean {
    const entry = this.entries.get(providerKey('search', id))
    return Boolean(entry && this.ready(entry))
  }
  private ready(entry: Entry): boolean {
    try { return entry.configured && entry.provider.available() }
    catch { return false }
  }
  private searchOrder(settings: WebSettings = this.settings): string[] {
    return resolveSearchOrder(this.knownSearchIds(), settings, id => this.keyed(id))
  }
  private activeSearchId(settings: WebSettings = this.settings): string {
    return pickActiveSearch(this.searchOrder(settings), id => this.configured(id))
  }
  private selected(entry: Entry): boolean {
    if (this.disposed || this.suspended || !this.ready(entry)) return false
    if (this.entries.get(providerKey(entry.kind, entry.descriptor.id)) !== entry) return false
    if (entry.kind === 'fetch') {
      return this.settings.fetchEnabled
        && this.settings.fetchProvider === entry.descriptor.id
        && this.entries.get(providerKey('fetch', entry.descriptor.id)) === entry
    }
    return this.settings.searchEnabled && this.activeSearchId() === entry.descriptor.id
  }
  status(): WebStatus {
    const entries = [...this.entries.values()]
    return {
      settings: structuredClone(this.settings), storageFailed: this.storageFailed,
      searchActive: entries.some(entry => entry.kind === 'search' && this.selected(entry)),
      fetchActive: entries.some(entry => entry.kind === 'fetch' && this.selected(entry)),
      providers: entries.map(entry => ({
        ...entry.descriptor, kind: entry.kind, configured: this.ready(entry),
        configurationOwned: entry.descriptor.configurationOwner === WEB_MANAGER_OWNER,
        baseURL: entry.descriptor.configurationOwner === WEB_MANAGER_OWNER
          ? this.settings.endpoints[providerKey(entry.kind, entry.descriptor.id)] ?? entry.descriptor.defaultBaseURL : undefined,
        calls: entry.calls, failures: entry.failures,
      })).sort((a, b) => providerKey(a.kind, a.id).localeCompare(providerKey(b.kind, b.id))),
    }
  }
  async refresh(): Promise<WebStatus> {
    const epoch = this.epoch
    const revision = ++this.refreshRevision
    await Promise.all([...this.entries.entries()].map(async ([key, entry]) => {
      let configured = true
      if (entry.descriptor.configurationOwner === WEB_MANAGER_OWNER && entry.descriptor.credentialRef) {
        try { configured = Boolean((await this.options.resolveCredential(entry.descriptor.credentialRef))?.trim()) }
        catch { configured = false }
      }
      if (this.disposed || epoch !== this.epoch || revision !== this.refreshRevision || this.entries.get(key) !== entry) return
      if (entry.configured !== configured) {
        entry.configured = configured
        if (!configured) this.abort(entry)
      }
      if (!this.ready(entry)) this.abort(entry)
    }))
    this.notify()
    return this.status()
  }
  private abort(entry?: Entry): void {
    for (const target of entry ? [entry] : this.entries.values()) {
      for (const controller of target.active) controller.abort()
    }
  }
  private discover(kind: ProviderKind, provider: NativeProvider): NativeProvider {
    const key = providerKey(kind, provider.id)
    const old = this.entries.get(key)
    if (old) this.abort(old)
    const metadata = (provider as NativeProvider & { dshWebManagement?: Partial<ProviderDescriptor> }).dshWebManagement
    // Copy only the documented display fields; never serialize provider options or credentials.
    const descriptor: { -readonly [K in keyof ProviderDescriptor]: ProviderDescriptor[K] } = {
      id: provider.id, label: typeof metadata?.label === 'string' && metadata.label ? metadata.label : provider.id,
      description: typeof metadata?.description === 'string' ? metadata.description : '',
      billing: ['none', 'request', 'model-and-tools'].includes(metadata?.billing ?? '') ? metadata!.billing! : 'unknown',
      configurationOwner: typeof metadata?.configurationOwner === 'string' && metadata.configurationOwner ? metadata.configurationOwner : undefined,
      configurationUrl: safeConfigurationUrl(metadata?.configurationUrl),
    }
    for (const field of ['credentialHint', 'pricing', 'defaultBaseURL'] as const) {
      if (typeof metadata?.[field] === 'string') descriptor[field] = metadata[field]
    }
    if (typeof metadata?.credentialRef === 'string' && /^[A-Z][A-Z0-9_]{1,127}$/.test(metadata.credentialRef)) descriptor.credentialRef = metadata.credentialRef
    if (metadata?.credentialShared === true) descriptor.credentialShared = true
    for (const field of ['signupUrl', 'pricingUrl'] as const) {
      try {
        const url = new URL(metadata?.[field] ?? '')
        if (url.protocol === 'https:' && !url.username && !url.password) descriptor[field] = metadata![field]
      } catch { /* unsafe optional links do not hide a valid native provider */ }
    }
    const entry: Entry = { descriptor: Object.freeze(descriptor), kind, provider,
      configured: descriptor.configurationOwner !== WEB_MANAGER_OWNER || !descriptor.credentialRef,
      calls: 0, failures: 0, active: new Set() }
    this.entries.set(key, entry)
    // The bundle's old adapters used official ids. Migrate only their fixed aliases;
    // leave values in storage untouched until an explicit user save.
    const legacy = metadata?.legacyId
    const expectedLegacy = kind === 'search' && provider.id === 'deepseek-managed' ? 'deepseek-official'
      : kind === 'fetch' && provider.id === 'http-managed' ? 'http' : undefined
    if (descriptor.configurationOwner === WEB_MANAGER_OWNER && legacy === expectedLegacy && legacy
      && !this.entries.has(providerKey(kind, legacy))) {
      if (kind === 'search') {
        this.settings.searchOrder = this.settings.searchOrder.map(id => id === legacy ? provider.id : id)
        if (this.settings.searchProvider === legacy) this.settings.searchProvider = provider.id
      } else if (this.settings.fetchProvider === legacy) this.settings.fetchProvider = provider.id
      const legacyKey = providerKey(kind, legacy)
      if (this.settings.endpoints[legacyKey] && !this.settings.endpoints[key]) this.settings.endpoints[key] = this.settings.endpoints[legacyKey]
    }
    void this.refresh()
    if (kind === 'search') {
      const search = provider as WebSearchProvider
      return { id: provider.id, available: () => this.selected(entry), search: (request, signal) => {
        if (typeof request.query !== 'string' || !request.query.trim() || request.query.length > 4000) fail('WEB_INVALID_REQUEST', '查询须为 1 至 4000 字符。')
        const count = Math.min(bounded(request.maxResults ?? this.settings.maxResults, 1, 100, '结果数'), this.settings.maxResults)
        return this.execute(entry, signal, async (_options, combined) => {
          const result = await search.search({ ...request, query: request.query.trim(), maxResults: count }, combined)
          const sources = result.sources.slice(0, count).filter(source => {
            try { const url = new URL(source.url); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password } catch { return false }
          }).map(source => ({ ...source, title: source.title?.slice(0, 1000), snippet: source.snippet?.slice(0, 8000) }))
          return { ...result, content: result.content?.slice(0, 40_000), sources,
            truncated: result.truncated || result.sources.length > count }
        })
      } }
    }
    const fetch = provider as WebFetchProvider
    return { id: provider.id, available: () => this.selected(entry), fetch: (request, signal) =>
      this.execute(entry, signal, async (options, combined) => {
        const result = await fetch.fetch(request, combined)
        const content = result.body.content.slice(0, options.maxFetchChars)
        return { ...result, body: { ...result.body, content }, truncated: result.truncated || content.length !== result.body.content.length }
      }) }
  }
  /** @deprecated Provider plugins should register directly with ctx.web. */
  registerSearchProvider(descriptor: ProviderDescriptor, factory: SearchProviderFactory): () => void {
    return this.legacyRegistration(() => registerNativeSearch(this.options.web, this.providerConfiguration(), descriptor, factory))
  }
  /** @deprecated Provider plugins should register directly with ctx.web. */
  registerFetchProvider(descriptor: ProviderDescriptor, factory: FetchProviderFactory): () => void {
    return this.legacyRegistration(() => registerNativeFetch(this.options.web, this.providerConfiguration(), descriptor, factory))
  }
  private providerConfiguration(): ProviderConfiguration {
    return { settings: () => structuredClone(this.settings), resolveCredential: ref => this.options.resolveCredential(ref) }
  }
  private legacyRegistration(register: () => () => void): () => void {
    if (this.disposed) fail('WEB_DISABLED', '网络搜索插件已停止。')
    const unregister = register()
    const off = () => { this.legacyRegistrations.delete(off); unregister() }
    this.legacyRegistrations.add(off)
    return off
  }
  private async execute<T>(entry: Entry, signal: AbortSignal | undefined,
    run: (options: ProviderOptions, signal: AbortSignal) => Promise<T>): Promise<T> {
    if (!this.selected(entry)) fail('WEB_DISABLED', '请在设置 → 网络搜索中配置凭据并启用。')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.settings.timeoutMs)
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    const epoch = this.epoch
    entry.active.add(controller)
    let started = false
    try {
      if (epoch !== this.epoch || !this.selected(entry)) fail('WEB_DISABLED', '网络访问设置已改变，请重新发起请求。')
      const options = {
        baseURL: this.settings.endpoints[providerKey(entry.kind, entry.descriptor.id)] ?? entry.descriptor.defaultBaseURL,
        timeoutMs: this.settings.timeoutMs, maxFetchChars: this.settings.maxFetchChars,
      }
      started = true
      entry.calls += 1
      const result = await abortable(() => run(options, combined), combined)
      if (epoch !== this.epoch || !this.selected(entry)) fail('WEB_ABORTED', '网络请求已取消。')
      return result
    } catch (error) {
      if (started) entry.failures += 1
      if (error instanceof WebError && error.code === 'WEB_CREDENTIAL_MISSING') {
        entry.configured = false; this.abort(entry); this.notify()
      }
      if (combined.aborted && !(error instanceof WebError && error.code === 'WEB_CREDENTIAL_MISSING')) {
        throw new WebError('网络请求已取消或超时。', 'WEB_ABORTED')
      }
      // Preserve upstream diagnostics, stripping only known credentials and authentication fields.
      const safe = providerError(error)
      throw new WebError(`[${entry.kind}:${entry.descriptor.id}] ${safe.message}`, safe.code)
    } finally {
      clearTimeout(timeout)
      entry.active.delete(controller)
    }
  }
  update(next: Omit<WebSettings, 'revision'>, expectedRevision: number): Promise<WebStatus> {
    const task = this.pending.then(async () => {
      if (this.disposed) fail('WEB_DISABLED', '网络搜索插件已停止。')
      if (expectedRevision !== this.settings.revision) fail('WEB_CONFIG_CONFLICT', '设置已被其他页面修改，请刷新后重试。')
      const proposed: WebSettings = { ...structuredClone(next), revision: expectedRevision + 1 }
      bounded(proposed.maxResults, 1, 20, '结果上限')
      bounded(proposed.maxQueries, 1, 5, '查询上限')
      bounded(proposed.timeoutMs, 1000, 120_000, '超时毫秒数')
      bounded(proposed.maxFetchChars, 1000, 200_000, '正文长度')
      for (const [key, value] of Object.entries(proposed.endpoints)) {
        const entry = this.entries.get(key)
        if (entry && (entry.descriptor.configurationOwner !== WEB_MANAGER_OWNER || !entry.descriptor.defaultBaseURL)
          && value !== this.settings.endpoints[key]) fail('WEB_INVALID_CONFIG', '供应商不支持自定义地址。')
        try { proposed.endpoints[key] = validateBaseURL(value) }
        catch { fail('WEB_INVALID_CONFIG', '供应商地址须为无凭据、无查询参数的 HTTPS 地址。') }
      }
      await this.refresh()
      proposed.searchOrder = [...new Set(proposed.searchOrder)]
      proposed.searchProvider = this.activeSearchId(proposed)
      const activatingSearch = !this.settings.searchEnabled
        || JSON.stringify(proposed.searchOrder) !== JSON.stringify(this.settings.searchOrder)
      if (proposed.searchEnabled && !proposed.searchProvider && activatingSearch) {
        fail('WEB_CREDENTIAL_MISSING', '需选择已安装的供应商并填写有效凭据。')
      }
      if (proposed.fetchEnabled) {
        const entry = this.entries.get(providerKey('fetch', proposed.fetchProvider))
        const activatingFetch = !this.settings.fetchEnabled || proposed.fetchProvider !== this.settings.fetchProvider
        if (activatingFetch && (!entry || !this.ready(entry))) fail('WEB_CREDENTIAL_MISSING', '需选择已安装的供应商并填写有效凭据。')
      }
      this.suspended = true
      this.epoch += 1
      this.abort()
      this.notify()
      try { await this.options.save(proposed) }
      catch {
        this.storageFailed = true
        this.notify()
        fail('WEB_CONFIG_SAVE_FAILED', '保存失败，本次运行已暂停网络访问以防意外联网。')
      }
      this.settings = proposed
      this.storageFailed = false
      this.suspended = false
      this.notify()
      return this.status()
    })
    this.pending = task.then(() => {}, () => {})
    return task
  }
  async dispose(): Promise<void> {
    this.disposed = true
    this.epoch += 1
    this.abort()
    this.notify()
    for (const off of [...this.legacyRegistrations]) off()
    await this.pending
    this.detach()
    this.entries.clear()
    this.listeners.clear()
  }
}
