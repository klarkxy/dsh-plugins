import type { Context } from '@deepseek-ai/cordis'
import { PLUGIN_NAME } from './contracts.ts'

export const name = PLUGIN_NAME

/**
 * The host half exists so the bundle has a loader row — the feature itself
 * lives entirely in the client half, which contributes its own Font section
 * page. Fonts are a property of the rendering environment, the conversation
 * font persists browser-local, and every host-backed write goes through the
 * official `ctx.theme` entries. Nothing here needs a Host service.
 */
export function apply(_ctx: Context): void {
  /* no host services, no RPC, no model calls */
}
