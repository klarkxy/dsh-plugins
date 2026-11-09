import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import vm from 'node:vm'
import test from 'node:test'
import { patchClientModules } from './patch.mjs'

const require = createRequire(import.meta.url)
const packageDir = dirname(require.resolve('@deepseek-ai/dsh-client-modules/package.json'))
const original = readFileSync(join(packageDir, 'lib/client.js'), 'utf8')
const fixed = patchClientModules(original)
const row = { id: 'renderer', url: '/renderer.js?rev=one', initialUrl: '/batch.js?rev=one', rev: 'one', inject: [], external: [] }
const manifest = { rev: 'boot-one', modules: [row], plugins: [] }

function fixture(source) {
  let registration
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load(value) { registration = value } } },
    document: { querySelectorAll: () => [] },
  })
  const api = registration.factory(() => { throw new Error('Unexpected bootstrap import') })
  const target = { mode: 'queue', pendingQueue: [] }
  const requests = []
  const system = new api.ClientModuleSystem({
    manifest, registrationTarget: target, staticModules: {},
    bootstrapModule: { id: '@deepseek-ai/dsh-client-modules', exports: api },
    loadBundle: url => new Promise((resolve, reject) => requests.push({ url, resolve, reject })),
  })
  const deliver = (index, revision = 'one') => {
    target.load({ id: 'renderer', factory: () => ({ revision }) })
    requests[index].resolve()
  }
  return { system, target, requests, deliver }
}

test('reproduces the unpatched batch/single-resource registration race', async () => {
  const f = fixture(original)
  const first = f.system.prefetch('renderer')
  f.system.updateManifest(structuredClone(manifest), [])
  const second = f.system.prefetch('renderer')
  assert.deepEqual(f.requests.map(r => r.url), [row.initialUrl, row.url])
  f.deliver(0)
  assert.throws(() => f.deliver(1), /duplicate factory registration/)
  f.requests[1].resolve() // A browser script load event still fires after a runtime throw.
  await Promise.all([first, second])
})

test('identical graph updates keep concurrent prefetch/import on one batch', async () => {
  const f = fixture(fixed)
  const pending = [f.system.prefetch('renderer')]
  for (let i = 0; i < 8; i++) {
    f.system.updateManifest(structuredClone(manifest), [])
    pending.push(f.system.prefetch('renderer'), f.system.import('renderer'))
  }
  assert.deepEqual(f.requests.map(r => r.url), [row.initialUrl])
  f.deliver(0)
  await Promise.all(pending)
  assert.equal((await f.system.import('renderer')).revision, 'one')
  assert.equal(f.requests.length, 1)
})

test('a changed revision still invalidates and loads its new code', async () => {
  const f = fixture(fixed)
  const first = f.system.import('renderer')
  f.deliver(0)
  assert.equal((await first).revision, 'one')
  f.system.updateManifest({
    rev: 'boot-two', modules: [{ ...row, rev: 'two', url: '/renderer.js?rev=two' }], plugins: [],
  }, [])
  const second = f.system.import('renderer')
  assert.equal(f.requests[1].url, '/renderer.js?rev=two')
  f.deliver(1, 'two')
  assert.equal((await second).revision, 'two')
})

test('real duplicate execution is still rejected', () => {
  const f = fixture(fixed)
  const registration = { id: 'renderer', factory: () => ({}) }
  f.target.load(registration)
  assert.throws(() => f.target.load(registration), /duplicate factory registration/)
})

test('unreviewed or already patched artifacts cannot be patched blindly', () => {
  assert.throws(() => patchClientModules(original + '\n'), /Unsupported/)
  assert.throws(() => patchClientModules(fixed), /Unsupported/)
})
