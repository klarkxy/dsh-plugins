/** Subagent model preferences and read-only route labels in the native catalog. */
import type { Context } from '@deepseek-ai/cordis'
import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'
import { modelSettingsChangesIdentity } from '@klarkxy/dsh-plugin-kit/contracts'
import { IconModelNetworkSettings, registerSettingsSectionIcon } from '@klarkxy/dsh-plugin-kit/client-utils'
import { createModelSettingsSubscriber, mountModelSettingsChanges, type ModelSettingsSubscriberContext } from '@klarkxy/dsh-plugin-kit/model-settings-client'
import { MODEL_CATALOG_INJECT, readModelCatalog } from '@klarkxy/dsh-model-route'
import { modelMenuCss } from '@klarkxy/dsh-model-route/ui'
import { CAST_WATCH_NAMESPACES, CastPage, type CastApi } from './client-cast.tsx'
import { SubagentCatalogAction, SubagentHeaderLineage, type SubagentAddress, type LocaleLike } from './client-subagent-catalog.tsx'

export const name = 'dsh-subagent-models-client'
export const inject = ['slots', 'connection', ...MODEL_CATALOG_INJECT, 'locale', 'sessions', 'uiWorkspace', 'sidebarRight']
export const CHANNEL = '/dsh-model-hub'
export const BUNDLE = '@klarkxy/dsh-model-hub'

type Locale = LocaleLike & { bind(namespace: string): (key: string, params?: Record<string, string | number>) => string }
function localeActive(locale: Locale): string {
  return String(typeof locale === 'string' ? locale : locale?.getSnapshot?.()?.active ?? 'en')
}

const css = `${officialUiCss('dsh-model-hub')}${modelMenuCss}`
export function SubagentModelsPage({ api, locale }: { api: CastApi; locale: Locale }) {
  return <section className="dsh-model-hub dsh-ui-page" aria-label={localeActive(locale).toLowerCase().startsWith('zh') ? '子代理' : 'Subagents'}>
    <style>{css}</style>
    <CastPage api={api} locale={locale} />
  </section>
}

interface HubClientContext {
  slots: {
    inject(name: string, callback: () => unknown): unknown
    register(options: unknown, component: unknown): unknown
  }
  connection: { rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<{ ok: boolean; value?: unknown; error?: { message?: string } }> } }
  remote: { session: { modelCatalog(): Promise<unknown> } }
  effect(callback: () => () => void | Promise<void>): unknown
  locale: Locale
  sessions: { refreshProjections(sessionId: string): Promise<void> }
  uiWorkspace: { openSession(target: SubagentAddress): void }
  sidebarRight: { openResource(address: string, options?: { kind?: string; preferNewPane?: boolean }): void }
  get?(name: string): unknown
}

function subagentChatAddress(address: SubagentAddress): string {
  const query = new URLSearchParams({ parent: address.parentSessionId, mode: address.mode })
  return `dsh-resource://subagentchat/session/${encodeURIComponent(address.childSessionId)}?${query}`
}

export function apply(ctx: unknown): void {
  const client = ctx as HubClientContext
  mountModelSettingsChanges(ctx as ModelSettingsSubscriberContext, BUNDLE)
  const changes = createModelSettingsSubscriber(ctx as ModelSettingsSubscriberContext, BUNDLE, modelSettingsChangesIdentity(BUNDLE), namespace => CAST_WATCH_NAMESPACES.some(own => own === namespace))
  const call = async (endpoint: string, payload: unknown): Promise<never> => {
    const result = await client.connection.rpc.call(CHANNEL, endpoint, payload)
    if (!result?.ok) throw new Error(result?.error?.message || 'Request failed')
    return result.value as never
  }
  const api: CastApi = Object.freeze({
    modelCatalog: () => readModelCatalog(client),
    subscribeChanges: changes.subscribe,
    getCast: () => call('cast.get', {}),
    setCastEnabled: (payload: { enabled: boolean; expectedRevision: number }) => call('cast.setEnabled', payload),
    addCastRoute: (payload: { route: unknown; expectedRevision: number }) => call('cast.addRoute', payload),
    setCastRoute: (payload: { index: number; route: unknown; expectedRevision: number }) => call('cast.setRoute', payload),
    removeCastRoute: (payload: { index: number; expectedRevision: number }) => call('cast.removeRoute', payload),
    setCastTendency: (payload: { provider: string; model: string; tendency: string; expectedRevision: number }) => call('cast.setTendency', payload),
    setCastRoutePreferences: (payload: { provider: string; model: string; preferences: { tendency?: string; reasoningEffort?: string }; expectedRevision: number }) => call('cast.setPreferences', payload),
  })
  const locale = client.locale
  client.slots.inject('settings.section', () => [
    client.slots.register({
      name: 'settings.section', id: 'model-hub', order: 180,
      label: () => localeActive(locale).toLowerCase().startsWith('zh') ? '子代理' : 'Subagents',
      inject: () => ({ api, locale }),
    }, SubagentModelsPage),
    registerSettingsSectionIcon(ctx as Context, 'model-hub', 180, IconModelNetworkSettings),
  ])

  /* Replace the native catalog cell; the original returns on plugin unload. */
  const sidebarChatAvailable = Boolean(client.get?.('resources'))
  const catalogActions = (_parentSessionId: string) => ({
    openChild: (address: SubagentAddress) => { client.uiWorkspace.openSession(address) },
    openChildAside: (address: SubagentAddress) => {
      if (!sidebarChatAvailable) { client.uiWorkspace.openSession(address); return }
      client.sidebarRight.openResource(subagentChatAddress(address), { kind: 'subagentchat', preferNewPane: true })
    },
    refreshProjection: (sessionId: string) => {
      void Promise.resolve(client.sessions.refreshProjections(sessionId)).catch(() => {})
    },
    hostT: locale.bind('subagent'),
    locale,
  })
  client.slots.inject('conversation.session.header.lineage', () => client.slots.register({
    name: 'conversation.session.header.lineage', priority: -10, inject: catalogActions,
  }, SubagentHeaderLineage))
  client.slots.inject('conversation.session.header.actions', () => client.slots.register({
    name: 'conversation.session.header.actions', id: 'subagent-catalog', order: 10, priority: -10, inject: catalogActions,
  }, SubagentCatalogAction))
}
