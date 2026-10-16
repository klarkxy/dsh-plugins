import type { Context } from '@deepseek-ai/cordis'

export const name = '@klarkxy/dsh-shortcuts'

/**
 * Provide the loader row and Plugins page for the client feature. Native
 * shortcut preferences remain owned by the host's shortcuts service; the
 * command palette and its additional Web opening key live in the client.
 */
export function apply(_ctx: Context): void {
  /* no host services, no RPC, no model calls */
}
