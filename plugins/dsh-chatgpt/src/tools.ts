import { mkdtemp, readFile, realpath, lstat, writeFile, rm } from 'node:fs/promises'
import { basename, join, relative, resolve, sep, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { AttachmentStore, ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import { ChatGptError, MODES, type Capability, type Request, type Result } from './contracts.ts'
import { confinedPath, jobDirectory, readReceipt, writeReceipt, mediaWorkspace } from '@klarkxy/dsh-plugin-kit/cli-media'
import { readdir } from 'node:fs/promises'

export type ToolHost = {
  tools: { register(tool: ToolDefinition): unknown }
  sandboxPolicy: SandboxPolicyService
  attachments: AttachmentStore
  get?(name: string): unknown
}
export type PublishedResult = Result & { attachments: ImageAttachmentRef[]; jobId?: string }
type Receipt = { version: 1; jobId: string; createdAt: number; state: 'started' | 'completed'; result?: Result; nativeImages?: { path: string; mediaType: string }[] }
export type RecoverNative = (images: { path: string; mediaType: string }[], directory: string, signal: AbortSignal) => Promise<Result>
const SLUG = 'dsh-chatgpt'
const activeJobs = new Set<string>()
type Run = (request: Request, workspace: string, signal: AbortSignal) => Promise<Result>
const IMAGE_LIMIT = 20 * 1024 * 1024

export function inside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}
export async function workspaceFile(root: string, input: string): Promise<string> {
  const base = await realpath(root)
  const path = resolve(base, input)
  if (!inside(base, path) || !inside(base, await realpath(path)) || (await lstat(path)).isSymbolicLink()) {
    throw new ChatGptError('outside-workspace', '图片必须是当前工作区中的普通文件。')
  }
  const info = await lstat(path)
  if (!info.isFile() || info.size > IMAGE_LIMIT) throw new ChatGptError('invalid-image', '图片文件无效或超过 20 MB。')
  return path
}

async function selectedAttachments(host: ToolHost, ids: string[], exec: ToolRunContext, signal: AbortSignal): Promise<ImageAttachmentRef[]> {
  if (!ids.length) return []
  if (!exec.agent) throw new ChatGptError('no-session', '会话图片需要当前会话。')
  const query = host.get?.('sessionQuery') as { observeSession(id: unknown, options: { signal: AbortSignal; projectionMode: 'none' }): Promise<{ events: readonly unknown[]; [Symbol.dispose](): void }> } | undefined
  if (!query) throw new ChatGptError('no-session-query', '宿主未提供会话图片读取服务。')
  const snapshot = await query.observeSession(exec.agent.session.id, { signal, projectionMode: 'none' })
  try {
    signal.throwIfAborted()
    const refs = new Map<string, ImageAttachmentRef>()
    for (const raw of snapshot.events) {
      const event = raw as { type?: string; data?: { content?: unknown; message?: { content?: unknown } } }
      if (!['user/message', 'tool/result'].includes(event.type ?? '')) continue
      const content = event.data?.content ?? event.data?.message?.content
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (block?.type === 'image' && block.attachment?.attachmentId) refs.set(block.attachment.attachmentId, block.attachment)
      }
    }
    return ids.map(id => {
      const ref = refs.get(id)
      if (!ref) throw new ChatGptError('unknown-attachment', '图片不属于当前会话；请使用会话中的图片标识。')
      return ref
    })
  } finally { snapshot[Symbol.dispose]() }
}

/** Explicit tool calls may originate from child agents; no global hook creates auxiliary work. */
export async function executeCapability(host: ToolHost, run: Run, mode: Capability,
  args: { prompt: string; images?: string[]; attachmentIds?: string[] }, exec: ToolRunContext): Promise<PublishedResult> {
  const signal = exec.signal
  signal.throwIfAborted()
  if (!MODES.includes(mode)) throw new ChatGptError('bad-request', '不支持此请求模式。')
  if (!args.prompt.trim() || args.prompt.length > 100_000) throw new ChatGptError('bad-request', '请求内容不能为空或超过 100,000 字符。')
  const images = args.images ?? [], ids = args.attachmentIds ?? []
  if (images.length + ids.length > 5) throw new ChatGptError('bad-request', '每次最多使用五张图片。')
  if (mode === 'search' && images.length + ids.length) throw new ChatGptError('bad-request', '此工具不接受图片。')
  if (['edit', 'vision'].includes(mode) && !images.length && !ids.length) throw new ChatGptError('bad-request', '请指定要使用的图片。')
  const policy = host.sandboxPolicy.resolve({ session: exec.agent?.session })
  const root = await realpath(policy.workspaceRoot)
  if (['image', 'edit'].includes(mode) && policy.mode === 'read-only') throw new ChatGptError('read-only', '生成图片需要当前会话允许写入工作区。')
  const refs = await selectedAttachments(host, ids, exec, signal)
  const media = mode === 'image' || mode === 'edit'
  const job = media ? await jobDirectory(root, SLUG) : undefined
  const temp = job?.directory ?? await mkdtemp(join(tmpdir(), 'dsh-chatgpt-input-'))
  if (job) await writeReceipt(temp, { version: 1, jobId: job.id, createdAt: Date.now(), state: 'started' } satisfies Receipt)
  const jobKey = job ? `${root}\0${job.id}` : undefined
  if (jobKey) activeJobs.add(jobKey)
  try {
    const staged: string[] = []
    for (const path of images) {
      signal.throwIfAborted()
      const file = await workspaceFile(root, path)
      const target = join(temp, `${staged.length}-${basename(file)}`)
      await writeFile(target, await readFile(file), { flag: 'wx' }); staged.push(target)
    }
    for (const ref of refs) {
      const stored = await host.attachments.readImage(ref, signal)
      signal.throwIfAborted()
      if (stored.data.byteLength > IMAGE_LIMIT) throw new ChatGptError('invalid-image', '图片超过 20 MB。')
      const target = join(temp, `${staged.length}.${ref.mediaType.split('/')[1]}`)
      await writeFile(target, stored.data, { flag: 'wx' }); staged.push(target)
    }
    const result = await run({ mode, prompt: args.prompt, images: staged, ...(job ? { onGenerated: async (nativeImages: { path: string; mediaType: string }[]) => { await writeReceipt(temp, { version: 1, jobId: job.id, createdAt: Date.now(), state: 'started', nativeImages } satisfies Receipt) } } : {}) }, temp, signal)
    // Retain successful native results before any cancellable attachment publication.
    if (job) await writeReceipt(temp, { version: 1, jobId: job.id, createdAt: Date.now(), state: 'completed', result } satisfies Receipt)
    signal.throwIfAborted()
    if (result.images.length && !['image', 'edit'].includes(mode)) throw new ChatGptError('unexpected-image', '此调用返回了非请求的图片结果。')
    return await publishResult(host, result, temp, root, signal, job?.id)
  } catch (cause) {
    if (job) throw new ChatGptError(signal.aborted ? 'cancelled' : cause instanceof ChatGptError ? cause.code : 'media-recoverable', `${cause instanceof ChatGptError ? cause.message + ' ' : ''}本次媒体任务 ${job.id} 已记录；请先用 chatgpt_recover_media 检查已有结果，勿重复生成。`)
    throw cause
  } finally {
    if (jobKey) activeJobs.delete(jobKey)
    // Media jobs retain native output for recovery; ordinary read-only calls own only their temp directory.
    if (!job) await rm(temp, { recursive: true, force: true })
  }
}

async function publishResult(host: ToolHost, result: Result, directory: string, root: string, signal: AbortSignal, jobId?: string): Promise<PublishedResult> {
  const payloads = await Promise.all(result.images.map(async image => {
    const path = await confinedPath(directory, image.path)
    await workspaceFile(directory, path)
    return { data: await readFile(path), mediaType: image.mediaType as ImageMediaType, name: basename(path) }
  }))
  await Promise.all(payloads.map(input => host.attachments.validateImage(input)))
  signal.throwIfAborted()
  const attachments = payloads.length ? [...await host.attachments.saveImages(payloads)] : []
  signal.throwIfAborted()
  return { ...result, ...(jobId ? { jobId } : {}), images: result.images.map(image => ({ ...image, path: relative(root, resolve(directory, image.path)).split(sep).join('/') })), attachments }
}
const recovering = new Set<string>()
export async function recoverMedia(host: ToolHost, jobId: string, exec: ToolRunContext, recoverNative?: RecoverNative): Promise<PublishedResult> {
  const root = await mediaWorkspace(host, exec, true), key = `${root}\0${jobId}`
  if (recovering.has(key) || activeJobs.has(key)) throw new ChatGptError('busy', '此媒体任务正在恢复，请等待当前调用完成。')
  recovering.add(key)
  try { return await recoverMediaJob(host, root, jobId, exec, recoverNative) } finally { recovering.delete(key) }
}
async function recoverMediaJob(host: ToolHost, root: string, jobId: string, exec: ToolRunContext, recoverNative?: RecoverNative): Promise<PublishedResult> {
  const receipt = await readReceipt<Receipt>(root, SLUG, jobId)
  exec.signal.throwIfAborted()
  if (receipt.version !== 1 || receipt.jobId !== jobId) throw new ChatGptError('invalid-receipt', '媒体任务记录无效。')
  const directory = await confinedPath(root, join(root, `.${SLUG}`, jobId))
  if (!receipt.result && receipt.nativeImages?.length && recoverNative) {
    receipt.result = await recoverNative(receipt.nativeImages, directory, exec.signal)
    receipt.state = 'completed'
    await writeReceipt(directory, receipt)
  }
  if (receipt.state !== 'completed' || !receipt.result || !Array.isArray(receipt.result.images) || receipt.result.images.length > 20) throw new ChatGptError('result-unavailable', '此任务未记录完整结果；不会重新提交生成请求。')
  return publishResult(host, receipt.result, directory, root, exec.signal, jobId)
}
export async function mediaJobs(host: ToolHost, exec: ToolRunContext): Promise<{ jobId: string; state: string; createdAt: number }[]> {
  const root = await mediaWorkspace(host, exec, false), jobs = []
  let entries: string[]
  try { entries = await readdir(await confinedPath(root, join(root, `.${SLUG}`))) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  for (const id of entries) {
    exec.signal.throwIfAborted()
    try { const receipt = await readReceipt<Receipt>(root, SLUG, id); if (receipt.version === 1 && receipt.jobId === id) jobs.push({ jobId: id, state: receipt.state, createdAt: receipt.createdAt }) } catch { exec.signal.throwIfAborted() }
  }
  return jobs.sort((a, b) => b.createdAt - a.createdAt).slice(0, 50)
}

const DEFINITIONS: { mode: Capability; name: string; description: string }[] = [
  { mode: 'search', name: 'chatgpt_search', description: '搜索最新公开网页资料并返回来源链接。需要联网核实、查找资料或引用来源时使用；通过本机官方 Codex 的原生搜索执行。' },
  { mode: 'image', name: 'chatgpt_generate_image', description: '通过本机 Codex 生成并保存图片，可使用参考图。用户要求画图或生图时使用；取消或交付失败后先恢复已有任务，勿重复生成。' },
  { mode: 'edit', name: 'chatgpt_edit_image', description: '通过本机 Codex 修改指定图片并保留原图。说明目标和修改要求；取消或交付失败后先恢复已有任务，勿重复生成。' },
  { mode: 'vision', name: 'chatgpt_view_image', description: '查看和分析工作区图片或当前会话附件。识别图片内容、读取截图文字、比较参考图时使用；通过本机官方 Codex 执行。' },
]
export function registerTools(host: ToolHost, run: Run, lifetime?: AbortSignal, recoverNative?: RecoverNative): void {
  for (const spec of DEFINITIONS) host.tools.register(defineTool({
    name: spec.name, description: spec.description,
    parameters: {
      prompt: { type: 'string', required: true, description: '任务内容。生图和编辑时说明画面、文字、风格及需要保留的内容。' },
      ...(spec.mode === 'search' ? {} : {
        images: { type: 'array' as const, items: { type: 'string' as const }, description: '当前工作区内的图片路径，最多五张。' },
        attachmentIds: { type: 'array' as const, items: { type: 'string' as const }, description: '当前会话中图片附件的标识；只能使用会话已有的真实标识。' },
      }),
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_args, value) {
        const result = value as unknown as PublishedResult
        const text = [result.jobId ? `jobId: ${result.jobId}` : '', result.answer, ...result.images.map(image => `图片已保存：${image.path}`), ...result.sources.map(source => `${source.title ?? source.url}: ${source.url}`)].filter(Boolean).join('\n')
        return [{ type: 'text' as const, text }, ...result.attachments.map(attachment => ({ type: 'image' as const, attachment }))]
      },
    },
    timeoutMs: 1_800_000,
    isConcurrencySafe() { return true },
    execute: (args, exec) => executeCapability(host, run, spec.mode, args, lifetime ? { ...exec, signal: AbortSignal.any([exec.signal, lifetime]) } : exec) as Promise<any>,
  }))
  host.tools.register(defineTool({
    name: 'chatgpt_media_jobs', description: '列出当前工作区最近的 ChatGPT 媒体任务和 jobId，供取消或发布失败后恢复。',
    parameters: {}, output: { schema: { type: 'array', items: { type: 'object', additionalProperties: true } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    isConcurrencySafe() { return true }, execute: (_args, exec) => mediaJobs(host, lifetime ? { ...exec, signal: AbortSignal.any([exec.signal, lifetime]) } : exec) as Promise<any>,
  }))
  host.tools.register(defineTool({
    name: 'chatgpt_recover_media', description: '取回已有 ChatGPT 媒体任务的本地图片并返回附件；不会再次生成。',
    parameters: { jobId: { type: 'string', required: true, description: '生成结果或 chatgpt_media_jobs 返回的任务标识。' } },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => { const result = value as unknown as PublishedResult; return [{ type: 'text', text: result.images.map(image => image.path).join('\n') }, ...result.attachments.map(attachment => ({ type: 'image' as const, attachment }))] } },
    isConcurrencySafe() { return true }, execute: (args, exec) => recoverMedia(host, args.jobId, lifetime ? { ...exec, signal: AbortSignal.any([exec.signal, lifetime]) } : exec, recoverNative) as Promise<any>,
  }))
}
