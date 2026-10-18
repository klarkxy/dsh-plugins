import type { Context } from '@deepseek-ai/cordis'
import { MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import { useSyncExternalStore } from 'react'
import { copyLocale, type CopyLocale } from './ui-copy.ts'
import {
  CONTINUE_GHOST_ID,
  PLUGIN_NAME,
  CONTINUE_GHOST_SLOT,
  DELETE_DIALOG_ID,
  USER_ACTIONS_ID,
  USER_ACTIONS_SLOT,
  WELCOME_BACK_CARD_ID,
  WELCOME_BACK_CARD_SLOT,
} from './contracts.ts'
import { installContextMenuForwarding } from './context-menu.ts'
import { CreateNoticeDialog, DeleteChatDialog } from './free-panel.tsx'
import { installTemporaryWorkspacePicker, TemporaryWorkspaceNotice, type PickerRegistry } from './temporary-picker.tsx'
import { bindTemporaryWorkspaceHost, createTemporaryWorkspaceModel } from './temporary-workspace.ts'
import { bindHost, createFreeChatModel, createRetryModel, type FreeChatModel, type RetryModel } from './session-actions.ts'
import { bindPresenceHost, createContinueModel, createPresenceConfigModel, createWelcomeBackModel } from './presence-model.ts'
import { modelSettingsChangesIdentity } from '@klarkxy/dsh-plugin-kit/contracts'
import { createModelSettingsSubscriber, mountModelSettingsChanges } from '@klarkxy/dsh-plugin-kit/model-settings-client'
import { MODEL_CATALOG_INJECT, readModelCatalog } from '@klarkxy/dsh-model-route'
import { ContinueGhost, WelcomeBackCard, type WelcomeBackTurn } from './presence-panel.tsx'
import { SessionManagerSettings } from './settings-panel.tsx'
import { freeChatCss } from './styles.ts'
import { UserMessageActions } from './user-actions.tsx'
import { uiText } from './ui-copy.ts'

export const name = 'dsh-session-manager-client'
export const inject = ['slots', 'locale', 'sessions', 'uiWorkspace', 'connection', 'workspaces', 'layout', 'conversation', ...MODEL_CATALOG_INJECT] as const

interface LocaleService {
  getSnapshot(): { active: string }
  subscribe(listener: () => void): () => void
  register?(namespace: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): (() => void) | void
}

interface MenuProps {
  sessionId: string
  useMenuOpenState: () => [boolean, (open: boolean) => void]
}

interface SlotRegistry {
  inject(key: string, callback: () => (() => void) | void): () => void
  register(spec: Record<string, unknown>, render: (props: never) => unknown): () => void
}

type Client = Context & {
  slots: SlotRegistry
  locale?: LocaleService
  sessions?: Parameters<typeof bindHost>[0]['sessions']
  uiWorkspace?: Parameters<typeof bindHost>[0]['uiWorkspace']
  remote?: { session?: { modelCatalog?: () => Promise<unknown> } }
  connection?: { generation?: { subscribe(listener: () => void): () => void } }
  on?(name: string, listener: () => void): () => void
}

export function apply(ctx: Context): void {
  const client = ctx as Client
  mountModelSettingsChanges(client, PLUGIN_NAME)
  const host = bindHost(client)
  const chats = createFreeChatModel(host)
  const retries = createRetryModel(host)
  const temporaryHost = bindTemporaryWorkspaceHost(client as unknown as Parameters<typeof bindTemporaryWorkspaceHost>[0])
  const temporary = createTemporaryWorkspaceModel(temporaryHost, undefined,
    () => uiText(copyLocale(client.locale?.getSnapshot().active), 'tempWorkspace'))
  const presenceHost = bindPresenceHost(client)
  const continues = createContinueModel(presenceHost)
  const welcomeBack = createWelcomeBackModel(presenceHost)
  const presenceConfig = createPresenceConfigModel(presenceHost)
  // Model catalog access uses the same dependency contract as every model menu.
  const settingsSubscriber = createModelSettingsSubscriber(client as unknown as Parameters<typeof createModelSettingsSubscriber>[0], PLUGIN_NAME, modelSettingsChangesIdentity(PLUGIN_NAME))
  const subscribeSettings = (onChange: () => void, onError?: (message: string) => void) =>
    settingsSubscriber.subscribe(onChange, onError)
  const modelCatalog = () => readModelCatalog(client)
  const subscribeCatalog = (onChange: () => void) => client.connection?.generation?.subscribe(onChange)
  client.effect(() => {
    const stops: Array<() => void> = []
    // The relay needs no host slot and no service; a non-browser host simply skips it.
    if (typeof document !== 'undefined') stops.push(installContextMenuForwarding(document))
    stops.push(client.slots.inject('sidebar.workspaces.session.menu.item', () => (
      client.slots.register({
        name: 'sidebar.workspaces.session.menu.item',
        id: DELETE_DIALOG_ID,
        order: 510,
      }, props => <DeleteMenuItem locale={client.locale} model={chats} {...props as MenuProps} />)
    )))
    stops.push(installTemporaryWorkspacePicker(client.slots as unknown as PickerRegistry, temporary,
      temporaryHost.createWorkspace, client.locale))
    stops.push(client.slots.inject(USER_ACTIONS_SLOT, () => (
      client.slots.register({
        name: USER_ACTIONS_SLOT,
        id: USER_ACTIONS_ID,
        order: 10,
        inject: (sessionId: string) => ({ sessionId }),
      }, props => (
        <UserMessageActions
          messageId={(props as { messageId: string }).messageId}
          text={(props as { text: string }).text}
          sessionId={(props as { sessionId?: string }).sessionId ?? ''}
          locale={useLiveLocale(client.locale)}
          model={retries}
        />
      ))
    )))
    stops.push(client.slots.inject(CONTINUE_GHOST_SLOT, () => (
      client.slots.register({
        name: CONTINUE_GHOST_SLOT,
        id: CONTINUE_GHOST_ID,
        order: 10,
      }, props => (
        <ContinueGhost
          sessionId={(props as { sessionId?: string }).sessionId}
          useInput={(props as { useInput?: never }).useInput}
          useSession={(props as { useSession?: never }).useSession}
          useSessionStatus={(props as { useSessionStatus?: never }).useSessionStatus}
          inputActions={(props as { inputActions?: never }).inputActions}
          locale={useLiveLocale(client.locale)}
          model={continues}
        />
      ))
    )))
    // Recap card lives in the chat flow at the latest completed turn's tail,
    // after the shipped deliverables/plan/schedule entries (orders 0/0/20).
    stops.push(client.slots.inject(WELCOME_BACK_CARD_SLOT, () => (
      client.slots.register({
        name: WELCOME_BACK_CARD_SLOT,
        id: WELCOME_BACK_CARD_ID,
        order: 30,
      }, props => (
        <WelcomeBackCard
          sessionId={(props as { sessionId?: string }).sessionId}
          turn={(props as { turn?: WelcomeBackTurn }).turn}
          useChat={(props as { useChat?: never }).useChat}
          useInput={(props as { useInput?: never }).useInput}
          locale={useLiveLocale(client.locale)}
          model={welcomeBack}
        />
      ))
    )))
    stops.push(client.slots.inject('plugins.bundle.config', () => (
      client.slots.register({
        name: 'plugins.bundle.config',
        key: '@klarkxy/dsh-session-manager',
      }, () => (
        <SessionManagerSettings
          model={presenceConfig}
          locale={useLiveLocale(client.locale)}
          modelCatalog={modelCatalog}
          subscribeCatalog={subscribeCatalog}
        />
      ))
    )))
    stops.push(client.slots.inject('shell.overlay', () => (
      client.slots.register({
        name: 'shell.overlay',
        id: DELETE_DIALOG_ID,
        order: 40,
      }, () => {
        const locale = useLiveLocale(client.locale)
        return (
          <>
            <style>{freeChatCss}</style>
            <TemporaryWorkspaceNotice model={temporary} locale={locale} />
            <DeleteChatDialog model={chats} locale={locale} />
            <CreateNoticeDialog model={chats} locale={locale} />
          </>
        )
      })
    )))
    // Return triggers: window refocus, tab visibility, current-session switch, first mount.
    const findCurrent = () => Object.values(client.sessions?.list.getSnapshot().byId ?? {})
      .find(row => (row?.retainedBy?.mainView ?? 0) > 0)?.id ?? ''
    let current = findCurrent()
    const onReturn = () => {
      const id = findCurrent()
      if (id !== '') void welcomeBack.check(id)
    }
    let lastThresholds: string | undefined
    let lastContinuation: string | undefined
    stops.push(presenceConfig.subscribe(() => {
      const config = presenceConfig.getSnapshot()
      if (config.phase !== 'ready' || config.saving || config.values === undefined) return
      const continuation = JSON.stringify([config.values.continueMode, config.values.continueText, config.values.ghostModel])
      if (continuation !== lastContinuation) {
        lastContinuation = continuation
        continues.invalidateAll()
      }
      const thresholds = `${config.values.recapMinutes}:${config.values.compactMinutes}`
      if (thresholds !== lastThresholds) {
        lastThresholds = thresholds
        welcomeBack.invalidate()
        onReturn()
      }
    }))
    // Keep synchronization alive even when the settings page is never opened.
    stops.push(subscribeSettings(() => { void presenceConfig.load() }))
    const refreshConfig = () => { void presenceConfig.load().then(onReturn) }
    const watchGeneration = client.connection?.generation?.subscribe(refreshConfig)
    if (watchGeneration) stops.push(watchGeneration)
    if (typeof window !== 'undefined') {
      const refreshOnReturn = refreshConfig
      const onVisibility = () => { if (!document.hidden) refreshOnReturn() }
      window.addEventListener('focus', refreshOnReturn)
      document.addEventListener('visibilitychange', onVisibility)
      const timer = setTimeout(refreshOnReturn, 1_500)
      // A continuously visible conversation must also cross an idle threshold
      // without requiring the user to blur the window or switch sessions.
      const idleTimer = setInterval(() => {
        if (!document.hidden) onReturn()
      }, 30_000)
      stops.push(() => {
        window.removeEventListener('focus', refreshOnReturn)
        document.removeEventListener('visibilitychange', onVisibility)
        clearTimeout(timer)
        clearInterval(idleTimer)
      })
    }
    const watchList = client.sessions?.list.subscribe(() => {
      const id = findCurrent()
      if (id !== current) {
        current = id
        if (id !== '') void welcomeBack.check(id)
      }
    })
    if (typeof watchList === 'function') stops.push(watchList)
    const reset = client.on?.('connection/reset', () => {
      void chats.reloadCapabilities()
      void retries.load()
      refreshConfig()
    })
    if (typeof reset === 'function') stops.push(reset)
    void chats.reloadCapabilities()
    void retries.load()
    return () => {
      chats.cancel()
      retries.cancel()
      temporary.cancel()
      continues.cancel()
      welcomeBack.cancel()
      presenceConfig.cancel()
      for (const stop of stops) stop()
    }
  })
}

function DeleteMenuItem(props: MenuProps & { locale?: LocaleService; model: FreeChatModel }): React.ReactElement | null {
  const locale = useLiveLocale(props.locale)
  const snapshot = useSyncExternalStore(props.model.subscribe, props.model.getSnapshot, props.model.getSnapshot)
  const [, setMenuOpen] = props.useMenuOpenState()
  if (!snapshot.controls.delete) return null
  return (
    <MenuItemButton danger onSelect={() => {
      props.model.requestDelete(props.sessionId)
      setMenuOpen(false)
    }}>
      {uiText(locale, 'deleteChat')}
    </MenuItemButton>
  )
}

function useLiveLocale(locale: LocaleService | undefined): CopyLocale {
  const active = useSyncExternalStore(
    listener => locale?.subscribe(listener) ?? (() => {}),
    () => locale?.getSnapshot().active ?? 'en',
    () => locale?.getSnapshot().active ?? 'en',
  )
  return copyLocale(active)
}

export type { FreeChatModel, RetryModel }
