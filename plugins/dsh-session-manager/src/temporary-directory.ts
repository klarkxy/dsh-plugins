import { lstat, mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { registerHostRpc, type HostRpcContext } from '@klarkxy/dsh-plugin-kit/host-rpc'
import { TEMP_WORKSPACE_CHANNEL } from './contracts.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Allocate only beneath the active profile. Replaying a request retains its directory.
 * No user paths, session formats, free-session metadata or deletion are involved.
 */
export async function allocateTemporaryDirectory(profileDir: string, requestId: unknown, signal: AbortSignal) {
  if (typeof requestId !== 'string' || !UUID.test(requestId)) throw new Error('Invalid temporary workspace request ID')
  signal.throwIfAborted()
  let directory = await realpath(profileDir)
  for (const part of ['data', 'session-manager', 'workspaces', requestId.toLowerCase()]) {
    signal.throwIfAborted()
    directory = join(directory, part)
    try { await mkdir(directory) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const stat = await lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Temporary workspace path is not a plain directory')
  }
  signal.throwIfAborted()
  return { requestId, path: directory }
}

/** The profileContext is supplied by app-boot, exactly as other profile-local plugins use it. */
export function registerTemporaryDirectoryRpc(ctx: Context & HostRpcContext): () => void {
  const profile = ctx.get('profileContext') as { dir?: string } | undefined
  if (!profile?.dir) throw new Error('Session Manager requires the active profile directory')
  const lifetime = new AbortController()
  const unregister = registerHostRpc(ctx, TEMP_WORKSPACE_CHANNEL, async (endpoint, payload, signal) => {
    try {
      if (endpoint !== 'temporary.allocate') throw new Error('Unknown Session Manager operation')
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || Object.keys(payload).some(key => key !== 'requestId')) throw new Error('Invalid temporary workspace request')
      const value = await allocateTemporaryDirectory(profile.dir!, (payload as { requestId?: unknown }).requestId,
        AbortSignal.any([signal, lifetime.signal]))
      return { ok: true, value }
    } catch (error) {
      return { ok: false, error: { code: 'session-manager/temporary-workspace',
        message: error instanceof Error ? error.message : 'Could not allocate the temporary workspace' } }
    }
  }, { requirePayload: true })
  return () => { lifetime.abort(); unregister() }
}
