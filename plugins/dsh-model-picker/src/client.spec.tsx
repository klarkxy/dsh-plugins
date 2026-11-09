import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import {
  ComposerModelSeat, directoryChoices, ModelPicker, pickerCopy,
} from './client.tsx'

const zhT = pickerCopy('zh-CN')

type Groups = ModelDirectoryState['groups']
const groups: Groups = [
  { id: 'p', name: 'Provider', models: [
    { id: 'one', name: 'One', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'high' } },
    { id: 'two', name: 'Two', reasoning: { efforts: [{ id: 'low', name: 'Low' }], defaultEffort: 'low' } },
  ] },
  { id: 'q', name: 'Q', models: [{ id: 'plain', name: 'Plain' }] },
]

function makeDirectory(state: Partial<ModelDirectoryState> = {}) {
  let snapshot: ModelDirectoryState = {
    current: { provider: 'p', model: 'one', reasoningEffort: 'high' },
    routable: true, groups, failures: [], status: 'ready', pending: null, error: null,
    ...state,
  }
  const listeners = new Set<() => void>()
  const directory = {
    getSnapshot: () => snapshot,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
  }
  return {
    directory,
    set(next: Partial<ModelDirectoryState>) { snapshot = { ...snapshot, ...next }; for (const fn of [...listeners]) fn() },
  }
}

/* Install the JSDOM globals for one test. Returns cleanup. */
function jsdomEnv() {
  const dom = new JSDOM('<div id="root"></div>')
  const previous = new Map<string, PropertyDescriptor | undefined>()
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, Node: dom.window.Node,
    Element: dom.window.Element, HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    MouseEvent: dom.window.MouseEvent, KeyboardEvent: dom.window.KeyboardEvent,
    Event: dom.window.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  /* jsdom has no layout engine: scrollIntoView is missing (ModelMenu scrolls
   * the active option into view when the model pane opens). */
  dom.window.HTMLElement.prototype.scrollIntoView = () => {}
  return {
    dom,
    click(el: Element) { return act(() => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) }) },
    async slide(el: HTMLInputElement, value: string) {
      // React 18 tracks input values: Simulate.change exercises the real
      // controlled-input path, then a pointerup commits the slider gesture.
      // A native keyup must NOT be used here: jsdom makes React take its
      // legacy input-event polyfill (no InputEvent support check), where a
      // keyup touches a null activeElementInst and the whole dispatch dies
      // inside ChangeEventPlugin before onKeyUp ever runs.
      await act(async () => Simulate.change(el, { target: { value } } as never))
      await act(() => { el.dispatchEvent(new dom.window.Event('pointerup', { bubbles: true })) })
    },
    async done(root: Root) {
      await act(async () => root.unmount())
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
      dom.window.close()
    },
  }
}

function mount(dom: JSDOM): Root {
  return createRoot(dom.window.document.getElementById('root')!)
}

describe('directory adapters', () => {
  it('flattens provider groups into choices and keeps a saved route selectable', () => {
    const choices = directoryChoices(groups, { provider: 'gone', model: 'lost' })
    expect(choices).toHaveLength(4)
    expect(choices[0]).toMatchObject({ provider: 'p', model: 'one', providerLabel: 'Provider', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] })
    expect(choices.at(-1)).toMatchObject({ provider: 'gone', model: 'lost', efforts: [] })
  })
})

describe('ModelPicker factory component', () => {
  const choices = directoryChoices(groups)
  const kit = {
    t: pickerCopy('en'),
    useFactorySlot: (_name: string, fallback: unknown) => fallback,
    useActiveLocale: (selector?: (s: { active: string }) => unknown) => selector ? selector({ active: 'en' }) : { active: 'en' },
  }

  it('opens on the model pane with a visible search row, a real range slider, and trigger aria', async () => {
    const env = jsdomEnv()
    const root = mount(env.dom)
    try {
      await act(async () => root.render(<ModelPicker {...kit} choices={choices} selected={{ provider: 'p', model: 'one' }} onPick={() => {}} efforts={[{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }]} selectedEffort="high" onPickEffort={() => {}} />))
      const trigger = env.dom.window.document.querySelector('button')!
      expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
      await env.click(trigger)
      expect(trigger.getAttribute('aria-expanded')).toBe('true')
      expect(env.dom.window.document.querySelector('input[role="searchbox"]')).not.toBeNull()
      const slider = env.dom.window.document.querySelector<HTMLInputElement>('input[type="range"]')
      expect(slider).not.toBeNull()
      expect(slider!.max).toBe('2') // default row + low + high
    } finally { await env.done(root) }
  })

  it('picking a model reports the route verbatim; a slider gesture commits its effort id', async () => {
    const env = jsdomEnv()
    const root = mount(env.dom)
    const onPick = vi.fn(), onPickEffort = vi.fn()
    try {
      await act(async () => root.render(<ModelPicker {...kit} choices={choices} selected={{ provider: 'p', model: 'one' }} onPick={onPick} efforts={[{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }]} selectedEffort="high" onPickEffort={onPickEffort} />))
      await env.click(env.dom.window.document.querySelector('button')!)
      const twoRow = [...env.dom.window.document.querySelectorAll('[role="menuitemradio"]')].find(row => row.textContent?.includes('Two'))!
      await env.click(twoRow)
      expect(onPick).toHaveBeenCalledWith({ provider: 'p', model: 'two' })
      await env.click(env.dom.window.document.querySelector('button')!)
      const slider = env.dom.window.document.querySelector<HTMLInputElement>('input[type="range"]')!
      await env.slide(slider, '1')
      expect(onPickEffort).toHaveBeenCalledWith('low')
    } finally { await env.done(root) }
  })

  it('disabled gates every pick and suppresses opening', async () => {
    const env = jsdomEnv()
    const root = mount(env.dom)
    const onPick = vi.fn(), onPickEffort = vi.fn()
    try {
      await act(async () => root.render(<ModelPicker {...kit} disabled choices={choices} selected={{ provider: 'p', model: 'one' }} onPick={onPick} onPickEffort={onPickEffort} />))
      const trigger = env.dom.window.document.querySelector('button')!
      await env.click(trigger)
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
      expect(onPick).not.toHaveBeenCalled()
      expect(onPickEffort).not.toHaveBeenCalled()
    } finally { await env.done(root) }
  })

  it('a pick followed by the save lock keeps the same menu node; slider commits once the lock releases', async () => {
    const env = jsdomEnv()
    const root = mount(env.dom)
    const onPick = vi.fn(), onPickEffort = vi.fn()
    const efforts = [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }]
    function Harness({ saving }: { saving: boolean }) {
      return <ModelPicker {...kit} disabled={saving}
        choices={choices} selected={{ provider: 'p', model: 'one' }} onPick={onPick}
        efforts={efforts} selectedEffort="high" onPickEffort={onPickEffort} />
    }
    try {
      await act(async () => root.render(<Harness saving={false} />))
      await env.click(env.dom.window.document.querySelector('button')!)
      const menu = env.dom.window.document.querySelector('.dsh-model-menu-menu')!
      // The real flow: pick a model — the selection is reported and the card stays.
      const twoRow = [...env.dom.window.document.querySelectorAll('[role="menuitemradio"]')].find(row => row.textContent?.includes('Two'))!
      await env.click(twoRow)
      expect(onPick).toHaveBeenCalledWith({ provider: 'p', model: 'two' })
      expect(env.dom.window.document.querySelector('.dsh-model-menu-menu')).toBe(menu)
      // The owner's save lock rises: the same DOM card stays mounted, rows gated.
      await act(async () => root.render(<Harness saving={true} />))
      expect(env.dom.window.document.querySelector('.dsh-model-menu-menu')).toBe(menu)
      expect(env.dom.window.document.querySelector('[role="menuitemradio"]:not([disabled])')).toBeNull()
      // Success lands and the lock releases: same card, slider fully usable.
      await act(async () => root.render(<Harness saving={false} />))
      expect(env.dom.window.document.querySelector('.dsh-model-menu-menu')).toBe(menu)
      const slider = env.dom.window.document.querySelector<HTMLInputElement>('input[type="range"]')!
      await env.slide(slider, '1')
      expect(onPickEffort).toHaveBeenCalledWith('low')
      expect(env.dom.window.document.querySelector('.dsh-model-menu-menu')).toBe(menu)
      // A second save pulse still does not move the card; Escape still closes it.
      await act(async () => root.render(<Harness saving={true} />))
      expect(env.dom.window.document.querySelector('.dsh-model-menu-menu')).toBe(menu)
      await act(async () => env.dom.window.document.querySelector<HTMLInputElement>('[role="searchbox"]')!
        .dispatchEvent(new env.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
      expect(env.dom.window.document.querySelector('.dsh-model-menu-menu')).toBeNull()
    } finally { await env.done(root) }
  })

  it('one Escape closes the search-first picker from anywhere in the card', async () => {
    const env = jsdomEnv()
    const root = mount(env.dom)
    try {
      await act(async () => root.render(<ModelPicker {...kit} choices={choices} selected={{ provider: 'p', model: 'one' }} onPick={() => {}} />))
      const trigger = env.dom.window.document.querySelector('button')!
      await env.click(trigger)
      expect(env.dom.window.document.querySelector('[role="searchbox"]')).not.toBeNull()
      await act(async () => env.dom.window.document.querySelector<HTMLButtonElement>('[role="menuitemradio"]')!
        .dispatchEvent(new env.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
      expect(env.dom.window.document.querySelector('.dsh-model-menu-menu')).toBeNull()
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
    } finally { await env.done(root) }
  })

  it('renders the status header with a working retry and a loading row only while choices are empty', async () => {
    const env = jsdomEnv()
    const root = mount(env.dom)
    const retry = vi.fn()
    try {
      // Populated choices + busy: error/failure rows render, the loading row
      // stays out so a background refresh never disturbs an open menu.
      await act(async () => root.render(<ModelPicker {...kit} choices={choices} onPick={() => {}}
        status={{ busy: true, error: 'boom', failures: [{ id: 'q', name: 'Q', message: 'down' }], retry }} />))
      await env.click(env.dom.window.document.querySelector('button')!)
      const banner = env.dom.window.document.querySelector('.dsh-model-picker-status')!
      expect(banner.textContent).toContain('boom')
      expect(banner.textContent).toContain('Q: down')
      expect(banner.textContent).not.toContain('Refreshing model list')
      await env.click(banner.querySelector('.dsh-model-picker-retry')!)
      expect(retry).toHaveBeenCalledTimes(1)
      // Empty choices + busy: the initial-load row shows.
      await act(async () => root.render(<ModelPicker {...kit} choices={[]} onPick={() => {}}
        status={{ busy: true, retry }} />))
      await env.click(env.dom.window.document.querySelector('button')!)
      expect(env.dom.window.document.querySelector('.dsh-model-picker-status')!.textContent).toContain('Refreshing model list')
    } finally { await env.done(root) }
  })

  it('a custom anchor local component replaces the trigger and receives the contract props without DOM leakage warnings', async () => {
    const env = jsdomEnv()
    const root = mount(env.dom)
    const seen: Record<string, unknown>[] = []
    const errors: unknown[] = []
    const consoleError = console.error
    console.error = (...args: unknown[]) => { errors.push(args) }
    function CustomAnchor(props: Record<string, unknown>) {
      seen.push(props)
      const { open, label, effortLabel, busy, disabled } = props
      return <button
        type="button"
        aria-haspopup="menu" aria-expanded={Boolean(open)} aria-disabled={Boolean(disabled)}
        data-custom-anchor data-busy={busy ? '1' : undefined}
      >mine:{String(label)}{effortLabel ? ` · ${String(effortLabel)}` : ''}</button>
    }
    const kit2 = { ...kit, useFactorySlot: (_n: string, _f: unknown) => CustomAnchor }
    try {
      await act(async () => root.render(<ModelPicker {...kit2} choices={choices} selected={{ provider: 'p', model: 'one' }} onPick={() => {}} />))
      const anchor = env.dom.window.document.querySelector('[data-custom-anchor]')!
      expect(anchor.textContent).toBe('mine:Provider / One')
      expect(seen.at(-1)).toMatchObject({ open: false, busy: false, label: 'Provider / One' })
      expect(anchor.getAttribute('aria-haspopup')).toBe('menu')
      await env.click(anchor)
      expect(seen.at(-1)).toMatchObject({ open: true })
      expect(errors).toHaveLength(0)
    } finally { console.error = consoleError; await env.done(root) }
  })
})

describe('ComposerModelSeat', () => {
  function seatProps(over: Record<string, unknown> = {}) {
    const { directory, set } = makeDirectory()
    const select = vi.fn(async () => ({ ok: true as const }))
    const load = vi.fn()
    return {
      sessionId: 's1', locked: false, available: true,
      directory: directory as never, set, load, select, t: zhT,
      resolveText: (text: string) => text,
      ...over,
    }
  }

  it('loads the directory on mount and submits provider+model verbatim on pick', async () => {
    const env = jsdomEnv()
    const root = mount(env.dom)
    const props = seatProps()
    try {
      await act(async () => root.render(<ComposerModelSeat {...props} />))
      expect(props.load).toHaveBeenCalled()
      const trigger = env.dom.window.document.querySelector('button')!
      expect(trigger.textContent).toContain('One')
      await env.click(trigger)
      const twoRow = [...env.dom.window.document.querySelectorAll('[role="menuitemradio"]')].find(row => row.textContent?.includes('Two'))!
      await env.click(twoRow)
      // Native semantics: no reasoningEffort travels with a model switch.
      expect(props.select).toHaveBeenCalledWith({ provider: 'p', model: 'two' })
    } finally { await env.done(root) }
  })

  it('submits the saved model with the chosen effort from the slider', async () => {
    const env = jsdomEnv()
    const root = mount(env.dom)
    const props = seatProps()
    try {
      await act(async () => root.render(<ComposerModelSeat {...props} />))
      await env.click(env.dom.window.document.querySelector('button')!)
      const slider = env.dom.window.document.querySelector<HTMLInputElement>('input[type="range"]')!
      await env.slide(slider, '1')
      expect(props.select).toHaveBeenCalledWith({ provider: 'p', model: 'one', reasoningEffort: 'low' })
    } finally { await env.done(root) }
  })

  it('the default row marks the provider default, and re-picking an explicit effort equal to the default is still submitted', async () => {
    const env = jsdomEnv()
    const root = mount(env.dom)
    // current has NO saved effort; 'high' is the provider default.
    const { directory } = makeDirectory({ current: { provider: 'p', model: 'one' } })
    const props = seatProps({ directory: directory as never })
    try {
      await act(async () => root.render(<ComposerModelSeat {...props} />))
      const trigger = env.dom.window.document.querySelector('button')!
      // Nothing saved → the caption is the provider-default label, not 'High'.
      expect(trigger.textContent).toContain('跟随模型默认')
      await env.click(trigger)
      const slider = env.dom.window.document.querySelector<HTMLInputElement>('input[type="range"]')!
      // default row (index 0) is the provider default while nothing is saved.
      expect(slider.value).toBe('0')
      // Committing 'high' writes it explicitly even though it resolves to the default.
      await env.slide(slider, '2')
      expect(props.select).toHaveBeenCalledWith({ provider: 'p', model: 'one', reasoningEffort: 'high' })
    } finally { await env.done(root) }
  })

  it('a saved effort the catalog no longer declares is captioned but not offered on the slider', async () => {
    const env = jsdomEnv()
    const root = mount(env.dom)
    const { directory } = makeDirectory({ current: { provider: 'p', model: 'one', reasoningEffort: 'extinct' } })
    const props = seatProps({ directory: directory as never })
    try {
      await act(async () => root.render(<ComposerModelSeat {...props} />))
      expect(env.dom.window.document.querySelector('button')!.textContent).toContain('extinct')
      await env.click(env.dom.window.document.querySelector('button')!)
      const slider = env.dom.window.document.querySelector<HTMLInputElement>('input[type="range"]')!
      // Only declared efforts + the default row: max = 2, not 3.
      expect(slider.max).toBe('2')
    } finally { await env.done(root) }
  })

  it('a real snapshot transition: selecting keeps the menu open with gated rows, then the failure toasts', async () => {
    const env = jsdomEnv()
    const root = mount(env.dom)
    const { directory, set } = makeDirectory()
    let resolveSelect!: (value: { ok: boolean; error?: { code: string; message: string } }) => void
    const select = vi.fn(() => new Promise<{ ok: boolean; error?: { code: string; message: string } }>(resolve => { resolveSelect = resolve }))
    const props = seatProps({ directory: directory as never, select })
    try {
      await act(async () => root.render(<ComposerModelSeat {...props} />))
      await env.click(env.dom.window.document.querySelector('button')!)
      // A slider gesture submits without closing the menu — the real
      // asynchronous-selection path, unlike a model pick (which closes).
      const slider = env.dom.window.document.querySelector<HTMLInputElement>('input[type="range"]')!
      await env.slide(slider, '1')
      expect(select).toHaveBeenCalledWith({ provider: 'p', model: 'one', reasoningEffort: 'low' })
      expect(env.dom.window.document.querySelector('input[type="range"]')).not.toBeNull()
      // The directory reports the in-flight selection: rows disable but the
      // menu stays open, mirroring the native posture.
      await act(async () => set({ status: 'selecting', pending: { provider: 'p', model: 'one', reasoningEffort: 'low' } }))
      expect(env.dom.window.document.querySelector('[role="menuitemradio"]:not([disabled])')).toBeNull()
      expect(env.dom.window.document.querySelector('input[type="range"]')!.getAttribute('aria-disabled')).toBe('true')
      await act(async () => {
        set({ status: 'error', pending: null, error: 'session/writer-held: held' })
        resolveSelect({ ok: false, error: { code: 'session/writer-held', message: 'held' } })
      })
      expect(env.dom.window.document.body.textContent).toContain('session/writer-held')
    } finally { await env.done(root) }
  })

  it('a real loading transition keeps the menu open without a banner while choices exist, and shows it only on the empty initial load', async () => {
    const env = jsdomEnv()
    const root = mount(env.dom)
    const { directory, set } = makeDirectory()
    const props = seatProps({ directory: directory as never })
    try {
      await act(async () => root.render(<ComposerModelSeat {...props} />))
      await env.click(env.dom.window.document.querySelector('button')!)
      await act(async () => set({ status: 'loading' }))
      // A refresh over a populated catalog is silent: no banner row, the menu
      // and slider stay put — the user is not interrupted by catalog reloads.
      expect(env.dom.window.document.querySelector('.dsh-model-picker-status')).toBeNull()
      expect(env.dom.window.document.querySelector('input[type="range"]')).not.toBeNull()
      const twoRow = [...env.dom.window.document.querySelectorAll('[role="menuitemradio"]:not([disabled])')].find(row => row.textContent?.includes('Two'))
      expect(twoRow).not.toBeUndefined()
      // The bare-menu fallback follows the same rule on the empty initial load.
      const { directory: emptyDir } = makeDirectory({ status: 'loading', groups: [], current: null })
      await act(async () => root.render(<ComposerModelSeat {...seatProps({ directory: emptyDir as never, renderFactorySlot: undefined })} />))
      await env.click(env.dom.window.document.querySelector('button')!)
      expect(env.dom.window.document.querySelector('.dsh-model-picker-status')!.textContent).toContain('正在刷新模型列表')
      // …while a refresh over a populated list stays silent there too (the
      // open menu persists across the re-render, so read it without toggling).
      await act(async () => root.render(<ComposerModelSeat {...seatProps({ directory: directory as never, renderFactorySlot: undefined })} />))
      expect(env.dom.window.document.querySelector('.dsh-model-menu-menu')).not.toBeNull()
      expect(env.dom.window.document.querySelector('.dsh-model-picker-status')).toBeNull()
    } finally { await env.done(root) }
  })

  it('renders nothing when unavailable and stays closed while locked', async () => {
    const env = jsdomEnv()
    const root = mount(env.dom)
    try {
      await act(async () => root.render(<ComposerModelSeat {...seatProps({ available: false })} />))
      expect(env.dom.window.document.querySelector('button')).toBeNull()
      await act(async () => root.render(<ComposerModelSeat {...seatProps({ locked: true })} />))
      const trigger = env.dom.window.document.querySelector('button')!
      await env.click(trigger)
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
    } finally { await env.done(root) }
  })

  it('surfaces a load error with a retry row inside the menu', async () => {
    const env = jsdomEnv()
    const root = mount(env.dom)
    const { directory } = makeDirectory({ error: 'net down', status: 'error' })
    const props = seatProps({ directory: directory as never })
    try {
      await act(async () => root.render(<ComposerModelSeat {...props} />))
      await env.click(env.dom.window.document.querySelector('button')!)
      const retry = env.dom.window.document.querySelector('.dsh-model-picker-retry')!
      await env.click(retry)
      expect(props.load).toHaveBeenCalled()
    } finally { await env.done(root) }
  })

  it('an unroutable saved route is marked and its row cannot be re-picked', async () => {
    const env = jsdomEnv()
    const root = mount(env.dom)
    const { directory } = makeDirectory({ routable: false, current: { provider: 'gone', model: 'lost' } })
    const props = seatProps({ directory: directory as never })
    try {
      await act(async () => root.render(<ComposerModelSeat {...props} />))
      await env.click(env.dom.window.document.querySelector('button')!)
      expect(env.dom.window.document.body.textContent).toContain('不在可用目录中')
      // The row renders the short model name; its title carries the full label.
      const lostRow = env.dom.window.document.querySelector('[role="menuitemradio"][title="gone / lost"]')!
      expect(lostRow.textContent).toContain('lost')
      await env.click(lostRow)
      expect(props.select).not.toHaveBeenCalled()
    } finally { await env.done(root) }
  })

  it('without renderFactorySlot the bare-menu fallback still selects', async () => {
    const env = jsdomEnv()
    const root = mount(env.dom)
    const props = seatProps()
    try {
      await act(async () => root.render(<ComposerModelSeat {...props} />))
      await env.click(env.dom.window.document.querySelector('button')!)
      const twoRow = [...env.dom.window.document.querySelectorAll('[role="menuitemradio"]')].find(row => row.textContent?.includes('Two'))!
      await env.click(twoRow)
      expect(props.select).toHaveBeenCalledWith({ provider: 'p', model: 'two' })
    } finally { await env.done(root) }
  })

  it('keeps the same menu node, focus, search, and scrollTop across a real snapshot, model pick, and effort commit', async () => {
    const env = jsdomEnv()
    env.dom.window.HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
      const scroller = this.closest('.dsh-model-menu-groups')
      if (scroller instanceof env.dom.window.HTMLElement) scroller.scrollTop = 0
    }
    const root = mount(env.dom)
    const { directory, set } = makeDirectory()
    const props = seatProps({ directory: directory as never })
    try {
      await act(async () => root.render(<ComposerModelSeat {...props} />))
      expect(props.load).toHaveBeenCalledTimes(1)
      await env.click(env.dom.window.document.querySelector('button')!)
      const search = env.dom.window.document.querySelector<HTMLInputElement>('[role="searchbox"]')!
      const menu = env.dom.window.document.querySelector('.dsh-model-menu-menu')!
      const groups = env.dom.window.document.querySelector<HTMLElement>('.dsh-model-menu-groups')!
      const slider = env.dom.window.document.querySelector<HTMLInputElement>('input[type="range"]')!
      await act(async () => Simulate.change(search, { target: { value: 'Tw' } } as never))
      search.focus()
      groups.scrollTop = 48
      const loads = props.load.mock.calls.length
      await env.slide(slider, '1')
      expect(props.select).toHaveBeenCalledWith({ provider: 'p', model: 'one', reasoningEffort: 'low' })
      await act(async () => set({
        status: 'selecting',
        pending: { provider: 'p', model: 'one', reasoningEffort: 'low' },
        current: { provider: 'p', model: 'one', reasoningEffort: 'low' },
      }))
      await act(async () => set({ status: 'ready', pending: null, error: null }))
      expect(env.dom.window.document.querySelector('.dsh-model-menu-menu')).toBe(menu)
      expect(env.dom.window.document.querySelector('.dsh-model-menu-groups')).toBe(groups)
      expect(env.dom.window.document.querySelector('input[type="range"]')).toBe(slider)
      expect(search.isConnected).toBe(true)
      expect(search.value).toBe('Tw')
      expect(env.dom.window.document.activeElement).toBe(search)
      expect(groups.scrollTop).toBe(48)
      expect(props.load).toHaveBeenCalledTimes(loads)
      const twoRow = [...env.dom.window.document.querySelectorAll('[role="menuitemradio"]')].find(row => row.textContent?.includes('Two'))!
      await env.click(twoRow)
      expect(props.select).toHaveBeenCalledWith({ provider: 'p', model: 'two' })
      await act(async () => set({
        status: 'ready', pending: null,
        current: { provider: 'p', model: 'two', reasoningEffort: 'low' },
      }))
      expect(env.dom.window.document.querySelector('.dsh-model-menu-menu')).toBe(menu)
      expect(env.dom.window.document.querySelector('.dsh-model-menu-groups')).toBe(groups)
      expect(search.value).toBe('Tw')
      expect(groups.scrollTop).toBe(48)
      expect(props.load).toHaveBeenCalledTimes(loads)
    } finally { await env.done(root) }
  })
})
