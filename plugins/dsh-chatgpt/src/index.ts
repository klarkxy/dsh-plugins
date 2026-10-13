import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { registerHostRpc, type HostRpcContext } from '@klarkxy/dsh-plugin-kit/host-rpc'
import { registerModelSettings, notifyModelSettingsChanged, type ModelSettingsEvents } from '@klarkxy/dsh-plugin-kit/model-settings'
import { ChatGptError, DEFAULT_SETTINGS, PLUGIN_NAME, RPC_CHANNEL, parseSettings, type Settings, type RpcResult } from './contracts.ts'
import { CodexRuntime } from './runtime.ts'
import { registerTools, type ToolHost } from './tools.ts'
import { chatGptDiagnostic } from './client-copy.ts'

export const name = PLUGIN_NAME
export const inject = ['tools', 'sandboxPolicy', 'attachments', 'storageDomain', 'connection', 'webServer'] as const
const settingsSchema = z.object({ executable: z.string().max(4096), model: z.string().max(200), effort: z.string().max(40), timeoutMs: z.number().int().min(10_000).max(1_800_000) }).strict()
const rowSchema = z.object({ settings: settingsSchema, revision: z.number().int().nonnegative() }).strict()
const domainSpec = defineDomain({ name: 'dsh_chatgpt', version: 1, tables: { settings: domainTable<string, z.infer<typeof rowSchema>>(rowSchema) } })
type Domain = { table(name: string): { get(key: string): unknown; put(key: string, value: unknown): Promise<void> }; close(): Promise<void> }
type Host = Context & HostRpcContext & ToolHost & { storageDomain: { open(spec: typeof domainSpec): Promise<Domain> } }

export function apply(ctx: Context): void {
  const host = ctx as Host
  let settings: Settings = { ...DEFAULT_SETTINGS }, revision = 0, active = 0, closed = false, settingsUpdating = false
  const lifetime = new AbortController()
  const domain = host.storageDomain.open(domainSpec)
  const ready = domain.then(d => {
    const row = d.table('settings').get('config')
    if (row === undefined) return
    const parsed = rowSchema.parse(row)
    settings = parseSettings(parsed.settings); revision = parsed.revision
  })
  void ready.catch(() => {})
  let runtime = new CodexRuntime(() => settings)
  let settingsWrites = Promise.resolve()
  const run = async <T>(signal: AbortSignal, action: (signal: AbortSignal) => Promise<T>) => {
    const combined = AbortSignal.any([signal, lifetime.signal])
    combined.throwIfAborted(); await ready; combined.throwIfAborted()
    if (settingsUpdating) throw new ChatGptError('busy', '正在保存配置，请稍后重试。')
    active++
    try { return await action(combined) } finally { active-- }
  }
  registerTools(host, (request, workspace, signal) => run(signal, combined => runtime.run(request, workspace, combined)), lifetime.signal)
  const rpc = async (endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResult> => {
    try {
      if (closed) throw new ChatGptError('disposed', 'ChatGPT 插件已卸载。')
      await ready; signal.throwIfAborted()
      if (endpoint === 'settings') return { ok: true, value: { settings, revision } }
      if (endpoint === 'settings.update') {
        const parsed = z.object({ settings: settingsSchema, expectedRevision: z.number().int().nonnegative() }).strict().safeParse(payload)
        if (!parsed.success) throw new ChatGptError('bad-request', '配置格式无效。')
        const update = settingsWrites.then(async () => {
          signal.throwIfAborted(); lifetime.signal.throwIfAborted()
          if (revision !== parsed.data.expectedRevision) throw new ChatGptError('conflict', '配置已在别处修改，请刷新后重试。')
          if (active) throw new ChatGptError('busy', '请等当前调用完成后保存配置。')
          const next = { settings: parseSettings(parsed.data.settings), revision: revision + 1 }
          settingsUpdating = true
          let committed = false
          try {
            await (await domain).table('settings').put('config', next)
            settings = next.settings; revision = next.revision
            committed = true
            await runtime.dispose()
            runtime = new CodexRuntime(() => settings)
            return next
          } finally {
            settingsUpdating = false
            if (committed) notifyModelSettingsChanged(ctx, PLUGIN_NAME, next.revision)
          }
        })
        settingsWrites = update.then(() => {}, () => {})
        return { ok: true, value: await update }
      }
      const value = await run(signal, async combined => {
        if (endpoint === 'status') return runtime.status(combined)
        if (endpoint === 'login.start') {
          const kind = (payload as { kind?: unknown } | null)?.kind
          if (kind !== 'browser' && kind !== 'device') throw new ChatGptError('bad-request', '请选择浏览器或设备码登录。')
          return runtime.login(kind, combined)
        }
        if (endpoint === 'login.cancel') {
          const id = (payload as { expectedLoginId?: unknown } | null)?.expectedLoginId
          if (typeof id !== 'string' || !id || id.length > 200) throw new ChatGptError('bad-request', '需要本次登录的标识。')
          await runtime.cancelLogin(combined, id); return null
        }
        throw new ChatGptError('not-found', '未知操作。')
      })
      return { ok: true, value }
    } catch (error) {
      if (signal.aborted || lifetime.signal.aborted) return { ok: false, error: { code: 'cancelled', message: '操作已取消。' } }
      return { ok: false, error: { code: error instanceof ChatGptError ? error.code : 'internal', message: error instanceof Error ? error.message : '操作失败。' } }
    }
  }
  ctx.effect(() => registerHostRpc(host, RPC_CHANNEL, rpc), 'chatgpt.rpc')
  ctx.effect(() => registerModelSettings(ctx as unknown as ModelSettingsEvents, {
    ns: PLUGIN_NAME, title: 'ChatGPT',
    async read(signal) {
      return run(signal, async combined => {
        // Capture the row before querying Codex: a settings save must not pair
        // an old model selection with a newer revision after the await.
        const snapshot = { settings: { ...settings }, revision }
        const status = await runtime.status(combined)
        const current = { provider: snapshot.settings.model ? 'codex' : '', model: snapshot.settings.model,
          ...(snapshot.settings.effort ? { reasoningEffort: snapshot.settings.effort } : {}) }
        return { revision: snapshot.revision, fields: [{ path: ['model'], label: { zh: 'ChatGPT 模型', en: 'ChatGPT model' }, current,
          followLabel: { zh: 'Codex 默认模型', en: 'Codex default model' }, allowFollow: true }],
          catalog: { groups: [{ id: 'codex', name: 'Codex', models: status.models.map(model => ({
            id: model.id, name: model.label, reasoning: { efforts: model.efforts.map(id => ({ id, name: id })) },
          })) }] },
          ...(!status.available ? { catalogError: chatGptDiagnostic(status.error || 'Codex 模型目录不可用。') } : {}),
        }
      })
    },
    async write(path, route, expectedRevision, signal) {
      if (path.length !== 1 || path[0] !== 'model') throw new Error('Unknown ChatGPT model setting')
      if (route.provider && route.provider !== 'codex') throw new Error('ChatGPT requires a Codex model')
      await ready; signal.throwIfAborted()
      const result = await rpc('settings.update', { settings: { ...settings, model: route.model,
        effort: route.reasoningEffort || '' }, expectedRevision }, signal)
      if (!result.ok) throw new ChatGptError(result.error.code, result.error.message)
      return result.value
    },
  }), 'chatgpt.model-settings')
  ctx.effect(() => async () => { closed = true; lifetime.abort(); await settingsWrites; await runtime.dispose(); await (await domain).close() }, 'chatgpt.lifecycle')
}
