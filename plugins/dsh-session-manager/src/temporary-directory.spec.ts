import { mkdtemp, mkdir, readdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { allocateTemporaryDirectory } from './temporary-directory.ts'

const requestId = '40a2f2d0-9f3b-4b9e-bd2b-45346188bb31'

async function withProfile(run: (profile: string, root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'session-manager-directory-test-'))
  const profile = join(root, 'profile'); await mkdir(profile)
  try { await run(profile, root) } finally { await rm(root, { recursive: true, force: true }) }
}

describe('temporary directory boundary', () => {
  it('retains one profile-local directory per valid UUID and rejects paths, cancellation and junctions', async () => {
    await withProfile(async (profile, root) => {
      const signal = new AbortController().signal
      const first = await allocateTemporaryDirectory(profile, requestId, signal)
      expect(await allocateTemporaryDirectory(profile, requestId, signal)).toEqual(first)
      expect(first.path).toBe(join(profile, 'data', 'session-manager', 'workspaces', requestId))
      expect(await readdir(join(profile, 'data', 'session-manager', 'workspaces'))).toEqual([requestId])
      for (const id of ['../../elsewhere', '/absolute', '', {}, undefined]) {
        await expect(allocateTemporaryDirectory(profile, id, signal)).rejects.toThrow('Invalid')
      }
      await expect(allocateTemporaryDirectory(profile, requestId, AbortSignal.abort())).rejects.toThrow()
      const otherProfile = join(root, 'other'), external = join(root, 'external')
      await mkdir(otherProfile); await mkdir(external)
      await symlink(external, join(otherProfile, 'data'), 'junction')
      await expect(allocateTemporaryDirectory(otherProfile, requestId, signal)).rejects.toThrow('plain directory')
      expect(await readdir(external)).toEqual([])
    })
  })
})
