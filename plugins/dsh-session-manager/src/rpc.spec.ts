import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { resolveConfig } from './contracts.ts'
import { registerSessionManagerRpc } from './rpc.ts'

const requestId = '40a2f2d0-9f3b-4b9e-bd2b-45346188bb31'

function fakeObservation() {
  return {
    source: 'live' as const,
    header: { id: 's', createdAt: Date.now(), isSeeded: false, version: 5 },
    inheritedEventCount: 0,
    events: [],
    cursor: -1,
    [Symbol.dispose]() {},
  }
}

const presenceModelStore = (() => {
  const row = {
    revision: 0,
    model: null as { provider: string; model: string } | null,
    ghostModel: null as { provider: string; model: string } | null,
  }
  return {
    read: () => row,
    write: async (model: { provider: string; model: string } | null) => {
      row.model = model
      row.revision += 1
      return row.revision
    },
    writeGhost: async (model: { provider: string; model: string } | null) => {
      row.ghostModel = model
      row.revision += 1
      return row.revision
    },
  }
})()

async function withRpc(
  run: (
    call: (endpoint: string, payload?: unknown) => Promise<{ status: number; body: any }>,
    controls: { profile: string; rejectRequests: (status: number | undefined) => void; stop: () => void },
  ) => Promise<void>,
  modelStore?: () => typeof presenceModelStore | undefined,
) {
  const root = await mkdtemp(join(tmpdir(), 'session-manager-rpc-test-'))
  const profile = join(root, 'profile')
  await mkdir(profile)
  let handler: any
  let rejection: number | undefined
  const transport = {
    get: () => ({ dir: profile }),
    connection: { requestRejection: () => rejection },
    // Keep the captured handler so tests can probe a request retained across disposal.
    webServer: { register(route: any) { handler = route.handler; return () => {} } },
  }
  const rootCtx = {
    get: () => undefined,
    sessionQuery: { observeSession: async () => fakeObservation() },
  }
  const stop = registerSessionManagerRpc(rootCtx as never, transport as never, resolveConfig(), () => undefined, modelStore)
  const server = createServer((req, res) => {
    if (handler === undefined) { res.writeHead(404); res.end(); return }
    void handler(req, res)
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as { port: number }).port
  const call = async (endpoint: string, payload?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}/dsh-session-manager/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request', rpcId: 'test', method: endpoint,
        ...payload === undefined ? {} : { payload },
      }),
    })
    return { status: response.status, body: await response.json().catch(() => undefined) }
  }
  try {
    await run(call, { profile, rejectRequests: status => { rejection = status }, stop })
  } finally {
    stop()
    server.closeAllConnections()
    await new Promise<void>(done => server.close(() => done()))
    await rm(root, { recursive: true, force: true })
  }
}

describe('composed plugin channel', () => {
  it('routes every endpoint and rejects unknown ones and extra payload keys', async () => {
    await withRpc(async call => {
      const unknown = await call('welcomeback.unknown', {})
      expect(unknown.body.result).toMatchObject({ ok: false, error: { code: 'session-manager/invalid-request' } })
      const extra = await call('welcomeback.prepare', { sessionId: 's', admin: true })
      expect(extra.body.result).toMatchObject({ ok: false, error: { code: 'session-manager/invalid-request' } })
      const missingId = await call('continue.suggest', {})
      expect(missingId.body.result).toMatchObject({ ok: false, error: { code: 'session-manager/invalid-request' } })
      const missingRequest = await call('welcomeback.compact', { sessionId: 's' })
      expect(missingRequest.body.result).toMatchObject({ ok: false, error: { code: 'session-manager/invalid-request' } })
      const prepare = await call('welcomeback.prepare', { sessionId: 's' })
      expect(prepare.body.result).toEqual({ ok: true, value: { show: false } })
      const suggest = await call('continue.suggest', { sessionId: 's' })
      expect(suggest.body.result).toEqual({ ok: true, value: { text: null, pending: true } })
      const compact = await call('welcomeback.compact', { sessionId: 's', requestId })
      expect(compact.body.result).toMatchObject({ ok: false, error: { code: 'session-manager/unavailable' } })
      // Presence configuration: read returns the resolved view; write needs the host editor.
      const read = await call('config.read', {})
      expect(read.body.result).toEqual({
        ok: true,
        value: { recapMinutes: 15, compactMinutes: 60, continueText: '', continueMode: 'fixed', model: null, ghostModel: null },
      })
      const write = await call('config.write', { patch: { recapMinutes: 30 } })
      expect(write.body.result).toMatchObject({ ok: false, error: { code: 'session-manager/unavailable' } })
      // Without plugin storage a model patch degrades to unavailable too.
      const modelWrite = await call('config.write', { patch: { model: { provider: 'p', model: 'm' } } })
      expect(modelWrite.body.result).toMatchObject({ ok: false, error: { code: 'session-manager/unavailable' } })
      const badWrite = await call('config.write', { patch: { recapMinutes: -1 } })
      expect(badWrite.body.result).toMatchObject({ ok: false, error: { code: 'session-manager/invalid-request' } })
      const badModel = await call('config.write', { patch: { model: { provider: ' ' } } })
      expect(badModel.body.result).toMatchObject({ ok: false, error: { code: 'session-manager/invalid-request' } })
      const unknownKey = await call('config.write', { patch: { theme: 'dark' } })
      expect(unknownKey.body.result).toMatchObject({ ok: false, error: { code: 'session-manager/invalid-request' } })
      // The pre-existing temporary allocation endpoint keeps working through the same registration.
      const allocate = await call('temporary.allocate', { requestId })
      expect(allocate.body.result.ok).toBe(true)
      expect(allocate.body.result.value.path).toBe(join(profileMarker(allocate.body.result.value.path), 'data', 'session-manager', 'workspaces', requestId))
    })
  })

  it('authenticates allocation requests and prevents invalid or retired handlers from creating directories', async () => {
    await withRpc(async (call, controls) => {
      controls.rejectRequests(401)
      expect((await call('temporary.allocate', { requestId })).status).toBe(401)
      expect(await readdir(controls.profile)).toEqual([])
      controls.rejectRequests(undefined)
      for (const payload of [null, [], 'invalid', {}, { requestId: '../elsewhere' }, { requestId, path: '/elsewhere' }]) {
        const invalid = await call('temporary.allocate', payload)
        expect(invalid.body.result).toMatchObject({ ok: false, error: { code: 'session-manager/temporary-workspace' } })
        expect(await readdir(controls.profile)).toEqual([])
      }
      controls.stop()
      const retired = await call('temporary.allocate', { requestId })
      expect(retired.body.result.ok).toBe(false)
      expect(await readdir(controls.profile)).toEqual([])
    })
  })

  it('round-trips the model route through plugin storage when provided', async () => {
    await withRpc(async call => {
      const write = await call('config.write', { patch: { model: { provider: 'p', model: 'm' } } })
      expect(write.body.result).toMatchObject({ ok: true, value: { model: { provider: 'p', model: 'm' } } })
      const read = await call('config.read', {})
      expect(read.body.result).toMatchObject({ ok: true, value: { model: { provider: 'p', model: 'm' }, recapMinutes: 15 } })
      const cleared = await call('config.write', { patch: { model: null } })
      expect(cleared.body.result).toMatchObject({ ok: true, value: { model: null } })
    }, () => presenceModelStore)
  })

  it('requires the payload field', async () => {
    await withRpc(async call => {
      const noPayload = await call('welcomeback.prepare')
      expect(noPayload.status).toBe(400)
    })
  })
})

function profileMarker(path: string): string {
  // The allocated path is <profile>/data/session-manager/workspaces/<id>.
  return path.split(join('data', 'session-manager', 'workspaces'))[0]!.replace(/[\\/]$/, '')
}
