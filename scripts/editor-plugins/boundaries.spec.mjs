import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const migration = JSON.parse(readFileSync(join(root, 'scripts/editor-plugin-migration.json'), 'utf8'))
const selected = new Set(migration.packages.map(pkg => pkg.name))
/** Shared support package every feature depends on; not an Editor plugin itself. */
const sharedKit = '@klarkxy/dsh-plugin-kit'
describe('portable Editor plugin boundaries', () => {
  it('has no Editor-private dependencies, including build-time workspaces', () => {
    for (const source of migration.packages) {
      const pkg = JSON.parse(readFileSync(join(root, source.directory, 'package.json'), 'utf8'))
      expect(pkg.name).toBe(source.name)
      expect(pkg.private).not.toBe(true)
      expect(pkg.dshEditor.visibility).toBe('public')
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const [name, range] of Object.entries(pkg[field] ?? {})) {
          expect(name.startsWith('dsh-editor-'), `${pkg.name}: ${name}`).toBe(false)
          if (range.startsWith('workspace:')) expect(selected.has(name) || name === sharedKit, `${pkg.name}: ${name}`).toBe(true)
        }
      }
    }
  })
  it('does not import an Editor-private source tree', () => {
    const violations = []
    const visit = directory => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) visit(path)
        else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
          const text = readFileSync(path, 'utf8')
          if (/(?:from\s*|import\s*\(|require\s*\()\s*['"][^'"]*dsh-editor-[^'"]*['"]/.test(text)) violations.push(path)
        }
      }
    }
    for (const pkg of migration.packages) visit(join(root, pkg.directory, 'src'))
    expect(violations).toEqual([])
  })
})
