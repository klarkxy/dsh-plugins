import type { Context } from '@deepseek-ai/cordis'
import type { AiServices, RpcResult } from '@klarkxy/dsh-ai-services/contracts'
import { registerHostRpc, type HostRpcContext } from '@klarkxy/dsh-ai-services/host-rpc'
import { PLUGIN_NAME, RPC_CHANNEL, type CommitRunResult, type GitCommitStatus } from './contracts.ts'
import { CommitRunError, GitCommitService, type AgentStoreLike, type SessionStoreLike } from './service.ts'

export const name = PLUGIN_NAME
export const inject = ['aiServices', 'sessions', 'agents', 'connection', 'webServer'] as const
export { GitCommitService } from './service.ts'
export { parsePorcelain } from './git.ts'
export { parsePlan, buildPlanInput } from './plan.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { gitCommit: GitCommitService }
}

type Host = Context & HostRpcContext & {
  aiServices: AiServices
  sessions: SessionStoreLike
  agents: AgentStoreLike
}

function stringField(payload: unknown, key: string): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const value = (payload as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function fail(error: unknown): RpcResult<never> {
  if (error instanceof CommitRunError) return { ok: false, error: { code: error.code, message: error.message } }
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
        const value: GitCommitStatus = await service.status(sessionId)
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
  const host = ctx as Host
  const service = new GitCommitService({ plugin: PLUGIN_NAME, ai: host.aiServices, sessions: host.sessions, agents: host.agents })
  service.start()
  ctx.provide('gitCommit', service)
  ctx.effect(() => async () => { await service.dispose() }, 'git-commit.lifecycle')
  ctx.effect(() => registerHostRpc(host, RPC_CHANNEL, (endpoint, payload, signal) => handleRpc(service, endpoint, payload, signal)), 'git-commit.rpc')
}
