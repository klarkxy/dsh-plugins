import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { registerHostRpc, type HostRpcContext } from '@klarkxy/dsh-plugin-kit/host-rpc'
import {
  PLUGIN_NAME, RPC_CHANNEL,
  type DelegationSessionStatus, type DelegationSettings, type RpcResult,
} from './contracts.ts'
import { delegationDomain,
  sessionStatusSchema, sessionUpdateSchema, settingsUpdateSchema } from './storage.ts'
import { DelegationError, DelegationService, type DelegationAgentLike, type DelegationServiceDeps } from './service.ts'
import { delegationSectionText, delegationReminderText, type DelegationLookups } from './policy.ts'

export const name = PLUGIN_NAME
export const inject = ['systemPrompt', 'storageDomain', 'sessions', 'agents', 'tools', 'sessionQuery', 'sessionProjections', 'connection', 'webServer'] as const
export { DelegationService, DelegationError } from './service.ts'
export { delegationSectionText } from './policy.ts'
export { coordinatorPrompt, EXECUTOR_PROMPT } from './prompts.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { delegation: DelegationService }
}

function fail(error: unknown): RpcResult<never> {
  if (error instanceof DelegationError) {
    return { ok: false, error: { code: error.code, message: error.message } }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, error: { code: 'internal', message } }
}

export async function handleRpc(
  service: DelegationService,
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
): Promise<RpcResult> {
  try {
    switch (endpoint) {
      case 'settings': {
        const value: DelegationSettings = service.getSettings()
        return { ok: true, value }
      }
      case 'settings.update': {
        const parsed = settingsUpdateSchema.safeParse(payload)
        if (!parsed.success) return { ok: false, error: { code: 'bad-request', message: 'settings update is invalid' } }
        const value: DelegationSettings = await service.updateSettings(parsed.data.defaultEnabled, parsed.data.expectedRevision)
        return { ok: true, value }
      }
      case 'session.status': {
        const parsed = sessionStatusSchema.safeParse(payload)
        if (!parsed.success) return { ok: false, error: { code: 'bad-request', message: 'sessionId is required' } }
        const value: DelegationSessionStatus = await service.sessionStatus(parsed.data.sessionId, signal)
        return { ok: true, value }
      }
      case 'session.update': {
        const parsed = sessionUpdateSchema.safeParse(payload)
        if (!parsed.success) return { ok: false, error: { code: 'bad-request', message: 'session update is invalid' } }
        const value: DelegationSessionStatus = await service.updateSession(
          parsed.data.sessionId, parsed.data.enabled, parsed.data.expectedRevision, signal)
        return { ok: true, value }
      }
      default:
        return { ok: false, error: { code: 'not-found', message: `unknown endpoint: ${endpoint}` } }
    }
  } catch (error) {
    return fail(error)
  }
}

export async function apply(ctx: Context): Promise<void> {
  const host = ctx as Context & HostRpcContext
  const domain = await ctx.storageDomain.open(delegationDomain)
  const service = new DelegationService({
    settings: domain.table('settings'),
    records: domain.table('sessions'),
    sessionStore: ctx.sessions as unknown as DelegationServiceDeps['sessionStore'],
    agents: ctx.agents as unknown as DelegationServiceDeps['agents'],
    tools: ctx.tools as unknown as DelegationServiceDeps['tools'],
    sessionQuery: ctx.sessionQuery as unknown as DelegationServiceDeps['sessionQuery'],
    hasStarted: session => {
      const boundary = ctx.sessionProjections.stateOf(session as Session, 'turnBoundary')
      return boundary === undefined || boundary.openTurnStartSeq !== null || boundary.lastTurn > 0
    },
  })
  ctx.provide('delegation', service)
  ctx.effect(() => () => domain.close(), 'delegation.lifecycle')
  // Seeding listens on agent/created: serial and awaited before the agent's
  // queued work, so the row exists before the first prompt assembly. A throw
  // here would fail agent creation, so the listener never propagates one.
  ctx.effect(() => ctx.on('agent/created', async ({ agent, source }: { agent: DelegationAgentLike; source: string }) => {
    try {
      await service.seedSession(agent, source)
    } catch (error) {
      ctx.logger.warn('dsh-delegation: could not seed session state: %s', error instanceof Error ? error.message : String(error))
    }
  }), 'delegation.seed')
  // Read-only advisory text evaluated at every assembly; the choice is locked
  // before the first model step and stays stable across later turns. Covers
  // subagent sessions deliberately: the executor half IS their prompt.
  const sectionSessions = ctx.sessions as unknown as DelegationServiceDeps['sessionStore']
  const sectionTools = ctx.tools as unknown as DelegationServiceDeps['tools']
  const lookups: DelegationLookups = {
    record: sessionId => service.record(sessionId),
    session: id => sectionSessions?.get(id),
    toolVisible: (tool, scope) => sectionTools?.get(tool, scope) !== undefined,
  }
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'delegation:policy',
    order: ctx.systemPrompt.getSectionOrder('TOOL_SUBAGENT') + 2,
    interpolate: false,
    text: context => delegationSectionText(context, lookups),
  }), 'delegation.section')
  // Native runtime context is durable and appended only when its snapshot
  // changes (or after compaction), not a new reminder injected at every step.
  // Include children deliberately: a fork must replace inherited coordinator
  // context with its own executor role. Neither contribution writes by itself.
  ctx.effect(() => ctx.systemPrompt.context({
    name: 'delegation:role',
    order: ctx.systemPrompt.getContextOrder('SUBAGENT_DELEGATION') + 2,
    required: true,
    interpolate: false,
    text: context => delegationReminderText(context, lookups),
  }), 'delegation.context')
  ctx.effect(() => registerHostRpc(host, RPC_CHANNEL,
    (endpoint, payload, signal) => handleRpc(service, endpoint, payload, signal)), 'delegation.rpc')
}
