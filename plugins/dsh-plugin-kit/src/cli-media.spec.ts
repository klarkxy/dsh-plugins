import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FileAttachmentRef, ImageAttachmentRef, SaveFileStreamAttachment, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import {
  CliMediaError, MEDIA_LIMITS, confinedPath, inspectMedia, insideDirectory, jobDirectory, mediaWorkspace,
  publishMedia, readReceipt, stageMedia, writeReceipt, type MediaHost, type MediaInput, type MediaKind,
} from './cli-media.ts'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=', 'base64')
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])
const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.from('fmt ')])
const MP4 = Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.from('isom'), Buffer.alloc(8)])
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(12)])
const HEIC = Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.from('heic'), Buffer.alloc(8)])
const JOB = '11111111-1111-4111-8111-111111111111'
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async root => {
    try { await rm(root, { recursive: true, force: true }) }
    catch { /* a junction that could not be removed is recorded by the test */ }
  }))
})

async function directory(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return realpath(root)
}

type Stored = { type: 'image' | 'file'; attachment: ImageAttachmentRef | FileAttachmentRef }
type Event = { type: string; data?: { content?: unknown; message?: { content?: unknown } } }

function imageRef(id: string, name?: string): ImageAttachmentRef {
  return { attachmentId: id as ImageAttachmentRef['attachmentId'], mediaType: 'image/png', bytes: PNG.length, width: 1, height: 1, ...(name ? { name } : {}) }
}
function fileRef(id: string, name: string, bytes: number): FileAttachmentRef {
  return { attachmentId: id as FileAttachmentRef['attachmentId'], name, bytes }
}
function host(root: string, mode = 'workspace-write', events: Event[] = []): MediaHost & {
  attachments: MediaHost['attachments'] & {
    readImage: ReturnType<typeof vi.fn>
    readFileStream: ReturnType<typeof vi.fn>
    validateImage: ReturnType<typeof vi.fn>
    saveImages: ReturnType<typeof vi.fn>
    saveFileStream: ReturnType<typeof vi.fn>
  }
  reads: string[]
} {
  const reads: string[] = []
  const store = new Map<string, { bytes: Buffer; ref: Stored }>()
  const attachments = {
    readImage: vi.fn(async (ref: ImageAttachmentRef) => {
      reads.push(ref.attachmentId)
      const stored = store.get(ref.attachmentId)
      if (!stored || stored.ref.type !== 'image') throw new Error(`unread image ${ref.attachmentId}`)
      return { data: stored.bytes, ref: stored.ref.attachment }
    }),
    readFileStream: vi.fn((ref: FileAttachmentRef) => {
      reads.push(ref.attachmentId)
      const stored = store.get(ref.attachmentId)
      if (!stored || stored.ref.type !== 'file') throw new Error(`unread file ${ref.attachmentId}`)
      async function* chunks() {
        yield stored.bytes.subarray(0, 4)
        yield stored.bytes.subarray(4)
      }
      return chunks()
    }),
    validateImage: vi.fn(async (input: SaveImageAttachment) => {
      if (!input.mediaType.startsWith('image/') || input.data.byteLength < 4) throw new Error('invalid image')
    }),
    saveImages: vi.fn(async (inputs: SaveImageAttachment[]) => inputs.map((input, index) => imageRef(`published-${index}`, input.name))),
    saveFileStream: vi.fn(async (input: SaveFileStreamAttachment) => {
      const chunks: Buffer[] = []
      for await (const chunk of input.data) chunks.push(Buffer.from(chunk))
      const bytes = Buffer.concat(chunks)
      return fileRef('published-file', input.name ?? 'file.bin', bytes.length)
    }),
  }
  const value: MediaHost & { reads: string[] } = {
    sandboxPolicy: { resolve: () => ({ workspaceRoot: root, mode }) },
    attachments: attachments as unknown as MediaHost['attachments'],
    get: () => ({ observeSession: async () => ({ events, [Symbol.dispose]() {} }) }),
    reads,
  }
  return Object.assign(value, {
    remember(id: string, bytes: Buffer, ref: Stored) { store.set(id, { bytes, ref }) },
  }) as typeof value & { remember(id: string, bytes: Buffer, ref: Stored): void }
}

function exec(signal = new AbortController().signal, session = 'current') {
  return { signal, agent: { session: { id: session } } }
}

function userImage(id: string, name?: string): Event {
  return { type: 'user/message', data: { content: [{ type: 'image', attachment: imageRef(id, name) }] } }
}
function toolFile(id: string, name: string, bytes: number): Event {
  return { type: 'tool/result', data: { message: { content: [{ type: 'file', attachment: fileRef(id, name, bytes) }] } } }
}

describe('workspace preflight and path confinement', () => {
  it('refuses a write workspace while it is read-only', async () => {
    const root = await directory('dsh-cli-media-')
    const value = host(root, 'read-only')
    await expect(mediaWorkspace(value, exec(), true)).rejects.toMatchObject({ name: 'CliMediaError', code: 'read-only' })
    expect(await mediaWorkspace(value, exec(), false)).toBe(root)
  })

  it('accepts a real file and rejects a path that leaves the workspace', async () => {
    const root = await directory('dsh-cli-media-')
    const outside = await directory('dsh-cli-media-out-')
    await writeFile(join(root, 'inside.png'), PNG)
    await writeFile(join(outside, 'secret.png'), PNG)
    expect(await confinedPath(root, 'inside.png')).toBe(join(root, 'inside.png'))
    await expect(confinedPath(root, join(outside, 'secret.png'))).rejects.toMatchObject({ code: 'outside-workspace' })
    await expect(confinedPath(root, join('..', basename(outside), 'secret.png'))).rejects.toMatchObject({ code: 'outside-workspace' })
  })

  it('rejects a link that points at a file outside the workspace before the target is read', async () => {
    const root = await directory('dsh-cli-media-')
    const outside = await directory('dsh-cli-media-out-')
    const secret = join(outside, 'secret.png')
    await writeFile(secret, PNG)
    const link = join(root, 'linked.png')
    let linked = false
    try {
      await symlink(secret, link)
      linked = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error
    }
    if (!linked) {
      const folder = join(outside, 'folder')
      await mkdir(folder)
      await writeFile(join(folder, 'secret.png'), PNG)
      await symlink(folder, join(root, 'linked'), 'junction')
      await expect(confinedPath(root, join('linked', 'secret.png'))).rejects.toMatchObject({ code: 'outside-workspace' })
      expect(await readFile(join(folder, 'secret.png'))).toEqual(PNG)
      return
    }
    await expect(confinedPath(root, 'linked.png')).rejects.toMatchObject({ code: 'outside-workspace' })
    expect(await readFile(secret)).toEqual(PNG)
  })

  it('rejects a workspace root that is itself a link', async () => {
    const root = await directory('dsh-cli-media-')
    const alias = join(root, 'alias')
    let linked = false
    try {
      await symlink(root, alias)
      linked = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error
    }
    if (!linked) await symlink(root, alias, 'junction')
    await expect(confinedPath(alias, 'missing.png')).rejects.toMatchObject({ code: 'outside-workspace' })
  })

  it('rejects a directory where a regular input file is required', async () => {
    const root = await directory('dsh-cli-media-')
    await mkdir(join(root, 'nested'))
    await expect(inspectMedia(join(root, 'nested'), 'image')).rejects.toMatchObject({ code: 'invalid-media' })
  })
})

describe('current-session attachment authorization', () => {
  it('passes cancellation to the raw observation and disposes its lease even when cancelled after acquisition', async () => {
    const root = await directory('dsh-cli-media-'), value = host(root), controller = new AbortController(), dispose = vi.fn()
    value.get = () => ({ observeSession: async (id: unknown, options: any) => {
      expect(id).toBe('current'); expect(options).toEqual({ signal: controller.signal, projectionMode: 'none' })
      controller.abort()
      return { events: [], [Symbol.dispose]: dispose }
    } })
    await expect(stageMedia(value, exec(controller.signal), root, root, [{ attachmentId: 'old', kind: 'image' }])).rejects.toThrow()
    expect(dispose).toHaveBeenCalledOnce()
    expect(value.reads).toEqual([])
  })
  it('stages a user image and a tool-result file without reading a foreign id', async () => {
    const root = await directory('dsh-cli-media-')
    const value = host(root, 'workspace-write', [
      userImage('current-image', 'photo.png'),
      toolFile('current-audio', 'clip.wav', WAV.length),
      { type: 'assistant/message', data: { content: [{ type: 'image', attachment: imageRef('foreign-image') }] } },
    ])
    value.remember('current-image', PNG, { type: 'image', attachment: imageRef('current-image', 'photo.png') })
    value.remember('current-audio', WAV, { type: 'file', attachment: fileRef('current-audio', 'clip.wav', WAV.length) })
    value.remember('foreign-image', PNG, { type: 'image', attachment: imageRef('foreign-image') })
    const directoryPath = join(root, 'stage')
    await mkdir(directoryPath)
    const readsBefore = value.reads.length
    await expect(stageMedia(value, exec(), root, directoryPath, [{ attachmentId: 'foreign-image', kind: 'image' }])).rejects.toMatchObject({ code: 'unknown-attachment' })
    expect(value.reads).toHaveLength(readsBefore)
    const staged = await stageMedia(value, exec(), root, directoryPath, [
      { attachmentId: 'current-image', kind: 'image' },
      { attachmentId: 'current-audio', kind: 'audio' },
    ])
    expect(value.reads).toEqual(['current-image', 'current-audio'])
    expect(await readFile(staged[0].path)).toEqual(PNG)
    expect(await readFile(staged[1].path)).toEqual(WAV)
    expect(staged.map(item => item.mediaType)).toEqual(['image/png', 'audio/wav'])
  })

  it('does not read an attachment id from another session event family', async () => {
    const root = await directory('dsh-cli-media-')
    const value = host(root, 'workspace-write', [
      { type: 'tool/call', data: { content: [{ type: 'file', attachment: fileRef('called', 'note.wav', WAV.length) }] } },
    ])
    value.remember('called', WAV, { type: 'file', attachment: fileRef('called', 'note.wav', WAV.length) })
    const directoryPath = join(root, 'stage')
    await mkdir(directoryPath)
    await expect(stageMedia(value, exec(), root, directoryPath, [{ attachmentId: 'called', kind: 'audio' }])).rejects.toMatchObject({ code: 'unknown-attachment' })
    expect(value.reads).toEqual([])
  })

  it('requires an active session and a host session query before reading attachments', async () => {
    const root = await directory('dsh-cli-media-')
    const value = host(root)
    const directoryPath = join(root, 'stage')
    await mkdir(directoryPath)
    await expect(stageMedia(value, { signal: new AbortController().signal }, root, directoryPath, [{ attachmentId: 'any', kind: 'image' }])).rejects.toMatchObject({ code: 'no-session' })
    delete value.get
    await expect(stageMedia(value, exec(), root, directoryPath, [{ attachmentId: 'any', kind: 'image' }])).rejects.toMatchObject({ code: 'no-session-query' })
    expect(value.reads).toEqual([])
  })
})

describe('staging and publication', () => {
  it('copies an explicit workspace image and keeps the original unchanged', async () => {
    const root = await directory('dsh-cli-media-')
    await writeFile(join(root, 'source.png'), PNG)
    const directoryPath = join(root, 'stage')
    await mkdir(directoryPath)
    const [staged] = await stageMedia(host(root), exec(), root, directoryPath, [{ path: 'source.png', kind: 'image' }])
    expect(await readFile(staged.path)).toEqual(PNG)
    expect(await readFile(join(root, 'source.png'))).toEqual(PNG)
    expect(staged.mediaType).toBe('image/png')
  })

  it('rejects a declared kind that the file header does not match', async () => {
    const root = await directory('dsh-cli-media-')
    await writeFile(join(root, 'photo.png'), PNG)
    await writeFile(join(root, 'short.bin'), Buffer.from([1, 2, 3]))
    await expect(inspectMedia(join(root, 'photo.png'), 'audio')).rejects.toMatchObject({ code: 'invalid-media' })
    await expect(inspectMedia(join(root, 'short.bin'), 'image')).rejects.toMatchObject({ code: 'invalid-media' })
    await expect(inspectMedia(join(root, 'missing.png'), 'image')).rejects.toThrow()
  })

  it('recognizes the image, audio, and video headers the helper accepts', async () => {
    const root = await directory('dsh-cli-media-')
    const samples: [string, Buffer, MediaKind, string][] = [
      ['a.jpg', JPEG, 'image', 'image/jpeg'],
      ['a.heic', HEIC, 'image', 'image/heic'],
      ['a.mp4', MP4, 'video', 'video/mp4'],
      ['a.webm', WEBM, 'audio', 'audio/webm'],
      ['a.webm', WEBM, 'video', 'video/webm'],
    ]
    for (const [name, bytes, kind, mediaType] of samples) {
      await writeFile(join(root, name), bytes)
      await expect(inspectMedia(join(root, name), kind)).resolves.toMatchObject({ mediaType, bytes: bytes.length })
    }
  })

  it('publishes an image through image validation and a video through a bounded file stream', async () => {
    const root = await directory('dsh-cli-media-')
    const source = join(root, 'jobs')
    const destination = join(root, 'published')
    await mkdir(source); await mkdir(destination)
    await writeFile(join(source, 'frame.png'), PNG)
    await writeFile(join(source, 'clip.mp4'), MP4)
    const value = host(root)
    const image = await publishMedia(value, join(source, 'frame.png'), source, destination, root, 'image', new AbortController().signal)
    expect(image.attachment.type).toBe('image')
    expect(image.mediaType).toBe('image/png')
    expect(value.attachments.validateImage).toHaveBeenCalledOnce()
    expect(value.attachments.saveImages).toHaveBeenCalledOnce()
    expect(value.attachments.saveFileStream).not.toHaveBeenCalled()
    const video = await publishMedia(value, join(source, 'clip.mp4'), source, destination, root, 'video', new AbortController().signal)
    expect(video.attachment.type).toBe('file')
    expect(video.mediaType).toBe('video/mp4')
    const streamed = value.attachments.saveFileStream.mock.calls[0][0] as SaveFileStreamAttachment
    expect(typeof streamed.data[Symbol.asyncIterator]).toBe('function')
    expect(streamed.data).not.toBeInstanceOf(Buffer)
    expect(await readFile(join(root, video.path))).toEqual(MP4)
  })

  it('publishes a file already inside the destination without copying it again', async () => {
    const root = await directory('dsh-cli-media-')
    const destination = join(root, 'published')
    await mkdir(destination)
    await writeFile(join(destination, 'frame.png'), PNG)
    const value = host(root)
    const published = await publishMedia(value, join(destination, 'frame.png'), root, destination, root, 'image', new AbortController().signal)
    expect(published.path).toBe('published/frame.png')
    expect(await readFile(join(root, published.path))).toEqual(PNG)
    expect(value.attachments.validateImage).toHaveBeenCalledOnce()
    expect(value.attachments.saveImages).toHaveBeenCalledOnce()
  })

  it('validates an image before saving it', async () => {
    const root = await directory('dsh-cli-media-')
    const source = join(root, 'jobs'); const destination = join(root, 'published')
    await mkdir(source); await mkdir(destination)
    await writeFile(join(source, 'frame.png'), PNG)
    const value = host(root)
    const order: string[] = []
    value.attachments.validateImage.mockImplementationOnce(async () => { order.push('validate') })
    value.attachments.saveImages.mockImplementationOnce(async () => { order.push('save'); return [imageRef('published-0', 'frame.png')] })
    const published = await publishMedia(value, join(source, 'frame.png'), source, destination, root, 'image', new AbortController().signal)
    expect(order).toEqual(['validate', 'save'])
    expect(published.attachment.type).toBe('image')
    const saved = value.attachments.saveImages.mock.calls[0][0] as SaveImageAttachment[]
    expect(saved[0].mediaType).toBe('image/png')
  })

  it('stops a streamed file copy when the declared size limit is crossed', async () => {
    const root = await directory('dsh-cli-media-')
    const value = host(root, 'workspace-write', [toolFile('huge', 'clip.wav', WAV.length + 8)])
    const huge = Buffer.concat([WAV, Buffer.alloc(8)])
    value.remember('huge', huge, { type: 'file', attachment: fileRef('huge', 'clip.wav', huge.length) })
    const directoryPath = join(root, 'stage')
    await mkdir(directoryPath)
    const limits = MEDIA_LIMITS.audio
    MEDIA_LIMITS.audio = WAV.length
    try {
      await expect(stageMedia(value, exec(), root, directoryPath, [{ attachmentId: 'huge', kind: 'audio' }])).rejects.toMatchObject({ code: 'invalid-media' })
    } finally { MEDIA_LIMITS.audio = limits }
  })

  it('rejects an image attachment supplied as audio before writing it', async () => {
    const root = await directory('dsh-cli-media-')
    const value = host(root, 'workspace-write', [userImage('picture')])
    value.remember('picture', PNG, { type: 'image', attachment: imageRef('picture') })
    const directoryPath = join(root, 'stage')
    await mkdir(directoryPath)
    await expect(stageMedia(value, exec(), root, directoryPath, [{ attachmentId: 'picture', kind: 'audio' }])).rejects.toMatchObject({ code: 'invalid-media' })
    expect(value.reads).toEqual([])
  })

  it('rejects a request that names both a path and an attachment', async () => {
    const root = await directory('dsh-cli-media-')
    const directoryPath = join(root, 'stage')
    await mkdir(directoryPath)
    const input: MediaInput = { path: 'source.png', attachmentId: 'current', kind: 'image' }
    await expect(stageMedia(host(root), exec(), root, directoryPath, [input])).rejects.toMatchObject({ code: 'bad-request' })
  })
})

describe('receipts', () => {
  it('round-trips one receipt inside its job directory', async () => {
    const root = await directory('dsh-cli-media-')
    const job = await jobDirectory(root, 'dsh-grok', JOB)
    const receipt = { id: JOB, kind: 'image' as const, output: 'published/frame.png' }
    await writeReceipt(job.directory, receipt)
    await expect(readReceipt<typeof receipt>(root, 'dsh-grok', JOB)).resolves.toEqual(receipt)
    const info = await lstat(join(job.directory, 'receipt.json'))
    expect(info.isFile()).toBe(true)
    expect(info.isSymbolicLink()).toBe(false)
  })

  it('rejects an invalid job id and a receipt reached through a link', async () => {
    const root = await directory('dsh-cli-media-')
    const outside = await directory('dsh-cli-media-out-')
    await expect(readReceipt(root, '../escape', JOB)).rejects.toMatchObject({ code: 'bad-request' })
    await expect(readReceipt(root, 'dsh-grok', 'not-a-uuid')).rejects.toMatchObject({ code: 'bad-request' })
    const job = await jobDirectory(root, 'dsh-minimax-code', JOB)
    const hidden = join(outside, 'hidden')
    await mkdir(hidden)
    await writeFile(join(hidden, 'receipt.json'), '{"stolen":true}\n')
    const target = join(job.directory, 'receipt.json')
    try { await symlink(join(hidden, 'receipt.json'), target) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error
      await symlink(hidden, target, 'junction')
    }
    await expect(readReceipt(root, 'dsh-minimax-code', JOB)).rejects.toMatchObject({ code: 'outside-workspace' })
    expect(await readFile(join(hidden, 'receipt.json'), 'utf8')).toBe('{"stolen":true}\n')
  })

  it('rejects a receipt larger than one megabyte', async () => {
    const root = await directory('dsh-cli-media-')
    const job = await jobDirectory(root, 'dsh-grok', JOB)
    await writeFile(join(job.directory, 'receipt.json'), Buffer.alloc(1024 * 1024 + 1, 0x20))
    await expect(readReceipt(root, 'dsh-grok', JOB)).rejects.toMatchObject({ code: 'invalid-receipt' })
  })
})

describe('path helpers', () => {
  it('treats the workspace root as inside and its parent as outside', () => {
    const root = resolve(sep)
    expect(insideDirectory(root, root)).toBe(true)
    expect(insideDirectory(join(root, 'workspace'), join(root, 'other'))).toBe(false)
  })

  it('keeps the declared media byte limits', () => {
    expect(MEDIA_LIMITS).toEqual({ image: 30 * 1024 * 1024, audio: 100 * 1024 * 1024, video: 256 * 1024 * 1024 })
  })

  it('exposes a stable media error identity', () => {
    const error = new CliMediaError('outside-workspace', 'The file must stay inside the permitted directory.')
    expect(error).toMatchObject({ name: 'CliMediaError', code: 'outside-workspace' })
  })
})
