import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, realpath, mkdir, open, readFile, writeFile, rename } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AttachmentStore, ImageAttachmentRef, FileAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'

export type MediaKind = 'image' | 'audio' | 'video'
export type MediaInput = { path?: string; attachmentId?: string; kind: MediaKind }
export type MediaExec = { signal: AbortSignal; agent?: { session: { id: unknown } } }
export type MediaHost = {
  sandboxPolicy: { resolve(input: { session?: unknown }): { workspaceRoot: string; mode: string } };
  attachments: AttachmentStore;
  get?(name: string): unknown;
}
export type PublishedMedia = {
  path: string; name: string; kind: MediaKind; mediaType: string; bytes: number;
  attachment: { type: 'image'; attachment: ImageAttachmentRef } | { type: 'file'; attachment: FileAttachmentRef };
}
export class CliMediaError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'CliMediaError' }
}
const fail = (code: string, message: string) => new CliMediaError(code, message)
export const MEDIA_LIMITS: Record<MediaKind, number> = { image: 30 * 1024 * 1024, audio: 100 * 1024 * 1024, video: 256 * 1024 * 1024 }
export function insideDirectory(root: string, path: string): boolean {
  const rel = relative(root, path)
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}
/** Resolve each path component; links are not accepted as media or receipt boundaries. */
export async function confinedPath(root: string, path: string): Promise<string> {
  const base = await realpath(root), absolute = resolve(base, path)
  if (!insideDirectory(base, absolute) || (await lstat(root)).isSymbolicLink()) throw fail('outside-workspace', 'The file must stay inside the permitted directory.')
  let part = base
  for (const component of relative(base, absolute).split(sep).filter(Boolean)) {
    part = join(part, component)
    if ((await lstat(part)).isSymbolicLink()) throw fail('outside-workspace', 'Symbolic links are not accepted for media files.')
  }
  const canonical = await realpath(absolute)
  if (!insideDirectory(base, canonical)) throw fail('outside-workspace', 'The file must stay inside the permitted directory.')
  return canonical
}
export async function mediaWorkspace(host: MediaHost, exec: MediaExec, write: boolean): Promise<string> {
  exec.signal.throwIfAborted()
  const policy = host.sandboxPolicy.resolve({ session: exec.agent?.session })
  if (write && policy.mode === 'read-only') throw fail('read-only', 'This operation saves media and needs workspace write access.')
  const root = await realpath(policy.workspaceRoot)
  if (!(await lstat(root)).isDirectory()) throw fail('invalid-workspace', 'The workspace is unavailable.')
  return root
}
export async function inspectMedia(path: string, kind: MediaKind): Promise<{ mediaType: string; bytes: number }> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size < 4 || info.size > MEDIA_LIMITS[kind]) throw fail('invalid-media', 'The media file is empty, too large, or not a regular file.')
  const file = await open(path, 'r'), head = Buffer.alloc(64)
  try { await file.read(head, 0, head.length, 0) } finally { await file.close() }
  let mediaType: string | undefined
  if (head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mediaType = 'image/png'
  else if (head[0] === 255 && head[1] === 216 && head[2] === 255) mediaType = 'image/jpeg'
  else if (/^GIF8[79]a$/.test(head.toString('ascii', 0, 6))) mediaType = 'image/gif'
  else if (head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP') mediaType = 'image/webp'
  else if (head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WAVE') mediaType = 'audio/wav'
  else if (head.toString('ascii', 0, 3) === 'ID3' || (head[0] === 255 && (head[1] & 224) === 224)) mediaType = 'audio/mpeg'
  else if (head.toString('ascii', 0, 4) === 'fLaC') mediaType = 'audio/flac'
  else if (head.toString('ascii', 0, 4) === 'OggS') mediaType = 'audio/ogg'
  else if (head.toString('ascii', 4, 8) === 'ftyp') {
    const brand = head.toString('ascii', 8, 12)
    mediaType = /^(?:heic|heix|hevc|hevx|mif1|msf1)$/.test(brand) ? 'image/heic' : kind === 'audio' ? 'audio/mp4' : brand === 'qt  ' ? 'video/quicktime' : 'video/mp4'
  } else if (head.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]))) mediaType = kind === 'audio' ? 'audio/webm' : 'video/webm'
  if (!mediaType?.startsWith(`${kind}/`)) throw fail('invalid-media', `The file is not a supported ${kind} file.`)
  return { mediaType, bytes: info.size }
}
async function sessionAttachments(host: MediaHost, exec: MediaExec): Promise<Map<string, { type: 'image' | 'file'; attachment: ImageAttachmentRef | FileAttachmentRef }>> {
  if (!exec.agent) throw fail('no-session', 'Session attachments need an active session.')
  const query = host.get?.('sessionQuery') as { readSession(id: unknown): Promise<{ events: unknown[] }> } | undefined
  if (!query) throw fail('no-session-query', 'The host cannot read current-session attachments.')
  const snapshot = await query.readSession(exec.agent.session.id)
  exec.signal.throwIfAborted()
  const result = new Map<string, { type: 'image' | 'file'; attachment: ImageAttachmentRef | FileAttachmentRef }>()
  for (const raw of snapshot.events) {
    const event = raw as { type?: string; data?: { content?: unknown; message?: { content?: unknown } } }
    if (event.type !== 'user/message' && event.type !== 'tool/result') continue
    const content = event.data?.content ?? event.data?.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if ((block?.type === 'image' || block?.type === 'file') && typeof block.attachment?.attachmentId === 'string') result.set(block.attachment.attachmentId, block)
    }
  }
  return result
}
async function* bounded(chunks: AsyncIterable<Uint8Array>, max: number, signal: AbortSignal): AsyncIterable<Uint8Array> {
  let bytes = 0
  for await (const chunk of chunks) {
    signal.throwIfAborted(); bytes += chunk.byteLength
    if (bytes > max) throw fail('invalid-media', 'The media file exceeds its size limit.')
    yield chunk
  }
  signal.throwIfAborted()
}
export async function stageMedia(host: MediaHost, exec: MediaExec, root: string, directory: string, inputs: MediaInput[]): Promise<{ path: string; mediaType: string; bytes: number }[]> {
  if (inputs.length > 40) throw fail('bad-request', 'At most 40 input files are allowed.')
  const refs = inputs.some(input => input.attachmentId) ? await sessionAttachments(host, exec) : new Map()
  const staged: { path: string; mediaType: string; bytes: number }[] = []
  for (const [index, input] of inputs.entries()) {
    exec.signal.throwIfAborted()
    if (!MEDIA_LIMITS[input.kind] || Boolean(input.path) === Boolean(input.attachmentId)) throw fail('bad-request', 'Provide exactly one workspace path or current-session attachment ID per input.')
    const ref = input.attachmentId ? refs.get(input.attachmentId) : undefined
    if (input.attachmentId && !ref) throw fail('unknown-attachment', 'The attachment does not belong to the current session.')
    const source = input.path ? await confinedPath(root, input.path) : undefined
    if (source) await inspectMedia(source, input.kind)
    const rawName = source ? basename(source) : ref!.attachment.name || 'attachment'
    const extension = /^\.[a-z0-9]{1,8}$/i.test(extname(rawName)) ? extname(rawName).toLowerCase() : ref?.type === 'image' ? '.' + (ref.attachment as ImageAttachmentRef).mediaType.split('/')[1] : '.bin'
    const target = join(directory, `input-${index}${extension}`)
    if (source) await pipeline(createReadStream(source), createWriteStream(target, { flags: 'wx' }), { signal: exec.signal })
    else if (ref!.type === 'image') {
      if (input.kind !== 'image') throw fail('invalid-media', 'An image attachment cannot be used as audio or video.')
      const stored = await host.attachments.readImage(ref!.attachment as ImageAttachmentRef, exec.signal)
      if (stored.data.byteLength > MEDIA_LIMITS.image) throw fail('invalid-media', 'The image is too large.')
      await writeFile(target, stored.data, { flag: 'wx', signal: exec.signal })
    } else await pipeline(bounded(host.attachments.readFileStream(ref!.attachment as FileAttachmentRef, exec.signal), MEDIA_LIMITS[input.kind], exec.signal), createWriteStream(target, { flags: 'wx' }), { signal: exec.signal })
    const info = await inspectMedia(target, input.kind)
    staged.push({ path: target, ...info })
  }
  return staged
}
export async function jobDirectory(root: string, slug: string, id: string = randomUUID()): Promise<{ id: string; directory: string }> {
  if (!/^dsh-[a-z0-9-]+$/.test(slug) || !/^[a-f0-9-]{36}$/i.test(id)) throw fail('bad-request', 'Invalid media job identifier.')
  const parent = join(root, `.${slug}`)
  await mkdir(parent, { recursive: true }); await confinedPath(root, parent)
  const directory = join(parent, id)
  await mkdir(directory, { recursive: true }); await confinedPath(root, directory)
  return { id, directory }
}
export async function writeReceipt(directory: string, receipt: unknown): Promise<void> {
  const target = join(directory, 'receipt.json'), temporary = join(directory, `receipt-${randomUUID()}.tmp`)
  await confinedPath(directory, directory)
  await writeFile(temporary, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  // Replacement is atomic in this directory; credentials and signed URLs do not belong in receipts.
  await rename(temporary, target)
}
export async function readReceipt<T>(root: string, slug: string, id: string): Promise<T> {
  if (!/^dsh-[a-z0-9-]+$/.test(slug) || !/^[a-f0-9-]{36}$/i.test(id)) throw fail('bad-request', 'Invalid media job identifier.')
  const path = await confinedPath(root, join(root, `.${slug}`, id, 'receipt.json'))
  if ((await lstat(path)).size > 1024 * 1024) throw fail('invalid-receipt', 'The media receipt is too large.')
  return JSON.parse(await readFile(path, 'utf8')) as T
}
export async function publishMedia(host: MediaHost, source: string, sourceRoot: string, destination: string, workspace: string, kind: MediaKind, signal: AbortSignal): Promise<PublishedMedia> {
  signal.throwIfAborted()
  const path = await confinedPath(sourceRoot, source), info = await inspectMedia(path, kind)
  if (kind === 'image' && !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(info.mediaType)) throw fail('unsupported-media', 'The host cannot attach this image format. Use PNG, JPEG, GIF or WebP.')
  await confinedPath(workspace, destination)
  const extension = ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/flac': '.flac', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a', 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm', 'audio/webm': '.webm' } as Record<string, string>)[info.mediaType]
  const rawName = basename(path).replace(/[^\w.\-]/g, '_').slice(-100) || kind
  const name = extension ? rawName.replace(/\.[^.]*$/, '') + extension : rawName
  const reuse = insideDirectory(destination, path) && await realpath(sourceRoot) === await realpath(workspace)
  const target = reuse ? path : join(destination, `${randomUUID().slice(0, 8)}-${name}`)
  if (kind === 'image') {
    const input = { data: await readFile(path), mediaType: info.mediaType as ImageMediaType, name }
    await host.attachments.validateImage(input)
    signal.throwIfAborted()
    if (!reuse) await writeFile(target, input.data, { flag: 'wx', signal })
    const [attachment] = await host.attachments.saveImages([input])
    signal.throwIfAborted()
    return { path: relative(workspace, target).split(sep).join('/'), name, kind, ...info, attachment: { type: 'image', attachment } }
  }
  if (!reuse) await pipeline(createReadStream(path), createWriteStream(target, { flags: 'wx' }), { signal })
  const attachment = await host.attachments.saveFileStream({ data: bounded(createReadStream(target), MEDIA_LIMITS[kind], signal), name, signal })
  signal.throwIfAborted()
  return { path: relative(workspace, target).split(sep).join('/'), name, kind, ...info, attachment: { type: 'file', attachment } }
}
