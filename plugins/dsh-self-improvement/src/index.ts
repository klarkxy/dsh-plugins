import type { Context } from '@deepseek-ai/cordis'
import type { LlmTextCaller } from '@klarkxy/dsh-plugin-kit'
import { SELF_IMPROVEMENT_RPC_CHANNEL, type MemoryService, type PreStepDecision, type SelfImprovementSettings, type SessionWatermark, type SkillRecord } from './contracts.ts'
import { SelfImprovementEngine, type KvTableLike, type SessionLike } from './engine.ts'
import { registerHostRpc, type HostRpcContext } from '@klarkxy/dsh-plugin-kit/host-rpc'
import { selfImprovementDomain } from './storage.ts'

export const name = '@klarkxy/dsh-self-improvement'
export const inject = ['storageDomain', 'connection', 'webServer', 'llm'] as const
export { CHAT_EVENTS_SLOT, SELF_IMPROVEMENT_RPC_CHANNEL } from './contracts.ts'
export { SelfImprovementEngine } from './engine.ts'

declare module '@deepseek-ai/cordis' { interface Context { selfImprovement: SelfImprovementEngine } }

type DomainHandle = {
  table(name: 'skills'): KvTableLike<SkillRecord>
  table(name: 'watermarks'): KvTableLike<SessionWatermark>
  table(name: 'settings'): KvTableLike<SelfImprovementSettings>
  close(): Promise<void>
}

type Host = Context & HostRpcContext & {
  storageDomain: { open(spec: typeof selfImprovementDomain): Promise<DomainHandle> }
  llm: LlmTextCaller
}

function readService<T>(ctx: Context, key: string): T | undefined {
  const record = ctx as Context & { get?: (name: string) => unknown }
  try {
    const direct = (record as unknown as Record<string, unknown>)[key]
    if (direct !== undefined) return direct as T
  } catch { /* missing cordis accessors throw */ }
  try { return record.get?.(key) as T | undefined } catch { return undefined }
}

function sessionOf(ctx: Context, sessionId: string): SessionLike | undefined {
  const sessions = readService<{ get?(id: string): SessionLike | undefined }>(ctx, 'sessions')
  return sessions?.get?.(sessionId)
}

export function listen(ctx: Context, name: string, handler: (...args: never[]) => unknown): (() => void) | undefined {
  const on = ctx.on as unknown as (event: string, listener: (...args: never[]) => unknown) => (() => void) | void
  const off = on.call(ctx, name, handler)
  return typeof off === 'function' ? off : undefined
}

export async function apply(ctx: Context): Promise<void> {
  const host = ctx as Host
  const domain = await host.storageDomain.open(selfImprovementDomain)
  const engine = new SelfImprovementEngine({
    memory: () => readService<MemoryService>(ctx, 'aiMemory'),
    llm: host.llm,
    host,
    sessionOf: id => sessionOf(ctx, id),
    skills: domain.table('skills'),
    watermarks: domain.table('watermarks'),
    settings: domain.table('settings'),
  })
  ctx.effect(() => async () => { engine.dispose(); await domain.close() }, 'self-improvement.dispose')
  ctx.provide('selfImprovement', engine)
  ctx.effect(() => registerHostRpc(host, SELF_IMPROVEMENT_RPC_CHANNEL, (endpoint, payload, signal) => engine.call(endpoint, payload, signal)), 'self-improvement.rpc')
  ctx.effect(() => {
    const offStep = listen(ctx, 'agent/pre-step', (async (
      payload: { agent: { session: SessionLike }; signal: AbortSignal },
      next: () => Promise<PreStepDecision>,
    ) => {
      const decision = await next()
      return engine.applyPreStep(payload.agent.session, decision, payload.signal)
    }) as never)
    const offStop = listen(ctx, 'agent/turn-stopping', ((payload: { agent: { session: SessionLike }; signal: AbortSignal }) => {
      void engine.considerSession(payload.agent.session, payload.signal)
    }) as never)
    return () => { offStep?.(); offStop?.() }
  }, 'self-improvement.hooks')
}
