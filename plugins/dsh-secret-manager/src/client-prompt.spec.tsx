import { act, type ReactNode } from 'react'
import { Simulate } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { readToolCall, SecretToolView, type ToolArgsView } from './client-prompt.tsx'
import { PLUGIN_ID } from './contracts.ts'
import { translator } from './ui-copy.ts'

const t = translator('zh')

const pendingView = {
  id: 'req-1', sessionId: 'session-1', callId: 'call-1', kind: 'http',
  slot: 'github-token', envKey: 'DSH_SECRET_GITHUB_TOKEN', ref: 'secret://github-token',
  purpose: 'call the GitHub API', requestEnv: true, configured: true,
  authHeader: 'Authorization', authPrefix: 'Bearer',
  httpOrigin: 'https://api.github.com', expiresAt: Date.now() + 60_000,
}

function argsView(fields: Record<string, unknown>): ToolArgsView {
  return {
    has: (key: string) => key in fields,
    complete: (key: string) => key in fields,
    text: (key: string) => typeof fields[key] === 'string' ? fields[key] as string : undefined,
    value: (key: string) => fields[key],
  }
}

function domFixture() {
  const dom = new JSDOM('<div id="root"></div>')
  // jsdom lacks the legacy attachEvent/detachEvent pair React's input
  // polyfill toggles on the focused element; inert no-ops keep the polyfill
  // quiet without masking real errors.
  ;(dom.window.HTMLElement.prototype as unknown as Record<string, unknown>).attachEvent = () => {}
  ;(dom.window.HTMLElement.prototype as unknown as Record<string, unknown>).detachEvent = () => {}
  const previous = new Map<string, unknown>()
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document,
    HTMLElement: dom.window.HTMLElement, Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous.set(key, (globalThis as Record<string, unknown>)[key])
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  const root = createRoot(dom.window.document.getElementById('root')!)
  return {
    dom, root,
    async render(node: ReactNode) { await act(async () => root.render(node)) },
    body: () => dom.window.document.body,
    button(label: string) {
      return [...dom.window.document.querySelectorAll('button')].find(item => item.textContent === label)!
    },
    buttonByAria(label: string) {
      return [...dom.window.document.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === label)!
    },
    async cleanup() {
      await act(async () => root.unmount())
      dom.window.close()
      for (const [key, value] of previous) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    },
  }
}

const makeView = (over: Partial<Parameters<typeof SecretToolView>[0]> = {}) => (
  <SecretToolView
    sessionId="session-1"
    callId="call-1"
    phase="start"
    block={{ callId: 'call-1', args: argsView({ pending: pendingView }) }}
    t={t}
    call={vi.fn(async () => ({ ok: true, value: { status: 'ready', ref: 'secret://github-token', slot: 'github-token', envKey: 'DSH_SECRET_GITHUB_TOKEN', envGranted: true, httpGranted: true } }))}
    {...over}
  />
)

describe('readToolCall', () => {
  it('reads the pending request out of call args during start', () => {
    const read = readToolCall({ phase: 'start', block: { callId: 'c', args: argsView({ pending: pendingView }) } })
    expect(read.pending?.id).toBe('req-1')
    expect(read.pending?.httpOrigin).toBe('https://api.github.com')
  })
  it('maps the persisted tool result to a settled status', () => {
    const meta = { owner: PLUGIN_ID, status: 'ready', configured: true, envGranted: true, httpGranted: true, summary: 'ok' }
    expect(readToolCall({ phase: 'result', block: { callId: 'c', kind: 'tool-result', meta } }).status).toBe('ready')
    expect(readToolCall({ phase: 'result', block: { callId: 'c', kind: 'tool-result', meta: { ...meta, status: 'cancelled' } } }).status).toBe('cancelled')
    expect(readToolCall({ phase: 'result', block: { callId: 'c', kind: 'tool-result', isError: true } }).status).toBe('failed')
  })
  it('reads presentation metadata from saved results without a summary', async () => {
    const meta = { owner: PLUGIN_ID, slot: 'github-token', status: 'ready', configured: true, envGranted: true, httpGranted: false }
    expect(readToolCall({ phase: 'result', block: { callId: 'call-1', kind: 'tool-result', meta } }).status).toBe('ready')
    const { dom, render, cleanup } = domFixture()
    try {
      await render(makeView({ phase: 'result', block: { callId: 'call-1', kind: 'tool-result', meta } }))
      expect(dom.window.document.body.textContent).toContain('secret://github-token')
      expect(dom.window.document.body.textContent).toContain(t('ready'))
    } finally { await cleanup() }
  })
})

describe('SecretToolView prompt window', () => {
  it('opens the modal on the pending phase with a masked standard input', async () => {
    const { dom, render, cleanup } = domFixture()
    try {
      await render(makeView())
      const input = dom.window.document.querySelector<HTMLInputElement>('input[type="password"]')
      expect(input).not.toBeNull()
      // The standard masked field, asserted at the DOM level.
      expect(input!.type).toBe('password')
      expect(dom.window.document.body.textContent).toContain('为 github-token 提供密钥')
      expect(dom.window.document.body.textContent).toContain('secret://github-token')
    } finally { await cleanup() }
  })

  it('submits once: value goes to the host RPC and the field clears', async () => {
    const call = vi.fn(async (endpoint: string) => endpoint === 'submit'
      ? { ok: true, value: { status: 'ready', ref: 'secret://github-token', slot: 'github-token', envKey: 'DSH_SECRET_GITHUB_TOKEN', envGranted: true, httpGranted: true } }
      : { ok: true, value: pendingView })
    const { dom, render, button, cleanup } = domFixture()
    try {
      await render(makeView({ call }))
      const input = dom.window.document.querySelector<HTMLInputElement>('input[type="password"]')!
      await act(async () => Simulate.change(input, { target: { value: 'sk-secret-1' } } as never))
      await act(async () => button('保存并允许本会话使用').click())
      const submits = call.mock.calls.filter(([endpoint]) => endpoint === 'submit')
      expect(submits).toHaveLength(1)
      expect(submits[0][1]).toMatchObject({
        id: 'req-1', sessionId: 'session-1', callId: 'call-1',
        value: 'sk-secret-1', grantEnv: true, grantHttp: true,
      })
      expect(input.value).toBe('')
      expect(dom.window.document.querySelector('input[type="password"]')).toBeNull()
      expect(dom.window.document.body.textContent).toContain('已保存并授权 github-token。')
    } finally { await cleanup() }
  })

  it('closing the dialog declines the request and never leaves it hanging', async () => {
    const call = vi.fn(async () => ({ ok: true, value: {} }))
    const { render, button, cleanup } = domFixture()
    try {
      await render(makeView({ call }))
      await act(async () => button('拒绝请求').click())
      const cancels = call.mock.calls.filter(([endpoint]) => endpoint === 'cancel')
      expect(cancels).toHaveLength(1)
      expect(cancels[0][1]).toMatchObject({ id: 'req-1', sessionId: 'session-1', callId: 'call-1' })
    } finally { await cleanup() }
  })

  it('clears a typed value even when declining cannot reach the host', async () => {
    const call = vi.fn(async () => { throw new Error('transport failed') })
    const { dom, render, button, cleanup } = domFixture()
    try {
      await render(makeView({ call }))
      const input = dom.window.document.querySelector<HTMLInputElement>('input[type="password"]')!
      await act(async () => Simulate.change(input, { target: { value: 'dummy-entered-secret' } } as never))
      await act(async () => button('拒绝请求').click())
      expect(input.value).toBe('')
      expect(dom.window.document.body.textContent).not.toContain('dummy-entered-secret')
    } finally { await cleanup() }
  })

  it('shows only a fixed error and keeps the dialog on a failed submit, value cleared', async () => {
    let attempts = 0
    const call = vi.fn(async (endpoint: string) => {
      if (endpoint !== 'submit') return { ok: true, value: pendingView }
      attempts += 1
      return attempts === 1
        ? { ok: false, error: { code: 'stale', message: 'leak should not surface' } }
        : { ok: true, value: { status: 'ready', ref: 'r', slot: 'github-token', envKey: 'DSH_SECRET_GITHUB_TOKEN', envGranted: false, httpGranted: false } }
    })
    const { dom, render, button, cleanup } = domFixture()
    try {
      await render(makeView({ call }))
      const input = dom.window.document.querySelector<HTMLInputElement>('input[type="password"]')!
      await act(async () => Simulate.change(input, { target: { value: 'sk-secret-2' } } as never))
      await act(async () => button('保存并允许本会话使用').click())
      expect(dom.window.document.body.textContent).toContain('提交失败，请重试。')
      expect(dom.window.document.body.textContent).not.toContain('leak should not surface')
      expect(input.value).toBe('')
      await act(async () => Simulate.change(input, { target: { value: 'sk-secret-3' } } as never))
      await act(async () => button('保存并允许本会话使用').click())
      expect(call.mock.calls.filter(([endpoint]) => endpoint === 'submit')).toHaveLength(2)
    } finally { await cleanup() }
  })

  it('leaves an empty input as a reuse of the stored value', async () => {
    const call = vi.fn(async (endpoint: string) => endpoint === 'submit'
      ? { ok: true, value: { status: 'ready', ref: 'r', slot: 'github-token', envKey: 'k', envGranted: true, httpGranted: true } }
      : { ok: true, value: pendingView })
    const { render, button, cleanup } = domFixture()
    try {
      await render(makeView({ call }))
      await act(async () => button('保存并允许本会话使用').click())
      const payload = call.mock.calls.find(([endpoint]) => endpoint === 'submit')?.[1] as Record<string, unknown>
      expect(payload).not.toHaveProperty('value')
    } finally { await cleanup() }
  })

  it('keeps polling for the pending record until the host primed it, then opens', async () => {
    vi.useFakeTimers()
    try {
      let reads = 0
      const call = vi.fn(async (endpoint: string) => {
        if (endpoint !== 'pending') return { ok: true, value: {} }
        reads += 1
        return reads < 3 ? { ok: true, value: null } : { ok: true, value: pendingView }
      })
      const { dom, render, cleanup } = domFixture()
      try {
        await render(makeView({ call, block: { callId: 'call-1', args: argsView({}) } }))
        expect(dom.window.document.querySelector('input[type="password"]')).toBeNull()
        await act(async () => { await vi.advanceTimersByTimeAsync(8000) })
        expect(call.mock.calls.filter(([endpoint]) => endpoint === 'pending').length).toBeGreaterThanOrEqual(3)
        await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
        expect(dom.window.document.body.textContent).toContain('为 github-token 提供密钥')
      } finally { await cleanup() }
    } finally { vi.useRealTimers() }
  })

  it('shows a fixed in-dialog error and retries with the same decline button', async () => {
    let attempts = 0
    const call = vi.fn(async (endpoint: string) => {
      if (endpoint !== 'cancel') return { ok: true, value: pendingView }
      attempts += 1
      return attempts === 1 ? { ok: false, error: { code: 'x', message: 'hidden detail' } } : { ok: true, value: {} }
    })
    const { dom, render, button, cleanup } = domFixture()
    try {
      await render(makeView({ call }))
      await act(async () => button('拒绝请求').click())
      const body = dom.window.document.body.textContent!
      expect(body).toContain('拒绝失败，请重试。')
      expect(body).not.toContain('hidden detail')
      // The modal stays open: declining again is the retry.
      await act(async () => button('拒绝请求').click())
      expect(call.mock.calls.filter(([endpoint]) => endpoint === 'cancel')).toHaveLength(2)
      expect(dom.window.document.body.textContent).toContain('已拒绝本次请求')
    } finally { await cleanup() }
  })

  it('shows a card-level failure with a retry button when a decline sent on close fails', async () => {
    let attempts = 0
    const call = vi.fn(async (endpoint: string) => {
      if (endpoint !== 'cancel') return { ok: true, value: pendingView }
      attempts += 1
      return attempts === 1 ? { ok: false, error: { code: 'x', message: 'hidden detail' } } : { ok: true, value: {} }
    })
    const { dom, render, button, buttonByAria, cleanup } = domFixture()
    try {
      await render(makeView({ call }))
      await act(async () => buttonByAria('关闭').click())
      const body = dom.window.document.body.textContent!
      expect(body).toContain('拒绝失败，请重试。')
      expect(body).not.toContain('hidden detail')
      await act(async () => button('重试').click())
      expect(call.mock.calls.filter(([endpoint]) => endpoint === 'cancel')).toHaveLength(2)
      expect(dom.window.document.body.textContent).toContain('已拒绝本次请求')
    } finally { await cleanup() }
  })

  it('renders the result line after the call settles', async () => {
    const { dom, render, cleanup } = domFixture()
    try {
      const meta = { owner: PLUGIN_ID, status: 'ready', configured: true, envGranted: true, httpGranted: false, summary: 'ready' }
      await render(<SecretToolView sessionId="s" callId="c" phase="result"
        block={{ callId: 'c', kind: 'tool-result', meta }} t={t} call={vi.fn()} />)
      expect(dom.window.document.body.textContent).toContain('密钥已就绪')
    } finally { await cleanup() }
  })
})
