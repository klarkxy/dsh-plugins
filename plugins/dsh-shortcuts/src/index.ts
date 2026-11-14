import type { Context } from '@deepseek-ai/cordis'
import { installPluginLogger } from '@klarkxy/dsh-plugin-kit/logger'

export const name = '@klarkxy/dsh-shortcuts'

/**
 * Provide the loader row for the client feature. The shortcut manager lives on
 * the Settings page; native shortcut preferences remain owned by the host's
 * shortcuts service, and the command palette and its additional Web opening key
 * live in the client.
 */
export function apply(ctx: Context): void {
  /* no host services, no RPC, no model calls */
  installPluginLogger(ctx, name, { forwardHostWarnError: false })
}
