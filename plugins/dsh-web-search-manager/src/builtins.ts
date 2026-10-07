import {
  DEEPSEEK_DEFAULT_API_VERSION,
  DEEPSEEK_DEFAULT_BASE_URL,
  DEEPSEEK_DEFAULT_MAX_TOKENS,
  DEEPSEEK_DEFAULT_MAX_USES,
  DEEPSEEK_DEFAULT_MODEL,
  DeepSeekSearchProvider,
} from '@deepseek-ai/dsh-web-search-deepseek'
import { ExaSearchProvider } from '@deepseek-ai/dsh-web-search-exa'
import { HttpFetchProvider } from '@deepseek-ai/dsh-web-fetch-http'
import { JinaFirstFetchProvider } from './jina-fetch.ts'
import { SEARCH_ENGINE_ID, SearchEngineProvider } from './search-engine.ts'
import { BochaSearchProvider, BraveSearchProvider, FirecrawlSearchProvider, SerperSearchProvider } from './rest-search.ts'
import { TavilySearchProvider } from './tavily.ts'
import { registerNativeSearch, registerNativeFetch, type ProviderConfiguration } from './native-providers.ts'
import { hasWebProvider, type WebRegistry } from './web-registry.ts'
import type { ProviderDescriptor, SearchProviderFactory, FetchProviderFactory } from './contracts.ts'

export function registerBuiltins(web: WebRegistry, configuration: ProviderConfiguration): () => void {
  const registered: Array<() => void> = []
  const registerSearch = (descriptor: ProviderDescriptor, factory: SearchProviderFactory) => {
    if (descriptor.legacyId && hasWebProvider(web, 'search', descriptor.legacyId)) return () => {}
    if (hasWebProvider(web, 'search', descriptor.id)) return () => {}
    const off = registerNativeSearch(web, configuration, descriptor, factory)
    registered.push(off)
    return off
  }
  const registerFetch = (descriptor: ProviderDescriptor, factory: FetchProviderFactory) => {
    if (descriptor.legacyId && hasWebProvider(web, 'fetch', descriptor.legacyId)) return () => {}
    if (hasWebProvider(web, 'fetch', descriptor.id)) return () => {}
    const off = registerNativeFetch(web, configuration, descriptor, factory)
    registered.push(off)
    return off
  }
  try {
    registerSearch({
      id: SEARCH_ENGINE_ID, label: 'DuckDuckGo', billing: 'none',
      description: '无需注册。默认后端。',
    }, () => new SearchEngineProvider())
    registerSearch({
      id: 'deepseek-managed', legacyId: 'deepseek-official', label: 'DeepSeek 搜索',
      description: '使用已配置的 DeepSeek API Key，可能产生额外搜索费用。',
      defaultBaseURL: DEEPSEEK_DEFAULT_BASE_URL, credentialRef: 'DEEPSEEK_API_KEY',
      credentialShared: true, credentialHint: '与模型设置共用 Key', billing: 'model-and-tools',
      signupUrl: 'https://platform.deepseek.com/api_keys',
    }, options => new DeepSeekSearchProvider(() => ({
      apiKey: options.apiKey, baseURL: options.baseURL ?? DEEPSEEK_DEFAULT_BASE_URL,
      model: DEEPSEEK_DEFAULT_MODEL, apiVersion: DEEPSEEK_DEFAULT_API_VERSION,
      maxTokens: DEEPSEEK_DEFAULT_MAX_TOKENS, maxUses: DEEPSEEK_DEFAULT_MAX_USES,
    })))
    registerSearch({
      id: 'exa', label: 'Exa', description: '独立 Search API。',
      defaultBaseURL: 'https://api.exa.ai', credentialRef: 'DSH_EDITOR_WEB_EXA_API_KEY', billing: 'request',
      signupUrl: 'https://dashboard.exa.ai/api-keys',
    }, options => new ExaSearchProvider({
      apiKey: options.apiKey ?? '', baseURL: options.baseURL ?? 'https://api.exa.ai',
      searchType: 'auto', highlightsPerResult: 1,
    }))
    registerSearch({
      id: 'brave', label: 'Brave', description: 'Brave Search API。',
      defaultBaseURL: 'https://api.search.brave.com', credentialRef: 'DSH_EDITOR_WEB_BRAVE_API_KEY', billing: 'request',
      signupUrl: 'https://api.search.brave.com',
    }, options => new BraveSearchProvider({ apiKey: options.apiKey ?? '', baseURL: options.baseURL }))
    registerSearch({
      id: 'bocha', label: '博查', description: '中文网页搜索 API。',
      defaultBaseURL: 'https://api.bochaai.com', credentialRef: 'DSH_EDITOR_WEB_BOCHA_API_KEY', billing: 'request',
      signupUrl: 'https://open.bochaai.com',
    }, options => new BochaSearchProvider({ apiKey: options.apiKey ?? '', baseURL: options.baseURL }))
    registerSearch({
      id: 'serper', label: 'Serper', description: 'Google 结果的 Search API。',
      defaultBaseURL: 'https://google.serper.dev', credentialRef: 'DSH_EDITOR_WEB_SERPER_API_KEY', billing: 'request',
      signupUrl: 'https://serper.dev',
    }, options => new SerperSearchProvider({ apiKey: options.apiKey ?? '', baseURL: options.baseURL }))
    registerSearch({
      id: 'firecrawl', label: 'Firecrawl', description: '网页搜索与提取 API。',
      defaultBaseURL: 'https://api.firecrawl.dev', credentialRef: 'DSH_EDITOR_WEB_FIRECRAWL_API_KEY', billing: 'request',
      signupUrl: 'https://www.firecrawl.dev',
    }, options => new FirecrawlSearchProvider({ apiKey: options.apiKey ?? '', baseURL: options.baseURL }))
    registerSearch({
      id: 'tavily', label: 'Tavily', defaultBaseURL: 'https://api.tavily.com',
      description: 'Search API；固定 basic 检索，不自动升级搜索深度。',
      credentialRef: 'DSH_EDITOR_WEB_TAVILY_API_KEY', billing: 'request',
      signupUrl: 'https://app.tavily.com',
    }, options => new TavilySearchProvider({ apiKey: options.apiKey ?? '', baseURL: options.baseURL }))
    registerFetch({
      id: 'http-managed', legacyId: 'http', label: '网页读取', billing: 'none',
      description: '优先匿名 Jina Reader 读取，失败后本机 HTTP 直连；无需 Key。',
    }, options => {
      const limits = {
        maxResponseBytes: 5_000_000, maxBodyChars: options.maxFetchChars,
        timeoutMs: options.timeoutMs, maxRedirects: 5, userAgent: 'dsh-editor/managed-web',
      }
      const readerTimeoutMs = Math.min(15_000, Math.floor(options.timeoutMs / 2))
      return new JinaFirstFetchProvider({
        // Decode a complete JSON envelope before the manager applies maxFetchChars to its content.
        reader: new HttpFetchProvider({ ...limits, maxBodyChars: limits.maxResponseBytes, timeoutMs: readerTimeoutMs }),
        direct: new HttpFetchProvider(limits),
        readerTimeoutMs,
      })
    })
  } catch (error) { for (const off of registered.reverse()) off(); throw error }
  return () => { for (const off of registered.splice(0).reverse()) off() }
}
