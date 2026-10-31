import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { DelegationAction, DelegationSettingsPanel } from './client.tsx'

const ok = (value: unknown) => ({ ok: true, value })
const fail = (code: string, message = code) => ({ ok: false, error: { code, message } })
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const status = (overrides: Record<string, unknown> = {}) => ({
  sessionId: 's1', role: 'coordinator', enabled: false, revision: 0, capable: true, locked: false, ...overrides,
})

const zh: Record<string, string> = {
  action: '委派',
  normal: '默认',
  mode: '委派模式',
  titleOn: '委派模式已开启',
  titleOff: '开启委派模式',
  incapable: '委派模式不可用',
  stale: '状态已在别处更改，已刷新',
  failed: '切换失败',
  locked: '只能在会话开始前选择委派模式',
}
const t = (key: string) => zh[key] ?? key

async function mount(run: (dom: JSDOM, render: (node: React.ReactElement) => Promise<void>) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>')
  const previous = new Map<string, unknown>()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, (globalThis as Record<string, unknown>)[key])
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  const root = createRoot(dom.window.document.getElementById('root')!)
  try {
    await run(dom, async node => { await act(async () => root.render(node)) })
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, value] of previous) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
}

const actionFor = (call: (endpoint: string, payload: unknown) => Promise<unknown>) => (
  <DelegationAction sessionId="s1" call={call} t={t} />
)

describe('delegation new-session option', () => {
  it('disables a locked session and hides the option once the session is nonblank', async () => {
    const call = vi.fn(async () => ok(status({ locked: true })))
    await mount(async (dom, render) => {
      await render(actionFor(call))
      const button = dom.window.document.querySelector<HTMLButtonElement>('.dlg-toggle')!
      expect(button.disabled).toBe(true)
      await act(async () => button.click())
      expect(call).toHaveBeenCalledTimes(1)
      await render(<DelegationAction sessionId="s1" call={call} t={t} useSession={select => select({ blank: false })} />)
      expect(dom.window.document.querySelector('.dlg-toggle')).toBeNull()
    })
  })

  it('blocks local submission and refreshes availability after changing the preset', async () => {
    let preset = 'minimal'
    const snapshot = { blank: true, awaitingFirstTurn: false }
    const useSession = <T,>(select: (value: typeof snapshot) => T) => select(snapshot)
    const useProjection = () => preset
    const call = vi.fn(async () => ok(status({ capable: preset === 'standard' })))
    await mount(async (dom, render) => {
      const action = () => <DelegationAction sessionId="s1" call={call} t={t} useSession={useSession} useProjection={useProjection} />
      await render(action())
      const button = () => dom.window.document.querySelector<HTMLButtonElement>('.dlg-toggle')!
      expect(button().disabled).toBe(true)
      preset = 'standard'
      await render(action())
      expect(button().disabled).toBe(false)
      snapshot.awaitingFirstTurn = true
      await render(action())
      expect(button().disabled).toBe(true)
    })
  })

  it('refreshes and locks when a stale page tries to change a started session', async () => {
    let reads = 0
    const call = vi.fn(async (endpoint: string) => endpoint === 'session.update'
      ? fail('session-locked') : ok(status({ locked: ++reads > 1 })))
    await mount(async (dom, render) => {
      await render(actionFor(call))
      await act(async () => dom.window.document.querySelector<HTMLButtonElement>('.dlg-toggle')!.click())
      expect(dom.window.document.querySelector<HTMLButtonElement>('.dlg-toggle')!.disabled).toBe(true)
      expect(dom.window.document.body.textContent).toContain('只能在会话开始前选择委派模式')
    })
  })

  it('renders nothing for an executor session', async () => {
    const call = vi.fn(async () => ok(status({ role: 'executor' })))
    await mount(async (dom, render) => {
      await render(actionFor(call))
      expect(call).toHaveBeenCalledWith('session.status', { sessionId: 's1' })
      expect(dom.window.document.querySelector('button')).toBeNull()
    })
  })

  it('shows Default or Delegate with the switch state and toggles with CAS', async () => {
    let current = status({ enabled: true, revision: 2 })
    const call = vi.fn(async (endpoint: string, payload: { enabled?: boolean } = {}) =>
      endpoint === 'session.update'
        ? ok(current = status({ enabled: payload.enabled, revision: 3 }))
        : ok(current))
    await mount(async (dom, render) => {
      await render(actionFor(call))
      const button = dom.window.document.querySelector<HTMLButtonElement>('.dlg-toggle')!
      expect(button.getAttribute('role')).toBe('switch')
      expect(button.getAttribute('aria-checked')).toBe('true')
      expect(button.getAttribute('aria-label')).toBe('委派模式')
      expect(dom.window.document.querySelector('.dlg-mode-label')!.textContent).toBe('委派')
      expect(dom.window.document.querySelector('.dlg-mode')!.getAttribute('data-enabled')).toBe('true')
      await act(async () => button.click())
      expect(call).toHaveBeenCalledWith('session.update', { sessionId: 's1', enabled: false, expectedRevision: 2 })
      expect(dom.window.document.querySelector('.dlg-toggle')!.getAttribute('aria-checked')).toBe('false')
      expect(dom.window.document.querySelector('.dlg-mode-label')!.textContent).toBe('默认')
      expect(dom.window.document.querySelector('.dlg-mode')!.getAttribute('data-enabled')).toBe('false')
    })
  })

  it('disables the button when the preset has no delegation tools', async () => {
    const call = vi.fn(async () => ok(status({ capable: false })))
    await mount(async (dom, render) => {
      await render(actionFor(call))
      const button = dom.window.document.querySelector<HTMLButtonElement>('.dlg-toggle')!
      expect(button.disabled).toBe(true)
      expect(dom.window.document.body.textContent).toContain('委派模式不可用')
      await act(async () => button.click())
      expect(call.mock.calls.filter(args => args[0] === 'session.update')).toHaveLength(0)
    })
  })

  it('refetches and flags a stale rejection', async () => {
    let statuses = 0
    const call = vi.fn(async (endpoint: string) =>
      endpoint === 'session.update' ? fail('stale') : ok(status({ enabled: false, revision: ++statuses === 1 ? 0 : 1 })))
    await mount(async (dom, render) => {
      await render(actionFor(call))
      await act(async () => dom.window.document.querySelector<HTMLButtonElement>('.dlg-toggle')!.click())
      expect(call.mock.calls.map(args => args[0])).toEqual(['session.status', 'session.update', 'session.status'])
      expect(dom.window.document.body.textContent).toContain('状态已在别处更改，已刷新')
      expect(dom.window.document.querySelector('.dlg-toggle')!.getAttribute('aria-checked')).toBe('false')
    })
  })

  it('keeps the old state and shows a failure on other errors', async () => {
    const call = vi.fn(async (endpoint: string) =>
      endpoint === 'session.update' ? fail('internal') : ok(status({ enabled: true, revision: 2 })))
    await mount(async (dom, render) => {
      await render(actionFor(call))
      await act(async () => dom.window.document.querySelector<HTMLButtonElement>('.dlg-toggle')!.click())
      expect(dom.window.document.body.textContent).toContain('切换失败')
      expect(dom.window.document.querySelector('.dlg-toggle')!.getAttribute('aria-checked')).toBe('true')
    })
  })

  it('ignores a delayed status read that lands after a save', async () => {
    const slow = deferred<unknown>()
    let reads = 0
    let revision = 0
    const updates: unknown[] = []
    const call = vi.fn(async (endpoint: string, payload: { enabled?: boolean; expectedRevision?: number } = {}) => {
      if (endpoint === 'session.update') {
        updates.push(payload)
        revision += 1
        return ok(status({ enabled: payload.enabled, revision }))
      }
      reads += 1
      if (reads === 2) return slow.promise
      return ok(status({ enabled: false, revision }))
    })
    await mount(async (dom, render) => {
      await render(actionFor(call))
      const toggle = () => dom.window.document.querySelector<HTMLButtonElement>('.dlg-toggle')!
      expect(toggle().getAttribute('aria-checked')).toBe('false')
      // A focus-triggered refetch hangs while the save lands.
      await act(async () => dom.window.dispatchEvent(new dom.window.Event('focus')))
      await act(async () => toggle().click())
      expect(updates.at(-1)).toMatchObject({ enabled: true, expectedRevision: 0 })
      expect(toggle().getAttribute('aria-checked')).toBe('true')
      // The pre-save read resolving now must not roll the button back.
      await act(async () => slow.resolve(ok(status({ enabled: false, revision: 0 }))))
      expect(toggle().getAttribute('aria-checked')).toBe('true')
      await act(async () => toggle().click())
      expect(updates.at(-1)).toMatchObject({ enabled: false, expectedRevision: 1 })
    })
  })

  it('refetches when the session opens and renders after a failed first read', async () => {
    const snapshot = { openState: 'loading' as string, running: false }
    const useSession = <T,>(selector: (value: typeof snapshot) => T) => selector(snapshot)
    let statuses = 0
    const call = vi.fn(async () => {
      statuses += 1
      return statuses === 1 ? fail('internal') : ok(status())
    })
    await mount(async (dom, render) => {
      const action = () => <DelegationAction sessionId="s1" call={call} t={t} useSession={useSession} />
      await render(action())
      expect(dom.window.document.querySelector('.dlg-toggle')).toBeNull()
      snapshot.openState = 'open'
      await render(action())
      expect(statuses).toBe(2)
      expect(dom.window.document.querySelector('.dlg-toggle')).not.toBeNull()
    })
  })
})

describe('delegation settings panel', () => {
  const clientFor = (call: (channel: string, endpoint: string, payload: unknown) => Promise<unknown>) => ({
    connection: { rpc: { call }, generation: { subscribe: () => () => {} } },
    locale: {},
  }) as never

  it('sends expectedRevision when the switch flips', async () => {
    let current = { revision: 1, defaultEnabled: false }
    const call = vi.fn(async (_channel: string, endpoint: string, payload: { defaultEnabled?: boolean } = {}) =>
      endpoint === 'settings.update'
        ? ok(current = { revision: 2, defaultEnabled: payload.defaultEnabled === true })
        : ok(current))
    await mount(async (dom, render) => {
      await render(<DelegationSettingsPanel client={clientFor(call)} locale="zh" />)
      const toggle = dom.window.document.querySelector<HTMLButtonElement>('[role="switch"]')!
      expect(toggle.getAttribute('aria-checked')).toBe('false')
      await act(async () => toggle.click())
      expect(call).toHaveBeenCalledWith(expect.any(String), 'settings.update', { defaultEnabled: true, expectedRevision: 1 })
      expect(dom.window.document.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('true')
      expect(dom.window.document.body.textContent).toContain('已保存。')
    })
  })

  it('shows the stale notice when the write is rejected', async () => {
    const call = vi.fn(async (_channel: string, endpoint: string) =>
      endpoint === 'settings.update' ? fail('stale') : ok({ revision: 1, defaultEnabled: false }))
    await mount(async (dom, render) => {
      await render(<DelegationSettingsPanel client={clientFor(call)} locale="zh" />)
      await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[role="switch"]')!.click())
      expect(dom.window.document.body.textContent).toContain('设置已更新，请刷新后重试。')
    })
  })
})
