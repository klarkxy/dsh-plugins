import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import type { PluginLogger } from '@klarkxy/dsh-plugin-kit/log-shared'
import { z } from 'zod'
import type { FolderRecord, WorkspaceFoldersSnapshot, RpcResult } from './contracts.ts'

export class FoldersError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}
export interface WorkspaceLike { id: string; path: string; title: string; sessionIds: readonly string[] }
export interface FolderTable { get(id: string): FolderRecord | undefined; put(id: string, value: FolderRecord): Promise<void> }
export interface WorkspaceRegistryLike { get(id: string): WorkspaceLike | undefined; list(): WorkspaceLike[] }
export const pathKey = (value: string) => process.platform === 'win32' ? path.normalize(value).toLowerCase() : path.normalize(value)

export async function canonicalDirectory(value: string): Promise<string> {
  // Windows drive-relative paths and rooted-without-drive paths are not absolute host identities.
  if (!path.isAbsolute(value) || (process.platform === 'win32' && !/^(?:[a-z]:[\\/]|\\\\)/i.test(value)) || /[\x00-\x1f]/.test(value)) {
    throw new FoldersError('invalid-path', 'Choose an absolute directory path.')
  }
  try {
    const canonical = await realpath(value)
    if (!(await stat(canonical)).isDirectory()) throw new FoldersError('not-directory', 'The selected path is not a directory.')
    return canonical
  } catch (error) {
    if (error instanceof FoldersError) throw error
    throw new FoldersError('not-directory', 'The selected directory is missing or cannot be accessed.')
  }
}

const identity = z.object({ workspaceId: z.string().min(1).max(256) }).strict()
const validateRequest = identity.extend({ path: z.string().min(1).max(32768) })
const saveRequest = identity.extend({ folders: z.array(z.string().min(1).max(32768)).max(64), expectedRevision: z.number().int().nonnegative() })

export class WorkspaceFoldersService {
  // Serialize validation + persistence together so two first writes cannot both accept revision zero.
  private tail: Promise<unknown> = Promise.resolve()
  private disposed = false
  constructor(
    readonly registry: WorkspaceRegistryLike,
    readonly table: FolderTable,
    private readonly pickerKind?: 'native' | 'browse',
    private readonly logger?: PluginLogger,
  ) {}
  workspace(id: string): WorkspaceLike {
    if (this.disposed) throw new FoldersError('disposed', 'Workspace Folders is disabled.')
    const workspace = this.registry.get(id)
    if (!workspace) throw new FoldersError('not-found', 'The workspace no longer exists.')
    return workspace
  }
  get(id: string): WorkspaceFoldersSnapshot {
    const workspace = this.workspace(id), row = this.table.get(id)
    return { workspaceId: id, title: workspace.title, primaryPath: workspace.path, folders: [...(row?.folders ?? [])], revision: row?.revision ?? 0, ...(this.pickerKind ? { pickerKind: this.pickerKind } : {}) }
  }
  async validate(id: string, value: string) {
    this.workspace(id)
    return { path: await canonicalDirectory(value) }
  }
  save(id: string, folders: string[], expectedRevision: number, signal: AbortSignal): Promise<WorkspaceFoldersSnapshot> {
    const run = this.tail.then(async () => {
      signal.throwIfAborted()
      const before = this.get(id)
      if (before.revision !== expectedRevision) throw new FoldersError('stale', 'Folders changed in another window. Reopen the dialog and try again.')
      const canonical = await Promise.all(folders.map(canonicalDirectory))
      const seen = new Set([pathKey(before.primaryPath)])
      const unique = canonical.filter(folder => { const key = pathKey(folder); if (seen.has(key)) return false; seen.add(key); return true })
      signal.throwIfAborted()
      this.workspace(id)
      if (unique.length === before.folders.length && unique.every((folder, i) => folder === before.folders[i])) return before
      const revision = before.revision + 1
      try { await this.table.put(id, { folders: unique, revision }) }
      catch (error) {
        this.logger?.fault('folders.persist-failed', 'Failed to persist workspace folders.', error, { workspaceId: id, revision })
        throw error
      }
      this.logger?.info('folders.saved', 'Saved workspace folders.', { workspaceId: id, count: unique.length, revision })
      return this.get(id)
    })
    this.tail = run.catch(() => {})
    return run
  }
  async dispose() { this.disposed = true; await this.tail }
}

export async function handleRpc(
  service: WorkspaceFoldersService,
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
  logger?: PluginLogger,
): Promise<RpcResult> {
  try {
    signal.throwIfAborted()
    if (endpoint === 'get') {
      const request = identity.parse(payload)
      return { ok: true, value: service.get(request.workspaceId) }
    }
    if (endpoint === 'validate') {
      const request = validateRequest.parse(payload)
      return { ok: true, value: await service.validate(request.workspaceId, request.path) }
    }
    if (endpoint === 'save') {
      const request = saveRequest.parse(payload)
      return { ok: true, value: await service.save(request.workspaceId, request.folders, request.expectedRevision, signal) }
    }
    throw new FoldersError('not-found', 'Unknown operation.')
  } catch (error) {
    if (error instanceof FoldersError || error instanceof z.ZodError) {
      logger?.debug('rpc.domain-error', error instanceof z.ZodError ? 'Invalid workspace folder request.' : error.message, {
        endpoint, code: error instanceof FoldersError ? error.code : 'bad-request',
      })
    } else if (!signal.aborted) {
      logger?.error('rpc.internal-error', 'Unexpected workspace folders RPC error.', error, { endpoint })
    }
    return { ok: false, error: {
      code: error instanceof FoldersError ? error.code : error instanceof z.ZodError ? 'bad-request' : 'internal',
      message: error instanceof z.ZodError ? 'Invalid workspace folder request.' : error instanceof Error ? error.message : String(error),
    } }
  }
}
