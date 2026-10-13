import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { PLUGIN_NAME, resolveConfig, type Config as PluginConfig } from './contracts.ts'
import { createCursorKey } from './cursor.ts'
import { registerSessionTools } from './tools.ts'
import { registerTemporaryDirectoryRpc } from './temporary-directory.ts'
import type { HostRpcContext } from '@klarkxy/dsh-plugin-kit/host-rpc'

export const name = PLUGIN_NAME
export const inject = ['tools', 'sessionQuery'] as const

export interface Config {
  pageChars?: number
  listLimit?: number
  searchLimit?: number
}

export const Config: Schema<Config> = Schema.object({
  pageChars: Schema.number().default(4_000),
  listLimit: Schema.number().default(20),
  searchLimit: Schema.number().default(20),
}).i18n({
  zh: {
    pageChars: '每页阅读内容的输出上限（UTF-8 字节）',
    listLimit: '每页会话列表的数量上限',
    searchLimit: '每页搜索结果的数量上限',
  },
  en: {
    pageChars: 'Maximum reading content per page (UTF-8 bytes)',
    listLimit: 'Maximum sessions per list page',
    searchLimit: 'Maximum search results per page',
  },
})

export function apply(ctx: Context, config: PluginConfig = {}): void {
  const resolved = resolveConfig(config)
  const cursors = createCursorKey()
  ctx.effect(() => registerSessionTools(ctx, resolved, cursors))
  // CLI-only hosts still load the query tools; the browser RPC follows its own services.
  ctx.inject(['connection', 'webServer'], inner => {
    inner.effect(() => registerTemporaryDirectoryRpc(inner as Context & HostRpcContext))
  })
}
