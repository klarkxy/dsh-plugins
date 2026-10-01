import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import { registerHostRpc, type HostRpcContext } from '@klarkxy/dsh-plugin-kit/host-rpc'
import { MOOD_PLUGIN, MOOD_RPC_CHANNEL } from './contracts.ts'
import { MoodService } from './service.ts'
import { domainStore, moodDomain, type MoodDomainHandle } from './storage.ts'
import { createRequirementsTool } from './tools.ts'
import type { SessionEventLike } from './evidence.ts'

export const name = MOOD_PLUGIN
export const inject = ['storageDomain', 'sessions', 'tools'] as const
export { MoodService } from './service.ts'
export { domainStore, moodDomain } from './storage.ts'
export { MOOD_PLUGIN, MOOD_RPC_CHANNEL, projectIdFromCwd } from './contracts.ts'
export { createRequirementsTool } from './tools.ts'

declare module '@deepseek-ai/cordis' { interface Context { aiMood: MoodService } }

type Host = Context & {
  storageDomain: { open(spec: typeof moodDomain): Promise<MoodDomainHandle> }
  sessions: { get(id: unknown): { snapshotEvents(): readonly SessionEventLike[] } | undefined }
}

export async function apply(ctx: Context): Promise<void> {
  const host = ctx as Host
  const domain = await host.storageDomain.open(moodDomain)
  const service = new MoodService({
    store: domainStore(domain),
    readEvents: id => host.sessions.get(id)?.snapshotEvents(),
  })
  ctx.provide('aiMood', service)
  ctx.effect(() => async () => { await service.dispose(); await domain.close() }, 'dsh-mood.dispose')
  ctx.effect(() => ctx.tools.register(createRequirementsTool(service)), 'dsh-mood.tool')
  // Optional compatibility RPC does not make the tool depend on a Web host.
  ctx.inject(['connection', 'webServer'], scope => {
    scope.effect(() => registerHostRpc(scope as unknown as HostRpcContext, MOOD_RPC_CHANNEL,
      (endpoint, payload, signal) => service.call(endpoint, payload, signal)), 'dsh-mood.rpc')
  })
}
