import { describe, expect, it } from 'vitest'
import { OFFICIAL_THEME_TOKEN_NAMES } from '@klarkxy/dsh-plugin-kit/official-ui'
import { zhihuClientStyles } from './client-styles.ts'

const ROOTS = ['.zhihu-panel'] as const
/** A fabricated name is how a second, diverging theme starts. */
const BANNED = /--zh-|--dsh-ui-|--dsw-specific-menu|--default-font-family|--font-size-|--gray-|var\(--ds[wh]-[a-z0-9-]+,/
/** The plugin's own half of the sheet, i.e. everything the contract does not own. */
const OWN_CSS = zhihuClientStyles.slice(zhihuClientStyles.indexOf('.zhihu-settings-embed'))

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

  it('colours only through the tokens the host publishes, with no literal fallback', () => {
    const allowed = new Set<string>(OFFICIAL_THEME_TOKEN_NAMES)
    const used = [...zhihuClientStyles.matchAll(/var\((--[A-Za-z0-9-]+)/g)].map(match => match[1]!)
    expect(used.length).toBeGreaterThan(0)
    for (const token of used) expect(allowed.has(token), `${token} is not a host token`).toBe(true)
  })

  it('keeps the plugin half of the sheet free of fabricated tokens and fallbacks', () => {
    expect(OWN_CSS).not.toMatch(BANNED)
  })
})

describe('zhihu layout uses the contract, not a private palette', () => {
  it('stacks the plugin page and its sections on the contract rhythm', () => {
    expect(OWN_CSS).toMatch(/\.zhihu-settings-embed \{[^}]*display: flex/)
    expect(OWN_CSS).toMatch(/\.zhihu-settings-embed \{[^}]*gap: 12px/)
    expect(OWN_CSS).toMatch(/\.zhihu-settings-embed \{[^}]*max-width: 760px/)
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
    expect(zhihuClientStyles).toMatch(/& \.dsh-ui-card \{[^}]*background: var\(--dsw-alias-bg-layer-1\)/)
    expect(OWN_CSS).not.toMatch(/\.zhihu-(result-item|usage-card|quota-metric)\b/)
  })

  it('snaps card surfaces without a background-color transition', () => {
    expect(zhihuClientStyles).not.toMatch(/transition\s*:[^;]*background-color/)
  })

  it('leaves the tab strip layout to the primitive and confines raw response scrolling', () => {
    expect(OWN_CSS).toMatch(/\.zhihu-tabs \{[^}]*margin: 0/)
    expect(OWN_CSS).not.toMatch(/\.zhihu-tabs \{[^}]*(flex-wrap|width|display)/)
    expect(zhihuClientStyles).toMatch(/& \.dsh-ui-code \{[^}]*overflow-wrap: anywhere/)
    expect(OWN_CSS).toMatch(/\.zhihu-open-platform-data \{[^}]*max-height: 480px/)
    expect(OWN_CSS).toMatch(/\.zhihu-open-platform-data \{[^}]*overflow: auto/)
  })
})

describe('official quota matrix layout', () => {
  it('lays quota out as a scrolling table of host theme colors', () => {
    expect(OWN_CSS).toMatch(/\.zhihu-quota-scroll \{[^}]*overflow-x: auto/)
    expect(OWN_CSS).toMatch(/\.zhihu-quota-table \{[^}]*border-collapse: collapse/)
    expect(OWN_CSS).toMatch(/\.zhihu-quota-value \{[^}]*font-variant-numeric: tabular-nums/)
    expect(zhihuClientStyles).toMatch(/& \.dsh-ui-card \{[^}]*min-width: 0/)
    expect(OWN_CSS).toMatch(/\.zhihu-quota-fill \{[^}]*var\(--dsw-alias-state-business-primary\)/)
    expect(OWN_CSS).toMatch(/\.zhihu-quota-track \{[^}]*var\(--dsw-alias-bg-layer-3\)/)
    expect(OWN_CSS).toMatch(/\.zhihu-chart-bar-fail \{[^}]*var\(--dsw-alias-state-error-primary\)/)
    expect(OWN_CSS).toContain('@media (max-width: 480px)')
  })

  it('keeps the rule subordinate to the figure and out of the reading flow', () => {
    // The number is the read; the 3px rule only helps scan the fraction. A tall
    // bar is what made the panel shout a scale the reader had to decode.
    expect(OWN_CSS).toMatch(/\.zhihu-quota-track \{[^}]*height: 3px/)
    expect(OWN_CSS).toMatch(/\.zhihu-quota-fill \{[^}]*margin-inline-start: auto/)
    // Right-anchored columns put both the digits and the rule's end on the same edge.
    expect(OWN_CSS).toMatch(/\.zhihu-quota-cell \{[^}]*text-align: end/)
    expect(OWN_CSS).toMatch(/\.zhihu-quota-head \{[^}]*text-align: end/)
    // The ceiling already appears in the fraction; it steps back a tone.
    expect(OWN_CSS).toMatch(/\.zhihu-quota-of \{[^}]*var\(--dsw-alias-label-tertiary\)/)
  })
})

describe('zhihu destructive action', () => {
  it('keeps the outlined resting appearance and only tints on pointer or keyboard', () => {
    const rule = OWN_CSS.match(/\.zhihu-button-danger:hover:not\(:disabled\),\s*\.zhihu-button-danger:focus-visible \{[^}]*\}/)
    expect(rule?.[0]).toBeTruthy()
    expect(rule![0]).toContain('var(--dsw-alias-state-error-primary)')
    expect(rule![0]).toContain('var(--dsw-alias-interactive-bg-hover-danger)')
    expect(OWN_CSS).not.toMatch(/^\.zhihu-button-danger \{/m)
  })
})

describe('zhihu activity dots', () => {
  it('pulses in a host accent and stops outright under reduced motion', () => {
    expect(OWN_CSS).toMatch(/\.zhihu-dots \{[^}]*var\(--dsw-alias-state-business-primary\)/)
    expect(OWN_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.zhihu-dots i \{ animation: none; \}/)
  })
})
