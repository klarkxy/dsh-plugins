// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { OFFICIAL_THEME_TOKEN_NAMES } from '@klarkxy/dsh-plugin-kit/official-ui'
import { apply } from './client.tsx'
import { webSearchClientStyles } from './client-styles.ts'

/**
 * Selectors that open a block at the top level of the sheet, found by brace
 * depth rather than by a CSS parser: the sheet is small and authored, so a
 * comment-stripped scan is exact here.
 */
function topLevelSelectors(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const selectors: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (char === '{') {
      if (depth === 0) selectors.push(text.slice(start, index).trim())
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) start = index + 1
    }
  }
  return selectors.filter(Boolean)
}

/** Mount only the style effect; the slot registration gets a no-op stub. */
function mount(): HTMLStyleElement | null {
  const ctx = {
    effect: (callback: () => (() => void) | void) => { callback() },
    slots: { inject: () => () => {}, register: () => () => {} },
  }
  apply(ctx as unknown as Context)
  return document.querySelector('style[data-plugin="@klarkxy/dsh-web-search-manager"]')
}

describe('web search manager style guard', () => {
  it('injects exactly the guarded stylesheet', () => {
    expect(mount()?.textContent).toBe(webSearchClientStyles)
  })

  it('references only official theme tokens', () => {
    const allowed = new Set<string>(OFFICIAL_THEME_TOKEN_NAMES)
    const used = [...webSearchClientStyles.matchAll(/var\((--[A-Za-z0-9-]+)/g)].map(match => match[1]!)
    expect(used.length).toBeGreaterThan(0)
    for (const token of used) expect(allowed.has(token), `${token} is not a host token`).toBe(true)
  })

  it('never carries a literal fallback behind a theme token', () => {
    // The host publishes light and dark, so a literal fallback pins one of
    // them. A fallback that is itself a token — the contract's focus ring —
    // is the one exempt form.
    const offenders: string[] = []
    for (const match of webSearchClientStyles.matchAll(/var\(\s*(--ds[wh]?[a-z0-9-]*)\s*,\s*([^)]+)\)/g)) {
      const [, token, fallback] = match
      if (fallback!.trimStart().startsWith('var(')) continue
      offenders.push(`var(${token}, ${fallback!.trim()})`)
    }
    expect(offenders).toEqual([])
  })

  it('keeps every rule under the plugin root, with only at-rules beside it', () => {
    // A bare top-level selector would paint whatever plugin mounts the same
    // class, so only the root scope block, @media and @keyframes may sit there.
    const selectors = topLevelSelectors(webSearchClientStyles)
    expect(selectors.length).toBeGreaterThan(0)
    for (const selector of selectors) {
      const allowed = selector.startsWith('.ws-root') || selector.startsWith('@media') || selector.startsWith('@keyframes')
      expect(allowed, `top-level selector ${selector} is not scoped to .ws-root`).toBe(true)
    }
  })
})
