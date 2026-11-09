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
  it('updates portaled default copy while preserving the open search and selected model', async () => mounted(async (dom, root) => {
    const catalog = parseModelMenuChoices({ groups: [{ id: 'p', models: Array.from({ length: 5 }, (_, index) => ({ id: `model-${index}` })) }] })
    const picks = vi.fn(), changes = vi.fn()
    const render = (locale: string) => root.render(<ModelMenu open locale={locale} onOpenChange={changes}
      choices={catalog} selected={{ provider: 'p', model: 'model-0' }} onPick={picks}
      anchor={<button type="button">Provider</button>} />)
    await act(async () => render('zh-CN'))
    expect(dom.window.document.querySelector('.dsh-model-menu-menu')?.getAttribute('lang')).toBe('zh')
    expect(dom.window.document.querySelector('[role="menuitem"]')?.textContent).toContain('模型')
    await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click())
    const search = dom.window.document.querySelector<HTMLInputElement>('[role="searchbox"]')!
    const { Simulate } = await import('react-dom/test-utils')
    await act(async () => Simulate.change(search, { target: { value: 'missing' } } as never))
    expect(dom.window.document.querySelector('[role="status"]')?.textContent).toBe('没有匹配的模型')
    await act(async () => render('en-US'))
    expect(search.value).toBe('missing')
    expect(search.placeholder).toBe('Search models…')
    expect(dom.window.document.querySelector('[role="status"]')?.textContent).toBe('No matching models')
    expect(dom.window.document.querySelector('[aria-label="Clear search"]')).not.toBeNull()
    expect(picks).not.toHaveBeenCalled()
    expect(changes).not.toHaveBeenCalled()
  }))

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

  it('opens directly at the search-first model pane and matches provider display name and model id', async () => mounted(async (dom, root) => {
    const picks = vi.fn(), effortsPick = vi.fn()
    const catalog = parseModelMenuChoices({ groups: [
      { id: 'acct', name: 'DeepSeek Account', models: Array.from({ length: 5 }, (_, index) => ({ id: `ds-${index}`, name: `DS ${index}` })) },
      { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-5', name: 'GPT-5' }] },
    ] })
    function Picker() {
      const [open, setOpen] = useState(false)
      return <ModelMenu open={open} onOpenChange={setOpen} choices={catalog} onPick={picks}
        initialPane="model" alwaysShowSearch
        anchor={<button id="trigger" type="button">Pick</button>} />
    }
    await act(async () => root.render(createElement(Picker)))
    await act(async () => (dom.window.document.getElementById('trigger') as HTMLButtonElement).click())
    // Search-first: the model pane is shown, not the root Model/Effort cells.
    expect(dom.window.document.querySelector('[role="menuitem"]')).toBeNull()
    const search = dom.window.document.querySelector<HTMLInputElement>('[role="searchbox"]')
    expect(search).not.toBeNull()
    const { Simulate } = await import('react-dom/test-utils')
    const rows = () => Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
    await act(async () => Simulate.change(search!, { target: { value: 'account' } } as never))
    // Provider display name matches every model of that group.
    expect(rows().length).toBe(5)
    await act(async () => Simulate.change(search!, { target: { value: 'OPENAI' } } as never))
    expect(rows().map(row => row.textContent)).toEqual(['GPT-5'])
    // The model id matches too, case-insensitively.
    await act(async () => Simulate.change(search!, { target: { value: 'GPT-5' } } as never))
    expect(rows().map(row => row.textContent)).toEqual(['GPT-5'])
    await act(async () => Simulate.change(search!, { target: { value: 'no-such-model' } } as never))
    expect(dom.window.document.querySelector('[role="status"]')?.textContent).toBe('No matching models')
    expect(picks).not.toHaveBeenCalled()
    expect(effortsPick).not.toHaveBeenCalled()
  }))

  it('forces the search row for a small catalog only when alwaysShowSearch is set', async () => mounted(async (dom, root) => {
    const catalog = parseModelMenuChoices({ groups: [{ id: 'p', name: 'P', models: [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }] }] })
    function Picker({ force }: { force: boolean }) {
      const [open, setOpen] = useState(false)
      return <ModelMenu open={open} onOpenChange={setOpen} choices={catalog} onPick={() => {}}
        initialPane="model" alwaysShowSearch={force}
        anchor={<button id="trigger" type="button">Pick</button>} />
    }
    await act(async () => root.render(createElement(Picker, { force: false })))
    await act(async () => (dom.window.document.getElementById('trigger') as HTMLButtonElement).click())
    expect(dom.window.document.querySelector('[role="menuitemradio"]')).not.toBeNull()
    expect(dom.window.document.querySelector('[role="searchbox"]')).toBeNull()
    await act(async () => root.render(createElement(Picker, { force: true })))
    expect(dom.window.document.querySelector('[role="searchbox"]')).not.toBeNull()
  }))

  it('renders a native discrete effort slider that previews then commits on gesture end', async () => mounted(async (dom, root) => {
    const effortsPick = vi.fn()
    const catalog = parseModelMenuChoices({ groups: [{ id: 'p', name: 'P', models: [{ id: 'm', name: 'M' }] }] })
    function Picker() {
      const [open, setOpen] = useState(false)
      const [effort, setEffort] = useState('high')
      return <ModelMenu open={open} onOpenChange={setOpen} choices={catalog} onPick={() => {}}
        initialPane="model" alwaysShowSearch reasoningSlider
        selected={{ provider: 'p', model: 'm' }}
        efforts={[{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }, { id: 'max', name: 'Max' }]}
        selectedEffort={effort}
        onPickEffort={value => { effortsPick(value); setEffort(value ?? '') }}
        anchor={<button id="trigger" type="button">Pick</button>} />
    }
    await act(async () => root.render(createElement(Picker)))
    await act(async () => (dom.window.document.getElementById('trigger') as HTMLButtonElement).click())
    const slider = dom.window.document.querySelector<HTMLInputElement>('input[type="range"]')!
    expect(slider).not.toBeNull()
    // Default row + exactly the three declared levels — nothing invented.
    expect([slider.min, slider.max, slider.step]).toEqual(['0', '3', '1'])
    expect(slider.value).toBe('2')
    expect(slider.getAttribute('aria-valuetext')).toBe('High')
    // The painted control is drawn from a --_p custom property on the rail; the
    // decorative layers are aria-hidden siblings under the same rail element.
    const rail = slider.closest<HTMLElement>('.dsh-model-menu-sliderRail')!
    expect(rail).not.toBeNull()
    const thumb = dom.window.document.querySelector('.dsh-model-menu-sliderThumb')
    const fillBar = dom.window.document.querySelector('.dsh-model-menu-sliderFillBar')
    expect(thumb).not.toBeNull()
    expect(fillBar).not.toBeNull()
    expect(thumb?.getAttribute('aria-hidden')).toBe('true')
    expect(rail.style.getPropertyValue('--_p')).toBe('67')
    // One stop dot per row — the default row plus the three declared efforts —
    // evenly spread across the thumb-center band; covered stops read light.
    const nodes = () => Array.from(dom.window.document.querySelectorAll<HTMLElement>('.dsh-model-menu-sliderNode'))
    expect(nodes().map(node => node.style.getPropertyValue('--_n'))).toEqual(['0', '33', '67', '100'])
    expect(nodes().map(node => node.hasAttribute('data-covered'))).toEqual([true, true, true, false])
    expect(nodes()[0]!.closest('[aria-hidden]')).toBe(dom.window.document.querySelector('.dsh-model-menu-sliderTrack'))
    const firstNodes = nodes()
    const { Simulate } = await import('react-dom/test-utils')
    // Dragging previews without writing on every step; the same rail/thumb
    // nodes keep animating instead of remounting.
    await act(async () => Simulate.change(slider, { target: { value: '1' } } as never))
    expect(effortsPick).not.toHaveBeenCalled()
    expect(slider.value).toBe('1')
    expect(rail.style.getPropertyValue('--_p')).toBe('33')
    expect(dom.window.document.querySelector('.dsh-model-menu-sliderThumb')).toBe(thumb)
    expect(dom.window.document.querySelector('.dsh-model-menu-sliderFillBar')).toBe(fillBar)
    expect(nodes()).toEqual(firstNodes)
    expect(nodes().map(node => node.hasAttribute('data-covered'))).toEqual([true, true, false, false])
    // Gesture end commits once.
    await act(async () => slider.dispatchEvent(new dom.window.Event('pointerup', { bubbles: true })))
    expect(effortsPick.mock.calls).toEqual([['low']])
    // Keyboard path previews, then commits on key up.
    await act(async () => Simulate.change(slider, { target: { value: '3' } } as never))
    expect(effortsPick).toHaveBeenCalledTimes(1)
    await act(async () => slider.dispatchEvent(new dom.window.KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true })))
    expect(effortsPick).toHaveBeenLastCalledWith('max')
    // The default row commits undefined; the menu stays open.
    await act(async () => Simulate.change(slider, { target: { value: '0' } } as never))
    await act(async () => slider.dispatchEvent(new dom.window.Event('pointerup', { bubbles: true })))
    expect(effortsPick).toHaveBeenLastCalledWith(undefined)
    expect(dom.window.document.querySelector('[role="searchbox"]')).not.toBeNull()
  }))

  it('renders a menuHeader banner inside the menu card, above the search row', async () => mounted(async (dom, root) => {
    const catalog = parseModelMenuChoices({ groups: [{ id: 'p', name: 'P', models: [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }] }] })
    function Picker({ withHeader }: { withHeader: boolean }) {
      const [open, setOpen] = useState(false)
      return <ModelMenu open={open} onOpenChange={setOpen} choices={catalog} onPick={() => {}}
        initialPane="model" alwaysShowSearch
        menuHeader={withHeader ? <span data-testid="hdr">Loading models…</span> : undefined}
        anchor={<button id="trigger" type="button">Pick</button>} />
    }
    await act(async () => root.render(createElement(Picker, { withHeader: false })))
    await act(async () => (dom.window.document.getElementById('trigger') as HTMLButtonElement).click())
    expect(dom.window.document.querySelector('[data-testid="hdr"]')).toBeNull()
    await act(async () => root.render(createElement(Picker, { withHeader: true })))
    const header = dom.window.document.querySelector('[data-testid="hdr"]')!
    expect(header.textContent).toBe('Loading models…')
    const search = dom.window.document.querySelector('[role="searchbox"]')!
    expect(dom.window.document.querySelector('.dsh-model-menu-menu')!.contains(header)).toBe(true)
    // The banner precedes the search row in document order.
    expect(header.compareDocumentPosition(search) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  }))

  it('closes on disable and blocks every action while disabled', async () => mounted(async (dom, root) => {
    const picks = vi.fn(), effortPicks = vi.fn()
    const catalog = parseModelMenuChoices({ groups: [{ id: 'p', name: 'P', models: [{ id: 'one', name: 'One' }] }] })
    function Picker({ disabled }: { disabled: boolean }) {
      const [open, setOpen] = useState(false)
      return <ModelMenu open={open} onOpenChange={setOpen} choices={catalog} onPick={picks} disabled={disabled}
        efforts={[{ id: 'low', name: 'Low' }]} selectedEffort="low" onPickEffort={effortPicks}
        anchor={<button id="trigger" type="button">Pick</button>} />
    }
    await act(async () => root.render(createElement(Picker, { disabled: false })))
    const trigger = dom.window.document.getElementById('trigger') as HTMLButtonElement
    await act(async () => trigger.click())
    expect(dom.window.document.querySelector('.dsh-model-menu-menu')).not.toBeNull()
    // Becoming disabled closes the open card.
    await act(async () => root.render(createElement(Picker, { disabled: true })))
    expect(dom.window.document.querySelector('.dsh-model-menu-menu')).toBeNull()
    // A disabled control neither reopens nor selects.
    await act(async () => trigger.click())
    await act(async () => trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
    expect(dom.window.document.querySelector('.dsh-model-menu-menu')).toBeNull()
    expect(picks).not.toHaveBeenCalled()
    expect(effortPicks).not.toHaveBeenCalled()
  }))

  it('keeps the menu open while busy, blocks model/leading selection, keeps search editable, and resumes', async () => mounted(async (dom, root) => {
    const picks = vi.fn(), leadPicks = vi.fn()
    const catalog = parseModelMenuChoices({ groups: [{ id: 'p', name: 'P', models: [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }] }] })
    function Picker({ busy }: { busy: boolean }) {
      const [open, setOpen] = useState(false)
      return <ModelMenu open={open} onOpenChange={setOpen} choices={catalog} busy={busy}
        initialPane="model" alwaysShowSearch leading={[{ id: 'follow', label: 'Follow' }]} onPickLeading={leadPicks}
        onPick={picks} anchor={<button id="trigger" type="button">Pick</button>} />
    }
    await act(async () => root.render(createElement(Picker, { busy: false })))
    await act(async () => (dom.window.document.getElementById('trigger') as HTMLButtonElement).click())
    expect(dom.window.document.querySelector('.dsh-model-menu-menu')).not.toBeNull()
    await act(async () => root.render(createElement(Picker, { busy: true })))
    // Busy keeps the card open instead of closing it.
    expect(dom.window.document.querySelector('.dsh-model-menu-menu')).not.toBeNull()
    const rows = () => Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
    expect(rows().length).toBe(3)
    expect(rows().every(row => row.disabled)).toBe(true)
    for (const row of rows()) await act(async () => row.click())
    expect(picks).not.toHaveBeenCalled()
    expect(leadPicks).not.toHaveBeenCalled()
    // Search stays editable while busy.
    const search = dom.window.document.querySelector<HTMLInputElement>('[role="searchbox"]')!
    expect(search.disabled).toBe(false)
    const { Simulate } = await import('react-dom/test-utils')
    await act(async () => Simulate.change(search, { target: { value: 'two' } } as never))
    expect(search.value).toBe('two')
    // Clearing busy restores selection.
    await act(async () => root.render(createElement(Picker, { busy: false })))
    const modelRow = rows().find(row => row.textContent === 'Two')!
    await act(async () => modelRow.click())
    expect(picks.mock.calls).toEqual([[{ provider: 'p', model: 'two' }]])
  }))

  it('blocks effort-list selection while busy but still allows drilling', async () => mounted(async (dom, root) => {
    const effortPicks = vi.fn()
    const catalog = parseModelMenuChoices({ groups: [{ id: 'p', name: 'P', models: [{ id: 'one', name: 'One' }] }] })
    function Picker({ busy }: { busy: boolean }) {
      const [open, setOpen] = useState(false)
      return <ModelMenu open={open} onOpenChange={setOpen} choices={catalog} busy={busy}
        efforts={[{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }]} selectedEffort="low" onPickEffort={effortPicks}
        anchor={<button id="trigger" type="button">Pick</button>} />
    }
    await act(async () => root.render(createElement(Picker, { busy: true })))
    await act(async () => (dom.window.document.getElementById('trigger') as HTMLButtonElement).click())
    // Navigation into the effort pane is not a submission, so it stays allowed.
    const cells = Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    expect(cells.length).toBe(2)
    await act(async () => cells[1].click())
    const effortRows = () => Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
    expect(effortRows().every(row => row.disabled)).toBe(true)
    await act(async () => effortRows()[1].click())
    expect(effortPicks).not.toHaveBeenCalled()
    // Busy clears: choosing an effort works again.
    await act(async () => root.render(createElement(Picker, { busy: false })))
    await act(async () => effortRows()[1].click())
    expect(effortPicks.mock.calls).toEqual([['low']])
  }))

  it('blocks slider commit while busy but still previews, and resumes after', async () => mounted(async (dom, root) => {
    const effortPicks = vi.fn()
    const catalog = parseModelMenuChoices({ groups: [{ id: 'p', name: 'P', models: [{ id: 'm', name: 'M' }] }] })
    function Picker({ busy }: { busy: boolean }) {
      const [open, setOpen] = useState(false)
      const [effort, setEffort] = useState('low')
      return <ModelMenu open={open} onOpenChange={setOpen} choices={catalog} busy={busy}
        initialPane="model" alwaysShowSearch reasoningSlider selected={{ provider: 'p', model: 'm' }}
        efforts={[{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }]} selectedEffort={effort}
        onPickEffort={value => { effortPicks(value); setEffort(value ?? '') }}
        anchor={<button id="trigger" type="button">Pick</button>} />
    }
    await act(async () => root.render(createElement(Picker, { busy: true })))
    await act(async () => (dom.window.document.getElementById('trigger') as HTMLButtonElement).click())
    const slider = dom.window.document.querySelector<HTMLInputElement>('input[type="range"]')!
    expect(slider.disabled).toBe(false)
    const { Simulate } = await import('react-dom/test-utils')
    await act(async () => Simulate.change(slider, { target: { value: '2' } } as never))
    expect(slider.value).toBe('2')
    await act(async () => slider.dispatchEvent(new dom.window.Event('pointerup', { bubbles: true })))
    expect(effortPicks).not.toHaveBeenCalled()
    await act(async () => root.render(createElement(Picker, { busy: false })))
    await act(async () => slider.dispatchEvent(new dom.window.Event('pointerup', { bubbles: true })))
    expect(effortPicks.mock.calls).toEqual([['high']])
  }))

  it('keeps scrollTop, search, focus, and the menu node when an equal catalog gets a new identity', async () => mounted(async (dom, root) => {
    dom.window.HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
      const scroller = this.closest('.dsh-model-menu-groups')
      if (scroller instanceof dom.window.HTMLElement) scroller.scrollTop = 0
    }
    const first = parseModelMenuChoices({ groups: [{ id: 'p', name: 'P', models: [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }] }] })
    const again = parseModelMenuChoices({ groups: [{ id: 'p', name: 'P', models: [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }] }] })
    expect(again).not.toBe(first)
    function Picker({ choices, effort }: { choices: typeof first; effort: string }) {
      const [open, setOpen] = useState(false)
      return <ModelMenu open={open} onOpenChange={setOpen} choices={choices} closeOnPick={false}
        initialPane="model" alwaysShowSearch reasoningSlider
        selected={{ provider: 'p', model: 'one' }} selectedEffort={effort}
        efforts={[{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }]}
        onPick={() => {}} onPickEffort={() => {}}
        anchor={<button id="trigger" type="button">Pick</button>} />
    }
    await act(async () => root.render(createElement(Picker, { choices: first, effort: 'high' })))
    await act(async () => (dom.window.document.getElementById('trigger') as HTMLButtonElement).click())
    const { Simulate } = await import('react-dom/test-utils')
    const search = dom.window.document.querySelector<HTMLInputElement>('[role="searchbox"]')!
    const menu = dom.window.document.querySelector('.dsh-model-menu-menu')!
    const groups = dom.window.document.querySelector<HTMLElement>('.dsh-model-menu-groups')!
    await act(async () => Simulate.change(search, { target: { value: 'Tw' } } as never))
    search.focus()
    groups.scrollTop = 48
    await act(async () => root.render(createElement(Picker, { choices: again, effort: 'low' })))
    expect(dom.window.document.querySelector('.dsh-model-menu-menu')).toBe(menu)
    expect(dom.window.document.querySelector('.dsh-model-menu-groups')).toBe(groups)
    expect(search.value).toBe('Tw')
    expect(dom.window.document.activeElement).toBe(search)
    expect(groups.scrollTop).toBe(48)
    await act(async () => search.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    expect(groups.scrollTop).toBe(0)
  }))

  it('never treats a targetless blur as dismissal in keep-open mode, but still closes on outside focus and press', async () => mounted(async (dom, root) => {
    const catalog = parseModelMenuChoices({ groups: [{ id: 'p', name: 'P', models: [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }] }] })
    function Picker({ busy }: { busy: boolean }) {
      const [open, setOpen] = useState(false)
      return <ModelMenu open={open} onOpenChange={setOpen} choices={catalog} busy={busy} closeOnPick={false}
        initialPane="model" alwaysShowSearch onPick={() => {}}
        anchor={<button id="trigger" type="button">Pick</button>} />
    }
    const openMenu = async () => {
      await act(async () => root.render(createElement(Picker, { busy: false })))
      await act(async () => (dom.window.document.getElementById('trigger') as HTMLButtonElement).click())
    }
    const blurTo = async (related: EventTarget | null) => {
      // Fire the blur on the root-side trigger, not the portaled search box:
      // React binds this component's onBlur through a focusout listener on the
      // root container, which a bubbling focusout inside the document.body
      // portal never reaches — a dispatched blur there would test nothing.
      const trigger = dom.window.document.getElementById('trigger') as HTMLButtonElement
      trigger.focus()
      await act(async () => trigger.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true, relatedTarget: related })))
    }
    await openMenu()
    const menu = dom.window.document.querySelector('.dsh-model-menu-menu')!
    // A null target is ambiguous (disable of the focused row, a blur whose
    // target raced a re-render) — never a dismissal while the card is open.
    await blurTo(null)
    expect(dom.window.document.querySelector('.dsh-model-menu-menu')).toBe(menu)
    // A detached node is equally ambiguous and must not close either.
    await blurTo(dom.window.document.createElement('button'))
    expect(dom.window.document.querySelector('.dsh-model-menu-menu')).toBe(menu)
    await act(async () => root.render(createElement(Picker, { busy: true })))
    await blurTo(null)
    expect(dom.window.document.querySelector('.dsh-model-menu-menu')).toBe(menu)
    // Focus landing in a real outside node is a dismissal, even while busy.
    const outside = dom.window.document.getElementById('outside')!
    await blurTo(outside)
    expect(dom.window.document.querySelector('.dsh-model-menu-menu')).toBeNull()
    await openMenu()
    await act(async () => outside.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true })))
    expect(dom.window.document.querySelector('.dsh-model-menu-menu')).toBeNull()
  }))

  it('Escape on the entry pane closes outright; a search-first picker never drills back to root cells', async () => mounted(async (dom, root) => {
    const changes = vi.fn()
    const catalog = parseModelMenuChoices({ groups: [{ id: 'p', name: 'P', models: Array.from({ length: 5 }, (_, index) => ({ id: `m-${index}` })) }] })
    function Picker() {
      const [open, setOpen] = useState(false)
      return <ModelMenu open={open} onOpenChange={next => { changes(next); setOpen(next) }} choices={catalog} onPick={() => {}}
        initialPane="model" alwaysShowSearch closeOnPick={false}
        anchor={<button id="trigger" type="button">Pick</button>} />
    }
    await act(async () => root.render(createElement(Picker)))
    await act(async () => (dom.window.document.getElementById('trigger') as HTMLButtonElement).click())
    const search = dom.window.document.querySelector<HTMLInputElement>('[role="searchbox"]')!
    // The picker's model pane is a single-level panel: one Escape closes —
    // it must not back out to a root pane the user never saw.
    await act(async () => search.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(dom.window.document.querySelector('.dsh-model-menu-menu')).toBeNull()
    expect(dom.window.document.querySelector('[role="menuitem"]')).toBeNull()
    expect(changes.mock.calls).toEqual([[true], [false]])
    expect(dom.window.document.activeElement).toBe(dom.window.document.getElementById('trigger'))
  }))

  it('keeps the open card mounted across a disabled pulse when closeOnDisable is false, gating rows but not dismissal', async () => mounted(async (dom, root) => {
    const catalog = parseModelMenuChoices({ groups: [{ id: 'p', name: 'P', models: [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }] }] })
    const picks = vi.fn(), changes = vi.fn()
    function Picker({ disabled }: { disabled: boolean }) {
      const [open, setOpen] = useState(false)
      return <ModelMenu open={open} onOpenChange={next => { changes(next); setOpen(next) }} choices={catalog} disabled={disabled}
        initialPane="model" alwaysShowSearch closeOnPick={false} closeOnDisable={false}
        onPick={picks} anchor={<button id="trigger" type="button">Pick</button>} />
    }
    await act(async () => root.render(createElement(Picker, { disabled: false })))
    await act(async () => (dom.window.document.getElementById('trigger') as HTMLButtonElement).click())
    const menu = dom.window.document.querySelector('.dsh-model-menu-menu')!
    // The save lock rises: the same card stays mounted with its actions gated.
    await act(async () => root.render(createElement(Picker, { disabled: true })))
    expect(dom.window.document.querySelector('.dsh-model-menu-menu')).toBe(menu)
    expect(dom.window.document.querySelector('[role="menuitemradio"]:not([disabled])')).toBeNull()
    // Reopening and picking are suppressed while disabled — closing is not.
    await act(async () => (dom.window.document.getElementById('trigger') as HTMLButtonElement).click())
    expect(picks).not.toHaveBeenCalled()
    // The lock releases: the identical card is still there and selection works.
    await act(async () => root.render(createElement(Picker, { disabled: false })))
    expect(dom.window.document.querySelector('.dsh-model-menu-menu')).toBe(menu)
    const two = [...dom.window.document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(row => row.textContent === 'Two')!
    await act(async () => two.click())
    expect(picks.mock.calls).toEqual([[{ provider: 'p', model: 'two' }]])
    expect(dom.window.document.querySelector('.dsh-model-menu-menu')).toBe(menu)
    // Outside press still dismisses.
    const outside = dom.window.document.getElementById('outside')!
    await act(async () => outside.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true })))
    expect(dom.window.document.querySelector('.dsh-model-menu-menu')).toBeNull()
    // Reopen, lock again, and Escape still closes the gated card — through the
    // in-card path and through focus sitting on document.body, which is where a
    // real disabled-input blur leaves focus.
    await act(async () => (dom.window.document.getElementById('trigger') as HTMLButtonElement).click())
    expect(dom.window.document.querySelector('.dsh-model-menu-menu')).not.toBeNull()
    await act(async () => root.render(createElement(Picker, { disabled: true })))
    const search = dom.window.document.querySelector<HTMLInputElement>('[role="searchbox"]')!
    await act(async () => search.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(dom.window.document.querySelector('.dsh-model-menu-menu')).toBeNull()
    await act(async () => root.render(createElement(Picker, { disabled: false })))
    await act(async () => (dom.window.document.getElementById('trigger') as HTMLButtonElement).click())
    await act(async () => root.render(createElement(Picker, { disabled: true })))
    await act(async () => dom.window.document.body.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(dom.window.document.querySelector('.dsh-model-menu-menu')).toBeNull()
    expect(changes.mock.calls).toEqual([[true], [false], [true], [false], [true], [false]])
  }))

  it('honors closeOnPick={false} on leading and effort-pane rows instead of dismissing', async () => mounted(async (dom, root) => {
    const catalog = parseModelMenuChoices({ groups: [{ id: 'p', name: 'P', models: [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }] }] })
    const leads = vi.fn(), effortPicks = vi.fn(), changes = vi.fn()
    function Picker() {
      const [open, setOpen] = useState(false)
      return <ModelMenu open={open} onOpenChange={next => { changes(next); setOpen(next) }} choices={catalog} closeOnPick={false}
        leading={[{ id: 'follow', label: 'Follow' }]} onPickLeading={leads}
        efforts={[{ id: 'low', name: 'Low' }]} selectedEffort="" onPickEffort={effortPicks}
        onPick={() => {}} anchor={<button id="trigger" type="button">Pick</button>} />
    }
    await act(async () => root.render(createElement(Picker)))
    await act(async () => (dom.window.document.getElementById('trigger') as HTMLButtonElement).click())
    // Drill into the model list and pick the leading row: the card stays.
    await act(async () => dom.window.document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[0].click())
    await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[role="menuitemradio"]')!.click())
    expect(leads.mock.calls).toEqual([['follow']])
    const menu = dom.window.document.querySelector('.dsh-model-menu-menu')!
    expect(menu).not.toBeNull()
    // Back to root, drill into the effort pane, pick a level: still open.
    await act(async () => dom.window.document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(dom.window.document.querySelector('.dsh-model-menu-menu')).toBe(menu)
    await act(async () => dom.window.document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[1].click())
    const low = [...dom.window.document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(row => row.textContent === 'Low')!
    await act(async () => low.click())
    expect(effortPicks.mock.calls).toEqual([['low']])
    expect(dom.window.document.querySelector('.dsh-model-menu-menu')).toBe(menu)
    expect(changes.mock.calls).toEqual([[true]])
  }))
})
