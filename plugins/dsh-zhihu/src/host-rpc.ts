import { registerHostRpcTransport, sendHostRpcResponse, type HostRpcContext } from '@klarkxy/dsh-plugin-kit/host-rpc'

const CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/
const ENDPOINT_SEGMENT = /^[A-Za-z0-9_$.-]+$/
const MAX_BODY_BYTES = 64 * 1024 * 1024

export type { HostRpcContext }
export type HostRpcHandler = (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>

function isEndpoint(endpoint: string): boolean {
  return endpoint.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..' && ENDPOINT_SEGMENT.test(segment))
}

/** Zhihu keeps its gateway-compatible bad-request envelope and upload allowance. */
export function registerHostRpc(ctx: HostRpcContext, channel: string, handler: HostRpcHandler): () => void {
  if (!CHANNEL_PATTERN.test(channel) || channel === '/api') {
    throw new Error(`invalid RPC channel ${JSON.stringify(channel)}`)
  }
  return registerHostRpcTransport(ctx, channel, async (endpoint, body, signal, res) => {
    const record = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
    const rpcId = typeof record.rpcId === 'string' ? record.rpcId : 'invalid-request'
    if (record.type !== 'client-request' || record.method !== endpoint) {
      sendHostRpcResponse(res, rpcId, {
        ok: false,
        error: {
          code: 'gateway/bad-request',
          message: record.method !== endpoint
            ? `method ${JSON.stringify(record.method)} does not match endpoint ${JSON.stringify(endpoint)}`
            : 'invalid client-request message',
          details: { issues: [] },
        },
      }, false)
      return
    }
    sendHostRpcResponse(res, rpcId, await handler(endpoint, record.payload, signal), false)
  }, {
    maxBodyBytes: MAX_BODY_BYTES,
    isEndpoint,
    caseInsensitiveContentType: true,
    emptyBodyAsNull: true,
    errorBody: (status, error) => {
      if (status === 503) return 'host authorization policy is unavailable'
      if (status === 401) return 'unauthorized'
      if (status === 403) return 'forbidden'
      if (status === 404) return 'not found'
      if (status === 415) return 'content type must be application/json'
      if (status === 400) return 'body is not JSON'
      if (status === 500) return `handler failure: ${String(error)}`
      return undefined
    },
  })
}
