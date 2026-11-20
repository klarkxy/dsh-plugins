import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import {
  ComposerModelSeat, directoryChoices, ModelPicker, modelPickerCss, pickerCopy,
} from './client.tsx'
import { PeriodicCardMenu, SYMBOL_PICK_DELAY_MS } from './periodic-cards.tsx'
import { createPeriodicPrefsStore, setPeriodicStoreForTests, STORAGE_KEY } from './periodic-store.ts'

const zhT = pickerCopy('zh-CN')

type Groups = ModelDirectoryState['groups']
const groups: Groups = [
  { id: 'p', name: 'Provider', models: [
    { id: 'one', name: 'One', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'high' } },
    { id: 'two', name: 'Two', reasoning: { efforts: [{ id: 'low', name: 'Low' }], defaultEffort: 'low' } },
  ] },
  { id: 'q', name: 'Q', models: [{ id: 'plain', name: 'Plain' }] },
]

const periodicGroups: Groups = [
  {
    id: 'google', name: 'Google AI', models: [
      { id: 'gemini-4-neon', name: 'Gemini 4 Neon', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } },
    ],
  },
  {
    id: 'vertex', name: 'Vertex', models: [
      { id: 'google/gemini-4-neon', name: 'Gemini 4 Neon', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } },
    ],
  },
  {
    id: 'xai', name: 'xAI', models: [
      { id: 'grok-4.6', name: 'Grok 4.6', reasoning: { efforts: [{ id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }] } },
      { id: 'grok-4.7', name: 'Grok 4.7', reasoning: { efforts: [{ id: 'high', name: 'High' }] } },
    ],
  },
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
function jsdomEnv(options?: { viewMode?: 'cards' | 'list'; prefs?: Record<string, unknown> }) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  if (options?.viewMode || options?.prefs) {
    dom.window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...options.prefs,
      ...(options.viewMode ? { viewMode: options.viewMode } : {}),
    }))
  }
  // Each test gets its own store singleton over this JSDOM's localStorage,
  // so no state leaks between tests through the module-level periodicStore().
  setPeriodicStoreForTests(createPeriodicPrefsStore({
    getItem: (key: string) => dom.window.localStorage.getItem(key),
    setItem: (key: string, value: string) => { dom.window.localStorage.setItem(key, value) },
  }))
  const previous = new Map<string, PropertyDescriptor | undefined>()
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
    Node: dom.window.Node,
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
      await act(async () => Simulate.change(el, { target: { value } } as never))
      await act(() => { el.dispatchEvent(new dom.window.Event('pointerup', { bubbles: true })) })
    },
    async done(root: Root) {
      await act(async () => root.unmount())
      setPeriodicStoreForTests(undefined)
      dom.window.localStorage.clear()
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

describe('directory adapters & stylesheet guards', () => {
  it('flattens provider groups into choices and keeps a saved route selectable', () => {
    const choices = directoryChoices(groups, { provider: 'gone', model: 'lost' })
    expect(choices).toHaveLength(4)
    expect(choices[0]).toMatchObject({ provider: 'p', model: 'one', providerLabel: 'Provider', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] })
    expect(choices.at(-1)).toMatchObject({ provider: 'gone', model: 'lost', efforts: [] })
  })

  it('keeps modelPickerCss free of literal hex/rgb colors', () => {
    expect(modelPickerCss).toContain('.dsh-model-picker-grid')
    expect(modelPickerCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(modelPickerCss).not.toMatch(/\brgba?\(/)
    expect(modelPickerCss).not.toMatch(/\bhsla?\(/)
  })
})

describe('ModelPicker periodic card grid (default view)', () => {
  const choices = directoryChoices(periodicGroups)
  const kit = {
    t: pickerCopy('en'),
    useFactorySlot: (_name: string, fallback: unknown) => fallback,
    useActiveLocale: (selector?: (s: { active: string }) => unknown) => selector ? selector({ active: 'en' }) : { active: 'en' },
  }

  it('merges multi-provider models into one card, separates versions with superscripts, and switches providers via dropdown', async () => {
    const env = jsdomEnv()
    const root = mount(env.dom)
    const onPick = vi.fn(), onPickEffort = vi.fn()
    try {
      await act(async () => root.render(
        <ModelPicker
          {...kit}
          choices={choices}
          selected={{ provider: 'google', model: 'gemini-4-neon' }}
          onPick={onPick}
          efforts={[{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }]}
          selectedEffort="high"
          onPickEffort={onPickEffort}
        />,
      ))
      await env.click(env.dom.window.document.querySelector('button')!)
      const cards = [...env.dom.window.document.querySelectorAll('.dsh-model-picker-card')]
      // Gemini 4 Neon (merged from Google + Vertex), Grok 4.6, Grok 4.7 => 3 cards.
      expect(cards).toHaveLength(3)
      expect(cards[0]!.querySelector('.dsh-model-picker-short')!.textContent).toBe('Ne')
      expect(cards[1]!.querySelector('.dsh-model-picker-short')!.textContent).toBe('Gr')
      expect(cards[1]!.querySelector('.dsh-model-picker-ver')!.textContent).toBe('4.6')
      expect(cards[2]!.querySelector('.dsh-model-picker-short')!.textContent).toBe('Gr')
      expect(cards[2]!.querySelector('.dsh-model-picker-ver')!.textContent).toBe('4.7')

      // Open provider dropdown on the Neon card and pick Vertex.
      const provBtn = cards[0]!.querySelector('.dsh-model-picker-provBtn')!
      await env.click(provBtn)
      const options = [...cards[0]!.querySelectorAll('[role="option"]')]
      expect(options).toHaveLength(2)
      const vertexOption = options.find(opt => opt.textContent?.includes('Vertex'))!
      await env.click(vertexOption)
      expect(onPick).toHaveBeenCalledWith({ provider: 'vertex', model: 'google/gemini-4-neon' })
    } finally { await env.done(root) }
  })

  it('clicks card center to pick without effort and clicks bottom effort cells to pick/clear effort', async () => {
    const env = jsdomEnv()
    const root = mount(env.dom)
    const onPick = vi.fn(), onPickEffort = vi.fn()
    try {
      await act(async () => root.render(
        <ModelPicker
          {...kit}
          choices={choices}
          selected={{ provider: 'google', model: 'gemini-4-neon' }}
          onPick={onPick}
          efforts={[{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }]}
          selectedEffort="high"
          onPickEffort={onPickEffort}
        />,
      ))
      await env.click(env.dom.window.document.querySelector('button')!)
      const cards = [...env.dom.window.document.querySelectorAll('.dsh-model-picker-card')]

      // Click center of active Neon card -> clears effort (undefined).
      await env.click(cards[0]!.querySelector('.dsh-model-picker-cardBody')!)
      expect(onPickEffort).toHaveBeenCalledWith(undefined)

      // Click 'H' on Grok 4.7 -> picks route + 'high'.
      const grok47High = cards[2]!.querySelector('.dsh-model-picker-effortCell')!
      await env.click(grok47High)
      expect(onPick).toHaveBeenCalledWith({ provider: 'xai', model: 'grok-4.7' })
      expect(onPickEffort).toHaveBeenLastCalledWith('high')
    } finally { await env.done(root) }
  })

  it('adjusts card width via slider and switches smoothly between Cards and List views', async () => {
    const env = jsdomEnv()
    const root = mount(env.dom)
    try {
      await act(async () => root.render(
        <ModelPicker
          {...kit}
          choices={choices}
          selected={{ provider: 'google', model: 'gemini-4-neon' }}
          onPick={() => {}}
          efforts={[{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }]}
          selectedEffort="high"
          onPickEffort={() => {}}
        />,
      ))
      await env.click(env.dom.window.document.querySelector('button')!)
      const surface = env.dom.window.document.querySelector<HTMLElement>('.dsh-model-picker-periodicSurface')!
      const widthSlider = env.dom.window.document.querySelector<HTMLInputElement>('.dsh-model-picker-widthSlider')!
      await act(async () => Simulate.change(widthSlider, { target: { value: '204' } } as never))
      expect(surface.style.getPropertyValue('--_card-w')).toBe('204px')

      // Switch to List view and verify searchbox renders.
      const listBtn = [...env.dom.window.document.querySelectorAll('.dsh-model-picker-viewBtn')].find(btn => btn.textContent === 'List')!
      await env.click(listBtn)
      expect(env.dom.window.document.querySelector('input[role="searchbox"]')).not.toBeNull()
    } finally { await env.done(root) }
  })

  it('double-click rename neither picks the model nor commits on Escape', async () => {
    const env = jsdomEnv()
    const root = mount(env.dom)
    const onPick = vi.fn(), onPickWithEffort = vi.fn()
    try {
      // Park the pick far in the future: the rename's cancel must win the
      // race deterministically instead of racing a 0ms timer.
      ;(globalThis as { __dshModelPickerPickDelay?: number }).__dshModelPickerPickDelay = 60_000
      await act(async () => root.render(
        <ModelPicker
          {...kit}
          choices={choices}
          selected={{ provider: 'google', model: 'gemini-4-neon' }}
          onPick={onPick}
          onPickWithEffort={onPickWithEffort}
          efforts={[{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }]}
          selectedEffort="high"
        />,
      ))
      await env.click(env.dom.window.document.querySelector('button')!)
      const card = [...env.dom.window.document.querySelectorAll('.dsh-model-picker-card')][0]!
      const symbolLine = card.querySelector('.dsh-model-picker-symbolLine')!

      // A single click on the symbol line holds the pick for the double-click
      // window; the rename that follows cancels it, so renaming never
      // selects the model.
      await env.click(symbolLine)
      await act(async () => Simulate.doubleClick(symbolLine))
      const input = card.querySelector<HTMLInputElement>('.dsh-model-picker-shortInput')!
      expect(input).not.toBeNull()
      await act(async () => { input.value = 'Zz'; Simulate.change(input, { target: { value: 'Zz' } } as never) })
      await act(async () => Simulate.keyDown(input, { key: 'Escape' }))
      const stored = env.dom.window.localStorage.getItem(STORAGE_KEY)
      const storedAliases = stored ? JSON.parse(stored).aliases : {}
      expect(storedAliases).toEqual({})
      // The pending pick was cancelled by the rename: no pick happened.
      expect(onPick).not.toHaveBeenCalled()
      expect(onPickWithEffort).not.toHaveBeenCalled()
    } finally {
      delete (globalThis as { __dshModelPickerPickDelay?: number }).__dshModelPickerPickDelay
      await env.done(root)
    }
  })

  it('double-click rename commits on Enter and persists the alias', async () => {
    const env = jsdomEnv()
    const root = mount(env.dom)
    try {
      await act(async () => root.render(
        <ModelPicker
          {...kit}
          choices={choices}
          onPick={() => {}}
          onPickWithEffort={() => {}}
          efforts={[{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }]}
        />,
      ))
      await env.click(env.dom.window.document.querySelector('button')!)
      const card = [...env.dom.window.document.querySelectorAll('.dsh-model-picker-card')][0]!
      await act(async () => Simulate.doubleClick(card.querySelector('.dsh-model-picker-symbolLine')!))
      const input = card.querySelector<HTMLInputElement>('.dsh-model-picker-shortInput')!
      await act(async () => { input.value = 'NeonAlias'; Simulate.change(input, { target: { value: 'NeonAlias' } } as never) })
      await act(async () => Simulate.keyDown(input, { key: 'Enter' }))
      expect(JSON.parse(env.dom.window.localStorage.getItem(STORAGE_KEY) ?? '{}').aliases)
        .toMatchObject({ 'gemini-4-neon': 'NeonAlias' })
    } finally { await env.done(root) }
  })

  it('keeps the current effort when switching providers to a route that serves it', async () => {
    const env = jsdomEnv()
    const root = mount(env.dom)
    const onPickWithEffort = vi.fn()
    try {
      await act(async () => root.render(
        <ModelPicker
          {...kit}
          choices={choices}
          selected={{ provider: 'google', model: 'gemini-4-neon' }}
          onPick={() => {}}
          onPickWithEffort={onPickWithEffort}
          efforts={[{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }]}
          selectedEffort="high"
        />,
      ))
      await env.click(env.dom.window.document.querySelector('button')!)
      const card = [...env.dom.window.document.querySelectorAll('.dsh-model-picker-card')][0]!
      await env.click(card.querySelector('.dsh-model-picker-provBtn')!)
      const vertex = [...card.querySelectorAll('[role="option"]')].find(opt => opt.textContent?.includes('Vertex'))!
      await env.click(vertex)
      // Vertex also declares 'high': the effort rides along instead of being
      // explicitly cleared.
      expect(onPickWithEffort).toHaveBeenCalledWith({ provider: 'vertex', model: 'google/gemini-4-neon' }, 'high')
    } finally { await env.done(root) }
  })

  it('locks every toolbar and drag action while disabled, and cancels in-flight interactions', async () => {
    const env = jsdomEnv()
    const root = mount(env.dom)
    const onPick = vi.fn(), onPickEffort = vi.fn()
    let disabledNow = false
    const Probe = (props: { disabled?: boolean }): React.ReactElement => (
      <ModelPicker
        {...kit}
        disabled={props.disabled}
        choices={choices}
        selected={{ provider: 'google', model: 'gemini-4-neon' }}
        onPick={onPick}
        efforts={[{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }]}
        selectedEffort="high"
        onPickEffort={onPickEffort}
      />
    )
    try {
      await act(async () => root.render(<Probe disabled={disabledNow} />))
      await env.click(env.dom.window.document.querySelector('button')!)
      const surface = env.dom.window.document.querySelector<HTMLElement>('.dsh-model-picker-periodicSurface')!
      expect(surface).not.toBeNull()

      // Width slider and view switch are inert while disabled.
      disabledNow = true
      await act(async () => root.render(<Probe disabled={disabledNow} />))
      const widthSlider = surface.querySelector<HTMLInputElement>('.dsh-model-picker-widthSlider')!
      expect(widthSlider.disabled).toBe(true)
      const viewBtns = [...surface.querySelectorAll('.dsh-model-picker-viewBtn')]
      expect(viewBtns.every(btn => (btn as HTMLButtonElement).disabled)).toBe(true)
      const resetBtn = surface.querySelector('.dsh-model-picker-resetBtn')
      expect(resetBtn === null || (resetBtn as HTMLButtonElement).disabled).toBe(true)
      const before = env.dom.window.localStorage.getItem(STORAGE_KEY)
      await act(async () => Simulate.change(widthSlider, { target: { value: '240' } } as never))
      expect(env.dom.window.localStorage.getItem(STORAGE_KEY)).toBe(before)
    } finally { await env.done(root) }
  })

  it('routes printable keys to the filter, Enter picks the first match, and Escape unwinds query then panel', async () => {
    const env = jsdomEnv()
    const root = mount(env.dom)
    const onPickWithEffort = vi.fn()
    try {
      await act(async () => root.render(
        <ModelPicker
          {...kit}
          choices={choices}
          selected={{ provider: 'google', model: 'gemini-4-neon' }}
          onPick={() => {}}
          onPickWithEffort={onPickWithEffort}
          efforts={[{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }]}
        />,
      ))
      await env.click(env.dom.window.document.querySelector('button')!)
      const doc = env.dom.window.document
      const filter = doc.querySelector<HTMLInputElement>('.dsh-model-picker-filter input')!
      expect(filter).not.toBeNull()

      // A printable key pressed while a card body holds focus lands in the
      // filter input and narrows the grid.
      const cardBody = doc.querySelector<HTMLElement>('.dsh-model-picker-cardBody')!
      cardBody.focus()
      await act(async () => {
        for (const key of ['g', 'r', 'o', 'k']) {
          cardBody.dispatchEvent(new env.dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
        }
      })
      expect(filter.value).toBe('grok')
      const visible = [...doc.querySelectorAll<HTMLElement>('.dsh-model-picker-card')]
      expect(visible).toHaveLength(2)
      expect(visible.map(card => card.getAttribute('data-card-key'))).toEqual(['grok-4.6', 'grok-4.7'])
      expect(visible[0]!.hasAttribute('data-first-match')).toBe(true)
      expect(doc.activeElement).toBe(filter)

      // Enter picks the first visible card with an explicit no-effort pick.
      await act(async () => Simulate.keyDown(filter, { key: 'Enter' }))
      expect(onPickWithEffort).toHaveBeenCalledWith({ provider: 'xai', model: 'grok-4.6' }, undefined)

      // First Escape clears the query but keeps the panel; the second closes it.
      await act(async () => filter.dispatchEvent(
        new env.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      ))
      expect(filter.value).toBe('')
      expect(doc.querySelector('.dsh-model-picker-periodicSurface')).not.toBeNull()
      expect(doc.querySelectorAll('.dsh-model-picker-card')).toHaveLength(3)
      await act(async () => filter.dispatchEvent(
        new env.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      ))
      expect(doc.querySelector('.dsh-model-picker-periodicSurface')).toBeNull()

      // Reopen and filter to nothing: the filter-empty state shows.
      await env.click(doc.querySelector('button')!)
      const body = doc.querySelector<HTMLElement>('.dsh-model-picker-cardBody')!
      await act(async () => {
        body.dispatchEvent(new env.dom.window.KeyboardEvent('keydown', { key: 'z', bubbles: true, cancelable: true }))
      })
      expect(doc.querySelectorAll('.dsh-model-picker-card')).toHaveLength(0)
      expect(doc.querySelector('.dsh-model-picker-empty')!.textContent).toBe('No matching models')
    } finally { await env.done(root) }
  })

  it('ignores Enter while an IME composition is active in the filter', async () => {
    const env = jsdomEnv()
    const root = mount(env.dom)
    const onPickWithEffort = vi.fn()
    try {
      await act(async () => root.render(
        <ModelPicker
          {...kit}
          choices={choices}
          selected={{ provider: 'google', model: 'gemini-4-neon' }}
          onPick={() => {}}
          onPickWithEffort={onPickWithEffort}
          efforts={[{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }]}
        />,
      ))
      await env.click(env.dom.window.document.querySelector('button')!)
      const doc = env.dom.window.document
      const filter = doc.querySelector<HTMLInputElement>('.dsh-model-picker-filter input')!
      const cardBody = doc.querySelector<HTMLElement>('.dsh-model-picker-cardBody')!
      cardBody.focus()
      await act(async () => {
        cardBody.dispatchEvent(new env.dom.window.KeyboardEvent('keydown', { key: 'g', bubbles: true, cancelable: true }))
      })
      expect(filter.value).toBe('g')

      // A composing Enter commits the IME candidate; it must not pick a card.
      await act(async () => filter.dispatchEvent(
        new env.dom.window.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }),
      ))
      expect(onPickWithEffort).not.toHaveBeenCalled()

      // The next, non-composing Enter still picks the first match.
      await act(async () => filter.dispatchEvent(
        new env.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      ))
      expect(onPickWithEffort).toHaveBeenCalledTimes(1)
      expect(onPickWithEffort).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-4-neon' }), undefined)
    } finally { await env.done(root) }
  })

  it('does not drop a card across the favorites partition', async () => {
    const env = jsdomEnv({ prefs: { favorites: ['grok-4.6'] } })
    const root = mount(env.dom)
    try {
      await act(async () => root.render(
        <ModelPicker
          {...kit}
          choices={choices}
          selected={{ provider: 'google', model: 'gemini-4-neon' }}
          onPick={() => {}}
          efforts={[{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }]}
        />,
      ))
      const doc = env.dom.window.document
      await env.click(doc.querySelector('button')!)
      const cardsNow = () => [...doc.querySelectorAll<HTMLElement>('.dsh-model-picker-card')]
      expect(cardsNow().map(card => card.getAttribute('data-card-key'))).toEqual([
        'grok-4.6', 'gemini-4-neon', 'grok-4.7',
      ])
      const before = env.dom.window.localStorage.getItem(STORAGE_KEY)

      // Favorite → non-favorite center drop: no drop cue, no reorder, no write.
      const src = cardsNow()[0]!
      const dst = cardsNow()[2]!
      const dataTransfer = { effectAllowed: '', setData: () => {}, getData: () => '' }
      await act(async () => {
        Simulate.dragStart(src, { dataTransfer })
        Simulate.dragOver(dst, { dataTransfer })
      })
      expect(dst.getAttribute('data-drop')).toBeNull()
      await act(async () => {
        Simulate.drop(dst, { dataTransfer })
        Simulate.dragEnd(src, { dataTransfer })
      })
      expect(cardsNow().map(card => card.getAttribute('data-card-key'))).toEqual([
        'grok-4.6', 'gemini-4-neon', 'grok-4.7',
      ])
      expect(env.dom.window.localStorage.getItem(STORAGE_KEY)).toBe(before)
    } finally { await env.done(root) }
  })

  it('context menu favorites, reorders, hides/reveals, and renames cards', async () => {
    const env = jsdomEnv()
    const root = mount(env.dom)
    try {
      await act(async () => root.render(
        <ModelPicker
          {...kit}
          choices={choices}
          selected={{ provider: 'google', model: 'gemini-4-neon' }}
          onPick={() => {}}
          efforts={[{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }]}
          selectedEffort="high"
          onPickEffort={() => {}}
        />,
      ))
      const doc = env.dom.window.document
      await env.click(doc.querySelector('button')!)
      const cardsNow = () => [...doc.querySelectorAll<HTMLElement>('.dsh-model-picker-card')]
      const openMenuOn = async (index: number) => {
        await act(async () => Simulate.contextMenu(cardsNow()[index]!, { clientX: 40, clientY: 50 }))
        return doc.querySelector<HTMLElement>('.dsh-model-picker-cardMenu')!
      }
      const menuItem = (menu: HTMLElement, text: string) =>
        [...menu.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')].find(btn => btn.textContent === text)!
      const stored = () => JSON.parse(env.dom.window.localStorage.getItem(STORAGE_KEY) ?? '{}')

      // Right-click Grok 4.7 and favorite it: it jumps to the front with a star.
      let menu = await openMenuOn(2)
      expect(menu.getAttribute('role')).toBe('menu')
      await env.click(menuItem(menu, 'Favorite'))
      expect(doc.querySelector('.dsh-model-picker-cardMenu')).toBeNull()
      expect(cardsNow()[0]!.getAttribute('data-card-key')).toBe('grok-4.7')
      expect(cardsNow()[0]!.querySelector('.dsh-model-picker-fav')).not.toBeNull()
      expect(stored().favorites).toEqual(['grok-4.7'])

      // Move the Gemini card to the end through the same menu.
      menu = await openMenuOn(1)
      expect(cardsNow()[1]!.getAttribute('data-card-key')).toBe('gemini-4-neon')
      await env.click(menuItem(menu, 'Move to end'))
      expect(cardsNow().map(card => card.getAttribute('data-card-key'))).toEqual([
        'grok-4.7', 'grok-4.6', 'gemini-4-neon',
      ])
      expect(stored().order).toEqual(['grok-4.7', 'grok-4.6', 'gemini-4-neon'])

      // Hide Grok 4.6: it leaves the grid and the toolbar toggle appears.
      menu = await openMenuOn(1)
      expect(cardsNow()[1]!.getAttribute('data-card-key')).toBe('grok-4.6')
      await env.click(menuItem(menu, 'Hide'))
      expect(cardsNow().map(card => card.getAttribute('data-card-key'))).toEqual(['grok-4.7', 'gemini-4-neon'])
      const toggle = doc.querySelector<HTMLButtonElement>('.dsh-model-picker-hiddenToggle')!
      expect(toggle).not.toBeNull()
      expect(toggle.textContent).toBe('Hidden (1)')
      expect(toggle.getAttribute('aria-pressed')).toBe('false')

      // The toggle reveals it dimmed; its menu offers Unhide which restores it.
      await env.click(toggle)
      const revealed = cardsNow().find(card => card.getAttribute('data-card-key') === 'grok-4.6')!
      expect(revealed.hasAttribute('data-hidden')).toBe(true)
      menu = await openMenuOn(cardsNow().indexOf(revealed))
      await env.click(menuItem(menu, 'Unhide'))
      expect(cardsNow().find(card => card.getAttribute('data-card-key') === 'grok-4.6')!.hasAttribute('data-hidden')).toBe(false)
      expect(doc.querySelector('.dsh-model-picker-hiddenToggle')).toBeNull()

      // Rename enters the same inline edit mode as the double-click path.
      menu = await openMenuOn(0)
      await env.click(menuItem(menu, 'Rename symbol'))
      expect(cardsNow()[0]!.querySelector('.dsh-model-picker-shortInput')).not.toBeNull()
    } finally { await env.done(root) }
  })

  it('does not open the card context menu while disabled', async () => {
    const env = jsdomEnv()
    const root = mount(env.dom)
    const Probe = (props: { disabled?: boolean }): React.ReactElement => (
      <ModelPicker
        {...kit}
        disabled={props.disabled}
        choices={choices}
        selected={{ provider: 'google', model: 'gemini-4-neon' }}
        onPick={() => {}}
        efforts={[{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }]}
        selectedEffort="high"
        onPickEffort={() => {}}
      />
    )
    try {
      await act(async () => root.render(<Probe disabled={false} />))
      const doc = env.dom.window.document
      await env.click(doc.querySelector('button')!)
      await act(async () => root.render(<Probe disabled={true} />))
      const card = doc.querySelector<HTMLElement>('.dsh-model-picker-card')!
      await act(async () => Simulate.contextMenu(card, { clientX: 40, clientY: 50 }))
      expect(doc.querySelector('.dsh-model-picker-cardMenu')).toBeNull()
    } finally { await env.done(root) }
  })
})

describe('ModelPicker factory component (list view)', () => {
  const choices = directoryChoices(groups)
  const kit = {
    t: pickerCopy('en'),
    useFactorySlot: (_name: string, fallback: unknown) => fallback,
    useActiveLocale: (selector?: (s: { active: string }) => unknown) => selector ? selector({ active: 'en' }) : { active: 'en' },
  }

  it('opens on the model pane with a visible search row, a real range slider, and trigger aria', async () => {
    const env = jsdomEnv({ viewMode: 'list' })
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
    const env = jsdomEnv({ viewMode: 'list' })
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
    const env = jsdomEnv({ viewMode: 'list' })
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
    const env = jsdomEnv({ viewMode: 'list' })
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
      const twoRow = [...env.dom.window.document.querySelectorAll('[role="menuitemradio"]')].find(row => row.textContent?.includes('Two'))!
      await env.click(twoRow)
      expect(onPick).toHaveBeenCalledWith({ provider: 'p', model: 'two' })
      expect(env.dom.window.document.querySelector('.dsh-model-menu-menu')).toBe(menu)
      await act(async () => root.render(<Harness saving={true} />))
      expect(env.dom.window.document.querySelector('.dsh-model-menu-menu')).toBe(menu)
      expect(env.dom.window.document.querySelector('[role="menuitemradio"]:not([disabled])')).toBeNull()
      await act(async () => root.render(<Harness saving={false} />))
      expect(env.dom.window.document.querySelector('.dsh-model-menu-menu')).toBe(menu)
      const slider = env.dom.window.document.querySelector<HTMLInputElement>('input[type="range"]')!
      await env.slide(slider, '1')
      expect(onPickEffort).toHaveBeenCalledWith('low')
      expect(env.dom.window.document.querySelector('.dsh-model-menu-menu')).toBe(menu)
      await act(async () => root.render(<Harness saving={true} />))
      expect(env.dom.window.document.querySelector('.dsh-model-menu-menu')).toBe(menu)
      await act(async () => env.dom.window.document.querySelector<HTMLInputElement>('[role="searchbox"]')!
        .dispatchEvent(new env.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
      expect(env.dom.window.document.querySelector('.dsh-model-menu-menu')).toBeNull()
    } finally { await env.done(root) }
  })

  it('one Escape closes the search-first picker from anywhere in the card', async () => {
    const env = jsdomEnv({ viewMode: 'list' })
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
    const env = jsdomEnv({ viewMode: 'list' })
    const root = mount(env.dom)
    const retry = vi.fn()
    try {
      await act(async () => root.render(<ModelPicker {...kit} choices={choices} onPick={() => {}}
        status={{ busy: true, error: 'boom', failures: [{ id: 'q', name: 'Q', message: 'down' }], retry }} />))
      await env.click(env.dom.window.document.querySelector('button')!)
      const banner = env.dom.window.document.querySelector('.dsh-model-picker-status')!
      expect(banner.textContent).toContain('boom')
      expect(banner.textContent).toContain('Q: down')
      expect(banner.textContent).not.toContain('Refreshing model list')
      await env.click(banner.querySelector('.dsh-model-picker-retry')!)
      expect(retry).toHaveBeenCalledTimes(1)
      await act(async () => root.render(<ModelPicker {...kit} choices={[]} onPick={() => {}}
        status={{ busy: true, retry }} />))
      await env.click(env.dom.window.document.querySelector('button')!)
      expect(env.dom.window.document.querySelector('.dsh-model-picker-status')!.textContent).toContain('Refreshing model list')
    } finally { await env.done(root) }
  })

  it('a custom anchor local component replaces the trigger and receives the contract props without DOM leakage warnings', async () => {
    const env = jsdomEnv({ viewMode: 'list' })
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
    const { directory } = makeDirectory({ current: { provider: 'p', model: 'one' } })
    const props = seatProps({ directory: directory as never })
    try {
      await act(async () => root.render(<ComposerModelSeat {...props} />))
      const trigger = env.dom.window.document.querySelector('button')!
      expect(trigger.textContent).toContain('模型默认')
      await env.click(trigger)
      const slider = env.dom.window.document.querySelector<HTMLInputElement>('input[type="range"]')!
      expect(slider.value).toBe('0')
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
      const slider = env.dom.window.document.querySelector<HTMLInputElement>('input[type="range"]')!
      await env.slide(slider, '1')
      expect(select).toHaveBeenCalledWith({ provider: 'p', model: 'one', reasoningEffort: 'low' })
      expect(env.dom.window.document.querySelector('input[type="range"]')).not.toBeNull()
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
      expect(env.dom.window.document.querySelector('.dsh-model-picker-status')).toBeNull()
      expect(env.dom.window.document.querySelector('input[type="range"]')).not.toBeNull()
      const twoRow = [...env.dom.window.document.querySelectorAll('[role="menuitemradio"]:not([disabled])')].find(row => row.textContent?.includes('Two'))
      expect(twoRow).not.toBeUndefined()
      const { directory: emptyDir } = makeDirectory({ status: 'loading', groups: [], current: null })
      await act(async () => root.render(<ComposerModelSeat {...seatProps({ directory: emptyDir as never, renderFactorySlot: undefined })} />))
      await env.click(env.dom.window.document.querySelector('button')!)
      expect(env.dom.window.document.querySelector('.dsh-model-picker-status')!.textContent).toContain('正在刷新模型列表')
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
      const groupsEl = env.dom.window.document.querySelector<HTMLElement>('.dsh-model-menu-groups')!
      const slider = env.dom.window.document.querySelector<HTMLInputElement>('input[type="range"]')!
      await act(async () => Simulate.change(search, { target: { value: 'Tw' } } as never))
      search.focus()
      groupsEl.scrollTop = 48
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
      expect(env.dom.window.document.querySelector('.dsh-model-menu-groups')).toBe(groupsEl)
      expect(env.dom.window.document.querySelector('input[type="range"]')).toBe(slider)
      expect(search.isConnected).toBe(true)
      expect(search.value).toBe('Tw')
      expect(env.dom.window.document.activeElement).toBe(search)
      expect(groupsEl.scrollTop).toBe(48)
      expect(props.load).toHaveBeenCalledTimes(loads)
      const twoRow = [...env.dom.window.document.querySelectorAll('[role="menuitemradio"]')].find(row => row.textContent?.includes('Two'))!
      await env.click(twoRow)
      expect(props.select).toHaveBeenCalledWith({ provider: 'p', model: 'two' })
      await act(async () => set({
        status: 'ready', pending: null,
        current: { provider: 'p', model: 'two', reasoningEffort: 'low' },
      }))
      expect(env.dom.window.document.querySelector('.dsh-model-menu-menu')).toBe(menu)
      expect(env.dom.window.document.querySelector('.dsh-model-menu-groups')).toBe(groupsEl)
      expect(search.value).toBe('Tw')
      expect(groupsEl.scrollTop).toBe(48)
      expect(props.load).toHaveBeenCalledTimes(loads)
    } finally { await env.done(root) }
  })
})
