import { WebError } from '@deepseek-ai/dsh-web'
import { WEB_MANAGER_OWNER, providerKey, validateBaseURL,
  type ProviderDescriptor, type ProviderOptions, type WebSettings,
  type SearchProviderFactory, type FetchProviderFactory } from './contracts.ts'
import type { WebRegistry } from './web-registry.ts'
import { providerError } from './provider-error.ts'

export interface ProviderConfiguration {
  settings(): WebSettings
  resolveCredential(ref: string): Promise<string | undefined>
}
function validate(descriptor: ProviderDescriptor): void {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(descriptor.id) || !descriptor.label.trim()) {
    throw new WebError('供应商标识或名称无效。', 'WEB_INVALID_PROVIDER')
  }
  if (descriptor.credentialRef && !/^[A-Z][A-Z0-9_]{1,127}$/.test(descriptor.credentialRef)) {
    throw new WebError('供应商凭据引用无效。', 'WEB_INVALID_PROVIDER')
  }
  if (descriptor.defaultBaseURL) validateBaseURL(descriptor.defaultBaseURL)
  for (const [value, label] of [[descriptor.signupUrl, '注册地址'], [descriptor.pricingUrl, '费用说明地址']] as const) {
    if (!value) continue
    try {
      const url = new URL(value)
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error()
    } catch { throw new WebError(`${label}须为 HTTPS。`, 'WEB_INVALID_PROVIDER') }
  }
}
async function configuredCall<T>(kind: 'search' | 'fetch', descriptor: ProviderDescriptor,
  configuration: ProviderConfiguration, signal: AbortSignal | undefined,
  run: (options: ProviderOptions) => Promise<T>): Promise<T> {
  let apiKey: string | undefined
  try {
    signal?.throwIfAborted()
    apiKey = descriptor.credentialRef ? await configuration.resolveCredential(descriptor.credentialRef) : undefined
    signal?.throwIfAborted()
    if (descriptor.credentialRef && !apiKey?.trim()) throw new WebError('搜索凭据已删除或不可用，请重新配置。', 'WEB_CREDENTIAL_MISSING')
    const settings = configuration.settings()
    return await run({ apiKey, baseURL: settings.endpoints[providerKey(kind, descriptor.id)] ?? descriptor.defaultBaseURL,
      timeoutMs: settings.timeoutMs, maxFetchChars: settings.maxFetchChars })
  } catch (error) { throw providerError(error, apiKey ? [apiKey] : []) }
}
/** Bundle-owned adapters register through the same native ctx.web entry as any plugin. */
export function registerNativeSearch(web: WebRegistry, configuration: ProviderConfiguration,
  descriptor: ProviderDescriptor, factory: SearchProviderFactory): () => void {
  validate(descriptor)
  return web.registerSearchProvider({
    id: descriptor.id,
    dshWebManagement: Object.freeze({ ...descriptor, configurationOwner: WEB_MANAGER_OWNER }),
    available: () => true,
    search: (request, signal) => configuredCall('search', descriptor, configuration, signal, options => {
      const provider = factory(options)
      if (!provider.available()) throw new WebError('供应商配置不可用。', 'WEB_PROVIDER_ERROR')
      return provider.search(request, signal)
    }),
  } as Parameters<WebRegistry['registerSearchProvider']>[0])
}
export function registerNativeFetch(web: WebRegistry, configuration: ProviderConfiguration,
  descriptor: ProviderDescriptor, factory: FetchProviderFactory): () => void {
  validate(descriptor)
  return web.registerFetchProvider({
    id: descriptor.id,
    dshWebManagement: Object.freeze({ ...descriptor, configurationOwner: WEB_MANAGER_OWNER }),
    available: () => true,
    fetch: (request, signal) => configuredCall('fetch', descriptor, configuration, signal, options => {
      const provider = factory(options)
      if (!provider.available()) throw new WebError('供应商配置不可用。', 'WEB_PROVIDER_ERROR')
      return provider.fetch(request, signal)
    }),
  } as Parameters<WebRegistry['registerFetchProvider']>[0])
}
