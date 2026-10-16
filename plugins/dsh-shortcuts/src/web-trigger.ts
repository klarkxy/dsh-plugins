import { modalSelector } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ShortcutBinding, ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import type { ShortcutContext, Shortcuts } from '@deepseek-ai/dsh-client-shortcuts/client'

export const PALETTE_ID = 'klarkxy.shortcuts.palette' as ShortcutCommandId
export const WEB_TRIGGER_KEY = 'klarkxy.shortcuts.palette-key.v1'
export const DEFAULT_WEB_TRIGGER: ShortcutBinding = { code: 'KeyP', modifiers: ['control', 'shift'] }
export interface TriggerSnapshot { binding: ShortcutBinding | null; error: string | null }

export function createWebTrigger(storage?: Pick<Storage, 'getItem' | 'setItem'>) {
  let snapshot: TriggerSnapshot = { binding: DEFAULT_WEB_TRIGGER, error: null }
  const listeners = new Set<() => void>()
  const publish = (next: TriggerSnapshot) => { snapshot = next; listeners.forEach(listener => listener()) }
  const read = () => {
    try {
      const raw = storage?.getItem(WEB_TRIGGER_KEY)
      if (!raw) return publish({ binding: DEFAULT_WEB_TRIGGER, error: null })
      const value: unknown = JSON.parse(raw)
      if (value === null) return publish({ binding: null, error: null })
      if (!isLegalTrigger(value)) throw new Error('Invalid palette shortcut preference')
      publish({ binding: value, error: null })
    } catch (error) { publish({ ...snapshot, error: String(error) }) }
  }
  read()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    reload: read,
    save(binding: ShortcutBinding | null) {
      try {
        if (binding !== null && !isLegalTrigger(binding)) throw new Error('Use Control, Alt, or Meta with one letter or number')
        if (!storage) throw new Error('Browser storage is unavailable')
        storage.setItem(WEB_TRIGGER_KEY, JSON.stringify(binding))
        publish({ binding, error: null })
        return true
      } catch (error) { publish({ ...snapshot, error: String(error) }); return false }
    },
  }
}

export function isLegalTrigger(value: unknown): value is ShortcutBinding {
  if (!value || typeof value !== 'object') return false
  const item = value as ShortcutBinding
  return /^Key[A-Z]$|^Digit[0-9]$/.test(item.code) && !item.secondCode && Array.isArray(item.modifiers)
    && item.modifiers.every(key => ['control', 'alt', 'shift', 'meta'].includes(key))
    && new Set(item.modifiers).size === item.modifiers.length
    && item.modifiers.some(key => key === 'control' || key === 'alt' || key === 'meta')
}

export function bindingFromKey(event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): ShortcutBinding {
  return { code: event.code, modifiers: [event.ctrlKey && 'control', event.altKey && 'alt', event.shiftKey && 'shift', event.metaKey && 'meta'].filter(Boolean) as ShortcutBinding['modifiers'] }
}

export function sameBinding(left: ShortcutBinding, right: ShortcutBinding, platform: Shortcuts['platform']): boolean {
  const modifiers = (binding: ShortcutBinding) => binding.modifiers.map(key => key === 'primary' ? platform === 'macos' ? 'meta' : 'control' : key).sort().join(',')
  return left.code === right.code && !left.secondCode && !right.secondCode && modifiers(left) === modifiers(right)
}

export function triggerConflicts(shortcuts: Pick<Shortcuts, 'catalog' | 'fixedCatalog' | 'platform'>, binding: ShortcutBinding | null): string[] {
  if (!binding) return []
  return [
    ...shortcuts.catalog.getSnapshot().filter(row => row.binding && sameBinding(binding, row.binding, shortcuts.platform)).map(row => row.label),
    ...shortcuts.fixedCatalog.getSnapshot().filter(row => row.bindings.some(other => sameBinding(binding, other, shortcuts.platform))).map(row => row.label),
  ]
}

export function captureContext(doc: Document): ShortcutContext {
  let target = doc.activeElement
  while (target?.shadowRoot?.activeElement) target = target.shadowRoot.activeElement
  const region = target?.closest('.xterm, [data-terminal]') ? 'terminal'
    : target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') ? 'editable' : 'page'
  const dialogs = doc.querySelectorAll<HTMLElement>(modalSelector)
  const top = dialogs[dialogs.length - 1]
  return { source: 'menu', region, modal: top ? top.dataset.shortcutModal ?? 'other' : null, target }
}

/** Web-only escape hatch: the host intentionally rejects browser-owned Ctrl+K. */
export function installWebTrigger(options: {
  target: Window; shortcuts: Pick<Shortcuts, 'catalog' | 'fixedCatalog' | 'platform'>
  getBinding(): ShortcutBinding | null; isOpen(): boolean; open(context: ShortcutContext): void; close(): void
}) {
  const listener = (event: KeyboardEvent) => {
    const binding = options.getBinding()
    if (!binding || event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.getModifierState('AltGraph')) return
    if (!sameBinding(binding, bindingFromKey(event), options.shortcuts.platform)) return
    if (options.target.document.querySelector(modalSelector) && !options.isOpen()) return
    if (triggerConflicts(options.shortcuts, binding).length) return
    event.preventDefault()
    if (event.repeat) return
    if (options.isOpen()) options.close()
    else options.open(captureContext(options.target.document))
  }
  options.target.addEventListener('keydown', listener)
  return () => options.target.removeEventListener('keydown', listener)
}
