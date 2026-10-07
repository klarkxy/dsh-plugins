import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { ModelMenu } from './ui.tsx'
import { parseModelMenuChoices } from './catalog.ts'

const choices = parseModelMenuChoices({ groups: [{ id: 'p', name: 'Provider', models: [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }] }] })

async function mounted(run: (dom: JSDOM, root: Root) => Promise<void>) {
  const dom = new JSDOM('<!doctype html><body><div id="root"></div><button id="outside">Outside</button></body>')
  const previous = new Map<string, PropertyDescriptor | undefined>()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, Node: dom.window.Node,
    Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  dom.window.HTMLElement.prototype.scrollIntoView = () => {}
  const root = createRoot(dom.window.document.getElementById('root')!)
  try { await run(dom, root) } finally {
    await act(async () => root.unmount())
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
    dom.window.close()
  }
}

function harness(extra: { disabled?: boolean; preventClick?: boolean; ownsClick?: boolean; ownsKey?: boolean; leading?: boolean; efforts?: boolean } = {}) {
  const changes = vi.fn(), picks = vi.fn(), clicked = vi.fn(), keyed = vi.fn()
  function Harness() {
    const [open, setOpen] = useState(false)
    const change = (next: boolean) => { changes(next); setOpen(next) }
    return <ModelMenu open={open} onOpenChange={change} choices={choices} onPick={picks}
      leading={extra.leading ? [{ id: 'follow', label: 'Follow' }] : undefined}
      selected={extra.leading ? { provider: 'p', model: 'one' } : undefined}
      efforts={extra.efforts ? [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] : undefined}
      anchor={<button id="trigger" type="button" disabled={extra.disabled}
        onClick={event => { clicked(); if (extra.preventClick) event.preventDefault(); if (extra.ownsClick) change(!open) }}
        onKeyDown={event => { keyed(event.key); if (extra.ownsKey && event.key === 'Enter') change(true) }}>Pick model</button>} />
  }
  return { Harness, changes, picks, clicked, keyed }
}

describe('mounted ModelMenu interaction', () => {
  it('opens a plain trigger, drills, picks once, dismisses, and restores focus', async () => mounted(async (dom, root) => {
    const { Harness, changes, picks, clicked } = harness()
    await act(async () => root.render(createElement(Harness)))
    const trigger = dom.window.document.getElementById('trigger') as HTMLButtonElement
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    await act(async () => trigger.click())
    expect(clicked).toHaveBeenCalledTimes(1)
    expect(changes.mock.calls).toEqual([[true]])
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(dom.window.document.getElementById(trigger.getAttribute('aria-controls')!)).not.toBeNull()
    const cell = dom.window.document.querySelector<HTMLButtonElement>('[role="menuitem"]')!
    await act(async () => cell.click())
    const row = dom.window.document.querySelector<HTMLButtonElement>('[role="menuitemradio"]')!
    await act(async () => row.click())
    expect(picks.mock.calls).toEqual([[{ provider: 'p', model: 'one' }]])
    expect(changes.mock.calls).toEqual([[true], [false]])
    expect(dom.window.document.querySelector('[role="menu"]')).toBeNull()
    expect(dom.window.document.activeElement).toBe(trigger)
  }))

  it('keeps keyboard focus intent until the measurement-hidden card is placed, including reopen from another pane', async () => mounted(async (dom, root) => {
    const hiddenFocuses: HTMLElement[] = []
    const originalFocus = dom.window.HTMLElement.prototype.focus
    const focus = vi.spyOn(dom.window.HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      // JSDOM normally accepts focus on visibility:hidden descendants. Reject
      // it here as Chromium does for the real MenuSurface measurement card.
      for (let node: HTMLElement | null = this; node; node = node.parentElement) {
        if (node.style.visibility === 'hidden') { hiddenFocuses.push(this); return }
      }
      originalFocus.call(this, options)
    })
    try {
      const { Harness, changes } = harness({ efforts: true })
      await act(async () => root.render(createElement(Harness)))
      const trigger = dom.window.document.getElementById('trigger') as HTMLButtonElement
      await act(async () => trigger.focus())
      await act(async () => trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
      const firstCell = dom.window.document.querySelector<HTMLButtonElement>('[role="menuitem"]')!
      expect(dom.window.document.activeElement).toBe(firstCell)
      expect(hiddenFocuses).toEqual([])
      expect(dom.window.document.querySelector<HTMLElement>('.dsh-model-menu-menu')!.style.visibility).not.toBe('hidden')
      // Native button Enter activation drills this focused root cell. JSDOM
      // lacks that default action, so invoke its click after the key event.
      await act(async () => {
        const enter = new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
        expect(firstCell.dispatchEvent(enter)).toBe(true)
        firstCell.click()
      })
      expect(dom.window.document.activeElement?.getAttribute('role')).toBe('menuitemradio')
      await act(async () => dom.window.document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
      await act(async () => dom.window.document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[1]!.click())
      const high = Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')).find(row => row.textContent === 'High')!
      await act(async () => high.click())
      expect(dom.window.document.activeElement).toBe(trigger)
      await act(async () => trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
      expect(dom.window.document.activeElement).toBe(dom.window.document.querySelector('[role="menuitem"]'))
      expect(hiddenFocuses).toEqual([])
      expect(changes.mock.calls).toEqual([[true], [false], [true]])
    } finally { focus.mockRestore() }
  }))

  it('focuses the hovered model after a leading Follow row and activates that model by keyboard', async () => mounted(async (dom, root) => {
    const { Harness, changes, picks } = harness({ leading: true })
    await act(async () => root.render(createElement(Harness)))
    const trigger = dom.window.document.getElementById('trigger') as HTMLButtonElement
    await act(async () => trigger.click())
    await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click())
    const rows = Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
    expect(rows.map(row => row.textContent)).toEqual(['Follow', 'One', 'Two'])
    expect(dom.window.document.activeElement).toBe(rows[1])
    await act(async () => rows[2]!.dispatchEvent(new dom.window.MouseEvent('mousemove', { bubbles: true })))
    expect(dom.window.document.activeElement).toBe(rows[2])
    expect(rows[2]!.hasAttribute('data-highlighted')).toBe(true)
    // ModelMenu activates a focused option on forward Tab, through its real handler.
    await act(async () => dom.window.document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })))
    expect(picks.mock.calls).toEqual([[{ provider: 'p', model: 'two' }]])
    expect(changes.mock.calls).toEqual([[true], [false]])
    expect(dom.window.document.activeElement).toBe(trigger)
  }))

  it.each([false, true])('waits for an async write to enable the trigger and respects intervening outside focus (%s)', async movedOutside => mounted(async (dom, root) => {
    let complete!: () => void
    const write = new Promise<void>(resolve => { complete = resolve })
    const picks = vi.fn()
    function WritingMenu() {
      const [open, setOpen] = useState(false)
      const [writing, setWriting] = useState(false)
      return <ModelMenu open={open} onOpenChange={setOpen} choices={choices}
        anchor={<button id="trigger" type="button" disabled={writing}>Pick model</button>}
        onPick={route => { picks(route); setWriting(true); void write.then(() => setWriting(false)) }} />
    }
    await act(async () => root.render(createElement(WritingMenu)))
    const trigger = dom.window.document.getElementById('trigger') as HTMLButtonElement
    await act(async () => trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
    const cell = dom.window.document.querySelector<HTMLButtonElement>('[role="menuitem"]')!
    await act(async () => cell.click())
    const row = dom.window.document.activeElement!
    await act(async () => row.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })))
    expect(picks.mock.calls).toEqual([[{ provider: 'p', model: 'one' }]])
    expect(trigger.disabled).toBe(true)
    expect(dom.window.document.querySelector('.dsh-model-menu-menu')).toBeNull()
    expect(dom.window.document.activeElement).toBe(dom.window.document.body)
    const outside = dom.window.document.getElementById('outside') as HTMLButtonElement
    if (movedOutside) {
      await act(async () => outside.focus())
      // Even if that later focus leaves the control again, do not revive the
      // old hand-back intent after the unrelated user interaction.
      outside.blur()
      expect(dom.window.document.activeElement).toBe(dom.window.document.body)
    }
    await act(async () => { complete(); await write })
    expect(trigger.disabled).toBe(false)
    expect(dom.window.document.activeElement).toBe(movedOutside ? dom.window.document.body : trigger)
  }))

  it.each(['Enter', ' ', 'ArrowDown', 'ArrowUp'])('opens a closed trigger with %s and hands focus to the root cell', async key => mounted(async (dom, root) => {
    const { Harness, changes, keyed } = harness()
    await act(async () => root.render(createElement(Harness)))
    const trigger = dom.window.document.getElementById('trigger') as HTMLButtonElement
    trigger.focus()
    const event = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    await act(async () => { expect(trigger.dispatchEvent(event)).toBe(false) })
    expect(keyed).toHaveBeenCalledWith(key)
    expect(changes.mock.calls).toEqual([[true]])
    expect(dom.window.document.activeElement?.getAttribute('role')).toBe('menuitem')
    await act(async () => dom.window.document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(changes.mock.calls).toEqual([[true], [false]])
    expect(dom.window.document.activeElement).toBe(trigger)
  }))

  it('preserves existing controlled click and keyboard handlers without duplicate open callbacks', async () => mounted(async (dom, root) => {
    const { Harness, changes, clicked } = harness({ ownsClick: true, ownsKey: true })
    await act(async () => root.render(createElement(Harness)))
    const trigger = dom.window.document.getElementById('trigger') as HTMLButtonElement
    await act(async () => trigger.click())
    expect(clicked).toHaveBeenCalledTimes(1)
    expect(changes.mock.calls).toEqual([[true]])
    await act(async () => trigger.click())
    expect(changes.mock.calls).toEqual([[true], [false]])
    await act(async () => trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
    expect(changes.mock.calls).toEqual([[true], [false], [true]])
  }))

  it('honors prevented and disabled triggers and removes outside-dismiss listeners on unload', async () => mounted(async (dom, root) => {
    const prevented = harness({ preventClick: true })
    await act(async () => root.render(createElement(prevented.Harness)))
    await act(async () => (dom.window.document.getElementById('trigger') as HTMLButtonElement).click())
    expect(prevented.changes).not.toHaveBeenCalled()
    const disabled = harness({ disabled: true })
    await act(async () => root.render(createElement(disabled.Harness)))
    const trigger = dom.window.document.getElementById('trigger') as HTMLButtonElement
    await act(async () => { trigger.click(); trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })) })
    expect(disabled.changes).not.toHaveBeenCalled()
    const active = harness()
    await act(async () => root.render(createElement(active.Harness)))
    await act(async () => (dom.window.document.getElementById('trigger') as HTMLButtonElement).click())
    const outside = dom.window.document.getElementById('outside')!
    await act(async () => outside.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true })))
    expect(active.changes.mock.calls).toEqual([[true], [false]])
    await act(async () => root.unmount())
    outside.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }))
    expect(active.changes).toHaveBeenCalledTimes(2)
  }))
})
