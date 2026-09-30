import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { OFFICIAL_THEME_TOKEN_NAMES, OFFICIAL_FOCUS_RING, officialElevation, officialFocus, officialUiCss } from './official-ui'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const pluginsRoot = join(repoRoot, 'plugins')

/**
 * Host-published custom properties that are structural rather than themed: the
 * primitives and the shell set them per instance, so a stylesheet reads them
 * without the theme ever declaring them.
 */
const STRUCTURAL_TOKENS = new Set([
  '--dsh-menu-anchor',
  '--dsh-segment-count',
  '--dsh-segment-index',
  '--dsh-toast-hold',
])

const ALLOWED = new Set([...OFFICIAL_THEME_TOKEN_NAMES, ...STRUCTURAL_TOKENS])

/** Build output and vendored dependencies carry no authored styling. */
const SKIP_DIRS = new Set(['node_modules', 'lib', 'dist', 'outDir', '.test-output', 'coverage'])

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) { sourceFiles(full, out); continue }
    if (/\.(tsx?|jsx?|mjs|css)$/.test(entry)) out.push(full)
  }
  return out
}

/** Every `var(--token` reference, plus every `--token:` custom-property set. */
function customProperties(text: string): string[] {
  return [...text.matchAll(/var\(\s*(--[a-z0-9-]+)/g), ...text.matchAll(/(--[a-z0-9-]+)\s*:/g)]
    .map(match => match[1]!)
}

/**
 * The contract and this spec define the vocabulary rather than consume it, so
 * they are the one place allowed to mention a token outside the allowlist —
 * the allowlist itself, and the interpolated elevation prefix.
 */
const DEFINITIONS = new Set([
  'plugins/dsh-plugin-kit/src/official-ui.ts',
  'plugins/dsh-plugin-kit/src/official-ui.spec.ts',
])

function filesWithStyling(): string[] {
  return sourceFiles(pluginsRoot)
    .filter(file => /--ds[wh]-/.test(readFileSync(file, 'utf8')))
    .filter(file => !DEFINITIONS.has(file.slice(repoRoot.length).replaceAll('\\', '/')))
}

describe('official UI contract', () => {
  it('names only real theme tokens', () => {
    // A typo in the allowlist would quietly widen what the guard test accepts.
    // The prefixes are the host's three families: themed (dsw), host-published
    // structural (dsh) and plain host (ds).
    for (const name of OFFICIAL_THEME_TOKEN_NAMES) expect(name).toMatch(/^--(dsw|dsh|ds)-[a-z0-9-]+$/)
    expect(new Set(OFFICIAL_THEME_TOKEN_NAMES).size).toBe(OFFICIAL_THEME_TOKEN_NAMES.length)
  })

  it('lets plugin styling reference nothing but official tokens', () => {
    const offenders: string[] = []
    for (const file of filesWithStyling()) {
      const relative = file.slice(repoRoot.length)
      for (const token of new Set(customProperties(readFileSync(file, 'utf8')))) {
        if (!ALLOWED.has(token)) offenders.push(`${relative}: ${token}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('scopes every rule to the caller roots and closes what it opens', () => {
    const css = officialUiCss(['a-root', 'b-root'])
    expect(css).toContain('.a-root, .b-root {')
    // Every rule after the scope opener must nest with the parent selector.
    // A rule written as a bare `.dsh-ui-x` would be global, which is the one
    // way this stylesheet could style a neighbouring plugin's markup.
    const body = css.slice(css.indexOf('.a-root, .b-root {') + '.a-root, .b-root {'.length)
    // A rule that does not start with the parent selector is global, which is
    // the one way this stylesheet could reach a neighbouring plugin's markup.
    const global_ = body.split('\n')
      .map(line => line.trim())
      .filter(line => /^[a-zA-Z.#\[][^{]*\{$/.test(line) && !line.startsWith('&'))
    expect(global_).toEqual([])
    // The scope rule stays open for the sheet and closes at the very end, so an
    // unbalanced brace would silently drop every rule after the break.
    const open = (css.match(/{/g) ?? []).length
    expect((css.match(/}/g) ?? []).length).toBe(open)
    expect(css.trimEnd().endsWith('}\n}')).toBe(true)
  })

  it('lets a recipe class style the root element itself, not only a descendant', () => {
    const css = officialUiCss('dsh-fixture')
    // The commonest arrangement is one element that is both the scope and the
    // surface — a card carrying the root class, or a portaled dialog. A
    // descendant-only rule matches neither, and fails silently.
    expect(css).toContain('&.dsh-ui-card, & .dsh-ui-card {')
    expect(css).toContain('&.dsh-ui-surface, & .dsh-ui-surface {')
    expect(css).toContain('&.dsh-ui-field, & .dsh-ui-field {')
    // A sibling rule is a different thing and must keep its own shape.
    expect(css).toContain('& .dsh-ui-field + .dsh-ui-field {')
    // Every recipe the sheet defines must be reachable from the root.
    const recipes = [...new Set([...css.matchAll(/\.dsh-ui-[a-z0-9-]+/g)].map(m => m[0]))]
    const unreachable = recipes.filter(name => !css.includes(`&${name},`))
    expect(unreachable).toEqual([])
  })

  it('keeps the focus ring and elevation on the host tokens', () => {
    expect(officialFocus()).toBe(`outline: ${OFFICIAL_FOCUS_RING}; outline-offset: 2px`)
    expect(officialFocus('1px')).toContain('outline-offset: 1px')
    expect(officialElevation('prominent')).toBe('border: 0; box-shadow: var(--dsw-elevation-prominent)')
    const css = officialUiCss('dsh-fixture')
    expect(css).toContain(':focus-visible')
    expect(css).toContain('box-shadow: var(--dsw-elevation-stroke)')
  })

  it('never carries a literal colour fallback behind a theme token', () => {
    // The host publishes light and dark, so a colour literal pins one of them
    // and a plugin stylesheet holding one is quietly keeping a private theme.
    // Two things are deliberately not that: a fallback that is itself a token
    // (the focus ring falling back to the business accent, copied from the host)
    // and a font stack, where the fallback names local faces rather than a
    // colour. Deciding this in code rather than in one clever regex: a regex
    // with a negative lookahead silently backtracks into the fallback itself.
    const offenders: string[] = []
    for (const file of filesWithStyling()) {
      const relative = file.slice(repoRoot.length)
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/var\(\s*(--ds[wh]?[a-z0-9-]*)\s*,\s*([^)]+)\)/g)) {
        const [, token, fallback] = match
        if (!token.startsWith('--ds')) continue
        if (fallback!.trimStart().startsWith('var(')) continue
        if (token === '--ds-font-family-code') continue
        offenders.push(`${relative}: var(${token}, <literal>)`)
      }
    }
    expect(offenders).toEqual([])
  })
})
