import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { expect, it, vi } from 'vitest'

// Exercise the shipped implementation behind the panel's narrow structural
// interface. The package is resolved from this workspace's target dependency,
// never hardcoded to one developer's installation or an obsolete version.
const require = createRequire(import.meta.url)
const source = readFileSync(join(dirname(require.resolve('@deepseek-ai/dsh-client-ui-theme/package.json')), 'lib/client.js'), 'utf8')
function method(name: string) {
  const start = source.indexOf(`\n\t\t\t${name}(`)
  const end = source.indexOf('\n\t\t\t}', start) + '\n\t\t\t}'.length
  if (start < 0 || end <= start) throw new Error(`Target theme method missing: ${name}`)
  return source.slice(start, end)
}

it('published theme exposes stable role snapshots and persists each exact role', () => {
  const constantsStart = source.indexOf('const FONT_SIZE_SPECS =')
  const constantsEnd = source.indexOf('function isThemePreference', constantsStart)
  if (constantsStart < 0 || constantsEnd < 0) throw new Error('Target font contract constants missing')
  const constants = source.slice(constantsStart, constantsEnd).replace(/Schema\.object\([\s\S]*?\n\t\t\}\);/, '')
  const implementation = new Function('FONT_SIZE_FIELD', `${constants}; return {${method('getTheme')},${method('setFontSize')},${method('setFontFamily')},${method('buildSnapshot')}}`)('fontSize')
  const writes = vi.fn(), publish = vi.fn()
  const runtime = { ...implementation, snapshot: { fontSizes: { text: 14, code: 13, terminal: 12 }, fontFamilies: { text: '', code: '', terminal: '' } },
    fontSizes: { text: 14, code: 13, terminal: 12 }, fontFamilies: { text: '', code: '', terminal: '' },
    host: { set: writes }, write: (operation: () => void) => operation(), publish,
    preference: 'light', themes: [{ id: 'light', tokens: {} }], revision: 1, composeActive: (value: unknown) => value }
  expect(runtime.getTheme()).toBe(runtime.getTheme())
  runtime.setFontSize('text', 18)
  runtime.setFontFamily('code', 'Native Mono')
  expect(writes.mock.calls).toEqual([['fontSize', 18], ['codeFontFamily', '"Native Mono"']])
  const snapshot = runtime.buildSnapshot()
  expect(snapshot.fontSizes).toEqual({ text: 18, code: 13, terminal: 12 })
  expect(snapshot.fontFamilies).toEqual({ text: '', code: '"Native Mono"', terminal: '' })
  expect(publish).toHaveBeenCalledTimes(2)
})
