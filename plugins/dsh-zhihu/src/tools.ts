import type { Context } from '@deepseek-ai/cordis'
import type { ZhihuService } from './index.ts'
import { createZhihuSearchTool, createZhihuGlobalSearchTool, createZhihuHotListTool, createZhihuAskTool, createZhihuKnowledgeSearchTool } from './tool-definitions.ts'
import {
  createZhihuQuestionRecommendationsTool, createZhihuQuestionAnswersTool,
  createZhihuContentDetailTool, createZhihuContentCommentsTool,
  createZhihuCreatorAccountStatsTool, createZhihuCreatorContentStatsTool,
} from './open-platform-tools.ts'
import { zhihuEndpointQuota } from './quota.ts'
import type { ZhihuSearchExecuted } from './zhihu-client.ts'
export const name = 'dsh-zhihu-tools'
export const inject = ['zhihu', 'tools'] as const
export function apply(ctx: Context): void {
  const host = ctx as Context & { zhihu: ZhihuService; tools: { register: (tool: unknown) => unknown } }
  const options = host.zhihu.toolOptions
  for (const create of [createZhihuSearchTool, createZhihuGlobalSearchTool, createZhihuHotListTool, createZhihuAskTool, createZhihuKnowledgeSearchTool,
    createZhihuQuestionRecommendationsTool, createZhihuQuestionAnswersTool, createZhihuContentDetailTool,
    createZhihuContentCommentsTool, createZhihuCreatorAccountStatsTool, createZhihuCreatorContentStatsTool]) {
    const tool = create({ ...options, onExecuted: (event: ZhihuSearchExecuted) => options.onExecuted({
      ...event, quotaId: event.quotaId ?? zhihuEndpointQuota(tool.name.replace(/^zhihu_/, '').replaceAll('_', '.')),
    }) })
    const execute = tool.execute as unknown as (args: unknown, exec: { signal: AbortSignal }) => Promise<unknown>
    host.tools.register({ ...tool, execute: (args: unknown, exec: { signal: AbortSignal }) =>
      host.zhihu.run(signal => execute(args, { ...exec, signal }), exec.signal) })
  }
}
