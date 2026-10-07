import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { PLUGIN_NAME, resolveConfig, type Config as PluginConfig } from './contracts.ts'
import { createCursorKey } from './cursor.ts'
import { registerSessionTools } from './tools.ts'

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
})

export function apply(ctx: Context, config: PluginConfig = {}): void {
  const resolved = resolveConfig(config)
  const cursors = createCursorKey()
  ctx.effect(() => registerSessionTools(ctx, resolved, cursors))
}
