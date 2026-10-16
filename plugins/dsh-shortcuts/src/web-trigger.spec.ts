// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { Shortcuts, ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import { captureContext, createWebTrigger, DEFAULT_WEB_TRIGGER, installWebTrigger, triggerConflicts, WEB_TRIGGER_KEY } from './web-trigger.ts'

const source = <T,>(value: T) => ({ getSnapshot: () => value, subscribe: () => () => {} })
const shortcuts = (rows: ShortcutCatalogEntry[] = []) => ({ platform: 'windows', catalog: source(rows), fixedCatalog: source([]) }) as Pick<Shortcuts, 'platform' | 'catalog' | 'fixedCatalog'>

describe('extra Web palette binding', () => {
  it('persists and reloads only the extra trigger', () => {
    const data = new Map<string, string>()
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
    const trigger = createWebTrigger(storage)
    expect(trigger.getSnapshot().binding).toEqual(DEFAULT_WEB_TRIGGER)
    expect(trigger.save({ code: 'KeyJ', modifiers: ['control', 'shift'] })).toBe(true)
    expect(createWebTrigger(storage).getSnapshot().binding?.code).toBe('KeyJ')
    expect([...data.keys()]).toEqual([WEB_TRIGGER_KEY])
    trigger.save(null)
    expect(createWebTrigger(storage).getSnapshot().binding).toBeNull()
  })
  it('preserves accepted binding when browser storage fails', () => {
    const trigger = createWebTrigger({ getItem: () => null, setItem: () => { throw Error('quota') } })
    expect(trigger.save(null)).toBe(false)
    expect(trigger.getSnapshot()).toEqual({ binding: DEFAULT_WEB_TRIGGER, error: 'Error: quota' })
  })
  it('rejects printable unmodified keys and malformed saved data', () => {
    const trigger = createWebTrigger({ getItem: () => '{"code":"KeyK","modifiers":[]}', setItem: vi.fn() })
    expect(trigger.getSnapshot().error).toContain('Invalid')
    expect(trigger.save({ code: 'KeyA', modifiers: [] })).toBe(false)
    expect(trigger.save({ code: 'KeyA', modifiers: ['control', 'control'] })).toBe(false)
  })
  it('does not handle composition, consumed inputs, modal input, repeats, or AltGraph', () => {
    const open = vi.fn(); const close = vi.fn()
    const dispose = installWebTrigger({ target: window, shortcuts: shortcuts(), getBinding: () => DEFAULT_WEB_TRIGGER, isOpen: () => false, open, close })
    const send = (extra: KeyboardEventInit = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', key: 'P', ctrlKey: true, shiftKey: true, cancelable: true, ...extra }))
    send({ isComposing: true }); send({ repeat: true })
    const consumed = new KeyboardEvent('keydown', { code: 'KeyP', ctrlKey: true, shiftKey: true, cancelable: true }); consumed.preventDefault(); window.dispatchEvent(consumed)
    const altGraph = new KeyboardEvent('keydown', { code: 'KeyP', ctrlKey: true, shiftKey: true }); Object.defineProperty(altGraph, 'getModifierState', { value: () => true }); window.dispatchEvent(altGraph)
    const modal = document.createElement('div'); modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); document.body.append(modal); send(); modal.remove()
    expect(open).not.toHaveBeenCalled()
    send(); expect(open).toHaveBeenCalledTimes(1)
    dispose(); send(); expect(open).toHaveBeenCalledTimes(1)
  })
  it('pauses when a native owner acquires the same binding', () => {
    const row = { id: 'owner.key', label: 'Owner command', binding: DEFAULT_WEB_TRIGGER } as ShortcutCatalogEntry
    const native = shortcuts([row]); const open = vi.fn()
    expect(triggerConflicts(native, DEFAULT_WEB_TRIGGER)).toEqual(['Owner command'])
    const dispose = installWebTrigger({ target: window, shortcuts: native, getBinding: () => DEFAULT_WEB_TRIGGER, isOpen: () => false, open, close: vi.fn() })
    const event = new KeyboardEvent('keydown', { code: 'KeyP', ctrlKey: true, shiftKey: true, cancelable: true })
    window.dispatchEvent(event)
    expect(open).not.toHaveBeenCalled(); expect(event.defaultPrevented).toBe(false)
    dispose()
  })
  it('preserves the top modal scope instead of bypassing command restrictions', () => {
    const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); document.body.append(dialog)
    expect(captureContext(document).modal).toBe('other')
    dialog.dataset.shortcutModal = 'owner.dialog'
    expect(captureContext(document).modal).toBe('owner.dialog')
    dialog.remove()
  })
  it('captures editable context and deep shadow focus', () => {
    const host = document.createElement('div'); document.body.append(host)
    const shadow = host.attachShadow({ mode: 'open' }); const input = document.createElement('input'); shadow.append(input); input.focus()
    expect(captureContext(document)).toEqual({ source: 'menu', target: input, region: 'editable', modal: null })
    host.remove()
  })
})
