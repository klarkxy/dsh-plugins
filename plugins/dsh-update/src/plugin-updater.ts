import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  compareSemver,
  parseSemver,
  type DshApplyCliUpdateResult,
  type PluginApplyUpdateRequest,
  type PluginApplyUpdateResult,
  type PluginCheckAllRequest,
  type PluginCheckAllResult,
  type PluginCheckOneRequest,
  type PluginUpdateEntry,
} from './contracts.ts'
import {
  ReleaseMetadataResolver,
  buildGitTargetSpec,
  checkManifestDshCompatibility,
  classifyPluginSource,
  isSilentMirrorRegistry,
  resolveGitHubRepoRef,
  selectLatestCompatibleNpmVersion,
  type NpmVersionManifest,
} from './releases.ts'

const execFileAsync = promisify(execFile)

export interface HostBundleSummary {
  name: string
  version?: string | null
  description?: string
  installed?: boolean
  enabled?: boolean
  removable?: boolean
  official?: boolean
  optional?: boolean
  source?: string
  /**
   * Host 0.2.2-rc.1 lists `updatable` for a third-party registry dependency
   * `updateBundle` will accept. Newer hosts also set `update`.
   */
  updatable?: boolean
  update?: 'registry' | 'git'
  meta?: Record<string, { title?: string; description?: string }>
}

export interface HostVersionListItem {
  version: string
  deprecated?: string
  prerelease?: boolean
  bundle?: boolean
  incompatible?: { reason?: string; unmet?: Record<string, string> } | boolean
}

export interface HostVersionListResponse {
  status?: string
  registry?: string
  versions?: HostVersionListItem[]
  problem?: string
}

export interface HostUpdateOutcome {
  application?: 'applied' | 'restart-required' | 'failed' | 'cancelled'
  restartReason?: string
  step?: string
  failedAt?: string
  version?: string
  diagnostic?: string
  output?: string
  /** Fields of the Host change result that ride along with `application`. */
  changed?: boolean
  stage?: string
  target?: string
  enabled?: boolean
  bundle?: string
  packageResult?: {
    kind?: string
    unmet?: string
    version?: string
    output?: string
  }
  /** Reinstall of the previous bundle after a failed target install. */
  restore?: HostUpdateOutcome
}

/**
 * `pluginManager.updateBundle` answers with an envelope around the change result
 * (`{ from, to, step, result, restore? }`), while remove/install/enable answer
 * with the change result itself. One normalizer keeps every call site on the
 * flat shape, so a failure reported inside the envelope is not read as success.
 */
export interface HostUpdateEnvelope {
  from?: string
  to?: string
  step?: string
  result?: HostUpdateOutcome & { error?: { code?: string; diagnostic?: string } }
  restore?: HostUpdateOutcome
}

export function normalizeUpdateOutcome(
  value: HostUpdateOutcome | HostUpdateEnvelope | undefined | null,
): HostUpdateOutcome {
  if (!value || typeof value !== 'object') return {}
  const envelope = value as HostUpdateEnvelope
  const change = envelope.result
  if (!change || typeof change !== 'object' || Array.isArray(change)) {
    return value as HostUpdateOutcome
  }
  const error = change.error
  const diagnostic = change.diagnostic
    ?? (typeof error?.diagnostic === 'string' ? error.diagnostic : undefined)
    ?? (typeof error?.code === 'string' ? error.code : undefined)
  return {
    ...change,
    ...(typeof envelope.step === 'string' ? { step: envelope.step } : {}),
    ...(typeof envelope.to === 'string' ? { version: envelope.to } : {}),
    ...(diagnostic ? { diagnostic } : {}),
    ...(envelope.restore && typeof envelope.restore === 'object' ? { restore: envelope.restore } : {}),
  }
}

export function isSuccessfulHostApplication(application: HostUpdateOutcome['application'] | undefined): boolean {
  return application === 'applied' || application === 'restart-required'
}

/** A registry URL is passed to `updateBundle` only when the host named it and it is not the silent mirror. */
export function installRegistryOption(registry: string | null | undefined): string | undefined {
  if (typeof registry !== 'string') return undefined
  const trimmed = registry.trim()
  if (!trimmed || isSilentMirrorRegistry(trimmed)) return undefined
  return trimmed
}

export interface HostPluginManagerLike {
  listBundles(): Promise<HostBundleSummary[]> | HostBundleSummary[]
  listVersions?(name: string, options?: { registry?: string }): Promise<HostVersionListResponse>
  updateBundle(
    name: string,
    version: string,
    options?: { spec?: string; registry?: string; requestId?: string },
  ): Promise<HostUpdateOutcome | HostUpdateEnvelope>
  installBundle?(
    spec: string,
    options?: {
      enabled?: boolean
      registry?: string
      requestId?: string
      expected?: { name: string; version: string }
    },
  ): Promise<HostUpdateOutcome>
  removeBundle?(name: string): Promise<HostUpdateOutcome>
  setBundleEnabled?(name: string, enabled: boolean): Promise<HostUpdateOutcome>
}

export interface PluginUpdateServiceOptions {
  resolver: ReleaseMetadataResolver
  getPluginManager: () => HostPluginManagerLike | undefined
  getProfileDir: () => string | null
  getDshVersion: () => string | null
  isDesktopHost: () => boolean
  execCliCommand?: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>
  now?: () => number
}

export class PluginUpdateService {
  private readonly resolver: ReleaseMetadataResolver
  private readonly getPluginManager: () => HostPluginManagerLike | undefined
  private readonly getProfileDir: () => string | null
  private readonly getDshVersion: () => string | null
  private readonly isDesktopHost: () => boolean
  private readonly execCliCommand: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>
  private readonly now: () => number

  constructor(options: PluginUpdateServiceOptions) {
    this.resolver = options.resolver
    this.getPluginManager = options.getPluginManager
    this.getProfileDir = options.getProfileDir
    this.getDshVersion = options.getDshVersion
    this.isDesktopHost = options.isDesktopHost
    this.execCliCommand = options.execCliCommand ?? (async (cmd, args) => {
      const res = await execFileAsync(cmd, args, {
        timeout: 180_000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      })
      return { stdout: String(res.stdout ?? ''), stderr: String(res.stderr ?? '') }
    })
    this.now = options.now ?? (() => Date.now())
  }

  async checkAllPlugins(
    request: PluginCheckAllRequest = {},
    signal?: AbortSignal,
  ): Promise<PluginCheckAllResult> {
    const manager = this.getPluginManager()
    const checkedAt = new Date(this.now()).toISOString()
    const dshVersion = this.getDshVersion()
    if (!manager) {
      return { dshVersion, checkedAt, plugins: [] }
    }

    const rawBundles = await manager.listBundles()
    const candidates = rawBundles.filter(isThirdPartyInstalledBundle)

    // Run checks with bounded concurrency (4) so large profiles stay responsive.
    const results = await mapConcurrent(candidates, 4, bundle =>
      this.inspectSingleBundle(bundle, {
        includePrerelease: request.includePrerelease,
        forceRefresh: request.forceRefresh,
        signal,
      }),
    )

    results.sort((left, right) => {
      if (left.hasUpdate !== right.hasUpdate) return left.hasUpdate ? -1 : 1
      return left.name.localeCompare(right.name)
    })

    return {
      dshVersion,
      checkedAt,
      plugins: results,
    }
  }

  async checkOnePlugin(
    request: PluginCheckOneRequest,
    signal?: AbortSignal,
  ): Promise<PluginUpdateEntry> {
    const manager = this.getPluginManager()
    if (!manager) {
      throw new Error('当前运行环境未挂载 pluginManager 服务，无法读取已安装插件列表。')
    }
    const bundles = await manager.listBundles()
    const bundle = bundles.find(item => item.name === request.name)
    if (!bundle) {
      throw new Error(`未找到已安装插件：${request.name}`)
    }
    return this.inspectSingleBundle(bundle, {
      explicitTargetVersion: request.targetVersion,
      includePrerelease: request.includePrerelease,
      forceRefresh: request.forceRefresh,
      signal,
    })
  }

  /**
   * Execute and activate a plugin update ONLY after explicit user confirmation.
   */
  async applyPluginUpdate(request: PluginApplyUpdateRequest): Promise<PluginApplyUpdateResult> {
    const manager = this.getPluginManager()
    if (!manager) {
      return {
        name: request.name,
        previousVersion: null,
        installedVersion: null,
        status: 'failed',
        bundlePreservedInProfile: false,
        message: '宿主未启用 pluginManager 服务，无法执行在线插件更新。',
      }
    }

    const targetParsed = parseSemver(request.targetVersion)
    if (!targetParsed) {
      return {
        name: request.name,
        previousVersion: null,
        installedVersion: null,
        status: 'failed',
        bundlePreservedInProfile: false,
        message: `目标版本号无效：${request.targetVersion}`,
      }
    }

    const beforeList = await manager.listBundles()
    const current = beforeList.find(item => item.name === request.name)
    if (!current || current.installed === false) {
      return {
        name: request.name,
        previousVersion: null,
        installedVersion: null,
        status: 'failed',
        bundlePreservedInProfile: false,
        message: `插件 ${request.name} 当前未安装在活动 profile 中。`,
      }
    }

    const previousVersion = parseSemver(current.version ?? undefined)?.version ?? current.version ?? null
    if (previousVersion && compareSemver(targetParsed.version, previousVersion) !== 1) {
      return {
        name: request.name,
        previousVersion,
        installedVersion: previousVersion,
        status: 'failed',
        bundlePreservedInProfile: Boolean(current.enabled),
        message: `目标版本 ${targetParsed.version} 不高于当前已安装版本 ${previousVersion}。`,
      }
    }

    const wasEnabled = current.enabled !== false
    const sourceKind = classifyPluginSource(current.source, current.update)
    const previousSpec = previousBundleSpec(current, previousVersion)
    const registry = installRegistryOption(request.registry)

    // Callers (the host RPC) must already hold a host approval. This method only
    // performs the install and puts the previous bundle back when that fails.
    const failed = async (message: string, outcome?: HostUpdateOutcome): Promise<PluginApplyUpdateResult> => {
      const preserved = await preserveExistingBundle(manager, request.name, previousSpec, wasEnabled, outcome)
      return {
        name: request.name,
        previousVersion,
        installedVersion: previousVersion,
        status: 'failed',
        bundlePreservedInProfile: preserved,
        message,
        ...(outcome && extractDiagnostic(outcome) ? { diagnostic: extractDiagnostic(outcome) } : {}),
      }
    }

    let outcome: HostUpdateOutcome
    try {
      if (usesHostRegistryUpdate(current)) {
        outcome = normalizeUpdateOutcome(await manager.updateBundle(
          request.name,
          targetParsed.version,
          registry ? { registry } : undefined,
        ))
      } else if (current.update === 'git') {
        if (!request.targetSpec) {
          return {
            name: request.name,
            previousVersion,
            installedVersion: previousVersion,
            status: 'failed',
            bundlePreservedInProfile: wasEnabled,
            message: 'Git 插件更新缺少固定提交（commit SHA）目标地址。',
          }
        }
        outcome = normalizeUpdateOutcome(await manager.updateBundle(request.name, targetParsed.version, {
          spec: request.targetSpec,
        }))
      } else if (
        sourceKind === 'git'
        && request.targetSpec
        && current.removable !== false
        && typeof manager.removeBundle === 'function'
        && typeof manager.installBundle === 'function'
      ) {
        // Host 0.2.2-rc.1 `updateBundle` only replaces registry bundles. An unpinned
        // Git install is removed and replaced only after the removal itself reports
        // success; a failed replacement reinstalls the previous spec.
        const removed = await manager.removeBundle(request.name)
        if (!isSuccessfulHostApplication(removed.application)) {
          return failed(
            removed.application === 'cancelled'
              ? '更新已取消。'
              : `移除旧版本 ${request.name} 失败，未执行覆盖安装。`,
            removed,
          )
        }
        outcome = await manager.installBundle(request.targetSpec, {
          enabled: wasEnabled,
          expected: { name: request.name, version: targetParsed.version },
        })
      } else {
        return {
          name: request.name,
          previousVersion,
          installedVersion: previousVersion,
          status: 'failed',
          bundlePreservedInProfile: wasEnabled,
          message: sourceKind === 'link' || sourceKind === 'file'
            ? '本地路径或 link 方式挂载的开发插件不支持在线覆盖更新，请在本地目录重新构建。'
            : `插件 ${request.name} 当前安装来源不支持自动替换更新。`,
        }
      }
    } catch (error) {
      return failed(error instanceof Error ? error.message : String(error))
    }

    if (!isSuccessfulHostApplication(outcome.application)) {
      return failed(
        outcome.application === 'cancelled'
          ? '更新已取消。'
          : `更新 ${request.name} 到 ${targetParsed.version} 失败。`,
        outcome,
      )
    }

    // Workaround for upstream DSH issue #13609:
    // Git-pinned `updateBundle` can drop the bundle from `dsh.profile.bundles`
    // even when `wasEnabled` was true. Verify selection state and restore if needed.
    let bundlePreservedInProfile = wasEnabled
    let verifiedVersion: string | null = outcome.version ?? outcome.packageResult?.version ?? targetParsed.version
    try {
      const afterList = await manager.listBundles()
      const updated = afterList.find(item => item.name === request.name)
      if (updated?.version) verifiedVersion = updated.version
      if (wasEnabled && updated && updated.enabled === false && typeof manager.setBundleEnabled === 'function') {
        const reenabled = await manager.setBundleEnabled(request.name, true)
        bundlePreservedInProfile = isSuccessfulHostApplication(reenabled.application)
      } else if (updated) {
        bundlePreservedInProfile = Boolean(updated.enabled)
      } else {
        bundlePreservedInProfile = false
      }
    } catch {
      bundlePreservedInProfile = false
    }

    const status = outcome.application === 'restart-required' ? 'restart-required' : 'applied'
    return {
      name: request.name,
      previousVersion,
      installedVersion: verifiedVersion,
      status,
      ...(outcome.restartReason ? { restartReason: outcome.restartReason } : {}),
      bundlePreservedInProfile,
      message: status === 'restart-required'
        ? `${request.name} 已更新至 ${verifiedVersion}，重启 DSH 后生效。`
        : `${request.name} 已更新至 ${verifiedVersion} 并热重载生效。`,
      ...(extractDiagnostic(outcome) ? { diagnostic: extractDiagnostic(outcome) } : {}),
    }
  }

  /**
   * Execute CLI DSH global update ONLY when confirmed by user in non-Desktop mode.
   * In Desktop mode, updates are owned by the signed Electron updater triggered from the client.
   */
  async applyCliDshUpdate(targetVersion: string): Promise<DshApplyCliUpdateResult> {
    const parsed = parseSemver(targetVersion)
    if (!parsed) {
      return {
        previousVersion: this.getDshVersion(),
        targetVersion,
        status: 'failed',
        message: `无效的目标 DSH 版本号：${targetVersion}`,
      }
    }

    const previousVersion = this.getDshVersion()
    if (this.isDesktopHost()) {
      return {
        previousVersion,
        targetVersion: parsed.version,
        status: 'desktop-managed',
        message: 'Desktop 客户端由内置签名更新器下载并安装更新。',
      }
    }

    const spec = `@deepseek-ai/dsh@${parsed.version}`
    const commands: Array<[string, string[]]> = [
      ['pnpm', ['add', '-g', spec]],
      ['npm', ['install', '-g', spec]],
    ]

    let lastDiagnostic = ''
    for (const [bin, args] of commands) {
      const rendered = `${bin} ${args.join(' ')}`
      try {
        const { stdout, stderr } = await this.execCliCommand(bin, args)
        return {
          previousVersion,
          targetVersion: parsed.version,
          status: 'restart-required',
          command: rendered,
          message: `已通过 ${rendered} 安装 DSH ${parsed.version}，请重启当前 dsh 进程以生效。`,
          diagnostic: [stdout.trim(), stderr.trim()].filter(Boolean).join('\n').slice(0, 4_000),
        }
      } catch (error) {
        lastDiagnostic = error instanceof Error ? error.message : String(error)
      }
    }

    return {
      previousVersion,
      targetVersion: parsed.version,
      status: 'failed',
      command: `pnpm add -g ${spec}`,
      message: `自动执行全局 CLI 更新失败，请在终端手动运行 pnpm add -g ${spec} 后重启 dsh。`,
      diagnostic: lastDiagnostic.slice(0, 4_000),
    }
  }

  private async inspectSingleBundle(
    bundle: HostBundleSummary,
    options: {
      explicitTargetVersion?: string
      includePrerelease?: boolean
      forceRefresh?: boolean
      signal?: AbortSignal
    } = {},
  ): Promise<PluginUpdateEntry> {
    const checkedAt = new Date(this.now()).toISOString()
    const dshVersion = this.getDshVersion()
    const installedVersion = parseSemver(bundle.version ?? undefined)?.version ?? bundle.version ?? null
    const localManifest = this.readInstalledPluginManifest(bundle.name)
    const localizedTitle = bundle.meta?.zh?.title || bundle.meta?.en?.title || bundle.name
    const description = bundle.meta?.zh?.description
      || bundle.meta?.en?.description
      || bundle.description
      || localManifest?.description
      || ''

    const sourceKind = classifyPluginSource(bundle.source, bundle.update)
    let repoRef = resolveGitHubRepoRef({
      source: bundle.source,
      repository: localManifest?.repository,
      homepage: localManifest?.homepage,
      bugs: localManifest?.bugs,
    })

    let latestVersion: string | null = parseSemver(options.explicitTargetVersion)?.version ?? null
    let registryUsed: string | undefined
    let targetSpec: string | undefined
    let incompatibleReason: string | undefined
    let errorText: string | undefined

    // 1. Resolve latest version from npm registry or Host pluginManager.listVersions for registry plugins.
    if (sourceKind === 'registry') {
      try {
        const { packument } = await this.resolver.fetchNpmPackument(bundle.name, {
          forceRefresh: options.forceRefresh,
          signal: options.signal,
        })
        // The registry that answered metadata is not the install source. A silent
        // mirror fallback must not be forwarded to `updateBundle`.
        const selection = selectLatestCompatibleNpmVersion(
          packument,
          installedVersion,
          dshVersion,
          Boolean(options.includePrerelease),
        )
        if (!latestVersion) latestVersion = selection.latestCompatible
        incompatibleReason = selection.incompatibleReason

        const manifestVersion = latestVersion || selection.highestOverall
        const targetManifest = manifestVersion ? packument.versions?.[manifestVersion] : undefined
        if (!repoRef) {
          repoRef = resolveGitHubRepoRef({
            repository: targetManifest?.repository ?? packument.repository,
            homepage: targetManifest?.homepage ?? packument.homepage,
            bugs: targetManifest?.bugs ?? packument.bugs,
          })
        }
      } catch (npmError) {
        // Fallback to Host `pluginManager.listVersions` (supports private corporate registries).
        const manager = this.getPluginManager()
        if (typeof manager?.listVersions === 'function') {
          try {
            const listed = await manager.listVersions(bundle.name)
            const hostRegistry = installRegistryOption(listed.registry)
            if (hostRegistry) registryUsed = hostRegistry
            const firstCompatible = (listed.versions ?? []).find(
              item => !item.deprecated && item.bundle !== false && !item.incompatible
                && (options.includePrerelease || !item.prerelease),
            )
            if (!latestVersion && firstCompatible?.version) {
              latestVersion = parseSemver(firstCompatible.version)?.version ?? firstCompatible.version
            }
          } catch (fallbackError) {
            errorText = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
          }
        } else {
          errorText = npmError instanceof Error ? npmError.message : String(npmError)
        }
      }
    }

    // 2. Fetch GitHub Release Logs (and for Git-installed plugins, discover newer release versions & commit SHAs).
    let releases: PluginUpdateEntry['releases'] = []
    let currentRelease: PluginUpdateEntry['currentRelease']
    let releaseNoteSource: 'github-releases' | 'none' = 'none'

    if (repoRef) {
      try {
        const releaseData = await this.resolver.fetchPluginReleaseLogs(
          repoRef,
          bundle.name,
          installedVersion,
          latestVersion,
          {
            includePrerelease: options.includePrerelease,
            forceRefresh: options.forceRefresh,
            signal: options.signal,
          },
        )
        currentRelease = releaseData.currentRelease
        if (releaseData.allPackageReleases.length > 0) {
          releaseNoteSource = 'github-releases'
        }

        if (sourceKind === 'git') {
          const newestRelease = releaseData.allPackageReleases[0]
          if (!latestVersion && newestRelease) {
            latestVersion = newestRelease.version
          }
          const targetRelease = latestVersion
            ? releaseData.allPackageReleases.find(item => compareSemver(item.version, latestVersion) === 0)
            : newestRelease
          releases = latestVersion
            ? (await this.resolver.fetchPluginReleaseLogs(
              repoRef,
              bundle.name,
              installedVersion,
              latestVersion,
              {
                includePrerelease: options.includePrerelease,
                forceRefresh: false,
                signal: options.signal,
              },
            )).rangeReleases
            : releaseData.rangeReleases

          if (targetRelease && installedVersion && compareSemver(targetRelease.version, installedVersion) === 1) {
            const sha = await this.resolver.resolveGitTagCommitSha(repoRef, targetRelease.tag, options.signal)
            if (sha) {
              targetSpec = buildGitTargetSpec(repoRef, sha)
            }
          }
        } else {
          releases = releaseData.rangeReleases
        }
      } catch (ghError) {
        if (!errorText && sourceKind === 'git') {
          errorText = ghError instanceof Error ? ghError.message : String(ghError)
        }
      }
    }

    const hasUpdate = Boolean(
      latestVersion && installedVersion
        ? compareSemver(latestVersion, installedVersion) === 1
        : false,
    )

    let canApplyUpdate = false
    let cannotUpdateReason: PluginUpdateEntry['cannotUpdateReason']

    if (sourceKind === 'link' || sourceKind === 'file') {
      cannotUpdateReason = 'link-or-local'
    } else if (!installedVersion) {
      cannotUpdateReason = 'missing-version'
    } else if (!hasUpdate && incompatibleReason) {
      cannotUpdateReason = 'incompatible-dsh'
    } else if (bundle.update === 'registry') {
      canApplyUpdate = hasUpdate
    } else if (bundle.update === 'git') {
      canApplyUpdate = Boolean(hasUpdate && targetSpec)
      if (hasUpdate && !targetSpec) cannotUpdateReason = 'unpinned-git'
    } else if (sourceKind === 'git') {
      const manager = this.getPluginManager()
      canApplyUpdate = Boolean(
        hasUpdate
          && targetSpec
          && bundle.removable !== false
          && typeof manager?.removeBundle === 'function'
          && typeof manager?.installBundle === 'function',
      )
      if (hasUpdate && !canApplyUpdate) cannotUpdateReason = 'unpinned-git'
    }

    return {
      name: bundle.name,
      title: localizedTitle,
      description,
      installedVersion,
      latestVersion: latestVersion ?? installedVersion,
      hasUpdate,
      enabled: bundle.enabled !== false,
      removable: bundle.removable !== false,
      ...(bundle.source ? { source: bundle.source } : {}),
      sourceKind,
      ...(bundle.update ? { nativeUpdateMode: bundle.update } : {}),
      canApplyUpdate,
      ...(cannotUpdateReason ? { cannotUpdateReason } : {}),
      ...(incompatibleReason ? { incompatibleReason } : {}),
      ...(repoRef ? { repository: repoRef, releasesUrl: `${repoRef.url}/releases` } : {}),
      ...(targetSpec ? { targetSpec } : {}),
      ...(registryUsed ? { registry: registryUsed } : {}),
      releases: hasUpdate ? releases : [],
      ...(currentRelease ? { currentRelease } : {}),
      releaseNoteSource,
      checkedAt,
      ...(errorText ? { error: errorText } : {}),
    }
  }

  private readInstalledPluginManifest(packageName: string): NpmVersionManifest | undefined {
    const profileDir = this.getProfileDir()
    if (!profileDir) return undefined
    const candidate = join(profileDir, 'node_modules', ...packageName.split('/'), 'package.json')
    try {
      if (!existsSync(candidate)) return undefined
      const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as NpmVersionManifest
      if (parsed && typeof parsed === 'object') {
        checkManifestDshCompatibility(parsed, this.getDshVersion())
        return parsed
      }
    } catch {
      return undefined
    }
    return undefined
  }
}

function usesHostRegistryUpdate(bundle: HostBundleSummary): boolean {
  if (bundle.update === 'git') return false
  if (bundle.update === 'registry') return true
  // DSH 0.2.2-rc.1 sets `updatable` and does not set `update`.
  return bundle.updatable === true
}

function previousBundleSpec(bundle: HostBundleSummary, previousVersion: string | null): string | undefined {
  const sourceKind = classifyPluginSource(bundle.source, bundle.update)
  if (bundle.update === 'git' || sourceKind === 'git') {
    return typeof bundle.source === 'string' && bundle.source.trim() ? bundle.source.trim() : undefined
  }
  if (previousVersion) return `${bundle.name}@${previousVersion}`
  return typeof bundle.source === 'string' && bundle.source.trim() ? bundle.source.trim() : undefined
}

/**
 * After a failed update, the previously installed bundle must still be listed.
 * When the host already restored it, leave that result alone. When the bundle
 * is gone, install the previous spec again.
 */
async function preserveExistingBundle(
  manager: HostPluginManagerLike,
  name: string,
  previousSpec: string | undefined,
  wasEnabled: boolean,
  outcome?: HostUpdateOutcome,
): Promise<boolean> {
  if (outcome?.restore && isSuccessfulHostApplication(outcome.restore.application)) return true
  let listed: HostBundleSummary | undefined
  try {
    const bundles = await manager.listBundles()
    listed = bundles.find(item => item.name === name)
  } catch {
    return false
  }
  if (listed) return wasEnabled ? listed.enabled !== false : true
  if (!previousSpec || typeof manager.installBundle !== 'function') return false
  try {
    const restored = await manager.installBundle(previousSpec, { enabled: wasEnabled })
    return isSuccessfulHostApplication(restored.application)
  } catch {
    return false
  }
}

export function isThirdPartyInstalledBundle(bundle: HostBundleSummary): boolean {
  if (!bundle || typeof bundle.name !== 'string') return false
  if (bundle.official === true || bundle.optional === true) return false
  if (bundle.installed === false) return false
  if (bundle.name.startsWith('@deepseek-ai/')) return false
  return true
}

/** Resolve the running Host DSH version from runtime packages or environment. */
export function detectHostDshVersion(ctx?: unknown, env: NodeJS.ProcessEnv = process.env): string | null {
  for (const key of ['DSH_VERSION', 'DSH_RUNTIME_VERSION', 'DSH_CLIENT_VERSION']) {
    const candidate = parseSemver(env[key])
    if (candidate) return candidate.version
  }

  // Try resolving any loaded @deepseek-ai/dsh-* core package manifest in the Host process.
  const probes = [
    '@deepseek-ai/dsh',
    '@deepseek-ai/dsh-plugin-manager',
    '@deepseek-ai/dsh-app-boot',
    '@deepseek-ai/dsh-web-server',
    '@deepseek-ai/dsh-tools',
  ]
  const req = safeCreateRequire(ctx)
  if (req) {
    for (const pkg of probes) {
      try {
        const pkgJsonPath = req.resolve(`${pkg}/package.json`)
        const raw = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as { version?: unknown }
        const parsed = typeof raw.version === 'string' ? parseSemver(raw.version) : null
        if (parsed) return parsed.version
      } catch {
        // Probe next package.
      }
    }
  }
  return null
}

/** Resolve active profile directory from Cordis host context. */
export function detectProfileDirectory(ctx: unknown): string | null {
  if (!ctx || typeof ctx !== 'object') return null
  const host = ctx as { get?: (name: string, strict?: boolean) => unknown; baseUrl?: unknown }
  try {
    const profileCtx = host.get?.('profileContext', false) as { dir?: unknown } | undefined
    if (typeof profileCtx?.dir === 'string' && profileCtx.dir.trim()) {
      return resolve(profileCtx.dir.trim())
    }
  } catch {
    // Optional service absent.
  }
  if (typeof host.baseUrl === 'string' && host.baseUrl.trim()) {
    try {
      const basePath = host.baseUrl.includes('://')
        ? resolve(fileURLToPath(host.baseUrl))
        : resolve(host.baseUrl)
      if (existsSync(join(basePath, 'package.json'))) return basePath
      const parent = dirname(basePath)
      if (existsSync(join(parent, 'package.json'))) return parent
    } catch {
      return null
    }
  }
  return null
}

export function detectIsDesktopHost(ctx: unknown, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.ELECTRON_RUN_AS_NODE === '1' || Boolean(env.DSH_DESKTOP_USER_DATA_DIR)) return true
  const profileDir = detectProfileDirectory(ctx)
  if (profileDir && /[\\/]profiles[\\/]desktop$/i.test(profileDir)) return true
  return false
}

function safeCreateRequire(ctx: unknown): NodeRequire | null {
  try {
    const host = ctx && typeof ctx === 'object' ? (ctx as { baseUrl?: unknown }) : undefined
    if (typeof host?.baseUrl === 'string' && host.baseUrl.startsWith('file:')) {
      return createRequire(host.baseUrl)
    }
  } catch {
    // Fall back to import.meta.url below.
  }
  try {
    return createRequire(import.meta.url)
  } catch {
    return null
  }
}

function extractDiagnostic(outcome: HostUpdateOutcome): string | undefined {
  const text = outcome.diagnostic || outcome.output || outcome.packageResult?.output
  return typeof text === 'string' && text.trim() ? text.trim().slice(0, 4_000) : undefined
}

async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.min(concurrency, items.length || 1))
  const results = new Array<R>(items.length)
  let cursor = 0

  async function next(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index]!, index)
    }
  }

  await Promise.all(Array.from({ length: limit }, () => next()))
  return results
}
