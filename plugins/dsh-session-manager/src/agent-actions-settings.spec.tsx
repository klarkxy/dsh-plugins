/**
 * The two agent-action switches: independent permissions, default off, one
 * sparse field per save.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { createPresenceConfigModel, type PresenceHost } from './presence-model.ts'
import { AgentActionsSettings } from './settings-panel.tsx'
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

/** A config view without the agent-action flags: an older host's answer. */
const legacy: ConfigView = {
  recapMinutes: 15, compactMinutes: 60, continueText: '', continueMode: 'fixed',
  model: null, ghostModel: null, judgeModel: null, handoffModel: null, autoContinueMode: 'off', autoContinueMax: 3,
} as unknown as ConfigView

const initial: ConfigView = { ...legacy, allowSelfFork: false, allowSendMessage: false }

function configModel(host: { read: () => ConfigView; apply?: (patch: Partial<ConfigView>) => void; write?: (patch: Partial<ConfigView>) => void }) {
  const patches: Partial<ConfigView>[] = []
  const rpc: PresenceHost['rpc'] = {
    call: vi.fn(async (_channel: string, endpoint: string, payload: unknown) => {
      if (endpoint === CONFIG_READ_ENDPOINT) return { ok: true, value: host.read() }
      if (endpoint === CONFIG_WRITE_ENDPOINT) {
        const patch = (payload as { patch: Partial<ConfigView> }).patch
        patches.push(patch)
        host.write?.(patch)
        host.apply?.(patch)
        return { ok: true, value: host.read() }
      }
      return { ok: false, error: { code: 'session-manager/failed', message: 'unknown endpoint' } }
    }),
  }
  return { model: createPresenceConfigModel({ rpc }, () => Promise.resolve()), patches, rpc }
}

function switchRow(dom: JSDOM, label: string): HTMLElement {
  const found = [...dom.window.document.querySelectorAll('[role="switch"]')]
    .find(item => item.getAttribute('aria-label') === label) as unknown as HTMLElement | undefined
  if (!found) throw new Error(`missing switch ${label}`)
  return found
}

function click(dom: JSDOM, element: HTMLElement): void {
  element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
}

describe('agent action settings', () => {
  it('shows both switches off by default and saves only the touched field', async () => {
    await useDom(async dom => {
      let current: ConfigView = { ...initial }
      const { model, patches } = configModel({
        read: () => current,
        apply: patch => { current = { ...current, ...patch } },
      })
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<AgentActionsSettings model={model} locale="zh" />)
        })
        expect(switchRow(dom, '允许自我 fork').getAttribute('aria-checked')).toBe('false')
        expect(switchRow(dom, '允许发送消息').getAttribute('aria-checked')).toBe('false')
        // Each switch explains what it grants. The message hint must not say a
        // running session is woken: an idle session is woken, a running one
        // queues the message.
        expect(dom.window.document.body.textContent).toContain('独立分支')
        expect(dom.window.document.body.textContent).toContain('未归档会话')
        expect(dom.window.document.body.textContent).toContain('空闲会话会被唤醒')
        expect(dom.window.document.body.textContent).toContain('运行中的会话会排队接收')
        expect(dom.window.document.body.textContent).not.toContain('可能唤醒运行中的会话')

        // One switch writes exactly its own field.
        await act(async () => { click(dom, switchRow(dom, '允许自我 fork')) })
        expect(patches).toEqual([{ allowSelfFork: true }])
        expect(current.allowSelfFork).toBe(true)
        expect(current.allowSendMessage).toBe(false)

        // The other switch writes its own field only — it never rewrites the
        // first one, and turning it on leaves the fork permission alone.
        await act(async () => { click(dom, switchRow(dom, '允许发送消息')) })
        expect(patches[1]).toEqual({ allowSendMessage: true })
        expect(current.allowSelfFork).toBe(true)
        expect(current.allowSendMessage).toBe(true)

        // Turning one back off writes only that field.
        await act(async () => { click(dom, switchRow(dom, '允许自我 fork')) })
        expect(patches[2]).toEqual({ allowSelfFork: false })
        expect(current.allowSendMessage).toBe(true)
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('keeps two rapid clicks on different switches as two separate field writes', async () => {
    await useDom(async dom => {
      let current: ConfigView = { ...initial }
      const { model, patches } = configModel({
        read: () => current,
        apply: patch => { current = { ...current, ...patch } },
      })
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<AgentActionsSettings model={model} locale="zh" />)
        })
        // Both clicks land while the first save is still in flight: the second
        // must not be dropped, and neither may carry the other's field.
        await act(async () => {
          click(dom, switchRow(dom, '允许自我 fork'))
          click(dom, switchRow(dom, '允许发送消息'))
        })
        expect(patches).toEqual([{ allowSelfFork: true }, { allowSendMessage: true }])
        expect(current.allowSelfFork).toBe(true)
        expect(current.allowSendMessage).toBe(true)
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('normalizes a missing or malformed flag to off', async () => {
    await useDom(async dom => {
      // A host that predates the flags answers without them; a malformed one
      // answers with a non-boolean. Neither may read as granted.
      const { model } = configModel({ read: () => legacy })
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<AgentActionsSettings model={model} locale="zh" />)
        })
        expect(switchRow(dom, '允许自我 fork').getAttribute('aria-checked')).toBe('false')
        expect(switchRow(dom, '允许发送消息').getAttribute('aria-checked')).toBe('false')
      } finally {
        await act(async () => { root?.unmount() })
      }
    })

    await useDom(async dom => {
      const malformed = { ...initial, allowSelfFork: 'yes', allowSendMessage: 1 } as unknown as ConfigView
      const { model } = configModel({ read: () => malformed })
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<AgentActionsSettings model={model} locale="zh" />)
        })
        expect(switchRow(dom, '允许自我 fork').getAttribute('aria-checked')).toBe('false')
        expect(switchRow(dom, '允许发送消息').getAttribute('aria-checked')).toBe('false')
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('shows a failed save and allows a retry', async () => {
    await useDom(async dom => {
      let current: ConfigView = { ...initial }
      let failNext = true
      const { model } = configModel({
        read: () => current,
        write: patch => {
          if (failNext) { failNext = false; return }
          current = { ...current, ...patch }
        },
      })
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<AgentActionsSettings model={model} locale="zh" />)
        })
        await act(async () => { click(dom, switchRow(dom, '允许自我 fork')) })
        // The write failed, so the row shows the failure instead of a saved
        // notice, and the switch stays off.
        expect(dom.window.document.body.textContent).toContain('无法确认')
        expect(dom.window.document.body.textContent).not.toContain('已保存')
        expect(switchRow(dom, '允许自我 fork').getAttribute('aria-checked')).toBe('false')

        // Retrying succeeds.
        await act(async () => { click(dom, switchRow(dom, '允许自我 fork')) })
        expect(dom.window.document.body.textContent).toContain('已保存')
        expect(switchRow(dom, '允许自我 fork').getAttribute('aria-checked')).toBe('true')
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })
})
