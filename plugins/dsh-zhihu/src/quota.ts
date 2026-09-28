/** Official quota groups from zhihu-search PR #4. These are categories, not remaining balances. */
export const ZHIHU_QUOTA_IDS = [
  'global_search', 'zhihu_search', 'hot_list', 'question_answers',
  'zhida_openai', 'tools', 'knowledge', 'user_data', 'creator',
] as const
export type ZhihuQuotaId = typeof ZHIHU_QUOTA_IDS[number]

export const ZHIHU_ENDPOINT_QUOTAS = {
  search: 'zhihu_search',
  'global.search': 'global_search',
  'hot.list': 'hot_list',
  ask: 'zhida_openai',
  'knowledge.search': 'knowledge',
  'knowledge.bases': 'knowledge',
  'knowledge.upload': 'knowledge',
  'question.recommendations': 'creator',
  'question.answers': 'question_answers',
  'content.detail': 'creator',
  'content.comments': 'creator',
  'creator.account.stats': 'creator',
  'creator.content.stats': 'creator',
} as const satisfies Record<string, ZhihuQuotaId>

export function zhihuEndpointQuota(endpoint: string): ZhihuQuotaId | undefined {
  return ZHIHU_ENDPOINT_QUOTAS[endpoint as keyof typeof ZHIHU_ENDPOINT_QUOTAS]
}
