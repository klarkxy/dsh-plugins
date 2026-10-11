import { registerHostRpc as registerSharedHostRpc, type HostRpcContext } from '@klarkxy/dsh-plugin-kit/host-rpc'
import type { RpcResult } from './contracts.ts'

export type { HostRpcContext }

/** Keep the historical transport error text while sharing admission and request handling. */
export function registerHostRpc(
  ctx: HostRpcContext,
  channel: string,
  call: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult>,
): () => void {
  return registerSharedHostRpc(ctx, channel, call, {
    errorBody: status => status === 500 ? 'network settings request failed' : undefined,
  })
}
