import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { createPresenceConfigModel, type PresenceHost } from './presence-model.ts'
import {
  AutoContinueSettings,
  ComposerSettings,
  HandoffSettings,
  ReturnSettings,
} from './settings-panel.tsx'
import { CONFIG_READ_ENDPOINT, CONFIG_WRITE_ENDPOINT, type ConfigView } from './contracts.ts'

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
  assign('Node', dom.window.Node)
  assign('Element', dom.window.Element)
  assign('HTMLButtonElement', dom.window.HTMLButtonElement)
  dom.window.HTMLElement.prototype.scrollIntoView = () => {}
  assign('HTMLInputElement', dom.window.HTMLInputElement)
  assign('MouseEvent', dom.window.MouseEvent)
  assign('Event', dom.window.Event)
  assign('InputEvent', dom.window.InputEvent)
  assign('KeyboardEvent', dom.window.KeyboardEvent)
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

const initial: ConfigView = {
  recapMinutes: 15, compactMinutes: 60, continueText: '', continueMode: 'fixed', model: null, ghostModel: null, judgeModel: null, handoffModel: null, autoContinueMode: 'off', autoContinueMax: 3,
  allowSelfFork: false, allowSendMessage: false,
}

/** A model whose reads/writes run through a caller-owned "stored" view. */
function configModel(host: { read: () => ConfigView; apply?: (patch: Partial<ConfigView>) => void }) {
  const patches: Partial<ConfigView>[] = []
  const rpc: PresenceHost['rpc'] = {
    call: vi.fn(async (_channel: string, endpoint: string, payload: unknown) => {
      if (endpoint === CONFIG_READ_ENDPOINT) return { ok: true, value: host.read() }
      if (endpoint === CONFIG_WRITE_ENDPOINT) {
        const patch = (payload as { patch: Partial<ConfigView> }).patch
        patches.push(patch)
        host.apply?.(patch)
        return { ok: true, value: host.read() }
      }
      return { ok: false, error: { code: 'session-manager/failed', message: 'unknown endpoint' } }
    }),
  }
  return { model: createPresenceConfigModel({ rpc }, () => Promise.resolve()), patches, rpc }
}

function button(dom: JSDOM, text: string): HTMLElement {
  const found = [...dom.window.document.querySelectorAll('button')].find(item => item.textContent === text)
  if (!found) throw new Error(`missing button ${text}`)
  return found
}

function switchRow(dom: JSDOM, label: string): HTMLElement {
  const found = [...dom.window.document.querySelectorAll('[role="switch"]')]
    .find(item => item.getAttribute('aria-label') === label) as unknown as HTMLElement | undefined
  if (!found) throw new Error(`missing switch ${label}`)
  return found
}

/** Each feature's ModelMenu trigger carries its row label in the aria-label. */
function modelTrigger(dom: JSDOM, label: string): HTMLButtonElement {
  const trigger = [...dom.window.document.querySelectorAll<HTMLButtonElement>('.dsh-model-menu-trigger')]
    .find(item => item.getAttribute('aria-label')?.startsWith(`${label}: `))
  if (!trigger) throw new Error(`missing model trigger for ${label}`)
  return trigger
}

function change(dom: JSDOM, element: HTMLElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement?.prototype ?? Object.getPrototypeOf(element), 'value')?.set
  if (element instanceof dom.window.HTMLInputElement && setter) setter.call(element, value)
  else (element as HTMLInputElement | HTMLSelectElement).value = value
  const propsKey = Object.keys(element).find(key => key.startsWith('__reactProps'))
  const props = propsKey ? (element as unknown as Record<string, { onChange?: (event: { target: HTMLElement; currentTarget: HTMLElement }) => void }>)[propsKey] : undefined
  if (props?.onChange) props.onChange({ target: element, currentTarget: element })
  element.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  element.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
}

function press(dom: JSDOM, element: HTMLElement, key: string): void {
  const propsKey = Object.keys(element).find(name => name.startsWith('__reactProps'))
  const props = propsKey ? (element as unknown as Record<string, { onKeyDown?: (event: { key: string }) => void }>)[propsKey] : undefined
  props?.onKeyDown?.({ key })
}

describe('session manager settings rows', () => {
  it('saves only the touched key when a model route is picked, and never rewrites an untouched effort route', async () => {
    await useDom(async dom => {
      const high = { provider: 'p', model: 'old', reasoningEffort: 'high' }
      let current: ConfigView = { ...initial, model: high, ghostModel: high }
      const { model, patches } = configModel({
        read: () => current,
        apply: patch => { current = { ...current, ...patch } },
      })
      let root: Root | undefined
      const catalog = async () => ({ groups: [{ id: 'p', name: 'Provider', models: [
        { id: 'old', name: 'Old' }, { id: 'next', name: 'Next' },
      ] }] })
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<ReturnSettings model={model} locale="en" modelCatalog={catalog} />)
        })
        // Re-picking the same route writes nothing: the effort stays on storage.
        await act(async () => { modelTrigger(dom, 'Recap model').click() })
        await act(async () => { dom.window.document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click() })
        await act(async () => {
          const old = [...dom.window.document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
            .find(item => item.textContent?.includes('Old'))!
          old.click()
        })
        expect(patches).toEqual([])
        expect(current.model).toEqual(high)

        // A different model is a one-key patch: a fresh route starts without
        // the old model's effort, and every other field is untouched.
        await act(async () => { modelTrigger(dom, 'Recap model').click() })
        await act(async () => { dom.window.document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click() })
        await act(async () => {
          const next = [...dom.window.document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
            .find(item => item.textContent?.includes('Next'))!
          next.click()
        })
        expect(patches).toEqual([{ model: { provider: 'p', model: 'next' } }])
        expect(current.model).toEqual({ provider: 'p', model: 'next' })
        expect(current.ghostModel).toEqual(high)
        expect(dom.window.document.body.textContent).toContain('Saved')
      } finally {
        await act(async () => root?.unmount())
      }
    })
  })

  it('keeps each feature model inside its own row', async () => {
    await useDom(async dom => {
      let current: ConfigView = { ...initial, continueMode: 'auto', recapMinutes: 0 }
      const { model, patches } = configModel({
        read: () => current,
        apply: patch => { current = { ...current, ...patch } },
      })
      const catalog = async () => ({ groups: [] })
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<>
            <div id="composer"><ComposerSettings model={model} locale="zh" modelCatalog={catalog} /></div>
            <div id="auto"><AutoContinueSettings model={model} locale="zh" modelCatalog={catalog} /></div>
            <div id="return"><ReturnSettings model={model} locale="zh" modelCatalog={catalog} /></div>
            <div id="handoff"><HandoffSettings model={model} locale="zh" modelCatalog={catalog} /></div>
          </>)
        })
        const triggerIn = (id: string) => [...dom.window.document.getElementById(id)!.querySelectorAll<HTMLButtonElement>('.dsh-model-menu-trigger')]
          .map(item => item.getAttribute('aria-label'))
        expect(triggerIn('composer')).toEqual(['生成模型: 默认辅助模型'])
        expect(triggerIn('auto')).toEqual(['判断模型: 默认辅助模型'])
        expect(triggerIn('return')).toEqual(['摘要模型: 默认辅助模型'])
        expect(triggerIn('handoff')).toEqual(['摘要模型: 默认辅助模型'])
        // The recap model follows its switch: disabled while recap is off.
        const recapTrigger = dom.window.document.getElementById('return')!.querySelector<HTMLButtonElement>('.dsh-model-menu-trigger')!
        expect(recapTrigger.disabled).toBe(true)
        await act(async () => { switchRow(dom, '显示会话摘要').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
        expect(recapTrigger.disabled).toBe(false)
        // The composer picker only exists in model-generated mode.
        await act(async () => { button(dom, '固定文本').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
        expect(triggerIn('composer')).toEqual([])
        expect(patches).toEqual([{ recapMinutes: 15 }, { continueMode: 'fixed' }])
        expect(dom.window.document.body.textContent).not.toContain('功能模型')
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('saves the segmented source instantly and a changed fixed text on blur', async () => {
    await useDom(async dom => {
      let current = initial
      const { model, patches } = configModel({
        read: () => current,
        apply: patch => { current = { ...current, ...patch } },
      })
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<ComposerSettings model={model} locale="zh" />)
        })
        // Fixed mode: the text field shows; the auto panel only carries a hint.
        expect(dom.window.document.body.textContent).toContain('固定文本内容')
        const fixed = dom.window.document.querySelector<HTMLInputElement>('input')!
        await act(async () => { change(dom, fixed, 'please continue') })
        expect(dom.window.document.body.textContent).not.toContain('已保存')
        await act(async () => { fixed.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true })) })
        expect(patches).toEqual([{ continueText: 'please continue' }])
        expect(dom.window.document.body.textContent).toContain('已保存')
        // Blurring an unchanged draft writes nothing more.
        await act(async () => { fixed.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true })) })
        expect(patches).toHaveLength(1)
        // Switching the source saves at once — no Save button anywhere.
        await act(async () => { button(dom, '模型生成').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
        expect(patches[1]).toEqual({ continueMode: 'auto' })
        expect(modelTrigger(dom, '生成模型').getAttribute('aria-label')).toBe('生成模型: 默认辅助模型')
        expect(dom.window.document.body.textContent).toContain('按 Tab 填入建议')
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('rejects invalid input without saving and keeps the error', async () => {
    await useDom(async dom => {
      const { model, patches } = configModel({ read: () => initial })
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<AutoContinueSettings model={model} locale="en" />)
        })
        expect(dom.window.document.body.textContent).toContain('Maximum continuations')
        expect(dom.window.document.body.textContent).toContain('per session when creating it')
        const input = dom.window.document.querySelector<HTMLInputElement>('input')!
        await act(async () => { change(dom, input, '0') })
        expect(input.getAttribute('aria-invalid')).toBe('true')
        expect(dom.window.document.body.textContent).toContain('from 1 to 10')
        await act(async () => { input.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true })) })
        expect(patches).toEqual([])
        // Enter commits a valid change.
        await act(async () => { change(dom, input, '5') })
        await act(async () => { press(dom, input, 'Enter') })
        expect(patches).toEqual([{ autoContinueMax: 5 }])
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('keeps a dirty draft across an external reload and saves it on blur', async () => {
    await useDom(async dom => {
      let current = initial
      const { model, patches } = configModel({ read: () => current })
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<ComposerSettings model={model} locale="en" />)
        })
        const input = dom.window.document.querySelector<HTMLInputElement>('input')!
        await act(async () => { change(dom, input, 'my draft') })
        // Another page writes the config while the input holds an uncommitted draft.
        current = { ...current, continueText: 'external' }
        await act(async () => { await model.load() })
        expect(input.value).toBe('my draft')
        await act(async () => { input.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true })) })
        expect(patches).toEqual([{ continueText: 'my draft' }])
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('follows external writes while the input is clean', async () => {
    await useDom(async dom => {
      let current = initial
      const { model } = configModel({ read: () => current })
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<ComposerSettings model={model} locale="en" />)
        })
        const input = dom.window.document.querySelector<HTMLInputElement>('input')!
        expect(input.value).toBe('')
        current = { ...current, continueText: 'external' }
        await act(async () => { await model.load() })
        expect(input.value).toBe('external')
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('toggles the return features with 0/off writes and gates their minutes inputs', async () => {
    await useDom(async dom => {
      let current: ConfigView = { ...initial, compactMinutes: 0 }
      const { model, patches } = configModel({
        read: () => current,
        apply: patch => { current = { ...current, ...patch } },
      })
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<ReturnSettings model={model} locale="zh" />)
        })
        expect(switchRow(dom, '显示会话摘要').getAttribute('aria-checked')).toBe('true')
        expect(switchRow(dom, '建议压缩上下文').getAttribute('aria-checked')).toBe('false')
        const inputs = [...dom.window.document.querySelectorAll<HTMLInputElement>('input')]
        expect(inputs).toHaveLength(2)
        // Stored 0 shows the threshold prefilled with its default, disabled.
        const compactInput = inputs[1]!
        expect(compactInput.value).toBe('60')
        expect(compactInput.disabled).toBe(true)
        // Two identical blocks: label + hint, the minutes field indented beneath.
        expect(dom.window.document.querySelectorAll('.dsm-feature')).toHaveLength(2)
        expect(dom.window.document.querySelectorAll('.dsm-minutes-control')).toHaveLength(2)
        // Off -> on writes the shown minutes; on -> off writes 0.
        await act(async () => { switchRow(dom, '建议压缩上下文').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
        expect(patches).toEqual([{ compactMinutes: 60 }])
        await act(async () => { switchRow(dom, '显示会话摘要').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
        expect(patches[1]).toEqual({ recapMinutes: 0 })
        // Minutes still save on blur while enabled.
        await act(async () => { change(dom, compactInput, '90') })
        await act(async () => { compactInput.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true })) })
        expect(patches[2]).toEqual({ compactMinutes: 90 })
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('flushes a second row edit made while another row is saving, and shows the status only in the writing row', async () => {
    await useDom(async dom => {
      let current: ConfigView = { ...initial, compactMinutes: 0 }
      const patches: Partial<ConfigView>[] = []
      let release: () => void = () => {}
      const rpc: PresenceHost['rpc'] = {
        call: vi.fn(async (_channel: string, endpoint: string, payload: unknown) => {
          if (endpoint === CONFIG_READ_ENDPOINT) return { ok: true, value: current }
          const patch = (payload as { patch: Partial<ConfigView> }).patch
          patches.push(patch)
          // Hold the first write open so the second row's edit lands mid-save.
          if (patches.length === 1) await new Promise<void>(resolve => { release = resolve })
          current = { ...current, ...patch }
          return { ok: true, value: current }
        }),
      }
      const model = createPresenceConfigModel({ rpc }, () => Promise.resolve())
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<>
            <div id="composer"><ComposerSettings model={model} locale="en" /></div>
            <div id="return"><ReturnSettings model={model} locale="zh" /></div>
          </>)
        })
        await act(async () => { button(dom, 'Model-generated').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
        expect(patches).toEqual([{ continueMode: 'auto' }])
        await act(async () => { switchRow(dom, '建议压缩上下文').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
        expect(patches).toHaveLength(1)
        await act(async () => { release() })
        expect(patches).toEqual([{ continueMode: 'auto' }, { compactMinutes: 60 }])
        expect(current).toMatchObject({ continueMode: 'auto', compactMinutes: 60 })
        expect(dom.window.document.getElementById('return')!.textContent).toContain('已保存')
        expect(dom.window.document.getElementById('composer')!.textContent).not.toContain('Saved')
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('shows catalog failures and retries next to the feature picker', async () => {
    await useDom(async dom => {
      const { model } = configModel({ read: () => initial })
      const load = vi.fn()
        .mockResolvedValueOnce({ ok: false, error: { message: 'catalog offline' } })
        .mockResolvedValue({ groups: [{ id: 'p', models: [{ id: 'm', name: 'Recovered' }] }] })
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<ReturnSettings model={model} locale="en" modelCatalog={load} />)
        })
        expect(dom.window.document.body.textContent).toContain('catalog offline')
        const retry = [...dom.window.document.querySelectorAll<HTMLButtonElement>('button')].find(item => /retry/i.test(item.textContent ?? ''))!
        await act(async () => { retry.click() })
        expect(load).toHaveBeenCalledTimes(2)
        expect(dom.window.document.body.textContent).not.toContain('catalog offline')
        await act(async () => { modelTrigger(dom, 'Recap model').click() })
        await act(async () => { dom.window.document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click() })
        expect(dom.window.document.body.textContent).toContain('Recovered')
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('surfaces a write failure instead of a saved notice', async () => {
    await useDom(async dom => {
      const rpc: PresenceHost['rpc'] = {
        call: vi.fn(async (_channel: string, endpoint: string) => endpoint === CONFIG_READ_ENDPOINT
          ? { ok: true, value: initial }
          : { ok: false, error: { code: 'session-manager/failed', message: 'write failed' } }),
      }
      const model = createPresenceConfigModel({ rpc }, () => Promise.resolve())
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<ReturnSettings model={model} locale="en" />)
        })
        await act(async () => { switchRow(dom, 'Show session recap').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
        expect(dom.window.document.body.textContent).toContain("This action's result could not be confirmed")
        expect(dom.window.document.body.textContent).not.toContain('Saved')
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('shows the unavailable state when the host cannot edit', async () => {
    await useDom(async dom => {
      const rpc: PresenceHost['rpc'] = {
        call: vi.fn(async () => ({ ok: false, error: { code: 'session-manager/unavailable', message: 'no editor' } })),
      }
      const unavailable = createPresenceConfigModel({ rpc })
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<ComposerSettings model={unavailable} locale="en" />)
        })
        expect(dom.window.document.body.textContent).toContain('This runtime cannot complete that action')
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })
})
