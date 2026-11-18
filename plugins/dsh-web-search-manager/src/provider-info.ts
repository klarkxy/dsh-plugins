import { WEB_MANAGER_OWNER, type ProviderView } from './contracts.ts'

// Public prices checked on 2026-11-18; links remain available for current account terms.
// This date applies only to bundled adapters that still use these static notes.
export const PROVIDER_PRICING_CHECKED = '2026-11-18'

interface ProviderInfo {
  description: string
  pricing: string
  pricingUrl?: string
}

const providerInfo: Record<string, ProviderInfo> = {
  perplexity: {
    description: '通过 Perplexity Search API 获取网页来源，不生成回答。',
    pricing: '按 Search API 请求计费；实际价格与额度以官方账户为准。',
    pricingUrl: 'https://docs.perplexity.ai/docs/getting-started/pricing',
  },
  you: {
    description: '通过 You.com 获取网页与新闻结果，不请求额外全文提取。',
    pricing: '按 Web Search API 请求计费；实际价格与额度以官方账户为准。',
    pricingUrl: 'https://you.com/docs/administration/billing',
  },
  linkup: {
    description: '通过 Linkup fast 检索获取网页来源，不生成回答，也不启用 deep 检索。',
    pricing: '按 Search API 的 fast 来源请求计费；实际价格与额度以官方账户为准。',
    pricingUrl: 'https://docs.linkup.so/pages/documentation/platform/pricing',
  },
  zhipu: {
    description: '通过智谱基础搜索获取标题、链接和摘要，不改用高阶或第三方引擎。',
    pricing: '基础搜索按次计费；实际价格与额度以官方账户为准。查询超过 70 个字符会在本地拒绝。',
    pricingUrl: 'https://docs.bigmodel.cn/cn/guide/start/pricing',
  },
  'firecrawl-fetch': {
    description: '读取网页 Markdown；与 Firecrawl 搜索共用 Key。',
    pricing: '网页读取使用 Firecrawl 积分，与搜索分别计费；实际消耗以官方账户为准。',
    pricingUrl: 'https://www.firecrawl.dev/pricing',
  },
  jina: {
    description: '通过匿名 Jina Reader 提取公开网页 Markdown，失败或内网地址回退本机 HTTP；无需 Key。',
    pricing: '免费使用，无需注册或 API Key。',
    pricingUrl: 'https://jina.ai/reader/',
  },
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
    description: '由 DeepSeek 模型触发服务端搜索，复用模型 API Key 或登录账号。',
    pricing: '服务端搜索与网页抓取免收按次工具费，仅按模型（默认 Flash）Token 用量计费：每百万输入 ¥1–2（缓存命中 ¥0.02–0.04）、输出 ¥4–8。',
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
  perplexity: { description: 'Get web sources through the Perplexity Search API without generating an answer.', pricing: 'Charged per Search API request; current prices and credits depend on your official account.' },
  you: { description: 'Get web and news results through You.com without requesting extra full-page extraction.', pricing: 'Charged per Web Search API request; current prices and credits depend on your official account.' },
  linkup: { description: 'Get web sources through Linkup fast search without generating an answer or enabling deep search.', pricing: 'Charged per fast Search API source request; current prices and credits depend on your official account.' },
  zhipu: { description: 'Get titles, links and summaries through Zhipu basic search without switching to a higher or third-party engine.', pricing: 'Basic search is charged per request; current prices and credits depend on your official account. Queries longer than 70 characters are rejected locally.' },
  'firecrawl-fetch': { description: 'Read page Markdown using the same key as Firecrawl search.', pricing: 'Page reads use Firecrawl credits and are charged separately from search; your official account determines usage.' },
  jina: { description: 'Extract public page Markdown via anonymous Jina Reader, falling back to direct HTTP on failure or local addresses; no key required.', pricing: 'Free to use; no registration or API key required.' },
  ddg: { description: 'Search public DuckDuckGo pages without registration or an API key.', pricing: 'Free to use; no search API fees.' },
  bocha: { description: 'Search Chinese web content, returning titles, links and summaries.', pricing: 'Charged per request: listed price ¥0.036/request; trial credits depend on official offers.' },
  brave: { description: 'Search web pages, news and more with Brave’s independent index.', pricing: '$5 in monthly credits (about 1,000 requests); then $5/1,000 requests. A payment card is required to activate.' },
  'deepseek-official': { description: 'Trigger server-side search through a DeepSeek model using your model API key or logged-in account.', pricing: 'Server-side search and page fetch carry no per-call tool fee; only model (default Flash) token usage is billed: input ¥1–2/M (cache hits ¥0.02–0.04/M), output ¥4–8/M.' },
  exa: { description: 'Web search for AI with relevant pages and content snippets.', pricing: '$20 on signup, then $10 monthly credits; $7/1,000 requests (up to 10 results each), plus $1/1,000 additional results beyond 10.' },
  firecrawl: { description: 'Search the web and extract page content.', pricing: '1,000 free credits/month; 2 credits per 10 search results. Hobby includes 5,000 credits/month at $16/month billed annually; extra credits cost $5/1,000.' },
  serper: { description: 'Get Google web search results.', pricing: '2,500 one-time signup requests; $50/50,000 requests ($1/1,000). Paid credits expire after 6 months.' },
  tavily: { description: 'Web search for AI, currently using basic search.', pricing: '1,000 free credits/month; basic search uses 1 credit/request. Pay as you go: $0.008/credit ($8/1,000 requests).' },
}

const bundledDescriptions: Record<string, readonly [string, string]> = {
  perplexity: ['Search API；返回网页来源，不生成回答。', 'Search API returning web sources without generating an answer.'],
  you: ['网页与新闻搜索；不额外提取全文。', 'Web and news search without extra full-page extraction.'],
  linkup: ['Search API；fast 检索，只返回来源，不生成回答。', 'Search API using fast retrieval and returning sources without generating an answer.'],
  zhipu: ['基础搜索 API；固定 search_std，查询不超过 70 个字符。', 'Basic search API fixed to search_std; queries are limited to 70 characters.'],
  'firecrawl-fetch': ['读取网页 Markdown；与 Firecrawl 搜索共用 Key。', 'Read page Markdown using the same key as Firecrawl search.'],
  jina: ['通过匿名 Jina Reader 提取公开网页 Markdown，失败或内网地址回退本机 HTTP；无需 Key。', 'Extract public page Markdown via anonymous Jina Reader, falling back to direct HTTP on failure or local addresses; no key required.'],
  ddg: ['无需注册。免配置搜索后端。', 'No registration required. Zero-config search backend.'],
  'deepseek-official': ['通过 DeepSeek 模型触发服务端搜索，免按次搜索费，仅计模型 Token。', 'Triggers server-side search via DeepSeek model with no per-call search fee; only model tokens apply.'],
  exa: ['独立 Search API。', 'Independent Search API.'],
  brave: ['Brave Search API。', 'Brave Search API.'],
  bocha: ['中文网页搜索 API。', 'Chinese web search API.'],
  serper: ['Google 结果的 Search API。', 'Search API for Google results.'],
  firecrawl: ['网页搜索与提取 API。', 'Web search and extraction API.'],
  tavily: ['Search API；固定 basic 检索，不自动升级搜索深度。', 'Search API using basic search; search depth is never upgraded automatically.'],
}

/** Fallback metadata ONLY for bare built-in host IDs when the host provides no custom pricing/copy. */
const officialHostFallback: Record<string, {
  label: readonly [string, string]
  description: readonly [string, string]
  pricing: readonly [string, string]
  pricingUrl?: string
}> = {
  'search:deepseek-search-api': {
    label: ['DeepSeek Search API', 'DeepSeek Search API'],
    description: [
      '宿主内置直连搜索服务，返回标题、链接、长短摘要与发布时间，复用已登录账号或 API Key。',
      'Built-in direct search service returning titles, URLs, summaries, and dates using your DeepSeek account or API key.',
    ],
    pricing: [
      '随宿主免费通道或平台账户规则结算；独立 API 目录价参考官方文档。',
      'Governed by the host free channel or your DeepSeek platform account terms.',
    ],
    pricingUrl: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
  },
  'fetch:deepseek-fetch-api': {
    label: ['DeepSeek Fetch API', 'DeepSeek Fetch API'],
    description: [
      '宿主内置网页抓取服务，单次请求直接返回页面 Markdown，复用已登录账号或 API Key。',
      'Built-in page fetch service returning page Markdown directly using your DeepSeek account or API key.',
    ],
    pricing: [
      '随宿主免费通道或平台账户规则结算；独立 API 目录价参考官方文档。',
      'Governed by the host free channel or your DeepSeek platform account terms.',
    ],
    pricingUrl: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
  },
  'search:deepseek-official': {
    label: ['DeepSeek 搜索（服务端）', 'DeepSeek search (server-side)'],
    description: [
      '宿主内置服务端搜索，复用已登录 DeepSeek 账号或模型 API Key。',
      'Built-in server-side search reusing your logged-in DeepSeek account or model API key.',
    ],
    pricing: [
      '服务端搜索免收按次工具费，仅按模型 Token 用量计费。',
      'Server-side search carries no per-call tool fee; only model token usage is billed.',
    ],
    pricingUrl: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
  },
  'fetch:http': {
    label: ['本机 HTTP 直连', 'Local HTTP fetch'],
    description: [
      '宿主内置匿名 HTTP(S) 网页读取，无需凭据。',
      'Built-in anonymous local HTTP(S) page reader; no credentials required.',
    ],
    pricing: [
      '本机直接请求，免费使用。',
      'Direct local fetch; free to use.',
    ],
  },
}

/** Translate manager-owned labels and bare official host IDs; externally supplied labels stay verbatim. */
export function providerDisplayLabel(provider: ProviderView, locale: 'zh' | 'en'): string {
  if (!bundledCatalogId(provider)) {
    const hostFallback = officialHostFallback[`${provider.kind}:${provider.id}`]
    if (hostFallback && provider.label === provider.id) {
      return hostFallback.label[locale === 'zh' ? 0 : 1]
    }
    return provider.label
  }
  if (provider.label === 'DeepSeek 搜索') return locale === 'zh' ? provider.label : 'DeepSeek search'
  if (provider.label === '博查') return locale === 'zh' ? provider.label : 'Bocha'
  if (provider.label === '智谱') return locale === 'zh' ? provider.label : 'Zhipu'
  if (provider.label === '网页读取') return locale === 'zh' ? provider.label : 'Read web pages'
  return provider.label
}

function bundledCatalogId(provider: ProviderView): string | undefined {
  const owned = typeof provider.configurationOwned === 'boolean'
    ? provider.configurationOwned
    : !provider.configurationOwner || provider.configurationOwner === WEB_MANAGER_OWNER
  if (!owned) return
  if (provider.kind === 'fetch' && provider.id === 'firecrawl') return 'firecrawl-fetch'
  return provider.id === 'deepseek-managed' ? 'deepseek-official' : provider.id
}

function missingPricing(locale: 'zh' | 'en'): string {
  return locale === 'zh' ? '未提供费用信息' : 'No pricing information provided'
}

export function usesBundledPricing(provider: ProviderView): boolean {
  if (provider.pricing?.trim()) return false
  const catalogId = bundledCatalogId(provider)
  return Boolean(catalogId && !['perplexity', 'you', 'linkup', 'zhipu', 'firecrawl-fetch', 'jina'].includes(catalogId) && Object.hasOwn(providerInfo, catalogId))
}

export function searchProviderInfo(provider: ProviderView, locale: 'zh' | 'en' = 'zh'): ProviderInfo {
  const catalogId = bundledCatalogId(provider)
  if (!catalogId) {
    const hostFallback = officialHostFallback[`${provider.kind}:${provider.id}`]
    const localizedDesc = locale === 'en' && provider.englishDescription?.trim()
      ? provider.englishDescription
      : provider.description
    if (hostFallback) {
      const idx = locale === 'zh' ? 0 : 1
      return {
        description: localizedDesc.trim() ? localizedDesc : hostFallback.description[idx],
        pricing: provider.pricing?.trim() ? provider.pricing : hostFallback.pricing[idx],
        pricingUrl: provider.pricingUrl ?? hostFallback.pricingUrl ?? provider.signupUrl,
      }
    }
    return {
      description: localizedDesc,
      pricing: provider.pricing?.trim() ? provider.pricing : missingPricing(locale),
      pricingUrl: provider.pricingUrl ?? provider.signupUrl,
    }
  }
  const base = Object.hasOwn(providerInfo, catalogId) ? providerInfo[catalogId] : undefined
  const known = base && locale === 'en' ? { ...base, ...englishInfo[catalogId] } : base
  const ownedCopy = bundledDescriptions[catalogId]
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
