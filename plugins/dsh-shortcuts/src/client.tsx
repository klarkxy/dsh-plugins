import { Service, symbols, type Context } from '@deepseek-ai/cordis'
import { Button, Modal, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { installClientPluginLogger } from '@klarkxy/dsh-plugin-kit/client-logger'
import { IconKeyboardSettings, registerSettingsSectionIcon } from '@klarkxy/dsh-plugin-kit/client-utils'
import { useRef, useState } from 'react'
import type { Shortcuts, ShortcutContext } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import type { CommandPaletteCommand, CommandPaletteSnapshot } from './contracts.ts'
import { CommandPaletteModel } from './core.ts'
import { CommandPalettePanel } from './palette.tsx'
import { ShortcutsSettings, type ShortcutsSettingsProps, type SelectorHook } from './settings.tsx'
import { SHORTCUTS_STYLES } from './styles.ts'
import { TriggerSettings, type TriggerSettingsProps } from './trigger-settings.tsx'
import { createWebTrigger, captureContext, installWebTrigger, PALETTE_ID, triggerConflicts, WEB_TRIGGER_KEY } from './web-trigger.ts'
import { claimPaletteKey } from './takeover.ts'
import { FixedBindingsModel, FIXED_BINDINGS_KEY, fixedBindingsOverlap, type FixedBindingsSnapshot } from './fixed-bindings.ts'
import { installFixedDispatcher } from './fixed-dispatch.ts'
import {
  FIND_COMMAND_ID,
  FIND_LOCALES,
  FIND_LOCALE_NS,
  FIND_SHORTCUT_DEFAULTS,
  FIND_WEB_CTRL_F_KEY,
  createFindController,
  type FindController,
  type FindSessionsServiceLike,
  type RemoteSessionServiceLike,
} from './conversation-find.ts'
import { FindBarOverlay, FindHeaderUtilityButton, FindWebCtrlFSection } from './conversation-find-ui.tsx'

export const name = 'dsh-shortcuts-client'
export const inject = ['slots', 'locale', 'shortcuts'] as const
const PACKAGE = '@klarkxy/dsh-shortcuts'

/** Prototype methods keep Cordis's caller context, so registrations unload with their owner. */
export class CommandPaletteService extends Service {
  readonly state: CommandPaletteModel['state']
  constructor(ctx: Context, private readonly model: CommandPaletteModel, private readonly begin: (context: ShortcutContext) => void = context => model.open(context)) {
    super(ctx, 'commandPalette')
    this.state = model.state
    ctx.effect(() => () => model.dispose())
  }
  register(command: CommandPaletteCommand): () => void {
    // `symbols.caller` resolves the consuming plugin's context through the
    // service proxy, so each registration unloads with its own caller fiber.
    const caller = (this as unknown as Record<symbol, Context | undefined>)[symbols.caller as symbol]
    const unregister = this.model.register(command)
    caller?.effect(() => unregister)
    return unregister
  }
  isRegistered(id: ShortcutCommandId): boolean { return this.model.isRegistered(id) }
  open(context?: ShortcutContext | undefined): void { this.begin(context ?? captureContext(document)) }
  close(): void { this.model.close() }
  execute(id: ShortcutCommandId): Promise<boolean> { return this.model.execute(id) }
  currentContext(): ShortcutContext | null { return this.model.currentContext() }
  clearError(): void { this.model.clearError() }
}

type Source<T> = { getSnapshot(): T; subscribe(listener: () => void): () => void }
type Client = {
  shortcuts: Shortcuts
  locale: Source<{ active: string }> & { register?(ns: string, dicts: Record<string, Record<string, string>>): () => void }
  slots: {
    inject(key: string, callback: () => () => void): () => void
    register(spec: { name: string; id?: string | undefined; key?: string | undefined; order?: number | undefined; locale?: string | undefined; label?: string | (() => string) | undefined; inject(): object }, component: unknown): () => void
  }
}
interface ScreenProps extends Omit<ShortcutsSettingsProps, 'locale' | 'openPalette'>, Omit<TriggerSettingsProps, 'locale' | 'runtime'> {
  useLocale: SelectorHook<{ active: string }>
  usePalette: SelectorHook<CommandPaletteSnapshot>
  useFixedBindings: SelectorHook<FixedBindingsSnapshot>
  useDispatchStatus: SelectorHook<string | null>
  useWebCtrlF: SelectorHook<boolean>
  useFindController: SelectorHook<FindController | null>
  setWebCtrlF(enabled: boolean): void
  getFindController(): FindController | null
  fixedModel: NonNullable<ShortcutsSettingsProps['fixedSettings']>['model']
  runtime: Shortcuts['runtime']
  openPalette(context?: ShortcutContext | undefined): void
  currentContext(): ShortcutContext | null
  closePalette(): void
  execute(id: ShortcutCommandId): Promise<boolean>
  clearError(): void
  clearDispatchError(): void
}
function SettingsContent(props: ScreenProps) {
  const locale = props.useLocale(value => value.active.startsWith('zh') ? 'zh' as const : 'en' as const)
  // Subscribe at the seat root so child list components receive fresh snapshots.
  props.useCatalog(value => value)
  props.useFixedCatalog(value => value)
  const dispatchError = props.useDispatchStatus(value => value)
  const webCtrlFEnabled = props.useWebCtrlF(value => value)
  return <div className="shortcuts-root shortcuts-page dsh-ui-page">
    {dispatchError && <div role="alert" className="dsh-ui-banner dsh-ui-banner--danger"><p>{dispatchError}</p><div className="dsh-ui-actions"><Button variant="ghost" size="sm" onClick={props.clearDispatchError}>{locale === 'zh' ? '关闭' : 'Dismiss'}</Button></div></div>}
    <TriggerSettings {...props} locale={locale} />
    <FindWebCtrlFSection locale={locale} runtime={props.runtime} enabled={webCtrlFEnabled} onToggle={props.setWebCtrlF} />
    <ShortcutsSettings {...props} locale={locale} fixedSettings={{ useFixedBindings: props.useFixedBindings, model: props.fixedModel }} />
  </div>
}
function Overlay(props: ScreenProps) {
  const locale = props.useLocale(value => value.active.startsWith('zh') ? 'zh' as const : 'en' as const)
  const dispatchError = props.useDispatchStatus(value => value)
  const findCtrl = props.useFindController ? props.useFindController(value => value) : props.getFindController()
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Saved on the palette → settings handoff so the footer return action can
  // reopen the palette against the session/editable context that launched it.
  const roundTrip = useRef<ShortcutContext | null>(null)
  // Cancelling discards the saved context; the next round trip saves its own.
  const closeSettings = () => { roundTrip.current = null; setSettingsOpen(false) }
  return <>
    {findCtrl ? <FindBarOverlay controller={findCtrl} /> : null}
    {dispatchError && <Toast key={dispatchError} text={dispatchError} holdMs={5000}
      actions={[{ label: locale === 'zh' ? '关闭' : 'Dismiss', onClick: props.clearDispatchError }]}
      onDone={props.clearDispatchError} />}
    <CommandPalettePanel {...props} locale={locale} close={props.closePalette} openSettings={() => {
      // The palette's own dialog is still mounted, so a fresh capture would
      // report this overlay as the top modal. Read the live session context
      // before close() clears it.
      roundTrip.current = props.currentContext()
      props.closePalette()
      setSettingsOpen(true)
    }} />
    <Modal open={settingsOpen} onClose={closeSettings} title={locale === 'zh' ? '快捷键管理' : 'Shortcut manager'} closeLabel={locale === 'zh' ? '关闭' : 'Close'} className="shortcuts-root" contentClassName="shortcuts-settings-modal">
      <SettingsContent {...props} openPalette={() => {
        // One-shot: the saved context serves this return trip and nothing after.
        const saved = roundTrip.current
        roundTrip.current = null
        setSettingsOpen(false)
        props.openPalette(saved ?? undefined)
      }} />
    </Modal>
  </>
}

export function apply(ctx: Context): void {
  const logger = installClientPluginLogger(ctx, PACKAGE)
  const client = ctx as unknown as Client
  const shortcuts = client.shortcuts
  // This contract intentionally has no Inspect provider; fail visibly on incompatible hosts.
  if (!shortcuts.catalog || !shortcuts.fixedCatalog || !shortcuts.config || typeof shortcuts.edit !== 'function') {
    throw new Error('This host does not provide the shortcut catalog and key-binding editor contract.')
  }
  let storage: Storage | undefined
  try { storage = window.localStorage } catch { /* The trigger editor reports unavailable storage. */ }
  const trigger = createWebTrigger(storage)

  // Web Ctrl+F takeover store (default false so native browser find stays intact).
  let webCtrlF = false
  try { webCtrlF = storage?.getItem(FIND_WEB_CTRL_F_KEY) === 'true' } catch { /* ignore */ }
  const webCtrlFListeners = new Set<() => void>()
  const webCtrlFStore: Source<boolean> = {
    getSnapshot: () => webCtrlF,
    subscribe: listener => { webCtrlFListeners.add(listener); return () => { webCtrlFListeners.delete(listener) } },
  }
  const setWebCtrlF = (enabled: boolean) => {
    const next = Boolean(enabled)
    if (next === webCtrlF) return
    webCtrlF = next
    try {
      if (next) storage?.setItem(FIND_WEB_CTRL_F_KEY, 'true')
      else storage?.removeItem(FIND_WEB_CTRL_F_KEY)
    } catch { /* ignore */ }
    for (const listener of [...webCtrlFListeners]) listener()
  }

  // Include the Web-only palette binding in local conflict checks; it is absent
  // from the host's application catalog because Web allows a separately saved key.
  const localCatalog: Shortcuts['catalog'] = {
    getSnapshot: () => {
      const rows = shortcuts.catalog.getSnapshot()
      const binding = shortcuts.runtime === 'web' ? trigger.getSnapshot().binding : null
      return binding ? [...rows, { id: PALETTE_ID, label: 'Command palette', aliases: [], keys: [], aria: undefined, binding: { ...binding, modifiers: binding.modifiers as readonly ('control' | 'alt' | 'shift' | 'meta')[] }, modified: true, conflicts: [], issue: null }] : rows
    },
    subscribe: listener => { const native = shortcuts.catalog.subscribe(listener); const extra = trigger.subscribe(listener); return () => { native(); extra() } },
  }
  const fixed = new FixedBindingsModel({ shortcuts: { fixedCatalog: shortcuts.fixedCatalog, catalog: localCatalog, platform: shortcuts.platform, describeBinding: shortcuts.describeBinding.bind(shortcuts) }, storage, storageEvents: window, storageKey: `${FIXED_BINDINGS_KEY}.${shortcuts.runtime}.${shortcuts.platform}` })
  ctx.effect(() => () => fixed.dispose())
  let recordingActive = false
  const recording: Shortcuts['recording'] = async active => {
    if (active) recordingActive = true
    try { await shortcuts.recording(active) }
    catch (error) { if (active) recordingActive = false; throw error }
    finally { if (!active) recordingActive = false }
  }
  const dispatchErrors = new Set<(error: string) => void>()
  let dispatchError: string | null = null
  const dispatchStatus = {
    getSnapshot: () => dispatchError,
    subscribe: (listener: () => void) => { dispatchErrors.add(listener); return () => { dispatchErrors.delete(listener) } },
  }
  // The dispatch toast dismisses itself: when its hold ends, onDone resets the
  // store rather than leaving the last failure up until the next dispatch.
  const clearDispatchError = () => {
    if (dispatchError === null) return
    dispatchError = null
    for (const listener of dispatchErrors) listener('')
  }
  ctx.effect(() => installFixedDispatcher({ window, getMappings: () => fixed.state.getSnapshot().rows,
    isRecording: () => recordingActive,
    onError: error => { dispatchError = error.message; for (const listener of dispatchErrors) listener(error.message) },
  }))
  const model = new CommandPaletteModel({ shortcuts,
    // The next animation frame follows the React commit and modal focus-trap cleanup.
    afterClose: () => new Promise<void>(resolve => requestAnimationFrame(() => resolve())),
  })
  // The shortcut manager hands back the context it interrupted. It is consumed
  // by the very next open and then forgotten, so a later ordinary open always
  // captures the live document instead of a stale session.
  let handoff: ShortcutContext | null = null
  const open = (context?: ShortcutContext | undefined) => {
    const reuse = handoff
    handoff = null
    model.open(context ?? reuse ?? captureContext(document))
  }
  // React copies injected props when it creates an element, so a seat cannot
  // read a live value through one. This function is read only while the
  // palette is open, and the manager drops it in the same act as its close.
  const currentContext = (): ShortcutContext | null => model.currentContext()
  const service = new CommandPaletteService(ctx, model, open)
  ctx.effect(() => shortcuts.register({
    id: PALETTE_ID,
    label: () => client.locale.getSnapshot().active.startsWith('zh') ? '打开快捷命令面板' : 'Open command palette',
    aliases: ['command palette', '快捷命令', 'Ctrl Shift P'],
    defaults: {
      'desktop:windows': { code: 'KeyP', modifiers: ['control', 'shift'] },
      'desktop:macos': { code: 'KeyP', modifiers: ['control', 'shift'] },
      'desktop:linux': { code: 'KeyP', modifiers: ['control', 'shift'] },
    },
    regions: ['page', 'editable', 'terminal'], modals: [],
    resolve: context => ({ status: 'handled', run: () => model.state.getSnapshot().open ? model.close() : model.open(context) }),
  }))
  if (shortcuts.runtime === 'web') {
    ctx.effect(() => installWebTrigger({ target: window, shortcuts, getBinding: () => trigger.getSnapshot().binding,
      isOpen: () => model.state.getSnapshot().open, open: context => model.open(context), close: () => model.close(),
    }))
    ctx.effect(() => {
      const listener = (event: StorageEvent) => {
        if (event.key === WEB_TRIGGER_KEY || event.key === null) trigger.reload()
        if (event.key === FIND_WEB_CTRL_F_KEY || event.key === null) {
          try { setWebCtrlF(storage?.getItem(FIND_WEB_CTRL_F_KEY) === 'true') } catch { /* ignore */ }
        }
      }
      window.addEventListener('storage', listener)
      return () => window.removeEventListener('storage', listener)
    })
  }
  ctx.effect(() => {
    const element = document.createElement('style')
    element.dataset.plugin = PACKAGE
    element.textContent = SHORTCUTS_STYLES
    document.head.appendChild(element)
    return () => element.remove()
  })

  // Activate full-history in-conversation find when `sessions` is available on the host client context.
  let activeFindController: FindController | null = null
  const findPresence = new Set<() => void>()
  const findPresenceStore: Source<FindController | null> = {
    getSnapshot: () => activeFindController,
    subscribe: listener => { findPresence.add(listener); return () => { findPresence.delete(listener) } },
  }

  ctx.inject(['sessions'], sessionCtx => {
    const hostFace = sessionCtx as unknown as {
      sessions: FindSessionsServiceLike
      layout?: { panelInfo?: { getSnapshot(): { activePanelId?: string | null | undefined } | undefined; subscribe(fn: () => void): () => void } | undefined } | undefined
      remote?: { session?: RemoteSessionServiceLike | undefined } | undefined
      get?(key: string): unknown
      inject: Context['inject']
      effect: Context['effect']
    }
    const layoutSvc = (typeof hostFace.get === 'function' ? hostFace.get('layout') : hostFace.layout) as typeof hostFace.layout
    const controller = createFindController({
      sessions: hostFace.sessions,
      layout: layoutSvc,
      locale: client.locale,
      remoteSession: (typeof hostFace.get === 'function' ? (hostFace.get('remote.session') as RemoteSessionServiceLike | undefined) : undefined) ?? hostFace.remote?.session ?? null,
    })
    controller.setRuntimePlatform(shortcuts.runtime, shortcuts.platform)
    activeFindController = controller
    for (const listener of [...findPresence]) listener()

    if (typeof client.locale.register === 'function') {
      sessionCtx.effect(() => client.locale.register!(FIND_LOCALE_NS, {
        zh: { ...FIND_LOCALES.zh },
        en: { ...FIND_LOCALES.en },
      }))
    }

    sessionCtx.effect(() => {
      try {
        return shortcuts.register({
          id: FIND_COMMAND_ID as ShortcutCommandId,
          label: () => controller.t('openLabel'),
          aliases: ['find', 'search', 'ctrl+f', '查找', '搜索'],
          defaults: FIND_SHORTCUT_DEFAULTS as never,
          regions: ['page', 'editable'],
          modals: [],
          resolve: scCtx => {
            controller.syncMainSession()
            if (!controller.canOpenShortcut(scCtx)) return { status: 'pass' }
            return { status: 'handled', run: () => { controller.openFind(scCtx?.target ?? null) } }
          },
        })
      } catch (error) {
        logger.warn('find.shortcut-failed', 'Could not register conversation.findInSession shortcut.', error)
        return () => {}
      }
    })

    hostFace.inject(['remote.session'], remoteScope => {
      remoteScope.effect(() => {
        const rs = ((remoteScope as unknown as { get?(k: string): unknown }).get?.('remote.session') ??
          (remoteScope as unknown as { remote?: { session?: RemoteSessionServiceLike | undefined } | undefined }).remote?.session ??
          null) as RemoteSessionServiceLike | null
        controller.setRemoteSession(rs)
        return () => controller.setRemoteSession(null)
      })
    })

    client.slots.inject('conversation.session.header.utilities', () =>
      client.slots.register(
        {
          name: 'conversation.session.header.utilities',
          id: `${PACKAGE}.find-trigger`,
          order: -10,
          locale: FIND_LOCALE_NS,
          inject: () => ({ controller }),
        },
        FindHeaderUtilityButton,
      ),
    )

    sessionCtx.effect(() => {
      let escAttached = false
      const onGlobalEscape = (e: KeyboardEvent) => {
        if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || e.keyCode === 229 || e.altKey || e.ctrlKey || e.metaKey) return
        const snap = controller.getSnapshot()
        if (!snap.open) return
        const target = e.target as HTMLElement | null
        if (target?.closest?.('[role="dialog"], [aria-modal="true"]') || document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]')) return
        e.preventDefault()
        e.stopPropagation()
        if (snap.scopeMenuOpen) controller.setScopeMenuOpen(false)
        else controller.closeFind(true)
      }
      const syncEsc = () => {
        const want = controller.getSnapshot().open
        if (want === escAttached) return
        escAttached = want
        if (want) window.addEventListener('keydown', onGlobalEscape, true)
        else window.removeEventListener('keydown', onGlobalEscape, true)
      }
      syncEsc()
      const unsub = controller.subscribe(syncEsc)
      return () => {
        if (escAttached) window.removeEventListener('keydown', onGlobalEscape, true)
        unsub()
      }
    })

    sessionCtx.effect(() => {
      let attached = false
      const onWebKeyDown = (e: KeyboardEvent) => {
        if (recordingActive || e.defaultPrevented || e.isComposing || e.keyCode === 229) return
        if (String(e.key || '').toLowerCase() !== 'f' && e.code !== 'KeyF') return
        if (e.altKey || e.shiftKey) return
        const pf = controller.getSnapshot().platform
        const primaryHeld = pf === 'macos' ? (e.metaKey && !e.ctrlKey) : (e.ctrlKey && !e.metaKey)
        if (!primaryHeld) return
        controller.syncMainSession()
        if (!controller.canOpenFromWebCapture(e.target)) return
        e.preventDefault()
        e.stopPropagation()
        controller.openFind((e.target as Element | null) ?? null)
      }
      const syncCapture = () => {
        const want = shortcuts.runtime === 'web' && webCtrlFStore.getSnapshot()
        if (want === attached) return
        attached = want
        if (want) window.addEventListener('keydown', onWebKeyDown, true)
        else window.removeEventListener('keydown', onWebKeyDown, true)
      }
      syncCapture()
      const unsubWeb = webCtrlFStore.subscribe(syncCapture)
      return () => {
        if (attached) window.removeEventListener('keydown', onWebKeyDown, true)
        unsubWeb()
      }
    })

    sessionCtx.effect(() => {
      const stopList = hostFace.sessions.list?.subscribe(() => controller.syncMainSession())
      const stopPanel = layoutSvc?.panelInfo?.subscribe(() => {
        if (layoutSvc.panelInfo?.getSnapshot()?.activePanelId != null) controller.closeFind(false)
      })
      return () => {
        stopList?.()
        stopPanel?.()
        if (activeFindController === controller) {
          activeFindController = null
          for (const listener of [...findPresence]) listener()
        }
        controller.dispose()
      }
    })
  })

  const injected = {
    hooks: { catalog: shortcuts.catalog, fixedCatalog: shortcuts.fixedCatalog, config: shortcuts.config, locale: client.locale, palette: service.state, trigger, fixedBindings: fixed.state, dispatchStatus, webCtrlF: webCtrlFStore, findController: findPresenceStore },
    describeBinding: shortcuts.describeBinding.bind(shortcuts), edit: shortcuts.edit.bind(shortcuts), recording,
    fixedModel: { setSlot: fixed.setSlot.bind(fixed), clear: fixed.clear.bind(fixed), reset: fixed.reset.bind(fixed), resetAll: fixed.resetAll.bind(fixed), describeSlot: fixed.describeSlot.bind(fixed), resetSlot: fixed.resetSlot.bind(fixed) },
    runtime: shortcuts.runtime, openPalette: open, currentContext,
    closePalette: () => model.close(), execute: (id: ShortcutCommandId) => model.execute(id), clearError: () => model.clearError(), clearDispatchError,
    setWebCtrlF, getFindController: () => activeFindController,
    saveTrigger: trigger.save, conflicts: (binding: Parameters<typeof trigger.save>[0]) => [...triggerConflicts(shortcuts, binding), ...fixed.state.getSnapshot().rows.filter(row => binding && row.bindings.some(other => other && fixedBindingsOverlap(binding, other, shortcuts.platform))).map(row => row.label)], claim: () => claimPaletteKey(shortcuts),
  }
  const injection = () => injected
  // Settings live on the Settings page: one section per plugin. The nav label
  // follows the active locale, and the section renders the whole manager.
  const sectionLabel = () => client.locale.getSnapshot().active.startsWith('zh') ? '快捷键' : 'Shortcuts'
  client.slots.inject('settings.section', () => {
    const unregister = client.slots.register({
      name: 'settings.section', id: 'shortcuts', order: 200, label: sectionLabel, inject: injection,
    }, SettingsContent)
    // The keyboard glyph shares the section wait so it unloads with the page.
    const stopIcon = registerSettingsSectionIcon(ctx, 'shortcuts', 200, IconKeyboardSettings)
    return () => { stopIcon(); unregister() }
  })
  client.slots.inject('shell.overlay', () => client.slots.register({ name: 'shell.overlay', id: `${PACKAGE}.palette`, inject: injection }, Overlay))
}
