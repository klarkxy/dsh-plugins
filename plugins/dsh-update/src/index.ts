import type { Context } from '@deepseek-ai/cordis'
import { registerHostRpc, type HostRpcContext } from '@klarkxy/dsh-plugin-kit/host-rpc'
import { installPluginLogger } from '@klarkxy/dsh-plugin-kit/logger'
import {
  PLUGIN_NAME,
  RPC_CHANNEL,
  type DshApplyCliUpdateRequest,
  type DshUpdateCheckRequest,
  type DshUpdateFixture,
  type HostUpdateApproval,
  type HostUpdateApprovalRequest,
  type PluginApplyUpdateRequest,
  type PluginCheckAllRequest,
  type PluginCheckOneRequest,
  type RpcResult,
} from './contracts.ts'
import {
  PluginUpdateService,
  detectHostDshVersion,
  detectIsDesktopHost,
  detectProfileDirectory,
  type HostPluginManagerLike,
} from './plugin-updater.ts'
import { ReleaseMetadataResolver } from './releases.ts'

export {
  PLUGIN_NAME,
  RPC_CHANNEL,
  compareSemver,
  extractTagVersion,
  parseSemver,
  selectReleasesBetween,
  splitBilingualReleaseBody,
} from './contracts.ts'
export { ReleaseMetadataResolver, mapGitHubReleases, resolveGitHubRepoRef } from './releases.ts'
export { PluginUpdateService, detectHostDshVersion, detectIsDesktopHost } from './plugin-updater.ts'

export const name = PLUGIN_NAME
export const inject = ['connection', 'webServer'] as const

export interface DshUpdateHostService {
  readonly resolver: ReleaseMetadataResolver
  readonly updater: PluginUpdateService
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshUpdate: DshUpdateHostService
  }
}

const APPROVAL_SERVICE = 'dshUpdateApproval'
const FIXTURE_SERVICE = 'dshUpdateFixture'

type HostContext = Context & HostRpcContext & {
  get?: (serviceName: string, strict?: boolean) => unknown
  root?: { get?: (serviceName: string, strict?: boolean) => unknown }
  pluginManager?: HostPluginManagerLike
}

export function apply(ctx: Context): void {
  const logger = installPluginLogger(ctx, PLUGIN_NAME)
  const host = ctx as HostContext
  const resolver = new ReleaseMetadataResolver()

  const resolveManager = (): HostPluginManagerLike | undefined => {
    try {
      const fromGet = host.get?.('pluginManager', false) as HostPluginManagerLike | undefined
      if (fromGet && typeof fromGet.listBundles === 'function') return fromGet
    } catch {
      // Optional service lookup failed; try direct property below.
    }
    if (host.pluginManager && typeof host.pluginManager.listBundles === 'function') {
      return host.pluginManager
    }
    return undefined
  }

  const updater = new PluginUpdateService({
    resolver,
    getPluginManager: resolveManager,
    getProfileDir: () => detectProfileDirectory(host),
    getDshVersion: () => detectHostDshVersion(host),
    isDesktopHost: () => detectIsDesktopHost(host),
  })

  ctx.provide('dshUpdate', { resolver, updater })

  ctx.effect(() =>
    registerHostRpc(
      host,
      RPC_CHANNEL,
      async (endpoint, payload, signal): Promise<RpcResult> => {
        try {
          signal.throwIfAborted()
          const body = isObject(payload) ? payload : {}

          if (endpoint === 'dsh.check') {
            const fixtureDsh = readFixture(host)?.dsh
            if (fixtureDsh) return { ok: true, value: fixtureDsh }
            const req: DshUpdateCheckRequest = {
              ...(typeof body.clientVersion === 'string' ? { clientVersion: body.clientVersion } : {}),
              ...(typeof body.desktopTargetVersion === 'string' ? { desktopTargetVersion: body.desktopTargetVersion } : {}),
              ...(body.channel === 'stable' || body.channel === 'prerelease' ? { channel: body.channel } : {}),
              ...(body.forceRefresh === true ? { forceRefresh: true } : {}),
            }
            const result = await resolver.checkDshUpdates(
              detectHostDshVersion(host),
              detectIsDesktopHost(host),
              req,
              signal,
            )
            return { ok: true, value: result }
          }

          if (endpoint === 'plugins.checkAll') {
            const fixturePlugins = readFixture(host)?.plugins
            if (fixturePlugins) {
              return {
                ok: true,
                value: {
                  dshVersion: detectHostDshVersion(host),
                  checkedAt: new Date().toISOString(),
                  plugins: fixturePlugins,
                },
              }
            }
            const req: PluginCheckAllRequest = {
              ...(body.includePrerelease === true ? { includePrerelease: true } : {}),
              ...(body.forceRefresh === true ? { forceRefresh: true } : {}),
            }
            const result = await updater.checkAllPlugins(req, signal)
            return { ok: true, value: result }
          }

          if (endpoint === 'plugins.checkOne') {
            if (typeof body.name !== 'string' || !body.name.trim()) {
              return {
                ok: false,
                error: { code: 'INVALID_PLUGIN_NAME', message: '缺少要检查的插件名称。' },
              }
            }
            const pluginName = body.name.trim()
            const fixtureOne = readFixture(host)?.plugins?.find(item => item.name === pluginName)
            if (fixtureOne) return { ok: true, value: fixtureOne }
            const req: PluginCheckOneRequest = {
              name: pluginName,
              ...(typeof body.targetVersion === 'string' ? { targetVersion: body.targetVersion } : {}),
              ...(body.includePrerelease === true ? { includePrerelease: true } : {}),
              ...(body.forceRefresh === true ? { forceRefresh: true } : {}),
            }
            const result = await updater.checkOnePlugin(req, signal)
            return { ok: true, value: result }
          }

          if (endpoint === 'plugins.apply') {
            if (typeof body.name !== 'string' || !body.name.trim() || typeof body.targetVersion !== 'string' || !body.targetVersion.trim()) {
              return {
                ok: false,
                error: { code: 'INVALID_UPDATE_REQUEST', message: '插件名称或目标版本参数缺失。' },
              }
            }
            const req: PluginApplyUpdateRequest = {
              name: body.name.trim(),
              targetVersion: body.targetVersion.trim(),
              ...(typeof body.targetSpec === 'string' && body.targetSpec.trim() ? { targetSpec: body.targetSpec.trim() } : {}),
              ...(typeof body.registry === 'string' && body.registry.trim() ? { registry: body.registry.trim() } : {}),
            }
            const approval = await requireHostApproval(host, {
              kind: 'plugin',
              name: req.name,
              targetVersion: req.targetVersion,
              ...(req.targetSpec ? { targetSpec: req.targetSpec } : {}),
            }, signal)
            if (approval) return approval
            const fixtureApply = readFixture(host)?.applyPlugin
            if (fixtureApply) {
              const result = await fixtureApply(req)
              return { ok: true, value: result }
            }
            logger.info('plugin.update.approved', 'Host approved a plugin update.', {
              plugin: req.name,
              targetVersion: req.targetVersion,
            })
            const result = await updater.applyPluginUpdate(req)
            return { ok: true, value: result }
          }

          if (endpoint === 'dsh.applyCli') {
            const req = body as Partial<DshApplyCliUpdateRequest>
            if (typeof req.targetVersion !== 'string' || !req.targetVersion.trim()) {
              return {
                ok: false,
                error: { code: 'INVALID_DSH_VERSION', message: '缺少目标 DSH 版本号。' },
              }
            }
            const targetVersion = req.targetVersion.trim()
            const approval = await requireHostApproval(host, {
              kind: 'dsh-cli',
              targetVersion,
            }, signal)
            if (approval) return approval
            const fixtureCli = readFixture(host)?.applyCli
            if (fixtureCli) {
              const result = await fixtureCli(targetVersion)
              return { ok: true, value: result }
            }
            logger.info('dsh.cli-update.approved', 'Host approved a CLI DSH update.', {
              targetVersion,
            })
            const result = await updater.applyCliDshUpdate(targetVersion)
            return { ok: true, value: result }
          }

          return {
            ok: false,
            error: { code: 'UNKNOWN_ENDPOINT', message: `未知 RPC 方法：${endpoint}` },
          }
        } catch (error) {
          logger.error('rpc.error', 'dsh-update RPC request failed.', error, { endpoint })
          return {
            ok: false,
            error: {
              code: 'UPDATE_RPC_FAILED',
              message: error instanceof Error ? error.message : '更新服务请求失败。',
            },
          }
        }
      },
      { logger },
    ),
    'dsh-update.rpc',
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function readOptionalService(host: HostContext, name: string): unknown {
  const scopes = [host, host.root].filter((scope): scope is NonNullable<typeof scope> => Boolean(scope))
  const seen = new Set<object>()
  for (const scope of scopes) {
    if (seen.has(scope)) continue
    seen.add(scope)
    try {
      const value = scope.get?.(name, false)
      if (value) return value
    } catch {
      // Optional service lookup failed.
    }
  }
  return undefined
}

function readApproval(host: HostContext): HostUpdateApproval | undefined {
  const value = readOptionalService(host, APPROVAL_SERVICE)
  if (!value || typeof value !== 'object' || typeof (value as HostUpdateApproval).confirm !== 'function') return undefined
  return value as HostUpdateApproval
}

function readFixture(host: HostContext): DshUpdateFixture | undefined {
  const value = readOptionalService(host, FIXTURE_SERVICE)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as DshUpdateFixture
}

/**
 * Page-supplied flags are ignored. Only the host approval service can allow a
 * write, and a missing service fails closed so `plugins.apply` cannot install.
 */
async function requireHostApproval(
  host: HostContext,
  request: HostUpdateApprovalRequest,
  signal: AbortSignal,
): Promise<RpcResult | null> {
  const gate = readApproval(host)
  if (!gate) {
    return {
      ok: false,
      error: {
        code: 'HOST_APPROVAL_UNAVAILABLE',
        message: '宿主未提供更新确认，已拒绝安装或升级。',
      },
    }
  }
  let approved = false
  try {
    signal.throwIfAborted()
    approved = await gate.confirm(request, signal)
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'HOST_APPROVAL_FAILED',
        message: error instanceof Error ? error.message : '宿主确认失败，未修改已安装的插件。',
      },
    }
  }
  if (signal.aborted || approved !== true) {
    return {
      ok: false,
      error: {
        code: 'HOST_APPROVAL_REJECTED',
        message: '宿主拒绝了这次更新，未修改已安装的插件。',
      },
    }
  }
  return null
}
