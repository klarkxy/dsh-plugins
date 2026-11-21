import type { Context } from '@deepseek-ai/cordis'
import { installPluginLogger } from '@klarkxy/dsh-plugin-kit/logger'
import { PLUGIN_NAME } from './contracts.ts'

export const name = PLUGIN_NAME

/**
 * The host half exists so the bundle has a loader row — the feature itself
 * lives entirely in the client half: the mode store persists browser-local,
 * the presentation is a tagged-attribute stylesheet over the host AppFrame,
 * and all three switch entry points (header utility, General settings row,
 * keyboard command) are client slots and services. Nothing here needs a host
 * service.
 */
export function apply(ctx: Context): void {
  /* no host services, no RPC, no model calls */
  installPluginLogger(ctx, PLUGIN_NAME, { forwardHostWarnError: false })
}
