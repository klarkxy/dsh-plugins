/** Freeze and verify the compiled outputs of one accepted official host build. */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const sorted = entries => Object.fromEntries(Object.entries(entries).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
const digestPattern = /^[0-9a-f]{64}$/
const clientRecordPath = '.dsh-build/client-build-environment.json'
const outputPatterns = [
  'apps/*/lib/**/*', 'packages/*/*/lib/**/*', 'vendor/*/lib/**/*',
  'native/system/lib/**/*', 'native/system/packages/*/lib/**/*',
  'native/system/packages/*/bin/**/*', 'native/system/packages/*/prebuilds/**/*', 'apps/web/dist/**/*',
]
// Same artifact selection and framing as upstream scripts/client-build-environment.ts.
const clientPatterns = [
  'apps/web/dist/**/*', 'packages/*/*/lib/client.js', 'packages/*/*/lib/client.js.map',
  'packages/*/*/lib/client.*.js', 'packages/*/*/lib/client.*.js.map',
]

function within(root, relative) {
  const target = path.resolve(root, relative)
  if (!target.startsWith(root + path.sep)) throw new Error(`Accepted path escapes host: ${relative}`)
  return target
}

/** Verify every accepted source hash, including declared file removals. */
export function assertAcceptedSources(host, manifest) {
  for (const [relative, expected] of Object.entries(manifest.files)) {
    const target = within(host, relative)
    if (expected === null ? fs.existsSync(target) : !digestPattern.test(expected) || !fs.existsSync(target)
      || sha256(Buffer.from(fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n'))) !== expected) {
      throw new Error(`Accepted source differs: ${relative}; rebuild/review the candidate first`)
    }
  }
}

function artifactPaths(host, patterns) {
  return [...new Set(fs.globSync(patterns, { cwd: host }).map(relative => relative.replaceAll('\\', '/')))]
    .filter(relative => !relative.endsWith('.tsbuildinfo') && fs.statSync(within(host, relative)).isFile())
    .sort()
}

function assertOfficialClientBuild(host, manifest) {
  const file = within(host, clientRecordPath)
  if (!fs.existsSync(file)) throw new Error('Complete official host/client/web build required: client build record is missing')
  const record = JSON.parse(fs.readFileSync(file, 'utf8'))
  const expectedEnvironment = {
    DSH_CLIENT_BUILD_PROFILE: 'official', DSH_CLIENT_COMMIT_HASH: manifest.baseline.slice(0, 7),
    DSH_CLIENT_TITLE: 'DeepSeek Harness', DSH_CLIENT_VERSION: manifest.upstreamVersion,
  }
  const version = JSON.parse(fs.readFileSync(within(host, 'package.json'), 'utf8')).version
  if (record.formatVersion !== 1 || version !== manifest.upstreamVersion
    || JSON.stringify(sorted(record.environment ?? {})) !== JSON.stringify(sorted(expectedEnvironment))) {
    throw new Error('Official client build identity differs from the accepted baseline/version')
  }
  const paths = artifactPaths(host, clientPatterns)
  if (paths.length === 0) throw new Error('Complete official client/web artifacts are missing')
  const digest = crypto.createHash('sha256')
  for (const relative of paths) {
    const bytes = fs.readFileSync(within(host, relative))
    digest.update(`${Buffer.byteLength(relative)}:`)
    digest.update(relative)
    digest.update(`${bytes.byteLength}:`)
    digest.update(bytes)
  }
  if (record.artifacts?.fileCount !== paths.length || record.artifacts?.sha256 !== digest.digest('hex')) {
    throw new Error('Client artifacts differ from the complete official build record')
  }
  return sha256(fs.readFileSync(file))
}

/** Return a source-bound identity after a successful full official build; never edits the manifest. */
export function createBuildIdentity(host, manifest) {
  host = path.resolve(host)
  assertAcceptedSources(host, manifest)
  for (const relative of ['apps/cli/lib/bin.js', 'packages/boot/app-boot/lib/index.js', 'packages/api/session-controller/lib/index.js', 'apps/web/dist/index.html']) {
    if (!fs.existsSync(within(host, relative))) throw new Error(`Complete official host/client/web build required: ${relative} is missing`)
  }
  const clientBuildRecordSha256 = assertOfficialClientBuild(host, manifest)
  const artifacts = Object.fromEntries(artifactPaths(host, outputPatterns).map(relative => [relative, sha256(fs.readFileSync(within(host, relative)))]))
  return { formatVersion: 1, sourceSha256: sha256(JSON.stringify(sorted(manifest.files))), artifacts, clientBuildRecordSha256 }
}

/** Refuse missing, stale, added, removed, or modified compiled outputs before activation. */
export function assertBuildIdentity(host, manifest) {
  const accepted = manifest.build
  if (accepted?.formatVersion !== 1 || !digestPattern.test(accepted.sourceSha256 ?? '')
    || !digestPattern.test(accepted.clientBuildRecordSha256 ?? '') || accepted.artifacts === null
    || typeof accepted.artifacts !== 'object' || Array.isArray(accepted.artifacts)
    || Object.values(accepted.artifacts).some(digest => typeof digest !== 'string' || !digestPattern.test(digest))) {
    throw new Error('Accepted compiled build identity is missing or invalid; rebuild/review the candidate first')
  }
  const current = createBuildIdentity(host, manifest)
  if (current.sourceSha256 !== accepted.sourceSha256) throw new Error('Compiled build identity belongs to different accepted source')
  if (current.clientBuildRecordSha256 !== accepted.clientBuildRecordSha256) throw new Error('Accepted official client build record differs')
  if (JSON.stringify(current.artifacts) !== JSON.stringify(sorted(accepted.artifacts))) {
    throw new Error('Accepted compiled artifacts differ; rebuild/review the candidate first')
  }
  return current
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [host, manifestFile] = process.argv.slice(2)
  if (!host || !manifestFile) throw new Error('Usage: node build-identity.mjs <host directory> <accepted manifest.json>')
  console.log(JSON.stringify(createBuildIdentity(host, JSON.parse(fs.readFileSync(manifestFile, 'utf8'))), null, 2))
}
