import { mkdtemp, mkdir, readdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { allocateTemporaryDirectory, registerTemporaryDirectoryRpc } from './temporary-directory.ts'

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

  it('applies host authentication before allocation and rejects caller-supplied paths', async () => {
    await withProfile(async profile => {
      let admitted = false, handler: any
      const stop = registerTemporaryDirectoryRpc({ get: () => ({ dir: profile }),
        connection: { requestRejection: () => admitted ? undefined : 401 },
        webServer: { register(route: any) { handler = route.handler; return () => {} } },
      } as never)
      const server = createServer((req, res) => { void handler(req, res) })
      await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
      const port = (server.address() as { port: number }).port
      const call = (payload: unknown) => fetch(`http://127.0.0.1:${port}/dsh-session-manager/temporary.allocate`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'test', method: 'temporary.allocate', payload }),
      })
      try {
        expect((await call({ requestId })).status).toBe(401)
        expect(await readdir(profile)).toEqual([])
        admitted = true
        const invalid = await (await call({ requestId, path: '/elsewhere' })).json()
        expect(invalid.result.ok).toBe(false)
        expect(await readdir(profile)).toEqual([])
        const valid = await (await call({ requestId })).json()
        expect(valid.result.ok).toBe(true)
        expect(valid.result.value.path).toBe(join(profile, 'data', 'session-manager', 'workspaces', requestId))
        stop()
        const retired = await (await call({ requestId: '90808efb-f2f5-4b59-96d5-4a3ca16cc1b7' })).json()
        expect(retired.result.ok).toBe(false)
      } finally {
        stop(); server.closeAllConnections()
        await new Promise<void>(done => server.close(() => done()))
      }
    })
  })
})
