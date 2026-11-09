/** 合并后的模型工具：检索类合并进 zhihu_research，账号/创作类合并进 zhihu_account。 */
export const ZHIHU_RESEARCH_TOOL_NAME = 'zhihu_research'
export const ZHIHU_ACCOUNT_TOOL_NAME = 'zhihu_account'
export const ZHIHU_SYNC_TOOL_NAME = 'zhihu_sync'
export const ZHIHU_RPC_CHANNEL = '/zhihu'
export const ZHIHU_CREDENTIAL_REF = 'ZHIHU_ACCESS_TOKEN'
export const ZHIHU_SEARCH_EVENT = 'dsh-editor/zhihu-search'
export type ZhihuRpcResult<T = unknown> = { ok: true; value: T } | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } }

/** Official quota IDs, not local execution counters or predicted balances. */
export const ZHIHU_QUOTA_IDS = [
  'global_search', 'zhihu_search', 'hot_list', 'question_discovery',
  'zhida_openai', 'tools', 'knowledge', 'user_data', 'creator',
] as const
export const normalizeZhihuQuotaId = (value: unknown): unknown => value === 'question_answers' ? 'question_discovery' : value
export type ZhihuQuotaId = typeof ZHIHU_QUOTA_IDS[number]
