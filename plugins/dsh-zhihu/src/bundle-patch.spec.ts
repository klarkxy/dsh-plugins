import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Tool registration itself is covered by open-platform-integration.spec.ts.
// What only the shipped patch can regress is that the bundle mounts the tools
// entry at all: without a row for `@klarkxy/dsh-zhihu/tools` the service loads
// but no Agent gets a `zhihu_*` tool, and every other spec still passes.
const manifestUrl = new URL('../package.json', import.meta.url)
const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8')) as {
  name: string
  files: string[]
  exports: Record<string, unknown>
  dsh: { bundle: { patch: string } }
}
const patch = readFileSync(new URL(manifest.dsh.bundle.patch, manifestUrl), 'utf8')

describe('default-on bundle patch', () => {
  it('ships the patch the manifest points at', () => {
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.files).toContain('cordis.patch.yml')
    expect(patch).toContain('- id: zhihu')
    expect(patch).toContain("name: '@klarkxy/dsh-zhihu'")
  })

  it('mounts the tools entry so its tools need no agent preset', () => {
    expect(patch).toMatch(/- id: zhihu-tools\n\s+name: '@klarkxy\/dsh-zhihu\/tools'/)
    expect(Object.keys(manifest.exports)).toContain('./tools')
    expect(patch).not.toMatch(/disabled:\s*true/)
  })
})
