import type { Context } from '@deepseek-ai/cordis'
import { MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import { useState, useSyncExternalStore, type ComponentProps } from 'react'
import { CopyThreadShortcutNotice, writeClipboard, type HostShortcuts } from './copy-shortcut.tsx'
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
  COPY_THREAD_SHORTCUT_ID,
  DELETE_DIALOG_ID,
  USER_ACTIONS_ID,
  USER_ACTIONS_SLOT,
} from './contracts.ts'
import { installContextMenuForwarding } from './context-menu.ts'
import { CreateNoticeDialog, DeleteChatDialog } from './free-panel.tsx'
import { installTemporaryWorkspacePicker, TemporaryWorkspaceNotice, type PickerRegistry } from './temporary-picker.tsx'
import { bindTemporaryWorkspaceHost, createTemporaryWorkspaceModel } from './temporary-workspace.ts'
import { bindHost, createFreeChatModel, createRetryModel, type FreeChatModel, type RetryModel } from './session-actions.ts'
import { freeChatCss } from './styles.ts'
import { UserMessageActions } from './user-actions.tsx'
import { uiText } from './ui-copy.ts'

export const name = 'dsh-session-manager-client'
export const inject = ['slots', 'locale', 'sessions', 'uiWorkspace', 'shortcuts', 'connection', 'workspaces', 'layout'] as const

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
  shortcuts?: HostShortcuts
  on?(name: string, listener: () => void): () => void
}

export function CopyThreadMenuItem(props: MenuProps & {
  locale: CopyLocale
  writeText?: (value: string) => Promise<void>
  shortcut?: ComponentProps<typeof MenuItemButton>['shortcut']
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
    <MenuItemButton separatorBefore shortcut={props.shortcut} onSelect={onSelect}>
      {label}
    </MenuItemButton>
  )
}


export function apply(ctx: Context): void {
  const client = ctx as Client
  const host = bindHost(client)
  const chats = createFreeChatModel(host)
  const retries = createRetryModel(host)
  const temporaryHost = bindTemporaryWorkspaceHost(client as unknown as Parameters<typeof bindTemporaryWorkspaceHost>[0])
  const temporary = createTemporaryWorkspaceModel(temporaryHost, undefined,
    () => uiText(copyLocale(client.locale?.getSnapshot().active), 'tempWorkspace'))
  const currentLocale = () => client.locale?.getSnapshot().active
  client.effect(() => {
    const stops: Array<() => void> = []
    // The relay needs no host slot and no service; a non-browser host simply skips it.
    if (typeof document !== 'undefined') stops.push(installContextMenuForwarding(document))
    stops.push(client.slots.inject('sidebar.workspaces.session.menu.item', () => (
      client.slots.register({
        name: 'sidebar.workspaces.session.menu.item',
        id: COPY_THREAD_MENU_ID,
        order: COPY_THREAD_MENU_ORDER,
      }, props => <CopyThreadSlot locale={client.locale} shortcuts={client.shortcuts} {...props as MenuProps} />)
    )))
    stops.push(client.slots.inject('sidebar.workspaces.session.menu.item', () => (
      client.slots.register({
        name: 'sidebar.workspaces.session.menu.item',
        id: DELETE_DIALOG_ID,
        order: COPY_THREAD_MENU_ORDER + 10,
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
            <CopyThreadShortcutNotice shortcuts={client.shortcuts} list={client.sessions?.list} locale={locale} currentLocale={currentLocale} />
            <TemporaryWorkspaceNotice model={temporary} locale={locale} />
            <DeleteChatDialog model={chats} locale={locale} />
            <CreateNoticeDialog model={chats} locale={locale} />
          </>
        )
      })
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
      temporary.cancel()
      for (const stop of stops) stop()
    }
  })
}

const EMPTY_SHORTCUTS: ReturnType<HostShortcuts['catalog']['getSnapshot']> = []

function CopyThreadSlot(props: MenuProps & { locale?: LocaleService; shortcuts?: HostShortcuts }) {
  const locale = useLiveLocale(props.locale)
  const shortcuts = useSyncExternalStore(
    listener => props.shortcuts?.catalog.subscribe(listener) ?? (() => {}),
    () => props.shortcuts?.catalog.getSnapshot() ?? EMPTY_SHORTCUTS,
    () => EMPTY_SHORTCUTS,
  )
  return <CopyThreadMenuItem sessionId={props.sessionId} useMenuOpenState={props.useMenuOpenState} locale={locale}
    shortcut={shortcuts.find(row => row.id === COPY_THREAD_SHORTCUT_ID)} />
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
    () => locale?.getSnapshot().active ?? 'en',
    () => locale?.getSnapshot().active ?? 'en',
  )
  return copyLocale(active)
}

export type { FreeChatModel, RetryModel }
