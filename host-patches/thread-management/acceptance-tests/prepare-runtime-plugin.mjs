import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { x } from 'tar'
const root = resolve(process.cwd())
const archiveArgument = process.argv[2]
if (!archiveArgument) throw new Error('Usage, from a rebuilt host directory: node .acceptance/prepare-runtime-plugin.mjs <plugin archive absolute path>')
const archive = resolve(archiveArgument)
const destination = join(root, '.acceptance', 'runtime-plugin')
if (await stat(destination).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error })) throw new Error('Preserve existing runtime-plugin before staging another candidate')
await mkdir(destination, { recursive: true })
await x({ file: archive, cwd: destination, strip: 1, strict: true, preservePaths: false,
  filter: (path, entry) => path.startsWith('package/') && !path.includes('/node_modules/') && !path.split('/').includes('..') && ['File', 'Directory'].includes(entry.type) })
const manifest = JSON.parse(await readFile(join(destination, 'package.json'), 'utf8'))
if (manifest.name !== '@klarkxy/dsh-session-manager' || manifest.version !== '0.1.0-rc.1' || manifest.private) throw new Error('Unexpected release candidate plugin package')
// Published payload has no dev node_modules: runtime peer imports resolve to this isolated native host.
const receipt = { archive, destination, sha256: createHash('sha256').update(await readFile(archive)).digest('hex'), filesExcludeDevModules: true }
await writeFile(join(root, '.acceptance', 'runtime-plugin-receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
console.log(JSON.stringify(receipt))
