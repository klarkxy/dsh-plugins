import type { Context } from '@deepseek-ai/cordis'
import type { LlmTextCaller } from '@klarkxy/dsh-plugin-kit'
import { registerHostRpc, type HostRpcContext } from '@klarkxy/dsh-plugin-kit/host-rpc'
import { modelSettingsChangesIdentity } from '@klarkxy/dsh-plugin-kit/contracts'
import { createModelSettingsChanges } from '@klarkxy/dsh-plugin-kit/model-settings-changes'
import { registerModelSettings, notifyModelSettingsChanged, type ModelSettingsEvents } from '@klarkxy/dsh-plugin-kit/model-settings'
import { isTitleLocaleMode, PLUGIN_NAME, RPC_CHANNEL, SETTINGS_KEY, type TitleLocaleMode } from './contracts.ts'
import { CurrentTitleService, handleRpc, hostLocalePreference } from './service.ts'
import type { LoaderFace, SessionTitleServiceLike } from './native-slot.ts'
import type { SessionLike } from './messages.ts'
import { parseTitleSettings, titleDomain } from './storage.ts'

export const name = PLUGIN_NAME
export const inject = ['sessionTitle', 'llm', 'sessions', 'loader', 'storageDomain', 'connection', 'webServer', 'agents', 'sessionProjections', 'agentDefaultModel'] as const
export { CurrentTitleService }
export { selectRecentMessages, frameMessages } from './input.ts'
export { parseModelTitle, formatTitle, resolveTitleLocale } from './output.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { currentTitle: CurrentTitleService }
}

type DomainHandle = {
  table(name: 'settings'): {
    get(key: string): unknown
    put(key: string, value: unknown): Promise<void>
  }
  close(): Promise<void>
}

type Host = Context & HostRpcContext & {
  sessionTitle: SessionTitleServiceLike
  llm: LlmTextCaller
  sessions: { get(id: string): SessionLike | undefined }
  loader: LoaderFace
  storageDomain: { open: (spec: typeof titleDomain) => Promise<DomainHandle> }
}

export async function apply(ctx: Context, config: { locale?: TitleLocaleMode } = {}): Promise<void> {
  createModelSettingsChanges(ctx, modelSettingsChangesIdentity(PLUGIN_NAME), PLUGIN_NAME)
  const host = ctx as Host
  const domain = await host.storageDomain.open(titleDomain)
  const table = domain.table('settings')
  const locale = isTitleLocaleMode(config.locale) ? config.locale : 'auto'
  const service = new CurrentTitleService({
    plugin: PLUGIN_NAME,
    onSettingsChanged: revision => notifyModelSettingsChanged(ctx, PLUGIN_NAME, revision),
    llm: host.llm,
    host,
    sessionTitle: host.sessionTitle,
    loader: host.loader,
    sessions: host.sessions,
    store: {
      load: () => parseTitleSettings(table.get(SETTINGS_KEY)),
      save: settings => table.put(SETTINGS_KEY, settings),
    },
    initialLocale: locale,
    localePreference: () => hostLocalePreference(host),
  })
  await service.start()
  ctx.provide('currentTitle', service)
  ctx.effect(() => async () => { await service.dispose(); await domain.close() }, 'current-title.lifecycle')
  ctx.effect(() => registerHostRpc(host, RPC_CHANNEL, (endpoint, payload, signal) => handleRpc(service, endpoint, payload, signal)), 'current-title.rpc')
  ctx.effect(() => registerModelSettings(ctx as unknown as ModelSettingsEvents, {
    ns: PLUGIN_NAME, title: { zh: '自动标题', en: 'Auto Title' },
    read(signal) {
      signal.throwIfAborted()
      const settings = service.status().settings
      return { revision: settings.revision, fields: [{ path: ['model'], label: { zh: '标题模型', en: 'Title model' }, current: settings.model,
        followLabel: { zh: '当前会话 / 宿主默认模型', en: 'Current conversation / host default' }, allowFollow: true }] }
    },
    async write(path, route, expectedRevision, signal) {
      if (path.length !== 1 || path[0] !== 'model') throw new Error('Unknown Current Title model setting')
      signal.throwIfAborted()
      return service.updateSettings({ model: route, expectedRevision })
    },
  }), 'current-title.model-settings')
}
