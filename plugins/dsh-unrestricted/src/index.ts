/**
 * Root host entry of the bundle.
 *
 * The loader mounts this row for the package's browser half. The preset-scoped
 * runtime lives in `./runtime` and is mounted inside the preset's own plugin
 * list, which gives its prompt/turn listeners the active Agent scope without a
 * global `composedPreset` check.
 */

import type { Context } from '@deepseek-ai/cordis'
import { installPluginLogger } from '@klarkxy/dsh-plugin-kit/logger'
import { PLUGIN_NAME } from './contracts.ts'

export const name = PLUGIN_NAME

/** The root row carries the browser half and owns no host runtime behaviour. */
export function apply(ctx: Context): void {
  // Intentionally empty: the runtime is mounted by `./runtime` inside the preset.
  installPluginLogger(ctx, PLUGIN_NAME, { forwardHostWarnError: false })
}
