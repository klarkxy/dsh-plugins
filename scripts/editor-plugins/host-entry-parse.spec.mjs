import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Regression for the 2026-11 incident: consumer bundles inlined kit source
 * with a bare `@Remote({ mode: 'stream' })` method decorator — valid in the
 * kit's own tsdown output (its transform lowers it to __esDecorate) but a
 * SyntaxError in the consumer's lib/index.js, so the plugin could never load.
 * Every shipped HOST entry must parse as an ES module and must not emit a
 * bare decorator. `node --check` on stdin with --input-type=module is the
 * authoritative gate; a regex sweep gives a readable failure name.
 */
const hostEntries = [
  'plugins/dsh-session-manager/lib/index.js',
  'plugins/dsh-model-hub/lib/index.js',
  'plugins/dsh-current-title/lib/index.js',
  'plugins/dsh-current-title/lib/contracts.js',
  'plugins/dsh-git-commit/lib/index.js',
  'plugins/dsh-git-commit/lib/contracts.js',
  'plugins/dsh-safe-auto/src/index.js',
  'plugins/dsh-safe-auto/src/ui-host.js',
]

const bareDecorator = /^\s*@[A-Za-z_$][\w$]*\s*(\(|[^\s(=])/m

describe('shipped host entries parse as ES modules without bare decorators', () => {
  for (const file of hostEntries) {
    it(`${file}`, () => {
      const text = readFileSync(join(root, file), 'utf8')
      const hit = text.match(bareDecorator)
      expect(hit, `${file} emits a bare decorator: ${hit?.[0].trim().slice(0, 60)}`).toBeNull()
      const result = spawnSync(process.execPath, ['--input-type=module', '--check', '-'], {
        input: text, encoding: 'utf8',
      })
      expect(result.status, `${file} must parse as ESM: ${result.stderr.slice(0, 400)}`).toBe(0)
    })
  }
})
