import { describe, expect, it } from 'vitest'
import { OFFICIAL_THEME_TOKEN_NAMES } from '@klarkxy/dsh-plugin-kit/official-ui'
import { currentTitleOwnCss, currentTitleStyles } from './client.tsx'

describe('current-title official token guard', () => {
  it('colors only through whitelisted host tokens across the whole sheet', () => {
    // The sheet is officialUiCss + the shared model-menu recipe + the plugin's
    // own rules; every segment must read the host palette and nothing else.
    const tokens = [...currentTitleStyles.matchAll(/var\(\s*(--[a-z0-9-]+)\s*[),]/gi)].map(match => match[1])
    expect(tokens.length).toBeGreaterThan(0)
    for (const token of tokens) expect(OFFICIAL_THEME_TOKEN_NAMES).toContain(token)
  })

  it('never pins a palette with a literal fallback', () => {
    // Token-to-token fallbacks (the official focus ring form) stay legal; a
    // hex, rgb or px fallback would stick when the host switches themes.
    expect(currentTitleStyles).not.toMatch(/var\(\s*--[a-z0-9-]+\s*,\s*(#|rgb|hsl|\d)/i)
  })
})

describe('current-title scope guard', () => {
  it('keeps every top-level rule of its own segment under the plugin root', () => {
    // The shared model-menu recipe is library-owned and exempt (it carries the
    // .dsh-model-menu-* namespace by design); the plugin's own segment must
    // nest under .ct-root so nothing paints the host document.
    const css = currentTitleOwnCss.replace(/\/\*[\s\S]*?\*\//g, '')
    let depth = 0
    let statement = ''
    const offenders: string[] = []
    for (const char of css) {
      if (char === '{') {
        if (depth === 0 && !/^\s*(\.ct-root\b|@)/.test(statement)) offenders.push(statement.trim())
        depth += 1
        statement = ''
      } else if (char === '}') {
        depth -= 1
        statement = ''
      } else if (depth === 0) {
        statement += char
      }
    }
    expect(offenders).toEqual([])
  })
})
