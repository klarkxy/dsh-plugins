import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { registerHostRpc, type HostRpcContext, type HostRpcHandler } from './host-rpc.ts'

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) =>
    server.close(error => error ? reject(error) : resolve()))))
})

async function host(authorized: boolean, call: HostRpcHandler = async () => ({ ok: true, value: 'ready' })) {
  let route!: Parameters<HostRpcContext['webServer']['register']>[0]
  const spy = vi.fn(call)
  registerHostRpc({
    connection: authorized ? { requestRejection: () => undefined } : {},
    webServer: { register: value => { route = value; return () => {} } },
  }, '/zhihu', spy)
  const server = createServer((req, res) => { void route.handler(req, res) })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No server address')
  return { spy, url: `http://127.0.0.1:${address.port}/zhihu/knowledge.bases` }
}

function request(url: string, body: string, contentType = 'application/json') {
  return fetch(url, { method: 'POST', headers: { 'content-type': contentType }, body })
}

it('rejects Zhihu operations when the host authorization policy is absent', async () => {
  const { spy, url } = await host(false)
  expect((await request(url, '{}')).status).toBe(503)
  expect(spy).not.toHaveBeenCalled()
})

it('keeps Zhihu gateway envelopes, fallback rpcId, and case-insensitive JSON content type', async () => {
  const { spy, url } = await host(true)
  const valid = await request(url, JSON.stringify({ type: 'client-request', rpcId: 'r1', method: 'knowledge.bases', payload: {} }), 'Application/JSON')
  expect(valid.status).toBe(200)
  expect(valid.headers.get('cache-control')).toBeNull()
  expect(await valid.json()).toEqual({ type: 'server-response', rpcId: 'r1', result: { ok: true, value: 'ready' } })
  const invalid = await request(url, JSON.stringify({ type: 'client-request', method: 'wrong' }))
  expect(invalid.status).toBe(200)
  expect(await invalid.json()).toEqual({
    type: 'server-response', rpcId: 'invalid-request', result: { ok: false, error: {
      code: 'gateway/bad-request',
      message: 'method "wrong" does not match endpoint "knowledge.bases"',
      details: { issues: [] },
    } },
  })
  const empty = await request(url, '')
  expect(empty.status).toBe(200)
  expect((await empty.json()).result.error.code).toBe('gateway/bad-request')
  expect(spy).toHaveBeenCalledTimes(1)
})

it('retains larger upload framing and segmented endpoints', async () => {
  const { spy, url } = await host(true, async (_endpoint, payload) => ({ ok: true, value: (payload as { text: string }).text.length }))
  const large = await request(url.replace('/knowledge.bases', '/knowledge/bases'), JSON.stringify({
    type: 'client-request', rpcId: 'large', method: 'knowledge/bases', payload: { text: 'x'.repeat(70 * 1024) },
  }))
  expect(large.status).toBe(200)
  expect((await large.json()).result.value).toBe(70 * 1024)
  expect(spy).toHaveBeenCalledOnce()
})

it('keeps handler failures at HTTP 500 and does not dispatch a malformed JSON body', async () => {
  const { url } = await host(true, async () => { throw new Error('fixture failure') })
  expect((await request(url, '{')).status).toBe(400)
  const response = await request(url, JSON.stringify({ type: 'client-request', rpcId: 'r1', method: 'knowledge.bases', payload: {} }))
  expect(response.status).toBe(500)
  expect(await response.text()).toContain('handler failure: Error: fixture failure')
})
