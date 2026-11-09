import { defineTool } from '@deepseek-ai/dsh-tools'
import { ZHIHU_ACCOUNT_TOOL_NAME, ZHIHU_QUOTA_IDS } from './contracts.ts'
import { reportExecuted, ZhihuSearchError, type ZhihuClientOptions, type ZhihuSearchExecuted } from './zhihu-client.ts'
import {
  executeZhihuOpenPlatform, ZHIHU_OPEN_PLATFORM_APIS, zhihuOpenPlatformResultCount,
  type ZhihuOpenPlatformOperation, type ZhihuOpenPlatformResult,
} from './open-platform.ts'
import { renderZhihuOpenPlatform } from './open-platform-render.ts'

export type ZhihuOpenPlatformToolOptions = ZhihuClientOptions & { onExecuted?: (event: ZhihuSearchExecuted) => void }

const ZHIHU_ACCOUNT_ACTIONS = {
  question_recommendations: 'question.recommendations',
  question_answers: 'question.answers',
  content_detail: 'content.detail',
  content_comments: 'content.comments',
  creator_account_stats: 'creator.account.stats',
  creator_content_stats: 'creator.content.stats',
  quota: 'quota',
} as const
export type ZhihuAccountAction = keyof typeof ZHIHU_ACCOUNT_ACTIONS

const REQUIRED: Record<ZhihuAccountAction, string> = {
  question_recommendations: '主题 query 可选；省略按画像推荐。',
  question_answers: 'questionUrl 必填。',
  content_detail: 'contentUrl 必填。',
  content_comments: 'contentUrl 必填。',
  creator_account_stats: 'contentType 与日期可选。',
  creator_content_stats: 'contentUrl 必填。',
  quota: 'apiIds 可选。',
}

export function createZhihuAccountTool(options: ZhihuOpenPlatformToolOptions = {}) {
  const { onExecuted, ...client } = options
  return defineTool({
    name: ZHIHU_ACCOUNT_TOOL_NAME,
    description:
      '知乎账号数据（Access Secret 鉴权，拒绝 OAuth 切换；结果仅参考，不写入项目文件）。' +
      'action：question_recommendations 问题推荐；question_answers 回答摘要；content_detail 创作全文；content_comments 评论；creator_account_stats 账号数据；creator_content_stats 单篇数据；quota 额度。',
    parameters: {
      action: { type: 'string', enum: Object.keys(ZHIHU_ACCOUNT_ACTIONS), required: true },
      query: { type: 'string', description: 'question_recommendations 主题；省略按画像推荐。' },
      count: { type: 'integer', description: 'question_recommendations 数量，1-20，默认 5。' },
      questionUrl: { type: 'string', description: 'question_answers 必填，https://www.zhihu.com/question/{id} 链接。' },
      contentUrl: { type: 'string', description: 'content_detail、content_comments、creator_content_stats 必填：本人已发布的 HTTPS 回答/专栏/想法/视频链接。' },
      offset: { type: 'string', description: 'question_answers、content_comments 分页，非负 Int64 字符串，默认 "0"；翻页只用 paging.nextOffset。' },
      limit: { type: 'integer', description: 'question_answers、content_comments 每页条数，1-50，默认 20。' },
      order: { type: 'string', enum: ['score', 'reverse', 'ascending'], description: 'content_comments 排序，默认 score。' },
      contentType: { type: 'string', enum: ['all', 'answer', 'article', 'pin', 'zvideo'], description: 'creator_account_stats 内容类型，默认 all，不支持 question。' },
      startDate: { type: 'string', description: 'stats action 可选，YYYY-MM-DD，与 endDate 成对；都省略用上游默认范围。' },
      endDate: { type: 'string', description: 'YYYY-MM-DD，不得早于 startDate。' },
      apiIds: { type: 'array', items: { type: 'string', enum: [...ZHIHU_QUOTA_IDS, 'question_answers'] }, description: 'quota 可选额度项，默认全部。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render(_args, value) { return [{ type: 'text' as const, text: renderZhihuOpenPlatform(value as ZhihuOpenPlatformResult) }] },
    },
    isConcurrencySafe() { return true },
    async execute(args, exec) {
      const input = args as { action: ZhihuAccountAction; questionUrl?: string; contentUrl?: string }
      const operation = ZHIHU_ACCOUNT_ACTIONS[input.action]
      if ((operation === 'question.answers' && !input.questionUrl) || ((operation === 'content.detail' || operation === 'content.comments' || operation === 'creator.content.stats') && !input.contentUrl)) {
        throw new ZhihuSearchError('INVALID_ARGUMENTS', `action ${input.action} 缺少必填参数：${REQUIRED[input.action]}`)
      }
      const quotaId = ZHIHU_OPEN_PLATFORM_APIS[operation].quotaId
      try {
        const result = await executeZhihuOpenPlatform(operation, args, { ...client, signal: exec.signal })
        if (quotaId) reportExecuted(onExecuted, { ok: true, results: zhihuOpenPlatformResultCount(result), quotaId })
        return result
      } catch (error) {
        if (quotaId) reportExecuted(onExecuted, { ok: false, results: 0, quotaId })
        throw error
      }
    },
  })
}
