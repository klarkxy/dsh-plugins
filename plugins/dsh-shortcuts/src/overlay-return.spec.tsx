// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import React, { act, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShortcutCommand, Shortcuts } from '@deepseek-ai/dsh-client-shortcuts/client'
import { apply } from './client.tsx'
import { PALETTE_ID } from './web-trigger.ts'

/*
 * The palette reopens from its own shortcut manager, and the manager's dialog
 * is still mounted at that instant. Capturing the input context there reported
 * `modal: 'other'`, so every normally-registered command
 * (`modals: []`) refused to run. This spec mounts the real `shell.overlay`
 * component the plugin registers, drives the actual palette → settings →
 * palette round trip, and executes a normally-registered command.
 */

let root: Context | undefined
let react: Root | undefined
let container: HTMLElement | undefined

const source = <T,>(value: T) => ({ getSnapshot: () => value, subscribe: () => () => {} })

/** Wire the injected stores into the selector hooks the host hands to a seat. */
function seat(injected: any) {
  const use = <T,>(store: { getSnapshot(): T; subscribe(listener: () => void): () => void }) =>
    <S,>(selector: (snapshot: T) => S): S => selector(useSyncExternalStore(store.subscribe, store.getSnapshot))
  return { ...injected,
    useLocale: use(injected.hooks.locale), usePalette: use(injected.hooks.palette),
    useCatalog: use(injected.hooks.catalog), useFixedCatalog: use(injected.hooks.fixedCatalog),
    useConfig: use(injected.hooks.config), useTrigger: use(injected.hooks.trigger),
    useFixedBindings: use(injected.hooks.fixedBindings), useDispatchStatus: use(injected.hooks.dispatchStatus),
  }
}

const byLabel = (label: string, scope: ParentNode = document) =>
  [...scope.querySelectorAll<HTMLElement>('button')]
    .find(node => node.textContent === label || node.getAttribute('aria-label') === label)

/** The palette's `afterClose` waits one animation frame before running. */
const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

async function click(node: HTMLElement | undefined, message: string) {
  expect(node, message).toBeTruthy()
  await act(async () => { node!.click(); await nextFrame() })
}

const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0))

/** Stand up the real plugin on a controlled host and mount its overlay seat. */
async function mountOverlay() {
  root = new Context()
  const registrations = new Map<string, { spec: any; render: any }>()
  const commands = new Map<string, ShortcutCommand>()
  const memory = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value) },
    removeItem: (key: string) => { memory.delete(key) },
    clear: () => { memory.clear() },
    key: (index: number) => [...memory.keys()][index] ?? null,
    get length() { return memory.size },
  })
  const native = {
    runtime: 'web', platform: 'windows', stopSequenceMs: 0,
    catalog: source([]), fixedCatalog: source([]),
    config: source({ status: 'ready', revision: 'r1', sequence: 1, error: null, usingDefaults: true, document: { schemaVersion: 2, profiles: {} } } as never),
    register: (row: ShortcutCommand) => { commands.set(row.id, row); return () => { commands.delete(row.id) } },
    describeBinding: (binding: never) => ({ binding, keys: [], issue: null, conflicts: [] }),
    edit: vi.fn(), recording: vi.fn(async () => {}),
  } as unknown as Shortcuts
  root.provide('shortcuts', native)
  root.provide('locale', source({ active: 'en' }) as never)
  root.provide('slots', {
    inject: (_key: string, run: () => () => void) => root!.effect(run),
    register: (spec: any, render: any) => { registrations.set(spec.name, { spec, render }); return () => { registrations.delete(spec.name) } },
  } as never)
  root.plugin({ name: 'shortcuts-under-test', apply })
  await settle()
  return { commands, overlay: registrations.get('shell.overlay')! }
}

/** Register a palette command owned by another plugin, as a real consumer does. */
async function contribute(id: string, command: Omit<ShortcutCommand, 'id'>) {
  root!.plugin({ name: `consumer-${id}`, inject: ['commandPalette'], apply(ctx) {
    ctx.commandPalette.register({ ...command, id: id as never } as ShortcutCommand)
  } })
  await settle()
}

async function mount(overlay: { spec: any; render: any }) {
  container = document.createElement('div')
  document.body.append(container)
  react = createRoot(container)
  await act(async () => { react!.render(React.createElement(overlay.render, seat(overlay.spec.inject()))) })
}

const enter = async () => {
  const input = document.querySelector<HTMLInputElement>('.shortcuts-palette input')!
  expect(input, 'the palette search input is mounted').toBeTruthy()
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await nextFrame()
  })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(async () => {
  await act(async () => react?.unmount())
  react = undefined
  await root?.fiber.dispose()
  root = undefined
  container?.remove()
  container = undefined
  document.body.innerHTML = ''
  window.localStorage?.clear()
  vi.unstubAllGlobals()
})

describe('command palette round trip through the shortcut manager', () => {
  it('reopens with the pre-settings context and executes a normal command once', async () => {
    const run = vi.fn()
    const { commands, overlay } = await mountOverlay()

    // A real owner contributing a normal command: page region, no modal scope.
    await contribute('consumer.action', { label: () => 'Consumer action', aliases: ['consumer'],
      defaults: {}, regions: ['page', 'editable'], modals: [], resolve: () => ({ status: 'handled', run }) })

    // The user opened the palette from an editable region: that context must survive.
    document.body.innerHTML = '<div data-composer-input contenteditable="true" tabindex="0"></div>'
    const editor = document.querySelector<HTMLElement>('[data-composer-input]')!
    editor.focus()

    await mount(overlay)

    // 1. Open the palette through the plugin's own entry, as the host would.
    const palette = commands.get(PALETTE_ID)!
    await act(async () => {
      const resolution = palette.resolve({ region: 'editable', modal: null, target: editor })
      if (resolution.status === 'handled') resolution.run()
    })
    expect(root.commandPalette.state.getSnapshot().open).toBe(true)
    expect(document.querySelector('.shortcuts-palette')).toBeTruthy()
    expect(overlay.spec.inject().currentContext()?.modal).toBeNull()

    // 2. The manager opens from the palette.
    await click(byLabel('View and edit all shortcuts'), 'palette opens the shortcut manager')
    expect(root.commandPalette.state.getSnapshot().open).toBe(false)
    expect(document.querySelector('.shortcuts-settings-modal')).toBeTruthy()

    // 3. Return to the palette from inside the manager, whose dialog is still mounted.
    await click(byLabel('Open shortcut palette', document.querySelector('.shortcuts-settings-modal')!),
      'the manager returns to the palette')
    expect(document.querySelector('.shortcuts-settings-modal')).toBeNull()
    expect(root.commandPalette.state.getSnapshot().open).toBe(true)
    expect(root.commandPalette.state.getSnapshot().error).toBeNull()

    // 4. A normal command runs exactly once in the retained pre-settings context.
    expect(document.querySelectorAll('.shortcuts-palette [role="option"]').length).toBe(1)
    expect(overlay.spec.inject().currentContext()?.modal).toBeNull()
    expect(overlay.spec.inject().currentContext()?.region).toBe('editable')
    await enter()
    expect(run).toHaveBeenCalledTimes(1)
    expect(root.commandPalette.state.getSnapshot().open).toBe(false)
    expect(root.commandPalette.state.getSnapshot().error).toBeNull()
  })

  it('keeps the modal restriction for a command that never allowed one', async () => {
    const run = vi.fn()
    const { overlay } = await mountOverlay()

    // The palette is opened from inside somebody else's unnamed dialog.
    document.body.innerHTML = '<div role="dialog" aria-modal="true"><input id="foreign"></div>'
    const foreign = document.querySelector<HTMLElement>('#foreign')!
    foreign.focus()
    await contribute('consumer.page-only', { label: () => 'Page only', aliases: ['page-only'],
      defaults: {}, regions: ['page'], modals: [], resolve: () => ({ status: 'handled', run }) })
    await mount(overlay)

    // The host entry is refused while a foreign dialog owns the input, so drive
    // the model directly with the context the host would have reported.
    await act(async () => { root!.commandPalette.open({ region: 'page', modal: 'other', target: foreign }) })
    expect(root.commandPalette.state.getSnapshot().open).toBe(true)
    await enter()
    expect(run).not.toHaveBeenCalled()
    expect(root.commandPalette.state.getSnapshot().error).toContain('original input context')
  })

  it('keeps the plugin page entry working with no palette session behind it', async () => {
    const run = vi.fn()
    const { overlay } = await mountOverlay()
    await contribute('consumer.action', { label: () => 'Consumer action', aliases: ['consumer'],
      defaults: {}, regions: ['page', 'editable'], modals: [], resolve: () => ({ status: 'handled', run }) })
    document.body.innerHTML = '<div id="host" contenteditable="true" tabindex="0">host</div>'
    const host = document.querySelector<HTMLElement>('#host')!
    host.focus()
    await mount(overlay)

    // Nothing opened the palette first, so the entry captures the live document.
    const injected = overlay.spec.inject()
    expect(root!.commandPalette.state.getSnapshot().open).toBe(false)
    await act(async () => { injected.openPalette() })
    expect(root!.commandPalette.state.getSnapshot().open).toBe(true)
    await enter()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('never carries an earlier session context into a later ordinary open', async () => {
    const run = vi.fn()
    const { overlay } = await mountOverlay()
    const seen: (Element | null)[] = []
    await contribute('consumer.records', { label: () => 'Records target', aliases: ['records'],
      defaults: {}, regions: ['page', 'editable'], modals: [],
      resolve: captured => { seen.push(captured.target); return { status: 'handled', run } } })
    document.body.innerHTML =
      '<div id="a" contenteditable="true" tabindex="0">A</div><div id="b" contenteditable="true" tabindex="0">B</div>'
    const a = document.querySelector<HTMLElement>('#a')!
    const b = document.querySelector<HTMLElement>('#b')!
    await mount(overlay)
    const injected = overlay.spec.inject()

    // 1. Open from input A and close again, leaving nothing behind.
    a.focus()
    await act(async () => { injected.openPalette() })
    expect(root!.commandPalette.state.getSnapshot().open).toBe(true)
    await act(async () => { root!.commandPalette.close() })
    expect(root!.commandPalette.state.getSnapshot().open).toBe(false)

    // 2. An ordinary open from input B must use B, not the earlier A context.
    b.focus()
    await act(async () => { injected.openPalette() })
    await enter()
    expect(seen).toEqual([b])
    expect(seen).not.toContain(a)
    expect(run).toHaveBeenCalledTimes(1)

    // 3. The same holds once a foreign modal owns the input: a stale editable
    //    context must not let a modal-refused command run.
    document.body.insertAdjacentHTML('beforeend', '<div role="dialog" aria-modal="true"><input id="foreign"></div>')
    const foreign = document.querySelector<HTMLElement>('#foreign')!
    foreign.focus()
    await act(async () => { injected.openPalette() })
    await enter()
    expect(root!.commandPalette.state.getSnapshot().error).toContain('original input context')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('drops the saved context when the manager is cancelled instead of used', async () => {
    const run = vi.fn()
    const seen: (Element | null)[] = []
    const { overlay } = await mountOverlay()
    await contribute('consumer.records', { label: () => 'Records target', aliases: ['records'],
      defaults: {}, regions: ['page', 'editable'], modals: [],
      resolve: captured => { seen.push(captured.target); return { status: 'handled', run } } })
    document.body.innerHTML =
      '<div id="a" contenteditable="true" tabindex="0">A</div><div id="b" contenteditable="true" tabindex="0">B</div>'
    const b = document.querySelector<HTMLElement>('#b')!
    await mount(overlay)
    const injected = overlay.spec.inject()

    // Start a round trip from A and cancel the manager instead of using it.
    document.querySelector<HTMLElement>('#a')!.focus()
    await act(async () => { injected.openPalette() })
    await click(byLabel('View and edit all shortcuts'), 'palette opens the shortcut manager')
    await click(byLabel('Close'), 'the manager closes')
    expect(document.querySelector('.shortcuts-settings-modal')).toBeNull()

    // A second round trip, now from B, must resume from B rather than the
    // context the cancelled manager saved.
    b.focus()
    await act(async () => { injected.openPalette() })
    await click(byLabel('View and edit all shortcuts'), 'the palette opens the manager again')
    await click(byLabel('Open shortcut palette', document.querySelector('.shortcuts-settings-modal')!),
      'the manager returns to the palette')
    await enter()
    expect(seen).toEqual([b])
    expect(run).toHaveBeenCalledTimes(1)
  })
})
