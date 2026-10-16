import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))

test('Safe Auto handwritten JavaScript sources are not ignored as build output', () => {
  const directory = 'plugins/dsh-safe-auto/src'
  const files = readdirSync(new URL(`../${directory}/`, import.meta.url))
    .filter(name => name.endsWith('.js'))
  assert.ok(files.includes('dangerous.js'))
  assert.ok(files.includes('transcript.js'))
  for (const name of files) {
    const path = `${directory}/${name}`
    const result = spawnSync('git', ['check-ignore', '--no-index', '--quiet', '--', path], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 1, `${path} must be eligible for source control: ${result.stderr}`)
  }
})
