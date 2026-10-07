import type { Context } from '@deepseek-ai/cordis'
import { MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import { useState, useSyncExternalStore } from 'react'
import {
  COPY_THREAD_FAILED,
  COPY_THREAD_LABEL,
  copyLocale,
  copyThreadId,
  type CopyLocale,
} from './copy-action.ts'
import {
  COPY_THREAD_MENU_ID,
  COPY_THREAD_MENU_ORDER,
  DELETE_DIALOG_ID,
  FREE_PANEL_ID,
  USER_ACTIONS_ID,
  USER_ACTIONS_SLOT,
} from './contracts.ts'
import { DeleteChatDialog, FreeChatIcon, FreeChatPanel } from './free-panel.tsx'
import { bindHost, createFreeChatModel, createRetryModel, type FreeChatModel, type RetryModel } from './session-actions.ts'
import { freeChatCss } from './styles.ts'
import { UserMessageActions } from './user-actions.tsx'
import { uiText } from './ui-copy.ts'

export const name = 'dsh-session-manager-client'
export const inject = ['slots', 'locale', 'sessions', 'uiWorkspace', 'layout'] as const

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
  layout?: Parameters<typeof bindHost>[0]['layout']
  on?(name: string, listener: () => void): () => void
}

export function CopyThreadMenuItem(props: MenuProps & {
  locale: CopyLocale
  writeText?: (value: string) => Promise<void>
}) {
  const [failed, setFailed] = useState(false)
  const [, setMenuOpen] = props.useMenuOpenState()
  const label = failed ? COPY_THREAD_FAILED[props.locale] : COPY_THREAD_LABEL[props.locale]
  const onSelect = () => copyThreadId(props.sessionId, props.writeText ?? writeClipboard).then(() => {
    setFailed(false)
    setMenuOpen(false)
  }, () => {
    setFailed(true)
  })
  // MenuItemButton activates through the button click. A keydown wrapper here
  // would run before ui-primitives Menu.tsx applies its composition, modifier,
  // and repeat guards (packages/client/ui-primitives/src/Menu.tsx).
  return (
    <MenuItemButton separatorBefore onSelect={onSelect}>
      {label}
    </MenuItemButton>
  )
}

export function apply(ctx: Context): void {
  const client = ctx as Client
  const host = bindHost(client)
  const chats = createFreeChatModel(host)
  const retries = createRetryModel(host)
  client.effect(() => {
    const stops: Array<() => void> = []
    const localeStop = client.locale?.register?.('sessionManager', {
      zh: { panel: uiText('zh', 'panel') },
      en: { panel: uiText('en', 'panel') },
    })
    if (typeof localeStop === 'function') stops.push(localeStop)
    stops.push(client.slots.inject('sidebar.workspaces.session.menu.item', () => (
      client.slots.register({
        name: 'sidebar.workspaces.session.menu.item',
        id: COPY_THREAD_MENU_ID,
        order: COPY_THREAD_MENU_ORDER,
      }, props => <CopyThreadSlot locale={client.locale} {...props as MenuProps} />)
    )))
    stops.push(client.slots.inject('sidebar.workspaces.session.menu.item', () => (
      client.slots.register({
        name: 'sidebar.workspaces.session.menu.item',
        id: DELETE_DIALOG_ID,
        order: COPY_THREAD_MENU_ORDER + 10,
      }, props => <DeleteMenuItem locale={client.locale} model={chats} {...props as MenuProps} />)
    )))
    stops.push(client.slots.inject('main', () => (
      client.slots.register({
        name: 'main',
        key: FREE_PANEL_ID,
      }, () => <FreeChatPanel model={chats} locale={useLiveLocale(client.locale)} />)
    )))
    stops.push(client.slots.inject('sidebar.panellist', () => (
      client.slots.register({
        name: 'sidebar.panellist',
        id: FREE_PANEL_ID,
        order: 20,
        label: () => uiText(copyLocale(client.locale?.getSnapshot().active), 'panel'),
      }, props => <FreeChatIcon size={(props as { size?: number }).size ?? 16} />)
    )))
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
    stops.push(client.slots.inject('shell.overlay', () => (
      client.slots.register({
        name: 'shell.overlay',
        id: DELETE_DIALOG_ID,
        order: 40,
      }, () => (
        <>
          <style>{freeChatCss}</style>
          <DeleteChatDialog model={chats} locale={useLiveLocale(client.locale)} />
        </>
      ))
    )))
    const reset = client.on?.('connection/reset', () => {
      void chats.reloadCapabilities()
      void retries.load()
    })
    if (typeof reset === 'function') stops.push(reset)
    void chats.reloadCapabilities()
    void retries.load()
    return () => {
      chats.cancel()
      retries.cancel()
      for (const stop of stops) stop()
    }
  })
}

function CopyThreadSlot(props: MenuProps & { locale?: LocaleService }) {
  const locale = useLiveLocale(props.locale)
  return <CopyThreadMenuItem sessionId={props.sessionId} useMenuOpenState={props.useMenuOpenState} locale={locale} />
}

function DeleteMenuItem(props: MenuProps & { locale?: LocaleService; model: FreeChatModel }): React.ReactElement | null {
  const locale = useLiveLocale(props.locale)
  const snapshot = useSyncExternalStore(props.model.subscribe, props.model.getSnapshot, props.model.getSnapshot)
  const [, setMenuOpen] = props.useMenuOpenState()
  if (!snapshot.controls.delete) return null
  return (
    <MenuItemButton onSelect={() => {
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
    () => locale?.getSnapshot().active ?? 'zh',
    () => 'zh',
  )
  return copyLocale(active)
}

async function writeClipboard(value: string): Promise<void> {
  const clipboard = globalThis.navigator?.clipboard
  if (clipboard === undefined) throw new Error('clipboard unavailable')
  await clipboard.writeText(value)
}

export type { FreeChatModel, RetryModel }
