import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { clientCss } from './client.tsx'

const source = readFileSync(new URL('./client.tsx', import.meta.url), 'utf8')

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
  it('keys the catalog effect on route strings, not the settings object', () => {
    // Depending on `settings?.model` refetched after every save and looped.
    expect(source).not.toContain('settings?.model, text.failed]')
    expect(source).toContain('[props.client, boundProvider, boundModel]')
  })

  it('injects its stylesheet once from apply, not inside the header button', () => {
    expect(source).not.toContain('<style>{css}</style>')
    expect(source).toContain("'git-commit.styles'")
  })

  it('asks for confirmation before committing everything', () => {
    expect(source).toContain("onClick={() => setConfirming(true)}")
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
