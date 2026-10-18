import type { Context } from '@deepseek-ai/cordis'
import { PLUGIN_NAME } from './contracts.ts'

export const name = PLUGIN_NAME

/**
 * The Host half exists so the bundle has a loader row. The preset itself is
 * declared by `cordis.patch.yml`, and the only behaviour this package adds on
 * top — the warning colour inside the preset card — is browser-side. Nothing
 * here opens a service, calls a model, or changes a prompt.
 */
export function apply(_ctx: Context): void {
  /* no host services, no RPC, no model calls */
}
