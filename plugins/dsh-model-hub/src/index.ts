/**
 * dsh-model-hub — cross-plugin model settings hub.
 *
 * Host half: reads every plugin's settings descriptor through the host
 * `settings` service, runs model-route field detection, and serves the field
 * matrix to the browser half over an authenticated RPC channel. Writes go
 * through `settings.mutate` — the official settings page's own path — with
 * the descriptor revision as CAS. The boot probe report is kept: it is logged
 * and written to `<profile>/data/model-hub/probe-report.json`.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'
import { registerHostRpc, type HostRpcContext } from '@klarkxy/dsh-plugin-kit/host-rpc'
import { modelRouteRoleSchemastery, modelRouteSchemastery } from '@klarkxy/dsh-model-route/schemastery'
import { buildProbeReport, listModelFields, planFieldWrite, type ProbeDescriptorLike } from './probe.ts'

export const name = '@klarkxy/dsh-model-hub'
export const inject = ['settings', 'webServer', 'connection'] as const
export const CHANNEL = '/dsh-model-hub'

export const Config = Schema.object({
  selfTestMeta: modelRouteSchemastery({ purpose: 'self-test-meta', label: '自检字段（自定义键通道）' }).volatile(),
  selfTestRole: modelRouteRoleSchemastery({ purpose: 'self-test-role', label: '自检字段（role 通道）' }).volatile(),
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
  const profile = ctx.get('profileContext') as ProfileContextLike | undefined
  const settings = ctx.settings as unknown as SettingsLike
  const describe = () => settings.describe({ redactSecrets: true }) as unknown as ProbeDescriptorLike[]

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
  ctx.effect(() => registerHostRpc(ctx as unknown as HostRpcContext, CHANNEL, async (endpoint, payload) => {
    try {
      if (endpoint === 'fields.list') return { ok: true, value: listModelFields(describe()) }
      if (endpoint === 'fields.set') {
        const plan = planFieldWrite(listModelFields(describe()), payload)
        await settings.mutate(plan.ns, plan.ops, plan.expectedRevision)
        return { ok: true, value: listModelFields(describe()) }
      }
      throw new Error(`Unknown endpoint: ${endpoint}`)
    } catch (error) {
      return { ok: false, error: { code: 'model-hub/rejected', message: error instanceof Error ? error.message : String(error) } }
    }
  }))
}
