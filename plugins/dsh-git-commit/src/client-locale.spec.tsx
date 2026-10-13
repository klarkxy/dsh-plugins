import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { GitCommitAction, GitCommitSettingsPanel, apply } from './client.tsx'

function localeService() {
  let active = 'en'
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => ({ active }),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: (next: string) => { active = next; for (const listener of listeners) listener() },
  }
}
async function mount(run: (dom: JSDOM, root: ReturnType<typeof createRoot>) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>')
  const previous = new Map<string, unknown>()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, (globalThis as Record<string, unknown>)[key]); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  const root = createRoot(dom.window.document.getElementById('root')!)
  try { await run(dom, root) }
  finally { await act(async () => root.unmount()); dom.window.close(); for (const [key, value] of previous) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }) }
}
const settings = { revision: 1, model: { provider: 'p', model: 'authored model' }, allowFallback: false }
const ok = (value: unknown) => ({ ok: true, value })

describe('Git Commit live locale', () => {
  it('keeps an in-flight save and translates its success without reloading settings', async () => {
    await mount(async (dom, root) => {
      const locale = localeService()
      let finish!: (value: unknown) => void
      const pending = new Promise(resolve => { finish = resolve })
      const call = vi.fn(async (_channel, endpoint) => endpoint === 'settings.update' ? pending : ok(settings))
      const client = { connection: { rpc: { call } }, locale }
      await act(async () => root.render(<GitCommitSettingsPanel client={client as never} />))
      await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[role="switch"]')!.click())
      await act(async () => locale.set('zh'))
      expect(dom.window.document.body.textContent).toContain('模型不可用时仍然提交')
      expect(dom.window.document.querySelector<HTMLButtonElement>('[role="switch"]')!.disabled).toBe(true)
      expect(call).toHaveBeenCalledTimes(2)
      await act(async () => finish(ok({ ...settings, revision: 2, allowFallback: true })))
      expect(dom.window.document.body.textContent).toContain('已保存。')
      await act(async () => locale.set('en'))
      expect(dom.window.document.body.textContent).toContain('Saved.')
      expect(dom.window.document.body.textContent).not.toContain('已保存。')
      expect(call).toHaveBeenCalledTimes(2)
    })
  })

  it('translates an existing load failure without issuing another read', async () => {
    await mount(async (dom, root) => {
      const locale = localeService(), call = vi.fn(async () => { throw new Error('storage diagnostic') })
      await act(async () => root.render(<GitCommitSettingsPanel client={{ connection: { rpc: { call } }, locale } as never} />))
      expect(dom.window.document.querySelector('[role="alert"]')?.textContent).toBe('Could not load commit settings.')
      await act(async () => locale.set('zh'))
      expect(dom.window.document.querySelector('[role="alert"]')?.textContent).toBe('无法读取提交设置。')
      expect(call).toHaveBeenCalledTimes(1)
    })
  })

  it('localizes owned rejection codes and an empty fallback while preserving external diagnostics', async () => {
    let dictionaries: Record<string, Record<string, string>> = {}
    apply({ provide() {}, effect(fn: () => unknown) { fn() }, locale: { register(_ns: string, value: typeof dictionaries) { dictionaries = value; return () => {} } }, slots: { inject() { return () => {} } } } as never)
    await mount(async (dom, root) => {
      for (const failure of [{ code: 'workspace-changed', message: 'local diagnostic' }, { code: 'unknown', message: '' }, { code: 'external', message: 'provider detail 用户数据' }]) {
        const call = vi.fn(async () => ({ ok: false, error: failure }))
        const useSession = () => false
        const render = (language: string) => root.render(<GitCommitAction key={failure.code} sessionId="s" call={call} useSession={useSession} t={key => dictionaries[language]![key]!} />)
        await act(async () => render('en'))
        await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!.click())
        const before = dom.window.document.querySelector('[role="alert"]')?.textContent
        await act(async () => render('zh'))
        const after = dom.window.document.querySelector('[role="alert"]')?.textContent
        expect(call).toHaveBeenCalledTimes(1)
        if (failure.code === 'external') expect(after).toBe(failure.message)
        else { expect(after).not.toBe(before); expect(after).toMatch(/[\u4e00-\u9fff]/) }
      }
    })
  })
})
