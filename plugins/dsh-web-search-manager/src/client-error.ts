/** Local adapter diagnostics only; third-party descriptions remain verbatim. */
const localErrors: Record<string, string> = {
  '网络搜索设置格式无效。': 'Invalid web search settings format.',
  '未知操作。': 'Unknown operation.',
  '网络设置操作失败，请刷新后重试。': 'The network settings operation failed. Refresh and try again.',
  '查询须为 1 至 4000 字符。': 'The query must contain 1 to 4,000 characters.',
  '网络搜索插件已停止。': 'The web search plugin has stopped.',
  '请在设置 → 网络搜索中配置凭据并启用。': 'Configure credentials and enable web search in Settings → Web search.',
  '网络访问设置已改变，请重新发起请求。': 'Network access settings changed. Start the request again.',
  '网络请求已取消。': 'The network request was cancelled.',
  '网络请求已取消或超时。': 'The network request was cancelled or timed out.',
  '设置已被其他页面修改，请刷新后重试。': 'Settings changed in another page. Refresh and try again.',
  '供应商不支持自定义地址。': 'The provider does not support a custom address.',
  '供应商地址须为无凭据、无查询参数的 HTTPS 地址。': 'The provider address must use HTTPS without credentials or query parameters.',
  '需选择已安装的供应商并填写有效凭据。': 'Choose an installed provider and enter valid credentials.',
  '保存失败，本次运行已暂停网络访问以防意外联网。': 'Saving failed. Network access is paused for this run to prevent unintended requests.',
  '供应商未提供错误描述。': 'The provider did not supply an error description.',
  '供应商请求失败。': 'Provider request failed.',
  '搜索凭据已删除或不可用，请重新配置。': 'Search credentials were deleted or are unavailable. Configure them again.',
  '供应商配置不可用。': 'Provider configuration is unavailable.',
  '查询无效。': 'Invalid query.',
  '结果数须为 1 至 20。': 'The result count must be from 1 to 20.',
  '搜索已取消。': 'Search cancelled.',
  'Tavily 搜索已取消。': 'Tavily search cancelled.',
  '响应格式无效。': 'Invalid response shape',
  '响应缺失。': 'Missing response',
  '响应过大。': 'Response too large',
  '地址无效。': 'Invalid endpoint',
}

export function localErrorText(message: string, locale: 'zh' | 'en'): string {
  const prefix = message.match(/^(\[(?:search|fetch):[^\]]+\] )(.*)$/s)
  if (prefix) return prefix[1] + localErrorText(prefix[2], locale)
  if (locale === 'zh') {
    const known = Object.entries(localErrors).find(([, english]) => english === message)
    return known?.[0] ?? message
  }
  if (localErrors[message]) return localErrors[message]
  const http = message.match(/^供应商请求失败（HTTP (\d{3})）。$/)
  if (http) return `Provider request failed (HTTP ${http[1]}).`
  const config = message.match(/^(brave|bocha|firecrawl|serper|Tavily) 配置不可用。$/)
  if (config) return `${config[1]} configuration is unavailable.`
  return message
}
