import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MediaHost } from '@klarkxy/dsh-plugin-kit/cli-media'
import { MiniMaxRuntime } from './runtime.ts'
import { DEFAULT_SETTINGS, CAPABILITIES, MiniMaxCodeError } from './contracts.ts'
import { jobSchema, type JobStore, type MediaJob } from './jobs.ts'
import type { MiniMaxCli } from './cli.ts'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=', 'base64')
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(16)])
const MP4 = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom'), Buffer.alloc(12)])
const roots: string[] = []
const runtimes: MiniMaxRuntime[] = []
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(runtime => runtime.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
const exec = (signal = new AbortController().signal) => ({ signal, agent: { session: { id: 'session' } } })
function store() {
  const rows = new Map<string, MediaJob>(), history: MediaJob[] = []
  const jobs: JobStore = {
    async get(id) { const row = rows.get(id); return row && structuredClone(row) },
    async put(job) { const row = jobSchema.parse(structuredClone(job)); rows.set(job.id, row); history.push(structuredClone(row)) },
    async list(root) { return [...rows.values()].filter(row => row.workspace === root).map(row => structuredClone(row)) },
  }
  return { rows, history, jobs }
}
async function fixture(mode = 'workspace-write', existing = store()) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'minimax-runtime-spec-'))); roots.push(root)
  const attachments = {
    validateImage: vi.fn(async () => {}),
    saveImages: vi.fn(async (images: any[]) => images.map(image => ({ attachmentId: 'published-image', mediaType: image.mediaType, name: image.name, bytes: image.data.length, width: 1, height: 1 }))),
    saveFileStream: vi.fn(async (input: any) => {
      let bytes = 0; for await (const chunk of input.data) bytes += chunk.length
      return { attachmentId: 'published-file', name: input.name, bytes }
    }),
  }
  const host = { sandboxPolicy: { resolve: () => ({ workspaceRoot: root, mode }) }, attachments } as unknown as MediaHost
  const cli = {
    status: vi.fn(async () => ({ executable: 'mock-tools', version: 'test', authenticated: true })),
    schema: vi.fn(async () => ({})), call: vi.fn(), upload: vi.fn(),
    assetUrl: vi.fn(async (id: string) => `https://media.example/${id}`),
  }
  const download = vi.fn(async (_url: string, path: string) => { await writeFile(path, path.endsWith('.png') ? PNG : path.endsWith('.mp4') ? MP4 : MP3) })
  const deps = { cli: () => cli as unknown as MiniMaxCli, download, search: { status: vi.fn(async () => true), run: vi.fn(async () => ({ status: 'complete', answer: 'Search result', files: [] })) } }
  const recreate = () => { const runtime = new MiniMaxRuntime(host, () => DEFAULT_SETTINGS, existing.jobs, deps); runtimes.push(runtime); return runtime }
  return { ...existing, root, host, cli, download, attachments, deps, recreate, runtime: recreate() }
}
function receipt(root: string, operation = 'generate_video'): MediaJob {
  const now = new Date().toISOString()
  return { version: 1, id: randomUUID(), workspace: root, operation, createdAt: now, updatedAt: now, status: 'pending', model: 'MiniMax-H3', taskId: 'video-task', assets: [], failures: [] }
}

describe('capability and preflight boundaries', () => {
  it('waits for an aborted status probe to finish before disposal resolves', async () => {
    const f = await fixture()
    let finish!: () => void
    f.cli.status.mockImplementation(async (signal?: AbortSignal) => {
      await new Promise<void>(resolve => { finish = resolve })
      signal!.throwIfAborted()
      return { executable: 'mock-tools', version: 'test', authenticated: true }
    })
    const status = f.runtime.status(exec().signal)
    const settled = status.catch(() => {})
    let disposed = false
    const disposal = f.runtime.dispose().then(() => { disposed = true })
    await Promise.resolve()
    expect(disposed).toBe(false)
    finish()
    await settled; await disposal
    expect(disposed).toBe(true)
  })
  it('reports all 12 supported capabilities through the injected search seam', async () => {
    const f = await fixture()
    const status = await f.runtime.status(exec().signal)
    expect(status.capabilities.map(value => value.id)).toEqual([...CAPABILITIES])
    expect(status.capabilities.every(value => value.available)).toBe(true)
    expect(f.cli.call).not.toHaveBeenCalled()
  })
  it.each([
    { prompt: 'wind', model: 'MiniMax-H3-Max', duration: 4, inputImage: { path: 'missing.png' } },
    { prompt: 'wind', model: 'MiniMax-Hailuo-2.3', duration: 10, resolution: '1080P', inputImage: { path: 'missing.png' } },
    { prompt: 'wind', model: 'MiniMax-H3', duration: 6, referenceAudios: [{ path: 'missing.mp3' }] },
  ])('rejects invalid model options before upload, schema probe, job write or paid call %#', async args => {
    const f = await fixture()
    await expect(f.runtime.execute('generate_video', args, exec())).rejects.toMatchObject({ code: 'bad-request' })
    expect(f.cli.upload).not.toHaveBeenCalled(); expect(f.cli.schema).not.toHaveBeenCalled(); expect(f.cli.call).not.toHaveBeenCalled(); expect(f.history).toEqual([])
  })
  it('checks connector availability before uploading a valid input', async () => {
    const f = await fixture(); await writeFile(join(f.root, 'frame.png'), PNG)
    f.cli.schema.mockRejectedValue(new MiniMaxCodeError('unsupported-schema', 'schema changed'))
    await expect(f.runtime.execute('generate_image', { requests: [{ prompt: 'tree', images: [{ path: 'frame.png' }] }] }, exec())).rejects.toMatchObject({ code: 'unsupported-schema' })
    expect(f.cli.upload).not.toHaveBeenCalled(); expect(f.cli.call).not.toHaveBeenCalled(); expect(f.history).toEqual([])
  })
  it.each([
    ['generate_image', { requests: [{ prompt: 'tree' }] }], ['generate_video', { prompt: 'wind', model: 'MiniMax-H3', duration: 4 }],
    ['batch_speech', { requests: [{ text: 'hello' }] }], ['synthesize_speech', { text: 'hello' }],
    ['search_images', { queries: [{ query: 'tree' }] }], ['recover_media', { jobId: '11111111-1111-4111-8111-111111111111' }], ['video_status', { jobId: '11111111-1111-4111-8111-111111111111' }],
  ] as const)('denies %s in read-only mode before connector or job access', async (operation, args) => {
    const f = await fixture('read-only')
    await expect(f.runtime.execute(operation, args, exec())).rejects.toMatchObject({ code: 'read-only' })
    expect(f.cli.schema).not.toHaveBeenCalled(); expect(f.cli.call).not.toHaveBeenCalled(); expect(f.cli.upload).not.toHaveBeenCalled(); expect(f.download).not.toHaveBeenCalled(); expect(f.history).toEqual([])
  })
})

describe('durable generation and delivery', () => {
  it('blocks recovery while the original generation is downloading, then recovers the completed job without repeating work', async () => {
    const f = await fixture()
    f.cli.call.mockResolvedValue({ success_items: [{ node_id: 'generated-image', file_name: 'item-0.png' }] })
    let started!: () => void, finish!: () => void
    const downloading = new Promise<void>(resolve => { started = resolve })
    const released = new Promise<void>(resolve => { finish = resolve })
    f.download.mockImplementationOnce(async (_url, path) => {
      started(); await released; await writeFile(path, PNG)
    })
    const pending = f.runtime.execute('generate_image', { requests: [{ prompt: 'tree' }] }, exec())
    await downloading
    const listed = await f.runtime.execute('media_jobs', {}, exec())
    const jobId = listed.data[0].jobId
    const savedBeforeRecovery = structuredClone(f.rows.get(jobId)), writesBeforeRecovery = f.history.length
    try {
      await expect(f.runtime.execute('recover_media', { jobId }, exec())).rejects.toMatchObject({ code: 'busy' })
      expect(f.cli.assetUrl).toHaveBeenCalledOnce(); expect(f.download).toHaveBeenCalledOnce()
      expect(f.rows.get(jobId)).toEqual(savedBeforeRecovery); expect(f.history).toHaveLength(writesBeforeRecovery)
    } finally { finish() }
    const generated = await pending
    expect(generated).toMatchObject({ jobId, status: 'complete' }); expect(generated.files).toHaveLength(1)
    expect(f.rows.get(jobId)?.status).toBe('complete')
    const recovered = await f.runtime.execute('recover_media', { jobId }, exec())
    expect(recovered.status).toBe('complete'); expect(recovered.files[0].path).toBe(generated.files[0].path)
    expect(f.cli.call).toHaveBeenCalledOnce(); expect(f.cli.assetUrl).toHaveBeenCalledOnce(); expect(f.download).toHaveBeenCalledOnce()
  })
  it('retains batch TTS partial results and recovers saved successes without repeating generation or download', async () => {
    const f = await fixture()
    f.cli.call.mockResolvedValue({ code: 0, message: 'partial', total_requested: 3, total_success: 2, total_failed: 1, success_items: [{ node_id: 'audio-2', file_name: 'item-2.mp3' }, { node_id: 'audio-0', file_name: 'item-0.mp3' }], failed_items: [{ index: 1, err_code: 1008, error_msg: 'failed' }] })
    const result = await f.runtime.execute('batch_speech', { requests: [{ text: 'first' }, { text: 'second' }, { text: 'third' }] }, exec())
    expect(result.status).toBe('partial')
    expect(result.items?.map(item => [item.index, item.status])).toEqual([[0, 'complete'], [1, 'failed'], [2, 'complete']])
    expect(result.files.map(file => file.attachment.type)).toEqual(['file', 'file'])
    expect(await readFile(join(f.root, result.files[0].path))).toEqual(MP3)
    expect(f.history.some(job => job.assets.length === 2 && job.assets.every(asset => !asset.localPath))).toBe(true)
    await f.runtime.dispose()
    const recovered = await f.recreate().execute('recover_media', { jobId: result.jobId }, exec())
    expect(recovered.status).toBe('partial'); expect(recovered.files).toHaveLength(2)
    expect(f.cli.call).toHaveBeenCalledOnce(); expect(f.download).toHaveBeenCalledTimes(2)
  })
  it('retries only failed downloads and preserves successful generated assets across recreation', async () => {
    const f = await fixture()
    f.cli.call.mockResolvedValue({ success_items: [{ node_id: 'image-0', file_name: 'item-0.png' }, { node_id: 'image-1', file_name: 'item-1.png' }] })
    f.download.mockImplementationOnce(async (_url, path) => { await writeFile(path, PNG) }).mockRejectedValueOnce(new Error('temporary download failure'))
    const first = await f.runtime.execute('generate_image', { requests: [{ prompt: 'first' }, { prompt: 'second' }] }, exec())
    expect(first.status).toBe('partial'); expect(first.files[0].attachment.type).toBe('image')
    const recovered = await f.recreate().execute('recover_media', { jobId: first.jobId }, exec())
    expect(recovered.status).toBe('complete'); expect(recovered.files).toHaveLength(2)
    expect(f.cli.call).toHaveBeenCalledOnce(); expect(f.download).toHaveBeenCalledTimes(3)
    expect(f.cli.assetUrl.mock.calls.map(call => call[0])).toEqual(['image-0', 'image-1', 'image-1'])
    expect(f.attachments.validateImage).toHaveBeenCalledTimes(3)
  })
  it('persists video task ID before any query and recovers the same task after runtime recreation', async () => {
    const f = await fixture()
    f.cli.call.mockImplementation(async (operation: string, wire: any) => {
      if (operation === 'generate_video') return { code: 0, task_id: 'paid-task', model: 'MiniMax-H3', status: 'submitted' }
      expect(operation).toBe('video_status'); expect(wire).toEqual({ task_id: 'paid-task', model: 'MiniMax-H3' })
      expect([...f.rows.values()][0]).toMatchObject({ taskId: 'paid-task', status: 'pending' })
      return { data: { task_id: 'paid-task', status: 'succeeded', video_url: 'https://media.example/video' } }
    })
    const submitted = await f.runtime.execute('generate_video', { prompt: 'wind', model: 'MiniMax-H3', duration: 4 }, exec())
    expect(submitted).toMatchObject({ taskId: 'paid-task', status: 'pending', files: [] })
    expect(f.cli.call).toHaveBeenCalledOnce()
    await f.runtime.dispose()
    const recovered = await f.recreate().execute('video_status', { jobId: submitted.jobId }, exec())
    expect(recovered.status).toBe('complete'); expect(recovered.files[0].attachment.type).toBe('file')
    expect(await readFile(join(f.root, recovered.files[0].path))).toEqual(MP4)
    expect(f.cli.call.mock.calls.map(call => call[0])).toEqual(['generate_video', 'video_status'])
  })
  it('retains a real task ID even if its submission status is unfamiliar, then recovers it without resubmission or stale error', async () => {
    const f = await fixture()
    f.cli.call.mockResolvedValueOnce({ code: 0, task_id: 'paid-task-new-status', model: 'MiniMax-H3', status: 'future_provider_status' })
      .mockResolvedValueOnce({ code: 0, data: { task_id: 'paid-task-new-status', status: 'succeeded', video_url: 'https://media.example/video' } })
    const first = await f.runtime.execute('generate_video', { prompt: 'wind', model: 'MiniMax-H3', duration: 4 }, exec())
    expect(first).toMatchObject({ taskId: 'paid-task-new-status', files: [] })
    expect(f.rows.get(first.jobId!)?.taskId).toBe('paid-task-new-status')
    expect(f.rows.get(first.jobId!)?.error).toContain('unknown video status')
    expect(f.history.some(job => job.taskId === 'paid-task-new-status' && !job.error)).toBe(true)
    expect(f.cli.call).toHaveBeenCalledOnce()
    await f.runtime.dispose()
    const recovered = await f.recreate().execute('recover_media', { jobId: first.jobId }, exec())
    expect(recovered.status).toBe('complete'); expect(recovered.files).toHaveLength(1)
    expect(recovered.data).toBeUndefined(); expect(f.rows.get(first.jobId!)?.error).toBeUndefined()
    expect(f.cli.call.mock.calls.map(call => call[0])).toEqual(['generate_video', 'video_status'])
    expect(f.cli.call.mock.calls[1][1]).toEqual({ task_id: 'paid-task-new-status', model: 'MiniMax-H3' })
  })
  it('preserves assets when vendor filenames prevent trustworthy batch correlation', async () => {
    const f = await fixture()
    f.cli.call.mockResolvedValue({ success_items: [{ node_id: 'paid-audio', file_name: 'renamed.mp3' }] })
    const first = await f.runtime.execute('batch_speech', { requests: [{ text: 'one' }, { text: 'two' }] }, exec())
    expect(first.status).toBe('download_failed'); expect(f.rows.get(first.jobId!)?.assets[0].nodeId).toBe('paid-audio')
    const recovered = await f.recreate().execute('recover_media', { jobId: first.jobId }, exec())
    expect(recovered.files).toHaveLength(1); expect(f.cli.call).toHaveBeenCalledOnce()
  })
})

describe('recovery authorization and cancellation', () => {
  it('blocks missing and foreign workspace jobs before querying the provider', async () => {
    const f = await fixture(), foreign = receipt('another-workspace'); await f.jobs.put(foreign)
    await expect(f.runtime.execute('recover_media', { jobId: randomUUID() }, exec())).rejects.toMatchObject({ code: 'unknown-job' })
    await expect(f.runtime.execute('video_status', { jobId: foreign.id }, exec())).rejects.toMatchObject({ code: 'unknown-job' })
    expect(f.cli.call).not.toHaveBeenCalled(); expect(f.download).not.toHaveBeenCalled()
  })
  it.each(['caller', 'unload'] as const)('marks an interrupted submission uncertain on %s and never resubmits it during recovery', async reason => {
    const f = await fixture(), caller = new AbortController()
    let entered!: () => void; const submitting = new Promise<void>(resolve => { entered = resolve })
    f.cli.call.mockImplementation(async (_operation, _wire, signal: AbortSignal) => {
      entered()
      await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    })
    const pending = f.runtime.execute('generate_video', { prompt: 'wind', model: 'MiniMax-H3', duration: 4 }, exec(caller.signal))
    const rejected = expect(pending).rejects.toThrow()
    await submitting
    if (reason === 'caller') caller.abort(); else await f.runtime.dispose()
    await rejected
    const [saved] = [...f.rows.values()]
    expect(saved.status).toBe('uncertain'); expect(saved.taskId).toBeUndefined()
    const result = await f.recreate().execute('recover_media', { jobId: saved.id }, exec())
    expect(result.status).toBe('uncertain'); expect(result.files).toEqual([]); expect(f.cli.call).toHaveBeenCalledOnce()
  })
  it('does not create a replacement for a receipt lacking a confirmed video task ID', async () => {
    const f = await fixture(), job = receipt(f.root); delete job.taskId; job.status = 'uncertain'; await f.jobs.put(job)
    expect((await f.runtime.execute('recover_media', { jobId: job.id }, exec())).status).toBe('uncertain')
    expect(f.cli.call).not.toHaveBeenCalled()
  })
  it('prevents overlapping recovery of one job from starting duplicate provider queries', async () => {
    const f = await fixture(), job = receipt(f.root); await f.jobs.put(job)
    let release!: () => void, entered!: () => void
    const queried = new Promise<void>(resolve => { entered = resolve })
    f.cli.call.mockImplementation(async () => { entered(); await new Promise<void>(resolve => { release = resolve }); return { task_id: job.taskId, status: 'running' } })
    const first = f.runtime.execute('video_status', { jobId: job.id }, exec()); await queried
    await expect(f.runtime.execute('recover_media', { jobId: job.id }, exec())).rejects.toMatchObject({ code: 'busy' })
    release(); expect((await first).status).toBe('pending'); expect(f.cli.call).toHaveBeenCalledOnce()
  })
})
