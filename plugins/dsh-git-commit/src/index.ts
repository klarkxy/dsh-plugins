import type { Context } from '@deepseek-ai/cordis'
import type { LlmTextCaller } from '@klarkxy/dsh-plugin-kit'
import { registerHostRpc, type HostRpcContext } from '@klarkxy/dsh-plugin-kit/host-rpc'
import { modelSettingsChangesIdentity } from '@klarkxy/dsh-plugin-kit/contracts'
import { createModelSettingsChanges } from '@klarkxy/dsh-plugin-kit/model-settings-changes'
import { registerModelSettings, notifyModelSettingsChanged, type ModelSettingsEvents } from '@klarkxy/dsh-plugin-kit/model-settings'
import {
  PLUGIN_NAME, RPC_CHANNEL, SETTINGS_KEY, normalizeFallback, normalizeModelRoute,
  type CommitRunResult, type GitCommitSettings, type GitCommitStatus, type RpcResult,
} from './contracts.ts'
import { CommitRunError, GitCommitService, type AgentStoreLike, type GitCommitServiceDeps, type SessionStoreLike } from './service.ts'
import { gitCommitDomain, parseSettings, updateSettingsSchema } from './storage.ts'

export const name = PLUGIN_NAME
export const inject = ['llm', 'sessions', 'workingDirectory', 'agents', 'storageDomain', 'connection', 'webServer', 'sessionProjections', 'agentDefaultModel'] as const
export { GitCommitService } from './service.ts'
export { parsePorcelain } from './git.ts'
export { parsePlan, buildPlanInput } from './plan.ts'
export { defaultSettings, normalizeFallback, normalizeModelRoute } from './contracts.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { gitCommit: GitCommitService }
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
  llm: LlmTextCaller
  sessions: SessionStoreLike
  workingDirectory: GitCommitServiceDeps['workingDirectory']
  agents: AgentStoreLike
  storageDomain: { open: (spec: typeof gitCommitDomain) => Promise<DomainHandle> }
}

function stringField(payload: unknown, key: string): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const value = (payload as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function fail(error: unknown): RpcResult<never> {
  if (error instanceof CommitRunError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.partial ? { partial: error.partial } : {}),
      },
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, error: { code: 'internal', message } }
}

export async function handleRpc(
  service: GitCommitService,
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
): Promise<RpcResult> {
  try {
    switch (endpoint) {
      case 'status': {
        const sessionId = stringField(payload, 'sessionId')
        if (!sessionId) return { ok: false, error: { code: 'bad-request', message: 'sessionId is required' } }
        const value: GitCommitStatus = await service.status(sessionId, signal)
        return { ok: true, value }
      }
      case 'settings': {
        await service.ready()
        return { ok: true, value: service.getSettings() }
      }
      case 'settings.update': {
        const parsed = updateSettingsSchema.safeParse(payload)
        if (!parsed.success) return { ok: false, error: { code: 'bad-request', message: 'settings patch is invalid' } }
        const value: GitCommitSettings = await service.updateSettings(
          {
            model: normalizeModelRoute(parsed.data.settings.model),
            allowFallback: normalizeFallback(parsed.data.settings.allowFallback),
          },
          parsed.data.expectedRevision,
        )
        return { ok: true, value }
      }
      case 'commit': {
        const sessionId = stringField(payload, 'sessionId')
        if (!sessionId) return { ok: false, error: { code: 'bad-request', message: 'sessionId is required' } }
        const value: CommitRunResult = await service.commit(sessionId, signal)
        return { ok: true, value }
      }
      default:
        return { ok: false, error: { code: 'not-found', message: `unknown endpoint: ${endpoint}` } }
    }
  } catch (error) {
    return fail(error)
  }
}

export function apply(ctx: Context): void {
  createModelSettingsChanges(ctx, modelSettingsChangesIdentity(PLUGIN_NAME), PLUGIN_NAME)
  const host = ctx as Host
  // Publish immediately; service operations wait for the initial stored row.
  const domainPromise = host.storageDomain.open(gitCommitDomain)
  const tablePromise = domainPromise.then(domain => domain.table('settings'))
  const service = new GitCommitService({
    plugin: PLUGIN_NAME,
    onSettingsChanged: revision => notifyModelSettingsChanged(ctx, PLUGIN_NAME, revision),
    llm: host.llm,
    host,
    sessions: host.sessions,
    workingDirectory: host.workingDirectory,
    agents: host.agents,
    settings: {
      load: async () => parseSettings((await tablePromise).get(SETTINGS_KEY)),
      save: async settings => { await (await tablePromise).put(SETTINGS_KEY, settings) },
    },
  })
  service.start()
  ctx.provide('gitCommit', service)
  ctx.effect(() => async () => {
    await service.dispose()
    await (await domainPromise).close()
  }, 'git-commit.lifecycle')
  ctx.effect(() => registerHostRpc(host, RPC_CHANNEL, (endpoint, payload, signal) => handleRpc(service, endpoint, payload, signal)), 'git-commit.rpc')
  ctx.effect(() => registerModelSettings(ctx as unknown as ModelSettingsEvents, {
    ns: PLUGIN_NAME, title: { zh: 'Git 提交', en: 'Git Commit' },
    async read(signal) {
      await service.ready(); signal.throwIfAborted()
      const settings = service.getSettings()
      return { revision: settings.revision, fields: [{ path: ['model'], label: { zh: '提交模型', en: 'Commit model' }, current: settings.model,
        followLabel: { zh: '当前会话 / 宿主默认模型', en: 'Current conversation / host default' }, allowFollow: true }] }
    },
    async write(path, route, expectedRevision, signal) {
      if (path.length !== 1 || path[0] !== 'model') throw new Error('Unknown Git Commit model setting')
      await service.ready(); signal.throwIfAborted()
      return service.updateSettings({ ...service.getSettings(), model: route }, expectedRevision)
    },
  }), 'git-commit.model-settings')
}
