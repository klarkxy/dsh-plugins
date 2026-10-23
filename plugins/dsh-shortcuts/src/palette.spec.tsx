// @vitest-environment jsdom
import React, { act, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ShortcutCommand } from '@deepseek-ai/dsh-client-shortcuts/client'
import { CommandPaletteModel } from './core.ts'
import { CommandPalettePanel } from './palette.tsx'

let root: Root | undefined
let model: CommandPaletteModel | undefined
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
afterEach(async () => { await act(async () => root?.unmount()); model?.dispose(); document.body.innerHTML = '' })

async function mount(run = vi.fn()) {
  model = new CommandPaletteModel({ shortcuts: { register: () => () => {} }, afterClose: () => Promise.resolve() })
  const first: ShortcutCommand = { id: 'first' as never, label: () => 'First action', aliases: ['alpha'], defaults: {}, regions: ['page'], modals: [], resolve: () => ({ status: 'handled', run }) }
  model.register(first)
  model.register({ ...first, id: 'second' as never, label: () => 'Second action', aliases: ['beta'] })
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  const state = model.state
  await act(async () => {
    model!.open({ region: 'page', modal: null, target: null })
    root!.render(<CommandPalettePanel locale="en" usePalette={selector => selector(useSyncExternalStore(state.subscribe, state.getSnapshot))} useCatalog={selector => selector([])}
      close={() => model!.close()} execute={id => model!.execute(id)} clearError={() => model!.clearError()} openSettings={vi.fn()} />)
  })
  return { run, input: document.querySelector<HTMLInputElement>('input')! }
}
function key(input: HTMLInputElement, name: string, extra = {}) { input.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...extra })) }

describe('command palette interaction', () => {
  it('focuses search, moves selection, and executes once without triggering during IME', async () => {
    const { input, run } = await mount()
    expect(document.activeElement).toBe(input)
    await act(async () => { key(input, 'Enter', { isComposing: true }); key(input, 'Enter', { repeat: true }) })
    expect(run).not.toHaveBeenCalled()
    await act(async () => key(input, 'ArrowDown'))
    expect(document.querySelector('[aria-selected="true"]')?.textContent).toContain('Second action')
    await act(async () => { key(input, 'Enter'); key(input, 'Enter') })
    expect(run).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
  it('filters by aliases and reflects late unregistration', async () => {
    const { input } = await mount()
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'beta')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1)
    expect(document.querySelector('[role="option"]')?.textContent).toContain('Second')
    await act(async () => model!.dispose())
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
  it('keeps execution errors visible after the modal closes, toasting for five seconds', async () => {
    const { input } = await mount(vi.fn(() => { throw Error('Action failed') }))
    await act(async () => key(input, 'Enter'))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    const toast = document.querySelector('[role="alert"]')
    expect(toast?.textContent).toContain('Action failed')
    const dismiss = [...toast!.querySelectorAll('button')].find(button => button.textContent === 'Dismiss')!
    await act(async () => dismiss.click())
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })
})
