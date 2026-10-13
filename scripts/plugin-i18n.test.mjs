import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../plugins/', import.meta.url))
const packages = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => {
  const directory = join(root, entry.name)
  return { directory, manifest: JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) }
})

for (const { directory, manifest } of packages.filter(item => item.manifest.dsh?.bundle)) {
  test(`${manifest.name} exposes packaged Chinese and English discovery metadata`, () => {
    assert.equal(manifest.exports['./locale/*.json'], './locale/*.json')
    assert.ok(manifest.files.some(path => path === 'locale' || path === 'locale/*.json'))
    const dictionaries = ['zh', 'en'].map(language => {
      const path = join(directory, 'locale', `${language}.json`)
      assert.ok(existsSync(path), `${language} metadata missing`)
      return JSON.parse(readFileSync(path, 'utf8'))
    })
    for (const dictionary of dictionaries) {
      for (const key of ['title', 'description']) assert.ok(typeof dictionary.meta?.[key] === 'string' && dictionary.meta[key].trim(), `${key} missing`)
    }
    assert.deepEqual(Object.keys(dictionaries[0]).sort(), Object.keys(dictionaries[1]).sort())
  })
}

test('clients using the host locale declare its runtime package injection', () => {
  for (const { directory, manifest } of packages.filter(item => item.manifest.dsh?.client)) {
    const path = ['src/client.tsx', 'src/client.jsx', 'client.js'].map(file => join(directory, file)).find(existsSync)
    if (!path) continue
    const source = readFileSync(path, 'utf8')
    if (/inject\s*=\s*\[[^\]]*['"]locale['"]|inject:\s*\[[^\]]*['"]locale['"]/s.test(source)) {
      assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale'), `${manifest.name} misses locale injection`)
    }
  }
})
