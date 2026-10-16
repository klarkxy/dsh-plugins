// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedBinding } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import { fixedDispatchIssue, installFixedDispatcher, type FixedDispatchMapping } from './fixed-dispatch.ts'

const binding = (code: string, modifiers: NormalizedBinding['modifiers'] = [], secondCode?: string): NormalizedBinding => ({ code, modifiers, ...(secondCode ? { secondCode } : {}) })
const mapping = (id: string, original: NormalizedBinding[], bindings: (NormalizedBinding | null)[], group: FixedDispatchMapping['group'] = 'input'): FixedDispatchMapping => ({ id, original: { bindings: original }, bindings, group, modified: true })
const releases: (() => void)[] = []
afterEach(() => { releases.splice(0).forEach(dispose => dispose()); document.body.replaceChildren(); vi.useRealTimers() })
function setup(rows: FixedDispatchMapping[], recording = () => false) {
  const errors = vi.fn()
  releases.push(installFixedDispatcher({ window, getMappings: () => rows, isRecording: recording, onError: errors }))
  return errors
}
function composer() {
  document.body.innerHTML = '<section data-conversation-session="one"><main data-conversation-region><div data-composer-card><div tabindex="0" contenteditable="true" data-composer-input data-lexical-editor="true">draft</div></div></main></section>'
  const root = document.querySelector('[data-composer-input]') as HTMLElement
  root.focus()
  const range = document.createRange(); range.selectNodeContents(root); range.collapse(false)
  document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range)
  return root
}
function key(target: Element, code: string, extra: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { code, key: code, bubbles: true, cancelable: true, ...extra })
  target.dispatchEvent(event)
  return event
}
function listen(target: EventTarget, callback: EventListener, type = 'keydown') {
  target.addEventListener(type, callback)
  releases.push(() => target.removeEventListener(type, callback))
}

describe('owner-preserving fixed dispatcher', () => {
  it('exposes a save preflight for unsupported owners and changed native signatures', () => {
    expect(fixedDispatchIssue(mapping('fixed.send', [binding('Enter')], [binding('KeyS')]))).toBeNull()
    expect(fixedDispatchIssue(mapping('custom.send', [binding('Enter')], [binding('KeyS')]))).toContain('No verified adapter')
    expect(fixedDispatchIssue(mapping('fixed.send', [binding('Space')], [binding('KeyS')]))).toContain('No verified adapter')
    expect(fixedDispatchIssue(mapping('fixed.send', [binding('Enter')], [binding('KeyS')], 'application'))).toContain('No verified adapter')
  })
  it('rewrites the current event before the original submit owner, and disables only the old composer key', () => {
    const root = composer()
    const errors = setup([mapping('fixed.send', [binding('Enter')], [binding('KeyS', ['alt'])])])
    const calls: KeyboardEvent[] = []
    listen(root, event => { const e = event as KeyboardEvent; calls.push(e); if (e.key === 'Enter') e.preventDefault() })
    const event = key(root, 'KeyS', { key: 's', altKey: true })
    expect(calls).toEqual([event]); expect(event.key).toBe('Enter'); expect(event.code).toBe('Enter'); expect(event.altKey).toBe(false)
    expect(event.getModifierState('Alt')).toBe(false); expect(event.keyCode).toBe(13); expect(event.defaultPrevented).toBe(true)
    key(root, 'Enter'); expect(calls).toHaveLength(1)
    const outside = document.createElement('input'); document.body.append(outside); outside.focus()
    expect(key(outside, 'Enter').defaultPrevented).toBe(false)
    expect(errors).not.toHaveBeenCalled()
  })
  it('keeps complementary Control and Meta slots distinct and does not call a public send API', () => {
    const root = composer()
    setup([mapping('fixed.complementary', [binding('Enter', ['control']), binding('Enter', ['meta'])], [binding('KeyS', ['control']), null])])
    const received: string[] = []
    listen(root, event => { const e = event as KeyboardEvent; received.push(`${e.key}:${e.ctrlKey}:${e.metaKey}`); e.preventDefault() })
    key(root, 'KeyS', { ctrlKey: true }); key(root, 'Enter', { metaKey: true }); key(root, 'Enter', { ctrlKey: true })
    expect(received).toEqual(['Enter:true:false'])
  })
  it.each([['fixed.newline', binding('Enter', ['shift']), 'insertLineBreak', null], ['fixed.slash', binding('Slash'), 'insertReplacementText', '/'], ['fixed.mention', binding('Digit2', ['shift']), 'insertReplacementText', '@']] as const)('uses acknowledged controlled editing for %s', (id, original, inputType, data) => {
    const root = composer()
    const errors = setup([mapping(id, [original], [binding('KeyI', ['alt'])])])
    const before = vi.fn((event: Event) => { const input = event as InputEvent; expect(input.inputType).toBe(inputType); expect(input.data).toBe(data); event.preventDefault() })
    listen(root, before, 'beforeinput')
    const originalEvent = key(root, 'KeyI', { altKey: true })
    expect(before).toHaveBeenCalledOnce(); expect(originalEvent.defaultPrevented).toBe(true); expect(errors).not.toHaveBeenCalled()
  })
  it('reports an unacknowledged editor operation and never manually mutates the DOM', () => {
    const root = composer(); const errors = setup([mapping('fixed.slash', [binding('Slash')], [binding('KeyI', ['alt'])])])
    key(root, 'KeyI', { altKey: true })
    expect(root.textContent).toBe('draft'); expect(errors.mock.calls[0]?.[0].message).toContain('did not accept')
  })
  it('blocks escaped selection and ignores readonly/composing editors', () => {
    const root = composer(); const errors = setup([mapping('fixed.send', [binding('Enter')], [binding('KeyS', ['alt'])])])
    document.getSelection()!.removeAllRanges()
    expect(key(root, 'KeyS', { altKey: true }).defaultPrevented).toBe(true)
    expect(errors.mock.calls[0]?.[0].message).toContain('selection')
    root.setAttribute('contenteditable', 'false')
    expect(key(root, 'KeyS', { altKey: true }).defaultPrevented).toBe(false)
    root.setAttribute('contenteditable', 'true'); root.setAttribute('data-composer-composing', '')
    expect(key(root, 'KeyS', { altKey: true }).defaultPrevented).toBe(false)
  })
  it('preserves repeat, IME key229, composition tail, AltGraph and recording protection', () => {
    vi.useFakeTimers(); const root = composer(); let recording = false
    setup([mapping('fixed.send', [binding('Enter')], [binding('KeyS', ['alt'])])], () => recording)
    const owner = vi.fn((event: Event) => { if ((event as KeyboardEvent).key === 'Enter') event.preventDefault() }); listen(root, owner)
    key(root, 'KeyS', { altKey: true, repeat: true }); expect(owner).not.toHaveBeenCalled()
    key(root, 'KeyS', { altKey: true, isComposing: true })
    key(root, 'KeyS', { altKey: true, keyCode: 229 })
    root.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    key(root, 'KeyS', { altKey: true }); vi.advanceTimersByTime(10)
    recording = true; key(root, 'KeyS', { altKey: true }); recording = false
    expect(owner.mock.calls.every(([event]) => (event as KeyboardEvent).key !== 'Enter')).toBe(true)
    owner.mockClear(); key(root, 'KeyS', { altKey: true }); expect((owner.mock.calls[0]?.[0] as KeyboardEvent).key).toBe('Enter')
  })
  it('respects top dialogs and other composer trigger menus', () => {
    const root = composer(); setup([mapping('fixed.send', [binding('Enter')], [binding('KeyS', ['alt'])])])
    const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); document.body.append(dialog)
    expect(key(root, 'KeyS', { altKey: true }).code).toBe('KeyS'); dialog.remove()
    const menu = document.createElement('div'); menu.setAttribute('data-trigger-menu', ''); root.parentElement!.append(menu)
    expect(key(root, 'KeyS', { altKey: true }).code).toBe('KeyS')
  })
  it('routes input-trigger arrows and selection through the composer handler before send', () => {
    const root = composer(); const menu = document.createElement('div'); menu.setAttribute('data-trigger-menu', ''); root.parentElement!.append(menu)
    setup([mapping('fixed.move', [binding('ArrowUp'), binding('ArrowDown')], [binding('KeyK', ['alt']), binding('KeyJ', ['alt'])], 'menus'), mapping('fixed.select', [binding('Enter')], [binding('KeyS', ['alt'])], 'menus'), mapping('fixed.send', [binding('Enter')], [binding('KeyS', ['alt'])])])
    const calls: string[] = []; listen(root, event => { calls.push((event as KeyboardEvent).key); event.preventDefault() })
    key(root, 'KeyK', { altKey: true }); key(root, 'KeyJ', { altKey: true }); key(root, 'KeyS', { altKey: true })
    expect(calls).toEqual(['ArrowUp', 'ArrowDown', 'Enter'])
  })
  it('activates only the focused enabled native menu button, and remaps dialog dismissal', () => {
    document.body.innerHTML = '<div role="menu"><button role="menuitem">Owner action</button></div>'
    const button = document.querySelector('button')!; button.focus()
    setup([mapping('fixed.select', [binding('Enter')], [binding('KeyS', ['alt'])], 'menus'), mapping('fixed.dismiss', [binding('Escape')], [binding('KeyD', ['alt'])], 'menus')])
    const action = vi.fn(); listen(button, action, 'click'); key(button, 'KeyS', { altKey: true }); expect(action).toHaveBeenCalledOnce()
    document.body.innerHTML = '<div role="dialog" aria-modal="true"><input></div>'; const input = document.querySelector('input')!; input.focus()
    listen(document, event => { if ((event as KeyboardEvent).key === 'Escape') event.preventDefault() })
    expect(key(input, 'KeyD', { altKey: true }).key).toBe('Escape')
  })
  it('requires approval focus, preserves its editable/button exclusions, and prioritizes menus', () => {
    document.body.innerHTML = '<div data-approval-key="one"><div tabindex="0" role="group"></div><input><button>Allow</button></div><div tabindex="0" id="outside"></div>'
    setup([mapping('approval.allow', [binding('Enter')], [binding('KeyA', ['alt'])], 'approval'), mapping('approval.reject', [binding('Escape')], [binding('KeyR', ['alt'])], 'approval')])
    const group = document.querySelector('[role="group"]') as HTMLElement; group.focus()
    listen(group.parentElement!, event => { if (['Enter', 'Escape'].includes((event as KeyboardEvent).key)) event.preventDefault() })
    expect(key(group, 'KeyR', { altKey: true }).key).toBe('Escape')
    const input = document.querySelector('input')!; input.focus(); expect(key(input, 'KeyR', { altKey: true }).key).toBe('KeyR')
    const button = document.querySelector('button')!; button.focus(); expect(key(button, 'KeyA', { altKey: true }).key).toBe('KeyA')
    const outside = document.querySelector('#outside') as HTMLElement; outside.focus(); expect(key(outside, 'KeyR', { altKey: true }).key).toBe('KeyR')
  })
  it('leaves response.stop double-press semantics with the original observer', () => {
    const root = composer(); let presses = 0; const cancel = vi.fn()
    // Native window observer is installed before the plugin.
    listen(window, event => { const e = event as KeyboardEvent; if (e.code === 'Escape') { e.preventDefault(); if (++presses === 2) cancel() } })
    setup([mapping('response.stop', [binding('Escape')], [binding('F8')])])
    key(root, 'F8'); expect(cancel).not.toHaveBeenCalled()
    key(root, 'F8'); expect(cancel).toHaveBeenCalledOnce()
    key(root, 'Escape'); expect(presses).toBe(2)
  })
  it('rejects modified stop chords that the native sequence would reset between presses', () => {
    const root = composer()
    const row = mapping('response.stop', [binding('Escape')], [binding('KeyQ', ['alt'])])
    expect(fixedDispatchIssue(row)).toContain('without modifiers')
    expect(fixedDispatchIssue(mapping('response.stop', [binding('Escape')], [binding('KeyQ', [], 'KeyW')]))).toContain('second key')
    const errors = setup([row])
    expect(key(root, 'KeyQ', { altKey: true }).code).toBe('KeyQ')
    expect(key(root, 'Escape').defaultPrevented).toBe(false)
    expect(errors).toHaveBeenCalledOnce()
  })
  it('reports unknown catalog or conflicting rows and preserves native behavior', () => {
    const root = composer(); const errors = setup([mapping('fixed.unknown', [binding('Enter')], [binding('KeyS', ['alt'])]), { ...mapping('fixed.send', [binding('Enter')], [binding('KeyS', ['alt'])]), conflicts: ['other'] }])
    expect(key(root, 'Enter').defaultPrevented).toBe(false)
    expect(errors).toHaveBeenCalledTimes(2)
    expect(key(root, 'KeyS', { altKey: true }).code).toBe('KeyS')
  })
  it('supports a two-key chord without leaking its printable prefix and releases all listeners', () => {
    const root = composer(); const errors = setup([mapping('fixed.send', [binding('Enter')], [binding('KeyJ', [], 'KeyK')])])
    const owner = vi.fn((event: Event) => { event.preventDefault() }); listen(root, owner)
    expect(key(root, 'KeyJ').defaultPrevented).toBe(true); expect(owner).not.toHaveBeenCalled()
    expect(key(root, 'KeyK').key).toBe('Enter'); expect(owner).toHaveBeenCalledOnce()
    releases[0]!(); owner.mockClear(); expect(key(root, 'KeyJ').code).toBe('KeyJ'); expect(owner).toHaveBeenCalledOnce()
    expect(errors).not.toHaveBeenCalled()
  })
  it('does not steal a dead-key continuation or AltGraph character', () => {
    const root = composer(); setup([mapping('fixed.send', [binding('Enter')], [binding('KeyS', ['alt'])])])
    listen(root, event => { if ((event as KeyboardEvent).key === 'Enter') event.preventDefault() })
    key(root, 'Quote', { key: 'Dead' })
    expect(key(root, 'KeyS', { altKey: true }).code).toBe('KeyS')
    const altGraph = new KeyboardEvent('keydown', { code: 'KeyS', altKey: true, bubbles: true, cancelable: true })
    Object.defineProperty(altGraph, 'getModifierState', { value: (name: string) => name === 'AltGraph' })
    root.dispatchEvent(altGraph); expect(altGraph.code).toBe('KeyS')
    expect(key(root, 'KeyS', { altKey: true }).code).toBe('Enter')
  })
  it('does not operate an older menu beneath a foreground dialog', () => {
    document.body.innerHTML = '<div role="menu"><button role="menuitem">Old</button></div><div role="dialog" aria-modal="true"></div>'
    const button = document.querySelector('button')!; button.focus()
    setup([mapping('fixed.select', [binding('Enter')], [binding('KeyS', ['alt'])], 'menus')])
    const click = vi.fn(); listen(button, click, 'click')
    expect(key(button, 'KeyS', { altKey: true }).code).toBe('KeyS'); expect(click).not.toHaveBeenCalled()
  })
  it('supports swapping send and newline without old-key suppression shadowing new bindings', () => {
    const root = composer(); setup([mapping('fixed.send', [binding('Enter')], [binding('Enter', ['shift'])]), mapping('fixed.newline', [binding('Enter', ['shift'])], [binding('Enter')])])
    const send = vi.fn(); const newline = vi.fn()
    listen(root, event => { if ((event as KeyboardEvent).key === 'Enter') { send(); event.preventDefault() } })
    listen(root, event => { newline(); event.preventDefault() }, 'beforeinput')
    key(root, 'Enter'); key(root, 'Enter', { shiftKey: true })
    expect(newline).toHaveBeenCalledOnce(); expect(send).toHaveBeenCalledOnce()
  })
  it('reports an unhandled adapted key and cancels its physical default', () => {
    const root = composer(); const errors = setup([mapping('fixed.send', [binding('Enter')], [binding('KeyS', ['alt'])])])
    expect(key(root, 'KeyS', { altKey: true }).defaultPrevented).toBe(true)
    expect(errors.mock.calls[0]?.[0].message).toContain('did not consume')
  })
})
