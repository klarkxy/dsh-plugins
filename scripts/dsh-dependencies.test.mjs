import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import test from 'node:test'
import semver from 'semver'

const root = fileURLToPath(new URL('../', import.meta.url))
const read = path => JSON.parse(readFileSync(join(root, path), 'utf8'))
const manifest = read('package.json')
const official = name => /^@deepseek-ai\/dsh(?:-|$)/.test(name)
const target = manifest.devDependencies['@deepseek-ai/dsh-client-ui-primitives']
const plugins = readdirSync(join(root, 'plugins'), { withFileTypes: true })
  .filter(entry => entry.isDirectory()).map(entry => read(`plugins/${entry.name}/package.json`))

test('DSH development dependencies and both override declarations share one baseline', () => {
  assert.equal(semver.valid(target), target)
  for (const pkg of [manifest, ...plugins]) {
    for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
      if (official(name)) assert.equal(version, target, `${pkg.name}: ${name}`)
    }
  }
  const workspace = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')
  const overrides = new Map([...workspace.matchAll(/^  '(@deepseek-ai\/dsh[^']*)': (\S+)\r?$/gm)]
    .map(([, name, version]) => [name, version]))
  const expected = Object.entries(manifest.pnpm.overrides).filter(([name]) => official(name))
  assert.equal(overrides.size, expected.length)
  for (const [name, version] of expected) {
    assert.equal(version, target, name)
    assert.equal(overrides.get(name), version, name)
    assert.equal(manifest.devDependencies[name], target, `${name}: missing development peer`)
  }
})

test('DSH host dependencies stay optional peers and injected UI stays development-only', () => {
  const ui = '@deepseek-ai/dsh-client-ui-primitives'
  for (const pkg of plugins) {
    assert.equal(pkg.dependencies?.[ui], undefined, pkg.name)
    assert.equal(pkg.peerDependencies?.[ui], undefined, pkg.name)
    for (const [name, range] of Object.entries(pkg.peerDependencies ?? {})) {
      if (!official(name)) continue
      assert.equal(range, `>=${target}`, `${pkg.name}: ${name}`)
      assert.equal(pkg.peerDependenciesMeta?.[name]?.optional, true, `${pkg.name}: ${name}`)
    }
    for (const [name, range] of Object.entries(pkg.dependencies ?? {})) {
      if (!official(name)) continue
      assert.equal(name, '@deepseek-ai/dsh-web-search-exa', `${pkg.name}: host package in dependencies`)
      assert.equal(range, `>=${target}`, `${pkg.name}: ${name}`)
    }
    if (pkg.engines?.dsh) assert.equal(pkg.engines.dsh, `>=${target}`, pkg.name)
    const descriptor = join(root, 'plugins', pkg.name.split('/').at(-1), 'dsh.plugin.json')
    if (existsSync(descriptor)) {
      assert.equal(JSON.parse(readFileSync(descriptor, 'utf8')).engines?.dsh, pkg.engines.dsh, pkg.name)
    }
  }
})

test('the lockfile does not mix official DSH release versions', () => {
  const lock = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')
  const versions = [...lock.matchAll(/^  ['"]?(@deepseek-ai\/dsh(?:-[^@'"\n]+)?)@([^('":\n]+)/gm)]
  assert.ok(versions.length > 0)
  for (const [, name, version] of versions) assert.equal(version, target, name)
})
