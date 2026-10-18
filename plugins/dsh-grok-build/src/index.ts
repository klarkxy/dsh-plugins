import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { modelSettingsChangesIdentity } from '@klarkxy/dsh-plugin-kit/contracts'
import { createModelSettingsChanges } from '@klarkxy/dsh-plugin-kit/model-settings-changes'
import { registerHostRpc, type HostRpcContext } from '@klarkxy/dsh-plugin-kit/host-rpc'
import { DEFAULT_SETTINGS, GrokBuildError, PLUGIN_NAME, RPC_CHANNEL, parseSettings, type RpcResult, type Settings } from './contracts.ts'
import { connectGrokWeb } from './connect-web.ts'
import { GrokRuntime } from './runtime.ts'
import { GrokOperations, jobSchema, registerTools, type JobStore, type ToolHost } from './tools.ts'

export const name = PLUGIN_NAME
export const inject = ['tools', 'sandboxPolicy', 'attachments', 'storageDomain', 'connection', 'webServer'] as const
const settingsSchema = z.object({ executable: z.string().max(4096), timeoutMs: z.number().int().min(10_000).max(1_800_000), allowNativeMediaFiles: z.boolean().default(false) }).strict()
const rowSchema = z.object({ settings: settingsSchema, revision: z.number().int().nonnegative() }).strict()
const spec = defineDomain({ name: 'dsh_grok_build', version: 1, tables: { settings: domainTable<string, z.infer<typeof rowSchema>>(rowSchema), jobs: domainTable<string, z.infer<typeof jobSchema>>(jobSchema) } })
type Table = { get(key: string): unknown; put(key: string, value: unknown): Promise<void>; entries(): IterableIterator<[string, unknown]> }
type Domain = { table(name: string): Table; close(): Promise<void> }
type Host = Context & HostRpcContext & ToolHost & { storageDomain: { open(value: typeof spec): Promise<Domain> } }

export function apply(ctx: Context): void {
  createModelSettingsChanges(ctx, modelSettingsChangesIdentity(PLUGIN_NAME), PLUGIN_NAME)
  const host = ctx as Host, lifetime = new AbortController(), domain = host.storageDomain.open(spec)
  let settings: Settings = { ...DEFAULT_SETTINGS }, revision = 0, changing = false, closed = false
  let writes = Promise.resolve()
  const active = new Set<Promise<unknown>>()
  const ready = domain.then(d => {
    const raw = d.table('settings').get('config')
    if (raw !== undefined) { const row = rowSchema.parse(raw); settings = parseSettings(row.settings); revision = row.revision }
  })
  void ready.catch(() => {})
  const jobs: JobStore = {
    async get(id) { const raw = (await domain).table('jobs').get(id); return raw === undefined ? undefined : jobSchema.parse(raw) },
    async put(job) { await (await domain).table('jobs').put(job.id, jobSchema.parse(job)) },
    async list(workspace) { return [...(await domain).table('jobs').entries()].map(([, value]) => jobSchema.parse(value)).filter(job => job.workspace === workspace) },
  }
  let runtime = new GrokRuntime(() => settings)
  const operations = new GrokOperations(host, () => runtime, jobs, () => settings)
  const run = async <T>(signal: AbortSignal, action: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const combined = AbortSignal.any([signal, lifetime.signal]); combined.throwIfAborted(); await ready; combined.throwIfAborted()
    if (closed) throw new GrokBuildError('disposed', 'Grok 插件已卸载。')
    if (changing) throw new GrokBuildError('busy', '正在保存配置，请稍后重试。')
    const pending = action(combined); active.add(pending)
    try { return await pending } finally { active.delete(pending) }
  }
  registerTools(host, { execute: (operation, args, exec) => run(exec.signal, signal => operations.execute(operation, args, { ...exec, signal })) }, ready, lifetime.signal)
  const refreshWeb = connectGrokWeb(ctx as unknown as Parameters<typeof connectGrokWeb>[0], { run, runtime: () => runtime }, () => settings, ready, lifetime.signal)
  const rpc = async (endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResult> => {
    try {
      signal.throwIfAborted(); lifetime.signal.throwIfAborted(); await ready; signal.throwIfAborted(); lifetime.signal.throwIfAborted()
      if (endpoint === 'settings') return { ok: true, value: { settings, revision } }
      if (endpoint === 'status') return { ok: true, value: await run(signal, signal => runtime.status(signal)) }
      if (endpoint !== 'settings.update') throw new GrokBuildError('not-found', '未知操作。')
      const data = z.object({ settings: settingsSchema, expectedRevision: z.number().int().nonnegative() }).strict().parse(payload)
      const pending = writes.then(async () => {
        signal.throwIfAborted(); lifetime.signal.throwIfAborted()
        if (data.expectedRevision !== revision) throw new GrokBuildError('conflict', '配置已在别处修改，请重新加载。')
        if (active.size) throw new GrokBuildError('busy', '请等待当前任务完成后保存配置。')
        changing = true
        try {
          const next = { settings: parseSettings(data.settings), revision: revision + 1 }
          await (await domain).table('settings').put('config', next)
          settings = next.settings; revision = next.revision
          await runtime.dispose(); runtime = new GrokRuntime(() => settings)
          void refreshWeb()
          return next
        } finally { changing = false }
      })
      writes = pending.then(() => {}, () => {})
      return { ok: true, value: await pending }
    } catch (cause) {
      if (signal.aborted || lifetime.signal.aborted) return { ok: false, error: { code: 'cancelled', message: '操作已取消。' } }
      return { ok: false, error: { code: cause instanceof GrokBuildError ? cause.code : cause instanceof z.ZodError ? 'bad-request' : 'internal', message: cause instanceof GrokBuildError ? cause.message : '操作失败。' } }
    }
  }
  ctx.effect(() => registerHostRpc(host, RPC_CHANNEL, rpc), 'grok-build.rpc')
  ctx.effect(() => async () => {
    closed = true; lifetime.abort()
    await runtime.dispose(); await Promise.allSettled([...active]); await writes
    await (await domain).close()
  }, 'grok-build.lifecycle')
}
