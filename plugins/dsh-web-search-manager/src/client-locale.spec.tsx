import { act } from 'react'
import { Simulate } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { NetworkSearchSettings } from './client.tsx'
import { defaultSettings } from './contracts.ts'
import { providerDisplayLabel, searchProviderInfo } from './provider-info.ts'

describe('network search live locale', () => {
  it('updates labels, pricing, notices and validation while retaining drafts without new requests', async () => {
    const dom = new JSDOM('<div id="root"></div>')
    const previous = new Map<string, unknown>()
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
      previous.set(key, (globalThis as Record<string, unknown>)[key]); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
    const root = createRoot(dom.window.document.getElementById('root')!)
    let active = 'zh-CN'; const listeners = new Set<() => void>()
    const provider = { id: 'bocha', kind: 'search' as const, label: '博查', description: '中文网页搜索 API。', billing: 'request' as const, configured: true, configurationOwned: true, calls: 0, failures: 0 }
    const status = { settings: { ...defaultSettings(), searchOrder: ['bocha'], searchEnabled: true }, providers: [provider], searchActive: true, fetchActive: false, storageFailed: false }
    const call = vi.fn(async (_channel: string, endpoint: string) => ({ ok: true, value: endpoint === 'test' ? { sources: 3 } : status }))
    const locale = { getSnapshot: () => ({ active }), subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } } }
    const body = () => dom.window.document.body.textContent!
    const button = (label: string) => [...dom.window.document.querySelectorAll('button')].find(item => item.textContent === label)!
    const switchLocale = async (next: string) => { await act(async () => { active = next; listeners.forEach(listener => listener()) }) }
    try {
      await act(async () => root.render(<NetworkSearchSettings client={{ locale, connection: { rpc: { call } }, remote: { credentials: { describe: vi.fn() } } } as never} />))
      expect(body()).toContain('目录价 ¥0.036/次')
      await act(async () => button('测试连接（可能计费）').click())
      expect(body()).toContain('连接正常，返回 3 条来源。')
      const calls = call.mock.calls.length
      await switchLocale('en-US')
      expect(body()).toContain('Connection OK: 3 sources returned.')
      expect(body()).toContain('listed price ¥0.036/request')
      expect(body()).toContain('Bocha')
      expect(body()).not.toContain('中文网页搜索 API')
      await act(async () => button('Settings').click())
      const input = dom.window.document.querySelector<HTMLInputElement>('input[min="1"][max="20"]')!
      await act(async () => Simulate.change(input, { target: { value: '0' } } as never))
      await act(async () => button('Save').click())
      expect(body()).toContain('Max results/query must be a whole number from 1 to 20.')
      await switchLocale('zh')
      expect(input.value).toBe('0')
      expect(input.closest('label')!.textContent).toContain('每条查询结果上限')
      expect(body()).toContain('每条查询结果上限需为 1–20 之间的整数。')
      expect(call.mock.calls).toHaveLength(calls)
    } finally {
      await act(async () => root.unmount()); expect(listeners.size).toBe(0); dom.window.close()
      for (const [key, value] of previous) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
  })

  it('keeps external provider content and custom metadata verbatim', () => {
    const external = { id: 'bocha', kind: 'search' as const, label: '外部名称', description: '远端内容', pricing: '远端价格', billing: 'request' as const, configured: true, configurationOwned: false, calls: 0, failures: 0 }
    expect(searchProviderInfo(external, 'en')).toMatchObject({ description: '远端内容', pricing: '远端价格' })
    expect(providerDisplayLabel(external, 'en')).toBe('外部名称')
  })

  it.each(['ddg', 'bocha', 'brave', 'deepseek-managed', 'exa', 'firecrawl', 'serper', 'tavily'])('has balanced bundled provider copy for %s', id => {
    const provider = { id, kind: 'search' as const, label: id, description: '', billing: 'request' as const, configured: true, configurationOwned: true, calls: 0, failures: 0 }
    const zh = searchProviderInfo(provider, 'zh'), en = searchProviderInfo(provider, 'en')
    expect(zh.description).toMatch(/[\u4e00-\u9fff]/)
    expect(zh.pricing).toMatch(/[\u4e00-\u9fff]/)
    expect(en.description).not.toMatch(/[\u4e00-\u9fff]/)
    expect(en.pricing).not.toMatch(/[\u4e00-\u9fff]/)
    expect(en.pricingUrl).toBe(zh.pricingUrl)
  })
})
