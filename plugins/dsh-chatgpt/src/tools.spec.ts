import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, readFile, mkdir, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { executeCapability, registerTools, workspaceFile, recoverMedia, mediaJobs, type ToolHost } from './tools.ts'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'

const roots: string[] = []
async function workspace() { const root = await mkdtemp(join(tmpdir(), 'chatgpt-tools-test-')); roots.push(root); return root }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=', 'base64')
function host(root: string, mode = 'workspace-write') {
  const registered: ToolDefinition[] = []
  const value = {
    tools: { register: (tool: ToolDefinition) => { registered.push(tool) } },
    sandboxPolicy: { resolve: () => ({ workspaceRoot: root, mode }) },
    attachments: {
      validateImage: vi.fn(async () => {}),
      saveImages: vi.fn(async (inputs: unknown[]) => inputs.map((_, i) => ({ attachmentId: `saved-${i}`, mediaType: 'image/png', bytes: image.length, width: 1, height: 1 }))),
      readImage: vi.fn(async (ref: unknown) => ({ data: image, ref })),
    },
  } as unknown as ToolHost
  return { value, registered }
}
function exec(signal = new AbortController().signal) { return { signal } as ToolRunContext }

describe('DSH capability tools', () => {
  it('registers six eager model-visible tools with clear image/search triggers', async () => {
    const { value, registered } = host(await workspace())
    registerTools(value, vi.fn())
    expect(registered.map(tool => tool.name)).toEqual(['chatgpt_search', 'chatgpt_generate_image', 'chatgpt_edit_image', 'chatgpt_view_image', 'chatgpt_media_jobs', 'chatgpt_recover_media'])
    expect(registered.every(tool => !tool.deferLoading)).toBe(true)
    expect(registered[1].description).toContain('用户要求画图或生图')
    expect(registered[0].parameters.properties).not.toHaveProperty('images')
    expect(registered[0].parameters.properties).not.toHaveProperty('attachmentIds')
    expect(registered[3].parameters.properties).toHaveProperty('images')
  })
  it('rejects writes in a read-only session before dispatch', async () => {
    const root = await workspace(), { value } = host(root, 'read-only'), run = vi.fn()
    await expect(executeCapability(value, run, 'image', { prompt: 'draw a tree' }, exec())).rejects.toMatchObject({ code: 'read-only' })
    expect(run).not.toHaveBeenCalled()
  })
  it('stages local references without exposing the workspace or altering originals', async () => {
    const root = await workspace(), { value } = host(root)
    await writeFile(join(root, 'reference.png'), image)
    const result = await executeCapability(value, async (request, cwd) => {
      expect(cwd).not.toBe(root)
      expect(await readFile(request.images![0])).toEqual(image)
      await mkdir(join(cwd, 'generated'))
      await writeFile(join(cwd, 'generated', 'image.png'), image)
      return { id: 'one', mode: 'edit', answer: 'Edited.', images: [{ path: 'generated/image.png', mediaType: 'image/png' }], sources: [], searchCount: 0, elapsedMs: 10 }
    }, 'edit', { prompt: 'edit background', images: ['reference.png'] }, exec())
    expect(await readFile(join(root, 'reference.png'))).toEqual(image)
    expect(await readFile(join(root, result.images[0].path))).toEqual(image)
    expect(result.attachments[0].attachmentId).toBe('saved-0')
  })
  it('cannot read a sibling file or use another session attachment', async () => {
    const root = await workspace(), outside = await workspace()
    await writeFile(join(outside, 'private.png'), image)
    await expect(workspaceFile(root, join(outside, 'private.png'))).rejects.toMatchObject({ code: 'outside-workspace' })
    const { value } = host(root)
    value.get = () => ({ observeSession: async () => ({ [Symbol.dispose]() {}, events: [] }) })
    const run = vi.fn()
    await expect(executeCapability(value, run, 'vision', { prompt: 'describe', attachmentIds: ['foreign'] }, { ...exec(), agent: { session: { id: 'current' } } } as any)).rejects.toMatchObject({ code: 'unknown-attachment' })
    expect(run).not.toHaveBeenCalled()
  })
  it('uses an explicitly selected image from the current session', async () => {
    const root = await workspace(), { value } = host(root)
    const ref = { attachmentId: 'current-image', mediaType: 'image/png', bytes: image.length, width: 1, height: 1 }
    value.get = () => ({ observeSession: async () => ({ [Symbol.dispose]() {}, events: [{ type: 'user/message', data: { content: [{ type: 'image', attachment: ref }] } }] }) })
    const result = await executeCapability(value, async (request, cwd) => {
      expect(await readFile(request.images![0])).toEqual(image)
      return { id: 'vision', mode: 'vision', answer: 'White pixel', images: [], sources: [], searchCount: 0, elapsedMs: 1 }
    }, 'vision', { prompt: 'describe', attachmentIds: ['current-image'] }, { ...exec(), agent: { session: { id: 'current' } } } as any)
    expect(result.answer).toBe('White pixel')
  })
  it('recognizes generated images in native tool-result event data', async () => {
    const root = await workspace(), { value } = host(root)
    const ref = { attachmentId: 'generated-image', mediaType: 'image/png', bytes: image.length, width: 1, height: 1 }
    value.get = () => ({ observeSession: async () => ({ [Symbol.dispose]() {}, events: [{ type: 'tool/result', data: { message: { content: [{ type: 'image', attachment: ref }] } } }] }) })
    await executeCapability(value, async () => ({ id: 'read', mode: 'vision', answer: 'recognized', images: [], sources: [], searchCount: 0, elapsedMs: 1 }), 'vision', { prompt: 'describe', attachmentIds: ['generated-image'] }, { ...exec(), agent: { session: { id: 'current' } } } as any)
    expect(value.attachments.readImage).toHaveBeenCalledWith(ref, expect.any(AbortSignal))
  })
  it('recovers attachment publication failure without generating again and rejects another workspace', async () => {
    const root = await workspace(), { value } = host(root)
    vi.mocked(value.attachments.saveImages).mockRejectedValueOnce(new Error('store unavailable'))
    const run = vi.fn(async (_request, cwd) => {
      await writeFile(join(cwd, 'output.png'), image)
      return { id: 'generated', mode: 'image' as const, answer: 'done', images: [{ path: 'output.png', mediaType: 'image/png' }], sources: [], searchCount: 0, elapsedMs: 1 }
    })
    await expect(executeCapability(value, run, 'image', { prompt: 'draw' }, exec())).rejects.toMatchObject({ code: 'media-recoverable' })
    const jobs = await mediaJobs(value, exec()), recovered = await recoverMedia(value, jobs[0].jobId, exec())
    expect(recovered.attachments).toHaveLength(1)
    expect(await readFile(join(root, recovered.images[0].path))).toEqual(image)
    expect(run).toHaveBeenCalledTimes(1)
    await expect(recoverMedia(host(await workspace()).value, jobs[0].jobId, exec())).rejects.toThrow()
  })
  it('keeps a native result receipt when the first workspace copy fails and only recovers existing files', async () => {
    const root = await workspace(), { value } = host(root)
    const run = vi.fn(async request => { await request.onGenerated!([{ path: 'native-generated.png', mediaType: 'image/png' }]); throw new Error('copy failed') })
    await expect(executeCapability(value, run, 'image', { prompt: 'draw' }, exec())).rejects.toMatchObject({ code: 'media-recoverable' })
    const [job] = await mediaJobs(value, exec()), copy = vi.fn(async (_images, directory) => {
      await writeFile(join(directory, 'recovered.png'), image)
      return { id: 'recovered', mode: 'image' as const, answer: 'saved', images: [{ path: 'recovered.png', mediaType: 'image/png' }], sources: [], searchCount: 0, elapsedMs: 0 }
    })
    expect((await recoverMedia(value, job.jobId, exec(), copy)).attachments).toHaveLength(1)
    expect(copy).toHaveBeenCalledTimes(1); expect(run).toHaveBeenCalledTimes(1)
  })
  it('serializes recovery of the same workspace receipt and releases the lock after failure', async () => {
    const root = await workspace(), { value } = host(root)
    const run = vi.fn(async request => { await request.onGenerated!([{ path: 'native.png', mediaType: 'image/png' }]); throw new Error('copy failed') })
    await expect(executeCapability(value, run, 'image', { prompt: 'draw' }, exec())).rejects.toThrow()
    const [job] = await mediaJobs(value, exec())
    let reject!: (error: Error) => void, started!: () => void
    const entered = new Promise<void>(resolve => { started = resolve })
    const waiting = recoverMedia(value, job.jobId, exec(), async () => { started(); return new Promise((_resolve, fail) => { reject = fail }) })
    const outcome = waiting.catch(error => error)
    await entered
    await expect(recoverMedia(value, job.jobId, exec())).rejects.toMatchObject({ code: 'busy' })
    reject(new Error('copy unavailable')); await outcome
    await expect(recoverMedia(value, job.jobId, exec())).rejects.toMatchObject({ code: 'result-unavailable' })
  })
  it('disposes raw-log observations on cancellation and retains historical attachment authorization', async () => {
    const root = await workspace(), { value } = host(root), controller = new AbortController(), dispose = vi.fn()
    const ref = { attachmentId: 'old', mediaType: 'image/png', bytes: image.length, width: 1, height: 1 }
    value.get = () => ({ observeSession: async (_id: unknown, options: any) => {
      expect(options).toEqual({ signal: controller.signal, projectionMode: 'none' })
      return { events: [{ type: 'user/message', data: { content: [{ type: 'image', attachment: ref }] } }], [Symbol.dispose]: dispose }
    } })
    const context = { ...exec(controller.signal), agent: { session: { id: 'current' } } } as any
    await executeCapability(value, async () => ({ id: 'vision', mode: 'vision', answer: 'historical', images: [], sources: [], searchCount: 0, elapsedMs: 1 }), 'vision', { prompt: 'read', attachmentIds: ['old'] }, context)
    expect(dispose).toHaveBeenCalledTimes(1)
    value.get = () => ({ observeSession: async () => { controller.abort(); return { events: [], [Symbol.dispose]: dispose } } })
    await expect(executeCapability(value, vi.fn(), 'vision', { prompt: 'read', attachmentIds: ['old'] }, context)).rejects.toThrow()
    expect(dispose).toHaveBeenCalledTimes(2)
  })
  it('does not publish a late result after cancellation', async () => {
    const root = await workspace(), { value } = host(root), abort = new AbortController()
    await expect(executeCapability(value, async () => {
      abort.abort()
      return { id: 'late', mode: 'image', answer: 'done', images: [], sources: [], searchCount: 0, elapsedMs: 1 }
    }, 'image', { prompt: 'draw' }, exec(abort.signal))).rejects.toThrow()
    expect(await mediaJobs(value, exec())).toHaveLength(1)
    expect(value.attachments.saveImages).not.toHaveBeenCalled()
  })
})
