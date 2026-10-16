import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import {
  DEFAULT_COMPACT_MINUTES,
  DEFAULT_RECAP_MINUTES,
  PLUGIN_NAME,
  resolveConfig,
  type Config as PluginConfig,
} from './contracts.ts'
import { createCursorKey } from './cursor.ts'
import { registerSessionTools } from './tools.ts'
import { registerSessionManagerRpc } from './rpc.ts'
import type { PresenceModelHost } from './welcome-back.ts'
import type { HostRpcContext } from '@klarkxy/dsh-plugin-kit/host-rpc'
import { openCompatibleDomain } from '@klarkxy/dsh-plugin-kit/domain'
import {
  notifyModelSettingsChanged,
  registerModelSettings,
  type ModelSettingsEvents,
} from '@klarkxy/dsh-plugin-kit/model-settings'
import { modelRouteOverride, type ModelRoute } from '@klarkxy/dsh-model-route'
import { presenceDomain } from './storage.ts'
import { PresenceSettingsStore, type PresenceDomainHandle } from './presence-settings.ts'

export const name = PLUGIN_NAME
export const inject = ['tools', 'sessionQuery'] as const

export interface Config {
  pageChars?: number
  listLimit?: number
  searchLimit?: number
  recapMinutes?: number
  compactMinutes?: number
  continueText?: string
  continueMode?: 'fixed' | 'auto'
}

export const Config: Schema<Config> = Schema.object({
  pageChars: Schema.number().default(4_000),
  listLimit: Schema.number().default(20),
  searchLimit: Schema.number().default(20),
  recapMinutes: Schema.number().default(DEFAULT_RECAP_MINUTES),
  compactMinutes: Schema.number().default(DEFAULT_COMPACT_MINUTES),
  continueText: Schema.string().default(''),
  continueMode: Schema.union([Schema.const('fixed' as const), Schema.const('auto' as const)]).default('fixed'),
}).i18n({
  zh: {
    pageChars: '明细与交接模式每页内容的输出上限（UTF-8 字节）；对话预览按轮数分页，不受此限',
    listLimit: '每页会话列表的数量上限',
    searchLimit: '每页搜索结果的数量上限',
    recapMinutes: '距离上次响应超过该分钟数后，回到会话时在对话末尾（最后一轮回复之后）显示“欢迎回来”摘要卡片；0 为关闭',
    compactMinutes: '距离上次响应超过该分钟数后，“欢迎回来”卡片附带缓存失效提示及压缩上下文、在新会话中继续两个可选操作；0 为关闭',
    continueText: '输入框为空时灰影补全使用的固定文本；留空使用默认“继续”',
    continueMode: 'fixed 使用固定文本；auto 在上一轮结束后用模型生成一次灰影文本，并缓存在这个会话中',
  },
  en: {
    pageChars: 'Maximum content per details/handoff page (UTF-8 bytes); conversation previews page by turn count instead',
    listLimit: 'Maximum sessions per list page',
    searchLimit: 'Maximum search results per page',
    recapMinutes: 'Show the welcome-back recap card at the end of the conversation, after the last turn, when the last response is older than this many minutes; 0 disables it',
    compactMinutes: 'Add the cache-expiry note and optional compact-context / continue-in-new-session actions past this many idle minutes; 0 disables it',
    continueText: 'Fixed ghost-completion text for an empty composer; empty uses the localized default ("Continue")',
    continueMode: 'fixed sends the configured text; auto generates the ghost once after the previous turn ends and caches it in the session',
  },
})

export function apply(ctx: Context, config: PluginConfig = {}): void {
  const resolved = resolveConfig(config)
  const cursors = createCursorKey()
  ctx.effect(() => registerSessionTools(ctx, resolved, cursors))
  // Plugin-owned settings live in a dedicated storage domain; without
  // storageDomain the model selector stays hidden and writes fail soft.
  let settings: PresenceSettingsStore | undefined
  let storageGeneration: object | undefined
  ctx.inject(['storageDomain'], injected => {
    const generation = {}
    storageGeneration = generation
    const host = injected as { storageDomain: { open: (spec: typeof presenceDomain) => Promise<PresenceDomainHandle> } }
    let disposed = false
    let store: PresenceSettingsStore | undefined
    let unregister: (() => void) | undefined
    const opening = (async () => {
      const domain = await openCompatibleDomain(spec => host.storageDomain.open(spec), presenceDomain)
      if (disposed || storageGeneration !== generation) {
        await domain.close()
        return
      }
      try {
        const opened = new PresenceSettingsStore(domain)
        store = opened
        // The Model Hub collect event may fire before the domain resolves; the
        // provider only appears once storage is mounted.
        unregister = registerModelSettings(ctx as unknown as ModelSettingsEvents, {
          ns: PLUGIN_NAME,
          title: { zh: '会话', en: 'Sessions' },
          read(signal) {
            signal.throwIfAborted()
            const current = opened.read()
            return {
              revision: current.revision,
              fields: [{
                path: ['model'],
                label: { zh: '欢迎回来摘要模型', en: 'Welcome-back recap model' },
                current: current.model ?? undefined,
                allowFollow: true,
                followLabel: { zh: '当前会话 / 宿主默认模型', en: 'Current conversation / host default' },
              }],
            }
          },
          async write(path, route, expectedRevision, signal) {
            signal.throwIfAborted()
            if (path.length !== 1 || path[0] !== 'model') {
              throw new Error('Unknown Session Manager model setting')
            }
            const model = modelRouteOverride(route as ModelRoute) ?? null
            const revision = await opened.write(model, { expectedRevision, signal })
            notifyModelSettingsChanged(ctx, PLUGIN_NAME, revision)
            return revision
          },
        })
        settings = opened
      } catch (error) {
        unregister?.()
        if (store !== undefined) await store.close()
        else await domain.close()
        throw error
      }
    })().catch(() => { /* storageDomain unavailable or incompatible: degrade silently */ })
    injected.effect(() => async () => {
      disposed = true
      unregister?.()
      if (settings === store) settings = undefined
      // Close immediately to reject queued work, then wait for a late open too.
      await store?.close()
      await opening
    })
  })
  // Optional model capability: without it, recaps and auto suggestions silently degrade.
  let models: PresenceModelHost | undefined
  ctx.inject(['llm', 'agents', 'sessionProjections', 'agentDefaultModel'], inner => {
    const lifetime = new AbortController()
    models = {
      host: inner,
      signal: lifetime.signal,
    }
    inner.effect(() => () => {
      lifetime.abort()
      if (models?.host === inner) models = undefined
    })
  })
  const captureModels = (): PresenceModelHost | undefined => {
    if (models === undefined) return undefined
    // Each request owns its original store, even if storage remounts while the
    // model is running. Closing that store aborts generation and queued writes.
    const owned = settings
    return {
      ...models,
      signal: owned === undefined ? models.signal : AbortSignal.any([models.signal, owned.signal]),
      saved: () => owned?.read().model ?? null,
      savedGhost: () => owned?.read().ghostModel ?? null,
      suggestion: sessionId => owned?.suggestion(sessionId),
      rememberSuggestion: (sessionId, seq, text, signal) =>
        owned?.rememberSuggestion(sessionId, seq, text, signal) ?? Promise.resolve(),
    }
  }
  // CLI-only hosts still load the query tools; the browser RPC follows its own services.
  ctx.inject(['connection', 'webServer'], inner => {
    inner.effect(() => registerSessionManagerRpc(
      ctx,
      inner as Context & HostRpcContext,
      resolved,
      captureModels,
      () => settings,
    ))
  })
}
