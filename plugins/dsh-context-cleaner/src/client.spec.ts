// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { beforeEach, describe, expect, it } from 'vitest'

/**
 * The browser half is a plain JavaScript module the host loads raw, so it is
 * exercised the way the host loads it: the file is evaluated in a fresh
 * context whose only global is the module loader.
 *
 * The path is resolved from `import.meta.url` rather than through `new URL`,
 * because the jsdom environment replaces the global URL with one that resolves
 * against the document base.
 */
const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'client.js'), 'utf8')

type Registration = { id: string; factory: () => { apply: (ctx: unknown) => void } }

/** Evaluate the module half and return the plugin it registers. */
function loadPlugin(): Registration {
  let registration: Registration | undefined
  runInNewContext(source, {
    // The Host loads this file into the page, so the sandbox it runs in has
    // the document; a sandbox without it would take the module's
    // server-side branch and install nothing.
    document,
    window: { __ModuleLoader__: { load: (value: Registration) => { registration = value } } },
  })
  if (!registration) throw new Error('the client half registered nothing')
  return registration
}

/** A context whose effect disposers are collected so unload can be asserted. */
function mount(): { disposers: Array<() => void>; effects: number } {
  const disposers: Array<() => void> = []
  const ctx = {
    effect(run: () => (() => void) | void) {
      const dispose = run()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
  }
  loadPlugin().factory().apply(ctx)
  return { disposers, effects: disposers.length }
}

/** The one stylesheet this plugin owns, or null when nothing is installed. */
function ownedStyle(): HTMLStyleElement | null {
  return document.querySelector('style[data-plugin="@klarkxy/dsh-context-cleaner"]')
}

const OWNER_ID = '@klarkxy/dsh-context-cleaner'

beforeEach(() => {
  /* The jsdom environment shares one document across this file's tests; a
   * style tag appended by an earlier test would otherwise leak into the
   * unload and reload assertions. */
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

/**
 * The dsh-context dashboard, reduced to the structure the rule targets: the
 * header row holds the stats card and the column that wraps the plugin-info
 * and promotion cards. The settings layer renders under its own class, so the
 * same markup there proves the rule cannot reach it.
 */
function dashboard(): void {
  document.body.innerHTML = `
    <div class="lc-root">
      <div class="lc-cols lc-head">
        <div class="lc-card"><div class="lc-stats"></div></div>
        <div class="lc-col">
          <div class="lc-card"><div class="lc-pi-grid"></div></div>
          <a class="lc-card lc-recom" href="#"></a>
        </div>
      </div>
      <div class="lc-cols lc-cols-main">
        <div class="lc-col"><div class="lc-card"></div></div>
      </div>
      <div class="lc-modal-card"><div class="lc-pi-grid"></div></div>
    </div>`
}

describe('context cleaner client half', () => {
  it('installs one stylesheet the host can attribute to this package', () => {
    mount()
    const style = ownedStyle()
    expect(style).not.toBeNull()
    // The host removes a package's styles by its owner id — the registration
    // id minus a '/client' suffix — and it matches the tag's data-plugin
    // attribute exactly. A short alias would survive an unload.
    expect(style!.dataset.plugin).toBe(OWNER_ID)
    expect(style!.textContent).toContain('.lc-root')
  })

  it('is removed by the host rule that clears an unloaded package', () => {
    mount()
    const style = ownedStyle()!
    // The Host's own removal query: every style tag whose data-plugin equals
    // the package id. Reproduced here so the tag's id cannot drift from it.
    const removed = [...document.querySelectorAll('style[data-plugin]')]
      .filter(element => element.getAttribute('data-plugin') === OWNER_ID)
    expect(removed).toContain(style)
    for (const element of removed) element.remove()
    expect(ownedStyle()).toBeNull()
  })

  it('hides only the header column that wraps the two decoration cards', () => {
    dashboard()
    mount()
    const style = ownedStyle()!
    const rule = style.textContent.match(/([^{]+)\{[^}]*\}/)?.[1] ?? ''
    expect(rule).toContain(':has(.lc-pi-grid, .lc-recom)')

    // The rule is applied by the browser, not by this test; the contract it
    // asserts is which elements the selector matches.
    const hidden = [...document.querySelectorAll<HTMLElement>('.lc-root *')]
      .filter(element => element.matches('.lc-root > .lc-cols.lc-head > .lc-col:has(.lc-pi-grid, .lc-recom)'))
    expect(hidden).toHaveLength(1)
    expect(hidden[0]!.querySelector('.lc-pi-grid')).not.toBeNull()
    expect(hidden[0]!.querySelector('.lc-recom')).not.toBeNull()

    // The stats card is the sibling that fills the freed space, so it must
    // survive the rule.
    expect(document.querySelector('.lc-head > .lc-card > .lc-stats')).not.toBeNull()
  })

  it('cannot reach the plugin settings layer or the main columns', () => {
    dashboard()
    mount()
    const rule = '.lc-root > .lc-cols.lc-head > .lc-col:has(.lc-pi-grid, .lc-recom)'
    // The settings layer renders under its own class, outside the header row.
    expect(document.querySelector('.lc-modal-card')!.matches(rule)).toBe(false)
    expect(document.querySelector('.lc-cols-main .lc-col')!.matches(rule)).toBe(false)
  })

  it('removes its stylesheet when the effect is disposed, so unloading restores the cards', () => {
    dashboard()
    const { disposers } = mount()
    expect(ownedStyle()).not.toBeNull()
    for (const dispose of disposers) dispose()
    expect(ownedStyle()).toBeNull()
  })

  it('re-applies cleanly after a reload instead of stacking stylesheets', () => {
    dashboard()
    const first = mount()
    for (const dispose of first.disposers) dispose()
    mount()
    expect(document.querySelectorAll(`style[data-plugin="${OWNER_ID}"]`)).toHaveLength(1)
  })
})
