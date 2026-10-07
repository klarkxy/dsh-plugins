import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const scratch = path.join(root, '.scratch/thread-management')
const output = path.join(root, 'host-patches/thread-management')
const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'))
fs.mkdirSync(scratch, { recursive: true })
const check = fs.mkdtempSync(path.join(scratch, 'delivery-check-'))
const archive = path.join(check, 'baseline.tar')
function run(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(result.stderr || `git ${args[0]} failed`)
  return result.stdout
}
run(manifest.hostSource, ['archive', '--format=tar', '-o', archive, manifest.baseline])
const require = createRequire(path.join(manifest.hostSource, 'package.json'))
await require('tar').x({ file: archive, cwd: check, strict: true, preservePaths: false,
  filter: (_path, entry) => entry.type !== 'SymbolicLink' })
// Match Git's core.symlinks=false checkout representation on Windows. Only
// unchanged upstream guidance links are affected; patch source hashes are exact.
const links = run(manifest.hostSource, ['ls-tree', '-r', manifest.baseline]).split('\n').filter(line => line.startsWith('120000 '))
for (const line of links) {
  const relative = line.slice(line.indexOf('\t') + 1)
  const target = path.resolve(check, relative)
  if (!target.startsWith(check + path.sep)) throw new Error('Baseline link path escape')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, run(manifest.hostSource, ['show', `${manifest.baseline}:${relative}`]))
}
run(check, ['init', '--quiet'])
const patch = path.join(output, 'host.patch')
if (crypto.createHash('sha256').update(fs.readFileSync(patch)).digest('hex') !== manifest.patchSha256) throw new Error('Patch bytes differ from manifest')
run(check, ['apply', '--check', patch])
run(check, ['apply', patch])
const hash = bytes => crypto.createHash('sha256').update(Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'))).digest('hex')
for (const [relative, expected] of Object.entries(manifest.files)) {
  const target = path.resolve(check, relative)
  if (!target.startsWith(check + path.sep)) throw new Error('Source path escape')
  if (expected === null ? fs.existsSync(target) : !fs.existsSync(target) || hash(fs.readFileSync(target)) !== expected) throw new Error(`Patch reproduction mismatch: ${relative}`)
}
const receipt = { baseline: manifest.baseline, appliedToFreshBaseline: true, sourceHashesMatched: Object.keys(manifest.files).length, patchSha256: manifest.patchSha256, windowsBaselineLinkRepresentation: 'Git core.symlinks=false text', upstreamLinks: links.length, checkedAt: new Date().toISOString() }
fs.writeFileSync(path.join(output, 'reproduction-check.json'), JSON.stringify(receipt, null, 2) + '\n')
console.log(JSON.stringify(receipt))
