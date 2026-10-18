import type { Context } from '@deepseek-ai/cordis'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { apply, MiniMaxCodePanel } from './client.tsx'
import { DEFAULT_SETTINGS, PLUGIN_NAME, RPC_CHANNEL, type Settings, type Status } from './contracts.ts'

const english = { getSnapshot: () => ({ active: 'en' }), subscribe: () => () => {} }
const state: Status = {
  available: true, executable: '/official-cli', version: '1.2.3', authenticated: null,
  capabilities: [{ id: 'search', available: true }, { id: 'generate_image', available: false, reason: 'Sign in first' }],
}
type Call = (channel: string, endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>
const success = <T,>(value: T) => ({ ok: true, value })
const failure = (code: string, message: string) => ({ ok: false, error: { code, message } })
const deferred = () => {
  let resolve!: (value: unknown) => void
  const promise = new Promise<unknown>(done => { resolve = done })
  return { promise, resolve }
}
async function mount(call: Call, run: (dom: JSDOM, root: Root) => Promise<void>, locale = english) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>')
  const previous = new Map<string, unknown>()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, (globalThis as Record<string, unknown>)[key])
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  let root: Root | undefined
  try {
    await act(async () => {
      root = createRoot(dom.window.document.getElementById('root')!)
      root.render(<MiniMaxCodePanel rpc={{ call }} locale={locale} />)
    })
    await run(dom, root!)
  } finally {
    await act(async () => root?.unmount())
    for (const [key, value] of previous) {
      if (value === undefined) delete (globalThis as Record<string, unknown>)[key]
      else Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
    dom.window.close()
  }
}
const button = (dom: JSDOM, text: string) => {
  const element = [...dom.window.document.querySelectorAll('button')].find(item => item.textContent === text)
  expect(element, text).toBeDefined()
  return element!
}
const click = async (dom: JSDOM, text: string) => {
  await act(async () => button(dom, text).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
}
const field = (dom: JSDOM, label: string) => {
  const element = [...dom.window.document.querySelectorAll('label')].find(item => item.querySelector('span')?.textContent === label)?.querySelector('input, select')
  expect(element, label).toBeDefined()
  return element as HTMLInputElement | HTMLSelectElement
}
const change = async (dom: JSDOM, label: string, value: string) => {
  await act(async () => { Simulate.change(field(dom, label), { target: { value } } as never) })
}
const openAdvanced = async (dom: JSDOM) => {
  const row = [...dom.window.document.querySelectorAll('button')].find(item => item.textContent === 'Advanced settings' || item.textContent === '高级设置')
  expect(row, 'advanced settings row').toBeDefined()
  await act(async () => row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
}
const executableLabel = 'Media tools executable'
const changedSettings: Settings = { ...DEFAULT_SETTINGS, toolsExecutable: '/custom-cli', timeoutMs: 16_001 }

describe('MiniMax Code settings page', () => {
  it('saves the separate search executable and region while preserving the media executable', async () => {
    const call = vi.fn<Call>(async (_channel, endpoint, payload) => endpoint === 'settings'
      ? success({ settings: { ...DEFAULT_SETTINGS, toolsExecutable: '/media-cli' }, revision: 6 })
      : endpoint === 'status' ? success(state) : success({ settings: (payload as { settings: Settings }).settings, revision: 7 }))
    await mount(call, async dom => {
      expect(dom.window.document.body.textContent).toContain('running, signed-in MiniMax Code host')
      expect(dom.window.document.body.textContent).toContain('web search uses a dedicated search configuration in official mcode')
      expect(dom.window.document.querySelector(`input[placeholder="Leave blank to detect automatically"]`)).toBeNull()
      await openAdvanced(dom)
      await change(dom, 'mcode search executable', '/search-cli')
      await change(dom, 'Dedicated search profile directory (optional)', '/search-profile')
      await change(dom, 'Region', 'cn')
      await click(dom, 'Refresh status')
      expect(field(dom, 'Region').value).toBe('cn')
      await click(dom, 'Save settings')
      expect(call.mock.calls.find(args => args[1] === 'settings.update')?.[2]).toEqual({
        settings: { ...DEFAULT_SETTINGS, toolsExecutable: '/media-cli', codeExecutable: '/search-cli', searchDataDir: '/search-profile', region: 'cn' }, expectedRevision: 6,
      })
      expect(field(dom, executableLabel).value).toBe('/media-cli')
    })
  })

  it('loads settings and read-only status independently with truthful auth and capability facts', async () => {
    const settings = deferred(); const status = deferred()
    const call = vi.fn<Call>((channel, endpoint) => {
      expect(channel).toBe(RPC_CHANNEL)
      return endpoint === 'settings' ? settings.promise : status.promise
    })
    await mount(call, async dom => {
      expect(call.mock.calls.map(args => args[1])).toEqual(['settings', 'status'])
      await act(async () => status.resolve(success(state)))
      expect(dom.window.document.body.textContent).toContain('Sign-in unknown')
      expect(dom.window.document.body.textContent).not.toContain('Signed in')
      expect(dom.window.document.body.textContent).toContain('Sign in first')
      expect(dom.window.document.body.textContent).toContain('1.2.3')
      expect(dom.window.document.querySelector('[aria-label="Capability status"]')?.textContent).toContain('Generate imagesUnavailable')
      await openAdvanced(dom)
      expect(button(dom, 'Save settings').disabled).toBe(true)
      await act(async () => settings.resolve(success({ settings: DEFAULT_SETTINGS, revision: 3 })))
      expect(button(dom, 'Save settings').disabled).toBe(false)
      expect(call).toHaveBeenCalledTimes(2)
      expect(dom.window.document.querySelectorAll('input[type="password"]')).toHaveLength(0)
      expect([...dom.window.document.querySelectorAll('button')].some(item => /login|sign-in/i.test(item.textContent ?? ''))).toBe(false)
    })
  })

  it('keeps edited settings through a status refresh and saves exactly once with CAS', async () => {
    const update = deferred()
    const call = vi.fn<Call>(async (_channel, endpoint) => endpoint === 'settings'
      ? success({ settings: DEFAULT_SETTINGS, revision: 3 }) : endpoint === 'status' ? success(state) : update.promise)
    await mount(call, async dom => {
      await openAdvanced(dom)
      await change(dom, executableLabel, '/custom-cli')
      await change(dom, 'Timeout (seconds)', '16.001')
      await click(dom, 'Refresh status')
      expect(field(dom, executableLabel).value).toBe('/custom-cli')
      expect(field(dom, 'Timeout (seconds)').value).toBe('16.001')
      expect(call.mock.calls.filter(args => args[1] === 'settings')).toHaveLength(1)
      const save = button(dom, 'Save settings')
      await act(async () => {
        save.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
        save.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      })
      expect(call.mock.calls.filter(args => args[1] === 'settings.update')).toHaveLength(1)
      expect(call.mock.calls.find(args => args[1] === 'settings.update')?.[2]).toEqual({ settings: changedSettings, expectedRevision: 3 })
      expect(field(dom, executableLabel).disabled).toBe(true)
      await act(async () => update.resolve(success({ settings: changedSettings, revision: 4 })))
      expect(dom.window.document.body.textContent).toContain('Saved.')
      expect(field(dom, executableLabel).disabled).toBe(false)
    })
  })

  it('preserves the conflicting draft until explicit reload, then uses the new revision', async () => {
    let revision = 3
    const call = vi.fn<Call>(async (_channel, endpoint, payload) => {
      if (endpoint === 'status') return success(state)
      if (endpoint === 'settings') return success({ settings: DEFAULT_SETTINGS, revision })
      if (revision === 3) return failure('conflict', 'Updated elsewhere')
      expect((payload as { expectedRevision: number }).expectedRevision).toBe(8)
      return success({ settings: (payload as { settings: Settings }).settings, revision: 9 })
    })
    await mount(call, async dom => {
      await openAdvanced(dom)
      await change(dom, executableLabel, '/my-draft')
      await click(dom, 'Save settings')
      expect(dom.window.document.body.textContent).toContain('Settings changed elsewhere')
      expect(field(dom, executableLabel).value).toBe('/my-draft')
      expect(button(dom, 'Save settings').disabled).toBe(true)
      await click(dom, 'Refresh status')
      expect(field(dom, executableLabel).value).toBe('/my-draft')
      revision = 8
      await click(dom, 'Reload settings')
      expect(field(dom, executableLabel).value).toBe('')
      expect(dom.window.document.body.textContent).not.toContain('Settings changed elsewhere')
      await click(dom, 'Save settings')
      expect(dom.window.document.body.textContent).toContain('Saved.')
    })
  })

  it('recovers a failed settings load and keeps status failure separate from save failure', async () => {
    let reads = 0; let statuses = 0
    const call = vi.fn<Call>(async (_channel, endpoint) => {
      if (endpoint === 'settings') return ++reads === 1 ? failure('storage', 'Settings unavailable') : success({ settings: DEFAULT_SETTINGS, revision: 2 })
      if (endpoint === 'status') return ++statuses === 1 ? success(state) : failure('probe', 'Status unavailable')
      return failure('busy', 'Wait for current request')
    })
    await mount(call, async dom => {
      expect(dom.window.document.body.textContent).toContain('Settings unavailable')
      expect(dom.window.document.body.textContent).toContain('Sign-in unknown')
      await openAdvanced(dom)
      expect(button(dom, 'Save settings').disabled).toBe(true)
      await click(dom, 'Reload settings')
      await change(dom, executableLabel, '/draft')
      await click(dom, 'Save settings')
      await click(dom, 'Refresh status')
      expect(dom.window.document.body.textContent).toContain('Wait for current request')
      expect(dom.window.document.body.textContent).toContain('Could not read status: Status unavailable')
      expect(dom.window.document.body.textContent).not.toContain('Sign-in unknown')
      expect(field(dom, executableLabel).value).toBe('/draft')
    })
  })

  it('validates timeout without RPC mutation and localizes client copy using the host locale', async () => {
    const call = vi.fn<Call>(async (_channel, endpoint) => endpoint === 'settings' ? success({ settings: DEFAULT_SETTINGS, revision: 1 }) : success(state))
    const chinese = { ...english, getSnapshot: () => ({ active: 'zh-CN' }) }
    await mount(call, async dom => {
      expect(dom.window.document.body.textContent).toContain('登录状态未知')
      expect(dom.window.document.body.textContent).toContain('图片生成')
      await openAdvanced(dom)
      await change(dom, '超时（秒）', '')
      await click(dom, '保存配置')
      expect(dom.window.document.body.textContent).toContain('超时须在 10–1800 秒之间。')
      expect(call.mock.calls.some(args => args[1] === 'settings.update')).toBe(false)
    }, chinese)
  })

  it('aborts outstanding reads and ignores late responses after disposal', async () => {
    const settings = deferred(); const status = deferred()
    const call = vi.fn<Call>((_channel, endpoint) => endpoint === 'settings' ? settings.promise : status.promise)
    await mount(call, async (dom, root) => {
      await act(async () => root.unmount())
      expect(call.mock.calls.every(args => args[3]?.aborted)).toBe(true)
      await act(async () => { settings.resolve(success({ settings: DEFAULT_SETTINGS, revision: 1 })); status.resolve(success(state)) })
      expect(dom.window.document.getElementById('root')!.textContent).toBe('')
    })
  })

  it('aborts a pending save on disposal without subsequent probes or mutations', async () => {
    const update = deferred()
    const call = vi.fn<Call>(async (_channel, endpoint) => endpoint === 'settings'
      ? success({ settings: DEFAULT_SETTINGS, revision: 1 }) : endpoint === 'status' ? success(state) : update.promise)
    await mount(call, async (dom, root) => {
      await openAdvanced(dom)
      await click(dom, 'Save settings')
      await act(async () => root.unmount())
      expect(call.mock.calls.find(args => args[1] === 'settings.update')?.[3]?.aborted).toBe(true)
      await act(async () => update.resolve(success({ settings: DEFAULT_SETTINGS, revision: 2 })))
      expect(call).toHaveBeenCalledTimes(3)
      expect(dom.window.document.getElementById('root')!.textContent).toBe('')
    })
  })

  it('registers the exact keyed bundle slot and removes injected slot and scoped style', async () => {
    await mount(async (_channel, endpoint) => endpoint === 'settings' ? success({ settings: DEFAULT_SETTINGS, revision: 1 }) : success(state), async dom => {
      const cleanups: Array<() => void> = []; const remove = vi.fn(); const register = vi.fn()
      const inject = vi.fn((_name: string, callback: () => unknown) => { callback(); return remove })
      const order: string[] = []
      apply({
        inject(deps: string[], callback: (scope: unknown) => void) {
          order.push(deps[0] === 'remote' ? 'mount' : 'subscribe')
          if (deps[0] === 'remote') callback({ remote: { $mount: async () => async () => {} }, effect() {} })
        },
        effect(callback: () => unknown) { const cleanup = callback(); if (typeof cleanup === 'function') cleanups.push(cleanup as () => void) },
        slots: { inject, register }, connection: { rpc: { call: vi.fn() } },
      } as unknown as Context)
      expect(order[0]).toBe('mount')
      expect(inject).toHaveBeenCalledWith('plugins.bundle.config', expect.any(Function))
      expect(register.mock.calls[0][0]).toEqual({ name: 'plugins.bundle.config', key: PLUGIN_NAME, label: 'MiniMax Code' })
      expect(dom.window.document.head.querySelector(`style[data-plugin="${PLUGIN_NAME}"]`)).not.toBeNull()
      cleanups.forEach(cleanup => cleanup())
      expect(remove).toHaveBeenCalledOnce()
      expect(dom.window.document.head.querySelector(`style[data-plugin="${PLUGIN_NAME}"]`)).toBeNull()
    })
  })
})
