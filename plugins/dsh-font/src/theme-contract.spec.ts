import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'

// Exercise the shipped implementation behind the panel's narrow structural
// interface. The package is resolved from this workspace's target dependency,
// never hardcoded to one developer's installation or an obsolete version. The
// published bundle is a host ModuleLoader unit rather than an importable
// module, so the test captures its definition through the same loader shape
// the host uses (dev-index's client.test.ts established the pattern here).
type ThemeSnapshot = { fontSizes: Record<string, number>; fontFamilies: Record<string, string> }
interface ThemeRuntimeLike {
  getTheme(): ThemeSnapshot
  setFontSize(role: string, px: number): void
  setFontFamily(role: string, value: string): void
}
type ThemeRuntimeCtor = new (ctx: unknown, host: unknown) => ThemeRuntimeLike

const require = createRequire(import.meta.url)
const bundle = readFileSync(join(dirname(require.resolve('@deepseek-ai/dsh-client-ui-theme/package.json')), 'lib/client.js'), 'utf8')
let definition: { factory: (require: (id: string) => unknown) => { ThemeRuntime: ThemeRuntimeCtor } } | undefined
runInNewContext(bundle, { window: { __ModuleLoader__: { load(value: typeof definition) { definition = value } } } })
const { ThemeRuntime } = definition!.factory((id: string) => {
  if (['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-store'].includes(id)) return {}
  throw new Error(`unexpected host module: ${id}`)
})

it('published theme exposes stable role snapshots and persists each exact role', () => {
  const events: string[] = []
  const host = { set: vi.fn(() => Promise.resolve()), mutate: vi.fn(() => Promise.resolve()), subscribe: () => () => {}, getSnapshot: () => ({ value: undefined }) }
  const theme = new ThemeRuntime({
    effect: (fn: () => unknown) => fn(),
    inject: () => {},
    emit: (name: string) => events.push(name),
  }, host)
  // dsh-font hands getTheme().fontFamilies to useSyncExternalStore; the host
  // documents a stable reference until the next change, and a fresh snapshot
  // per call would loop the hook forever.
  expect(theme.getTheme()).toBe(theme.getTheme())
  theme.setFontSize('text', 18)
  theme.setFontFamily('code', 'Native Mono')
  // The write keys reach beyond what dsh-font itself consumes: they are the
  // Settings → General native-row sync contract, asserted here as living
  // documentation of the host package's persistence surface.
  expect(host.set.mock.calls).toEqual([['fontSize', 18], ['codeFontFamily', '"Native Mono"']])
  expect(theme.getTheme().fontSizes.text).toBe(18)
  expect(theme.getTheme().fontFamilies.code).toBe('"Native Mono"')
  expect(events.filter(name => name === 'theme/change')).toHaveLength(2)
})
