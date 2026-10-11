import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RpcResult } from './contracts.ts'

export interface HostRpcContext {
  webServer: { register(route: { kind: 'prefix'; path: string; handler(req: IncomingMessage, res: ServerResponse): void | Promise<void> }): () => void }
  connection: { requestRejection?: (request: IncomingMessage) => number | undefined }
}

type Rejection = { status: number; body?: string }

export interface HostRpcTransportOptions {
  maxBodyBytes?: number
  isEndpoint?: (endpoint: string) => boolean
  caseInsensitiveContentType?: boolean
  emptyBodyAsNull?: boolean
  beforeBody?: (request: IncomingMessage, endpoint: string) => Rejection | undefined
  errorBody?: (status: number, error?: unknown) => string | undefined
}

export interface HostRpcOptions extends HostRpcTransportOptions {
  requirePayload?: boolean
}

/** The shared authenticated HTTP boundary. Each plugin still owns its RPC envelope semantics. */
export function registerHostRpcTransport(
  ctx: HostRpcContext,
  channel: string,
  dispatch: (endpoint: string, body: unknown, signal: AbortSignal, response: ServerResponse) => void | Promise<void>,
  options: HostRpcTransportOptions = {},
): () => void {
  const bodyLimit = options.maxBodyBytes ?? 64 * 1024
  if (!Number.isSafeInteger(bodyLimit) || bodyLimit <= 0) throw new Error('Invalid RPC body limit')
  const isEndpoint = options.isEndpoint ?? ((endpoint: string) => /^[a-z.]+$/.test(endpoint))
  return ctx.webServer.register({ kind: 'prefix', path: channel, handler: async (req, res) => {
    const reject = (status: number, error?: unknown, override?: string) => {
      if (res.destroyed) return
      if (status === 413) res.writeHead(status, { connection: 'close' })
      else res.writeHead(status)
      res.end(override ?? options.errorBody?.(status, error) ?? (status === 500 ? 'rpc request failed' : ''))
    }
    try {
      // Host admission always runs before plugin-specific checks or body reads.
      if (typeof ctx.connection.requestRejection !== 'function') { reject(503); return }
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined) { reject(rejection); return }
      const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
      const endpoint = pathname.startsWith(`${channel}/`) ? pathname.slice(channel.length + 1) : ''
      if (req.method !== 'POST' || !isEndpoint(endpoint)) { reject(404); return }
      const contentType = String(req.headers['content-type'] ?? '').split(';', 1)[0]?.trim()
      if ((options.caseInsensitiveContentType ? contentType.toLowerCase() : contentType) !== 'application/json') {
        reject(415); return
      }
      const guarded = options.beforeBody?.(req, endpoint)
      if (guarded) { reject(guarded.status, undefined, guarded.body); return }

      const controller = new AbortController()
      res.on('close', () => { if (!res.writableEnded) controller.abort() })
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += buffer.length
        if (size > bodyLimit) { reject(413); req.destroy(); return }
        chunks.push(buffer)
      }
      let body: unknown
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || (options.emptyBodyAsNull ? 'null' : '')) }
      catch { reject(400); return }
      await dispatch(endpoint, body, controller.signal, res)
    } catch (error) {
      reject(500, error)
    }
  } })
}

/** Write the native Connection response envelope after a plugin has handled a request. */
export function sendHostRpcResponse(response: ServerResponse, rpcId: string, result: unknown, noStore = true): void {
  if (response.destroyed) return
  response.writeHead(200, { 'content-type': 'application/json', ...(noStore ? { 'cache-control': 'no-store' } : {}) })
  response.end(JSON.stringify({ type: 'server-response', rpcId, result }))
}

/** Safe host RPC registration. Missing requestRejection fails closed. */
export function registerHostRpc<R extends RpcResult = RpcResult>(
  ctx: HostRpcContext,
  channel: string,
  call: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<R>,
  options: HostRpcOptions = {},
): () => void {
  return registerHostRpcTransport(ctx, channel, async (endpoint, body, signal, res) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) { res.writeHead(400); res.end(); return }
    const request = body as Record<string, unknown>
    if (request.type !== 'client-request' || request.method !== endpoint || typeof request.rpcId !== 'string'
      || (options.requirePayload && !Object.hasOwn(request, 'payload'))) {
      res.writeHead(400); res.end(); return
    }
    const raw = await call(endpoint, request.payload, signal)
    const result = raw.ok ? raw : { ...raw, error: { details: {}, ...raw.error } }
    sendHostRpcResponse(res, request.rpcId, result)
  }, options)
}
