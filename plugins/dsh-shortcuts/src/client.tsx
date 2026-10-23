import { Service, type Context } from '@deepseek-ai/cordis'
import { Button, Modal, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
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
  register(command: CommandPaletteCommand) { return this.ctx.effect(() => this.model.register(command)) }
  isRegistered(id: ShortcutCommandId) { return this.model.isRegistered(id) }
  open(context: ShortcutContext) { this.begin(context) }
  currentContext() { return this.model.currentContext() }
  close() { this.model.close() }
  clearError() { this.model.clearError() }
  execute(id: ShortcutCommandId) { return this.model.execute(id) }
}

type Source<T> = { getSnapshot(): T; subscribe(listener: () => void): () => void }
type Client = {
  shortcuts: Shortcuts
  locale: Source<{ active: string }>
  slots: {
    inject(key: string, callback: () => () => void): () => void
    register(spec: { name: string; id?: string; key?: string; inject(): object }, component: unknown): () => void
  }
}
interface ScreenProps extends Omit<ShortcutsSettingsProps, 'locale' | 'openPalette'>, Omit<TriggerSettingsProps, 'locale' | 'runtime'> {
  useLocale: SelectorHook<{ active: string }>
  usePalette: SelectorHook<CommandPaletteSnapshot>
  useFixedBindings: SelectorHook<FixedBindingsSnapshot>
  useDispatchStatus: SelectorHook<string | null>
  fixedModel: NonNullable<ShortcutsSettingsProps['fixedSettings']>['model']
  openPalette(context?: ShortcutContext): void
  currentContext(): ShortcutContext | null
  closePalette(): void
  execute(id: ShortcutCommandId): Promise<boolean>
  clearError(): void
  clearDispatchError(): void
  view?: 'summary' | 'page'
}
function SettingsContent(props: ScreenProps) {
  const locale = props.useLocale(value => value.active.startsWith('zh') ? 'zh' as const : 'en' as const)
  // Subscribe even when only the extra Web binding changes or a late owner registers a conflict.
  props.useCatalog(value => value)
  props.useFixedCatalog(value => value)
  const dispatchError = props.useDispatchStatus(value => value)
  return <div className="shortcuts-root shortcuts-page dsh-ui-page">
    {dispatchError && <div role="alert" className="dsh-ui-banner dsh-ui-banner--danger"><p>{dispatchError}</p><div className="dsh-ui-actions"><Button variant="ghost" size="sm" onClick={props.clearDispatchError}>{locale === 'zh' ? '关闭' : 'Dismiss'}</Button></div></div>}
    <TriggerSettings {...props} locale={locale} />
    <ShortcutsSettings {...props} locale={locale} fixedSettings={{ useFixedBindings: props.useFixedBindings, model: props.fixedModel }} />
  </div>
}
function SettingsPage(props: ScreenProps) {
  const locale = props.useLocale(value => value.active)
  if (props.view === 'summary') return <span className="shortcuts-root">{locale.startsWith('zh') ? '快捷键列表、改键与命令面板' : 'Shortcut list, key bindings, and command palette'}</span>
  return <SettingsContent {...props} />
}
function Overlay(props: ScreenProps) {
  const locale = props.useLocale(value => value.active.startsWith('zh') ? 'zh' as const : 'en' as const)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Only a palette → settings → palette round trip may reuse a saved context.
  // Every other open captures the live document, so an ordinary entry can
  // never inherit an earlier session's target and slip past modal gating.
  const roundTrip = useRef<ShortcutContext | null>(null)
  const dispatchError = props.useDispatchStatus(value => value)
  // Cancelling discards the saved context; the next round trip saves its own.
  const closeSettings = () => { roundTrip.current = null; setSettingsOpen(false) }
  return <>
    {dispatchError && <Toast key={dispatchError} text={dispatchError} holdMs={5000}
      actions={[{ label: locale === 'zh' ? '关闭' : 'Dismiss', onClick: props.clearDispatchError }]}
      onDone={props.clearDispatchError} />}
    <CommandPalettePanel {...props} locale={locale} close={props.closePalette} openSettings={() => {
      // The palette's own dialog is still mounted, so a fresh capture would
      // report this overlay as the top modal. Read the live session context
      // instead, before closing it.
      const saved = props.currentContext() ?? captureContext(document)
      roundTrip.current = saved
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
  const client = ctx as unknown as Client
  const shortcuts = client.shortcuts
  // This contract intentionally has no Inspect provider; fail visibly on incompatible hosts.
  if (!shortcuts.catalog || !shortcuts.fixedCatalog || !shortcuts.config || typeof shortcuts.edit !== 'function') {
    throw new Error('This host does not provide the shortcut catalog and key-binding editor contract.')
  }
  let storage: Storage | undefined
  try { storage = window.localStorage } catch { /* The trigger editor reports unavailable storage. */ }
  const trigger = createWebTrigger(storage)
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
  const open = (context?: ShortcutContext) => {
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
      const listener = (event: StorageEvent) => { if (event.key === WEB_TRIGGER_KEY || event.key === null) trigger.reload() }
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
  const injected = {
    hooks: { catalog: shortcuts.catalog, fixedCatalog: shortcuts.fixedCatalog, config: shortcuts.config, locale: client.locale, palette: service.state, trigger, fixedBindings: fixed.state, dispatchStatus },
    describeBinding: shortcuts.describeBinding.bind(shortcuts), edit: shortcuts.edit.bind(shortcuts), recording,
    fixedModel: { setSlot: fixed.setSlot.bind(fixed), clear: fixed.clear.bind(fixed), reset: fixed.reset.bind(fixed), resetAll: fixed.resetAll.bind(fixed), describeSlot: fixed.describeSlot.bind(fixed), resetSlot: fixed.resetSlot.bind(fixed) },
    runtime: shortcuts.runtime, openPalette: open, currentContext,
    closePalette: () => model.close(), execute: (id: ShortcutCommandId) => model.execute(id), clearError: () => model.clearError(), clearDispatchError,
    saveTrigger: trigger.save, conflicts: (binding: Parameters<typeof trigger.save>[0]) => [...triggerConflicts(shortcuts, binding), ...fixed.state.getSnapshot().rows.filter(row => binding && row.bindings.some(other => other && fixedBindingsOverlap(binding, other, shortcuts.platform))).map(row => row.label)], claim: () => claimPaletteKey(shortcuts),
  }
  const injection = () => injected
  client.slots.inject('plugins.bundle.config', () => client.slots.register({ name: 'plugins.bundle.config', key: PACKAGE, inject: injection }, SettingsPage))
  client.slots.inject('shell.overlay', () => client.slots.register({ name: 'shell.overlay', id: `${PACKAGE}.palette`, inject: injection }, Overlay))
}
