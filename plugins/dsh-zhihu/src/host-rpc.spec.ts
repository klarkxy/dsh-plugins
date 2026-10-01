import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { registerHostRpc, type HostRpcContext } from './host-rpc.ts'

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) =>
    server.close(error => error ? reject(error) : resolve()))))
})

it('rejects Zhihu operations when the host authorization policy is absent', async () => {
  let handler!: Parameters<HostRpcContext['webServer']['register']>[0]['handler']
  const call = vi.fn(async () => ({ ok: true }))
  registerHostRpc({ connection: {}, webServer: { register: route => {
    handler = route.handler; return () => {}
  } } }, '/zhihu', call)
  const server = createServer((req, res) => { void handler(req, res) })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No server address')
  const response = await fetch(`http://127.0.0.1:${address.port}/zhihu/knowledge.bases`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  })
  expect(response.status).toBe(503)
  expect(call).not.toHaveBeenCalled()
})
