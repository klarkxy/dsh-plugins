import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { GitCommitAction, apply, clientCss } from './client.tsx'

interface Rule {
  selectors: readonly string[]
  body: string
  order: number
}

/**
 * Flatten a scoped stylesheet into the rules it actually declares, with `&`
 * resolved against the enclosing selector. The generated contract sheet nests
 * every recipe under its roots and documents each block in place, so both the
 * nesting and the comments have to be resolved before a selector means
 * anything.
 */
function flatten(input: string, scope: readonly string[] = []): Rule[] {
  const css = input.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const rules: Rule[] = []
  let cursor = 0
  while (cursor < css.length) {
    const open = css.indexOf('{', cursor)
    if (open === -1) break
    const head = css.slice(cursor, open).trim()
    let depth = 0
    let close = open
    for (; close < css.length; close += 1) {
      if (css[close] === '{') depth += 1
      else if (css[close] === '}' && --depth === 0) break
    }
    const body = css.slice(open + 1, close)
    const parts = head.split(',').map(part => part.trim()).filter(Boolean)
    const selectors = head.startsWith('@')
      ? []
      : parts.flatMap(part => (part.includes('&') ? scope.map(root => part.replaceAll('&', root)) : [part]))
    cursor = close + 1
    // A block with no block of its own declares properties; anything else is a
    // nested rule (or a media query) whose contents are scoped one level deeper.
    if (body.includes('{')) {
      for (const nested of flatten(body, head.startsWith('@') ? scope : selectors)) {
        rules.push({ ...nested, order: rules.length })
      }
    } else rules.push({ selectors, body, order: rules.length })
  }
  return rules
}

/** Classes, ids and type selectors, which is all this sheet is written with. */
function specificity(selector: string): number {
  return (selector.match(/#[\w-]+/g) ?? []).length * 100
    + (selector.match(/\.[\w-]+|:(?!:)[\w-]+/g) ?? []).length * 10
    + (selector.replace(/[.#][\w-]+|::?[\w-]+(\([^)]*\))?/g, '').match(/[a-zA-Z][\w-]*/g) ?? []).length
}

/**
 * The element a rule targets, reduced to what decides a match: the classes it
 * renders with and the classes its ancestors carry. The panel is portaled to
 * `document.body`, so it has no root ancestor — a descendant selector can never
 * be the one that styles it.
 */
interface Target {
  classes: ReadonlySet<string>
  ancestors: ReadonlySet<string>
}

function matches(selector: string, target: Target): boolean {
  const parts = selector.split(/\s+/).filter(Boolean)
  const compound = (part: string) => [...part.matchAll(/\.([\w-]+)/g)].map(match => match[1]!)
  const last = parts.at(-1)
  if (!last) return false
  if (last !== '*' && !compound(last).every(name => target.classes.has(name))) return false
  // Every earlier part is an ancestor, and an element never matches itself there.
  return parts.slice(0, -1).every(part => compound(part).every(name => target.ancestors.has(name)))
}

/** The declaration that wins for `property` on `target`, cascade rules applied. */
function winner(rules: readonly Rule[], target: Target, property: string): { value: string; selector: string } | undefined {
  let best: { value: string; selector: string; weight: number; order: number } | undefined
  for (const rule of rules) {
    const declaration = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(rule.body)?.[1]?.trim()
    if (!declaration) continue
    for (const selector of rule.selectors) {
      if (!matches(selector, target)) continue
      const weight = specificity(selector)
      if (!best || weight > best.weight || (weight === best.weight && rule.order > best.order)) {
        best = { value: declaration, selector, weight, order: rule.order }
      }
    }
  }
  return best && { value: best.value, selector: best.selector }
}

describe('git commit client', () => {
  it('injects its stylesheet once from apply, not inside the header button', async () => {
    // One stylesheet serves both the header popover and the plugin-page
    // settings, so the settings page is styled even when no session header is
    // mounted (see the clientCss comment in client.tsx). Injecting it inside
    // the button component used to leave the settings page unstyled.
    const dom = new JSDOM('<html><head></head><body><div id="root"></div></body></html>')
    const previous = new Map<string, unknown>()
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
      Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
      previous.set(key, (globalThis as Record<string, unknown>)[key])
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
    const root = createRoot(dom.window.document.getElementById('root')!)
    const disposers: Array<(() => void) | void> = []
    const owned = () => [...dom.window.document.head.querySelectorAll('style[data-plugin="dsh-git-commit-client"]')]
    try {
      apply({
        provide() {},
        effect: (fn: () => (() => void) | void) => { disposers.push(fn()) },
        inject: (_deps: string[], callback: (scope: unknown) => void) => callback({ remote: { $mount: async () => async () => {} }, effect() {} }),
        slots: { inject: () => () => {}, register: () => () => {} },
        locale: { register: () => () => {} },
      } as never)
      await act(async () => root.render(createElement(GitCommitAction, {
        sessionId: 's1',
        call: async () => ({ ok: true, value: { available: true, branch: 'main', workspace: { files: 1 } } }),
        useSession: () => false,
        t: (key: string) => key,
      })))
      await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!.click())
      expect(owned()).toHaveLength(1)
      expect(owned()[0]!.textContent).toBe(clientCss)
      expect(dom.window.document.querySelectorAll('.gcm-root style')).toHaveLength(0)
      for (const dispose of disposers) if (typeof dispose === 'function') dispose()
      expect(owned()).toHaveLength(0)
    } finally {
      await act(async () => root.unmount())
      dom.window.close()
      for (const [key, value] of previous) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
  })

  it('keeps the portaled panel fixed to the trigger', () => {
    // The panel is portaled to `document.body` and carries the root class
    // itself, so the contract sheet's `dsh-ui-surface` recipe reaches it and
    // declares `position: relative`. Left in flow, the anchored left/top read
    // as offsets from the end of <body> and the popover lands at the bottom of
    // the page instead of at the button. The panel's own rule has to win.
    const panel: Target = { classes: new Set(['gcm-root', 'gcm-panel', 'dsh-ui-surface']), ancestors: new Set() }
    const resolved = winner(flatten(clientCss), panel, 'position')
    expect(resolved?.value).toBe('fixed')
    expect(resolved?.selector).toBe('.gcm-root.gcm-panel')
  })
})
