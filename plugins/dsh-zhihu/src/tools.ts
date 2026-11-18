import type { Context } from '@deepseek-ai/cordis'
import type { ZhihuService } from './index.ts'
import { createZhihuResearchTool } from './tool-definitions.ts'
import { createZhihuAccountTool } from './open-platform-tools.ts'
import { createZhihuSyncTool } from './sync-tools.ts'
import { createZhihuStudyTool } from './study.ts'
import { createZhihuStudyReportTool } from './study-report.ts'
export const name = 'dsh-zhihu-tools'
export const inject = ['zhihu', 'tools'] as const
export function apply(ctx: Context): void {
  const host = ctx as Context & { zhihu: ZhihuService; tools: { register: (tool: unknown) => unknown } }
  const options = host.zhihu.toolOptions
  if (host.zhihu.syncCall) host.tools.register(createZhihuSyncTool(host.zhihu))
  const register = (tool: ReturnType<typeof createZhihuStudyTool>) => {
    const execute = tool.execute as unknown as (args: unknown, exec: { signal: AbortSignal; agent?: { session?: unknown } }) => Promise<unknown>
    host.tools.register({ ...tool, execute: (args: unknown, exec: { signal: AbortSignal; agent?: { session?: unknown } }) =>
      host.zhihu.run(signal => execute(args, { ...exec, signal }), exec.signal) })
  }
  for (const create of [createZhihuResearchTool, createZhihuAccountTool, createZhihuStudyTool]) register(create(options))
  register(createZhihuStudyReportTool(session => {
    const sandbox = (ctx as { get?(name: string): { resolve?(input: { session?: unknown }): { workspaceRoot?: string; mode?: string } } | undefined }).get?.('sandboxPolicy')
    if (!sandbox?.resolve) return undefined
    return sandbox.resolve({ session })
  }))
}
