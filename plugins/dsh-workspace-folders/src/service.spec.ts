import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile, symlink } from 'node:fs/promises'
import path from 'node:path'
import { WorkspaceFoldersService, canonicalDirectory, handleRpc, type WorkspaceLike } from './service.ts'
import type { FolderRecord } from './contracts.ts'

let root: string, primary: string, extra: string, service: WorkspaceFoldersService
let rows: Map<string, FolderRecord>, workspaces: Map<string, WorkspaceLike>
const signal = () => new AbortController().signal
beforeEach(async () => {
  await mkdir('.scratch/workspace-folders-unit', { recursive: true })
  root = await mkdtemp(path.resolve('.scratch/workspace-folders-unit/run-'))
  primary = path.join(root, 'primary'); extra = path.join(root, 'extra')
  await Promise.all([mkdir(primary), mkdir(extra)])
  rows = new Map(); workspaces = new Map([
    ['one', { id: 'one', path: primary, title: 'One', sessionIds: ['s1'] }],
    ['two', { id: 'two', path: extra, title: 'Two', sessionIds: ['s2'] }],
  ])
  service = new WorkspaceFoldersService({ get: id => workspaces.get(id), list: () => [...workspaces.values()] }, {
    get: id => rows.get(id), put: async (id, value) => { rows.set(id, value) },
  })
})
afterEach(async () => { await service.dispose(); await rm(root, { recursive: true, force: true }) })

describe('workspace folder storage', () => {
  it('keeps primary cwd and isolates settings by workspace identity', async () => {
    const saved = await service.save('one', [extra], 0, signal())
    expect(saved).toMatchObject({ primaryPath: primary, folders: [extra], revision: 1 })
    expect(service.get('two').folders).toEqual([])
    expect(workspaces.get('one')?.path).toBe(primary)
    saved.folders.push('mutation')
    expect(service.get('one').folders).toEqual([extra])
  })
  it('canonicalizes aliases and deduplicates primary and extra directories', async () => {
    const alias = path.join(root, 'alias')
    await symlink(extra, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const result = await service.save('one', [primary, extra, extra + path.sep, alias], 0, signal())
    expect(result.folders).toEqual([extra])
    expect((await service.save('one', [extra], 1, signal())).revision).toBe(1)
  })
  it('removes folders without deleting files and persists across service recreation', async () => {
    await writeFile(path.join(extra, 'keep.txt'), 'retained')
    await service.save('one', [extra], 0, signal())
    const reopened = new WorkspaceFoldersService(service.registry, service.table)
    expect(reopened.get('one').folders).toEqual([extra])
    await reopened.save('one', [], 1, signal())
    expect(await canonicalDirectory(extra)).toBe(extra)
    expect(service.get('one').folders).toEqual([])
    await reopened.dispose()
  })
  it('rejects concurrent stale writes including first writes', async () => {
    const results = await Promise.allSettled([
      service.save('one', [extra], 0, signal()), service.save('one', [], 0, signal()),
    ])
    expect(results[0].status).toBe('fulfilled')
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'stale' } })
    expect(service.get('one').folders).toEqual([extra])
  })
  it('rejects missing paths and files without committing a partial list', async () => {
    await writeFile(path.join(root, 'file'), 'not a directory')
    for (const invalid of [path.join(root, 'file'), path.join(root, 'missing')]) {
      await expect(service.save('one', [extra, invalid], 0, signal())).rejects.toMatchObject({ code: 'not-directory' })
      expect(service.get('one').revision).toBe(0)
    }
  })
  it('rejects relative paths and control characters', async () => {
    for (const invalid of ['relative', '../extra', 'C:relative', primary + '\nspoof']) {
      await expect(canonicalDirectory(invalid)).rejects.toMatchObject({ code: 'invalid-path' })
    }
  })
  it('lets a missing saved folder be removed', async () => {
    await service.save('one', [extra], 0, signal())
    await rm(extra, { recursive: true })
    expect(service.get('one').folders).toEqual([extra])
    expect((await service.save('one', [], 1, signal())).folders).toEqual([])
  })
  it('keeps the previous record on persistence failure', async () => {
    await service.save('one', [extra], 0, signal())
    service.table.put = async () => { throw new Error('disk unavailable') }
    await expect(service.save('one', [], 1, signal())).rejects.toThrow('disk unavailable')
    expect(service.get('one')).toMatchObject({ folders: [extra], revision: 1 })
  })
  it('rejects cancelled requests, unknown and deleted workspaces', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(service.save('one', [extra], 0, controller.signal)).rejects.toThrow()
    expect(rows.size).toBe(0)
    expect(() => service.get('missing')).toThrow()
    workspaces.delete('one')
    await expect(service.save('one', [extra], 0, signal())).rejects.toMatchObject({ code: 'not-found' })
  })
  it('validates RPC payloads and exposes only directory management', async () => {
    expect(await handleRpc(service, 'get', { workspaceId: 'one' }, signal())).toMatchObject({ ok: true, value: { folders: [] } })
    expect(await handleRpc(service, 'validate', { workspaceId: 'one', path: extra }, signal())).toEqual({ ok: true, value: { path: extra } })
    for (const payload of [{}, { workspaceId: 'one', folders: [], expectedRevision: -1 }, { workspaceId: 'one', folders: [extra], expectedRevision: 0, cwd: extra }]) {
      expect(await handleRpc(service, 'save', payload, signal())).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    }
    expect(await handleRpc(service, 'execute', {}, signal())).toMatchObject({ ok: false, error: { code: 'not-found' } })
    expect(await handleRpc(service, 'save', { workspaceId: 'one', folders: Array(65).fill(extra), expectedRevision: 0 }, signal())).toMatchObject({ ok: false, error: { code: 'bad-request' } })
  })
})
