import type { Context } from '@deepseek-ai/cordis'
import type { ZhihuService } from './index.ts'
import { createZhihuResearchTool } from './tool-definitions.ts'
import { createZhihuAccountTool } from './open-platform-tools.ts'
import { createZhihuSyncTool } from './sync-tools.ts'
export const name = 'dsh-zhihu-tools'
export const inject = ['zhihu', 'tools'] as const
export function apply(ctx: Context): void {
  const host = ctx as Context & { zhihu: ZhihuService; tools: { register: (tool: unknown) => unknown } }
  const options = host.zhihu.toolOptions
  if (host.zhihu.syncCall) host.tools.register(createZhihuSyncTool(host.zhihu))
  for (const create of [createZhihuResearchTool, createZhihuAccountTool]) {
    const tool = create(options)
    const execute = tool.execute as unknown as (args: unknown, exec: { signal: AbortSignal }) => Promise<unknown>
    host.tools.register({ ...tool, execute: (args: unknown, exec: { signal: AbortSignal }) =>
      host.zhihu.run(signal => execute(args, { ...exec, signal }), exec.signal) })
  }
}
