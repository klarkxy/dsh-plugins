import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { stageArchive } from './archive.mjs'

const [archive, stagingDirectory, asarModule] = process.argv.slice(2)
if (!archive || !stagingDirectory || !asarModule) throw new Error('Usage: node stage.mjs <installed-app.asar> <new-staging-directory> <@electron/asar module directory>')
const directory = resolve(stagingDirectory)
mkdirSync(directory)
const staged = join(directory, 'app.asar')
const result = await stageArchive(resolve(archive), staged, asarModule)
const receipt = { schemaVersion: 1, original: resolve(archive), staged, ...result }
writeFileSync(join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ staged, receipt: join(directory, 'receipt.json'), ...result }, null, 2))
