import type { WebFetchResult, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import {
  canJoinMultiSource, type FetchMode, type ProviderDescriptor, type ProviderKind, type SearchMode,
} from './contracts.ts'

export const RRF_K = 60

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'spm', 'from_source', 'vd_source', 'fbclid', 'gclid', 'msclkid', 'igshid', 'mc_cid', 'mc_eid',
])

export interface SearchBatch {
  readonly providerId: string
  readonly rankIndex: number
  readonly result: WebSearchResult
}

export interface CandidateEntry {
  readonly descriptor: ProviderDescriptor
  readonly kind: ProviderKind
}

const CLOUD_FETCH_IDS = new Set(['jina', 'firecrawl', 'deepseek-fetch-api'])

export function isCloudFetchProvider(id: string): boolean {
  return CLOUD_FETCH_IDS.has(id)
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map(part => Number(part))
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b] = parts as [number, number, number, number]
  return a === 0 || a === 10 || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127)
}

/** Classify an already-normalized hostname without node:net so client builds stay browser-safe. */
function classifyIp(host: string): 4 | 6 | 0 {
  if (host.includes(':')) return 6
  const parts = host.split('.')
  return parts.length === 4 && parts.every(part => /^\d+$/.test(part)) ? 4 : 0
}

function isPrivateIpv6(rawHost: string): boolean {
  const host = rawHost.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === '::' || host === '::1') return true
  if (host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb')) return true
  if (host.startsWith('fc') || host.startsWith('fd')) return true
  if (host.startsWith('::ffff:')) {
    // URL parsing compresses mapped tails to pure hex (::ffff:a00:1), so decode
    // the two tail hextets back to dotted quad before the v4 check.
    const tail = host.slice('::ffff:'.length)
    if (tail.includes('.')) return isPrivateIpv4(tail)
    const groups = tail.split(':')
    if (groups.length === 2) {
      const high = Number.parseInt(groups[0]!, 16), low = Number.parseInt(groups[1]!, 16)
      if (Number.isInteger(high) && Number.isInteger(low)) {
        return isPrivateIpv4(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`)
      }
    }
    return isPrivateIpv6(tail)
  }
  return false
}

/** True when a URL targets loopback, RFC1918/CGNAT/ULA space, or local-only hostnames. */
export function isPrivateOrLocalUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    const bare = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
    if (!bare) return true
    const ipKind = classifyIp(bare)
    if (ipKind === 4) return isPrivateIpv4(bare)
    if (ipKind === 6) return isPrivateIpv6(bare)
    if (bare === 'localhost' || !bare.includes('.')) return true
    return /\.(?:localhost|local|internal|lan|home|arpa|test|invalid)$/.test(bare)
  } catch {
    return true
  }
}

/** Group equivalent backend variants so parallel fusion never queries the same index twice. */
export function searchProviderFamily(id: string): string {
  if (id === 'deepseek-search-api' || id === 'deepseek-official' || id === 'deepseek-managed') return 'deepseek'
  return id
}

/** Normalize HTTP(S) URLs for cross-provider deduplication without mutating display URLs. */
export function canonicalSourceUrl(rawUrl: string): string | undefined {
  let parsed: URL
  try { parsed = new URL(rawUrl) } catch { return undefined }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return undefined
  parsed.hash = ''
  parsed.hostname = parsed.hostname.toLowerCase()
  if ((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443')) {
    parsed.port = ''
  }
  const kept: Array<[string, string]> = []
  for (const [key, value] of parsed.searchParams.entries()) {
    if (!TRACKING_PARAMS.has(key.toLowerCase())) kept.push([key, value])
  }
  kept.sort((left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]))
  parsed.search = ''
  for (const [key, value] of kept) parsed.searchParams.append(key, value)
  if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
  return parsed.href
}

function sanitizeSourceUrl(rawUrl: string): string | undefined {
  try {
    const parsed = new URL(rawUrl)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return undefined
    return parsed.href
  } catch { return undefined }
}

function preferTitle(existing: string | undefined, incoming: string | undefined, rawUrl: string): string | undefined {
  const cleanIncoming = incoming?.trim().slice(0, 1000)
  if (!cleanIncoming) return existing
  if (!existing) return cleanIncoming
  let host = ''
  try { host = new URL(rawUrl).hostname.toLowerCase() } catch { /* ignore */ }
  const existingLooksBare = existing.toLowerCase() === host || existing === rawUrl
  const incomingLooksBare = cleanIncoming.toLowerCase() === host || cleanIncoming === rawUrl
  if (existingLooksBare && !incomingLooksBare) return cleanIncoming
  return existing
}

function preferLongerText(existing: string | undefined, incoming: string | undefined, maxChars: number): string | undefined {
  const trimmed = incoming?.trim().slice(0, maxChars)
  if (!trimmed) return existing
  if (!existing || trimmed.length > existing.length) return trimmed
  return existing
}

/**
 * Merge parallel search batches with weighted Reciprocal Rank Fusion (RRF).
 * Higher-ranked providers break ties deterministically, while URLs corroborated
 * across multiple engines rise to the top with merged summary/snippet/date fields.
 */
export function fuseSearchResults(batches: readonly SearchBatch[], maxResults: number): WebSearchResult {
  type Aggregated = {
    score: number
    firstRankIndex: number
    firstItemIndex: number
    source: {
      url: string
      title?: string
      snippet?: string
      summary?: string
      publishedAt?: string
    }
  }
  const merged = new Map<string, Aggregated>()
  const contents: string[] = []
  let upstreamTruncated = false

  const orderedBatches = [...batches].sort((a, b) => a.rankIndex - b.rankIndex)
  for (const batch of orderedBatches) {
    if (batch.result.truncated) upstreamTruncated = true
    const content = batch.result.content?.trim()
    if (content) contents.push(content)
    // Priority bonus keeps #1 slightly ahead on single-engine hits without overpowering 2-engine consensus.
    const weight = 1 + 0.15 / (1 + batch.rankIndex)
    const seenInBatch = new Set<string>()
    let localRank = 0
    for (const raw of batch.result.sources) {
      const safeUrl = sanitizeSourceUrl(raw.url)
      const key = safeUrl ? canonicalSourceUrl(safeUrl) : undefined
      if (!safeUrl || !key) continue
      const existing = merged.get(key)
      if (!seenInBatch.has(key)) {
        seenInBatch.add(key)
        localRank += 1
        const delta = weight / (RRF_K + localRank)
        if (!existing) {
          const entry: Aggregated = {
            score: delta,
            firstRankIndex: batch.rankIndex,
            firstItemIndex: localRank,
            source: { url: safeUrl },
          }
          const title = preferTitle(undefined, raw.title, safeUrl)
          const snippet = preferLongerText(undefined, raw.snippet, 8000)
          const summary = preferLongerText(undefined, raw.summary, 8000)
          const publishedAt = raw.publishedAt?.trim() ? raw.publishedAt.trim() : undefined
          if (title) entry.source.title = title
          if (snippet) entry.source.snippet = snippet
          if (summary) entry.source.summary = summary
          if (publishedAt) entry.source.publishedAt = publishedAt
          merged.set(key, entry)
          continue
        }
        existing.score += delta
      }
      if (existing) {
        const title = preferTitle(existing.source.title, raw.title, existing.source.url)
        const snippet = preferLongerText(existing.source.snippet, raw.snippet, 8000)
        const summary = preferLongerText(existing.source.summary, raw.summary, 8000)
        if (title) existing.source.title = title
        if (snippet) existing.source.snippet = snippet
        if (summary) existing.source.summary = summary
        if (!existing.source.publishedAt && raw.publishedAt?.trim()) {
          existing.source.publishedAt = raw.publishedAt.trim()
        }
      }
    }
  }

  const ranked = [...merged.values()].sort((left, right) =>
    right.score - left.score
    || left.firstRankIndex - right.firstRankIndex
    || left.firstItemIndex - right.firstItemIndex)
  const sources: WebSearchSource[] = ranked.slice(0, maxResults).map(item => item.source)
  const combinedContent = contents.length ? contents.join('\n\n').slice(0, 40_000) : undefined
  return {
    ...(combinedContent ? { content: combinedContent } : {}),
    sources,
    truncated: upstreamTruncated || ranked.length > maxResults,
  }
}

/**
 * Select the ordered search execution plan.
 * Free / model-bundled sources join fusion & failover automatically; per-request
 * or unknown third-party sources join multi-source fan-out only when opted in.
 */
export function planSearchEntries<T extends CandidateEntry>(
  readyById: ReadonlyMap<string, T>,
  order: readonly string[],
  mode: SearchMode,
  maxParallel: number,
  multiSourceOptIn: readonly string[],
): T[] {
  const ordered = order.flatMap(id => {
    const entry = readyById.get(id)
    return entry ? [entry] : []
  })
  if (ordered.length === 0) return []
  const primary = ordered[0]!
  if (mode === 'single') return [primary]

  if (mode === 'failover') {
    const fallbacks = ordered.slice(1).filter(entry =>
      canJoinMultiSource(entry.descriptor, 'search', multiSourceOptIn))
    return [primary, ...fallbacks]
  }

  // Fusion mode: if the user explicitly ranked an un-opted paid source at #1,
  // execute that #1 choice alone rather than fanning out or skipping their #1 pick.
  if (!canJoinMultiSource(primary.descriptor, 'search', multiSourceOptIn)) {
    return [primary]
  }
  const selected: T[] = []
  const families = new Set<string>()
  const limit = Math.max(1, maxParallel)
  for (const entry of ordered) {
    if (!canJoinMultiSource(entry.descriptor, 'search', multiSourceOptIn)) continue
    const family = searchProviderFamily(entry.descriptor.id)
    if (families.has(family)) continue
    families.add(family)
    selected.push(entry)
    if (selected.length >= limit) break
  }
  return selected.length > 0 ? selected : [primary]
}

/**
 * Select the ordered fetch waterfall chain.
 * Private/local URLs never route through external cloud reader services.
 */
export function planFetchEntries<T extends CandidateEntry>(
  readyById: ReadonlyMap<string, T>,
  order: readonly string[],
  mode: FetchMode,
  multiSourceOptIn: readonly string[],
  targetUrl?: string,
): T[] {
  const localTarget = targetUrl !== undefined && isPrivateOrLocalUrl(targetUrl)
  const ordered = order.flatMap(id => {
    const entry = readyById.get(id)
    if (!entry) return []
    if (localTarget && isCloudFetchProvider(entry.descriptor.id)) return []
    return [entry]
  })
  if (ordered.length === 0) return []
  const primary = ordered[0]!
  if (mode === 'single') return [primary]
  const fallbacks = ordered.slice(1).filter(entry =>
    canJoinMultiSource(entry.descriptor, 'fetch', multiSourceOptIn))
  return [primary, ...fallbacks]
}

/** Non-2xx or blank fetch bodies trigger the next waterfall fallback when one exists. */
export function isUsableFetchResult(result: WebFetchResult): boolean {
  return result.statusCode >= 200 && result.statusCode < 400 && result.body.content.trim().length > 0
}
