/**
 * Gateway address normalization. The result is the gateway root every
 * endpoint path is appended to, e.g. `http://192.168.1.5:3425`.
 */

export class AddressError extends Error {
  override name = 'AddressError'
}

export interface GatewayAddress {
  /** Normalized gateway root without a trailing slash or `/v1` suffix. */
  root: string
  /** Whether the address points at this computer. */
  loopback: boolean
}

const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1') return true
  return /^127(?:\.\d{1,3}){3}$/.test(host)
}

/** Normalize user input into a gateway root. Throws {@link AddressError}. */
export function normalizeGatewayAddress(input: string): GatewayAddress {
  const trimmed = input.trim()
  if (!trimmed) throw new AddressError('Gateway address is required')
  let url: URL
  try {
    url = new URL(SCHEME.test(trimmed) ? trimmed : `http://${trimmed}`)
  } catch {
    throw new AddressError(`Gateway address "${trimmed}" is not a valid URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AddressError('Gateway address must use http or https')
  }
  if (url.username || url.password) throw new AddressError('Gateway address must not contain credentials')
  if (url.search) throw new AddressError('Gateway address must not contain a query')
  if (url.hash) throw new AddressError('Gateway address must not contain a fragment')
  let path = url.pathname.replace(/\/+$/, '')
  if (path.endsWith('/v1')) path = path.slice(0, -3)
  const root = `${url.origin}${path}`
  return { root, loopback: isLoopbackHost(url.hostname) }
}
