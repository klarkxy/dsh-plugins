import type { Context } from '@deepseek-ai/cordis'
import { installPluginLogger } from '@klarkxy/dsh-plugin-kit/logger'

/**
 * Model picker, node half. Pure UI plugin: the empty apply exists so the
 * plugin appears in the host Loader; the browser half ships via
 * exports["./client"], discovered through the package.json dsh.client
 * declaration.
 */
/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(ctx?: Context): void {
  if (ctx) installPluginLogger(ctx, '@klarkxy/dsh-model-picker', { forwardHostWarnError: false })
}
