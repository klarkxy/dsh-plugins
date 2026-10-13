import { createContext, useCallback, useContext, useSyncExternalStore } from 'react'

/** Host locale tier the plugin copy is written in; anything not Chinese reads English. */
export type ZhihuLocale = 'zh' | 'en'

/** Structural host locale service (the `locale` Cordis service), value-free. */
export type HostLocaleService = {
  getSnapshot(): { active: string }
  subscribe(listener: () => void): () => void
}

/** Pick one of the two inline strings for the current locale. */
export type Translate = (zh: string, en: string) => string

/** Store plugin-owned copy without freezing it to the locale of an async action. */
export type ClientText = string | readonly [zh: string, en: string]
const responseErrors: Record<string, string> = {
  'RPC 返回格式无效。': 'Invalid RPC response format.',
  '开放平台响应格式无效。': 'Invalid Open Platform response format.',
  '响应额度项无效。': 'Invalid quota item in the response.',
  '分页响应格式无效。': 'Invalid paging response format.',
  '请求已取消': 'Request cancelled',
  '查询不超过 4000 字符': 'The query must be non-empty and no longer than 4,000 characters',
  '缺少文件内容。': 'File content is missing.',
  '文件内容无效或超过 20 MB': 'File content is invalid or exceeds 20 MB',
  '搜索词不能为空。': 'Search keywords cannot be empty.',
  '知识库文件名不能为空。': 'The knowledge base file name cannot be empty.',
  '知识库文件名不能包含控制字符。': 'The knowledge base file name cannot contain control characters.',
  '知识库文件名不能超过 255 个 UTF-8 字节。': 'The knowledge base file name cannot exceed 255 UTF-8 bytes.',
  '知识库文件内容不能为空。': 'The knowledge base file content cannot be empty.',
  '知识库文件大小不能超过 20MB。': 'The knowledge base file cannot exceed 20 MB.',
  '当前环境没有可用的 fetch。': 'No fetch implementation is available in this environment.',
  '知乎响应缺少 {Code,Message,Data} 信封。': 'The Zhihu response has no {Code,Message,Data} envelope.',
  '知乎响应缺少有效的 Code 字段。': 'The Zhihu response has no valid Code field.',
  '知乎直答响应不是 OpenAI 兼容格式。': 'The Zhihu direct answer response is not in an OpenAI-compatible format.',
  '知乎直答返回为空。': 'The Zhihu direct answer response is empty.',
  '分页信息不完整：缺少有效的 Paging.IsEnd，请停止翻页。': 'Paging is incomplete: no valid Paging.IsEnd. Stop paging.',
  '分页信息不完整：NextOffset 缺失、无效或未前进，请停止翻页；不要按条数计算偏移。': 'Paging is incomplete: NextOffset is missing, invalid or did not advance. Stop paging; do not calculate an offset from item counts.',
  '只允许请求知乎开放平台。': 'Only Zhihu Open Platform requests are allowed.',
  '参数必须是对象。': 'Parameters must be an object.',
  '这些接口仅使用当前 Access Secret，不接受 token 参数或 OAuth 身份切换。': 'These APIs use the current Access Secret only; token parameters and OAuth identity switching are not supported.',
  'offset 超出 Int64 范围。': 'offset exceeds the Int64 range.',
  'questionUrl 不能为空。': 'questionUrl cannot be empty.',
  'contentUrl 不能为空。': 'contentUrl cannot be empty.',
  '知乎链接不能包含空白、控制字符或反斜线。': 'Zhihu links cannot contain whitespace, control characters or backslashes.',
  '不是有效的知乎 URL。': 'Invalid Zhihu URL.',
  '必须使用无账号密码、无非标准端口的 HTTPS 知乎链接。': 'Use an HTTPS Zhihu link without credentials or a non-standard port.',
  'questionUrl 仅支持 https://www.zhihu.com/question/{id}。': 'questionUrl only supports https://www.zhihu.com/question/{id}.',
  'contentUrl 仅支持知乎回答、专栏文章、想法或视频链接。': 'contentUrl only supports Zhihu answer, article, pin or video links.',
  'startDate 与 endDate 必须同时提供或同时省略。': 'Provide both startDate and endDate, or omit both.',
  'endDate 不得早于 startDate。': 'endDate cannot be before startDate.',
  '主题关键词不能为空；省略 query 才会按画像推荐。': 'Topic keywords cannot be empty; omit query to get profile-based recommendations.',
  'contentType 必须是 all、answer、article、pin 或 zvideo。': 'contentType must be all, answer, article, pin or zvideo.',
  'apiIds 包含未知官方额度项。': 'apiIds contains unknown official quota items.',
  'order 必须是 score、reverse 或 ascending。': 'order must be score, reverse or ascending.',
}
const operationLabels: Record<string, string> = {
  '知乎搜索': 'Zhihu search', '知乎全网搜索': 'Zhihu web search', '知乎热榜': 'Zhihu trending',
  '知乎直答': 'Zhihu direct answer', '知乎知识库列表': 'Zhihu knowledge base list',
  '知乎知识库检索': 'Zhihu knowledge base search', '知乎知识库上传': 'Zhihu knowledge base upload',
  '适合回答的问题': 'Questions to answer', '问题回答摘要': 'Answer summaries', '本人创作全文': 'My full content',
  '本人创作评论': 'Comments on my content', '账号创作数据': 'Account creator stats',
  '单篇创作数据': 'Per-post creator stats', '官方每日额度': 'Official daily quota',
}
function diagnosticText(text: string, t: Translate): string {
  if (responseErrors[text]) return t(text, responseErrors[text])
  // Recognise our wrappers, retaining upstream payloads and counts verbatim.
  const upstream = text.match(/^知乎开放平台返回错误（code=(\d+)）：(.*)$/s)
  if (upstream) return t(text, `Zhihu Open Platform returned an error (code=${upstream[1]}): ${upstream[2]}`)
  const blocked = text.match(/^知乎开放平台被风控拒绝：(.*)。请不要立即重试。$/s)
  if (blocked) return t(text, `Zhihu Open Platform rejected the request through risk control: ${blocked[1]}. Do not retry immediately.`)
  for (const [label, english] of Object.entries(operationLabels)) {
    if (!text.startsWith(label)) continue
    const detail = text.slice(label.length)
    const http = detail.match(/^返回 HTTP (\d{3})。$/)
    if (http) return t(text, `${english} returned HTTP ${http[1]}.`)
    const timeout = detail.match(/^超时（(\d+) 秒），请稍后再试。$/)
    if (timeout) return t(text, `${english} timed out (${timeout[1]} seconds). Try again later.`)
    if (detail === '响应不是合法 JSON。') return t(text, `${english} did not return valid JSON.`)
    if (detail === '的 Data 必须是 JSON 对象。') return t(text, `${english} Data must be a JSON object.`)
    if (detail.startsWith('失败：')) return t(text, `${english} failed: ${detail.slice(3)}`)
    if (detail.startsWith('返回错误：')) return t(text, `${english} returned an error: ${detail.slice(5)}`)
  }
  return text
}
export function clientText(text: ClientText, t: Translate): string {
  if (typeof text !== 'string') return t(text[0], text[1])
  // RPC failures include a machine code before the diagnostic. Unknown upstream
  // diagnostics remain verbatim; only messages owned by this plugin are translated.
  const separator = text.indexOf('：')
  if (separator > 0 && /^[a-z-]+$/.test(text.slice(0, separator))) {
    const code = text.slice(0, separator)
    if (code === 'token-missing') return t('未配置有效的知乎 Access Secret，请到设置页配置。', 'A valid Zhihu Access Secret is missing. Configure it on the Settings tab.')
    const detail = text.slice(separator + 1)
    return `${code}: ${diagnosticText(detail, t)}`
  }
  return diagnosticText(text, t)
}

export function zhihuLocale(value: unknown): ZhihuLocale {
  return String(value ?? 'zh').startsWith('zh') ? 'zh' : 'en'
}

export function translator(locale: ZhihuLocale = 'zh'): Translate {
  return (zh, en) => (locale === 'en' ? en : zh)
}

/** Components below the settings root read the locale here instead of threading a prop. */
export const ZhihuLocaleContext = createContext<ZhihuLocale>('zh')

export function useZhihuLocale(): ZhihuLocale {
  return useContext(ZhihuLocaleContext)
}

// One stable function per locale: `t` sits in useCallback deps (e.g. a load
// callback an effect depends on), so a fresh closure per render would refetch forever.
const TRANSLATORS: Record<ZhihuLocale, Translate> = { zh: translator('zh'), en: translator('en') }

export function useT(): Translate {
  return TRANSLATORS[useZhihuLocale()]
}

/** Follow the host locale when the service is present; standalone renders stay Chinese. */
export function useHostLocale(service: HostLocaleService | undefined): ZhihuLocale {
  const subscribe = useCallback((listener: () => void) => (service ? service.subscribe(listener) : () => {}), [service])
  const snapshot = useCallback(() => (service ? service.getSnapshot().active : 'zh'), [service])
  return zhihuLocale(useSyncExternalStore(subscribe, snapshot, snapshot))
}
