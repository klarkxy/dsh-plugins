import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GrokOperations, jobSchema, registerTools, renderResult, type JobStore, type MediaJob } from './tools.ts'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
const png = Buffer.from([137,80,78,71,13,10,26,10])
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'grok-tools-')); roots.push(root)
  const rows = new Map<string, MediaJob>(), events: string[] = [], tools: any[] = []
  const store: JobStore = { get: async id => rows.get(id), put: vi.fn(async job => { rows.set(job.id, structuredClone(job)); events.push(job.state) }), list: async workspace => [...rows.values()].filter(job => job.workspace === workspace) }
  const release = vi.fn()
  const observeSession = vi.fn(async (id: unknown, options: { signal: AbortSignal; projectionMode: string }) => {
    expect(id).toBe('current'); expect(options.projectionMode).toBe('none'); expect(options.signal).toBeInstanceOf(AbortSignal)
    options.signal.throwIfAborted()
    return { events: [{ type: 'user/message', data: { content: [{ type: 'image', attachment: { attachmentId: 'current-image', mediaType: 'image/png', name: 'ref.png' } }] } }], [Symbol.dispose]: release }
  })
  const host: any = { sandboxPolicy: { resolve: () => ({ workspaceRoot: root, mode: 'workspace-write' }) }, tools: { register: (tool: any) => tools.push(tool) }, attachments: { validateImage: vi.fn(async () => {}), saveImages: vi.fn(async () => [{ attachmentId: 'generated-image', mediaType: 'image/png', name: 'output.png' }]), readImage: vi.fn(async () => ({ data: png })) }, get: () => ({ observeSession }) }
  const runtime = { run: vi.fn(async (request: any) => {
    events.push('invocation'); await request.onPrepared({ home: join(tmpdir(), `dsh-grok-home-${randomUUID()}`), sessionId: randomUUID() }); await request.onStarted()
    events.push('paid'); const path = join(request.jobDirectory, 'output.png'); await writeFile(path, png)
    const file = { source: path, name: 'output.png', kind: 'image', mediaType: 'image/png', bytes: png.length }
    await request.onFile(file); return { answer: '', sources: [], files: [file], state: 'completed' as const }
  }) }
  const operations = new GrokOperations(host, () => runtime as any, store, () => ({ allowNativeMediaFiles: true }))
  const exec: any = { signal: new AbortController().signal, agent: { session: { id: 'current' } } }
  return { root, rows, store, host, runtime, operations, events, exec, tools, observeSession, release }
}
describe('protected Grok jobs and attachments', () => {
  it('persists before paid work, emits native attachments, and recovers after recreation without invoking the CLI again', async () => {
    const f = await setup(), result = await f.operations.execute('generate_image', { prompt: 'image' }, f.exec)
    expect(f.events.indexOf('submitting')).toBeLessThan(f.events.indexOf('paid'))
    expect(result.files[0].attachment).toMatchObject({ type: 'image', attachment: { attachmentId: 'generated-image' } })
    expect(renderResult(result)).toContainEqual(result.files[0].attachment)
    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result)
    expect(f.rows.get(result.jobId!)?.files[0].sha256).toMatch(/^[a-f0-9]{64}$/)
    const second = new GrokOperations(f.host, () => f.runtime as any, f.store, () => ({ allowNativeMediaFiles: false }))
    const recovered = await second.execute('recover_media', { jobId: result.jobId }, f.exec)
    expect(JSON.parse(JSON.stringify(recovered))).toStrictEqual(recovered)
    expect(recovered.files).toHaveLength(1); expect(f.runtime.run).toHaveBeenCalledOnce()
    expect((await second.execute('media_jobs', {}, f.exec)).jobs).toMatchObject([{ jobId: result.jobId, state: 'completed' }])
  })
  it('rejects replaced files and forged workspace receipt JSON without new vendor calls', async () => {
    const f = await setup(), result = await f.operations.execute('generate_image', { prompt: 'image' }, f.exec)
    const job = f.rows.get(result.jobId!)!
    await writeFile(job.files[0].source, Buffer.concat([png, Buffer.from('tampered')]))
    await expect(f.operations.execute('recover_media', { jobId: job.id }, f.exec)).rejects.toMatchObject({ code: 'integrity' })
    const fakeId = randomUUID()
    await expect(f.operations.execute('recover_media', { jobId: fakeId }, f.exec)).rejects.toMatchObject({ code: 'not-found' })
    expect(f.runtime.run).toHaveBeenCalledOnce()
  })
  it('removes a retained private home only after recovery has persisted the files', async () => {
    const f = await setup(), original = f.runtime.run.getMockImplementation()!
    const home = await mkdtemp(join(tmpdir(), 'dsh-grok-home-')); roots.push(home)
    await writeFile(join(home, 'retained-session'), 'temporary')
    f.runtime.run.mockImplementation(async request => {
      const outcome = await original({ ...request, onPrepared: () => request.onPrepared({ home, sessionId: randomUUID() }) })
      return { ...outcome, state: 'uncertain' as any }
    })
    const result = await f.operations.execute('generate_image', { prompt: 'image' }, f.exec)
    const recovered = await f.operations.execute('recover_media', { jobId: result.jobId }, f.exec)
    expect(recovered.files).toHaveLength(1)
    await expect(readFile(join(home, 'retained-session'))).rejects.toThrow()
    expect(f.rows.get(result.jobId!)?.privateSession).toBeUndefined()
    expect(f.runtime.run).toHaveBeenCalledOnce()
  })
  it('accepts current-session images and rejects foreign attachments or workspace paths before invoking Grok', async () => {
    const f = await setup()
    await expect(f.operations.execute('edit_image', { prompt: 'edit', attachmentIds: ['foreign'] }, f.exec)).rejects.toMatchObject({ code: 'unknown-attachment' })
    expect(f.observeSession).toHaveBeenCalledOnce(); expect(f.release).toHaveBeenCalledOnce()
    await expect(f.operations.execute('edit_image', { prompt: 'edit', paths: ['../outside.png'] }, f.exec)).rejects.toMatchObject({ code: 'outside-workspace' })
    expect(f.runtime.run).not.toHaveBeenCalled()
    await f.operations.execute('edit_image', { prompt: 'edit', attachmentIds: ['current-image'] }, f.exec)
    expect(f.host.attachments.readImage).toHaveBeenCalledOnce()
    expect(f.observeSession).toHaveBeenCalledTimes(2); expect(f.release).toHaveBeenCalledTimes(2)
    expect(f.runtime.run.mock.calls[0][0].inputs[0].path).toContain('inputs')
    await expect(readFile(f.runtime.run.mock.calls[0][0].inputs[0].path)).rejects.toThrow()
  })
  it('preserves the private home and recovery pointer when native output enumeration fails', async () => {
    const f = await setup(), original = f.runtime.run.getMockImplementation()!
    const home = await mkdtemp(join(tmpdir(), 'dsh-grok-home-')); roots.push(home)
    await writeFile(join(home, 'sessions'), 'unreadable directory fixture')
    f.runtime.run.mockImplementation(async request => {
      const outcome = await original({ ...request, onPrepared: () => request.onPrepared({ home, sessionId: randomUUID() }) })
      return { ...outcome, state: 'uncertain' as any }
    })
    const result = await f.operations.execute('generate_image', { prompt: 'image' }, f.exec)
    await expect(f.operations.execute('recover_media', { jobId: result.jobId }, f.exec)).rejects.toThrow()
    expect(await readFile(join(home, 'sessions'), 'utf8')).toBe('unreadable directory fixture')
    expect(f.rows.get(result.jobId!)?.privateSession?.home).toBe(home)
    expect(f.runtime.run).toHaveBeenCalledOnce()
  })
  it('checks consent and exact input counts before staging or reading an attachment', async () => {
    const f = await setup(), off = new GrokOperations(f.host, () => f.runtime as any, f.store, () => ({ allowNativeMediaFiles: false }))
    await expect(off.execute('edit_image', { prompt: 'edit', attachmentIds: ['current-image'] }, f.exec)).rejects.toMatchObject({ code: 'native-media-disabled' })
    await expect(f.operations.execute('image_to_video', { prompt: 'video', paths: ['one', 'two'] }, f.exec)).rejects.toMatchObject({ code: 'bad-request' })
    expect(f.host.attachments.readImage).not.toHaveBeenCalled(); expect(f.runtime.run).not.toHaveBeenCalled()
  })
  it('preserves reference roles, exact controls and voices in native arguments', async () => {
    const f = await setup(), ref = { attachmentId: 'current-image' }
    await f.operations.execute('reference_to_video', { prompt: 'scene', images: [ref], firstFrame: ref, lastFrame: ref, keyframes: [{ image: ref, timestampS: 2 }], voices: ['ara', 'eve'], duration: 10, resolutionName: '720p', aspectRatio: '9:16' }, f.exec)
    const request = f.runtime.run.mock.calls[0][0], paths = request.inputs.map((input: any) => input.path)
    expect(request.nativeInput).toEqual({ images: [paths[0]], first_frame: paths[1], last_frame: paths[2], keyframes: [{ image: paths[3], timestamp_s: 2 }], voices: ['ara', 'eve'], duration: 10, resolution_name: '720p', aspect_ratio: '9:16' })
    expect(f.host.attachments.readImage).toHaveBeenCalledTimes(4)
    expect(f.observeSession).toHaveBeenCalledOnce(); expect(f.release).toHaveBeenCalledOnce()
  })
  it('supports voice-only references and exact image generation/image-to-video options', async () => {
    const f = await setup()
    await f.operations.execute('reference_to_video', { prompt: '<AUDIO_0> speaks', voices: ['rex'], duration: 1 }, f.exec)
    expect(f.runtime.run.mock.calls[0][0]).toMatchObject({ inputs: [], nativeInput: { voices: ['rex'], duration: 1, images: [], keyframes: [], aspect_ratio: '16:9' } })
    await f.operations.execute('generate_image', { prompt: 'portrait', aspectRatio: '2:3' }, f.exec)
    expect(f.runtime.run.mock.calls[1][0].nativeInput).toEqual({ aspect_ratio: '2:3' })
    expect(f.observeSession).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled()
    await f.operations.execute('image_to_video', { prompt: 'animate', image: { attachmentId: 'current-image' }, duration: 10, resolutionName: '720p' }, f.exec)
    expect(f.runtime.run.mock.calls[2][0].nativeInput).toMatchObject({ image: expect.any(String), duration: 10, resolution_name: '720p' })
    expect(f.observeSession).toHaveBeenCalledOnce(); expect(f.release).toHaveBeenCalledOnce()
  })
  it('rejects invalid video bounds, frame times, aspect ratios and file-like voices before any media reads or CLI submission', async () => {
    const f = await setup(), ref = { attachmentId: 'current-image' }
    for (const args of [
      { images: [ref], duration: 16 }, { voices: ['a', 'b', 'c', 'd'] }, { voices: ['C:/audio.wav'] },
      { images: [ref], aspectRatio: 'auto' }, { firstFrame: ref, keyframes: [{ image: ref, timestampS: 6 }] },
      { firstFrame: ref, keyframes: [{ image: ref, timestampS: 2 }, { image: ref, timestampS: 2.1 }] },
      { images: Array.from({ length: 15 }, () => ref) }, { firstFrame: { path: 'a', attachmentId: 'b' } },
    ]) await expect(f.operations.execute('reference_to_video', { prompt: 'scene', ...args }, f.exec)).rejects.toThrow()
    await expect(f.operations.execute('image_to_video', { prompt: 'animate', image: ref, duration: 8 }, f.exec)).rejects.toMatchObject({ code: 'bad-request' })
    expect(f.runtime.run).not.toHaveBeenCalled(); expect(f.host.attachments.readImage).not.toHaveBeenCalled()
  })
  it('keeps cancellation uncertain with a recoverable jobId and saved files', async () => {
    const f = await setup(), controller = new AbortController(), original = f.runtime.run.getMockImplementation()!
    f.runtime.run.mockImplementation(async request => { const outcome = await original(request); controller.abort(); return { ...outcome, state: 'uncertain' as any } })
    const result = await f.operations.execute('generate_image', { prompt: 'image' }, { ...f.exec, signal: controller.signal })
    expect(result).toMatchObject({ state: 'uncertain', files: [] }); expect(f.rows.get(result.jobId!)?.files).toHaveLength(1)
    expect((await f.operations.execute('recover_media', { jobId: result.jobId }, f.exec)).files).toHaveLength(1)
    expect(f.runtime.run).toHaveBeenCalledOnce()
  })
  it('normalizes interrupted submitting records to uncertain and refuses cross-workspace recovery', async () => {
    const f = await setup(), result = await f.operations.execute('generate_image', { prompt: 'image' }, f.exec), job = f.rows.get(result.jobId!)!
    job.state = 'submitting'; f.rows.set(job.id, job)
    expect((await f.operations.execute('media_jobs', {}, f.exec)).jobs![0].state).toBe('uncertain')
    expect((await f.operations.execute('recover_media', { jobId: job.id }, f.exec)).state).toBe('uncertain')
    job.workspace = 'foreign'; f.rows.set(job.id, job)
    await expect(f.operations.execute('recover_media', { jobId: job.id }, f.exec)).rejects.toMatchObject({ code: 'not-found' })
    expect(() => jobSchema.parse({ ...job, token: 'unexpected' })).toThrow()
  })
  it('registers six native capabilities plus recovery/list and combines tool and unload signals', async () => {
    const f = await setup(), lifetime = new AbortController(), operations = { execute: vi.fn(async () => ({ answer: '', sources: [], files: [], state: 'completed' })) }
    registerTools(f.host, operations, Promise.resolve(), lifetime.signal)
    expect(f.tools.map(tool => tool.name)).toEqual(['grok_search', 'grok_fetch', 'grok_generate_image', 'grok_edit_image', 'grok_image_to_video', 'grok_reference_to_video', 'grok_recover_media', 'grok_media_jobs'])
    lifetime.abort(); await expect(f.tools[0].execute({ prompt: 'query' }, f.exec)).rejects.toThrow()
    expect(operations.execute).not.toHaveBeenCalled()
  })
})
