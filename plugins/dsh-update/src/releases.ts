import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  DSH_GITHUB_OWNER,
  DSH_GITHUB_REPO,
  DSH_RELEASES_WEB_URL,
  compareSemver,
  extractTagVersion,
  inferUpdateChannel,
  parseSemver,
  satisfiesDshRange,
  selectReleasesBetween,
  splitBilingualReleaseBody,
  type DshUpdateCheckRequest,
  type DshUpdateCheckResult,
  type PluginRepoRef,
  type PluginSourceKind,
  type ReleaseLogEntry,
  type UpdateChannel,
} from './contracts.ts'

const execFileAsync = promisify(execFile)

export const DEFAULT_CACHE_TTL_MS = 3 * 60 * 1000
export const DEFAULT_HTTP_TIMEOUT_MS = 10_000
export const OFFICIAL_NPM_REGISTRY = 'https://registry.npmjs.org'
export const FALLBACK_NPM_REGISTRY = 'https://registry.npmmirror.com'

export interface RawGitHubRelease {
  tag_name?: unknown
  name?: unknown
  body?: unknown
  published_at?: unknown
  created_at?: unknown
  html_url?: unknown
  draft?: unknown
  prerelease?: unknown
}

export interface FetchEnvironment {
  fetchFn?: typeof fetch
  ghApiFn?: (endpoint: string, signal?: AbortSignal) => Promise<unknown | undefined>
  env?: NodeJS.ProcessEnv
  now?: () => number
  cacheTtlMs?: number
}

type CacheRecord<T> = {
  expiresAt: number
  value: T
}

export class ReleaseMetadataResolver {
  private readonly releaseCache = new Map<string, CacheRecord<RawGitHubRelease[]>>()
  private readonly packumentCache = new Map<string, CacheRecord<NpmPackument>>()
  private ghState: 'unknown' | 'ready' | 'unavailable' = 'unknown'
  private readonly fetchFn: typeof fetch
  private readonly ghApiFn?: (endpoint: string, signal?: AbortSignal) => Promise<unknown | undefined>
  private readonly env: NodeJS.ProcessEnv
  private readonly now: () => number
  private readonly cacheTtlMs: number

  constructor(options: FetchEnvironment = {}) {
    this.fetchFn = options.fetchFn ?? globalThis.fetch
    this.ghApiFn = options.ghApiFn
    this.env = options.env ?? process.env
    this.now = options.now ?? (() => Date.now())
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
  }

  clearCache(): void {
    this.releaseCache.clear()
    this.packumentCache.clear()
  }

  async fetchRawGitHubReleases(
    owner: string,
    repo: string,
    options: { forceRefresh?: boolean; signal?: AbortSignal } = {},
  ): Promise<RawGitHubRelease[]> {
    const key = `${owner.toLowerCase()}/${repo.toLowerCase()}`
    const cached = !options.forceRefresh ? this.releaseCache.get(key) : undefined
    if (cached && cached.expiresAt > this.now()) {
      return cached.value
    }

    const endpoint = `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?per_page=50`
    let payload: unknown

    // 1. Prefer authenticated `gh api` when available and no explicit token is injected,
    //    avoiding GitHub's 60/hr unauthenticated IP rate limit.
    const token = (this.env.GITHUB_TOKEN || this.env.GH_TOKEN || '').trim()
    if (!token) {
      payload = await this.tryGhApi(endpoint, options.signal)
    }

    // 2. Fall back to direct HTTPS GitHub REST API.
    if (!Array.isArray(payload)) {
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'klarkxy-dsh-update',
        'X-GitHub-Api-Version': '2022-11-28',
      }
      if (token) headers.Authorization = `Bearer ${token}`
      const response = await this.fetchWithTimeout(`https://api.github.com/${endpoint}`, {
        headers,
        signal: options.signal,
      })
      if (!response.ok) {
        throw new Error(`GitHub Releases HTTP ${response.status} (${owner}/${repo})`)
      }
      payload = await response.json()
    }

    if (!Array.isArray(payload)) {
      throw new Error(`Invalid GitHub Releases response for ${owner}/${repo}`)
    }

    const list = payload as RawGitHubRelease[]
    this.releaseCache.set(key, {
      expiresAt: this.now() + this.cacheTtlMs,
      value: list,
    })
    return list
  }

  async checkDshUpdates(
    hostDshVersion: string | null,
    isDesktopHost: boolean,
    request: DshUpdateCheckRequest = {},
    signal?: AbortSignal,
  ): Promise<DshUpdateCheckResult> {
    const currentVersion = parseSemver(hostDshVersion)?.version
      ?? parseSemver(request.clientVersion)?.version
      ?? null
    const explicitTarget = parseSemver(request.desktopTargetVersion)?.version ?? null
    const channel: UpdateChannel = request.channel
      ?? (explicitTarget ? inferUpdateChannel(explicitTarget) : inferUpdateChannel(currentVersion))
    const checkedAt = new Date(this.now()).toISOString()

    try {
      const raw = await this.fetchRawGitHubReleases(DSH_GITHUB_OWNER, DSH_GITHUB_REPO, {
        forceRefresh: request.forceRefresh,
        signal,
      })
      const mapped = mapGitHubReleases(raw, {
        dshCore: true,
        repoWebUrl: `https://github.com/${DSH_GITHUB_OWNER}/${DSH_GITHUB_REPO}`,
      })

      // Determine latest version on the active channel (if all releases are prereleases, fall back to prereleases).
      const channelCandidates = mapped.filter(entry =>
        channel === 'prerelease' ? true : !entry.prerelease,
      )
      const effectivePool = channelCandidates.length > 0 ? channelCandidates : mapped
      const latestVersion = effectivePool[0]?.version ?? null
      const targetVersion = explicitTarget ?? latestVersion
      const hasUpdate = Boolean(
        targetVersion && currentVersion
          ? compareSemver(targetVersion, currentVersion) === 1
          : explicitTarget && !currentVersion,
      )

      const releases = hasUpdate || !currentVersion
        ? selectReleasesBetween(mapped, currentVersion, targetVersion, {
          channel: effectivePool === mapped ? 'prerelease' : channel,
          fallbackLimit: 5,
        })
        : []

      const currentRelease = currentVersion
        ? mapped.find(item => compareSemver(item.version, currentVersion) === 0)
        : undefined

      return {
        currentVersion,
        latestVersion,
        targetVersion,
        channel: effectivePool === mapped && latestVersion ? inferUpdateChannel(latestVersion) : channel,
        hasUpdate,
        isDesktopHost,
        checkedAt,
        releasesUrl: DSH_RELEASES_WEB_URL,
        releases,
        ...(currentRelease ? { currentRelease } : {}),
        releaseSource: mapped.length > 0 ? 'github-releases' : 'none',
      }
    } catch (error) {
      return {
        currentVersion,
        latestVersion: explicitTarget,
        targetVersion: explicitTarget,
        channel,
        hasUpdate: Boolean(explicitTarget && (!currentVersion || compareSemver(explicitTarget, currentVersion) === 1)),
        isDesktopHost,
        checkedAt,
        releasesUrl: DSH_RELEASES_WEB_URL,
        releases: [],
        releaseSource: 'none',
        warning: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async fetchNpmPackument(
    packageName: string,
    options: { preferredRegistry?: string; forceRefresh?: boolean; signal?: AbortSignal } = {},
  ): Promise<{ packument: NpmPackument; registry: string }> {
    const key = `${options.preferredRegistry ?? 'default'}::${packageName}`
    const cached = !options.forceRefresh ? this.packumentCache.get(key) : undefined
    if (cached && cached.expiresAt > this.now()) {
      return { packument: cached.value, registry: cached.value._resolvedRegistry ?? OFFICIAL_NPM_REGISTRY }
    }

    const registries = uniqueRegistries([
      options.preferredRegistry,
      OFFICIAL_NPM_REGISTRY,
      FALLBACK_NPM_REGISTRY,
    ])
    const encoded = packageName.startsWith('@')
      ? `@${encodeURIComponent(packageName.slice(1).split('/')[0]!)}%2f${encodeURIComponent(packageName.split('/')[1] ?? '')}`
      : encodeURIComponent(packageName)

    let lastError: unknown
    for (const registry of registries) {
      const base = registry.replace(/\/+$/, '')
      try {
        const response = await this.fetchWithTimeout(`${base}/${encoded}`, {
          headers: { Accept: 'application/json', 'User-Agent': 'klarkxy-dsh-update' },
          signal: options.signal,
        })
        if (!response.ok) {
          lastError = new Error(`Registry HTTP ${response.status} from ${base}`)
          continue
        }
        const json = await response.json() as NpmPackument
        if (!json || typeof json !== 'object' || !json.versions || typeof json.versions !== 'object') {
          lastError = new Error(`Invalid packument from ${base}`)
          continue
        }
        json._resolvedRegistry = base
        this.packumentCache.set(key, {
          expiresAt: this.now() + this.cacheTtlMs,
          value: json,
        })
        return { packument: json, registry: base }
      } catch (error) {
        lastError = error
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`Failed to query npm metadata for ${packageName}`)
  }

  async fetchPluginReleaseLogs(
    repo: PluginRepoRef,
    packageName: string,
    installedVersion: string | null,
    targetVersion: string | null,
    options: { includePrerelease?: boolean; forceRefresh?: boolean; signal?: AbortSignal } = {},
  ): Promise<{
    allPackageReleases: ReleaseLogEntry[]
    rangeReleases: ReleaseLogEntry[]
    currentRelease?: ReleaseLogEntry
  }> {
    const raw = await this.fetchRawGitHubReleases(repo.owner, repo.repo, {
      forceRefresh: options.forceRefresh,
      signal: options.signal,
    })
    const repoWebUrl = `https://github.com/${repo.owner}/${repo.repo}`

    // In a monorepo (`repo.directory` present), check whether package-scoped tags exist first.
    const scopedOnly = mapGitHubReleases(raw, {
      packageName,
      directory: repo.directory,
      allowRepoWideTag: false,
      repoWebUrl,
    })
    const mapped = scopedOnly.length > 0
      ? scopedOnly
      : mapGitHubReleases(raw, {
        packageName,
        directory: repo.directory,
        allowRepoWideTag: true,
        repoWebUrl,
      })

    const channel: UpdateChannel = options.includePrerelease
      || inferUpdateChannel(targetVersion) === 'prerelease'
      || inferUpdateChannel(installedVersion) === 'prerelease'
      ? 'prerelease'
      : 'stable'

    const rangeReleases = selectReleasesBetween(mapped, installedVersion, targetVersion, {
      channel,
      fallbackLimit: 3,
    })
    const currentRelease = installedVersion
      ? mapped.find(entry => compareSemver(entry.version, installedVersion) === 0)
      : undefined

    return {
      allPackageReleases: mapped,
      rangeReleases,
      ...(currentRelease ? { currentRelease } : {}),
    }
  }

  async resolveGitTagCommitSha(
    repo: PluginRepoRef,
    tagName: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const endpoint = `repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/commits/${encodeURIComponent(tagName)}`
    const token = (this.env.GITHUB_TOKEN || this.env.GH_TOKEN || '').trim()
    if (!token) {
      const ghData = await this.tryGhApi(endpoint, signal)
      if (ghData && typeof ghData === 'object' && typeof (ghData as { sha?: unknown }).sha === 'string') {
        const sha = (ghData as { sha: string }).sha.trim()
        if (/^[0-9a-f]{40}$/i.test(sha)) return sha.toLowerCase()
      }
    }
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'klarkxy-dsh-update',
    }
    if (token) headers.Authorization = `Bearer ${token}`
    const response = await this.fetchWithTimeout(`https://api.github.com/${endpoint}`, { headers, signal })
    if (!response.ok) return null
    const data = await response.json() as { sha?: unknown }
    if (typeof data?.sha === 'string' && /^[0-9a-f]{40}$/i.test(data.sha.trim())) {
      return data.sha.trim().toLowerCase()
    }
    return null
  }

  private async tryGhApi(endpoint: string, signal?: AbortSignal): Promise<unknown | undefined> {
    if (this.ghApiFn) {
      return this.ghApiFn(endpoint, signal)
    }
    if (this.ghState === 'unavailable') return undefined
    try {
      const { stdout } = await execFileAsync('gh', ['api', endpoint], {
        timeout: 6_000,
        maxBuffer: 8 * 1024 * 1024,
        signal,
        windowsHide: true,
      })
      this.ghState = 'ready'
      return JSON.parse(stdout)
    } catch {
      if (this.ghState === 'unknown') this.ghState = 'unavailable'
      return undefined
    }
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit & { timeoutMs?: number } = {},
  ): Promise<Response> {
    const timeoutMs = init.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS
    const controller = new AbortController()
    const onOuterAbort = () => controller.abort()
    init.signal?.addEventListener('abort', onOuterAbort, { once: true })
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await this.fetchFn(url, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timer)
      init.signal?.removeEventListener('abort', onOuterAbort)
    }
  }
}

export interface NpmVersionManifest {
  name?: string
  version?: string
  description?: string
  deprecated?: string
  engines?: { dsh?: string }
  peerDependencies?: Record<string, string>
  dsh?: { bundle?: unknown }
  repository?: unknown
  homepage?: unknown
  bugs?: unknown
}

export interface NpmPackument {
  name?: string
  'dist-tags'?: Record<string, string>
  versions?: Record<string, NpmVersionManifest>
  time?: Record<string, string>
  repository?: unknown
  homepage?: unknown
  bugs?: unknown
  _resolvedRegistry?: string
}

export function selectLatestCompatibleNpmVersion(
  packument: NpmPackument,
  installedVersion: string | null,
  dshVersion: string | null,
  includePrerelease = false,
): {
  latestCompatible: string | null
  highestOverall: string | null
  incompatibleReason?: string
} {
  const versionsObj = packument.versions ?? {}
  const allowPre = includePrerelease || inferUpdateChannel(installedVersion) === 'prerelease'

  const candidates = Object.entries(versionsObj)
    .map(([ver, manifest]) => ({ parsed: parseSemver(ver), manifest }))
    .filter((item): item is { parsed: NonNullable<ReturnType<typeof parseSemver>>; manifest: NpmVersionManifest } => Boolean(item.parsed))
    .filter(({ parsed, manifest }) => {
      if (manifest.deprecated) return false
      if (!allowPre && parsed.prerelease.length > 0) return false
      return true
    })
    .sort((a, b) => compareSemver(b.parsed.version, a.parsed.version) ?? 0)

  const highestOverall = candidates[0]?.parsed.version ?? null
  let firstIncompatibleReason: string | undefined

  for (const { parsed, manifest } of candidates) {
    const check = checkManifestDshCompatibility(manifest, dshVersion)
    if (check.compatible) {
      return {
        latestCompatible: parsed.version,
        highestOverall,
      }
    }
    if (!firstIncompatibleReason && (!installedVersion || compareSemver(parsed.version, installedVersion) === 1)) {
      firstIncompatibleReason = check.reason
    }
  }

  return {
    latestCompatible: null,
    highestOverall,
    ...(firstIncompatibleReason ? { incompatibleReason: firstIncompatibleReason } : {}),
  }
}

export function checkManifestDshCompatibility(
  manifest: NpmVersionManifest,
  dshVersion: string | null,
): { compatible: boolean; reason?: string } {
  if (!dshVersion) return { compatible: true }
  const engineRange = manifest.engines?.dsh
  if (engineRange && !satisfiesDshRange(dshVersion, engineRange)) {
    return {
      compatible: false,
      reason: `engines.dsh (${engineRange}) requires newer DSH than ${dshVersion}`,
    }
  }
  for (const [peerName, peerRange] of Object.entries(manifest.peerDependencies ?? {})) {
    if (!/^@deepseek-ai\/dsh(?:-|$)/.test(peerName)) continue
    if (!satisfiesDshRange(dshVersion, peerRange)) {
      return {
        compatible: false,
        reason: `${peerName} (${peerRange}) requires newer DSH than ${dshVersion}`,
      }
    }
  }
  return { compatible: true }
}

export function mapGitHubReleases(
  raw: readonly RawGitHubRelease[],
  options: {
    dshCore?: boolean
    packageName?: string
    directory?: string
    allowRepoWideTag?: boolean
    repoWebUrl: string
  },
): ReleaseLogEntry[] {
  const entries: Array<ReleaseLogEntry & { scopedMatch: boolean }> = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || item.draft === true) continue
    const tag = typeof item.tag_name === 'string' ? item.tag_name.trim() : ''
    if (!tag) continue
    const extracted = extractTagVersion(tag, options)
    if (!extracted) continue
    const parsed = parseSemver(extracted.version)
    if (!parsed) continue
    const body = typeof item.body === 'string' ? item.body.trim() : ''
    const title = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : tag
    const publishedAt = typeof item.published_at === 'string' && item.published_at
      ? item.published_at
      : typeof item.created_at === 'string'
        ? item.created_at
        : ''
    const url = typeof item.html_url === 'string' && /^https:\/\//i.test(item.html_url)
      ? item.html_url
      : `${options.repoWebUrl}/releases/tag/${encodeURIComponent(tag)}`
    const prerelease = Boolean(item.prerelease) || parsed.prerelease.length > 0
    const localizedBody = splitBilingualReleaseBody(body)

    entries.push({
      tag,
      version: parsed.version,
      title,
      body,
      ...(localizedBody ? { localizedBody } : {}),
      publishedAt,
      url,
      prerelease,
      scopedMatch: extracted.scopedMatch,
    })
  }

  entries.sort((a, b) => {
    const cmp = compareSemver(b.version, a.version)
    if (cmp !== null && cmp !== 0) return cmp
    if (a.scopedMatch !== b.scopedMatch) return a.scopedMatch ? -1 : 1
    return (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0)
  })

  const seen = new Set<string>()
  const deduped: ReleaseLogEntry[] = []
  for (const { scopedMatch: _scoped, ...entry } of entries) {
    if (seen.has(entry.version)) continue
    seen.add(entry.version)
    deduped.push(entry)
  }
  return deduped
}

export function classifyPluginSource(source: string | undefined, nativeUpdateMode?: 'registry' | 'git'): PluginSourceKind {
  if (nativeUpdateMode === 'registry') return 'registry'
  if (nativeUpdateMode === 'git') return 'git'
  if (!source) return 'unknown'
  const trimmed = source.trim()
  if (/^(?:link:|workspace:)/i.test(trimmed)) return 'link'
  if (/^(?:file:|\.{1,2}[\\/]|\/|[a-zA-Z]:[\\/])/.test(trimmed)) return 'file'
  if (/^(?:git\+|github:|gitlab:|bitbucket:|git:\/\/|ssh:\/\/|https?:\/\/github\.com\/)/i.test(trimmed) || /\.git(?:#|$)/i.test(trimmed)) {
    return 'git'
  }
  return 'registry'
}

/**
 * Resolve a GitHub `{ owner, repo, directory, url }` reference from package metadata or install spec.
 */
export function resolveGitHubRepoRef(inputs: {
  source?: string
  repository?: unknown
  homepage?: unknown
  bugs?: unknown
}): PluginRepoRef | undefined {
  // 1. Check Git install source spec first (preserves `#...&path:/plugins/...` if present).
  if (typeof inputs.source === 'string' && inputs.source.trim()) {
    const fromSource = parseGitHubFromSpecOrUrl(inputs.source.trim())
    if (fromSource) return fromSource
  }

  // 2. Check package.json `repository` field (string or `{ url, directory }`).
  if (inputs.repository) {
    if (typeof inputs.repository === 'string') {
      const parsed = parseGitHubFromSpecOrUrl(inputs.repository)
      if (parsed) return parsed
    } else if (typeof inputs.repository === 'object') {
      const repoObj = inputs.repository as { url?: unknown; directory?: unknown }
      if (typeof repoObj.url === 'string') {
        const parsed = parseGitHubFromSpecOrUrl(repoObj.url)
        if (parsed) {
          const dir = typeof repoObj.directory === 'string'
            ? repoObj.directory.trim().replace(/^\/+|\/+$/g, '')
            : parsed.directory
          return {
            ...parsed,
            ...(dir ? { directory: dir } : {}),
          }
        }
      }
    }
  }

  // 3. Check `bugs.url` or `bugs` string (`https://github.com/owner/repo/issues`).
  const bugsUrl = typeof inputs.bugs === 'string'
    ? inputs.bugs
    : inputs.bugs && typeof inputs.bugs === 'object' && typeof (inputs.bugs as { url?: unknown }).url === 'string'
      ? (inputs.bugs as { url: string }).url
      : undefined
  if (bugsUrl) {
    const parsed = parseGitHubFromSpecOrUrl(bugsUrl)
    if (parsed) return parsed
  }

  // 4. Check `homepage` (including `https://owner.github.io/repo/...` or `https://github.com/owner/repo`).
  if (typeof inputs.homepage === 'string' && inputs.homepage.trim()) {
    const homepage = inputs.homepage.trim()
    const ghPages = /^https?:\/\/([a-zA-Z0-9-]+)\.github\.io\/([a-zA-Z0-9._-]+)(?:\/|$)/.exec(homepage)
    if (ghPages) {
      const owner = ghPages[1]!
      const repo = ghPages[2]!.replace(/\.git$/i, '')
      return { owner, repo, url: `https://github.com/${owner}/${repo}` }
    }
    const parsed = parseGitHubFromSpecOrUrl(homepage)
    if (parsed) return parsed
  }

  return undefined
}

export function parseGitHubFromSpecOrUrl(raw: string): PluginRepoRef | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return undefined

  const extractFragmentPath = (fragment: string | undefined): string | undefined => {
    if (!fragment) return undefined
    for (const part of fragment.split('&')) {
      if (part.startsWith('path:')) {
        const cleaned = decodeURIComponent(part.slice('path:'.length)).replace(/^\/+|\/+$/g, '')
        if (cleaned) return cleaned
      }
    }
    return undefined
  }

  // Shorthand: `github:owner/repo#ref&path:/dir` or bare `owner/repo`
  const ghShort = /^(?:github:)?([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?(?:#(.*))?$/.exec(trimmed)
  if (ghShort && !trimmed.includes('://') && !trimmed.startsWith('@') && !trimmed.startsWith('.')) {
    const owner = ghShort[1]!
    const repo = ghShort[2]!
    const directory = extractFragmentPath(ghShort[3])
    return {
      owner,
      repo,
      ...(directory ? { directory } : {}),
      url: `https://github.com/${owner}/${repo}`,
    }
  }

  // HTTPS / SSH / git+ URLs on github.com
  const urlMatch = /^(?:git\+)?(?:https?|ssh|git):\/\/(?:[^@/\s]+@)?github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?(?:\/(?:issues|tree\/[^#]+|blob\/[^#]+|releases[^#]*)?)?(?:#(.*))?$/i.exec(trimmed)
    ?? /^git@github\.com:([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?(?:#(.*))?$/i.exec(trimmed)
  if (urlMatch) {
    const owner = urlMatch[1]!
    const repo = urlMatch[2]!
    const directory = extractFragmentPath(urlMatch[3])
    return {
      owner,
      repo,
      ...(directory ? { directory } : {}),
      url: `https://github.com/${owner}/${repo}`,
    }
  }

  return undefined
}

export function buildGitTargetSpec(repo: PluginRepoRef, commitSha: string): string {
  const cleanSha = commitSha.trim().toLowerCase()
  const pathPart = repo.directory ? `&path:/${repo.directory.replace(/^\/+|\/+$/g, '')}` : ''
  return `git+https://github.com/${repo.owner}/${repo.repo}.git#${cleanSha}${pathPart}`
}

function uniqueRegistries(list: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of list) {
    if (!item || typeof item !== 'string') continue
    const clean = item.trim().replace(/\/+$/, '')
    if (!/^https?:\/\//i.test(clean) || seen.has(clean)) continue
    seen.add(clean)
    out.push(clean)
  }
  return out
}
