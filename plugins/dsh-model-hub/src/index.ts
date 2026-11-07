/** Subagent model allowlist and delegation preferences. */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { registerHostRpc, type HostRpcContext } from '@klarkxy/dsh-plugin-kit/host-rpc'
import { notifyModelSettingsChanged } from '@klarkxy/dsh-plugin-kit/model-settings'
import { CAST_TENDENCIES_NAMESPACE, createCast } from './cast.ts'
import { registerHubModelSettingsChanges } from './changes.ts'

export const name = '@klarkxy/dsh-model-hub'
export const inject = ['settings', 'webServer', 'connection', 'systemPrompt'] as const
export const CHANNEL = '/dsh-model-hub'
export const Config = Schema.object({})

export function apply(ctx: Context): void {
  registerHubModelSettingsChanges(ctx)
  const profile = ctx.get('profileContext') as { dir: string } | undefined
  const settings = ctx.settings as { describe(options?: { redactSecrets?: boolean }): unknown[]; mutate(ns: string, ops: Array<{ op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] }>, expectedRevision?: number): Promise<void> }
  const cast = createCast({
    describe: () => settings.describe({ redactSecrets: true }) as never,
    mutate: (ns, ops, revision) => settings.mutate(ns, [...ops], revision),
    profileDir: profile?.dir, logger: ctx.logger,
    notifyTendenciesChanged: revision => notifyModelSettingsChanged(ctx, CAST_TENDENCIES_NAMESPACE, revision),
  })
  ctx.systemPrompt.section({
    name: 'model-hub:subagent-cast',
    order: ctx.systemPrompt.getSectionOrder('TOOL_SUBAGENT') + 1,
    interpolate: false,
    text: () => cast.promptText(() => (ctx.get('subagentModelSelection') as { current(): unknown } | undefined)?.current()),
  })
  ctx.effect(() => registerHostRpc(ctx as unknown as HostRpcContext, CHANNEL, async (endpoint, payload, signal) => {
    try {
      if (endpoint.startsWith('cast.')) {
        const row = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {}
        if (endpoint === 'cast.get') return { ok: true, value: cast.getCast() }
        if (endpoint === 'cast.setEnabled') return { ok: true, value: await cast.setEnabled(row.enabled, row.expectedRevision) }
        if (endpoint === 'cast.addRoute') return { ok: true, value: await cast.addRoute(row.route, row.expectedRevision) }
        if (endpoint === 'cast.setRoute') return { ok: true, value: await cast.setRoute(row.index, row.route, row.expectedRevision) }
        if (endpoint === 'cast.removeRoute') return { ok: true, value: await cast.removeRoute(row.index, row.expectedRevision) }
        if (endpoint === 'cast.setTendency') return { ok: true, value: cast.setTendency(row.provider, row.model, row.tendency, row.expectedRevision, signal) }
        if (endpoint === 'cast.setPreferences') return { ok: true, value: cast.setRoutePreferences(row.provider, row.model, row.preferences, row.expectedRevision, signal) }
      }
      throw new Error(`Unknown endpoint: ${endpoint}`)
    } catch (error) {
      return { ok: false, error: { code: 'model-hub/rejected', message: error instanceof Error ? error.message : String(error) } }
    }
  }, { isEndpoint: endpoint => /^[a-z][a-zA-Z.]*$/.test(endpoint) }))
}
