import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createBuildIdentity } from './build-identity.mjs'

const directory = path.dirname(fileURLToPath(import.meta.url))
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const compiled = {
  'apps/cli/lib/bin.js': 'throw new Error("check must not start the host")\n',
  'packages/boot/app-boot/lib/index.js': 'export const initProfile = () => {}\n',
  'packages/api/session-controller/lib/index.js': 'export const repairedHost = true\n',
  'packages/client/ui-chat/lib/client.js': 'export const client = true\n',
  'packages/client/ui-chat/lib/client.js.map': '{}\n',
  'vendor/cordis/lib/index.js': 'export const vendor = true\n',
  'native/system/lib/index.js': 'export const native = true\n',
  'native/system/packages/linux-x64/bin/glibc/system.node': 'fixture-native-binary',
  'apps/web/dist/index.html': '<!doctype html><title>Fixture</title>\n',
}

function write(root, relative, content) {
  const file = path.join(root, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function fixture(t) {
  const temporaryRoot = path.resolve(tmpdir())
  const root = fs.mkdtempSync(path.join(temporaryRoot, 'dsh-launcher-'))
  t.after(() => {
    if (!root.startsWith(temporaryRoot + path.sep)) throw new Error('Fixture cleanup escaped its temporary directory')
    fs.rmSync(root, { recursive: true, force: true })
  })
  const host = path.join(root, 'host')
  const delivery = path.join(root, 'host-patches/thread-management')
  const source = 'export const accepted = true\n'
  const packageJson = JSON.stringify({ version: '0.2.0-rc.2' })
  write(host, 'source.ts', source.replaceAll('\n', '\r\n'))
  write(host, 'package.json', packageJson)
  for (const [relative, bytes] of Object.entries(compiled)) write(host, relative, bytes)
  const clientFiles = Object.keys(compiled).filter(relative => relative.startsWith('apps/web/dist/') || relative.includes('/lib/client.')).sort()
  const clientDigest = crypto.createHash('sha256')
  for (const relative of clientFiles) {
    const bytes = fs.readFileSync(path.join(host, relative))
    clientDigest.update(`${Buffer.byteLength(relative)}:`)
    clientDigest.update(relative)
    clientDigest.update(`${bytes.byteLength}:`)
    clientDigest.update(bytes)
  }
  const record = {
    formatVersion: 1,
    environment: { DSH_CLIENT_BUILD_PROFILE: 'official', DSH_CLIENT_COMMIT_HASH: '639ed01', DSH_CLIENT_TITLE: 'DeepSeek Harness', DSH_CLIENT_VERSION: '0.2.0-rc.2' },
    artifacts: { fileCount: clientFiles.length, sha256: clientDigest.digest('hex') },
  }
  write(host, '.dsh-build/client-build-environment.json', JSON.stringify(record))
  const pluginBytes = 'export const plugin = true\n'
  write(host, '.acceptance/runtime-plugin/lib/index.js', pluginBytes)
  const manifest = {
    hostSource: host, baseline: '639ed015397290b3745d163aafe02ffee4aa3f84', upstreamVersion: '0.2.0-rc.2',
    files: { 'source.ts': hash(source), 'package.json': hash(packageJson), 'deleted.ts': null },
    pluginPayloadFiles: { 'lib/index.js': hash(pluginBytes) },
  }
  manifest.build = createBuildIdentity(host, manifest)
  fs.mkdirSync(delivery, { recursive: true })
  for (const file of ['start-local.mjs', 'build-identity.mjs']) fs.copyFileSync(path.join(directory, file), path.join(delivery, file))
  const save = () => write(delivery, 'manifest.json', JSON.stringify(manifest))
  save()
  const check = () => spawnSync(process.execPath, [path.join(delivery, 'start-local.mjs'), '--check'], {
    env: { ...process.env, DSH_THREAD_HOST_SOURCE: host }, encoding: 'utf8',
  })
  return { host, delivery, manifest, record, check, save }
}

test('check accepts the exact source and full official compiled identity without starting', t => {
  const { host, delivery, manifest, check } = fixture(t)
  assert.equal(Object.keys(manifest.build.artifacts).length, Object.keys(compiled).length)
  const result = check()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).build, 'verified')
  assert.equal(JSON.parse(result.stdout).activation, 'not started')
  assert.equal(fs.existsSync(path.join(host, 'profiles')), false)
  assert.equal(fs.existsSync(path.resolve(delivery, '../../.scratch/thread-management/local-home')), false)
})

for (const relative of ['apps/cli/lib/bin.js', 'packages/api/session-controller/lib/index.js', 'vendor/cordis/lib/index.js', 'native/system/lib/index.js', 'native/system/packages/linux-x64/bin/glibc/system.node', 'apps/web/dist/index.html', 'packages/client/ui-chat/lib/client.js']) {
  test(`check refuses modified compiled output ${relative}`, t => {
    const { host, check } = fixture(t)
    fs.appendFileSync(path.join(host, relative), '\nTAMPERED\n')
    const result = check()
    assert.equal(result.status, 1)
    assert.match(result.stderr, /artifacts differ/)
  })
}

test('check refuses a missing compiled output even when the CLI and build record remain', t => {
  const { host, check } = fixture(t)
  fs.unlinkSync(path.join(host, 'vendor/cordis/lib/index.js'))
  const result = check()
  assert.equal(result.status, 1)
  assert.match(result.stderr, /compiled artifacts differ/)
})

test('check refuses unaccepted extra compiled output but ignores compiler caches', t => {
  const { host, check } = fixture(t)
  write(host, 'packages/api/session-controller/lib/tsconfig.host.tsbuildinfo', 'cache')
  assert.equal(check().status, 0)
  write(host, 'packages/api/session-controller/lib/extra.js', 'unaccepted')
  assert.match(check().stderr, /compiled artifacts differ/)
})

test('check refuses accepted source drift and mismatched build source identity', t => {
  const { host, manifest, check, save } = fixture(t)
  write(host, 'source.ts', 'export const changed = true\n')
  assert.match(check().stderr, /Accepted source differs/)
  manifest.files['source.ts'] = hash('export const changed = true\n')
  save()
  assert.match(check().stderr, /different accepted source/)
})

test('check refuses missing build identity or missing client record', t => {
  const { host, manifest, check, save } = fixture(t)
  const accepted = manifest.build
  delete manifest.build
  save()
  assert.match(check().stderr, /build identity is missing or invalid/)
  manifest.build = accepted
  save()
  fs.unlinkSync(path.join(host, '.dsh-build/client-build-environment.json'))
  assert.match(check().stderr, /client build record is missing/)
})

test('check requires the official baseline and version rather than a present client record', t => {
  const { host, record, check } = fixture(t)
  record.environment.DSH_CLIENT_COMMIT_HASH = '0000000'
  write(host, '.dsh-build/client-build-environment.json', JSON.stringify(record))
  assert.match(check().stderr, /baseline\/version/)
})

test('check binds the exact client record and plugin bytes', t => {
  const { host, record, check } = fixture(t)
  write(host, '.dsh-build/client-build-environment.json', JSON.stringify(record, null, 2))
  assert.match(check().stderr, /client build record differs/)
  write(host, '.dsh-build/client-build-environment.json', JSON.stringify(record))
  fs.appendFileSync(path.join(host, '.acceptance/runtime-plugin/lib/index.js'), 'tampered')
  assert.match(check().stderr, /plugin payload differs/)
})
