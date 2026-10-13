import { WEB_MANAGER_OWNER, type ProviderView } from './contracts.ts'

// Public prices checked on 2026-09-21; links remain available for current account terms.
// This date applies only to bundled adapters that still use these static notes.
export const PROVIDER_PRICING_CHECKED = '2026-09-21'

interface ProviderInfo {
  description: string
  pricing: string
  pricingUrl?: string
}

const providerInfo: Record<string, ProviderInfo> = {
  ddg: {
    description: '搜索 DuckDuckGo 公开网页，无需注册或 API Key。',
    pricing: '免费使用，不产生搜索 API 费用。',
    pricingUrl: 'https://duckduckgo.com/',
  },
  bocha: {
    description: '面向中文内容的网页搜索，返回标题、链接和摘要。',
    pricing: '按调用次数计费，目录价 ¥0.036/次；试用额度以官方活动为准。',
    pricingUrl: 'https://aq6ky2b8nql.feishu.cn/wiki/JYSbwzdPIiFnz4kDYPXcHSDrnZb',
  },
  brave: {
    description: '使用 Brave 独立网页索引，搜索网页、新闻等内容。',
    pricing: '每月赠 $5（约 1,000 次）；超出 $5/千次，激活需绑卡。',
    pricingUrl: 'https://brave.com/search/api/',
  },
  'deepseek-official': {
    description: '由 DeepSeek 模型调用内置搜索，复用模型 API Key。',
    pricing: '默认 Flash 按 tokens 计费：每百万输入 ¥1–2（缓存命中 ¥0.02–0.04）、输出 ¥4–8，随峰谷时段变化；赠送余额与工具费用以平台为准。',
    pricingUrl: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
  },
  exa: {
    description: '面向 AI 的网页搜索，提供相关网页与内容片段。',
    pricing: '注册赠 $20，之后每月赠 $10；$7/千次（每次最多 10 条），超出 10 条每条加 $1/千次。',
    pricingUrl: 'https://exa.ai/pricing',
  },
  firecrawl: {
    description: '搜索网页，并可配合网页内容提取。',
    pricing: '每月免费 1,000 积分，搜索每 10 条结果扣 2 积分；Hobby 含 5,000 积分/月，年付折合 $16/月，额外 $5/千积分。',
    pricingUrl: 'https://www.firecrawl.dev/pricing',
  },
  serper: {
    description: '获取 Google 的网页搜索结果。',
    pricing: '注册赠 2,500 次（一次性）；充值 $50/5万次（$1/千次），付费额度有效期 6 个月。',
    pricingUrl: 'https://serper.dev/',
  },
  tavily: {
    description: '面向 AI 的网页搜索，当前使用基础搜索。',
    pricing: '每月免费 1,000 积分，基础搜索 1 积分/次；按量付费 $0.008/积分（$8/千次）。',
    pricingUrl: 'https://docs.tavily.com/documentation/api-credits',
  },
}

// The prices are the same dated notes in both languages; translation is not a price refresh.
const englishInfo: Record<string, Pick<ProviderInfo, 'description' | 'pricing'>> = {
  ddg: { description: 'Search public DuckDuckGo pages without registration or an API key.', pricing: 'Free to use; no search API fees.' },
  bocha: { description: 'Search Chinese web content, returning titles, links and summaries.', pricing: 'Charged per request: listed price ¥0.036/request; trial credits depend on official offers.' },
  brave: { description: 'Search web pages, news and more with Brave’s independent index.', pricing: '$5 in monthly credits (about 1,000 requests); then $5/1,000 requests. A payment card is required to activate.' },
  'deepseek-official': { description: 'Call built-in search through a DeepSeek model using the model API key.', pricing: 'Default Flash token pricing per million: input ¥1–2 (cache hits ¥0.02–0.04), output ¥4–8, varying by peak/off-peak hours. Platform terms govern promotional balance and tool fees.' },
  exa: { description: 'Web search for AI with relevant pages and content snippets.', pricing: '$20 on signup, then $10 monthly credits; $7/1,000 requests (up to 10 results each), plus $1/1,000 additional results beyond 10.' },
  firecrawl: { description: 'Search the web and extract page content.', pricing: '1,000 free credits/month; 2 credits per 10 search results. Hobby includes 5,000 credits/month at $16/month billed annually; extra credits cost $5/1,000.' },
  serper: { description: 'Get Google web search results.', pricing: '2,500 one-time signup requests; $50/50,000 requests ($1/1,000). Paid credits expire after 6 months.' },
  tavily: { description: 'Web search for AI, currently using basic search.', pricing: '1,000 free credits/month; basic search uses 1 credit/request. Pay as you go: $0.008/credit ($8/1,000 requests).' },
}

const bundledDescriptions: Record<string, readonly [string, string]> = {
  ddg: ['无需注册。默认后端。', 'No registration required. Default backend.'],
  'deepseek-official': ['使用已配置的 DeepSeek API Key，可能产生额外搜索费用。', 'Uses the configured DeepSeek API key; additional search fees may apply.'],
  exa: ['独立 Search API。', 'Independent Search API.'],
  brave: ['Brave Search API。', 'Brave Search API.'],
  bocha: ['中文网页搜索 API。', 'Chinese web search API.'],
  serper: ['Google 结果的 Search API。', 'Search API for Google results.'],
  firecrawl: ['网页搜索与提取 API。', 'Web search and extraction API.'],
  tavily: ['Search API；固定 basic 检索，不自动升级搜索深度。', 'Search API using basic search; search depth is never upgraded automatically.'],
}

/** Translate only manager-owned labels; externally supplied metadata stays verbatim. */
export function providerDisplayLabel(provider: ProviderView, locale: 'zh' | 'en'): string {
  if (!bundledCatalogId(provider)) return provider.label
  if (provider.label === 'DeepSeek 搜索') return locale === 'zh' ? provider.label : 'DeepSeek search'
  if (provider.label === '博查') return locale === 'zh' ? provider.label : 'Bocha'
  if (provider.label === '网页读取') return locale === 'zh' ? provider.label : 'Read web pages'
  return provider.label
}

function bundledCatalogId(provider: ProviderView): string | undefined {
  const owned = typeof provider.configurationOwned === 'boolean'
    ? provider.configurationOwned
    : !provider.configurationOwner || provider.configurationOwner === WEB_MANAGER_OWNER
  if (!owned) return
  return provider.id === 'deepseek-managed' ? 'deepseek-official' : provider.id
}

function missingPricing(locale: 'zh' | 'en'): string {
  return locale === 'zh' ? '未提供费用信息' : 'No pricing information provided'
}

export function usesBundledPricing(provider: ProviderView): boolean {
  if (provider.pricing?.trim()) return false
  const catalogId = bundledCatalogId(provider)
  return Boolean(catalogId && Object.hasOwn(providerInfo, catalogId))
}

export function searchProviderInfo(provider: ProviderView, locale: 'zh' | 'en' = 'zh'): ProviderInfo {
  const catalogId = bundledCatalogId(provider)
  const base = catalogId && Object.hasOwn(providerInfo, catalogId) ? providerInfo[catalogId] : undefined
  const known = base && locale === 'en' ? { ...base, ...englishInfo[catalogId!] } : base
  const ownedCopy = catalogId ? bundledDescriptions[catalogId] : undefined
  const description = ownedCopy && provider.description === ownedCopy[0]
    ? ownedCopy[locale === 'zh' ? 0 : 1]
    : base && provider.description === base.description ? known!.description
      : provider.description.trim() ? provider.description : (known?.description ?? provider.description)
  if (provider.pricing?.trim()) {
    return {
      description,
      pricing: provider.pricing,
      pricingUrl: provider.pricingUrl ?? known?.pricingUrl ?? provider.signupUrl,
    }
  }
  if (known) {
    return {
      description,
      pricing: known.pricing,
      pricingUrl: provider.pricingUrl ?? known.pricingUrl ?? provider.signupUrl,
    }
  }
  return {
    description,
    pricing: missingPricing(locale),
    pricingUrl: provider.pricingUrl ?? provider.signupUrl,
  }
}
