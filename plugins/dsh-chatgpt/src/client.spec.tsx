import type { Context } from '@deepseek-ai/cordis'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, ChatGptPanel, LoginDetails, safeAuthorizationUrl } from './client.tsx'
import { DEFAULT_SETTINGS, PLUGIN_NAME, RPC_CHANNEL, type Settings, type Status } from './contracts.ts'

const status: Status = {
  available: true, executable: '/codex', version: '1.0', signedIn: false, authMode: null,
  models: [{ id: 'model-1', label: 'Model One', isDefault: true, efforts: ['low', 'high'] }],
}
const english = { getSnapshot: () => ({ active: 'en' }), subscribe: () => () => {} }
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
type Call = (channel: string, endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>

async function mount(call: Call, run: (dom: JSDOM, root: Root) => Promise<void>) {
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
      root.render(<ChatGptPanel rpc={{ call }} locale={english} />)
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
const click = async (dom: JSDOM, text: string) => {
  const button = [...dom.window.document.querySelectorAll('button')].find(item => item.textContent === text)
  expect(button, text).toBeDefined()
  await act(async () => button!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
}
const success = <T,>(value: T) => ({ ok: true, value })
afterEach(() => vi.useRealTimers())

describe('ChatGPT connection page', () => {
  it('restricts authorization links to HTTPS provider domains', () => {
    for (const url of ['javascript:alert(1)', 'http://auth.openai.com/a', 'https://openai.com.evil.test/a', 'https://evilopenai.com', 'https://user@auth.openai.com', 'https://auth.openai.com:444/a', '/login']) {
      expect(safeAuthorizationUrl(url)).toBeNull()
      expect(renderToStaticMarkup(<LoginDetails login={{ id: '1', kind: 'device', url, code: 'ABCD' }} />)).not.toContain('href=')
    }
    for (const url of ['https://auth.openai.com/a', 'https://chatgpt.com/device']) expect(safeAuthorizationUrl(url)).toBe(url)
    expect(renderToStaticMarkup(<LoginDetails english login={{ id: '1', kind: 'device', url: 'https://auth.openai.com/device', code: '<AB>' }} />)).toContain('&lt;AB&gt;')
  })

  it('registers only the bundle configuration and disposes through inject', () => {
    const cleanups: Array<() => void> = []
    const remove = vi.fn()
    const register = vi.fn()
    const inject = vi.fn((_name: string, callback: () => unknown) => { callback(); return remove })
    apply({
      effect(callback: () => unknown) { const cleanup = callback(); if (typeof cleanup === 'function') cleanups.push(cleanup as () => void) },
      slots: { inject, register }, connection: { rpc: { call: vi.fn() } },
    } as unknown as Context)
    expect(inject).toHaveBeenCalledWith('plugins.bundle.config', expect.any(Function))
    expect(register).toHaveBeenCalledTimes(1)
    expect(register.mock.calls[0][0]).toEqual({ name: 'plugins.bundle.config', key: PLUGIN_NAME, label: 'ChatGPT' })
    cleanups.forEach(cleanup => cleanup())
    expect(remove).toHaveBeenCalledOnce()
  })

  it('loads independent reads in parallel, never saves automatically, and aborts on unmount', async () => {
    const settings = deferred<unknown>(); const state = deferred<unknown>()
    const signals: AbortSignal[] = []
    const call = vi.fn<Call>((channel, endpoint, _payload, signal) => {
      expect(channel).toBe(RPC_CHANNEL); signals.push(signal!)
      return endpoint === 'settings' ? settings.promise : state.promise
    })
    await mount(call, async (dom, root) => {
      expect(call.mock.calls.map(args => args[1])).toEqual(['settings', 'status'])
      await act(async () => { state.resolve(success(status)); settings.resolve(success({ settings: DEFAULT_SETTINGS, revision: 3 })) })
      expect(dom.window.document.body.textContent).toContain('Codex 1.0')
      expect(call).toHaveBeenCalledTimes(2)
      await act(async () => root.unmount())
      expect(signals.every(signal => signal.aborted)).toBe(true)
    })
  })

  it('saves explicitly with the revision, surfaces conflicts, and reloads for review', async () => {
    let conflict = true
    const call = vi.fn<Call>(async (_channel, endpoint, payload) => {
      if (endpoint === 'status') return success(status)
      if (endpoint === 'settings') return success({ settings: DEFAULT_SETTINGS, revision: conflict ? 3 : 4 })
      expect(payload).toEqual({ settings: DEFAULT_SETTINGS, expectedRevision: 3 })
      return { ok: false, error: { code: 'conflict', message: 'Updated elsewhere' } }
    })
    await mount(call, async dom => {
      await click(dom, 'Save settings')
      expect(dom.window.document.body.textContent).toContain('Settings changed elsewhere')
      const save = [...dom.window.document.querySelectorAll('button')].find(item => item.textContent === 'Save settings')!
      expect(save.disabled).toBe(true)
      conflict = false
      await click(dom, 'Reload settings')
      expect(save.disabled).toBe(false)
      expect(dom.window.document.body.textContent).not.toContain('Settings changed elsewhere')
    })
  })

  it('offers default model efforts and saves a user selection only on request', async () => {
    const call = vi.fn<Call>(async (_channel, endpoint, payload) => {
      if (endpoint === 'status') return success(status)
      if (endpoint === 'settings') return success({ settings: DEFAULT_SETTINGS, revision: 5 })
      return success({ settings: (payload as { settings: Settings }).settings, revision: 6 })
    })
    await mount(call, async dom => {
      const effort = dom.window.document.querySelectorAll('select')[1]
      expect([...effort.options].map(item => item.value)).toEqual(['', 'low', 'high'])
      await act(async () => {
        effort.value = 'high'
        effort.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
      })
      expect(call.mock.calls.some(args => args[1] === 'settings.update')).toBe(false)
      await click(dom, 'Save settings')
      expect(call.mock.calls.find(args => args[1] === 'settings.update')?.[2]).toEqual({
        settings: { ...DEFAULT_SETTINGS, effort: 'high' }, expectedRevision: 5,
      })
      expect(dom.window.document.body.textContent).toContain('Saved.')
      expect(effort.value).toBe('high')
    })
  })

  it('polls only while login is pending and cancels its owned login on unload', async () => {
    vi.useFakeTimers()
    const login = { id: 'owned', kind: 'device' as const, url: 'https://auth.openai.com/device', code: 'CODE' }
    const call = vi.fn<Call>(async (_channel, endpoint) => {
      if (endpoint === 'settings') return success({ settings: DEFAULT_SETTINGS, revision: 1 })
      if (endpoint === 'login.start') return success(login)
      if (endpoint === 'status') return success({ ...status, login: call.mock.calls.some(args => args[1] === 'login.start') ? login : undefined })
      return success(null)
    })
    await mount(call, async (dom, root) => {
      await act(async () => vi.advanceTimersByTime(6000))
      expect(call.mock.calls.filter(args => args[1] === 'status')).toHaveLength(1)
      await click(dom, 'Device code sign-in')
      expect(dom.window.document.body.textContent).toContain('CODE')
      await act(async () => vi.advanceTimersByTime(2100))
      expect(call.mock.calls.filter(args => args[1] === 'status')).toHaveLength(2)
      await act(async () => root.unmount())
      expect(call.mock.calls.filter(args => args[1] === 'login.cancel')).toHaveLength(1)
      await act(async () => vi.advanceTimersByTime(6000))
      expect(call.mock.calls.filter(args => args[1] === 'status')).toHaveLength(2)
    })
  })

  it('does not cancel a login started elsewhere or overwrite a saved draft with status', async () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, model: 'model-1', effort: 'high' }
    const call = vi.fn<Call>(async (_channel, endpoint) => endpoint === 'settings'
      ? success({ settings, revision: 9 })
      : success({ ...status, login: { id: 'external', kind: 'browser', url: 'https://auth.openai.com/a' } }))
    await mount(call, async dom => {
      expect([...dom.window.document.querySelectorAll('button')].some(item => item.textContent === 'Cancel sign-in')).toBe(false)
      expect([...dom.window.document.querySelectorAll('select')].map(item => item.value)).toEqual(['model-1', 'high'])
      await click(dom, 'Refresh status')
      expect([...dom.window.document.querySelectorAll('select')].map(item => item.value)).toEqual(['model-1', 'high'])
    })
    expect(call.mock.calls.some(args => args[1] === 'login.cancel')).toBe(false)
  })

  it('stops polling after sign-in completes and keeps the latest refresh result', async () => {
    vi.useFakeTimers()
    const oldStatus = deferred<unknown>()
    let reads = 0
    const call = vi.fn<Call>(async (_channel, endpoint) => {
      if (endpoint === 'settings') return success({ settings: DEFAULT_SETTINGS, revision: 1 })
      if (endpoint === 'status') {
        reads++
        if (reads === 1) return oldStatus.promise
        return success({ ...status, signedIn: true, accountLabel: 'Account' })
      }
      return success({ id: 'owned', kind: 'browser', url: 'https://auth.openai.com/login' })
    })
    await mount(call, async dom => {
      await click(dom, 'Browser sign-in')
      await act(async () => vi.advanceTimersByTime(2100))
      expect(dom.window.document.body.textContent).toContain('Signed in')
      expect(dom.window.document.body.textContent).not.toContain('Continue sign-in')
      await act(async () => oldStatus.resolve(success(status)))
      expect(dom.window.document.body.textContent).toContain('Signed in')
      await act(async () => vi.advanceTimersByTime(10_000))
      expect(reads).toBe(2)
    })
    expect(call.mock.calls.some(args => args[1] === 'login.cancel')).toBe(false)
  })

  it('cancels a login that finishes starting after the panel unmounts', async () => {
    const pending = deferred<unknown>()
    const call = vi.fn<Call>(async (_channel, endpoint) => {
      if (endpoint === 'settings') return success({ settings: DEFAULT_SETTINGS, revision: 1 })
      if (endpoint === 'status') return success(status)
      if (endpoint === 'login.start') return pending.promise
      return success(null)
    })
    await mount(call, async (dom, root) => {
      await click(dom, 'Browser sign-in')
      await act(async () => root.unmount())
      await act(async () => pending.resolve(success({ id: 'owned', kind: 'browser', url: 'https://auth.openai.com/login' })))
      expect(call.mock.calls.filter(args => args[1] === 'login.cancel')).toHaveLength(1)
      expect(dom.window.document.getElementById('root')!.textContent).toBe('')
    })
  })
})
