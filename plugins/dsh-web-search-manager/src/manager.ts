import {
  WebError, type WebFetchProvider, type WebFetchRequest, type WebFetchResult,
  type WebSearchProvider, type WebSearchRequest, type WebSearchResult,
} from '@deepseek-ai/dsh-web'
import type { PluginLogger } from '@klarkxy/dsh-plugin-kit/log-shared'
import { providerError } from './provider-error.ts'
import { observeWebRegistry, type WebRegistry, type NativeProvider } from './web-registry.ts'
import { registerNativeSearch, registerNativeFetch, type ProviderConfiguration } from './native-providers.ts'
import {
  fuseSearchResults, isPrivateOrLocalUrl, isUsableFetchResult, planFetchEntries, planSearchEntries, type SearchBatch,
} from './multi-source.ts'
import {
  defaultSettings, migrateFetchOrder, migrateSearchOrder, pickActiveSearch, providerKey, resolveSearchOrder, validateBaseURL, safeConfigurationUrl,
  type FetchMode, type FetchProviderFactory, type LocalizedProviderText, type ProviderDescriptor, type ProviderKind, type ProviderOptions,
  type SearchMode, WEB_MANAGER_OWNER, type SearchProviderFactory, type WebSettings, type WebStatus,
} from './contracts.ts'

export type { WebRegistry } from './web-registry.ts'
export type InitialWebSettings = Omit<
  WebSettings,
  'searchOrder' | 'fetchOrder' | 'searchMode' | 'fetchMode' | 'maxParallelSearch' | 'multiSourceOptIn'
> & {
  searchOrder?: string[]
  fetchOrder?: string[]
  searchMode?: SearchMode
  fetchMode?: FetchMode
  maxParallelSearch?: number
  multiSourceOptIn?: string[]
}
export type UpdateWebSettingsInput = Omit<
  WebSettings,
  'revision' | 'fetchOrder' | 'searchMode' | 'fetchMode' | 'maxParallelSearch' | 'multiSourceOptIn'
> & {
  fetchOrder?: string[]
  searchMode?: SearchMode
  fetchMode?: FetchMode
  maxParallelSearch?: number
  multiSourceOptIn?: string[]
}
export interface ManagerOptions {
  web: WebRegistry
  initial?: InitialWebSettings
  resolveCredential(ref: string): Promise<string | undefined>
  save(settings: WebSettings): Promise<void>
  logger?: PluginLogger
}
type Entry = {
  descriptor: ProviderDescriptor
  englishDescription?: string
  kind: ProviderKind
  configured: boolean
  calls: number
  failures: number
  provider: NativeProvider
  active: Set<AbortController>
}
function fail(code: string, message: string): never { throw new WebError(message, code) }
function bounded(value: number, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || value < min || value > max) fail('WEB_INVALID_CONFIG', `${label}须为 ${min} 至 ${max} 的整数。`)
  return value
}
function extractLocalizedDescription(raw: LocalizedProviderText | undefined): { zh: string; en?: string } {
  if (typeof raw === 'string') return { zh: raw }
  if (!raw || typeof raw !== 'object') return { zh: '' }
  const zh = typeof raw['zh-cn'] === 'string' && raw['zh-cn']
    ? raw['zh-cn']
    : typeof raw.zh === 'string' && raw.zh
      ? raw.zh
      : typeof raw.en === 'string' ? raw.en : ''
  const en = typeof raw.en === 'string' && raw.en ? raw.en : undefined
  return { zh, en }
}
function normalizeSearchResult(result: WebSearchResult, count: number): WebSearchResult {
  const sources = result.sources.slice(0, count).filter(source => {
    try { const url = new URL(source.url); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password } catch { return false }
  }).map(source => ({
    ...source,
    title: source.title?.slice(0, 1000),
    snippet: source.snippet?.slice(0, 8000),
    ...(source.summary !== undefined ? { summary: source.summary.slice(0, 8000) } : {}),
  }))
  return {
    ...result,
    ...(result.content !== undefined ? { content: result.content.slice(0, 40_000) } : {}),
    sources,
    truncated: result.truncated || result.sources.length > count,
  }
}

/** Manages consent, provider lifecycle, and multi-source orchestration behind a single active ctx.web slot. */
export class WebSearchManager {
  private settings: WebSettings
  private readonly freshInstall: boolean
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
  // Keep calls even after their provider is removed from entries.
  private work = new Map<Promise<unknown>, AbortController>()

  constructor(private readonly options: ManagerOptions) {
    this.freshInstall = options.initial === undefined
    const defaults = defaultSettings()
    const initial = structuredClone(options.initial ?? defaults)
    this.settings = {
      ...defaults,
      ...initial,
      searchMode: initial.searchMode ?? defaults.searchMode,
      fetchMode: initial.fetchMode ?? defaults.fetchMode,
      maxParallelSearch: initial.maxParallelSearch ?? defaults.maxParallelSearch,
      multiSourceOptIn: [...new Set(initial.multiSourceOptIn ?? defaults.multiSourceOptIn)],
      searchOrder: migrateSearchOrder(initial),
      fetchOrder: migrateFetchOrder(initial),
    }
    this.detach = observeWebRegistry(options.web, {
      add: (kind, provider) => this.discover(kind, provider),
      remove: (kind, id) => {
        const key = providerKey(kind, id)
        const entry = this.entries.get(key)
        if (entry) {
          this.abort(entry)
          this.entries.delete(key)
          this.options.logger?.debug('provider.removed', 'Removed web provider.', { kind, providerId: id })
          this.notify()
        }
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
  private isLiveEntry(entry: Entry): boolean {
    return !this.disposed && !this.suspended && this.entries.get(providerKey(entry.kind, entry.descriptor.id)) === entry && this.ready(entry)
  }
  private readyEntriesByKind(kind: ProviderKind): Map<string, Entry> {
    const map = new Map<string, Entry>()
    for (const entry of this.entries.values()) {
      if (entry.kind === kind && this.isLiveEntry(entry)) map.set(entry.descriptor.id, entry)
    }
    return map
  }
  private searchOrder(settings: WebSettings = this.settings): string[] {
    return resolveSearchOrder(this.knownSearchIds(), settings, id => this.keyed(id))
  }
  private activeSearchId(settings: WebSettings = this.settings): string {
    return pickActiveSearch(this.searchOrder(settings), id => this.configured(id))
  }
  private activeFetchId(settings: WebSettings = this.settings): string {
    return settings.fetchOrder.find(id => {
      const entry = this.entries.get(providerKey('fetch', id))
      return entry !== undefined && this.ready(entry)
    }) ?? ''
  }
  private selected(entry: Entry): boolean {
    if (!this.isLiveEntry(entry)) return false
    if (entry.kind === 'fetch') {
      return this.settings.fetchEnabled && this.activeFetchId() === entry.descriptor.id
    }
    return this.settings.searchEnabled && this.activeSearchId() === entry.descriptor.id
  }
  private plannedSearch(settings: WebSettings = this.settings): Entry[] {
    return planSearchEntries(
      this.readyEntriesByKind('search'),
      this.searchOrder(settings),
      settings.searchMode,
      settings.maxParallelSearch,
      settings.multiSourceOptIn,
    )
  }
  private plannedFetch(settings: WebSettings = this.settings, targetUrl?: string): Entry[] {
    return planFetchEntries(
      this.readyEntriesByKind('fetch'),
      settings.fetchOrder,
      settings.fetchMode,
      settings.multiSourceOptIn,
      targetUrl,
    )
  }
  status(): WebStatus {
    const entries = [...this.entries.values()]
    return {
      settings: { ...structuredClone(this.settings), fetchProvider: this.activeFetchId() }, storageFailed: this.storageFailed,
      searchActive: entries.some(entry => entry.kind === 'search' && this.selected(entry)),
      fetchActive: entries.some(entry => entry.kind === 'fetch' && this.selected(entry)),
      providers: entries.map(entry => ({
        ...entry.descriptor,
        ...(entry.englishDescription ? { englishDescription: entry.englishDescription } : {}),
        kind: entry.kind,
        configured: this.ready(entry),
        configurationOwned: entry.descriptor.configurationOwner === WEB_MANAGER_OWNER,
        baseURL: entry.descriptor.configurationOwner === WEB_MANAGER_OWNER
          ? this.settings.endpoints[providerKey(entry.kind, entry.descriptor.id)] ?? entry.descriptor.defaultBaseURL : undefined,
        calls: entry.calls,
        failures: entry.failures,
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
    if (!entry) for (const controller of this.work.values()) controller.abort()
    for (const target of entry ? [entry] : this.entries.values()) {
      for (const controller of target.active) controller.abort()
    }
  }
  private seedFreshDefaults(kind: ProviderKind, id: string): void {
    if (!this.freshInstall || this.settings.revision !== 0) return
    if (kind === 'search' && id === 'deepseek-search-api' && !this.settings.searchOrder.includes(id)) {
      this.settings.searchOrder = [id, ...this.settings.searchOrder]
      this.settings.searchProvider = this.activeSearchId() || id
      return
    }
    if (kind === 'fetch' && id === 'deepseek-fetch-api' && !this.settings.fetchOrder.includes(id)) {
      this.settings.fetchOrder = [id, ...this.settings.fetchOrder]
      return
    }
    if (kind === 'fetch' && id === 'jina' && this.entries.has(providerKey('fetch', 'http'))
      && this.settings.fetchOrder.includes('http') && !this.settings.fetchOrder.includes('jina')) {
      const idx = this.settings.fetchOrder.indexOf('http')
      const next = [...this.settings.fetchOrder]
      next.splice(idx, 0, 'jina')
      this.settings.fetchOrder = next
    }
  }
  private discover(kind: ProviderKind, provider: NativeProvider): NativeProvider {
    const key = providerKey(kind, provider.id)
    const old = this.entries.get(key)
    if (old) this.abort(old)
    const metadata = (provider as NativeProvider & { dshWebManagement?: Partial<ProviderDescriptor> }).dshWebManagement
    const nativeCopy = extractLocalizedDescription(provider.description)
    const label = typeof metadata?.label === 'string' && metadata.label
      ? metadata.label
      : typeof provider.title === 'string' && provider.title.trim()
        ? provider.title.trim()
        : provider.id
    const description = typeof metadata?.description === 'string' && metadata.description
      ? metadata.description
      : nativeCopy.zh
    const inferredBilling = !metadata && (provider.id === 'deepseek-search-api' || provider.id === 'deepseek-fetch-api' || provider.id === 'http')
      ? 'none'
      : !metadata && provider.id === 'deepseek-official'
        ? 'model-and-tools'
        : 'unknown'
    // Copy only the documented display fields; never serialize provider options or credentials.
    const descriptor: { -readonly [K in keyof ProviderDescriptor]: ProviderDescriptor[K] } = {
      id: provider.id,
      label,
      description,
      billing: ['none', 'request', 'model-and-tools'].includes(metadata?.billing ?? '') ? metadata!.billing! : inferredBilling,
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
    const entry: Entry = {
      descriptor: Object.freeze(descriptor),
      ...(nativeCopy.en ? { englishDescription: nativeCopy.en } : {}),
      kind,
      provider,
      configured: descriptor.configurationOwner !== WEB_MANAGER_OWNER || !descriptor.credentialRef,
      calls: 0,
      failures: 0,
      active: new Set(),
    }
    this.entries.set(key, entry)
    this.options.logger?.debug('provider.discovered', 'Discovered web provider.', { kind, providerId: provider.id })
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
      } else {
        this.settings.fetchOrder = this.settings.fetchOrder.map(id => id === legacy ? provider.id : id)
        if (this.settings.fetchProvider === legacy) this.settings.fetchProvider = provider.id
      }
      const legacyKey = providerKey(kind, legacy)
      if (this.settings.endpoints[legacyKey] && !this.settings.endpoints[key]) this.settings.endpoints[key] = this.settings.endpoints[legacyKey]
    }
    this.seedFreshDefaults(kind, provider.id)
    void this.refresh()
    if (kind === 'search') {
      return {
        id: provider.id,
        ...(provider.title !== undefined ? { title: provider.title } : {}),
        ...(provider.description !== undefined ? { description: provider.description } : {}),
        available: () => this.selected(entry),
        ready: (llmProvider?: string) => this.checkKindReady('search', entry, llmProvider),
        search: (request, signal) => this.orchestrateSearch(entry, request, signal),
      }
    }
    return {
      id: provider.id,
      ...(provider.title !== undefined ? { title: provider.title } : {}),
      ...(provider.description !== undefined ? { description: provider.description } : {}),
      available: () => this.selected(entry),
      ready: (llmProvider?: string) => this.checkKindReady('fetch', entry, llmProvider),
      fetch: (request, signal) => this.orchestrateFetch(entry, request, signal),
    }
  }
  private async checkEntryReady(entry: Entry, llmProvider?: string): Promise<boolean> {
    if (!this.isLiveEntry(entry)) return false
    if (typeof entry.provider.ready !== 'function') return true
    try { return Boolean(await entry.provider.ready.call(entry.provider, llmProvider)) }
    catch { return false }
  }
  private async checkKindReady(kind: ProviderKind, primary: Entry, llmProvider?: string): Promise<boolean> {
    if (!this.selected(primary)) return false
    const candidates = kind === 'search' ? this.plannedSearch() : this.plannedFetch()
    if (candidates.length === 0) return false
    const checks = await Promise.all(candidates.map(candidate => this.checkEntryReady(candidate, llmProvider)))
    return checks.some(Boolean)
  }
  private async orchestrateSearch(primary: Entry, request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    if (typeof request.query !== 'string' || !request.query.trim() || request.query.length > 4000) {
      fail('WEB_INVALID_REQUEST', '查询须为 1 至 4000 字符。')
    }
    const count = Math.min(bounded(request.maxResults ?? this.settings.maxResults, 1, 100, '结果数'), this.settings.maxResults)
    if (!this.selected(primary)) fail('WEB_DISABLED', '请在设置 → 网络搜索中配置凭据并启用。')
    if (signal?.aborted) fail('WEB_ABORTED', '网络请求已取消或超时。')

    const plan = this.plannedSearch()
    if (plan.length === 0) fail('WEB_DISABLED', '请在设置 → 网络搜索中配置凭据并启用。')
    const normalizedRequest: WebSearchRequest = { ...request, query: request.query.trim(), maxResults: count }

    if (plan.length === 1 || this.settings.searchMode === 'single') {
      const target = plan[0]!
      const searchProvider = target.provider as WebSearchProvider
      return this.executeCandidate(target, signal, this.settings.timeoutMs, true, async (_options, combined) => {
        const result = await searchProvider.search(normalizedRequest, combined)
        return normalizeSearchResult(result, count)
      })
    }

    const epoch = this.epoch
    const deadlineController = new AbortController()
    const timeout = setTimeout(() => deadlineController.abort(), this.settings.timeoutMs)
    const sharedSignal = signal ? AbortSignal.any([signal, deadlineController.signal]) : deadlineController.signal

    try {
      if (this.settings.searchMode === 'failover') {
        let lastError: unknown
        for (let index = 0; index < plan.length; index += 1) {
          const candidate = plan[index]!
          if (sharedSignal.aborted || epoch !== this.epoch || this.disposed || this.suspended) {
            fail('WEB_ABORTED', '网络请求已取消或超时。')
          }
          if (!(await this.checkEntryReady(candidate))) continue
          const searchProvider = candidate.provider as WebSearchProvider
          try {
            return await this.executeCandidate(candidate, sharedSignal, undefined, false, async (_options, combined) => {
              const result = await searchProvider.search(normalizedRequest, combined)
              return normalizeSearchResult(result, count)
            })
          } catch (error) {
            lastError = error
            if (sharedSignal.aborted || epoch !== this.epoch || this.disposed || this.suspended) {
              throw new WebError('网络请求已取消或超时。', 'WEB_ABORTED')
            }
          }
        }
        throw lastError instanceof Error ? lastError : new WebError('暂无可用的搜索服务。', 'WEB_PROVIDER_UNAVAILABLE')
      }

      // Parallel RRF fusion across all planned candidates.
      const outcomes = await Promise.allSettled(plan.map(async (candidate, rankIndex): Promise<SearchBatch> => {
        if (!(await this.checkEntryReady(candidate))) {
          throw new WebError(`[search:${candidate.descriptor.id}] 当前模型会话下不可用。`, 'WEB_PROVIDER_UNAVAILABLE')
        }
        const searchProvider = candidate.provider as WebSearchProvider
        const result = await this.executeCandidate(candidate, sharedSignal, undefined, false, async (_options, combined) => {
          const raw = await searchProvider.search(normalizedRequest, combined)
          return normalizeSearchResult(raw, count)
        })
        return { providerId: candidate.descriptor.id, rankIndex, result }
      }))

      if (sharedSignal.aborted || epoch !== this.epoch || this.disposed || this.suspended) {
        throw new WebError('网络请求已取消或超时。', 'WEB_ABORTED')
      }

      const batches: SearchBatch[] = []
      let firstError: unknown
      for (const outcome of outcomes) {
        if (outcome.status === 'fulfilled') batches.push(outcome.value)
        else if (firstError === undefined) firstError = outcome.reason
      }
      if (batches.length === 0) {
        throw firstError instanceof Error ? firstError : new WebError('多源搜索全部失败。', 'WEB_PROVIDER_ERROR')
      }
      if (batches.length === 1) return batches[0]!.result
      return fuseSearchResults(batches, count)
    } finally {
      clearTimeout(timeout)
    }
  }
  private async orchestrateFetch(primary: Entry, request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    if (!this.selected(primary)) fail('WEB_DISABLED', '请在设置 → 网络搜索中配置凭据并启用。')
    if (signal?.aborted) fail('WEB_ABORTED', '网络请求已取消或超时。')

    const plan = this.plannedFetch(this.settings, request.url)
    if (plan.length === 0) {
      if (isPrivateOrLocalUrl(request.url)) {
        fail('WEB_INVALID_REQUEST', '内网或本机地址不会发送给云端抓取服务，请启用本机 HTTP 读取。')
      }
      fail('WEB_DISABLED', '请在设置 → 网络搜索中配置凭据并启用。')
    }

    if (plan.length === 1 || this.settings.fetchMode === 'single') {
      const target = plan[0]!
      const fetchProvider = target.provider as WebFetchProvider
      return this.executeCandidate(target, signal, this.settings.timeoutMs, plan[0] === primary, async (options, combined) => {
        const result = await fetchProvider.fetch(request, combined)
        const content = result.body.content.slice(0, options.maxFetchChars)
        return { ...result, body: { ...result.body, content }, truncated: result.truncated || content.length !== result.body.content.length }
      })
    }

    const epoch = this.epoch
    const deadlineController = new AbortController()
    const timeout = setTimeout(() => deadlineController.abort(), this.settings.timeoutMs)
    const sharedSignal = signal ? AbortSignal.any([signal, deadlineController.signal]) : deadlineController.signal

    try {
      let lastError: unknown
      let lastResult: WebFetchResult | undefined
      for (let index = 0; index < plan.length; index += 1) {
        const candidate = plan[index]!
        const isLast = index === plan.length - 1
        if (sharedSignal.aborted || epoch !== this.epoch || this.disposed || this.suspended) {
          fail('WEB_ABORTED', '网络请求已取消或超时。')
        }
        if (!(await this.checkEntryReady(candidate))) continue
        const fetchProvider = candidate.provider as WebFetchProvider
        try {
          const result = await this.executeCandidate(candidate, sharedSignal, undefined, false, async (options, combined) => {
            const raw = await fetchProvider.fetch(request, combined)
            const content = raw.body.content.slice(0, options.maxFetchChars)
            return { ...raw, body: { ...raw.body, content }, truncated: raw.truncated || content.length !== raw.body.content.length }
          })
          lastResult = result
          if (isUsableFetchResult(result) || isLast) return result
        } catch (error) {
          lastError = error
          if (sharedSignal.aborted || epoch !== this.epoch || this.disposed || this.suspended) {
            throw new WebError('网络请求已取消或超时。', 'WEB_ABORTED')
          }
        }
      }
      if (lastResult) return lastResult
      throw lastError instanceof Error ? lastError : new WebError('暂无可用的网页读取服务。', 'WEB_PROVIDER_UNAVAILABLE')
    } finally {
      clearTimeout(timeout)
    }
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
  private async executeCandidate<T>(
    entry: Entry,
    signal: AbortSignal | undefined,
    timeoutMs: number | undefined,
    requireSelected: boolean,
    run: (options: ProviderOptions, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const allowed = () => requireSelected ? this.selected(entry) : this.isLiveEntry(entry)
    if (!allowed()) fail('WEB_DISABLED', '请在设置 → 网络搜索中配置凭据并启用。')
    const startedAt = Date.now()
    const controller = new AbortController()
    const timeout = timeoutMs !== undefined ? setTimeout(() => controller.abort(), timeoutMs) : undefined
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    const epoch = this.epoch
    entry.active.add(controller)
    let started = false
    let work: Promise<T> | undefined
    try {
      if (epoch !== this.epoch || !allowed()) fail('WEB_DISABLED', '网络访问设置已改变，请重新发起请求。')
      const options = {
        baseURL: this.settings.endpoints[providerKey(entry.kind, entry.descriptor.id)] ?? entry.descriptor.defaultBaseURL,
        timeoutMs: this.settings.timeoutMs, maxFetchChars: this.settings.maxFetchChars,
      }
      started = true
      entry.calls += 1
      // Cancellation is cooperative. Await the actual provider, including its
      // transport/process cleanup; a race would only hide work still running.
      work = Promise.resolve().then(() => { combined.throwIfAborted(); return run(options, combined) })
      this.work.set(work, controller)
      const result = await work
      if (combined.aborted || epoch !== this.epoch || !allowed()) fail('WEB_ABORTED', '网络请求已取消。')
      this.options.logger?.info('provider.executed', 'Completed web provider execution.', {
        kind: entry.kind, providerId: entry.descriptor.id, durationMs: Date.now() - startedAt,
      })
      return result
    } catch (error) {
      if (started) entry.failures += 1
      if (error instanceof WebError && error.code === 'WEB_CREDENTIAL_MISSING') {
        entry.configured = false; this.abort(entry); this.notify()
        this.options.logger?.warn('provider.credential-missing', 'Web provider credential is missing.', error, {
          kind: entry.kind, providerId: entry.descriptor.id, durationMs: Date.now() - startedAt,
        })
      }
      if (combined.aborted && !(error instanceof WebError && error.code === 'WEB_CREDENTIAL_MISSING')) {
        this.options.logger?.debug('provider.aborted', 'Web provider execution cancelled or timed out.', {
          kind: entry.kind, providerId: entry.descriptor.id, durationMs: Date.now() - startedAt,
        })
        throw new WebError('网络请求已取消或超时。', 'WEB_ABORTED')
      }
      // Preserve upstream diagnostics, stripping only known credentials and authentication fields.
      const safe = providerError(error)
      if (!(error instanceof WebError && error.code === 'WEB_CREDENTIAL_MISSING')) {
        this.options.logger?.warn('provider.failed', 'Web provider execution failed.', safe, {
          kind: entry.kind, providerId: entry.descriptor.id, code: safe.code, durationMs: Date.now() - startedAt,
        })
      }
      throw new WebError(`[${entry.kind}:${entry.descriptor.id}] ${safe.message}`, safe.code)
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
      entry.active.delete(controller)
      if (work) this.work.delete(work)
    }
  }
  update(next: UpdateWebSettingsInput, expectedRevision: number): Promise<WebStatus> {
    const task = this.pending.then(async () => {
      if (this.disposed) fail('WEB_DISABLED', '网络搜索插件已停止。')
      if (expectedRevision !== this.settings.revision) fail('WEB_CONFIG_CONFLICT', '设置已被其他页面修改，请刷新后重试。')
      const input = structuredClone(next)
      // Old clients echo the derived single selection on unrelated edits. Preserve the
      // full opt-in list unless they actually change that legacy selection.
      const fetchOrder = input.fetchOrder ?? (input.fetchProvider === this.activeFetchId()
        ? [...this.settings.fetchOrder] : migrateFetchOrder(input))
      const searchMode: SearchMode = input.searchMode ?? this.settings.searchMode
      const fetchMode: FetchMode = input.fetchMode ?? this.settings.fetchMode
      if (!['fusion', 'failover', 'single'].includes(searchMode)) fail('WEB_INVALID_CONFIG', '搜索多源模式无效。')
      if (!['waterfall', 'single'].includes(fetchMode)) fail('WEB_INVALID_CONFIG', '读取模式无效。')
      const maxParallelSearch = input.maxParallelSearch ?? this.settings.maxParallelSearch
      const multiSourceOptIn = [...new Set(input.multiSourceOptIn ?? this.settings.multiSourceOptIn)]
      if (multiSourceOptIn.length > 64 || multiSourceOptIn.some(key => !/^(search|fetch):[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(key))) {
        fail('WEB_INVALID_CONFIG', '多源计费授权项格式无效。')
      }
      const proposed: WebSettings = {
        ...input,
        searchMode,
        fetchMode,
        maxParallelSearch,
        multiSourceOptIn,
        fetchOrder,
        revision: expectedRevision + 1,
      }
      bounded(proposed.maxResults, 1, 20, '结果上限')
      bounded(proposed.maxQueries, 1, 10, '查询上限')
      bounded(proposed.maxParallelSearch, 2, 5, '并发搜索源上限')
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
      proposed.fetchOrder = [...new Set(proposed.fetchOrder)]
      proposed.fetchProvider = this.activeFetchId(proposed)
      const activatingFetch = !this.settings.fetchEnabled
        || JSON.stringify(proposed.fetchOrder) !== JSON.stringify(this.settings.fetchOrder)
      if (proposed.fetchEnabled && !proposed.fetchProvider && activatingFetch) {
        fail('WEB_CREDENTIAL_MISSING', '需选择已安装的供应商并填写有效凭据。')
      }
      this.suspended = true
      this.epoch += 1
      this.abort()
      this.notify()
      try { await this.options.save(proposed) }
      catch (saveError) {
        this.storageFailed = true
        this.notify()
        this.options.logger?.fault('settings.save-failed', 'Failed to persist web search settings; network access suspended.', saveError, {
          revision: proposed.revision,
        })
        fail('WEB_CONFIG_SAVE_FAILED', '保存失败，本次运行已暂停网络访问以防意外联网。')
      }
      this.settings = proposed
      this.storageFailed = false
      this.suspended = false
      this.options.logger?.info('settings.updated', 'Updated web search settings.', {
        revision: proposed.revision,
        searchEnabled: proposed.searchEnabled,
        searchMode: proposed.searchMode,
        searchProvider: proposed.searchProvider,
        fetchEnabled: proposed.fetchEnabled,
        fetchMode: proposed.fetchMode,
        fetchProvider: proposed.fetchProvider,
      })
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
    await this.pending
    await Promise.allSettled([...this.work.keys()])
    for (const off of [...this.legacyRegistrations]) off()
    this.detach()
    this.entries.clear()
    this.listeners.clear()
  }
}
