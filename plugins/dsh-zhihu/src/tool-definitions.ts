import { defineTool } from '@deepseek-ai/dsh-tools'
import { reportExecuted, ZhihuSearchError, type ZhihuClientOptions, type ZhihuSearchExecuted } from './zhihu-client.ts'
import { ZHIHU_RESEARCH_TOOL_NAME, type ZhihuQuotaId } from './contracts.ts'
import { executeZhihuSearch, renderZhihuSearch, ZHIHU_SEARCH_DEFAULT_COUNT, ZHIHU_SEARCH_MAX_COUNT, type ZhihuSearchResult } from './search-api.ts'
import {
  ZHIHU_GLOBAL_SEARCH_DEFAULT_COUNT, ZHIHU_GLOBAL_SEARCH_MAX_COUNT,
  ZHIHU_HOT_LIST_DEFAULT_LIMIT, ZHIHU_HOT_LIST_MAX_LIMIT,
  ZHIHU_KNOWLEDGE_SEARCH_DEFAULT_LIMIT, ZHIHU_KNOWLEDGE_SEARCH_MAX_LIMIT,
  ZHIHU_ASK_MODELS, ZHIHU_ASK_DEFAULT_MODEL, ZHIHU_RECALL_SCOPES,
  executeZhihuGlobalSearch, renderZhihuGlobalSearch, readZhihuGlobalFilter,
  executeZhihuHotList, renderZhihuHotList,
  executeZhihuAsk, renderZhihuAsk,
  normalizeRecallScopes, executeZhihuKnowledgeSearch, renderZhihuKnowledgeSearch,
  type ZhihuAskModel, type ZhihuToolOptions, type ZhihuGlobalSearchDb, type ZhihuGlobalFilterInput,
  type ZhihuGlobalSearchResult, type ZhihuHotListResult, type ZhihuAskResult,
  type ZhihuKnowledgeSearchResult,
} from './operations.ts'
export type CreateZhihuSearchToolOptions = ZhihuClientOptions & {
  /** Best-effort metering hook; invoked after every execution, failures included. */
  onExecuted?: (event: ZhihuSearchExecuted) => void
}

const ZHIHU_RESEARCH_ACTIONS = ['search', 'global_search', 'hot_list', 'ask', 'knowledge_search'] as const
export type ZhihuResearchAction = (typeof ZHIHU_RESEARCH_ACTIONS)[number]
const RESEARCH_QUOTA_IDS: Record<ZhihuResearchAction, ZhihuQuotaId> = {
  search: 'zhihu_search',
  global_search: 'global_search',
  hot_list: 'hot_list',
  ask: 'zhida_openai',
  knowledge_search: 'knowledge',
}

/** 合并前的五个检索工具各自执行逻辑不变，这里只按 action 分发。 */
export function executeZhihuResearchAction(
  action: ZhihuResearchAction,
  args: { query?: string; count?: number; limit?: number; searchDb?: string; model?: string; recallScopes?: unknown; host?: unknown; hostOperator?: unknown; publishTime?: unknown; publishTimeOperator?: unknown },
  client: ZhihuClientOptions,
  signal: AbortSignal,
): Promise<{ result: ZhihuSearchResult | ZhihuGlobalSearchResult | ZhihuHotListResult | ZhihuAskResult | ZhihuKnowledgeSearchResult; results: number }> {
  const options = { ...client, signal }
  const filter = readZhihuGlobalFilter(args)
  if (filter && action !== 'global_search') throw new ZhihuSearchError('INVALID_ARGUMENTS', 'host 和 publishTime 只适用于 global_search。')
  if (action === 'search') {
    return executeZhihuSearch(args.query!, args.count ?? ZHIHU_SEARCH_DEFAULT_COUNT, options)
      .then(result => ({ result, results: result.items.length }))
  }
  if (action === 'global_search') {
    const searchDb: ZhihuGlobalSearchDb = args.searchDb === 'realtime' || args.searchDb === 'static' ? args.searchDb : 'all'
    return executeZhihuGlobalSearch(args.query!, args.count ?? ZHIHU_GLOBAL_SEARCH_DEFAULT_COUNT, searchDb, { ...options, ...(filter ? { filter } : {}) })
      .then(result => ({ result, results: result.items.length }))
  }
  if (action === 'hot_list') {
    return executeZhihuHotList(args.limit ?? ZHIHU_HOT_LIST_DEFAULT_LIMIT, options)
      .then(result => ({ result, results: result.items.length }))
  }
  if (action === 'ask') {
    const model: ZhihuAskModel = (ZHIHU_ASK_MODELS as readonly string[]).includes(args.model ?? '')
      ? (args.model as ZhihuAskModel)
      : ZHIHU_ASK_DEFAULT_MODEL
    return executeZhihuAsk(args.query!, model, options).then(result => ({ result, results: result.content ? 1 : 0 }))
  }
  return executeZhihuKnowledgeSearch(args.query!, args.limit ?? ZHIHU_KNOWLEDGE_SEARCH_DEFAULT_LIMIT, normalizeRecallScopes(args.recallScopes), options)
    .then(result => ({ result, results: result.items.length }))
}

function renderResearch(action: ZhihuResearchAction, value: unknown): string {
  if (action === 'search') return renderZhihuSearch(value as ZhihuSearchResult)
  if (action === 'global_search') return renderZhihuGlobalSearch(value as ZhihuGlobalSearchResult)
  if (action === 'hot_list') return renderZhihuHotList(value as ZhihuHotListResult)
  if (action === 'ask') return renderZhihuAsk(value as ZhihuAskResult)
  return renderZhihuKnowledgeSearch(value as ZhihuKnowledgeSearchResult)
}

export function createZhihuResearchTool(options: ZhihuToolOptions = {}) {
  const { onExecuted, ...client } = options
  return defineTool({
    name: ZHIHU_RESEARCH_TOOL_NAME,
    description:
      '知乎检索与问答（结果仅作对话内的社区参考资料）。' +
      'action：search 站内检索；global_search 全网检索；hot_list 热榜；ask 知乎直答；knowledge_search 知识库检索。',
    parameters: {
      action: { type: 'string', enum: ZHIHU_RESEARCH_ACTIONS, required: true },
      query: { type: 'string', description: '检索词，2-100 字符；除 hot_list 外必填。' },
      count: { type: 'integer', description: `search 1-${ZHIHU_SEARCH_MAX_COUNT}（默认 ${ZHIHU_SEARCH_DEFAULT_COUNT}）、global_search 1-${ZHIHU_GLOBAL_SEARCH_MAX_COUNT}（默认 ${ZHIHU_GLOBAL_SEARCH_DEFAULT_COUNT}）。` },
      limit: { type: 'integer', description: `hot_list 1-${ZHIHU_HOT_LIST_MAX_LIMIT}（默认 ${ZHIHU_HOT_LIST_DEFAULT_LIMIT}）、knowledge_search 1-${ZHIHU_KNOWLEDGE_SEARCH_MAX_LIMIT}（默认 ${ZHIHU_KNOWLEDGE_SEARCH_DEFAULT_LIMIT}）。` },
      searchDb: { type: 'string', enum: ['all', 'realtime', 'static'], description: 'global_search 检索库，默认 all；近况检索使用 realtime。' },
      host: { type: 'string', description: 'global_search 站点域名过滤（仅支持知乎站外独立域名，按字段值传入域名）。' },
      hostOperator: { type: 'string', enum: ['eq', 'ne'], description: 'host 比较运算，默认 eq。' },
      publishTime: { type: 'integer', description: 'global_search 条目发布时间过滤（Unix 秒级时间戳，按页面发布时间筛选）。' },
      publishTimeOperator: { type: 'string', enum: ['gte', 'gt', 'lte', 'lt', 'eq', 'ne'], description: 'publishTime 比较运算，默认 gte。' },
      model: { type: 'string', description: 'ask 模型：zhida-thinking-1p5（默认，带推理）、zhida-fast-1p5（快速问答）、zhida-agent（深度分析，仅在用户明确指定时选用）；仅在免费额度内调用。' },
      recallScopes: { type: 'array', description: 'knowledge_search 召回范围，默认 public；可加 personal/subscription。', items: { type: 'string', enum: [...ZHIHU_RECALL_SCOPES] } },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {},
      },
      render(args, value) {
        return [{ type: 'text' as const, text: renderResearch((args as { action: ZhihuResearchAction }).action, value) }]
      },
    },
    isConcurrencySafe() { return true },
    async execute(args, exec) {
      const typed = args as { action: ZhihuResearchAction; query?: string; count?: number; limit?: number; searchDb?: string; model?: string; recallScopes?: unknown }
      if (typed.action !== 'hot_list' && (typeof typed.query !== 'string' || !typed.query.trim())) {
        throw new ZhihuSearchError('INVALID_ARGUMENTS', `action ${typed.action} 需要 query 参数。`)
      }
      try {
        const { result, results } = await executeZhihuResearchAction(typed.action, typed, client, exec.signal)
        reportExecuted(onExecuted, { ok: true, results, quotaId: RESEARCH_QUOTA_IDS[typed.action] })
        return result
      } catch (error) {
        reportExecuted(onExecuted, { ok: false, results: 0, quotaId: RESEARCH_QUOTA_IDS[typed.action] })
        throw error
      }
    },
  })
}
