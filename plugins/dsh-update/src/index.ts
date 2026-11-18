import type { Context } from '@deepseek-ai/cordis'
import { registerHostRpc, type HostRpcContext } from '@klarkxy/dsh-plugin-kit/host-rpc'
import { installPluginLogger } from '@klarkxy/dsh-plugin-kit/logger'
import {
  PLUGIN_NAME,
  RPC_CHANNEL,
  type DshApplyCliUpdateRequest,
  type DshUpdateCheckRequest,
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

type HostContext = Context & HostRpcContext & {
  get?: (serviceName: string, strict?: boolean) => unknown
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
            const req: PluginCheckOneRequest = {
              name: body.name.trim(),
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
            logger.info('plugin.update.confirmed', 'Executing user-confirmed plugin update.', {
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
            logger.info('dsh.cli-update.confirmed', 'Executing user-confirmed CLI DSH update.', {
              targetVersion: req.targetVersion,
            })
            const result = await updater.applyCliDshUpdate(req.targetVersion.trim())
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
