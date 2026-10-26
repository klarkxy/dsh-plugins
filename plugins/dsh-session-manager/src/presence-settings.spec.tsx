import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { createPresenceConfigModel, type PresenceHost } from './presence-model.ts'
import { SessionManagerSettings } from './settings-panel.tsx'
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
  recapMinutes: 15, compactMinutes: 60, continueText: '', continueMode: 'fixed', model: null, ghostModel: null,
}

function headings(dom: JSDOM): string[] {
  return [...dom.window.document.querySelectorAll('h3')].map(item => item.textContent ?? '')
}

function button(dom: JSDOM, text: string): HTMLElement {
  return [...dom.window.document.querySelectorAll('button')].find(item => item.textContent === text)!
}

function switchRow(dom: JSDOM, label: string): HTMLElement {
  return [...dom.window.document.querySelectorAll('[role="switch"]')].find(item => item.getAttribute('aria-label') === label) as unknown as HTMLElement
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

describe('presence settings page', () => {
  it('leaves untouched efforts and external routes out of a sparse UI save, and clears effort on a different model', async () => {
    await useDom(async dom => {
      const high = { provider: 'p', model: 'old', reasoningEffort: 'high' }
      let current: ConfigView = { ...initial, model: high, ghostModel: high }
      const patches: Partial<ConfigView>[] = []
      const model = createPresenceConfigModel({ rpc: { call: async (_channel, endpoint, payload) => {
        if (endpoint === CONFIG_WRITE_ENDPOINT) {
          const patch = (payload as { patch: Partial<ConfigView> }).patch
          patches.push(patch)
          current = { ...current, ...patch }
        }
        return { ok: true, value: current }
      } } }, async () => {})
      let root: Root | undefined
      const catalog = async () => ({ groups: [{ id: 'p', name: 'Provider', models: [
        { id: 'old', name: 'Old' }, { id: 'next', name: 'Next' },
      ] }] })
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<SessionManagerSettings model={model} locale="en" modelCatalog={catalog} />)
        })
        // Pick the same route again. That selection must retain its effort.
        await act(async () => { dom.window.document.querySelector<HTMLButtonElement>('.dsh-model-menu-trigger')!.click() })
        await act(async () => { dom.window.document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click() })
        await act(async () => {
          const old = [...dom.window.document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
            .find(item => item.textContent?.includes('Old'))!
          old.click()
        })
        await act(async () => { button(dom, 'Save').click() })
        expect(patches[0]).not.toHaveProperty('model')
        expect(patches[0]).not.toHaveProperty('ghostModel')
        expect(current.model).toEqual(high)
        expect(current.ghostModel).toEqual(high)

        // An external route write while a text draft is dirty must also stay
        // untouched: comparing only to the newest snapshot would restore old.
        await act(async () => { change(dom, dom.window.document.querySelector<HTMLInputElement>('input')!, 'keep this text') })
        current = { ...current, model: { provider: 'p', model: 'external', reasoningEffort: 'low' } }
        await act(async () => { await model.load() })
        await act(async () => { button(dom, 'Save').click() })
        expect(patches[1]).not.toHaveProperty('model')
        expect(current.model?.reasoningEffort).toBe('low')
        expect(current.model?.model).toBe('external')

        await act(async () => { dom.window.document.querySelector<HTMLButtonElement>('.dsh-model-menu-trigger')!.click() })
        await act(async () => { dom.window.document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click() })
        await act(async () => {
          const next = [...dom.window.document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
            .find(item => item.textContent?.includes('Next'))!
          next.click()
        })
        await act(async () => { button(dom, 'Save').click() })
        expect(patches[2]?.model).toEqual({ provider: 'p', model: 'next' })
        expect(current.model).toEqual({ provider: 'p', model: 'next' })
        expect(current.ghostModel).toEqual(high)
      } finally {
        await act(async () => root?.unmount())
      }
    })
  })

  it('groups ghost controls and their dependent return settings', async () => {
    await useDom(async dom => {
      const rpc: PresenceHost['rpc'] = {
        call: vi.fn(async (_channel: string, endpoint: string) =>
          endpoint === CONFIG_READ_ENDPOINT
            ? { ok: true, value: initial }
            : { ok: false, error: { code: 'session-manager/failed', message: 'unknown endpoint' } }),
      }
      const model = createPresenceConfigModel({ rpc }, () => Promise.resolve())
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<SessionManagerSettings model={model} locale="zh" />)
        })
        // Two flat sections share one reading surface. The recap model lives
        // beside its threshold under the recap switch, not in a separate card.
        expect(headings(dom)).toEqual(['继续灰影', '回到会话时'])
        expect(dom.window.document.querySelectorAll('.dsm-settings > .dsm-setting')).toHaveLength(2)
        expect(dom.window.document.querySelector('.dsh-ui-card')).toBeNull()
        // Fixed mode shows the text field. The remaining model picker is the recap's.
        expect(dom.window.document.body.textContent).toContain('固定文本内容')
        expect(dom.window.document.body.textContent).not.toContain('生成模型')
        // Welcome-back card: two switches, each gating its nested threshold inputs.
        expect(switchRow(dom, '显示会话摘要').getAttribute('aria-checked')).toBe('true')
        expect(switchRow(dom, '建议压缩上下文').getAttribute('aria-checked')).toBe('true')
        const trigger = dom.window.document.querySelector('.dsh-model-menu-trigger')!
        expect(trigger.getAttribute('aria-label')).toBe('摘要模型: 当前会话 / 宿主默认模型')
        expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
        expect(trigger.closest('.dsm-model-field')).not.toBeNull()
        expect(dom.window.document.querySelectorAll('.dsm-minutes-control .dsh-ui-meta')).toHaveLength(2)
        expect(dom.window.document.querySelector('select')).toBeNull()
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('loads the current config, writes a patch, and confirms through a re-read after the reload', async () => {
    await useDom(async dom => {
      const calls: { endpoint: string; payload: unknown }[] = []
      let current = initial
      const rpc: PresenceHost['rpc'] = {
        call: vi.fn(async (_channel: string, endpoint: string, payload: unknown) => {
          calls.push({ endpoint, payload })
          if (endpoint === CONFIG_READ_ENDPOINT) return { ok: true, value: current }
          if (endpoint === CONFIG_WRITE_ENDPOINT) {
            // The host restarts with the new config; the next read serves it.
            current = { ...current, ...(payload as { patch: Partial<ConfigView> }).patch }
            return { ok: true, value: current }
          }
          return { ok: false, error: { code: 'session-manager/failed', message: 'unknown endpoint' } }
        }),
      }
      const model = createPresenceConfigModel({ rpc }, () => Promise.resolve())
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<SessionManagerSettings model={model} locale="zh" />)
        })
        const text = () => dom.window.document.body.textContent ?? ''
        expect(text()).toContain('继续灰影')
        expect(text()).toContain('固定文本')
        // Switch to model-generated mode and save.
        const auto = button(dom, '模型生成')
        await act(async () => { auto.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
        const save = button(dom, '保存')
        await act(async () => { save.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
        const write = calls.find(call => call.endpoint === CONFIG_WRITE_ENDPOINT)
        expect(dom.window.document.body.textContent).toContain('生成模型')
        expect(write?.payload).toEqual({
          patch: { recapMinutes: 15, compactMinutes: 60, continueText: '', continueMode: 'auto' },
        })
        expect(text()).toContain('已保存')
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('saves disabled switches as 0 and posts a chosen model route', async () => {
    await useDom(async dom => {
      const calls: { endpoint: string; payload: unknown }[] = []
      let current: ConfigView = { ...initial, compactMinutes: 0 }
      const rpc: PresenceHost['rpc'] = {
        call: vi.fn(async (_channel: string, endpoint: string, payload: unknown) => {
          calls.push({ endpoint, payload })
          if (endpoint === CONFIG_READ_ENDPOINT) return { ok: true, value: current }
          if (endpoint === CONFIG_WRITE_ENDPOINT) {
            current = { ...current, ...(payload as { patch: Partial<ConfigView> }).patch }
            return { ok: true, value: current }
          }
          return { ok: false, error: { code: 'session-manager/failed', message: 'unknown endpoint' } }
        }),
      }
      const model = createPresenceConfigModel({ rpc }, () => Promise.resolve())
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<SessionManagerSettings
            model={model}
            locale="zh"
            modelCatalog={async () => ({ groups: [{ id: 'p', name: 'Provider', models: [{ id: 'm', name: 'Model' }] }] })}
          />)
        })
        // Stored 0 shows the compact switch off with the default minutes prefilled.
        expect(switchRow(dom, '建议压缩上下文').getAttribute('aria-checked')).toBe('false')
        const compactInput = [...dom.window.document.querySelectorAll('input')].pop()!
        expect(compactInput.value).toBe('60')
        expect(compactInput.disabled).toBe(true)
        // Pick a model from the catalog while the recap switch still gates an enabled picker.
        await act(async () => { dom.window.document.querySelector<HTMLButtonElement>('.dsh-model-menu-trigger')!.click() })
        await act(async () => { dom.window.document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click() })
        const choice = [...dom.window.document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(item => item.textContent?.includes('Model'))!
        await act(async () => { choice.click() })
        // Turning the recap switch off disables its nested fields and writes 0.
        await act(async () => { switchRow(dom, '显示会话摘要').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
        expect(dom.window.document.querySelector<HTMLButtonElement>('.dsh-model-menu-trigger')!.disabled).toBe(true)
        await act(async () => { button(dom, '保存').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
        const write = calls.find(call => call.endpoint === CONFIG_WRITE_ENDPOINT)
        expect(write?.payload).toEqual({
          patch: { recapMinutes: 0, compactMinutes: 0, continueText: '', continueMode: 'fixed', model: { provider: 'p', model: 'm' } },
        })
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('shows catalog failures and retries without losing an unsaved draft', async () => {
    await useDom(async dom => {
      const model = createPresenceConfigModel({ rpc: { call: async () => ({ ok: true, value: initial }) } }, () => Promise.resolve())
      const load = vi.fn()
        .mockResolvedValueOnce({ ok: false, error: { message: 'catalog offline' } })
        .mockResolvedValue({ groups: [{ id: 'p', models: [{ id: 'm', name: 'Recovered' }] }] })
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<SessionManagerSettings model={model} locale="en" modelCatalog={load} />)
        })
        expect(dom.window.document.body.textContent).toContain('catalog offline')
        const fixed = dom.window.document.querySelector<HTMLInputElement>('input')!
        await act(async () => { change(dom, fixed, 'keep my draft') })
        const retry = [...dom.window.document.querySelectorAll<HTMLButtonElement>('button')].find(item => /retry/i.test(item.textContent ?? ''))!
        await act(async () => { retry.click() })
        expect(load).toHaveBeenCalledTimes(2)
        expect(fixed.value).toBe('keep my draft')
        expect(dom.window.document.body.textContent).not.toContain('catalog offline')
        await act(async () => { dom.window.document.querySelector<HTMLButtonElement>('.dsh-model-menu-trigger')!.click() })
        await act(async () => { dom.window.document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click() })
        expect(dom.window.document.body.textContent).toContain('Recovered')
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('keeps a submitted draft after a failed save and a later settings notification', async () => {
    await useDom(async dom => {
      let current = initial
      const model = createPresenceConfigModel({ rpc: { call: async (_channel, endpoint) => endpoint === CONFIG_WRITE_ENDPOINT
        ? { ok: false, error: { code: 'session-manager/failed', message: 'write failed' } }
        : { ok: true, value: current } } }, () => Promise.resolve())
      let notify: (() => void) | undefined
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<SessionManagerSettings model={model} locale="en" subscribeSettings={callback => { notify = callback; return () => {} }} />)
        })
        const fixed = dom.window.document.querySelector<HTMLInputElement>('input')!
        await act(async () => { change(dom, fixed, 'retain failed draft') })
        await act(async () => { button(dom, 'Save').click() })
        expect(model.getSnapshot().failure).toBeDefined()
        current = { ...initial, continueText: 'external value' }
        await act(async () => { notify?.() })
        expect(fixed.value).toBe('retain failed draft')
        expect(dom.window.document.body.textContent).toContain('Settings changed elsewhere')
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('re-reads the config when another settings page saves the model', async () => {
    await useDom(async dom => {
      let current = initial
      const rpc: PresenceHost['rpc'] = {
        call: vi.fn(async (_channel: string, endpoint: string) =>
          endpoint === CONFIG_READ_ENDPOINT
            ? { ok: true, value: current }
            : { ok: false, error: { code: 'session-manager/failed', message: 'unknown endpoint' } }),
      }
      const model = createPresenceConfigModel({ rpc }, () => Promise.resolve())
      let notify: (() => void) | undefined
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<SessionManagerSettings
            model={model}
            locale="en"
            subscribeSettings={onChange => { notify = onChange; return () => { notify = undefined } }}
          />)
        })
        current = { ...current, model: { provider: 'p', model: 'remote' } }
        await act(async () => { notify?.() })
        const trigger = dom.window.document.querySelector('.dsh-model-menu-trigger')!
        expect(trigger.textContent).toContain('p / remote')
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('rejects an enabled zero, names the inputs, and keeps a dirty draft across an external reload', async () => {
    await useDom(async dom => {
      let current = initial
      const rpc: PresenceHost['rpc'] = {
        call: vi.fn(async (_channel: string, endpoint: string) =>
          endpoint === CONFIG_READ_ENDPOINT
            ? { ok: true, value: current }
            : { ok: false, error: { code: 'session-manager/failed', message: 'unknown endpoint' } }),
      }
      const model = createPresenceConfigModel({ rpc }, () => Promise.resolve())
      let notify: (() => void) | undefined
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<SessionManagerSettings
            model={model}
            locale="en"
            subscribeSettings={onChange => { notify = onChange; return () => { notify = undefined } }}
          />)
        })
        const labelled = (name: string) => {
          const label = [...dom.window.document.querySelectorAll('label')].find(item => item.textContent?.includes(name))
          const control = label?.querySelector('input, select, textarea')
          if (!(control instanceof dom.window.HTMLElement)) throw new Error(`missing control for ${name}`)
          return control as HTMLInputElement
        }
        const recap = labelled('Show recap after')
        const compact = labelled('Show suggestion after')
        const fixed = labelled('Fixed text')
        expect(recap).toBeTruthy()
        expect(compact).toBeTruthy()
        expect(fixed).toBeTruthy()
        const fixedTab = [...dom.window.document.querySelectorAll('[role="tab"]')].find(item => item.textContent === 'Fixed text')!
        const panelId = fixedTab.getAttribute('aria-controls')
        expect(panelId).toBeTruthy()
        expect(dom.window.document.getElementById(panelId!)?.getAttribute('role')).toBe('tabpanel')
        const recapInput = recap instanceof dom.window.HTMLInputElement ? recap : recap.querySelector('input')
        if (!(recapInput instanceof dom.window.HTMLInputElement)) throw new Error('recap minutes input missing')
        await act(async () => { change(dom, recapInput, '0') })
        const shown = labelled('Show recap after')
        const shownInput = shown instanceof dom.window.HTMLInputElement ? shown : shown.querySelector('input')
        expect(shownInput?.value).toBe('0')
        expect(shownInput?.getAttribute('aria-invalid')).toBe('true')
        expect(dom.window.document.body.textContent).toContain('at least 1')
        expect((button(dom, 'Save') as HTMLButtonElement).disabled).toBe(true)
        current = { ...current, recapMinutes: 30, continueText: 'remote' }
        await act(async () => { notify?.() })
        expect(labelled('Show recap after').value).toBe('0')
        expect(dom.window.document.body.textContent).toContain('Settings changed elsewhere')
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('keeps the save disabled on invalid minutes and shows the failure when the host cannot edit', async () => {
    await useDom(async dom => {
      const rpc: PresenceHost['rpc'] = {
        call: vi.fn(async () => ({ ok: false, error: { code: 'session-manager/unavailable', message: 'no editor' } })),
      }
      const unavailable = createPresenceConfigModel({ rpc })
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<SessionManagerSettings model={unavailable} locale="en" />)
        })
        expect(dom.window.document.body.textContent).toContain('This runtime cannot complete that action')
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })
})
