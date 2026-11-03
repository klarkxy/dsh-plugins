/**
 * Thin read-only client for the magpie gateway. The gateway filters its model
 * listing per agent by User-Agent, so requests identify as deepseek-harness
 * and only ever issue GETs; no model inference endpoint is touched.
 */
import { GATEWAY_TIMEOUT_MS } from './contracts.ts'

export class GatewayError extends Error {
  readonly code: string
  readonly status?: number
  constructor(code: string, message: string, status?: number) {
    super(message)
    this.name = 'GatewayError'
    this.code = code
    this.status = status
  }
}

export interface GatewayClientDeps {
  fetchImpl?: typeof fetch
  userAgent: string
  /** Bearer token; omit when the gateway needs none. */
  key?: string
}

async function get(
  url: string,
  deps: GatewayClientDeps,
  signal?: AbortSignal,
): Promise<unknown> {
  const fetcher = deps.fetchImpl ?? fetch
  const timeout = AbortSignal.timeout(GATEWAY_TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([timeout, signal]) : timeout
  let response: Response
  try {
    response = await fetcher(url, {
      headers: {
        'user-agent': deps.userAgent,
        ...(deps.key ? { authorization: `Bearer ${deps.key}` } : {}),
      },
      signal: combined,
    })
  } catch (error) {
    if ((error as Error).name === 'AbortError' && signal?.aborted) throw error
    if ((error as Error).name === 'TimeoutError' || (error as Error).name === 'AbortError') {
      throw new GatewayError('timeout', `magpie gateway at ${url} did not answer within ${GATEWAY_TIMEOUT_MS / 1000}s`)
    }
    throw new GatewayError('unreachable', `magpie gateway at ${url} is not reachable: ${(error as Error).message}`)
  }
  if (response.status === 401 || response.status === 403) {
    throw new GatewayError('key-required', 'the gateway requires a key; create one with `magpie gateway-key add` and save it here', response.status)
  }
  if (!response.ok) throw new GatewayError('http', `magpie gateway answered HTTP ${response.status} for ${url}`, response.status)
  try {
    return await response.json()
  } catch {
    throw new GatewayError('bad-reply', `magpie gateway returned an unreadable reply for ${url}`)
  }
}

/** GET `/` and verify the service identifies as magpie; keeps the version. */
export async function fetchGatewayInfo(
  root: string,
  deps: GatewayClientDeps,
  signal?: AbortSignal,
): Promise<{ name: string; version?: string }> {
  const body = await get(`${root}/`, deps, signal) as { name?: unknown; version?: unknown }
  if (body?.name !== 'magpie') {
    throw new GatewayError('not-magpie', `${root} is not a magpie gateway (it answered "${String(body?.name ?? 'unknown')}")`)
  }
  return { name: 'magpie', version: typeof body.version === 'string' ? body.version : undefined }
}

/** GET `/v1/models`; returns the raw data array. Pagination is ignored. */
export async function fetchModels(
  root: string,
  deps: GatewayClientDeps,
  signal?: AbortSignal,
): Promise<unknown[]> {
  const body = await get(`${root}/v1/models`, deps, signal) as { data?: unknown }
  return Array.isArray(body?.data) ? body.data : []
}
