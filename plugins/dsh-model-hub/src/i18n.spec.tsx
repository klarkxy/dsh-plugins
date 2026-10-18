import { act } from 'react'
import { readFileSync } from 'node:fs'
import { createRoot, type Root } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { HubPage, type HubEntry } from './client.tsx'
import { castCopy } from './client-cast.tsx'
import { hubMessage, hubMessages } from './client-copy.ts'
import { TitleSettings } from '../../dsh-current-title/src/client.tsx'
import { titleCopy, titleMessage } from '../../dsh-current-title/src/client-work.ts'

function localeStore() {
  let active = 'en'
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => ({ active }),
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    async change(next: string) { await act(async () => { active = next; listeners.forEach(listener => listener()) }) },
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
async function mounted(run: (dom: JSDOM, root: Root) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>')
  const previous = new Map<string, PropertyDescriptor | undefined>()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, Node: dom.window.Node,
    Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  dom.window.HTMLElement.prototype.scrollIntoView = () => {}
  const root = createRoot(dom.window.document.getElementById('root')!)
  try { await run(dom, root) } finally {
    await act(async () => root.unmount()); dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
}
const ok = <T,>(value: T) => ({ ok: true as const, value })

describe('live host locale across model settings panels', () => {
  it('switches title copy and async notices without reloading, losing prompt drafts, or cancelling saves', async () => mounted(async (dom, root) => {
    const locale = localeStore(), saved = deferred<unknown>()
    const settings = { revision: 1, prompt: 'User-written 原样 prompt', model: { provider: '', model: '' }, cadence: 'all-prompts' }
    const call = vi.fn(async (_channel, endpoint) => endpoint === 'settings' ? saved.promise : ok({ settings, support: { weOwn: false, limitation: 'required host services are missing' } }))
    const client = { locale, connection: { rpc: { call } }, sessions: {}, uiWorkspace: { current: { getSnapshot: () => undefined, subscribe: () => () => {} } }, uiSession: { adapter: { current: { getSnapshot: () => ({}), subscribe: () => () => {} } } } }
    await act(async () => root.render(<TitleSettings client={client as never} marker={{ active: true }} />))
    const input = dom.window.document.querySelector('textarea')!
    await act(async () => Simulate.change(input, { target: { value: 'Draft 保留' } } as never))
    await locale.change('zh-CN')
    expect(input.value).toBe('Draft 保留'); expect(input.disabled).toBe(false)
    expect(dom.window.document.body.textContent).toContain('缺少所需的宿主服务。')
    expect(call).toHaveBeenCalledTimes(1)
    await act(async () => Simulate.blur(input))
    await locale.change('en-US')
    expect(input.disabled).toBe(true); expect(input.value).toBe('Draft 保留'); expect(call).toHaveBeenCalledTimes(2)
    await act(async () => saved.resolve(ok({ ...settings, revision: 2, prompt: 'Draft 保留' })))
    expect(dom.window.document.body.textContent).toContain('Saved.')
    await locale.change('zh')
    expect(dom.window.document.body.textContent).toContain('已保存。'); expect(input.value).toBe('Draft 保留')
    expect(call).toHaveBeenCalledTimes(2)
  }))

  it('resolves hub owner and marker copy, aria and diagnostics without changing search or refetching', async () => mounted(async (dom, root) => {
    const locale = localeStore()
    const entries: HubEntry[] = [{ ns: 'plugin-id', title: { zh: '评审插件', en: 'Review plugin' }, revision: 1,
      catalogError: { zh: '本地目录不可用', en: 'Local catalog unavailable' }, fields: [{ via: 'contribution', path: ['model'],
        label: { zh: '评审模型', en: 'Review model' }, marker: { label: { zh: '标记模型', en: 'Marked model' } },
        description: { zh: '说明文字', en: 'Description' }, current: { provider: 'provider-id', model: 'model-id' } }] }]
    const api = { list: vi.fn(async () => entries), modelCatalog: vi.fn(async () => ({ groups: [] })), setField: vi.fn(async () => ({ committed: true as const, ns: 'owner' })) }
    await act(async () => root.render(<HubPage locale={locale} api={api} />))
    const input = dom.window.document.querySelector('input')!
    await act(async () => Simulate.change(input, { target: { value: 'plugin-id' } } as never))
    await locale.change('zh-CN')
    expect(input.value).toBe('plugin-id'); expect(input.getAttribute('aria-label')).toContain('搜索插件')
    expect(dom.window.document.querySelector('.hub-row-label')!.textContent).toBe('标记模型')
    expect(dom.window.document.body.textContent).toContain('本地目录不可用')
    expect(dom.window.document.querySelector('.hub-group')!.getAttribute('aria-label')).toBe('评审插件')
    await locale.change('en-US')
    expect(input.value).toBe('plugin-id'); expect(dom.window.document.body.textContent).toContain('Local catalog unavailable')
    expect(dom.window.document.querySelector('.hub-row-label')!.textContent).toBe('Marked model')
    expect(api.list).toHaveBeenCalledTimes(1); expect(api.modelCatalog).toHaveBeenCalledTimes(1)
  }))

  it('keeps every known diagnostic bilingual and unknown content verbatim', () => {
    expect(Object.keys(titleCopy.zh)).toEqual(Object.keys(titleCopy.en))
    expect(Object.keys(castCopy.zh)).toEqual(Object.keys(castCopy.en))
    for (const key of Object.keys(castCopy.en)) {
      const value = castCopy.en[key as keyof typeof castCopy.en]
      const text = typeof value === 'function' ? value('LABEL', 'EXTRA') : value
      expect(text, `castCopy.en.${key}`).not.toMatch(/[\u3400-\u9fff]/)
    }
    for (const language of ['zh', 'en'] as const) {
      expect(titleMessage('User 原样', language)).toBe('User 原样')
      expect(hubMessage('Remote 原样', language)).toBe('Remote 原样')
    }
    for (const [zh, en] of hubMessages) {
      expect(hubMessage(zh, 'en')).toBe(en); expect(hubMessage(en, 'zh')).toBe(zh)
      expect(en).not.toMatch(/[\u3400-\u9fff]/)
    }
  })

  it('translates sync failures on the mounted hub as locale changes without refetching or changing a query', async () => mounted(async (dom, root) => {
    const locale = localeStore()
    let fail = (_message: string) => {}
    const api = { list: vi.fn(async () => []), modelCatalog: vi.fn(async () => ({ groups: [] })), setField: vi.fn(async () => ({ committed: true as const, ns: 'owner' })),
      subscribeChanges: (_change: () => void, failed?: (message: string) => void) => { fail = failed!; return () => { fail = () => {} } } }
    await act(async () => root.render(<HubPage locale={locale} api={api} />))
    const input = dom.window.document.querySelector('input')!
    await act(async () => Simulate.change(input, { target: { value: '保留 query' } } as never))
    for (const message of ['Model settings sync service unavailable', 'Invalid model settings change frame',
      'Model settings sync change arrived before ready', 'Model settings sync stream ended after ready; refresh or reopen the page',
      'Model settings sync stream ended before ready; refresh or reopen the page']) {
      await locale.change('en'); await act(async () => fail(message))
      expect(dom.window.document.querySelector('[role="alert"]')!.textContent).toBe(`Live sync unavailable: ${message}`)
      await locale.change('zh')
      const alert = dom.window.document.querySelector('[role="alert"]')!.textContent!
      expect(alert).toContain('自动同步不可用：'); expect(alert).not.toMatch(/Model settings|Invalid model/)
      expect(input.value).toBe('保留 query')
    }
    await act(async () => fail('Remote diagnostic 原样'))
    expect(dom.window.document.querySelector('[role="alert"]')!.textContent).toBe('自动同步不可用：Remote diagnostic 原样')
    expect(api.list).toHaveBeenCalledTimes(1); expect(api.modelCatalog).toHaveBeenCalledTimes(1)
  }))

  it('covers owned sync and model-setting owner defaults without translating unrelated diagnostics', () => {
    const sync = readFileSync(new URL('../../dsh-plugin-kit/src/model-settings-client.ts', import.meta.url), 'utf8')
    const syncMessages = [...sync.matchAll(/(?:new Error|report)\('([^']+)'/g)].map(match => match[1]!)
    expect(syncMessages.length).toBeGreaterThan(0)
    for (const message of syncMessages) expect(hubMessage(message, 'zh')).not.toBe(message)
    for (const message of ['dsh-git-commit: plugin disabled', 'dsh-git-commit: settings changed; reload and retry',
      'Settings changed; reload and retry', 'Only reviewer settings may be edited here', 'invalid reviewer provider/model identifier',
      'provider and model must be configured together', 'reasoningEffort requires a reviewer model']) {
      expect(hubMessage(message, 'zh')).not.toBe(message)
    }
    expect(hubMessage('Provider response: unknown config field: custom', 'zh')).toBe('Provider response: unknown config field: custom')
  })
})
