import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { modelSettingsChangesIdentity } from '@klarkxy/dsh-plugin-kit/contracts'
import { createModelSettingsChanges } from '@klarkxy/dsh-plugin-kit/model-settings-changes'
import { registerHostRpc, type HostRpcContext } from '@klarkxy/dsh-plugin-kit/host-rpc'
import { PLUGIN_NAME, RPC_CHANNEL, DEFAULT_SETTINGS, parseSettings, MiniMaxCodeError, type Settings, type RpcResult } from './contracts.ts'
import { MiniMaxRuntime } from './runtime.ts'
import { jobSchema, type JobStore } from './jobs.ts'
import { registerTools, type ToolHost } from './tools.ts'
import { connectMiniMaxWeb } from './connect-web.ts'
import { miniMaxSearch } from './search.ts'

export const name = PLUGIN_NAME
export const inject = ['tools', 'sandboxPolicy', 'attachments', 'storageDomain', 'connection', 'webServer'] as const
const settingsSchema = z.object({ toolsExecutable: z.string().max(4096), codeExecutable: z.string().max(4096), searchDataDir: z.string().max(4096).default(''), region: z.enum(['auto', 'cn', 'global']), timeoutMs: z.number().int().min(10_000).max(1_800_000) }).strict()
const rowSchema = z.object({ settings: settingsSchema, revision: z.number().int().nonnegative() }).strict()
const spec = defineDomain({ name: 'dsh_minimax_code', version: 1, tables: { settings: domainTable<string, z.infer<typeof rowSchema>>(rowSchema), jobs: domainTable<string, z.infer<typeof jobSchema>>(jobSchema) } })
type Table = { get(key: string): unknown; put(key: string, value: unknown): Promise<void>; entries(): IterableIterator<[string, unknown]> }
type Domain = { table(name: string): Table; close(): Promise<void> }
type Host = Context & HostRpcContext & ToolHost & { storageDomain: { open(value: typeof spec): Promise<Domain> } }

export function apply(ctx: Context): void {
  createModelSettingsChanges(ctx, modelSettingsChangesIdentity(PLUGIN_NAME), PLUGIN_NAME)
  const host = ctx as Host
  const lifetime = new AbortController(), domain = host.storageDomain.open(spec)
  let settings: Settings = { ...DEFAULT_SETTINGS }, revision = 0, active = 0, changing = false, closed = false
  let writes = Promise.resolve()
  const pendingCalls = new Set<Promise<unknown>>()
  const ready = domain.then(d => {
    const raw = d.table('settings').get('config')
    if (raw === undefined) return
    const row = rowSchema.parse(raw); settings = parseSettings(row.settings); revision = row.revision
  })
  void ready.catch(() => {})
  const jobs: JobStore = {
    async get(id) { const raw = (await domain).table('jobs').get(id); return raw === undefined ? undefined : jobSchema.parse(raw) },
    async put(job) { await (await domain).table('jobs').put(job.id, jobSchema.parse(job)) },
    async list(workspace) { return [...(await domain).table('jobs').entries()].map(([, value]) => jobSchema.parse(value)).filter(job => job.workspace === workspace) },
  }
  let runtime = new MiniMaxRuntime(host, () => settings, jobs, { search: miniMaxSearch })
  const run = async <T>(signal: AbortSignal, action: (signal: AbortSignal) => Promise<T>) => {
    const combined = AbortSignal.any([signal, lifetime.signal]); combined.throwIfAborted(); await ready; combined.throwIfAborted()
    if (changing) throw new MiniMaxCodeError('busy', 'Settings are being saved. Try again shortly.')
    active++
    const pending = action(combined); pendingCalls.add(pending)
    try { return await pending } finally { pendingCalls.delete(pending); active-- }
  }
  registerTools(host, { execute: (operation, args, exec) => run(exec.signal, signal => runtime.execute(operation, args, { ...exec, signal })) }, ready, lifetime.signal)
  const refreshWeb = connectMiniMaxWeb(ctx as unknown as Parameters<typeof connectMiniMaxWeb>[0], { run, settings: () => settings }, ready, lifetime.signal)
  const rpc = async (endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResult> => {
    try {
      if (closed) throw new MiniMaxCodeError('disposed', 'The MiniMax Code plugin was unloaded.')
      await ready; signal.throwIfAborted(); lifetime.signal.throwIfAborted()
      if (endpoint === 'settings') return { ok: true, value: { settings, revision } }
      if (endpoint === 'status') return { ok: true, value: await run(signal, signal => runtime.status(signal)) }
      if (endpoint !== 'settings.update') throw new MiniMaxCodeError('not-found', 'Unknown operation.')
      const data = z.object({ settings: settingsSchema, expectedRevision: z.number().int().nonnegative() }).strict().parse(payload)
      const pending = writes.then(async () => {
        signal.throwIfAborted(); lifetime.signal.throwIfAborted()
        if (data.expectedRevision !== revision) throw new MiniMaxCodeError('conflict', 'Settings changed elsewhere. Reload and review your changes.')
        if (active) throw new MiniMaxCodeError('busy', 'Wait for active calls to finish before saving settings.')
        changing = true
        try {
          const next = { settings: parseSettings(data.settings), revision: revision + 1 }
          await (await domain).table('settings').put('config', next)
          settings = next.settings; revision = next.revision
          await runtime.dispose(); runtime = new MiniMaxRuntime(host, () => settings, jobs, { search: miniMaxSearch })
          void refreshWeb()
          return next
        } finally { changing = false }
      })
      writes = pending.then(() => {}, () => {})
      return { ok: true, value: await pending }
    } catch (cause) {
      if (signal.aborted || lifetime.signal.aborted) return { ok: false, error: { code: 'cancelled', message: 'Operation cancelled.' } }
      return { ok: false, error: { code: cause instanceof MiniMaxCodeError ? cause.code : cause instanceof z.ZodError ? 'bad-request' : 'internal', message: cause instanceof MiniMaxCodeError ? cause.message : 'The operation failed.' } }
    }
  }
  ctx.effect(() => registerHostRpc(host, RPC_CHANNEL, rpc), 'minimax.rpc')
  ctx.effect(() => async () => {
    closed = true; lifetime.abort()
    await runtime.dispose(); await Promise.allSettled([...pendingCalls]); await writes
    await (await domain).close()
  }, 'minimax.lifecycle')
}
