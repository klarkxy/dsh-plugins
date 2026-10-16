/**
 * dsh-model-hub — cross-plugin model settings hub.
 *
 * Host half: reads every plugin's settings descriptor through the host
 * `settings` service, runs model-route field detection, and serves the field
 * matrix to the browser half over an authenticated RPC channel. Writes go
 * through `settings.mutate` — the official settings page's own path — with
 * the descriptor revision as CAS. The boot probe report is kept: it is logged
 * and written to `<profile>/data/model-hub/probe-report.json`. The subagent
 * cast (cast.ts) edits the native subagent model-selection settings the same
 * way and injects per-route task tendencies into the system prompt.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { registerHostRpc, type HostRpcContext } from '@klarkxy/dsh-plugin-kit/host-rpc'
import { modelRouteRoleSchemastery, modelRouteSchemastery } from '@klarkxy/dsh-model-route/schemastery'
import { buildProbeReport, planFieldWrite, type ProbeDescriptorLike } from './probe.ts'
import { createHubSettings } from './owners.ts'
import { notifyModelSettingsChanged, type ModelSettingsDiscovery } from '@klarkxy/dsh-plugin-kit/model-settings'
import { ModelSettingsChangesController } from './changes.ts'
import { CAST_TENDENCIES_NAMESPACE, createCast } from './cast.ts'
import { createRunningTracker, RUNNING_NAMESPACE, type RunningAgentsLike, type RunningSubagentsServiceLike } from './running.ts'

export const name = '@klarkxy/dsh-model-hub'
export const inject = ['settings', 'webServer', 'connection', 'systemPrompt'] as const
export const CHANNEL = '/dsh-model-hub'

export const Config = Schema.object({
  selfTestMeta: modelRouteSchemastery({ purpose: 'self-test-meta', label: { zh: '自检字段（自定义键通道）', en: 'Self-test field (custom key)' } }).volatile(),
  selfTestRole: modelRouteRoleSchemastery({ purpose: 'self-test-role', label: { zh: '自检字段（role 通道）', en: 'Self-test field (role)' } }).volatile(),
})

interface ProfileContextLike {
  dir: string
}

/** Structural view of the host settings service, version-checked at runtime. */
interface SettingsLike {
  describe(options?: { redactSecrets?: boolean }): unknown[]
  mutate(ns: string, ops: ReturnType<typeof planFieldWrite>['ops'], expectedRevision?: number): Promise<void>
}

export function apply(ctx: Context): void {
  new ModelSettingsChangesController(ctx)
  const profile = ctx.get('profileContext') as ProfileContextLike | undefined
  const settings = ctx.settings as unknown as SettingsLike
  const describe = () => settings.describe({ redactSecrets: true }) as unknown as ProbeDescriptorLike[]
  // Loader adds entry to the runtime fiber; the settings-only type dependency
  // does not import that optional augmentation.
  const ownNamespace = (ctx.fiber as unknown as { entry?: { options?: { id?: string } } }).entry?.options?.id ?? name
  const hub = createHubSettings(ctx as unknown as ModelSettingsDiscovery, {
    describe, mutate: (ns, ops, revision) => settings.mutate(ns, ops, revision),
  }, ownNamespace)
  const cast = createCast({
    describe, mutate: (ns, ops, revision) => settings.mutate(ns, ops, revision),
    profileDir: profile?.dir, logger: ctx.logger,
    notifyTendenciesChanged: revision => notifyModelSettingsChanged(ctx, CAST_TENDENCIES_NAMESPACE, revision),
  })

  /* Live subagent routes: read-only session data. The registry and catalog
   * are optional services; without them the view degrades to an empty list. */
  const running = createRunningTracker({
    events: ctx,
    agents: ctx.get('agents') as RunningAgentsLike | undefined,
    subagents: ctx.get('subagents') as RunningSubagentsServiceLike | undefined,
    notify: revision => notifyModelSettingsChanged(ctx, RUNNING_NAMESPACE, revision),
  })

  /* Subagent cast guidance: read-only advisory text evaluated at each prompt
   * assembly — it never writes to disk or calls a model. It intentionally
   * applies to every session including subagent threads: the native selection
   * policy is inherited by child sessions, so the same tendencies stay valid
   * there. User-provided tendency text is injected verbatim
   * (interpolate: false). */
  ctx.systemPrompt.section({
    name: 'model-hub:subagent-cast',
    order: ctx.systemPrompt.getSectionOrder('TOOL_SUBAGENT') + 1,
    interpolate: false,
    text: () => cast.promptText(() => (ctx.get('subagentModelSelection') as { current(): unknown } | undefined)?.current()),
  })

  const run = (reason: string) => {
    let report
    try {
      report = buildProbeReport(describe())
    } catch (error) {
      ctx.logger.warn('model-hub: probe failed (%s): %s', reason, error instanceof Error ? error.message : String(error))
      return
    }
    ctx.logger.info(
      'model-hub: probe (%s): %d namespaces, %d with model fields; self-test extra-key=%s role=%s',
      reason, report.totalNamespaces, report.namespacesWithModelFields, report.selfTest.extraKey, report.selfTest.role,
    )
    if (profile?.dir) {
      try {
        const dir = join(profile.dir, 'data', 'model-hub')
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'probe-report.json'), JSON.stringify(report, null, 2))
      } catch (error) {
        ctx.logger.warn('model-hub: could not write probe report: %s', error instanceof Error ? error.message : String(error))
      }
    }
  }

  run('boot')
  ctx.on('settings/document-updated', () => run('document-updated'))

  /* Browser-facing field matrix: list detected fields, write one field back.
   * registerHostRpc keeps the host's origin/auth policy authoritative and
   * fails closed when it is absent. */
  ctx.effect(() => registerHostRpc(ctx as unknown as HostRpcContext, CHANNEL, async (endpoint, payload, signal) => {
    try {
      if (endpoint === 'fields.list') return { ok: true, value: await hub.list(signal) }
      if (endpoint === 'fields.set') {
        return { ok: true, value: await hub.set(payload, signal) }
      }
      if (endpoint.startsWith('cast.')) {
        const row = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {}
        if (endpoint === 'cast.get') return { ok: true, value: cast.getCast() }
        if (endpoint === 'cast.setEnabled') return { ok: true, value: await cast.setEnabled(row.enabled, row.expectedRevision) }
        if (endpoint === 'cast.addRoute') return { ok: true, value: await cast.addRoute(row.route, row.expectedRevision) }
        if (endpoint === 'cast.setRoute') return { ok: true, value: await cast.setRoute(row.index, row.route, row.expectedRevision) }
        if (endpoint === 'cast.removeRoute') return { ok: true, value: await cast.removeRoute(row.index, row.expectedRevision) }
        if (endpoint === 'cast.setTendency') return { ok: true, value: cast.setTendency(row.provider, row.model, row.tendency, row.expectedRevision, signal) }
        if (endpoint === 'cast.running') return { ok: true, value: await running.list(signal) }
      }
      throw new Error(`Unknown endpoint: ${endpoint}`)
    } catch (error) {
      return { ok: false, error: { code: 'model-hub/rejected', message: error instanceof Error ? error.message : String(error) } }
    }
    // Camel-case cast endpoints widen the default lowercase-only endpoint gate.
  }, { isEndpoint: endpoint => /^[a-z][a-zA-Z.]*$/.test(endpoint) }))
}
