import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { assertBuildIdentity } from './build-identity.mjs'
const directory = path.dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'))
const host = path.resolve(process.env.DSH_THREAD_HOST_SOURCE ?? manifest.hostSource)
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const build = assertBuildIdentity(host, manifest)
const bin = path.join(host, 'apps/cli/lib/bin.js')
const plugin = path.join(host, '.acceptance/runtime-plugin')
if (!fs.existsSync(path.join(plugin, 'lib/index.js'))) throw new Error('Accepted plugin payload is not staged')
for (const [relative, expected] of Object.entries(manifest.pluginPayloadFiles)) {
  const target = path.resolve(plugin, relative)
  if (!target.startsWith(plugin + path.sep) || !fs.existsSync(target) || hash(fs.readFileSync(target)) !== expected) throw new Error(`Accepted plugin payload differs: ${relative}`)
}
if (process.argv.includes('--check')) {
  console.log(JSON.stringify({ acceptedHost: host, plugin, build: 'verified', buildArtifactCount: Object.keys(build.artifacts).length, activation: 'not started' }))
  process.exit(0)
}
const home = path.resolve(directory, `../../.scratch/thread-management/local-home-${manifest.patchSha256.slice(0, 16)}`)
const profile = path.join(home, 'profiles/thread-management')
process.env.DSH_HOME = home
const { initProfile } = await import(pathToFileURL(path.join(host, 'packages/boot/app-boot/lib/index.js')).href)
const profileManifest = path.join(profile, 'package.json')
if (!fs.existsSync(profileManifest)) {
  fs.mkdirSync(profile, { recursive: true })
  initProfile(profile, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@klarkxy/dsh-session-manager'])
  const metadata = JSON.parse(fs.readFileSync(profileManifest, 'utf8'))
  metadata.threadManagementCandidate = { owner: directory, patchSha256: manifest.patchSha256 }
  fs.writeFileSync(profileManifest, JSON.stringify(metadata, null, 2) + '\n')
} else {
  const metadata = JSON.parse(fs.readFileSync(profileManifest, 'utf8'))
  if (metadata.threadManagementCandidate?.owner !== directory || metadata.threadManagementCandidate?.patchSha256 !== manifest.patchSha256) {
    throw new Error('Existing isolated profile belongs to a different candidate; preserve it')
  }
}
const scope = path.join(profile, 'node_modules/@klarkxy')
fs.mkdirSync(scope, { recursive: true })
const link = path.join(scope, 'dsh-session-manager')
if (!fs.existsSync(link)) fs.symlinkSync(plugin, link, process.platform === 'win32' ? 'junction' : 'dir')
else if (fs.realpathSync(link) !== fs.realpathSync(plugin)) throw new Error('Existing plugin link points elsewhere')
console.log(`Starting accepted local candidate with isolated home: ${home}`)
const child = spawn(process.execPath, [bin, '--profile', 'thread-management', ...process.argv.slice(2)], {
  cwd: host, env: { ...process.env, DSH_HOME: home }, stdio: 'inherit',
})
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0) })
