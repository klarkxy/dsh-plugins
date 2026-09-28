import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  ZHIHU_QUESTION_RECOMMENDATIONS_TOOL_NAME, ZHIHU_QUESTION_ANSWERS_TOOL_NAME,
  ZHIHU_CONTENT_DETAIL_TOOL_NAME, ZHIHU_CONTENT_COMMENTS_TOOL_NAME,
  ZHIHU_CREATOR_ACCOUNT_STATS_TOOL_NAME, ZHIHU_CREATOR_CONTENT_STATS_TOOL_NAME,
} from './contracts.ts'
import { reportExecuted } from './zhihu-client.ts'
import type { ZhihuToolOptions } from './operations.ts'
import type { ZhihuQuotaId } from './quota.ts'
import {
  executeZhihuQuestionRecommendations, executeZhihuQuestionAnswers, executeZhihuContentDetail,
  executeZhihuContentComments, executeZhihuCreatorAccountStats, executeZhihuCreatorContentStats,
  renderZhihuQuestionRecommendations, renderZhihuQuestionAnswers, renderZhihuContentDetail,
  renderZhihuContentComments, renderZhihuCreatorAccountStats, renderZhihuCreatorContentStats,
  zhihuOpenResultCount, ZHIHU_COMMENT_ORDERS, ZHIHU_CREATOR_CONTENT_TYPES,
  type ZhihuOpenResult, type ZhihuRecommendationsArgs, type ZhihuAnswersArgs,
  type ZhihuContentArgs, type ZhihuCommentsArgs, type ZhihuAccountStatsArgs, type ZhihuContentStatsArgs,
} from './open-platform.ts'

const pageParameters = {
  offset: { type: 'string', description: '非负 Int64 的十进制字符串，默认 "0"；原样使用上一页 NextOffset，不能按条数推算。' },
  limit: { type: 'integer', description: '单页数量 1-50，默认 20；短页或空页不代表结束。' },
} as const
const contentParameters = {
  contentUrl: { type: 'string', required: true, description: '当前账号已发布的回答、专栏文章、想法或视频 HTTPS 链接。' },
} as const
const dateParameters = {
  startDate: { type: 'string', description: 'YYYY-MM-DD，必须与 endDate 同时提供或同时省略；省略时使用上游默认范围。' },
  endDate: { type: 'string', description: 'YYYY-MM-DD，不得早于 startDate。' },
} as const
const outputSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    version: { type: 'integer', required: true },
    data: { type: 'object', required: true, additionalProperties: true, description: '上游 Data，保留缺失字段、比例和原始内容；超出安全整数的 Int64 返回十进制字符串。' },
    paging: { type: 'object', additionalProperties: false, properties: {
      canContinue: { type: 'boolean', required: true },
      nextOffset: { type: 'string' },
      reason: { type: 'string' },
    } },
  },
} as const
const access = '仅使用当前 Access Secret，不接受 OAuth 身份切换或指定他人。'

function handlers<A>(options: ZhihuToolOptions, quotaId: ZhihuQuotaId,
  execute: (args: A, options: ZhihuToolOptions) => Promise<ZhihuOpenResult>,
  render: (result: ZhihuOpenResult) => string) {
  const { onExecuted, ...client } = options
  return {
    output: { schema: outputSchema, render(_args: unknown, value: unknown) { return [{ type: 'text' as const, text: render(value as ZhihuOpenResult) }] } },
    isConcurrencySafe() { return true },
    async execute(args: unknown, exec: { signal: AbortSignal }) {
      try {
        const result = await execute(args as A, { ...client, signal: exec.signal })
        reportExecuted(onExecuted, { ok: true, results: zhihuOpenResultCount(result), quotaId })
        return result
      } catch (error) {
        reportExecuted(onExecuted, { ok: false, results: 0, quotaId })
        throw error
      }
    },
  }
}
export function createZhihuQuestionRecommendationsTool(options: ZhihuToolOptions = {}) {
  return defineTool({
    name: ZHIHU_QUESTION_RECOMMENDATIONS_TOOL_NAME,
    description: `推荐适合回答的问题。省略 query 按当前账号画像推荐；传入非空 query 按主题推荐。不支持分页，返回数可少于 Count。${access}共用 creator 额度。`,
    parameters: {
      query: { type: 'string', description: '可选主题关键词，空白字符串无效；省略才按画像推荐。' },
      count: { type: 'integer', description: '数量 1-20，默认 5。' },
    },
    ...handlers<ZhihuRecommendationsArgs>(options, 'creator', executeZhihuQuestionRecommendations, renderZhihuQuestionRecommendations),
  })
}
export function createZhihuQuestionAnswersTool(options: ZhihuToolOptions = {}) {
  return defineTool({
    name: ZHIHU_QUESTION_ANSWERS_TOOL_NAME,
    description: `读取问题下的回答摘要。Summary 不是全文或额外生成的 AI 摘要。仅在 paging.canContinue=true 时使用 nextOffset；缺失、无效或未递增时停止。${access}使用 question_answers 额度。`,
    parameters: { questionUrl: { type: 'string', required: true, description: 'https://www.zhihu.com/question/{id}，不能是回答链接。' }, ...pageParameters },
    ...handlers<ZhihuAnswersArgs>(options, 'question_answers', executeZhihuQuestionAnswers, renderZhihuQuestionAnswers),
  })
}
export function createZhihuContentDetailTool(options: ZhihuToolOptions = {}) {
  return defineTool({
    name: ZHIHU_CONTENT_DETAIL_TOOL_NAME,
    description: `读取本人已发布创作全文。视频只返回关联正文；空正文不能视为全文。展示时清洗 HTML。${access}共用 creator 额度。`,
    parameters: contentParameters,
    ...handlers<ZhihuContentArgs>(options, 'creator', executeZhihuContentDetail, renderZhihuContentDetail),
  })
}
export function createZhihuContentCommentsTool(options: ZhihuToolOptions = {}) {
  return defineTool({
    name: ZHIHU_CONTENT_COMMENTS_TOOL_NAME,
    description: `读取本人创作下的根评论及附带子评论，子评论不保证完整。只在 paging.canContinue=true 时使用 nextOffset，缺失或未递增时停止；不因短页或空页停止。${access}共用 creator 额度。`,
    parameters: { ...contentParameters, ...pageParameters, order: { type: 'string', enum: [...ZHIHU_COMMENT_ORDERS], description: 'score（默认，热度）、reverse（时间倒序）、ascending（时间正序）。' } },
    ...handlers<ZhihuCommentsArgs>(options, 'creator', executeZhihuContentComments, renderZhihuContentComments),
  })
}
export function createZhihuCreatorAccountStatsTool(options: ZhihuToolOptions = {}) {
  return defineTool({
    name: ZHIHU_CREATOR_ACCOUNT_STATS_TOOL_NAME,
    description: `读取账号创作指标、创作数量、粉丝概览和可用受众画像。未返回的指标不补零，比例保持原值，不换算百分比。${access}共用 creator 额度。`,
    parameters: { contentType: { type: 'string', enum: [...ZHIHU_CREATOR_CONTENT_TYPES], description: '内容类型，默认 all。' }, ...dateParameters },
    ...handlers<ZhihuAccountStatsArgs>(options, 'creator', executeZhihuCreatorAccountStats, renderZhihuCreatorAccountStats),
  })
}
export function createZhihuCreatorContentStatsTool(options: ZhihuToolOptions = {}) {
  return defineTool({
    name: ZHIHU_CREATOR_CONTENT_STATS_TOOL_NAME,
    description: `读取单篇已发布创作的阅读、互动、转粉和可用受众画像。空 Items 不等于指标为零；不补零，不换算比例。${access}共用 creator 额度。`,
    parameters: { ...contentParameters, ...dateParameters },
    ...handlers<ZhihuContentStatsArgs>(options, 'creator', executeZhihuCreatorContentStats, renderZhihuCreatorContentStats),
  })
}
