import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { originalSha256, patchClientModules, sha256, supportedVersion } from './patch.mjs'

/** Stage a profile-local package. Never edits the source installation or replaces
 * an existing target, including links left by another installation. */
export function stage(destination) {
  if (!destination || !isAbsolute(destination)) throw new Error('An explicit absolute destination is required')
  const require = createRequire(import.meta.url)
  const source = dirname(require.resolve('@deepseek-ai/dsh-client-modules/package.json'))
  const target = resolve(destination)
  if (target === source || existsSync(target)) throw new Error('Destination already exists; inspect it instead of overwriting')
  const pkg = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
  if (pkg.version !== supportedVersion) throw new Error(`Unsupported Host version ${pkg.version}`)
  const original = readFileSync(join(source, 'lib/client.js'), 'utf8')
  const fixed = patchClientModules(original)
  mkdirSync(dirname(target), { recursive: true })
  cpSync(source, target, { recursive: true, filter: path => !relative(source, path).split(sep).includes('node_modules') })
  writeFileSync(join(target, 'lib/client.js'), fixed)
  const receipt = { source, target, version: pkg.version, originalSha256, patchedSha256: sha256(fixed) }
  writeFileSync(join(target, '.refresh-patch.json'), JSON.stringify(receipt, null, 2) + '\n')
  if (sha256(readFileSync(join(target, 'lib/client.js'))) !== receipt.patchedSha256) throw new Error('Staged artifact verification failed')
  return receipt
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 4 || process.argv[2] !== '--destination') throw new Error('Usage: node stage.mjs --destination <absolute package directory>')
  console.log(JSON.stringify(stage(process.argv[3]), null, 2))
}
