import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { isIP } from 'node:net'
import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { MiniMaxCodeError } from './contracts.ts'

export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0 && c === 113))
  }
  if (isIP(address) !== 6) return false
  const value = address.toLowerCase()
  // Only globally routed IPv6 unicast; mapped/compatible/local and documentation ranges are excluded.
  return /^[23][0-9a-f]{0,3}:/.test(value) && !/^2001:(?:db8|0):/.test(value)
}
export async function safeDownloadUrl(value: string): Promise<{ url: URL; address: string; family: number }> {
  let url: URL
  try { url = new URL(value) } catch { throw new MiniMaxCodeError('invalid-download', 'The media download URL is invalid.') }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new MiniMaxCodeError('invalid-download', 'Media downloads require a public HTTPS URL.')
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true })
  if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new MiniMaxCodeError('invalid-download', 'The media download URL does not resolve to a public address.')
  return { url, ...addresses[0] }
}
/** Download only a CLI-returned artifact URL; no vendor credentials or API calls enter this path. */
export async function downloadMedia(value: string, target: string, maxBytes: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  let current = value, complete = false, created = false
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      const { url, address, family } = await safeDownloadUrl(current)
      signal.throwIfAborted()
      const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
        // Pin the validated address so a second DNS resolution cannot change the destination.
        const req = request(url, { method: 'GET', signal, lookup: (_hostname, options, callback) => {
          if ((options as { all?: boolean }).all) (callback as any)(null, [{ address, family }])
          else (callback as any)(null, address, family)
        } }, resolve)
        req.once('error', reject); req.end()
      })
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && response.headers.location) {
        response.destroy(); current = new URL(response.headers.location, url).href; continue
      }
      if (response.statusCode !== 200 || Number(response.headers['content-length'] ?? 0) > maxBytes) { response.destroy(); throw new MiniMaxCodeError('download-failed', 'The media download failed or exceeded its size limit. The saved job can be queried again.') }
      let bytes = 0
      async function* bounded() {
        for await (const chunk of response) {
          signal.throwIfAborted(); bytes += chunk.length
          if (bytes > maxBytes) throw new MiniMaxCodeError('download-limit', 'The media download exceeded its size limit.')
          yield chunk
        }
      }
      const output = createWriteStream(target, { flags: 'wx' })
      output.once('open', () => { created = true })
      await pipeline(bounded(), output, { signal })
      if (!bytes) throw new MiniMaxCodeError('download-failed', 'The media download was empty.')
      complete = true; return
    }
    throw new MiniMaxCodeError('download-failed', 'The media download redirected too many times.')
  } finally { if (created && !complete) await rm(target, { force: true }) }
}
