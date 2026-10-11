import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { apply } from './client.tsx'
import { CODE_FONT_PRESETS, CODE_FONT_VARIABLE, STORAGE_KEY, UI_FONT_PRESETS, UI_FONT_VARIABLE, createFontSettingsOverride } from './contracts.ts'

interface ThemeSnapshot {
  preference: 'light' | 'dark' | 'system'
  revision: number
  themes: unknown[]
  active: { id: string; colorScheme: 'light' | 'dark'; tokens: Record<string, string> }
  fontSize: number
}

// Execute the target's published DOM presenter, without importing its client
// bundle's unrelated renderer/UI dependencies. Fail if the artifact changes.
const workspaceRequire = createRequire(new URL('../../../package.json', import.meta.url))
const dshRequire = createRequire(workspaceRequire.resolve('@deepseek-ai/dsh/package.json'))
const webRequire = createRequire(dshRequire.resolve('@deepseek-ai/dsh-web-app/package.json'))
const layoutPackage = webRequire.resolve('@deepseek-ai/dsh-client-ui-layout/package.json')
const layoutVersion = JSON.parse(readFileSync(layoutPackage, 'utf8')).version
if (layoutVersion !== '0.2.0-rc.2') throw new Error(`Font target presenter must be rc.2, got ${layoutVersion}`)
const layoutSource = readFileSync(pathToFileURL(join(dirname(layoutPackage), 'lib/client.js')), 'utf8')
const presenterStart = layoutSource.indexOf('const DARK_ATTRIBUTE =')
const presenterEnd = layoutSource.indexOf('//#endregion', presenterStart)
if (presenterStart < 0 || presenterEnd < 0) throw new Error('Target ThemePresenter source not found')
const Presenter = new Function(`${layoutSource.slice(presenterStart, presenterEnd)}; return ThemePresenter`)() as new () => {
  apply(snapshot: ThemeSnapshot): void
  dispose(): void
}

async function mounted(run: (view: {
  dom: JSDOM
  sizes: number[]
  publish(patch: Partial<ThemeSnapshot>): Promise<void>
  select(index: number, value: string): Promise<void>
  disposePlugin(): void
}) => Promise<void>, legacy = { uiFont: '', codeFont: '' }, presenterFirst = true) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { url: 'https://font.test/' })
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true })) vi.stubGlobal(key, value)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy))
  let snapshot: ThemeSnapshot = { preference: 'light', revision: 0, themes: [],
    active: { id: 'light', colorScheme: 'light', tokens: {} },
    fontSize: 14 }
  const listeners = new Set<(snapshot: ThemeSnapshot) => void>()
  const presenter = new Presenter()
  presenter.apply(snapshot)
  const present = (next: ThemeSnapshot) => presenter.apply(next)
  if (presenterFirst) listeners.add(present)
  const effects: Array<() => void> = []
  const sizes: number[] = []
  let render: ((props: { view: string }) => ReactNode) | undefined
  const context = {
    effect(run: () => (() => void)) { effects.push(run()) },
    slots: { inject(_key: string, callback: () => void) { callback(); return () => {} },
      register(_spec: unknown, callback: typeof render) { render = callback; return () => {} } },
    theme: { getTheme: () => snapshot, setFontSize(px: number) {
      sizes.push(px); snapshot = { ...snapshot, fontSize: px, revision: snapshot.revision + 1 }
      for (const listener of listeners) listener(snapshot)
    } },
    locale: { getSnapshot: () => ({ active: 'en' }), subscribe: () => () => {} },
    on(_event: string, listener: (snapshot: ThemeSnapshot) => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  apply(context as never)
  if (!presenterFirst) listeners.add(present)
  const root = createRoot(dom.window.document.getElementById('root')!)
  const disposePlugin = () => { for (const dispose of effects.splice(0)) dispose() }
  try {
    await act(async () => { root.render(render!({ view: 'page' })); await Promise.resolve() })
    await run({ dom, sizes, disposePlugin,
      async publish(patch) { await act(async () => {
        snapshot = { ...snapshot, ...patch, revision: snapshot.revision + 1 }
        for (const listener of listeners) listener(snapshot)
        await Promise.resolve()
      }) },
      async select(index, value) { await act(async () => {
        const select = dom.window.document.querySelectorAll('select')[index]!
        select.value = value; select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
      }) },
    })
  } finally {
    await act(async () => root.unmount())
    disposePlugin(); presenter.dispose(); vi.unstubAllGlobals(); dom.window.close()
  }
}

describe('font interaction with DSH target presenter', () => {
  it('restores prior declarations and priorities without retracting a later third-party write', () => {
    const dom = new JSDOM('<body></body>')
    const style = dom.window.document.documentElement.style
    style.setProperty(UI_FONT_VARIABLE, 'Prior Sans', 'important')
    style.setProperty(CODE_FONT_VARIABLE, 'Prior Mono')
    const override = createFontSettingsOverride(style)
    override.apply({ uiFont: 'Local Sans', codeFont: 'Local Mono' })
    style.setProperty(CODE_FONT_VARIABLE, 'Other Mono')
    override.dispose()
    expect(style.getPropertyValue(UI_FONT_VARIABLE)).toBe('Prior Sans')
    expect(style.getPropertyPriority(UI_FONT_VARIABLE)).toBe('important')
    expect(style.getPropertyValue(CODE_FONT_VARIABLE)).toBe('Other Mono')
    dom.window.close()
  })

  it.each([true, false])('keeps legacy local fonts across theme changes (presenter first: %s)', async presenterFirst => {
    await mounted(async ({ dom, publish, disposePlugin }) => {
      const style = dom.window.document.documentElement.style
      expect(dom.window.document.body.style.getPropertyValue(UI_FONT_VARIABLE)).toBe('')
      expect(style.getPropertyValue(UI_FONT_VARIABLE)).toBe('Local Sans')
      expect(style.getPropertyValue(CODE_FONT_VARIABLE)).toBe('Local Mono')
      await publish({ fontSize: 17, active: { id: 'dark', colorScheme: 'dark', tokens: {} } })
      expect(style.getPropertyValue(CODE_FONT_VARIABLE)).toBe('Local Mono')
      disposePlugin()
      expect(style.getPropertyValue(CODE_FONT_VARIABLE)).toBe('')
      expect(style.getPropertyValue(UI_FONT_VARIABLE)).toBe('')
      expect(dom.window.document.body.style.getPropertyValue('--dsh-content-font-size')).toBe('17px')
      expect(dom.window.localStorage.getItem(STORAGE_KEY)).toContain('Local Mono')
    }, { uiFont: 'Local Sans', codeFont: 'Local Mono' }, presenterFirst)
  })

  it('edits fonts, persists the old schema, synchronizes content size, and resets to defaults', async () => {
    await mounted(async ({ dom, sizes, select, publish }) => {
      await select(0, 'yahei'); await select(1, 'jetbrains-mono'); await select(2, '18')
      expect(sizes).toEqual([18])
      expect(JSON.parse(dom.window.localStorage.getItem(STORAGE_KEY)!)).toEqual({
        uiFont: UI_FONT_PRESETS[0]!.value, codeFont: CODE_FONT_PRESETS[1]!.value,
      })
      expect(dom.window.document.documentElement.style.getPropertyValue(CODE_FONT_VARIABLE)).toBe(CODE_FONT_PRESETS[1]!.value)
      await publish({ fontSize: 20 })
      expect(dom.window.document.querySelectorAll('select')[2]!.value).toBe('20')
      await act(async () => { dom.window.document.querySelectorAll('button')[1]!.click(); await Promise.resolve() })
      expect(sizes.at(-1)).toBe(14)
      expect(dom.window.document.documentElement.style.getPropertyValue(UI_FONT_VARIABLE)).toBe('')
      expect(dom.window.document.documentElement.style.getPropertyValue(CODE_FONT_VARIABLE)).toBe('')
      expect(dom.window.document.body.style.getPropertyValue('--dsh-content-font-size')).toBe('14px')
      expect(dom.window.localStorage.getItem(STORAGE_KEY)).toBeNull()
    })
  })

  it('loads system fonts again after installation and preserves manual fallback after denial', async () => {
    const query = vi.fn().mockResolvedValueOnce([{ family: 'First Font', fullName: 'First Font' }])
      .mockResolvedValueOnce([{ family: 'First Font' }, { family: 'New Font' }]).mockRejectedValueOnce(new Error('denied'))
    await mounted(async ({ dom }) => {
      vi.stubGlobal('queryLocalFonts', query)
      const button = dom.window.document.querySelectorAll('button')[0]!
      await act(async () => button.click())
      expect(dom.window.document.querySelector('option[value="sys:First Font"]')).not.toBeNull()
      await act(async () => button.click())
      expect(dom.window.document.querySelector('option[value="sys:New Font"]')).not.toBeNull()
      await act(async () => button.click())
      expect(dom.window.document.body.textContent).toContain('denied or is unsupported')
      expect(query).toHaveBeenCalledTimes(3)
      expect(dom.window.document.querySelector('option[value="custom"]')).not.toBeNull()
    })
  })
})
