import { describe, expect, it } from 'vitest'
import { OFFICIAL_THEME_TOKEN_NAMES } from '@klarkxy/dsh-plugin-kit/official-ui'
import { zhihuClientStyles } from './client-styles.ts'

const ROOTS = ['.zhihu-panel'] as const
/** The plugin's own half of the sheet, i.e. everything the contract does not own. */
const OWN_CSS = zhihuClientStyles.slice(zhihuClientStyles.lastIndexOf('\n.zhihu-panel {'))

describe('zhihu official theme scope', () => {
  it('scopes the shared contract to the plugin root under every surface it mounts', () => {
    for (const root of ROOTS) expect(zhihuClientStyles).toContain(`${root} {`)
    expect(zhihuClientStyles).toContain('Scope: .zhihu-panel')
    for (const layer of ['& .dsh-ui-card {', '& .dsh-ui-field {', '& .dsh-ui-banner {',
      '& .dsh-ui-select {', '& .dsh-ui-empty {', '& .dsh-ui-stack {', '& .dsh-ui-readonly {']) {
      expect(zhihuClientStyles).toContain(layer)
    }
  })

  it('reads ordinary DSH light and dark and never declares a theme of its own', () => {
    // The host publishes both palettes; a media query or a local token block
    // here would pin one of them and drift from the surrounding page.
    expect(zhihuClientStyles).not.toMatch(/@media\s*\(\s*prefers-color-scheme/)
    expect(zhihuClientStyles).not.toMatch(/data-theme|data-ds-dark-theme|radix-themes|color-scheme\s*:/)
  })
})

describe('zhihu layout uses the contract, not a private palette', () => {
  it('leaves sections, panels and action rows to the contract classes', () => {
    // Sections, panels and action rows are the contract's, so the plugin may
    // not re-spell the classes that used to carry their layout. The delimiter
    // keeps a longer plugin class from matching as a prefix of itself.
    expect(OWN_CSS).not.toMatch(/\.(zhihu-settings|zhihu-knowledge|zhihu-panel-body|zhihu-row|zhihu-field|zhihu-scopes|zhihu-button|zhihu-tab|zhihu-scope|zhihu-dot)[ ,{:]/)
  })

  it('resets host link background on self-contained result titles', () => {
    expect(OWN_CSS).toContain('.zhihu-panel a.zhihu-link {')
    expect(OWN_CSS).toMatch(/\.zhihu-panel a\.zhihu-link \{[^}]*background: none/)
  })

  it('leaves the result and usage card surfaces to the contract so host paint cannot win', () => {
    // The contract's card owns the surface at a specificity no host list rule
    // reaches from the outside, so the plugin declares no card of its own.
    expect(OWN_CSS).not.toMatch(/\.zhihu-(result-item|usage-card|quota-metric)\b/)
  })

  it('leaves the tab strip layout to the primitive', () => {
    expect(OWN_CSS).toMatch(/\.zhihu-tabs \{[^}]*margin: 0/)
    expect(OWN_CSS).not.toMatch(/\.zhihu-tabs \{[^}]*(flex-wrap|width|display)/)
  })
})

describe('official quota matrix layout', () => {
  it('keeps long quota tables scrollable and figures aligned', () => {
    expect(OWN_CSS).toMatch(/\.zhihu-quota-scroll \{[^}]*overflow-x: auto/)
    expect(OWN_CSS).toMatch(/\.zhihu-quota-table \{[^}]*border-collapse: collapse/)
    expect(OWN_CSS).toMatch(/\.zhihu-quota-value \{[^}]*font-variant-numeric: tabular-nums/)
    expect(OWN_CSS).toMatch(/\.zhihu-quota-cell \{[^}]*text-align: end/)
    expect(OWN_CSS).toMatch(/\.zhihu-quota-track \{[^}]*height: 3px/)
    expect(OWN_CSS).toMatch(/\.zhihu-quota-fill \{[^}]*margin-inline-start: auto/)
    expect(OWN_CSS).toContain('@media (max-width: 480px)')
  })
})

describe('zhihu destructive action', () => {
  it('keeps the outlined resting appearance and only tints on pointer or keyboard', () => {
    const rule = OWN_CSS.match(/\.zhihu-button-danger:hover:not\(:disabled\),\s*\.zhihu-button-danger:focus-visible \{[^}]*\}/)
    expect(rule?.[0]).toBeTruthy()
    expect(OWN_CSS).not.toMatch(/^\.zhihu-button-danger \{/m)
  })
})

describe('zhihu activity feedback', () => {
  it('uses the official TextShimmer and declares no private activity animation', () => {
    // TextShimmer owns the running highlight and its reduced-motion behavior;
    // a private keyframe or dot rule here would fork the official animation.
    expect(zhihuClientStyles).not.toMatch(/zhihu-dots|@keyframes/)
  })
})

describe('zhihu official token guard', () => {
  it('colors only through whitelisted host tokens', () => {
    const tokens = [...zhihuClientStyles.matchAll(/var\(\s*(--[a-z0-9-]+)\s*[),]/gi)].map(match => match[1])
    expect(tokens.length).toBeGreaterThan(0)
    for (const token of tokens) expect(OFFICIAL_THEME_TOKEN_NAMES).toContain(token)
  })

  it('never pins a palette with a literal fallback', () => {
    // A literal fallback (a hex, rgb or px value after the comma) would stick
    // when the host switches themes; token-to-token fallbacks stay legal.
    expect(zhihuClientStyles).not.toMatch(/var\(\s*--[a-z0-9-]+\s*,\s*(#|rgb|hsl|\d)/i)
  })

  it('keeps every top-level rule under the plugin root', () => {
    // Depth-0 selectors may only open the .zhihu-panel scope (or be an at-rule);
    // a bare class here would paint the whole host document. Comments carry no
    // selectors, so they leave the scan first.
    const css = zhihuClientStyles.replace(/\/\*[\s\S]*?\*\//g, '')
    let depth = 0
    let statement = ''
    const offenders: string[] = []
    for (const char of css) {
      if (char === '{') {
        if (depth === 0 && !/^\s*(\.zhihu-panel\b|@)/.test(statement)) offenders.push(statement.trim())
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
