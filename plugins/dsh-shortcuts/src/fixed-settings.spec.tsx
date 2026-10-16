// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShortcutFixedCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { NormalizedBinding } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import type { EffectiveFixedRow, FixedBindingsSnapshot, FixedSaveResult } from './fixed-bindings.ts'
import { FixedSettings, type FixedSettingsProps } from './fixed-settings.tsx'

const id = (value: string) => value as ShortcutFixedCatalogEntry['id']
const key = (code: string): NormalizedBinding => ({ code, modifiers: [] })
const row = (name = 'fixed.complementary', bindings: NormalizedBinding[] = [{ code: 'Enter', modifiers: ['control'] }, { code: 'Enter', modifiers: ['meta'] }]): EffectiveFixedRow => {
  const original: ShortcutFixedCatalogEntry = { id: id(name), label: name === 'response.stop' ? 'Stop response' : 'Send message', group: 'input', keys: name === 'response.stop' ? ['Escape'] : ['Ctrl', 'Enter', '/', 'Meta', 'Enter'], bindings }
  return { ...original, original, bindings, override: undefined, modified: false, scope: 'composer', conflicts: [], bindingKeys: bindings.map(binding => [...binding.modifiers, binding.code]) }
}
let root: Root
let container: HTMLDivElement
let state: FixedBindingsSnapshot
let props: FixedSettingsProps
let unmounted: boolean
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
const button = (label: string, scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label)!
const click = async (label: string, scope: ParentNode = document) => {
  const node = button(label, scope); expect(node, `Button ${label} exists`).toBeTruthy()
  await act(async () => { node.click() })
}
const render = async () => { await act(async () => root.render(<FixedSettings {...props} />)) }
const slot = (index: number) => container.querySelector(`[data-binding-slot="${index}"]`)!
const press = async (code: string, options: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { code, key: code, bubbles: true, cancelable: true, ...options })
  await act(async () => { document.dispatchEvent(event) })
  return event
}
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
const begin = async (index = 0) => { await click('Edit', slot(index)); await click('Record shortcut', dialog()) }
const result = (status: FixedSaveResult['status'], snapshot = state): FixedSaveResult => ({ ok: status === 'saved', status, snapshot })

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container); unmounted = false
  state = { revision: 'r1', rows: [row()], error: null }
  props = { locale: 'en', useFixedBindings: selector => selector(state), recording: vi.fn(async () => {}), model: {
    setSlot: vi.fn(() => result('saved')), clear: vi.fn(() => result('saved')), reset: vi.fn(() => result('saved')),
    resetSlot: vi.fn(() => result('saved')), resetAll: vi.fn(() => result('saved')),
    describeSlot: vi.fn((_id, _slot, binding) => ({ keys: binding ? [...binding.modifiers, binding.code] : [], issue: null, conflicts: [] })),
  } }
  await render()
})
afterEach(async () => {
  if (!unmounted) await act(async () => root.unmount())
  container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})

describe('FixedSettings', () => {
  it('shows each original/effective slot and lets all catalog actions be edited', async () => {
    state = { ...state, rows: [{ ...row(), bindings: [null, key('KeyJ')], bindingKeys: [[], ['J']], modified: true }, row('response.stop', [key('Escape')])] }
    await render()
    expect(container.querySelectorAll('[data-command-id]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-binding-slot]')).toHaveLength(3)
    expect(slot(0).textContent).toContain('Original key: control + Enter')
    expect(slot(0).textContent).toContain('Effective key: Unbound')
    expect(slot(1).textContent).toContain('Original key: meta + Enter')
    expect(slot(1).textContent).toContain('Effective key: J')
    expect(container.textContent).toContain('Press the effective key twice in succession')
    expect(container.textContent).not.toContain('Read only')
    for (const action of container.querySelectorAll('[data-command-id]')) expect(button('Edit', action).disabled).toBe(false)
  })

  it.each([
    ['fixed.send', 'input', [key('Enter')]],
    ['fixed.newline', 'input', [{ code: 'Enter', modifiers: ['shift'] }]],
    ['fixed.complementary', 'input', [{ code: 'Enter', modifiers: ['control'] }, { code: 'Enter', modifiers: ['meta'] }]],
    ['fixed.slash', 'input', [key('Slash')]],
    ['fixed.mention', 'input', [{ code: 'Digit2', modifiers: ['shift'] }]],
    ['fixed.move', 'menus', [key('ArrowUp'), key('ArrowDown')]],
    ['fixed.select', 'menus', [key('Enter')]],
    ['fixed.dismiss', 'menus', [key('Escape')]],
    ['approval.allow', 'approval', [key('Enter')]],
    ['approval.reject', 'approval', [key('Escape')]],
    ['response.stop', 'input', [key('Escape')]],
  ] satisfies [string, ShortcutFixedCatalogEntry['group'], NormalizedBinding[]][])('allows every original slot of native %s to be changed', async (name, group, bindings) => {
    const action = row(name, bindings)
    state = { ...state, rows: [{ ...action, group, original: { ...action.original, group } }] }; await render()
    expect(container.textContent).not.toContain('Editing unavailable')
    for (let index = 0; index < bindings.length; index++) {
      expect(button('Edit', slot(index)).disabled).toBe(false)
      expect(button('Unbind', slot(index)).disabled).toBe(false)
      expect(button('Restore', slot(index)).disabled).toBe(false)
      await begin(index); await press('F8'); await click('Save', dialog())
      expect(props.model.setSlot).toHaveBeenLastCalledWith(name, index, key('F8'), 'r1')
    }
  })

  it.each([
    ['unknown.action', [key('Enter')]],
    ['fixed.send', [key('Space')]],
  ] as const)('blocks editing %s without a verified original signature but allows recovery', async (name, bindings) => {
    state = { ...state, rows: [row(name, [...bindings])] }; await render()
    expect(container.textContent).toContain('This action or its original keys changed')
    expect(container.textContent).toContain('Editing unavailable')
    expect(button('Edit', slot(0)).disabled).toBe(true)
    expect(button('Unbind', slot(0)).disabled).toBe(true)
    expect(button('Restore', slot(0)).disabled).toBe(false)
    expect(button('Restore action defaults').disabled).toBe(false)
    await click('Edit', slot(0)); await click('Unbind', slot(0))
    expect(props.model.setSlot).not.toHaveBeenCalled()
    await click('Restore', slot(0)); expect(props.model.resetSlot).toHaveBeenCalledWith(name, 0, 'r1')
    await click('Restore action defaults'); expect(props.model.reset).toHaveBeenCalledWith(name, 'r1')
  })

  it('blocks a pending draft when the catalog signature changes and preserves it for review', async () => {
    await begin(); await press('KeyQ')
    state = { ...state, revision: 'r2', rows: [row('fixed.complementary', [key('Space')])] }; await render()
    expect(dialog().textContent).toContain('Your draft: KeyQ')
    expect(dialog().textContent).toContain('This action or its original keys changed')
    await click('I reviewed the current configuration', dialog())
    expect(button('Retry save', dialog()).disabled).toBe(true)
    expect(button('Record shortcut', dialog()).disabled).toBe(true)
    expect(props.model.setSlot).not.toHaveBeenCalled()
  })

  it('preflights stop drafts even when model preview accepts modifier chords', async () => {
    state = { ...state, rows: [row('response.stop', [key('Escape')])] }; await render()
    expect(container.textContent).toContain('Choose one key without modifiers (for example F8)')
    await begin(); await press('KeyQ', { altKey: true })
    expect(dialog().textContent).toContain('Your draft: alt KeyQ')
    expect(button('Save', dialog()).disabled).toBe(true)
    expect(props.model.setSlot).not.toHaveBeenCalled()
    await click('Record shortcut', dialog()); await press('F8')
    expect(button('Save', dialog()).disabled).toBe(false)
    await click('Save', dialog())
    expect(props.model.setSlot).toHaveBeenCalledWith('response.stop', 0, key('F8'), 'r1')
  })

  it('shows recovery for a stored stop chord that cannot preserve double-press behavior', async () => {
    const stop = row('response.stop', [key('Escape')])
    state = { ...state, rows: [{ ...stop, modified: true, bindings: [{ code: 'KeyQ', modifiers: ['alt'] }], bindingKeys: [['Alt', 'Q']] }] }
    props.locale = 'zh'; await render()
    expect(container.textContent).toContain('只能选择不带修饰键的单键（例如 F8）')
    expect(button('改键', slot(0)).disabled).toBe(true)
    expect(button('解绑', slot(0)).disabled).toBe(true)
    expect(button('恢复', slot(0)).disabled).toBe(false)
    expect(button('恢复此动作默认键').disabled).toBe(false)
  })

  it('searches both original and effective keys, labels, and IDs', async () => {
    state = { ...state, rows: [{ ...row(), bindings: [key('KeyQ'), null], bindingKeys: [['Q'], []] }, row('response.stop', [key('Escape')])] }
    for (const query of ['Q', 'Ctrl+Enter', 'Send message', 'fixed.complementary']) {
      props.query = query; await render()
      expect(container.querySelector('[data-command-id="fixed.complementary"]')).not.toBeNull()
      expect(container.querySelector('[data-command-id="response.stop"]')).toBeNull()
      expect(container.querySelector('input')).toBeNull()
    }
    props.query = undefined; await render()
    const search = container.querySelector('input')!
    await act(async () => { search.value = 'no matches'; Simulate.change(search) })
    expect(container.textContent).toContain('No matching additional shortcuts.')
  })

  it('changes one slot without replacing the others and can record Escape', async () => {
    await begin(1)
    expect(props.recording).toHaveBeenLastCalledWith(true)
    const event = await press('Escape')
    expect(event.defaultPrevented).toBe(true)
    expect(dialog().textContent).toContain('Your draft: Escape')
    expect(props.recording).toHaveBeenLastCalledWith(false)
    await click('Save', dialog())
    expect(props.model.setSlot).toHaveBeenCalledWith('fixed.complementary', 1, key('Escape'), 'r1')
    expect(dialog()).toBeNull()
  })

  it('unbinds and restores individual slots and separately restores an action', async () => {
    await click('Unbind', slot(1))
    expect(props.model.setSlot).toHaveBeenCalledWith('fixed.complementary', 1, null, 'r1')
    await click('Restore', slot(0))
    expect(props.model.resetSlot).toHaveBeenCalledWith('fixed.complementary', 0, 'r1')
    await click('Restore action defaults')
    expect(props.model.reset).toHaveBeenCalledWith('fixed.complementary', 'r1')
    expect(props.model.clear).not.toHaveBeenCalled()
  })

  it('requires explicit confirmation for resetting all fixed shortcuts', async () => {
    await click('Reset all additional shortcuts')
    expect(props.model.resetAll).not.toHaveBeenCalled()
    expect(dialog().textContent).toContain('Restore every additional shortcut to its original keys?')
    await click('Cancel', dialog()); expect(props.model.resetAll).not.toHaveBeenCalled()
    await click('Reset all additional shortcuts'); await click('Reset all additional shortcuts', dialog())
    expect(props.model.resetAll).toHaveBeenCalledWith('r1')
  })

  it('retains stale drafts, waits for the live selector, then explicitly reviews and retries', async () => {
    const next: FixedBindingsSnapshot = { revision: 'r2', rows: [{ ...row(), bindingKeys: [['J'], ['control', 'Enter']] }], error: null }
    vi.mocked(props.model.setSlot).mockReturnValueOnce(result('stale', next))
    await begin(); await press('KeyQ'); await click('Save', dialog())
    expect(dialog().textContent).toContain('Your draft: KeyQ')
    expect(dialog().textContent).toContain('Effective key: J')
    expect(button('I reviewed the current configuration', dialog()).disabled).toBe(true)
    expect(button('Save', dialog()).disabled).toBe(true)
    expect(props.model.setSlot).toHaveBeenCalledTimes(1)
    state = next; await render()
    await click('I reviewed the current configuration', dialog())
    expect(props.model.setSlot).toHaveBeenCalledTimes(1)
    await click('Retry save', dialog())
    expect(props.model.setSlot).toHaveBeenLastCalledWith('fixed.complementary', 0, key('KeyQ'), 'r2')
  })

  it('invalidates review if live configuration changes again', async () => {
    await click('Edit', slot(0))
    state = { ...state, revision: 'r2' }; await render()
    await click('I reviewed the current configuration', dialog())
    state = { ...state, revision: 'r3' }; await render()
    expect(button('Retry save', dialog()).disabled).toBe(true)
    expect(props.model.setSlot).not.toHaveBeenCalled()
  })

  it.each(['Invalid fixed shortcut storage', 'Unsupported future fixed shortcut storage schema', 'Storage access denied'])('preserves the draft and disables editing on %s', async error => {
    await begin(); await press('KeyQ')
    state = { ...state, error }; await render()
    expect(dialog().textContent).toContain('Your draft: KeyQ')
    expect(dialog().textContent).toContain(error)
    for (const label of ['Record shortcut', 'Save']) expect(button(label, dialog()).disabled).toBe(true)
    for (const label of ['Edit', 'Unbind', 'Restore', 'Reset all additional shortcuts']) expect(button(label, container).disabled).toBe(true)
  })

  it('shows conflict names and validation while retaining the captured draft', async () => {
    state = { ...state, rows: [...state.rows, row('response.stop', [key('Escape')])] }; await render()
    await begin(); await press('KeyQ')
    props.model.describeSlot = vi.fn(() => ({ keys: ['Q'], issue: null, conflicts: [id('response.stop')] })); await render()
    expect(dialog().textContent).toContain('Conflicts with: Stop response')
    expect(button('Save', dialog()).disabled).toBe(true)
    props.model.describeSlot = vi.fn(() => ({ keys: ['Q'], issue: 'unsupported-key', conflicts: [] })); await render()
    expect(dialog().textContent).toContain('unsupported-key')
    expect(dialog().textContent).toContain('Your draft: Q')
    expect(button('Save', dialog()).disabled).toBe(true)
  })

  it.each(['storage-error', 'invalid', 'conflict', 'disposed'] as const)('preserves drafts after a %s result', async status => {
    vi.mocked(props.model.setSlot).mockReturnValueOnce(result(status))
    await begin(); await press('KeyQ'); await click('Save', dialog())
    expect(dialog().textContent).toContain('Your draft: KeyQ')
    expect(dialog().textContent).toContain('Your draft is preserved')
    expect(props.model.setSlot).toHaveBeenCalledTimes(1)
  })

  it('preserves an unbind draft after a thrown write failure', async () => {
    vi.mocked(props.model.setSlot).mockImplementationOnce(() => { throw new Error('disk offline') })
    await click('Unbind', slot(1))
    expect(dialog().textContent).toContain('disk offline')
    expect(dialog().textContent).toContain('Your draft: Unbound')
    await click('Save', dialog())
    expect(props.model.setSlot).toHaveBeenLastCalledWith('fixed.complementary', 1, null, 'r1')
  })

  it('waits for native acquisition and release and cancels through the explicit button', async () => {
    const acquire = deferred(); const release = deferred()
    vi.mocked(props.recording).mockImplementation(active => active ? acquire.promise : release.promise)
    await begin(); await press('KeyQ')
    expect(dialog().textContent).not.toContain('Your draft: KeyQ')
    expect(button('Save', dialog()).disabled).toBe(true)
    await act(async () => acquire.resolve())
    await click('Cancel recording', dialog())
    expect(props.recording).toHaveBeenLastCalledWith(false)
    expect(button('Save', dialog()).disabled).toBe(true)
    await act(async () => release.resolve())
    expect(button('Save', dialog()).disabled).toBe(false)
    expect(document.activeElement).toBe(button('Record shortcut', dialog()))
  })

  it('releases a late native grant after unmount', async () => {
    const acquire = deferred()
    vi.mocked(props.recording).mockImplementation(active => active ? acquire.promise : Promise.resolve())
    await begin(); await act(async () => root.unmount()); unmounted = true
    await act(async () => acquire.resolve())
    expect(props.recording).toHaveBeenNthCalledWith(1, true)
    expect(props.recording).toHaveBeenNthCalledWith(2, false)
    expect(props.model.setSlot).not.toHaveBeenCalled()
  })

  it('uses a failed result error until the live configuration recovers without changing its revision', async () => {
    const failed = { ...state, error: 'storage blocked' }
    vi.mocked(props.model.setSlot).mockReturnValueOnce({ ...result('storage-error', failed), message: 'storage blocked' })
    await begin(); await press('KeyQ'); await click('Save', dialog())
    expect(button('Save', dialog()).disabled).toBe(true)
    expect(dialog().textContent).toContain('storage blocked')
    state = { ...state, error: null }; await render()
    expect(dialog().textContent).toContain('Your draft: KeyQ')
    expect(button('Save', dialog()).disabled).toBe(false)
    await click('Save', dialog()); expect(props.model.setSlot).toHaveBeenCalledTimes(2)
  })

  it('reports recording acquisition and release failures while retaining the draft', async () => {
    vi.mocked(props.recording).mockRejectedValueOnce(new Error('native refused'))
    await begin()
    expect(dialog().textContent).toContain('native refused')
    expect(props.recording).toHaveBeenLastCalledWith(false)
    vi.mocked(props.recording).mockImplementation(async active => { if (!active) throw new Error('bridge offline') })
    await click('Record shortcut', dialog()); await press('KeyQ')
    expect(dialog().textContent).toContain('bridge offline')
    expect(dialog().textContent).toContain('Your draft: KeyQ')
  })

  it('renders Chinese slot controls, sequence guidance and recording', async () => {
    props.locale = 'zh'; state = { ...state, rows: [row('response.stop', [key('Escape')])] }; await render()
    expect(container.textContent).toContain('原始键')
    expect(container.textContent).toContain('生效键')
    expect(container.textContent).toContain('连续按两次生效键')
    await click('改键', slot(0)); await click('录制快捷键', dialog())
    await press('KeyQ'); expect(dialog().textContent).toContain('你的草稿: KeyQ')
    await click('保存', dialog())
    expect(props.model.setSlot).toHaveBeenCalledWith('response.stop', 0, key('KeyQ'), 'r1')
  })
})
