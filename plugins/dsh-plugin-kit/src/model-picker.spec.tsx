import { act, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import {
  MODEL_PICKER_FACTORY, renderModelPicker, useModelMenuAnchor, type ModelPickerProps, type RenderFactorySlot,
} from './model-picker.tsx'

async function useDom(run: (dom: JSDOM) => Promise<void>): Promise<void> {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const previous = new Map<string, unknown>()
  const assign = (key: string, value: unknown) => {
    previous.set(key, (globalThis as Record<string, unknown>)[key])
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  assign('window', dom.window)
  assign('document', dom.window.document)
  assign('HTMLElement', dom.window.HTMLElement)
  assign('HTMLButtonElement', dom.window.HTMLButtonElement)
  assign('Node', dom.window.Node)
  assign('IS_REACT_ACT_ENVIRONMENT', true)
  try {
    await run(dom)
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete (globalThis as Record<string, unknown>)[key]
      else Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
    dom.window.close()
  }
}

/** Factory occurrence double: renders the input props the factory contract declares. */
function MockModelPicker(props: ModelPickerProps & {
  /** Stand-in for the local-slot selection the caller passes via options.slots. */
  anchor?: (props: { open: boolean; disabled: boolean; busy: boolean; label: string; effortLabel?: string }) => ReactNode
}): ReactNode {
  const { anchor: Anchor, ...input } = props
  return <div data-testid="factory-picker" data-disabled={input.disabled || undefined}
    data-selected={input.selected ? `${input.selected.provider}/${input.selected.model}` : ''}>
    {Anchor ? <Anchor open={false} disabled={input.disabled === true} busy={input.busy === true}
      label={input.triggerLabel ?? ''} effortLabel={input.triggerEffortLabel} /> : null}
    <button type="button" data-testid="factory-pick" onClick={() => input.onPick({ provider: 'p', model: 'b' })}>pick</button>
    <button type="button" data-testid="factory-effort" onClick={() => input.onPickEffort?.('high')}>effort</button>
    <button type="button" data-testid="factory-leading" onClick={() => input.onPickLeading?.('default')}>leading</button>
  </div>
}

/**
 * The real registry, not a presence flag: `renderFactorySlot` resolves the
 * registered definition and the caller's fallback when it is absent — the same
 * semantics the renderer's FactoryOutlet implements. A stub is still needed
 * because the outlet itself lives in the host composition; what this exercises
 * end-to-end is registration, unregistration, and the consumer's props path.
 */
function coreRenderFactorySlot(core: SlotCore, last: { props?: ModelPickerProps }): RenderFactorySlot {
  return ((name: string, props: ModelPickerProps, options?: {
    slots?: { anchor?: (props: { open: boolean; disabled: boolean; busy: boolean; label: string; effortLabel?: string }) => ReactNode }
    fallback?: ReactNode
  }) => {
    if (name !== MODEL_PICKER_FACTORY) return options?.fallback ?? null
    last.props = props
    return core.factory(name)
      ? <MockModelPicker {...props} anchor={options?.slots?.anchor} />
      : (options?.fallback ?? null)
  }) as RenderFactorySlot
}

const props: ModelPickerProps = {
  locale: 'en',
  choices: [{ provider: 'p', model: 'a', label: 'P / A', efforts: [] }, { provider: 'p', model: 'b', label: 'P / B', efforts: [] }],
  selected: { provider: 'p', model: 'a' },
  onPick: vi.fn(),
  onPickEffort: vi.fn(),
  leading: [{ id: 'default', label: 'Follow default', selected: false }],
  onPickLeading: vi.fn(),
  disabled: true,
  triggerLabel: 'P / A',
  listClassName: 'ams-root ams-menu-portal',
  modelLabel: 'Auxiliary model',
  modelValue: 'P / A',
}

describe('renderModelPicker', () => {
  it('renders the fallback verbatim when no factory renderer exists at all', () => {
    const fallback = <span data-testid="fallback-menu" />
    expect(renderModelPicker(undefined, props, { fallback })).toBe(fallback)
  })

  it('renders the fallback while the factory is unregistered, then the factory once registered, and back after unload', async () => {
    await useDom(async dom => {
      const core = new SlotCore()
      const last: { props?: ModelPickerProps } = {}
      const renderFactorySlot = coreRenderFactorySlot(core, last)
      const register = () => core.registerFactory(
        {
          name: MODEL_PICKER_FACTORY, scope: 'root', locale: 'model-picker',
          inject: () => ({ hooks: { activeLocale: { getSnapshot: () => ({ active: 'en' }), subscribe: () => () => {} } } }),
          slots: { anchor: { scope: 'root' } },
        },
        MockModelPicker as never,
      )
      function Seat(): ReactNode {
        // The renderer resolves presence per occurrence; subscribeFactory keeps
        // this test's stand-in outlet in step with register/unregister.
        useSyncExternalStore(
          notify => core.subscribeFactory(MODEL_PICKER_FACTORY, notify),
          () => core.factoryVersion(MODEL_PICKER_FACTORY),
        )
        return renderModelPicker(renderFactorySlot, props, { fallback: <span data-testid="fallback-menu">menu</span> })
      }
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<Seat />)
        })
        expect(dom.window.document.querySelector('[data-testid="fallback-menu"]')).toBeTruthy()
        expect(dom.window.document.querySelector('[data-testid="factory-picker"]')).toBeNull()
        const dispose = register()
        await act(async () => { await Promise.resolve() })
        expect(dom.window.document.querySelector('[data-testid="factory-picker"]')).toBeTruthy()
        expect(dom.window.document.querySelector('[data-testid="fallback-menu"]')).toBeNull()
        expect(last.props).toMatchObject({ selected: { provider: 'p', model: 'a' }, disabled: true, triggerLabel: 'P / A' })
        expect(last.props?.listClassName).toBe('ams-root ams-menu-portal')
        // The definition leaves the registry: the next render falls back.
        dispose()
        await act(async () => { await Promise.resolve() })
        expect(dom.window.document.querySelector('[data-testid="fallback-menu"]')).toBeTruthy()
        expect(dom.window.document.querySelector('[data-testid="factory-picker"]')).toBeNull()
      } finally {
        await act(async () => root?.unmount())
      }
    })
  })

  it('closes the fallback open state when the factory unloads mid-open', async () => {
    await useDom(async dom => {
      const core = new SlotCore()
      const last: { props?: ModelPickerProps } = {}
      const renderFactorySlot = coreRenderFactorySlot(core, last)
      const register = () => core.registerFactory(
        {
          name: MODEL_PICKER_FACTORY, scope: 'root', locale: 'model-picker',
          inject: () => ({ hooks: { activeLocale: { getSnapshot: () => ({ active: 'en' }), subscribe: () => () => {} } } }),
          slots: { anchor: { scope: 'root' } },
        },
        MockModelPicker as never,
      )
      function Seat(): ReactNode {
        useSyncExternalStore(
          notify => core.subscribeFactory(MODEL_PICKER_FACTORY, notify),
          () => core.factoryVersion(MODEL_PICKER_FACTORY),
        )
        const [menuOpen, setMenuOpen] = useState(false)
        const anchor = useModelMenuAnchor('Model: P / A', undefined, () => setMenuOpen(false))
        const rendered = renderModelPicker(renderFactorySlot, {
          ...props,
          onOpenChange: next => setMenuOpen(next),
        }, {
          anchor,
          fallback: <span data-testid="fallback-menu" data-open={menuOpen}>menu</span>,
        })
        return rendered
      }
      let root: Root | undefined
      try {
        const dispose = register()
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<Seat />)
        })
        expect(dom.window.document.querySelector('[data-testid="factory-picker"]')).toBeTruthy()
        // The factory opened its menu: the shared open state is true.
        await act(async () => { last.props?.onOpenChange?.(true) })
        expect(dom.window.document.querySelector('[data-testid="fallback-menu"]')).toBeNull()
        // Unload while "open": the anchor's unmount cleanup clears the shared
        // state, so the fallback that replaces the occurrence starts closed.
        dispose()
        await act(async () => { await Promise.resolve() })
        const fallback = dom.window.document.querySelector('[data-testid="fallback-menu"]')!
        expect(fallback).toBeTruthy()
        expect(fallback.getAttribute('data-open')).toBe('false')
      } finally {
        await act(async () => root?.unmount())
      }
    })
  })

  it('forwards the consumer callbacks through the factory occurrence props', async () => {
    await useDom(async dom => {
      const core = new SlotCore()
      const last: { props?: ModelPickerProps } = {}
      core.registerFactory(
        {
          name: MODEL_PICKER_FACTORY, scope: 'root', locale: 'model-picker',
          inject: () => ({ hooks: { activeLocale: { getSnapshot: () => ({ active: 'en' }), subscribe: () => () => {} } } }),
          slots: { anchor: { scope: 'root' } },
        },
        MockModelPicker as never,
      )
      const onPick = vi.fn()
      const onPickEffort = vi.fn()
      const onPickLeading = vi.fn()
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(renderModelPicker(coreRenderFactorySlot(core, last),
            { ...props, onPick, onPickEffort, onPickLeading },
            { fallback: <span data-testid="fallback-menu" /> }) as never)
        })
        await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[data-testid="factory-pick"]')!.click())
        expect(onPick).toHaveBeenCalledWith({ provider: 'p', model: 'b' })
        await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[data-testid="factory-effort"]')!.click())
        expect(onPickEffort).toHaveBeenCalledWith('high')
        await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[data-testid="factory-leading"]')!.click())
        expect(onPickLeading).toHaveBeenCalledWith('default')
      } finally {
        await act(async () => root?.unmount())
      }
    })
  })
})

describe('useModelMenuAnchor', () => {
  it('renders the shared trigger chrome: label, effort suffix, aria, and chevron state', async () => {
    await useDom(async dom => {
      function Seat(): ReactNode {
        const anchor = useModelMenuAnchor('Model: P / A', 'p / a')
        const Trigger = anchor
        return <>
          <Trigger open={false} disabled={false} busy={false} label="P / A" effortLabel=" · high" />
          <Trigger open disabled busy={false} label="P / B" />
        </>
      }
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<Seat />)
        })
        const triggers = [...dom.window.document.querySelectorAll<HTMLButtonElement>('.dsh-model-menu-trigger')]
        expect(triggers).toHaveLength(2)
        const [closed, open] = triggers
        expect(closed.getAttribute('aria-label')).toBe('Model: P / A')
        expect(closed.getAttribute('aria-haspopup')).toBe('menu')
        expect(closed.getAttribute('aria-expanded')).toBe('false')
        expect(closed.querySelector('.dsh-model-menu-triggerLabel')!.textContent).toBe('P / A')
        expect(closed.querySelector('.dsh-model-menu-triggerEffort')!.textContent).toBe(' · high')
        // SVG className is an SVGAnimatedString: assert on the attribute/classList.
        expect(closed.querySelector('.dsh-model-menu-chevron')!.getAttribute('class')).not.toContain('dsh-model-menu-chevronOpen')
        expect(open.getAttribute('aria-expanded')).toBe('true')
        expect(open.querySelector('.dsh-model-menu-chevron')!.classList.contains('dsh-model-menu-chevronOpen')).toBe(true)
        expect(open.querySelector('.dsh-model-menu-triggerEffort')).toBeNull()
      } finally {
        await act(async () => root?.unmount())
      }
    })
  })

  it('keeps the same trigger node when the route label changes and still closes on a real unmount', async () => {
    await useDom(async dom => {
      const closes = vi.fn()
      function Seat({ label, title }: { label: string; title: string }): ReactNode {
        const Trigger = useModelMenuAnchor(label, title, closes)
        return <Trigger open={false} disabled={false} busy={false} label="shown" />
      }
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<Seat label="Model: A" title="a" />)
        })
        const button = dom.window.document.querySelector('button')!
        expect(button.getAttribute('aria-label')).toBe('Model: A')
        expect(button.getAttribute('title')).toBe('a')
        await act(async () => root!.render(<Seat label="Model: B" title="b" />))
        const again = dom.window.document.querySelector('button')!
        expect(again).toBe(button)
        expect(again.getAttribute('aria-label')).toBe('Model: B')
        expect(again.getAttribute('title')).toBe('b')
        expect(closes).not.toHaveBeenCalled()
        await act(async () => root!.unmount())
        root = undefined
        expect(closes).toHaveBeenCalledTimes(1)
      } finally {
        if (root) await act(async () => root?.unmount())
      }
    })
  })
})
