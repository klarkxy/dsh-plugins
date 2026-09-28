import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))
const forbidden = /['"`](?:settings\.(?:section|plugins\.tab)|dsh-editor\.settings\.[\w-]+)['"`]/

function* sources(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!['node_modules', 'lib', 'dist', 'test', 'tests', 'docs', '.npm-cache'].includes(entry.name)) yield* sources(path)
    } else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(?:spec|test)\./.test(entry.name)) {
      // Frozen public contracts may still export old names for external consumers.
      // Runtime/client implementations must not use those old settings seats.
      if (entry.name !== 'contracts.ts') yield path
    }
  }
}

test('plugin implementations never contribute to global or legacy settings seats', () => {
  const violations = []
  for (const path of sources(join(root, 'plugins'))) {
    const lines = readFileSync(path, 'utf8').split('\n')
    lines.forEach((line, index) => {
      if (forbidden.test(line)) violations.push(`${relative(root, path)}:${index + 1}`)
    })
  }
  assert.deepEqual(violations, [], 'Use plugins.bundle.config / plugins.row.config; never a global Settings fallback')
})
