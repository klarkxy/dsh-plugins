import type { Context } from '@deepseek-ai/cordis'
import { PLUGIN_NAME } from './contracts.ts'

export const name = PLUGIN_NAME

/**
 * The host half exists so the bundle has a loader row and a Plugins page — the
 * feature itself lives entirely in the client half: fonts are a property of the
 * rendering environment, settings persist browser-local, and the conversation
 * font size goes through the official `ctx.theme.setFontSize()` entry, which
 * already persists host-side. Nothing here needs a Host service.
 */
export function apply(_ctx: Context): void {
  /* no host services, no RPC, no model calls */
}
