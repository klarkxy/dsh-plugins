export const PLUGIN_NAME = '@klarkxy/dsh-update'
export const RPC_CHANNEL = '/api/plugins/klarkxy-dsh-update'
export const DSH_GITHUB_OWNER = 'deepseek-ai'
export const DSH_GITHUB_REPO = 'deepseek-harness'
export const DSH_RELEASES_WEB_URL = 'https://github.com/deepseek-ai/deepseek-harness/releases'

export type RpcError = {
  code: string
  message: string
  details?: Record<string, unknown>
}

export type RpcResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: RpcError }

export interface ReleaseLogEntry {
  tag: string
  version: string
  title: string
  body: string
  localizedBody?: {
    zh?: string
    en?: string
  }
  publishedAt: string
  url: string
  prerelease: boolean
}

export type UpdateChannel = 'stable' | 'prerelease'

export interface DshUpdateCheckRequest {
  clientVersion?: string
  desktopTargetVersion?: string
  channel?: UpdateChannel
  forceRefresh?: boolean
}

export interface DshUpdateCheckResult {
  currentVersion: string | null
  latestVersion: string | null
  targetVersion: string | null
  channel: UpdateChannel
  hasUpdate: boolean
  isDesktopHost: boolean
  checkedAt: string
  releasesUrl: string
  releases: ReleaseLogEntry[]
  currentRelease?: ReleaseLogEntry
  releaseSource: 'github-releases' | 'none'
  warning?: string
}

export type PluginSourceKind = 'registry' | 'git' | 'link' | 'file' | 'unknown'

export interface PluginRepoRef {
  owner: string
  repo: string
  directory?: string
  url: string
}

export interface PluginUpdateEntry {
  name: string
  title: string
  description: string
  installedVersion: string | null
  latestVersion: string | null
  hasUpdate: boolean
  enabled: boolean
  removable: boolean
  source?: string
  sourceKind: PluginSourceKind
  nativeUpdateMode?: 'registry' | 'git'
  canApplyUpdate: boolean
  cannotUpdateReason?: 'link-or-local' | 'builtin' | 'missing-version' | 'incompatible-dsh' | 'unpinned-git'
  incompatibleReason?: string
  repository?: PluginRepoRef
  targetSpec?: string
  registry?: string
  releasesUrl?: string
  releases: ReleaseLogEntry[]
  currentRelease?: ReleaseLogEntry
  releaseNoteSource: 'github-releases' | 'none'
  checkedAt: string
  error?: string
}

export interface PluginCheckAllRequest {
  includePrerelease?: boolean
  forceRefresh?: boolean
}

export interface PluginCheckAllResult {
  dshVersion: string | null
  checkedAt: string
  plugins: PluginUpdateEntry[]
}

export interface PluginCheckOneRequest {
  name: string
  targetVersion?: string
  includePrerelease?: boolean
  forceRefresh?: boolean
}

export interface PluginApplyUpdateRequest {
  name: string
  targetVersion: string
  targetSpec?: string
  registry?: string
}

export interface PluginApplyUpdateResult {
  name: string
  previousVersion: string | null
  installedVersion: string | null
  status: 'applied' | 'restart-required' | 'failed'
  restartReason?: string
  bundlePreservedInProfile: boolean
  message: string
  diagnostic?: string
}

export interface DshApplyCliUpdateRequest {
  targetVersion: string
}

export interface DshApplyCliUpdateResult {
  previousVersion: string | null
  targetVersion: string
  status: 'restart-required' | 'desktop-managed' | 'failed'
  command?: string
  message: string
  diagnostic?: string
}

export interface ParsedSemver {
  major: number
  minor: number
  patch: number
  prerelease: ReadonlyArray<string | number>
  build: ReadonlyArray<string>
  raw: string
  version: string
}

const SEMVER_RE = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

/** Parse a clean SemVer 2.0 string (allowing a leading `v`). */
export function parseSemver(input: string | null | undefined): ParsedSemver | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  const match = SEMVER_RE.exec(trimmed)
  if (!match) return null
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) return null
  const prerelease = match[4]
    ? match[4].split('.').map(part => (/^(?:0|[1-9]\d*)$/.test(part) ? Number(part) : part))
    : []
  const build = match[5] ? match[5].split('.') : []
  const version = `${major}.${minor}.${patch}${prerelease.length ? `-${prerelease.join('.')}` : ''}`
  return { major, minor, patch, prerelease, build, raw: trimmed, version }
}

/** Compare two valid SemVer strings per SemVer 2.0.0 §11. Returns -1, 0, or 1, or null if invalid. */
export function compareSemver(leftInput: string | null | undefined, rightInput: string | null | undefined): -1 | 0 | 1 | null {
  const left = parseSemver(leftInput)
  const right = parseSemver(rightInput)
  if (!left || !right) return null
  if (left.major !== right.major) return left.major < right.major ? -1 : 1
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0
  if (left.prerelease.length === 0) return 1
  if (right.prerelease.length === 0) return -1
  const len = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < len; index += 1) {
    const a = left.prerelease[index]
    const b = right.prerelease[index]
    if (a === undefined) return -1
    if (b === undefined) return 1
    if (a === b) continue
    const aNum = typeof a === 'number'
    const bNum = typeof b === 'number'
    if (aNum && bNum) return a < b ? -1 : 1
    if (aNum !== bNum) return aNum ? -1 : 1
    return String(a) < String(b) ? -1 : 1
  }
  return 0
}

export function isNewerSemver(candidate: string | null | undefined, baseline: string | null | undefined): boolean {
  return compareSemver(candidate, baseline) === 1
}

export function inferUpdateChannel(version: string | null | undefined): UpdateChannel {
  const parsed = parseSemver(version)
  return parsed && parsed.prerelease.length > 0 ? 'prerelease' : 'stable'
}

/**
 * Extract a normalized SemVer version from a GitHub release tag for DSH or a plugin package.
 *
 * Supported tag patterns:
 * - DSH official tags: `dsh-v0.2.2-rc.4`, `v0.2.2-rc.4`, `0.2.2-rc.4`
 * - Scoped/monorepo plugin tags: `@klarkxy/dsh-git-commit@0.3.7`, `dsh-git-commit@0.3.7`,
 *   `dsh-git-commit-v0.3.7`, `dsh-git-commit/v0.3.7`
 * - Standard single-package tags: `v0.3.7`, `0.3.7`
 */
export function extractTagVersion(
  tagName: string,
  options: {
    dshCore?: boolean
    packageName?: string
    directory?: string
    allowRepoWideTag?: boolean
  } = {},
): { version: string; scopedMatch: boolean } | null {
  const tag = tagName.trim()
  if (!tag) return null

  if (options.dshCore) {
    if (tag.startsWith('dsh-v') || tag.startsWith('dsh-')) {
      const rest = tag.replace(/^dsh-v?/i, '')
      const parsed = parseSemver(rest)
      return parsed ? { version: parsed.version, scopedMatch: true } : null
    }
    const plain = parseSemver(tag)
    return plain ? { version: plain.version, scopedMatch: false } : null
  }

  const pkgName = options.packageName?.trim()
  if (pkgName) {
    const shortName = pkgName.includes('/') ? pkgName.split('/').at(-1)! : pkgName
    const dirTail = options.directory?.replace(/\/+$/, '').split('/').at(-1)
    const candidates = [...new Set([pkgName, shortName, ...(dirTail ? [dirTail] : [])])]
    for (const prefix of candidates) {
      for (const sep of ['@', '-v', '-', '/v', '/']) {
        const needle = `${prefix}${sep}`
        if (tag.toLowerCase().startsWith(needle.toLowerCase())) {
          const rest = tag.slice(needle.length)
          const parsed = parseSemver(rest)
          if (parsed) return { version: parsed.version, scopedMatch: true }
        }
      }
    }
  }

  if (options.allowRepoWideTag !== false) {
    const plain = parseSemver(tag)
    if (plain) return { version: plain.version, scopedMatch: false }
  }
  return null
}

/**
 * Filter release entries to `(currentVersion, targetVersion]`, sorted newest-first.
 * When `currentVersion` is unknown, returns up to `fallbackLimit` newest releases <= `targetVersion`.
 */
export function selectReleasesBetween(
  releases: readonly ReleaseLogEntry[],
  currentVersion: string | null | undefined,
  targetVersion: string | null | undefined,
  options: { channel?: UpdateChannel; fallbackLimit?: number } = {},
): ReleaseLogEntry[] {
  const channel = options.channel ?? (targetVersion ? inferUpdateChannel(targetVersion) : inferUpdateChannel(currentVersion))
  const validCurrent = parseSemver(currentVersion)?.version ?? null
  const validTarget = parseSemver(targetVersion)?.version ?? null

  const filtered = releases.filter(entry => {
    const parsed = parseSemver(entry.version)
    if (!parsed) return false
    if (channel === 'stable' && parsed.prerelease.length > 0 && validTarget !== parsed.version) {
      return false
    }
    if (validCurrent && compareSemver(parsed.version, validCurrent) !== 1) {
      return false
    }
    if (validTarget && compareSemver(parsed.version, validTarget) === 1) {
      return false
    }
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    const cmp = compareSemver(b.version, a.version)
    if (cmp !== null && cmp !== 0) return cmp
    return (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0)
  })

  // Deduplicate by normalized semver version while keeping the first (newest) entry.
  const seen = new Set<string>()
  const unique: ReleaseLogEntry[] = []
  for (const item of sorted) {
    if (seen.has(item.version)) continue
    seen.add(item.version)
    unique.push(item)
  }

  if (!validCurrent && options.fallbackLimit !== undefined) {
    return unique.slice(0, Math.max(1, options.fallbackLimit))
  }
  return unique
}

/**
 * Split bilingual Release Markdown (such as `deepseek-ai/deepseek-harness` releases
 * that contain a Chinese half and an English half separated by `---` or anchor tags)
 * so the UI can show the active locale's section cleanly while still offering full raw notes.
 */
export function splitBilingualReleaseBody(markdown: string): { zh?: string; en?: string } | undefined {
  const raw = markdown.replace(/\r\n/g, '\n').trim()
  if (!raw) return undefined

  // Strip navigation switcher lines like `[中文](#...) | [English](#...)` or `中文 | English`.
  const stripNav = (text: string) =>
    text
      .replace(/^\s*(?:\[[^\]]*中文[^\]]*\]\([^)]*\)|中文)\s*\|\s*(?:\[[^\]]*English[^\]]*\]\([^)]*\)|English)\s*$/gim, '')
      .replace(/<a\s+(?:id|name)=["'][^"']*["']\s*>\s*<\/a>/gi, '')
      .trim()

  // Pattern 1: Horizontal rule `---` separating a Chinese block (with CJK characters) and an English block.
  const hrParts = raw.split(/\n\s*---+\s*\n/).map(stripNav).filter(Boolean)
  if (hrParts.length === 2) {
    const cjk0 = countCjk(hrParts[0]!)
    const cjk1 = countCjk(hrParts[1]!)
    if (cjk0 >= 8 && cjk1 <= 3) return { zh: hrParts[0]!, en: hrParts[1]! }
    if (cjk1 >= 8 && cjk0 <= 3) return { zh: hrParts[1]!, en: hrParts[0]! }
  }

  // Pattern 2: Explicit `## 中文` / `## English` headings.
  const zhHeading = /^(#{1,3})\s*(?:中文|简体中文|Chinese)\b.*$/im.exec(raw)
  const enHeading = /^(#{1,3})\s*(?:English)\b.*$/im.exec(raw)
  if (zhHeading && enHeading && zhHeading.index !== enHeading.index) {
    if (zhHeading.index < enHeading.index) {
      const zh = stripNav(raw.slice(zhHeading.index + zhHeading[0].length, enHeading.index))
      const en = stripNav(raw.slice(enHeading.index + enHeading[0].length))
      if (zh && en) return { zh, en }
    } else {
      const en = stripNav(raw.slice(enHeading.index + enHeading[0].length, zhHeading.index))
      const zh = stripNav(raw.slice(zhHeading.index + zhHeading[0].length))
      if (zh && en) return { zh, en }
    }
  }

  return undefined
}

function countCjk(text: string): number {
  const matches = text.match(/[\u4e00-\u9fff]/g)
  return matches ? matches.length : 0
}

/** Check simple DSH SemVer range compatibility (`>=x.y.z`, `^x.y.z`, exact, or `||` unions). */
export function satisfiesDshRange(dshVersion: string | null | undefined, range: string | null | undefined): boolean {
  if (!dshVersion || !range) return true
  const current = parseSemver(dshVersion)
  if (!current) return true
  const trimmed = range.trim()
  if (!trimmed || trimmed === '*' || trimmed === 'latest') return true

  const branches = trimmed.split('||').map(part => part.trim()).filter(Boolean)
  if (!branches.length) return true

  return branches.some(branch => {
    const tokens = branch.split(/\s+/).filter(Boolean)
    return tokens.every(token => {
      if (token === '*') return true
      if (token.startsWith('>=')) {
        const cmp = compareSemver(current.version, token.slice(2))
        return cmp === null ? true : cmp >= 0
      }
      if (token.startsWith('>')) {
        const cmp = compareSemver(current.version, token.slice(1))
        return cmp === null ? true : cmp > 0
      }
      if (token.startsWith('<=')) {
        const cmp = compareSemver(current.version, token.slice(2))
        return cmp === null ? true : cmp <= 0
      }
      if (token.startsWith('<')) {
        const cmp = compareSemver(current.version, token.slice(1))
        return cmp === null ? true : cmp < 0
      }
      if (token.startsWith('^')) {
        const min = parseSemver(token.slice(1))
        if (!min) return true
        const cmp = compareSemver(current.version, min.version)
        if (cmp === null || cmp < 0) return false
        if (min.major > 0) return current.major === min.major
        if (min.minor > 0) return current.major === 0 && current.minor === min.minor
        return current.major === 0 && current.minor === 0 && current.patch === min.patch
      }
      if (token.startsWith('~')) {
        const min = parseSemver(token.slice(1))
        if (!min) return true
        const cmp = compareSemver(current.version, min.version)
        if (cmp === null || cmp < 0) return false
        return current.major === min.major && current.minor === min.minor
      }
      const exact = parseSemver(token)
      if (exact) return compareSemver(current.version, exact.version) === 0
      return true
    })
  })
}
