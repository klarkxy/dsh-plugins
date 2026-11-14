import { act, type ReactNode } from 'react'
import { Simulate } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { SecretManagerSettings, sessionLabel } from './client-settings.tsx'
import { translator } from './ui-copy.ts'

const t = translator('zh')

const entries = [
  { ref: 'secret://github-token', slot: 'github-token', envKey: 'DSH_SECRET_GITHUB_TOKEN', configured: true, envGrantedSessions: 1, httpGrantedSessions: 0, envGranted: true, httpGranted: false },
  { ref: 'secret://mirror', slot: 'mirror', envKey: 'DSH_SECRET_MIRROR', configured: true, envGrantedSessions: 0, httpGrantedSessions: 2, envGranted: false, httpGranted: true },
  { ref: 'secret://fresh', slot: 'fresh', envKey: 'DSH_SECRET_FRESH', configured: true, envGrantedSessions: 0, httpGrantedSessions: 0, envGranted: false, httpGranted: false },
]

function rpc(respond: (endpoint: string, payload: unknown) => unknown) {
  return vi.fn(async (endpoint: string, payload: unknown) => respond(endpoint, payload))
}

function domFixture() {
  const dom = new JSDOM('<div id="root"></div>')
  // jsdom lacks the legacy attachEvent/detachEvent pair React's input
  // polyfill toggles on the focused element; inert no-ops keep it quiet.
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
    button(label: string) {
      return [...dom.window.document.querySelectorAll('button')].find(item => item.textContent === label)!
    },
    buttons(label: string) {
      return [...dom.window.document.querySelectorAll('button')].filter(item => item.textContent === label)
    },
    input(labelId: string) {
      return dom.window.document.querySelector<HTMLInputElement>(`[aria-labelledby="${labelId}"]`)!
    },
    async cleanup() {
      await act(async () => root.unmount())
      dom.window.close()
      for (const [key, value] of previous) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    },
  }
}

const listOk = () => ({ ok: true, value: { entries } })
const saveOk = () => ({ ok: true, value: { ref: 'secret://x', slot: 'x', envKey: 'DSH_SECRET_X', configured: true } })

describe('sessionLabel', () => {
  it('truncates long ids and keeps short ones', () => {
    expect(sessionLabel('abc')).toBe('abc')
    expect(sessionLabel('session-7f18d524-55e7')).toBe('session-…')
  })
})

describe('SecretManagerSettings', () => {
  it('lists secrets with references and grant counts, never values', async () => {
    const call = rpc(() => listOk())
    const { dom, render, cleanup } = domFixture()
    try {
      await render(<SecretManagerSettings call={call} sessionId="session-1" t={t} />)
      const body = dom.window.document.body.textContent!
      expect(body).toContain('secret://github-token')
      expect(body).toContain('DSH_SECRET_GITHUB_TOKEN')
      expect(body).toContain('shell 授权：1 个会话')
      expect(body).toContain('尚未授权给任何会话')
      expect(body).toContain('本会话已授权 shell 使用')
      expect(call.mock.calls[0].slice(0, 2)).toEqual(['list', { sessionId: 'session-1' }])
      expect(dom.window.document.querySelector('input[type="password"]')).not.toBeNull()
    } finally { await cleanup() }
  })

  it('validates the slot name and value before any RPC', async () => {
    const call = rpc(() => listOk())
    const { dom, render, input, button, cleanup } = domFixture()
    try {
      await render(<SecretManagerSettings call={call} sessionId="s" t={t} />)
      const calls = call.mock.calls.length
      await act(async () => Simulate.change(input('sm-name-label'), { target: { value: 'BAD NAME' } } as never))
      await act(async () => Simulate.change(input('sm-value-label'), { target: { value: 'k' } } as never))
      await act(async () => button('保存').click())
      expect(dom.window.document.body.textContent).toContain('名称只能使用小写字母、数字和连字符')
      expect(call.mock.calls).toHaveLength(calls)
      await act(async () => Simulate.change(input('sm-name-label'), { target: { value: 'ok-name' } } as never))
      await act(async () => Simulate.change(input('sm-value-label'), { target: { value: 'value\nbreak' } } as never))
      await act(async () => button('保存').click())
      expect(dom.window.document.body.textContent).toContain('密钥值无效')
      expect(call.mock.calls).toHaveLength(calls)
    } finally { await cleanup() }
  })

  it('saves a new secret once, clears the field and reloads', async () => {
    const call = rpc((endpoint) => endpoint === 'save' ? saveOk() : listOk())
    const { dom, render, input, button, cleanup } = domFixture()
    try {
      await render(<SecretManagerSettings call={call} sessionId="s" t={t} />)
      await act(async () => Simulate.change(input('sm-name-label'), { target: { value: 'x' } } as never))
      const valueInput = input('sm-value-label')
      await act(async () => Simulate.change(valueInput, { target: { value: 'sk-secret-value-1' } } as never))
      await act(async () => button('保存').click())
      const saves = call.mock.calls.filter(([endpoint]) => endpoint === 'save')
      expect(saves).toHaveLength(1)
      expect(saves[0][1]).toEqual({ slot: 'x', value: 'sk-secret-value-1' })
      expect(valueInput.value).toBe('')
      expect(dom.window.document.body.textContent).toContain('已保存。')
    } finally { await cleanup() }
  })

  it('replaces a value only after confirmation, then clears it', async () => {
    const call = rpc((endpoint) => endpoint === 'save' ? saveOk() : listOk())
    const { dom, render, button, buttons, cleanup } = domFixture()
    try {
      await render(<SecretManagerSettings call={call} sessionId="s" t={t} />)
      await act(async () => buttons('替换')[0].click())
      const input = dom.window.document.querySelector<HTMLInputElement>('input[type="password"][aria-labelledby="sm-replace-label"]')!
      await act(async () => Simulate.change(input, { target: { value: 'new-secret-value' } } as never))
      await act(async () => button('确认').click())
      const saves = call.mock.calls.filter(([endpoint]) => endpoint === 'save')
      expect(saves).toHaveLength(1)
      expect(saves[0][1]).toEqual({ slot: 'github-token', value: 'new-secret-value' })
      expect(input.value).toBe('')
    } finally { await cleanup() }
  })

  it('deletes and revokes behind their confirmation dialogs', async () => {
    const call = rpc((endpoint) => endpoint === 'list' ? listOk() : { ok: true, value: {} })
    const { render, button, buttons, cleanup } = domFixture()
    try {
      await render(<SecretManagerSettings call={call} sessionId="session-1" t={t} />)
      await act(async () => buttons('删除')[0].click())
      await act(async () => button('确认').click())
      expect(call.mock.calls.filter(([endpoint]) => endpoint === 'delete'))
        .toEqual([['delete', { slot: 'github-token' }]])
      await act(async () => buttons('撤销本会话授权')[0].click())
      await act(async () => button('确认').click())
      expect(call.mock.calls.filter(([endpoint]) => endpoint === 'revoke'))
        .toEqual([['revoke', { slot: 'github-token', sessionId: 'session-1' }]])
      await act(async () => buttons('撤销全部会话授权')[0].click())
      await act(async () => button('确认').click())
      expect(call.mock.calls.filter(([endpoint]) => endpoint === 'revoke'))
        .toContainEqual(['revoke', { slot: 'github-token' }])
    } finally { await cleanup() }
  })

  it('shows a fixed failure and keeps entries when the list call fails', async () => {
    const call = rpc(() => ({ ok: false, error: { code: 'x', message: 'boom' } }))
    const { dom, render, cleanup } = domFixture()
    try {
      await render(<SecretManagerSettings call={call} sessionId="s" t={t} />)
      expect(dom.window.document.body.textContent).toContain('读取失败。')
      expect(dom.window.document.body.textContent).not.toContain('boom')
    } finally { await cleanup() }
  })

  it('explains the missing session instead of listing grants', async () => {
    const call = rpc(() => listOk())
    const { dom, render, cleanup } = domFixture()
    try {
      await render(<SecretManagerSettings call={call} sessionId="" t={t} />)
      expect(dom.window.document.body.textContent).toContain('未检测到打开的会话')
    } finally { await cleanup() }
  })
})
