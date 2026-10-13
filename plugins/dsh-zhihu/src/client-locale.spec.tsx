import { act, type ReactNode } from 'react'
import { Simulate } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { apply } from './client.tsx'
import { clientText, translator } from './client-locale.ts'
import { ZHIHU_CREDENTIAL_REF } from './contracts.ts'

describe('Zhihu host locale subscription', () => {
  it('translates owned diagnostics and pagination warnings while retaining upstream content', () => {
    const en = translator('en'), zh = translator('zh')
    expect(clientText('timeout：官方每日额度超时（30 秒），请稍后再试。', en)).toBe('timeout: Official daily quota timed out (30 seconds). Try again later.')
    expect(clientText('知乎开放平台返回错误（code=30001）：原始远端内容', en)).toBe('Zhihu Open Platform returned an error (code=30001): 原始远端内容')
    expect(clientText('分页信息不完整：缺少有效的 Paging.IsEnd，请停止翻页。', en)).toBe('Paging is incomplete: no valid Paging.IsEnd. Stop paging.')
    expect(clientText('远端内容', en)).toBe('远端内容')
    expect(clientText('RPC 返回格式无效。', zh)).toBe('RPC 返回格式无效。')
  })
  it('updates saved notices, errors and cached tabs without clearing drafts or refetching', async () => {
    const dom = new JSDOM('<div id="root"></div>'); const previous = new Map<string, unknown>()
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
      previous.set(key, (globalThis as Record<string, unknown>)[key]); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
    const root = createRoot(dom.window.document.getElementById('root')!); let active = 'zh'
    const listeners = new Set<() => void>(), cleanup: Array<() => void> = []
    let render!: (props: unknown) => ReactNode
    const call = vi.fn(async (_channel: string, endpoint: string) => endpoint === 'knowledge.bases'
      ? { ok: false, error: { code: 'token-missing', message: 'internal diagnostic' } }
      : { ok: true, value: { items: [] } })
    const set = vi.fn(async () => ({ ok: true, value: {} }))
    const locale = { getSnapshot: () => ({ active }), subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } } }
    const body = () => dom.window.document.body.textContent!
    const button = (label: string) => [...dom.window.document.querySelectorAll('button')].find(item => item.textContent === label)!
    const switchLocale = async (next: string) => { await act(async () => { active = next; listeners.forEach(listener => listener()) }) }
    try {
      apply({ locale, connection: { rpc: { call } }, remote: { credentials: { set, describe: async () => ({ ok: true, value: { [ZHIHU_CREDENTIAL_REF]: { configured: false, writable: true } } }) } },
        effect(callback: () => unknown) { const dispose = callback(); if (typeof dispose === 'function') cleanup.push(dispose as () => void) },
        slots: { inject(_key: string, register: () => unknown) { register(); return () => {} }, register(_spec: unknown, view: typeof render) { render = view } },
      } as never)
      await act(async () => root.render(render({})))
      const key = dom.window.document.querySelector<HTMLInputElement>('input[type="password"]')!
      await act(async () => Simulate.change(key, { target: { value: 'example-key' } } as never))
      await act(async () => button('保存').click())
      expect(body()).toContain('已保存。')
      await switchLocale('en-US')
      expect(body()).toContain('Saved.')
      await act(async () => button('Knowledge base').click())
      expect(body()).toContain('Zhihu Access Secret is missing or unavailable.')
      const calls = call.mock.calls.length
      await switchLocale('zh-CN')
      expect(body()).toContain('未配置知乎 Access Secret 或凭证不可用')
      expect(call.mock.calls).toHaveLength(calls)
      await act(async () => button('测试').click())
      const query = dom.window.document.querySelector<HTMLInputElement>('[data-testid="zhihu-query"]')!
      await act(async () => Simulate.change(query, { target: { value: '我的查询' } } as never))
      await switchLocale('en')
      expect(query.value).toBe('我的查询'); expect(query.getAttribute('aria-label')).toBe('Search keywords')
      expect(call.mock.calls).toHaveLength(calls)
      const selector = dom.window.document.querySelector<HTMLSelectElement>('[aria-label="Feature to test"]')!
      await act(async () => Simulate.change(selector, { target: { value: 'content.comments' } } as never))
      await act(async () => button('Run request').click())
      expect(body()).toContain('Must be a valid HTTPS Zhihu link.')
      await switchLocale('zh')
      expect(body()).toContain('须为有效的 HTTPS 知乎链接。')
      expect(call.mock.calls).toHaveLength(calls)
      expect(set).toHaveBeenCalledTimes(1)
    } finally {
      await act(async () => root.unmount()); expect(listeners.size).toBe(0); cleanup.forEach(dispose => dispose()); dom.window.close()
      for (const [key, value] of previous) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
  })
})
