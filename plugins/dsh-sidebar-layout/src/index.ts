import type { Context } from '@deepseek-ai/cordis'
import { installPluginLogger } from '@klarkxy/dsh-plugin-kit/logger'
import { PLUGIN_NAME } from './contracts.ts'
import { installSidebarOpenHost } from './sidebar-open.ts'

export const name = PLUGIN_NAME

/**
 * The host entry installs structured plugin logging and, when `tools` + `fs`
 * are present on the host context, registers the read-only `open_sidebar` tool
 * and top-level agent prompt section so models can preview workspace files and
 * HTTP(S) URLs directly in the right sidebar.
 */
export function apply(ctx: Context): void {
  const logger = installPluginLogger(ctx, PLUGIN_NAME, { forwardHostWarnError: false })
  installSidebarOpenHost(ctx, logger)
}
