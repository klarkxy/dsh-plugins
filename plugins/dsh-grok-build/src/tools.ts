import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { defineTool, type ParameterSchemaSpec, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { confinedPath, jobDirectory, mediaWorkspace, publishMedia, stageMedia, type MediaHost, type MediaInput, type PublishedMedia } from '@klarkxy/dsh-plugin-kit/cli-media'
import { CAPABILITIES, GrokBuildError, type Capability } from './contracts.ts'
import { recoverPrivateFiles, removePrivateSession, type GrokRuntime, type SavedFile } from './runtime.ts'

export type ToolHost = MediaHost & { tools: { register(tool: ToolDefinition): unknown } }
export const jobSchema = z.object({
  id: z.string().uuid(), workspace: z.string().max(4096), directory: z.string().max(4096), capability: z.enum(CAPABILITIES),
  createdAt: z.string(), updatedAt: z.string(), state: z.enum(['prepared', 'submitting', 'completed', 'uncertain', 'failed']),
  privateSession: z.object({ home: z.string().max(4096), sessionId: z.string().uuid() }).strict().optional(),
  files: z.array(z.object({ source: z.string().max(4096), name: z.string().max(200), kind: z.enum(['image', 'video']), mediaType: z.string().max(100), bytes: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(40),
  error: z.object({ code: z.string().max(100), message: z.string().max(500) }).strict().optional(),
}).strict()
export type MediaJob = z.infer<typeof jobSchema>
export interface JobStore { get(id: string): Promise<MediaJob | undefined>; put(job: MediaJob): Promise<void>; list(workspace: string): Promise<MediaJob[]> }
export type Result = { answer: string; sources: { url: string }[]; files: PublishedMedia[]; state: string; jobId?: string; error?: { code: string; message: string }; jobs?: { jobId: string; capability: Capability; state: string; createdAt: string; files: number }[] }
const SLUG = 'dsh-grok-build'
export const TOOL_SPECS = [
  { capability: 'search', name: 'grok_search', description: '搜索最新公开网页并返回原生搜索正文和来源链接。' },
  { capability: 'fetch', name: 'grok_fetch', description: '抓取指定公开网页并返回原生页面正文。prompt 中应提供目标网址。' },
  { capability: 'generate_image', name: 'grok_generate_image', description: '用本机官方 Grok Build 实际生成图片并返回图片附件和 jobId。取消或超时后先查询任务，不要重复提交。' },
  { capability: 'edit_image', name: 'grok_edit_image', description: '编辑指定图片并返回图片附件。只接受工作区路径或当前会话附件；须先在插件设置中允许原生媒体文件访问。' },
  { capability: 'image_to_video', name: 'grok_image_to_video', description: '用一张指定图片生成视频并返回视频附件和 jobId。须允许原生媒体文件访问；取消或超时后不要重复提交。' },
  { capability: 'reference_to_video', name: 'grok_reference_to_video', description: '按参考图、首尾帧、关键帧或预设音色生成视频并返回附件和 jobId。支持 1–15 秒、480p/720p；须允许原生媒体文件访问。取消后不要重复提交。' },
] as const
const referenceSchema = z.object({ path: z.string().min(1).max(4096).optional(), attachmentId: z.string().min(1).max(200).optional() }).strict().refine(value => Boolean(value.path) !== Boolean(value.attachmentId), 'Provide one path or attachmentId.')
const RATIOS = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9', '9:21', '1:2', '2:1'] as const
const argsSchema = z.object({
  prompt: z.string().trim().min(1).max(100_000), paths: z.array(z.string().min(1).max(4096)).max(40).default([]), attachmentIds: z.array(z.string().min(1).max(200)).max(40).default([]),
  image: referenceSchema.optional(), images: z.array(referenceSchema).max(40).default([]),
  firstFrame: referenceSchema.optional(), lastFrame: referenceSchema.optional(),
  keyframes: z.array(z.object({ image: referenceSchema, timestampS: z.number().finite().positive() }).strict()).max(4).default([]),
  voices: z.array(z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/)).max(3).default([]),
  duration: z.number().int().min(1).max(15).optional(), resolutionName: z.enum(['480p', '720p']).optional(), aspectRatio: z.enum(RATIOS).optional(),
}).strict()
type Args = z.infer<typeof argsSchema>
function inputPlan(operation: Capability, args: Args): { inputs: MediaInput[]; native: (paths: string[]) => Record<string, unknown> } {
  const images = [...args.paths.map(path => ({ path })), ...args.attachmentIds.map(attachmentId => ({ attachmentId })), ...args.images, ...(args.image ? [args.image] : [])]
  const fail = (message: string): never => { throw new GrokBuildError('bad-request', message) }
  const isVideo = operation.endsWith('video'), reference = operation === 'reference_to_video'
  if (!inputCapabilities.has(operation) && images.length) fail('此工具不接受媒体输入。')
  if (!reference && (args.firstFrame || args.lastFrame || args.keyframes.length || args.voices.length)) fail('首尾帧、关键帧和预设音色仅用于参考视频。')
  if (!isVideo && (args.duration !== undefined || args.resolutionName !== undefined)) fail('时长和视频分辨率仅用于视频工具。')
  if ((operation === 'search' || operation === 'fetch' || operation === 'image_to_video') && args.aspectRatio !== undefined) fail('此工具不接受画面比例选项。')
  if (operation === 'image_to_video' && (images.length !== 1 || (args.duration !== undefined && ![6, 10].includes(args.duration)))) fail('图生视频须提供一张图片，时长为 6 或 10 秒。')
  if (operation === 'edit_image' && !images.length) fail('请提供工作区图片路径或当前会话附件。')
  if (reference && images.length > 14) fail('参考视频最多使用十四张参考图片。')
  if (reference && !images.length && !args.firstFrame && !args.lastFrame && !args.keyframes.length && !args.voices.length) fail('参考视频需要图片、首尾帧、关键帧或预设音色中的至少一项。')
  if (reference && args.aspectRatio && !['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'].includes(args.aspectRatio)) fail('参考视频不支持此画面比例。')
  const duration = args.duration ?? 6
  if (args.keyframes.some(frame => frame.timestampS >= duration)) fail('关键帧时间须严格位于视频首尾之间。')
  const times = args.keyframes.map(frame => frame.timestampS).sort((a, b) => a - b)
  if (times.some((time, index) => index > 0 && time - times[index - 1] < 1 / 3 - 1e-7)) fail('关键帧之间须至少相隔三分之一秒。')
  const references = [...images, ...(args.firstFrame ? [args.firstFrame] : []), ...(args.lastFrame ? [args.lastFrame] : []), ...args.keyframes.map(frame => frame.image)]
  return { inputs: references.map(input => ({ ...input, kind: 'image' })), native(paths) {
    let index = images.length
    if (reference) return { images: paths.slice(0, images.length), ...(args.firstFrame ? { first_frame: paths[index++] } : {}), ...(args.lastFrame ? { last_frame: paths[index++] } : {}), keyframes: args.keyframes.map(frame => ({ image: paths[index++], timestamp_s: frame.timestampS })), voices: args.voices, duration, resolution_name: args.resolutionName ?? '480p', aspect_ratio: args.aspectRatio ?? '16:9' }
    if (operation === 'image_to_video') return { image: paths[0], duration, resolution_name: args.resolutionName ?? '480p' }
    if (operation === 'edit_image') return { image: paths, aspect_ratio: args.aspectRatio ?? 'auto' }
    if (operation === 'generate_image') return { aspect_ratio: args.aspectRatio ?? 'auto' }
    return {}
  } }
}
const inputCapabilities = new Set<Capability>(['edit_image', 'image_to_video', 'reference_to_video'])

export class GrokOperations {
  private readonly active = new Set<string>()
  constructor(private readonly host: ToolHost, private readonly runtime: () => Pick<GrokRuntime, 'run'>, private readonly jobs: JobStore, private readonly settings: () => { allowNativeMediaFiles: boolean }) {}
  async execute(operation: Capability | 'recover_media' | 'media_jobs', raw: unknown, exec: ToolRunContext): Promise<Result> {
    exec.signal.throwIfAborted()
    if (operation === 'media_jobs') return this.list(exec)
    if (operation === 'recover_media') return this.recover(z.object({ jobId: z.string().uuid() }).strict().parse(raw).jobId, exec)
    const args = argsSchema.parse(raw), plan = inputPlan(operation, args), inputs = plan.inputs
    if (inputCapabilities.has(operation) && !this.settings().allowNativeMediaFiles) throw new GrokBuildError('native-media-disabled', '请先在插件设置中允许 Grok 原生媒体文件访问。')
    const media = operation !== 'search' && operation !== 'fetch', workspace = await mediaWorkspace(this.host, exec, media)
    if (!media) return { ...(await this.runtime().run({ capability: operation, prompt: args.prompt, inputs: [], jobId: randomUUID(), jobDirectory: '', workspace }, exec.signal)), files: [] }
    const directory = await jobDirectory(workspace, SLUG), staging = join(directory.directory, 'inputs')
    await mkdir(staging); await confinedPath(workspace, staging)
    let job: MediaJob = { id: directory.id, workspace, directory: directory.directory, capability: operation, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), state: 'prepared', files: [] }
    const save = async () => { job.updatedAt = new Date().toISOString(); await this.jobs.put(job) }
    this.active.add(job.id)
    try {
      const staged = await stageMedia(this.host, exec, workspace, staging, inputs)
      await save()
      const outcome = await this.runtime().run({ capability: operation, prompt: args.prompt, inputs: staged.map(file => ({ path: file.path, kind: 'image' })), nativeInput: plan.native(staged.map(file => file.path)), jobId: job.id, jobDirectory: job.directory, workspace,
        onPrepared: async session => { job.privateSession = session; await save() },
        onStarted: async () => { job.state = 'submitting'; await save() },
        onFile: async file => { await this.addFile(job, file); await save() },
      }, exec.signal)
      job.state = outcome.state; job.error = outcome.error; await save()
      const files: PublishedMedia[] = []
      if (!exec.signal.aborted) {
        for (const file of job.files) {
          try { files.push(await this.publish(job, file, exec)) } catch { job.state = 'uncertain'; job.error = { code: 'attachment-failed', message: '文件已保存，附件返回失败；请用 jobId 恢复。' }; await save(); break }
        }
      }
      return { answer: outcome.answer, sources: outcome.sources, files, state: job.state, jobId: job.id, ...(job.error ? { error: job.error } : {}) }
    } catch (cause) {
      job.state = job.state === 'submitting' ? 'uncertain' : 'failed'
      job.error = { code: cause instanceof GrokBuildError ? cause.code : 'failed', message: cause instanceof GrokBuildError ? cause.message : '任务未完成；不要重复提交结果不确定的任务。' }
      await save()
      if (job.state === 'uncertain') return { answer: '', sources: [], files: [], state: job.state, jobId: job.id, error: job.error }
      throw cause
    } finally {
      this.active.delete(job.id)
      await confinedPath(workspace, staging); await rm(staging, { recursive: true, force: true })
    }
  }
  private async addFile(job: MediaJob, file: SavedFile): Promise<void> {
    if (job.files.some(saved => saved.source === file.source)) return
    if (file.kind !== 'image' && file.kind !== 'video') throw new GrokBuildError('invalid-media', '不支持的输出类型。')
    const source = await confinedPath(job.directory, file.source), sha256 = createHash('sha256').update(await readFile(source)).digest('hex')
    job.files.push({ ...file, source, kind: file.kind, sha256 })
  }
  private async publish(job: MediaJob, file: MediaJob['files'][number], exec: ToolRunContext): Promise<PublishedMedia> {
    await confinedPath(job.workspace, job.directory)
    const source = await confinedPath(job.directory, file.source)
    if (createHash('sha256').update(await readFile(source)).digest('hex') !== file.sha256) throw new GrokBuildError('integrity', '已记录的媒体文件发生变化。')
    return publishMedia(this.host, source, job.workspace, job.directory, job.workspace, file.kind, exec.signal)
  }
  private async recover(id: string, exec: ToolRunContext): Promise<Result> {
    const workspace = await mediaWorkspace(this.host, exec, false), job = await this.jobs.get(id)
    if (!job || job.workspace !== workspace) throw new GrokBuildError('not-found', '当前工作区没有此媒体任务。')
    if (this.active.has(id)) throw new GrokBuildError('busy', '媒体任务仍在运行。')
    this.active.add(id)
    try {
    if (job.state === 'submitting') job.state = 'uncertain'
    if (job.privateSession && job.state === 'uncertain') {
      await mediaWorkspace(this.host, exec, true); await confinedPath(workspace, job.directory)
      for (const file of await recoverPrivateFiles(job.privateSession, job.directory, job.capability)) await this.addFile(job, file)
    }
    job.updatedAt = new Date().toISOString(); await this.jobs.put(job)
    if (job.privateSession && job.files.length) {
      await removePrivateSession(job.privateSession)
      delete job.privateSession
      await this.jobs.put(job)
    }
    const files: PublishedMedia[] = []
    for (const file of job.files) files.push(await this.publish(job, file, exec))
    return { answer: files.length ? '已取回本地媒体文件。' : '尚无可恢复的本地文件。Grok 不提供本插件可用的远程查询标识；结果不确定时不要自动重做。', sources: [], files, state: job.state, jobId: job.id, ...(job.error ? { error: job.error } : {}) }
    } finally { this.active.delete(id) }
  }
  private async list(exec: ToolRunContext): Promise<Result> {
    const workspace = await mediaWorkspace(this.host, exec, false)
    const jobs = (await this.jobs.list(workspace)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50)
    return { answer: '', sources: [], files: [], state: 'completed', jobs: jobs.map(job => ({ jobId: job.id, capability: job.capability, state: job.state === 'submitting' && !this.active.has(job.id) ? 'uncertain' : job.state, createdAt: job.createdAt, files: job.files.length })) }
  }
}
export function renderResult(result: Result) {
  const text = [result.answer, result.jobId ? `jobId: ${result.jobId}; state: ${result.state}` : '', result.error?.message, ...result.files.map(file => `媒体已保存：${file.path}`), ...result.sources.map(source => source.url), result.jobs ? JSON.stringify(result.jobs) : ''].filter(Boolean).join('\n')
  return [{ type: 'text' as const, text }, ...result.files.map(file => file.attachment)]
}
export function registerTools(host: ToolHost, operations: Pick<GrokOperations, 'execute'>, ready: Promise<unknown>, lifetime: AbortSignal): void {
  const input = { type: 'object', additionalProperties: false, properties: { path: { type: 'string', description: '工作区图片路径。' }, attachmentId: { type: 'string', description: '当前会话图片附件标识，与 path 二选一。' } } } as const
  const parametersFor = (capability: Capability): ParameterSchemaSpec => {
    const parameters: ParameterSchemaSpec = { prompt: { type: 'string', required: true, description: '任务内容、目标网址或画面要求。' } }
    if (inputCapabilities.has(capability)) Object.assign(parameters, {
      paths: { type: 'array', items: { type: 'string' }, description: '工作区图片路径；可以改用结构化 image/images。' }, attachmentIds: { type: 'array', items: { type: 'string' }, description: '当前会话图片附件标识。' },
      images: { type: 'array', items: input, description: capability === 'reference_to_video' ? '最多十四张内容/风格参考图。提示词标签按 firstFrame、images、keyframes、lastFrame 的顺序从 <IMAGE_0> 编号；提供 firstFrame 时，images 第一张为 <IMAGE_1>。' : '要处理的图片。' },
    })
    if (capability === 'image_to_video') parameters.image = { ...input, description: '单张图片，与 images/paths/attachmentIds 合计必须为一张。' }
    if (capability === 'generate_image' || capability === 'edit_image' || capability === 'reference_to_video') parameters.aspectRatio = { type: 'string', enum: capability === 'reference_to_video' ? ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'] : [...RATIOS] }
    if (capability.endsWith('video')) Object.assign(parameters, { duration: { type: 'integer', description: capability === 'image_to_video' ? '6 或 10 秒，默认 6。' : '1–15 秒，默认 6。' }, resolutionName: { type: 'string', enum: ['480p', '720p'], description: '默认 480p。' } })
    if (capability === 'reference_to_video') Object.assign(parameters, {
      firstFrame: { ...input, description: '视频的精确首帧。' }, lastFrame: { ...input, description: '视频的精确末帧；可以与首帧相同来循环。' },
      keyframes: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { image: { ...input, required: true }, timestampS: { type: 'number', required: true, description: '严格位于首尾之间，关键帧彼此至少间隔三分之一秒。' } } }, description: '最多四个中间关键帧。' },
      voices: { type: 'array', items: { type: 'string' }, description: '最多三个官方预设音色标识，如 ara、eve、leo、rex；不是音频文件。可单独用于参考视频。' },
    })
    return parameters
  }
  const all: { name: string; description: string; operation: Capability | 'recover_media' | 'media_jobs'; parameters: ParameterSchemaSpec }[] = [...TOOL_SPECS.map(spec => ({ ...spec, operation: spec.capability, parameters: parametersFor(spec.capability) })),
  { name: 'grok_recover_media', description: '取回指定 jobId 的本地媒体文件，不重新提交或生成。', operation: 'recover_media' as const, parameters: { jobId: { type: 'string' as const, required: true as const, description: '已记录的媒体任务标识。' } } },
  { name: 'grok_media_jobs', description: '列出当前工作区最近的 Grok 媒体任务和 jobId。取消或重启后用于查找恢复任务。', operation: 'media_jobs' as const, parameters: {} },]
  for (const spec of all) host.tools.register(defineTool({ name: spec.name, description: spec.description, parameters: spec.parameters,
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => renderResult(value as unknown as Result) }, timeoutMs: 1_800_000, isConcurrencySafe: () => true,
    async execute(args, context) { const signal = AbortSignal.any([context.signal, lifetime]); signal.throwIfAborted(); await ready; signal.throwIfAborted(); return operations.execute(spec.operation, args, { ...context, signal }) as Promise<any> },
  }))
}
