import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve, normalize } from 'node:path'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'
import { patchHostFile, targets, sha256 } from './patch.mjs'

/** Use the installed Electron ASAR reader, pickle encoder, and integrity calculator. */
export function archiveTools(asarModule) {
  const require = createRequire(import.meta.url)
  const entry = require.resolve(resolve(asarModule))
  const asar = require(entry)
  const { Pickle } = require(resolve(dirname(entry), 'pickle.js'))
  const { getFileIntegrity } = require(resolve(dirname(entry), 'integrity.js'))
  return { asar, Pickle, getFileIntegrity }
}

function entryAt(header, path) {
  let node = header
  for (const segment of path.split('/')) node = node.files?.[segment]
  assert(node && !node.files && !node.link && !node.unpacked, `Expected a packed regular file: ${path}`)
  return node
}

function packedBytes(archive, header, headerSize, path) {
  const entry = entryAt(header, path)
  const start = 8 + headerSize + Number(entry.offset)
  assert(Number.isSafeInteger(start) && start >= 8 + headerSize && start + entry.size <= archive.length, 'Invalid ASAR file offset')
  const data = archive.subarray(start, start + entry.size)
  assert.equal(sha256(data), entry.integrity.hash, `Existing ASAR integrity differs: ${path}`)
  return data
}

/** Stage a separate archive. Existing payload bytes and every unpacked entry are preserved. */
export async function stageArchive(originalPath, destination, asarModule) {
  assert.notEqual(resolve(originalPath), resolve(destination), 'Staging must not overwrite the installed archive')
  const { asar, Pickle, getFileIntegrity } = archiveTools(asarModule)
  asar.uncache(originalPath)
  const { header, headerSize } = asar.getRawHeader(originalPath)
  const original = readFileSync(originalPath)
  const patchedHeader = structuredClone(header)
  const replacements = new Map()
  const changes = []
  for (const path of Object.keys(targets)) {
    const before = packedBytes(original, header, headerSize, path)
    const after = patchHostFile(path, before)
    replacements.set(path, after)
    changes.push({ path, before: sha256(before), after: sha256(after), bytes: after.length })
  }
  const descriptorPath = 'dsh/desktop-runtime.json'
  const descriptor = JSON.parse(packedBytes(original, header, headerSize, descriptorPath).toString('utf8'))
  for (const change of changes) {
    const records = descriptor.files.filter(file => file.path === change.path.slice(4))
    assert.equal(records.length, 1, `Runtime inventory does not own exactly one ${change.path}`)
    assert.equal(records[0].sha256, change.before, 'Runtime inventory and original archive disagree')
    records[0].sha256 = change.after
    records[0].bytes = change.bytes
  }
  replacements.set(descriptorPath, Buffer.from(JSON.stringify(descriptor, null, 2) + '\n'))
  const payload = original.subarray(8 + headerSize)
  let offset = payload.length
  for (const [path, bytes] of replacements) {
    const entry = entryAt(patchedHeader, path)
    entry.offset = String(offset)
    entry.size = bytes.length
    entry.integrity = await getFileIntegrity(Readable.from([bytes]))
    offset += bytes.length
  }
  const headerPickle = Pickle.createEmpty()
  headerPickle.writeString(JSON.stringify(patchedHeader))
  const newHeader = headerPickle.toBuffer()
  const sizePickle = Pickle.createEmpty()
  sizePickle.writeUInt32(newHeader.length)
  const staged = Buffer.concat([sizePickle.toBuffer(), newHeader, payload, ...replacements.values()])
  writeFileSync(destination, staged, { flag: 'wx' })
  asar.uncache(destination)
  const stagedHeader = asar.getRawHeader(destination)
  assert.deepEqual(stagedHeader.header, patchedHeader)
  assert(staged.subarray(8 + stagedHeader.headerSize, 8 + stagedHeader.headerSize + payload.length).equals(payload), 'Original ASAR payload changed')
  for (const [path, bytes] of replacements) {
    assert(asar.extractFile(destination, normalize(path)).equals(bytes), `Staged bytes differ: ${path}`)
    assert.deepEqual(await getFileIntegrity(Readable.from([bytes])), entryAt(stagedHeader.header, path).integrity)
  }
  // Restoring only the three changed header entries must reproduce the whole original
  // header. This includes every unpacked/native record and its ownership metadata.
  const unchanged = structuredClone(stagedHeader.header)
  for (const path of replacements.keys()) {
    Object.assign(entryAt(unchanged, path), entryAt(header, path))
  }
  assert.deepEqual(unchanged, header, 'Unrelated archive metadata changed')
  return { originalSha256: sha256(original), stagedSha256: sha256(staged), changes }
}
