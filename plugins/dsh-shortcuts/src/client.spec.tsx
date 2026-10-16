// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ShortcutCommand } from '@deepseek-ai/dsh-client-shortcuts/client'
import { apply, CommandPaletteService } from './client.tsx'
import { CommandPaletteModel } from './core.ts'
import { PALETTE_ID } from './web-trigger.ts'

const roots: Context[] = []
afterEach(async () => { for (const root of roots.splice(0)) await root.fiber.dispose(); document.body.innerHTML = ''; window.localStorage?.clear(); vi.unstubAllGlobals() })
const source = <T,>(value: T) => ({ getSnapshot: () => value, subscribe: () => () => {} })
const command = (id: string): ShortcutCommand => ({ id: id as never, label: () => id, aliases: [], defaults: {}, regions: ['page'], modals: [], resolve: () => ({ status: 'handled', run: vi.fn() }) })

describe('Cordis command palette integration', () => {
  it('exposes the current palette context value through the service API', async () => {
    const root = new Context(); roots.push(root)
    const model = new CommandPaletteModel({ shortcuts: { register: () => () => {} } })
    const service = new CommandPaletteService(root, model)
    const target = document.createElement('input')
    const context = { region: 'editable', modal: null, target } as const
    expect(service.currentContext()).toBeNull()
    service.open(context)
    expect(service.currentContext()).toEqual({ ...context, source: 'menu' })
    service.close()
    expect(service.currentContext()).toBeNull()
  })

  it('releases each registration with the contributing plugin, retaining other owners', async () => {
    const root = new Context(); roots.push(root)
    const native = new Map<string, ShortcutCommand>()
    const model = new CommandPaletteModel({ shortcuts: { register: value => { native.set(value.id, value); return () => { native.delete(value.id) } } } })
    root.plugin({ name: 'palette-provider', apply(ctx) { new CommandPaletteService(ctx, model) } })
    const first = root.plugin({ name: 'first-owner', inject: ['commandPalette'], apply(ctx) { ctx.commandPalette.register(command('first')) } })
    const second = root.plugin({ name: 'second-owner', inject: ['commandPalette'], apply(ctx) { ctx.commandPalette.register(command('second')) } })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect([...native.keys()]).toEqual(['first', 'second'])
    await first.dispose()
    expect([...native.keys()]).toEqual(['second'])
    expect(model.state.getSnapshot().commands.map(row => row.id)).toEqual(['second'])
    await second.dispose()
    expect(native.size).toBe(0)
  })
  it('registers native settings and overlay seats, supports late contributors, and removes effects on unload', async () => {
    const root = new Context(); roots.push(root)
    const registrations = new Map<string, { spec: any; render: any }>()
    const commands = new Map<string, ShortcutCommand>()
    const unregister = vi.fn((id: string) => commands.delete(id))
    const native = {
      runtime: 'web', platform: 'windows', catalog: source([]), fixedCatalog: source([{ id: 'fixed.send', group: 'input', label: 'Send', keys: ['Enter'], bindings: [{ code: 'Enter', modifiers: [] }] }]), config: source({ status: 'ready', revision: 'r1' }),
      register: (row: ShortcutCommand) => { commands.set(row.id, row); return () => unregister(row.id) }, describeBinding: vi.fn(binding => ({ binding, keys: [], issue: null, conflicts: [] })), edit: vi.fn(), recording: vi.fn(),
    }
    root.provide('shortcuts', native as never)
    root.provide('locale', source({ active: 'en' }) as never)
    root.provide('slots', {
      inject: (_key: string, run: () => () => void) => root.effect(run),
      register: (spec: any, render: any) => { registrations.set(spec.name, { spec, render }); return () => { registrations.delete(spec.name) } },
    } as never)
    const memory = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value) }, removeItem: (key: string) => { memory.delete(key) }, clear: () => { memory.clear() }, key: (index: number) => [...memory.keys()][index] ?? null, get length() { return memory.size } })
    const plugin = root.plugin({ name: 'shortcuts-under-test', apply })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(registrations.get('plugins.bundle.config')?.spec.key).toBe('@klarkxy/dsh-shortcuts')
    expect(registrations.get('shell.overlay')?.spec.id).toBe('@klarkxy/dsh-shortcuts.palette')
    expect(commands.has(PALETTE_ID)).toBe(true)
    const injected = registrations.get('plugins.bundle.config')!.spec.inject()
    const revision = injected.hooks.fixedBindings.getSnapshot().revision
    expect(injected.fixedModel.setSlot('fixed.send', 0, { code: 'F8', modifiers: [] }, revision).status).toBe('saved')
    expect(injected.hooks.fixedBindings.getSnapshot().rows[0].bindingKeys).toEqual([['F8']])
    document.body.innerHTML = '<div data-composer-card><div data-composer-input data-lexical-editor="true" contenteditable="true" tabindex="0">draft</div></div>'
    const editor = document.querySelector('[data-composer-input]') as HTMLElement
    editor.focus()
    const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false)
    document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range)
    const sends: string[] = []
    editor.addEventListener('keydown', event => { if (event.key === 'Enter') { sends.push(event.key); event.preventDefault() } })
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8', code: 'F8', bubbles: true, cancelable: true }))
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))
    expect(sends).toEqual(['Enter'])
    expect(commands.get(PALETTE_ID)?.defaults['desktop:windows']).toEqual({ code: 'KeyP', modifiers: ['control', 'shift'] })
    // Web's separately configurable entry permits browser-owned alternatives such as Ctrl+K.
    expect(commands.get(PALETTE_ID)?.defaults['web:windows']).toBeUndefined()
    const owner = root.plugin({ name: 'consumer', inject: ['commandPalette'], apply(ctx) { ctx.commandPalette.register(command('consumer.action')) } })
    await new Promise(resolve => setTimeout(resolve, 0))
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', ctrlKey: true, shiftKey: true, cancelable: true }))
    expect(root.commandPalette.state.getSnapshot().open).toBe(true)
    expect(root.commandPalette.state.getSnapshot().commands.map(row => row.id)).toEqual(['consumer.action'])
    await owner.dispose()
    await plugin.dispose()
    expect(commands.size).toBe(0)
    expect(document.querySelector('style[data-plugin="@klarkxy/dsh-shortcuts"]')).toBeNull()
  })
})
