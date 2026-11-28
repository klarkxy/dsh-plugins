// Read-only bridge serializing the host's active official `--dsw-*` CSS custom
// properties and `color-scheme` into the opaque sandboxed canvas document so
// inline and sidebar HTML/SVG cards adapt seamlessly to light and dark themes.
import { OFFICIAL_THEME_TOKEN_NAMES } from '@klarkxy/dsh-plugin-kit/official-ui'

function parseColorRgb(raw: string): [number, number, number] | undefined {
  const value = raw.trim()
  if (value.startsWith('#')) {
    const hex = value.slice(1)
    if (hex.length === 3 || hex.length === 4) {
      const r = Number.parseInt(hex[0]! + hex[0]!, 16)
      const g = Number.parseInt(hex[1]! + hex[1]!, 16)
      const b = Number.parseInt(hex[2]! + hex[2]!, 16)
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return [r, g, b]
    } else if (hex.length === 6 || hex.length === 8) {
      const r = Number.parseInt(hex.slice(0, 2), 16)
      const g = Number.parseInt(hex.slice(2, 4), 16)
      const b = Number.parseInt(hex.slice(4, 6), 16)
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return [r, g, b]
    }
    return undefined
  }
  const rgbMatch = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/iu.exec(value)
  if (rgbMatch) {
    return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])]
  }
  return undefined
}

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
  const rgb = parseColorRgb(bg)
  if (rgb) {
    const lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]
    return lum < 128 ? 'dark' : 'light'
  }
  if (typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
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
