import type {} from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { registerHostRpc, type HostRpcContext } from '@klarkxy/dsh-plugin-kit/host-rpc'
import { installPluginLogger, type PluginLogger } from '@klarkxy/dsh-plugin-kit/logger'
import {
  PLUGIN_NAME, RPC_CHANNEL, SETTINGS_KEY,
  type QuickReviewSettings, type ReviewScope, type ReviewStartValue, type ReviewStatus,
  type ReviewStatusValue, type RpcResult,
} from './contracts.ts'
import { reviewPrompt } from './prompts.ts'
import {
  QuickReviewError, QuickReviewService,
  type DefaultModelLike, type LlmLike, type PermissionPresetsLike, type QuickReviewServiceDeps,
  type SessionControllerLike, type SessionTitleLike, type WorkspaceChangesLike, type WorkspaceRegistryLike,
} from './service.ts'
import { quickReviewDomain, parseSettings, updateSettingsSchema } from './storage.ts'

export const name = PLUGIN_NAME
export const inject = ['sessionController', 'sessionQuery', 'llm', 'storageDomain', 'connection', 'webServer'] as const
export { QuickReviewService } from './service.ts'
export { reviewPrompt } from './prompts.ts'
export { parseReviewAddress, reviewAddress } from './contracts.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { quickReview: QuickReviewService }
}

type DomainTableHandle = {
  get(key: string): unknown
  put(key: string, value: unknown): Promise<void>
}

type DomainHandle = {
  table(name: 'settings'): DomainTableHandle
  close(): Promise<void>
}

type Host = Context & HostRpcContext & {
  llm: LlmLike
  sessionController: SessionControllerLike
  sessionQuery: QuickReviewServiceDeps['sessionQuery']
  storageDomain: { open: (spec: typeof quickReviewDomain) => Promise<DomainHandle> }
}

function stringField(payload: unknown, key: string): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const value = (payload as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function modelField(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return undefined
  return (payload as Record<string, unknown>).model
}

function fail(error: unknown, endpoint?: string, logger?: PluginLogger): RpcResult<never> {
  if (error instanceof QuickReviewError) {
    if (error.code === 'busy' || error.code === 'stale') {
      logger?.debug('rpc.domain-error', error.message, { endpoint: endpoint ?? null, code: error.code })
    } else {
      logger?.warn('rpc.domain-error', error.message, undefined, { endpoint: endpoint ?? null, code: error.code })
    }
    return { ok: false, error: { code: error.code, message: error.message } }
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return { ok: false, error: { code: 'cancelled', message: error.message } }
  }
  logger?.error('rpc.internal-error', 'Unexpected Quick Review RPC error.', error, { endpoint: endpoint ?? null })
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, error: { code: 'internal', message } }
}

export async function handleRpc(
  service: QuickReviewService,
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
  logger?: PluginLogger,
): Promise<RpcResult> {
  try {
    switch (endpoint) {
      case 'scope': {
        const sourceSessionId = stringField(payload, 'sourceSessionId')
        if (!sourceSessionId) return { ok: false, error: { code: 'bad-request', message: 'sourceSessionId is required' } }
        const value: ReviewScope = await service.scope(sourceSessionId, signal)
        return { ok: true, value }
      }
      case 'start': {
        const sourceSessionId = stringField(payload, 'sourceSessionId')
        if (!sourceSessionId) return { ok: false, error: { code: 'bad-request', message: 'sourceSessionId is required' } }
        const focus = stringField(payload, 'focus')
        const value: ReviewStartValue = await service.start(
          { sourceSessionId, model: modelField(payload), ...(focus === undefined ? {} : { focus: focus.slice(0, 2000) }) },
          signal,
        )
        return { ok: true, value }
      }
      case 'status': {
        const sourceSessionId = stringField(payload, 'sourceSessionId')
        const reviewSessionId = stringField(payload, 'reviewSessionId')
        if (!sourceSessionId && !reviewSessionId) {
          return { ok: false, error: { code: 'bad-request', message: 'sourceSessionId or reviewSessionId is required' } }
        }
        const value: ReviewStatusValue = service.status({
          ...(sourceSessionId === undefined ? {} : { sourceSessionId }),
          ...(reviewSessionId === undefined ? {} : { reviewSessionId }),
        })
        return { ok: true, value }
      }
      case 'resend': {
        const reviewSessionId = stringField(payload, 'reviewSessionId')
        if (!reviewSessionId) return { ok: false, error: { code: 'bad-request', message: 'reviewSessionId is required' } }
        const value: ReviewStatus = await service.resend(reviewSessionId, signal)
        return { ok: true, value }
      }
      case 'settings': {
        await service.ready()
        const value: QuickReviewSettings = service.getSettings()
        return { ok: true, value }
      }
      case 'settings.update': {
        const parsed = updateSettingsSchema.safeParse(payload)
        if (!parsed.success) return { ok: false, error: { code: 'bad-request', message: 'settings patch is invalid' } }
        const value: QuickReviewSettings = await service.updateSettings(parsed.data.settings, parsed.data.expectedRevision)
        return { ok: true, value }
      }
      default:
        return { ok: false, error: { code: 'not-found', message: `unknown endpoint: ${endpoint}` } }
    }
  } catch (error) {
    return fail(error, endpoint, logger)
  }
}

export async function apply(ctx: Context): Promise<void> {
  const logger = installPluginLogger(ctx, PLUGIN_NAME, { forwardHostWarnError: false })
  const host = ctx as Host
  // Publish immediately; service operations wait for the initial stored row.
  const domainPromise = host.storageDomain.open(quickReviewDomain)
  const tablePromise = domainPromise.then(domain => domain.table('settings'))
  const deps: QuickReviewServiceDeps = {
    plugin: PLUGIN_NAME,
    logger,
    sessionController: host.sessionController,
    sessionQuery: host.sessionQuery,
    llm: host.llm,
    // Optional host services are resolved per call: a service that mounts
    // after this plugin still gets picked up.
    workspaceChanges: () => ctx.get('workspaceChanges') as WorkspaceChangesLike | undefined,
    workspaceRegistry: () => ctx.get('workspaceRegistry') as WorkspaceRegistryLike | undefined,
    permissionPresets: () => ctx.get('permissionPresets') as PermissionPresetsLike | undefined,
    agentDefaultModel: () => ctx.get('agentDefaultModel') as DefaultModelLike | undefined,
    sessionTitle: () => ctx.get('sessionTitle') as SessionTitleLike | undefined,
    settings: {
      load: async () => parseSettings((await tablePromise).get(SETTINGS_KEY)),
      save: async settings => { await (await tablePromise).put(SETTINGS_KEY, settings) },
    },
  }
  const service = new QuickReviewService(deps)
  ctx.provide('quickReview', service)
  ctx.effect(() => async () => {
    await service.dispose()
    await (await domainPromise).close()
  }, 'quick-review.lifecycle')
  ctx.effect(() => {
    const offEvent = ctx.on('session/event', service.onSessionEvent)
    const offDisposed = ctx.on('agent/disposed', service.onAgentDisposed)
    return () => {
      offEvent()
      offDisposed()
    }
  }, 'quick-review.tracking')
  ctx.effect(() => registerHostRpc(
    host,
    RPC_CHANNEL,
    (endpoint, payload, signal) => handleRpc(service, endpoint, payload, signal, logger),
    { logger },
  ), 'quick-review.rpc')
}
