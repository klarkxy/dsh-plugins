import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import {
  DEFAULT_COMPACT_MINUTES,
  DEFAULT_RECAP_MINUTES,
  PLUGIN_NAME,
  resolveConfig,
  type Config as PluginConfig,
} from './contracts.ts'
import {
  AutoContinueError, AutoContinueService,
  type AutoContinueRecentTableLike, type AutoContinueTableLike,
} from './auto-continue.ts'
import { AutoContinueRunner } from './auto-runner.ts'
import { CreationDefaultsMirror, type CreationDefaultsDeps } from './creation-defaults.ts'
import { createCursorKey } from './cursor.ts'
import { registerSessionTools } from './tools.ts'
import { registerSessionManagerRpc } from './rpc.ts'
import type { PresenceModelHost } from './welcome-back.ts'
import type { HostRpcContext } from '@klarkxy/dsh-plugin-kit/host-rpc'
import { openCompatibleDomain } from '@klarkxy/dsh-plugin-kit/domain'
import { modelSettingsChangesIdentity } from '@klarkxy/dsh-plugin-kit/contracts'
import { retainAuxiliaryModel } from '@klarkxy/dsh-plugin-kit/auxiliary-model'
import { createModelSettingsChanges } from '@klarkxy/dsh-plugin-kit/model-settings-changes'
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
  autoContinueMode?: 'off' | 'cautious' | 'bold'
  autoContinueMax?: number
  allowSelfFork?: boolean
  allowSendMessage?: boolean
}

export const Config: Schema<Config> = Schema.object({
  pageChars: Schema.number().default(4_000),
  listLimit: Schema.number().default(20),
  searchLimit: Schema.number().default(20),
  recapMinutes: Schema.number().default(DEFAULT_RECAP_MINUTES),
  compactMinutes: Schema.number().default(DEFAULT_COMPACT_MINUTES),
  continueText: Schema.string().default(''),
  continueMode: Schema.union([Schema.const('fixed' as const), Schema.const('auto' as const)]).default('fixed'),
  autoContinueMode: Schema.union([Schema.const('off' as const), Schema.const('cautious' as const), Schema.const('bold' as const)]).default('off'),
  autoContinueMax: Schema.number().default(3),
  allowSelfFork: Schema.boolean().default(false),
  allowSendMessage: Schema.boolean().default(false),
}).i18n({
  zh: {
    pageChars: '明细与交接模式每页内容的输出上限（UTF-8 字节）；对话预览按轮数分页，不受此限',
    listLimit: '每页会话列表的数量上限',
    searchLimit: '每页搜索结果的数量上限',
    recapMinutes: '距离上次响应超过该分钟数后，回到会话时在对话末尾（最后一轮回复之后）显示“欢迎回来”摘要卡片；0 为关闭',
    compactMinutes: '距离上次响应超过该分钟数后，“欢迎回来”卡片附带缓存失效提示及压缩上下文、在新会话中继续两个可选操作；0 为关闭',
    continueText: '输入框为空时灰影补全使用的固定文本；留空使用默认“继续”',
    continueMode: 'fixed 使用固定文本；auto 在上一轮结束后用模型生成一次灰影文本，并缓存在这个会话中',
    autoContinueMode: '新会话默认的自动继续形态：off 关闭；cautious 仅在回复有明确未完成依据时自动发送继续；bold 没完成就继续，低风险选择按推荐方案走。会话开始后锁定',
    autoContinueMax: '自动继续会话中，你每发一条消息之后最多自动继续的次数（1–10）',
    allowSelfFork: '向 agent 开放 fork_session 工具：可由 agent 自行决定分叉当前会话为新会话分支，不再逐次确认',
    allowSendMessage: '向 agent 开放 send_session_message 工具：可由 agent 自行决定向任意未归档会话发送一条标记为 agent 转发的消息，不再逐次确认',
  },
  en: {
    pageChars: 'Maximum content per details/handoff page (UTF-8 bytes); conversation previews page by turn count instead',
    listLimit: 'Maximum sessions per list page',
    searchLimit: 'Maximum search results per page',
    recapMinutes: 'Show the welcome-back recap card at the end of the conversation, after the last turn, when the last response is older than this many minutes; 0 disables it',
    compactMinutes: 'Add the cache-expiry note and optional compact-context / continue-in-new-session actions past this many idle minutes; 0 disables it',
    continueText: 'Fixed ghost-completion text for an empty composer; empty uses the localized default ("Continue")',
    continueMode: 'fixed sends the configured text; auto generates the ghost once after the previous turn ends and caches it in the session',
    autoContinueMode: 'Default Auto-continue mode for new sessions: off disables it; cautious continues only on clear evidence; bold continues unless done, taking the recommended option on low-risk choices. Locked once a session starts',
    autoContinueMax: 'How many times it may continue automatically after each message you send (1-10)',
    allowSelfFork: 'Expose the fork_session tool: the agent may fork this session into a new branch at its own discretion, without per-call confirmation',
    allowSendMessage: 'Expose the send_session_message tool: the agent may send an agent-attributed message to any unarchived session at its own discretion, without per-call confirmation',
  },
})

export function apply(ctx: Context, config: PluginConfig = {}): void {
  createModelSettingsChanges(ctx, modelSettingsChangesIdentity(PLUGIN_NAME), PLUGIN_NAME)
  const resolved = resolveConfig(config)
  const cursors = createCursorKey()
  // Shared auxiliary-model store: root-owned, one for every participant.
  // Declaring only the services it needs keeps a legitimately absent service
  // (a CLI host without connection/webServer) a clean skip, while a real
  // initialization failure — a corrupt domain or a rejected RPC mount —
  // flips auxBroken so features without an explicit model degrade instead of
  // silently billing the conversation model.
  let auxBroken = false
  ctx.inject(['storageDomain', 'webServer', 'connection'], inner => {
    let mounted = true
    void retainAuxiliaryModel(inner as Context).then(release => {
      if (!mounted) { void release(); return }
      inner.effect(() => release)
    }).catch(error => {
      auxBroken = true
      ctx.logger?.warn?.('dsh-session-manager: auxiliary model store unavailable; feature models without an explicit override are disabled: %s',
        error instanceof Error ? error.message : String(error))
    })
    inner.effect(() => () => { mounted = false })
  })
  // Plugin-owned settings live in a dedicated storage domain; without
  // storageDomain the model selector stays hidden and writes fail soft.
  let settings: PresenceSettingsStore | undefined
  let autoContinueTable: AutoContinueTableLike | undefined
  let autoContinueRecentTable: AutoContinueRecentTableLike | undefined
  let autoContinueService: AutoContinueService | undefined
  let storageGeneration: object | undefined
  let storageReady: Promise<void> = Promise.resolve()
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
            const field = (
              path: 'model' | 'ghostModel' | 'judgeModel' | 'handoffModel',
              label: { zh: string; en: string },
            ) => ({
              path: [path],
              label,
              current: current[path] ?? undefined,
              allowFollow: true,
              followLabel: { zh: '辅助模型 / 会话 / 宿主默认', en: 'Auxiliary / conversation / host default' },
            })
            return {
              revision: current.revision,
              fields: [
                field('model', { zh: '欢迎回来摘要模型', en: 'Welcome-back recap model' }),
                field('ghostModel', { zh: '继续灰影生成模型', en: 'Continue ghost model' }),
                field('judgeModel', { zh: '自动继续判定模型', en: 'Auto-continue judge model' }),
                field('handoffModel', { zh: '交接摘要模型', en: 'Handoff summary model' }),
              ],
            }
          },
          async write(path, route, expectedRevision, signal) {
            signal.throwIfAborted()
            const key = path.length === 1 ? path[0] : undefined
            if (key !== 'model' && key !== 'ghostModel' && key !== 'judgeModel' && key !== 'handoffModel') {
              throw new Error('Unknown Session Manager model setting')
            }
            const model = modelRouteOverride(route as ModelRoute) ?? null
            const revision = await opened.writeFeature(key, model, { expectedRevision, signal })
            notifyModelSettingsChanged(ctx, PLUGIN_NAME, revision)
            return revision
          },
        })
        settings = opened
        autoContinueTable = domain.table('auto_continue') as AutoContinueTableLike
        autoContinueRecentTable = domain.table('auto_continue_recent') as AutoContinueRecentTableLike
      } catch (error) {
        unregister?.()
        if (store !== undefined) await store.close()
        else await domain.close()
        throw error
      }
    })().catch(() => { /* storageDomain unavailable or incompatible: degrade silently */ })
    storageReady = opening
    injected.effect(() => async () => {
      disposed = true
      unregister?.()
      if (storageGeneration === generation) {
        autoContinueTable = undefined
        autoContinueRecentTable = undefined
      }
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
      auxBroken,
      signal: owned === undefined ? models.signal : AbortSignal.any([models.signal, owned.signal]),
      saved: () => owned?.read().model ?? null,
      savedGhost: () => owned?.read().ghostModel ?? null,
      savedJudge: () => owned?.read().judgeModel ?? null,
      savedHandoff: () => owned?.read().handoffModel ?? null,
      suggestion: sessionId => owned?.suggestion(sessionId),
      rememberSuggestion: (sessionId, seq, text, key, signal) =>
        owned?.rememberSuggestion(sessionId, seq, text, key, signal) ?? Promise.resolve(),
    }
  }
  // Registered after captureModels exists: the read_session tool builds the
  // handoff summarizer from the same captured model state as the presence endpoints.
  ctx.effect(() => registerSessionTools(ctx, resolved, cursors, captureModels))
  // Per-session auto-continue: the record table is only available while the
  // presence domain is mounted; seeding and the runner share the injected
  // agent/session services and degrade cleanly when they unload.
  ctx.inject(['agents', 'sessions', 'sessionProjections'], inner => {
    const scoped = inner as unknown as {
      agents: { get(id: string): { id: string; session?: unknown } | undefined }
      sessions: { get(id: string): { id: string; header?: unknown } | undefined; flush(session: unknown): Promise<unknown> }
      sessionProjections: { stateOf(session: unknown, key: string): { openTurnStartSeq: unknown; lastTurn: number } | undefined }
    }
    const service = new AutoContinueService({
      records: () => autoContinueTable,
      recent: () => autoContinueRecentTable,
      sessionStore: scoped.sessions as never,
      agents: scoped.agents as never,
      sessionQuery: ctx.sessionQuery as never,
      hasStarted: session => {
        const boundary = scoped.sessionProjections.stateOf(session, 'turnBoundary')
        return boundary === undefined || boundary.openTurnStartSeq !== null || boundary.lastTurn > 0
      },
      config: () => resolved,
    })
    autoContinueService = service
    const runner = new AutoContinueRunner({
      service: () => autoContinueService,
      config: () => resolved,
      models: captureModels,
      agents: scoped.agents as never,
      sessions: scoped.sessions as never,
      sessionQuery: ctx.sessionQuery as never,
      log: {
        debug: message => (ctx as { logger?: { debug?(m: string): void } }).logger?.debug?.(message),
        warn: message => (ctx as { logger?: { warn?(m: string): void } }).logger?.warn?.(message),
      },
    })
    // Seeding listens on agent/created: serial and awaited before the agent's
    // queued work, so the row exists before the first prompt assembly. A throw
    // here would fail agent creation, so the listener never propagates one.
    inner.effect(() => ctx.on('agent/created', async ({ agent, source }: { agent: { id: string; session?: { id: string; header?: unknown } }; source: string }) => {
      try {
        // The first draft after a restart may arrive while storage is opening.
        // Do not seed it with an empty table before its remembered mode loads.
        await storageReady
        await service.seed(agent as never, source)
      } catch (error) {
        ctx.logger.warn('dsh-session-manager: could not seed auto-continue state: %s', error instanceof Error ? error.message : String(error))
      }
    }), 'session-manager.autocontinue.seed')
    inner.effect(() => {
      const offEvent = ctx.on('session/event', (session: { id: string }, event: never) => runner.onSessionEvent(session, event))
      const offDisposed = ctx.on('agent/disposed', (payload: never) => runner.onAgentDisposed(payload))
      return async () => {
        offEvent()
        offDisposed()
        await runner.dispose()
      }
    }, 'session-manager.autocontinue.runner')
  })
  // Native creation chips keep using the host's own defaults and refresh
  // notifications. This optional bridge remembers only pre-first-turn picks.
  ctx.inject(['settings', 'sessions', 'sessionProjections', 'permissionPresets', 'agentPresets'], inner => {
    const host = inner as unknown as CreationDefaultsDeps
    const mirror = new CreationDefaultsMirror({
      settings: host.settings,
      sessions: host.sessions,
      sessionProjections: host.sessionProjections,
      permissionPresets: host.permissionPresets,
      agentPresets: host.agentPresets,
      log: { warn: message => ctx.logger.warn(message) },
    })
    inner.effect(() => {
      const off = ctx.on('session/event', mirror.onSessionEvent)
      return () => { off(); mirror.dispose() }
    }, 'session-manager.creation-defaults')
  })
  // CLI-only hosts still load the query tools; the browser RPC follows its own services.
  ctx.inject(['connection', 'webServer'], inner => {
    inner.effect(() => registerSessionManagerRpc(
      ctx,
      inner as Context & HostRpcContext,
      resolved,
      captureModels,
      () => settings,
      () => autoContinueService,
    ))
  })
}
