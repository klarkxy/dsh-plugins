// Read-only bridge serializing the host's active official `--dsw-*` CSS custom
// properties and `color-scheme` into the opaque sandboxed canvas document so
// inline and sidebar HTML/SVG cards adapt seamlessly to light and dark themes.
import { OFFICIAL_THEME_TOKEN_NAMES } from '@klarkxy/dsh-plugin-kit/official-ui'

function inferColorScheme(doc: Document, rootStyle: CSSStyleDeclaration): 'light' | 'dark' {
  const root = doc.documentElement
  const attrTheme = (root.getAttribute('data-theme') ?? root.getAttribute('data-color-scheme') ?? '').toLowerCase()
  if (attrTheme.includes('dark')) return 'dark'
  if (attrTheme.includes('light')) return 'light'
  if (root.classList.contains('dark')) return 'dark'
  if (root.classList.contains('light')) return 'light'
  const cssScheme = (rootStyle.getPropertyValue('color-scheme') || rootStyle.colorScheme || '').toLowerCase()
  if (cssScheme.includes('dark') && !cssScheme.includes('light')) return 'dark'
  if (cssScheme.includes('light') && !cssScheme.includes('dark')) return 'light'
  const bg = rootStyle.getPropertyValue('--dsw-alias-bg-base').trim()
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/iu.exec(bg)
  if (rgb) {
    const lum = 0.299 * Number(rgb[1]) + 0.587 * Number(rgb[2]) + 0.114 * Number(rgb[3])
    return lum < 128 ? 'dark' : 'light'
  }
  return 'light'
}

function safeCssValue(value: string): boolean {
  return value.length > 0 && value.length <= 240 && !/[{};<>\\\r\n]/u.test(value)
}

/**
 * Snapshot computed official DSH theme tokens and `color-scheme` from the host DOM
 * as semicolon-delimited CSS declarations suitable for `html { ... }` inside the sandbox.
 */
export function serializeHostThemeDeclarations(doc?: Document, scopeElement?: Element | null): string {
  if (!doc?.documentElement || typeof getComputedStyle !== 'function') return ''
  const rootStyle = getComputedStyle(doc.documentElement)
  const scopedTarget = scopeElement ?? doc.querySelector('.dvui-root')
  const scopedStyle = scopedTarget ? getComputedStyle(scopedTarget) : undefined
  const scheme = inferColorScheme(doc, scopedStyle ?? rootStyle)
  const declarations: string[] = [`color-scheme:${scheme}`]
  for (const token of OFFICIAL_THEME_TOKEN_NAMES) {
    const value = (scopedStyle?.getPropertyValue(token) || rootStyle.getPropertyValue(token)).trim()
    if (safeCssValue(value)) declarations.push(`${token}:${value}`)
  }
  return declarations.join(';')
}
