import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const migration = JSON.parse(readFileSync(join(root, 'scripts/editor-plugin-migration.json'), 'utf8'))
const selected = new Set(migration.packages.map(pkg => pkg.name))
/** Shared support package every feature depends on; not an Editor plugin itself. */
const sharedPackages = new Set(['@klarkxy/dsh-plugin-kit', '@klarkxy/dsh-model-route'])
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
          if (range.startsWith('workspace:')) expect(selected.has(name) || sharedPackages.has(name), `${pkg.name}: ${name}`).toBe(true)
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

/**
 * Font and shortcuts inline plugin-kit into the client bundle. Published
 * JavaScript and declarations must not keep a runtime import of plugin-kit
 * or model-route, including a side-effect `import 'pkg'`. This only checks
 * that the install dependency can stay a devDependency.
 */
const bundledOnly = ['dsh-font', 'dsh-shortcuts']
const bundledSpecifier = String.raw`['"](@klarkxy\/dsh-plugin-kit(?:\/[^'"]*)?|@klarkxy\/dsh-model-route(?:\/[^'"]*)?)['"]`
const runtimeImport = new RegExp([
  String.raw`(?:^|[^\w.$])import\s+${bundledSpecifier}`,
  String.raw`(?:^|[^\w.$])import\s+(?!type\b)[^;]*?\bfrom\s+${bundledSpecifier}`,
  String.raw`(?:^|[^\w.$])export\s+(?!type\b)[^;]*?\bfrom\s+${bundledSpecifier}`,
  String.raw`\brequire\s*\(\s*${bundledSpecifier}\s*\)`,
  String.raw`\bimport\s*\(\s*${bundledSpecifier}\s*\)`,
].join('|'), 'g')

function publishedScripts(directory) {
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  const artifacts = []
  const visit = (path, relative) => {
    if (statSync(path).isDirectory()) {
      for (const child of readdirSync(path)) visit(join(path, child), `${relative}/${child}`)
      return
    }
    const portable = relative.replaceAll('\\', '/')
    if (portable.endsWith('.map') || !/\.(?:[cm]?js|d\.ts)$/.test(portable)) return
    artifacts.push(portable)
  }
  for (const entry of manifest.files ?? []) {
    if (entry.includes('*')) continue
    const path = join(directory, entry)
    if (existsSync(path)) visit(path, entry)
  }
  return { manifest, artifacts: artifacts.sort() }
}

const clientBundled = [
  'dsh-model-hub',
  'dsh-current-title',
  'dsh-session-manager',
  'dsh-safe-auto',
  'dsh-git-commit',
]

describe('browser client bundles do not require plugin-kit or model-route at runtime', () => {
  for (const name of clientBundled) {
    it(`${name} client.js and client.inner.cjs have no external plugin-kit or model-route import`, () => {
      const directory = join(root, 'plugins', name)
      const files = ['lib/client.js', 'lib/client.inner.cjs']
      const hits = []
      for (const file of files) {
        runtimeImport.lastIndex = 0
        const text = readFileSync(join(directory, file), 'utf8')
        for (const match of text.matchAll(runtimeImport)) {
          hits.push(`${file}: ${match.slice(1).find(Boolean)}`)
        }
      }
      expect(hits).toEqual([])
    })
  }
})

describe('bundled client support stays out of published artifacts', () => {
  for (const name of bundledOnly) {
    it(`${name} published scripts have no external plugin-kit or model-route import`, () => {
      const directory = join(root, 'plugins', name)
      const { manifest, artifacts } = publishedScripts(directory)
      expect(artifacts).toEqual(expect.arrayContaining([
        'lib/client.js', 'lib/client.inner.cjs', 'lib/index.js', 'lib/index.d.ts', 'lib/contracts.js', 'lib/contracts.d.ts',
      ]))
      expect(manifest.dependencies?.['@klarkxy/dsh-plugin-kit']).toBeUndefined()
      expect(manifest.dependencies?.['@klarkxy/dsh-model-route']).toBeUndefined()
      expect(manifest.devDependencies['@klarkxy/dsh-plugin-kit']).toBe('workspace:*')
      const hits = []
      for (const file of artifacts) {
        runtimeImport.lastIndex = 0
        const text = readFileSync(join(directory, file), 'utf8')
        for (const match of text.matchAll(runtimeImport)) {
          hits.push(`${file}: ${match.slice(1).find(Boolean)}`)
        }
      }
      expect(hits).toEqual([])
    })
  }
})
