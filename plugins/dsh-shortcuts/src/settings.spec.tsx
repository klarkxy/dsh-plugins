// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShortcutCatalogEntry, ShortcutFixedCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { NormalizedBinding, ShortcutBinding, ShortcutConfigSnapshot, ShortcutRevision } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import { ShortcutsSettings, type ShortcutsSettingsProps } from './settings'

const id = (value: string) => value as ShortcutCatalogEntry['id']
const revision = (value: string) => value as ShortcutRevision
const binding: NormalizedBinding = { code: 'KeyK', modifiers: ['control'] }
const snapshot = (rev = 'r1', sequence = 1): ShortcutConfigSnapshot => ({ revision: revision(rev), sequence,
  document: { schemaVersion: 2, profiles: {} }, status: 'ready', error: null, usingDefaults: true })
const command = (name: string, label: string): ShortcutCatalogEntry => ({ id: id(name), label,
  aliases: ['find command'], keys: ['Ctrl', '+', 'K'], aria: 'Control+K', binding, modified: false, conflicts: [], issue: null })
let root: Root
let container: HTMLDivElement
let props: ShortcutsSettingsProps
let config: ShortcutConfigSnapshot
let catalog: readonly ShortcutCatalogEntry[]
let fixed: readonly ShortcutFixedCatalogEntry[]
let unmounted: boolean
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
const button = (label: string, scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>('button')]
  .find(item => item.textContent === label || item.getAttribute('aria-label') === label)!
const click = async (label: string, scope: ParentNode = document) => {
  const node = button(label, scope)
  expect(node, `Button ${label} exists`).toBeTruthy()
  await act(async () => { node.click() })
}
const render = async () => { await act(async () => root.render(<ShortcutsSettings {...props} />)) }
const press = async (code: string, options: KeyboardEventInit = {}, type = 'keydown') => {
  const event = new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true, ...options })
  await act(async () => { (document.activeElement ?? document.body).dispatchEvent(event) })
  return event
}
const begin = async () => { await click('Edit'); await click('Record shortcut', dialog()) }
const deferred = () => {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container); unmounted = false
  config = snapshot(); catalog = [command('app.find', 'Find')]
  fixed = [{ id: id('input.escape'), label: 'Cancel input', keys: ['Escape'], bindings: [{ code: 'Escape', modifiers: [] }], group: 'input' }]
  props = {
    useCatalog: selector => selector(catalog), useFixedCatalog: selector => selector(fixed), useConfig: selector => selector(config),
    describeBinding: vi.fn(value => ({ binding: value as NormalizedBinding | null,
      keys: value ? [...value.modifiers, value.code, ...(value.secondCode ? [value.secondCode] : [])] : [], issue: null, conflicts: [] })),
    edit: vi.fn(async () => ({ status: 'saved', snapshot: snapshot('r2', 2) })), recording: vi.fn(async () => {}),
    runtime: 'desktop', locale: 'en', openPalette: vi.fn(),
  }
  await render()
})
afterEach(async () => {
  if (!unmounted) await act(async () => root.unmount())
  container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})

describe('ShortcutsSettings', () => {
  it('searches labels, aliases, keys and IDs and updates reactive catalogs with read-only rows', async () => {
    const search = document.querySelector('input')!
    const query = async (value: string) => { await act(async () => { search.value = value; Simulate.change(search) }) }
    for (const value of ['Find', 'find command', 'Ctrl+K', 'app.find']) {
      await query(value)
      expect(container.querySelector('[data-command-id="app.find"]')).not.toBeNull()
      expect(container.querySelector('[data-command-id="input.escape"]')).toBeNull()
    }
    await query('Escape')
    const row = container.querySelector('[data-command-id="input.escape"]')!
    expect(row.textContent).toContain('Read only'); expect(row.querySelector('button')).toBeNull()
    await query('')
    catalog = [...catalog, command('app.new', 'New action')]; await render()
    expect(container.textContent).toContain('New action')
    await click('Open shortcut palette'); expect(props.openPalette).toHaveBeenCalledOnce()
    expect(props.openPalette).toHaveBeenCalledWith()
  })

  it('waits for recording acknowledgement, captures event.code with modifiers and releases before saving', async () => {
    const pending = deferred()
    vi.mocked(props.recording).mockImplementation(active => active ? pending.promise : Promise.resolve())
    await begin()
    expect(document.activeElement?.getAttribute('role')).toBe('status')
    await press('KeyQ', { key: 'a', ctrlKey: true })
    expect(dialog().textContent).not.toContain('KeyQ')
    await act(async () => pending.resolve())
    const event = await press('KeyQ', { key: 'a', ctrlKey: true, shiftKey: true })
    expect(event.defaultPrevented).toBe(true)
    expect(dialog().textContent).toContain('control shift KeyQ')
    expect(props.recording).toHaveBeenNthCalledWith(1, true)
    expect(props.recording).toHaveBeenNthCalledWith(2, false)
    await click('Save', dialog())
    expect(props.edit).toHaveBeenCalledWith({ type: 'set', id: id('app.find'), binding: { code: 'KeyQ', modifiers: ['control', 'shift'] } }, revision('r1'))
    expect(dialog()).toBeNull()
  })

  it('ignores IME, modifier-only, repeated and AltGraph keys; Escape cancels recording and preserves the draft', async () => {
    await begin()
    await press('KeyQ', { ctrlKey: true, isComposing: true })
    await press('KeyQ', { ctrlKey: true, repeat: true })
    await press('ControlLeft', { ctrlKey: true })
    const altGraph = new KeyboardEvent('keydown', { code: 'KeyQ', ctrlKey: true, altKey: true, bubbles: true })
    Object.defineProperty(altGraph, 'getModifierState', { value: (key: string) => key === 'AltGraph' })
    await act(async () => { document.dispatchEvent(altGraph) })
    expect(dialog().textContent).toContain('Press a physical key combination')
    expect(dialog().textContent).not.toContain('KeyQ')
    await press('Escape')
    expect(dialog()).not.toBeNull()
    expect(dialog().textContent).not.toContain('Press a physical key combination')
    expect(props.recording).toHaveBeenLastCalledWith(false)
    expect(document.activeElement).toBe(button('Record shortcut', dialog()))
    expect(props.edit).not.toHaveBeenCalled()
  })

  it('captures two simultaneous physical keys only when desktop opt-in is enabled', async () => {
    await click('Edit')
    const checkbox = dialog().querySelector<HTMLInputElement>('input[type="checkbox"]')!
    await act(async () => checkbox.click())
    await click('Record shortcut', dialog())
    await press('KeyA', { ctrlKey: true }); await press('KeyA', { ctrlKey: true }, 'keyup')
    await press('KeyB', { ctrlKey: true })
    expect(dialog().textContent).toContain('Press a physical key combination')
    await press('KeyC', { ctrlKey: true })
    await click('Save', dialog())
    expect(props.edit).toHaveBeenCalledWith({ type: 'set', id: id('app.find'), binding: { code: 'KeyB', secondCode: 'KeyC', modifiers: ['control'] } }, revision('r1'))
    props.runtime = 'web'; await render(); await click('Edit')
    expect(dialog().querySelector('input[type="checkbox"]')).toBeNull()
  })

  it('shows validation and conflict labels before saving, excluding the edited command itself', async () => {
    props.describeBinding = vi.fn(value => ({ binding: value as NormalizedBinding | null, keys: ['Ctrl', 'Q'], issue: 'reserved', conflicts: [id('app.find'), id('input.escape')] }))
    await render(); await click('Edit')
    expect(dialog().textContent).toContain('This shortcut is reserved.')
    expect(dialog().textContent).toContain('Conflicts with: Cancel input')
    expect(button('Save', dialog()).disabled).toBe(true)
    await click('Save', dialog()); expect(props.edit).not.toHaveBeenCalled()
    props.describeBinding = vi.fn(() => { throw new Error('bad physical code') }); await render()
    expect(dialog().textContent).toContain('bad physical code')
    expect(button('Save', dialog()).disabled).toBe(true)
  })

  it('preserves a stale draft, requires review and never retries automatically', async () => {
    vi.mocked(props.edit).mockResolvedValueOnce({ status: 'stale', snapshot: snapshot('r2', 2) })
    await begin(); await press('KeyQ', { ctrlKey: true }); await click('Save', dialog())
    expect(props.edit).toHaveBeenCalledTimes(1)
    expect(dialog().textContent).toContain('control KeyQ')
    expect(dialog().textContent).toContain('Shortcuts changed after this draft')
    expect(button('Save', dialog()).disabled).toBe(true)
    config = snapshot('r2', 2); catalog = [{ ...catalog[0]!, keys: ['Ctrl', 'J'] }]; await render()
    expect(dialog().textContent).toContain('Current shortcut: Ctrl J')
    await click('I reviewed the current configuration', dialog())
    expect(props.edit).toHaveBeenCalledTimes(1)
    await click('Retry save', dialog())
    expect(props.edit).toHaveBeenLastCalledWith({ type: 'set', id: id('app.find'), binding: { code: 'KeyQ', modifiers: ['control'] } }, revision('r2'))
  })

  it('waits for the displayed configuration to catch up before accepting a stale result revision', async () => {
    vi.mocked(props.edit).mockResolvedValueOnce({ status: 'stale', snapshot: snapshot('r2', 2) })
    await click('Edit'); await click('Save', dialog())
    expect(button('I reviewed the current configuration', dialog()).disabled).toBe(true)
    await click('I reviewed the current configuration', dialog())
    expect(button('Save', dialog()).disabled).toBe(true)
    config = snapshot('r2', 2); catalog = [{ ...catalog[0]!, keys: ['Ctrl', 'J'] }]; await render()
    expect(dialog().textContent).toContain('Current shortcut: Ctrl J')
    await click('I reviewed the current configuration', dialog())
    expect(button('Retry save', dialog()).disabled).toBe(false)
    await click('Retry save', dialog())
    expect(props.edit).toHaveBeenLastCalledWith({ type: 'set', id: id('app.find'), binding }, revision('r2'))
  })

  it('invalidates review when the live configuration changes again', async () => {
    await click('Edit')
    config = snapshot('r2', 2); await render()
    await click('I reviewed the current configuration', dialog())
    config = snapshot('r3', 3); await render()
    expect(button('Retry save', dialog()).disabled).toBe(true)
    expect(props.edit).not.toHaveBeenCalled()
  })

  it.each(['invalid', 'future', 'read'] as const)('disables every edit for %s configuration without hiding rows', async error => {
    config = { ...config, status: 'unreadable', error }; await render()
    for (const label of ['Edit', 'Clear', 'Reset', 'Reset all shortcuts']) expect(button(label).disabled).toBe(true)
    expect(container.textContent).toContain('Find')
    expect(container.textContent).toContain('Editing is disabled')
  })

  it('retains drafts on write and thrown failures and reports returned conflict names', async () => {
    vi.mocked(props.edit).mockResolvedValueOnce({ status: 'write-failed', snapshot: config })
      .mockRejectedValueOnce(new Error('disk offline'))
      .mockResolvedValueOnce({ status: 'conflict', snapshot: config, conflicts: [id('input.escape')], issue: 'reserved' })
    await begin(); await press('KeyQ', { ctrlKey: true })
    await click('Save', dialog()); expect(dialog().textContent).toContain('Your draft is preserved')
    await click('Save', dialog()); expect(dialog().textContent).toContain('disk offline')
    await click('Save', dialog()); expect(dialog().textContent).toContain('Conflicts with: Cancel input')
    expect(dialog().textContent).toContain('control KeyQ')
  })

  it('clears and resets one row directly but asks for reset-all confirmation', async () => {
    await click('Clear'); expect(props.edit).toHaveBeenLastCalledWith({ type: 'set', id: id('app.find'), binding: null }, revision('r1'))
    await click('Reset'); expect(props.edit).toHaveBeenLastCalledWith({ type: 'reset', id: id('app.find') }, revision('r1'))
    await click('Reset all shortcuts'); expect(props.edit).toHaveBeenCalledTimes(2)
    expect(dialog().textContent).toContain('Reset every customized shortcut')
    await click('Cancel', dialog()); expect(props.edit).toHaveBeenCalledTimes(2)
    await click('Reset all shortcuts'); await click('Reset all shortcuts', dialog())
    expect(props.edit).toHaveBeenLastCalledWith({ type: 'reset-all' }, revision('r1'))
  })

  it('keeps recording exclusive during StrictMode replay and waits for release before restoring focus', async () => {
    const acquired = deferred()
    const released = deferred()
    let nativeActive = false
    vi.mocked(props.recording).mockImplementation(async active => {
      await (active ? acquired.promise : released.promise)
      nativeActive = active
    })
    await act(async () => root.render(<React.StrictMode><ShortcutsSettings {...props} /></React.StrictMode>))
    await begin()
    expect(button('Save', dialog()).disabled).toBe(true)
    await act(async () => acquired.resolve())
    expect(nativeActive).toBe(true)
    expect(button('Record shortcut', dialog()).disabled).toBe(true)
    expect(button('Save', dialog()).disabled).toBe(true)
    await press('KeyQ', { ctrlKey: true })
    expect(button('Save', dialog()).disabled).toBe(true)
    await act(async () => released.resolve())
    expect(nativeActive).toBe(false)
    expect(button('Save', dialog()).disabled).toBe(false)
    expect(document.activeElement).toBe(button('Record shortcut', dialog()))
  })

  it('serializes a late acquisition and cleanup before starting its replacement effect', async () => {
    const first = deferred()
    const release = deferred()
    let nativeActive = false
    vi.mocked(props.recording).mockImplementationOnce(async () => { await first.promise; nativeActive = true })
      .mockImplementationOnce(async () => { await release.promise; nativeActive = false })
      .mockImplementation(async active => { nativeActive = active })
    await begin()
    props.locale = 'zh'; await render()
    expect(props.recording).toHaveBeenCalledTimes(1)
    await act(async () => first.resolve())
    expect(props.recording).toHaveBeenNthCalledWith(2, false)
    expect(props.recording).toHaveBeenCalledTimes(2)
    expect(button('保存', dialog()).disabled).toBe(true)
    await act(async () => release.resolve())
    expect(props.recording).toHaveBeenNthCalledWith(3, true)
    expect(nativeActive).toBe(true)
    expect(button('录制快捷键', dialog()).disabled).toBe(true)
    await press('KeyQ', { ctrlKey: true })
    expect(nativeActive).toBe(false)
    expect(button('保存', dialog()).disabled).toBe(false)
  })

  it('releases a late recording grant after unmount and never accepts a key early', async () => {
    const pending = deferred()
    vi.mocked(props.recording).mockImplementation(active => active ? pending.promise : Promise.resolve())
    await begin(); await act(async () => root.unmount()); unmounted = true
    await act(async () => pending.resolve())
    expect(props.recording).toHaveBeenNthCalledWith(2, false)
    expect(props.edit).not.toHaveBeenCalled()
  })

  it('reports recording acquisition and release failures explicitly and preserves the draft', async () => {
    vi.mocked(props.recording).mockRejectedValueOnce(new Error('native refused'))
    await begin()
    expect(dialog().textContent).toContain('Keyboard recording could not start: native refused')
    expect(props.recording).toHaveBeenLastCalledWith(false)
    vi.mocked(props.recording).mockImplementation(async active => { if (!active) throw new Error('bridge offline') })
    await click('Record shortcut', dialog()); await press('KeyQ', { ctrlKey: true })
    expect(dialog().textContent).toContain('Keyboard recording could not be released: bridge offline')
    expect(dialog().textContent).toContain('control KeyQ')
  })

  it('uses Chinese copy for settings and recording', async () => {
    props.locale = 'zh'; await render(); await click('改键'); await click('录制快捷键', dialog())
    expect(dialog().textContent).toContain('请按下物理组合键')
    await press('Escape'); expect(button('保存', dialog())).toBeTruthy()
  })
})
