import { mkdtemp, mkdir, readFile, realpath, lstat, writeFile, rm } from 'node:fs/promises'
import { basename, join, relative, resolve, sep, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { AttachmentStore, ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import { ChatGptError, type Capability, type Request, type Result } from './contracts.ts'

export type ToolHost = {
  tools: { register(tool: ToolDefinition): unknown }
  sandboxPolicy: SandboxPolicyService
  attachments: AttachmentStore
  get?(name: string): unknown
}
export type PublishedResult = Result & { attachments: ImageAttachmentRef[] }
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
  const query = host.get?.('sessionQuery') as { readSession(id: unknown): Promise<{ events: unknown[] }> } | undefined
  if (!query) throw new ChatGptError('no-session-query', '宿主未提供会话图片读取服务。')
  const snapshot = await query.readSession(exec.agent.session.id)
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
}

/** Explicit tool calls may originate from child agents; no global hook creates auxiliary work. */
export async function executeCapability(host: ToolHost, run: Run, mode: Capability,
  args: { prompt: string; images?: string[]; attachmentIds?: string[] }, exec: ToolRunContext): Promise<PublishedResult> {
  const signal = exec.signal
  signal.throwIfAborted()
  if (!args.prompt.trim() || args.prompt.length > 100_000) throw new ChatGptError('bad-request', '请求内容不能为空或超过 100,000 字符。')
  const images = args.images ?? [], ids = args.attachmentIds ?? []
  if (images.length + ids.length > 5) throw new ChatGptError('bad-request', '每次最多使用五张图片。')
  if (['ask', 'search'].includes(mode) && images.length + ids.length) throw new ChatGptError('bad-request', '此工具不接受图片。')
  if (['edit', 'vision'].includes(mode) && !images.length && !ids.length) throw new ChatGptError('bad-request', '请指定要使用的图片。')
  const policy = host.sandboxPolicy.resolve({ session: exec.agent?.session })
  const root = await realpath(policy.workspaceRoot)
  if (['image', 'edit'].includes(mode) && policy.mode === 'read-only') throw new ChatGptError('read-only', '生成图片需要当前会话允许写入工作区。')
  const refs = await selectedAttachments(host, ids, exec, signal)
  const temp = await mkdtemp(join(tmpdir(), 'dsh-chatgpt-input-'))
  let publication: string | undefined, published = false
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
    const result = await run({ mode, prompt: args.prompt, images: staged }, temp, signal)
    signal.throwIfAborted()
    if (result.images.length && !['image', 'edit'].includes(mode)) throw new ChatGptError('unexpected-image', '此调用返回了非请求的图片结果。')
    const attachments: ImageAttachmentRef[] = []
    const outputs: Result['images'] = []
    if (result.images.length) {
      const outputRoot = join(root, '.dsh-chatgpt')
      await mkdir(outputRoot, { recursive: true })
      if (!inside(root, await realpath(outputRoot)) || (await lstat(outputRoot)).isSymbolicLink()) throw new ChatGptError('outside-workspace', '图片输出目录不可指向工作区外。')
      const destination = join(outputRoot, randomUUID())
      await mkdir(destination)
      publication = destination
      // Validate the complete image batch before committing any attachment reference.
      const payloads = await Promise.all(result.images.map(async image => {
        const path = await workspaceFile(temp, image.path)
        return { data: await readFile(path), mediaType: image.mediaType as ImageMediaType, name: basename(path) }
      }))
      await Promise.all(payloads.map(input => host.attachments.validateImage(input)))
      signal.throwIfAborted()
      const saved = await host.attachments.saveImages(payloads)
      signal.throwIfAborted()
      for (let i = 0; i < payloads.length; i++) {
        signal.throwIfAborted()
        const path = join(destination, `${i}-${payloads[i].name}`)
        await writeFile(path, payloads[i].data, { flag: 'wx' })
        outputs.push({ path: relative(root, path).split(sep).join('/'), mediaType: payloads[i].mediaType })
        attachments.push(saved[i])
      }
    }
    signal.throwIfAborted()
    published = true
    return { ...result, images: outputs, attachments }
  } finally {
    if (publication && !published) await rm(publication, { recursive: true, force: true })
    // This directory was created by this invocation and never names the user's workspace.
    await rm(temp, { recursive: true, force: true })
  }
}

const DEFINITIONS: { mode: Capability; name: string; description: string }[] = [
  { mode: 'search', name: 'chatgpt_search', description: '搜索最新公开网页资料并返回来源链接。需要联网核实、查找资料或引用来源时使用；通过本机官方 Codex 的原生搜索执行。' },
  { mode: 'image', name: 'chatgpt_generate_image', description: '实际生成并保存图片（插图、海报、素材等），可使用参考图片。用户要求画图或生图时使用，返回可预览的会话图片；通过本机官方 Codex 执行。' },
  { mode: 'edit', name: 'chatgpt_edit_image', description: '实际编辑指定图片，例如改背景、改文字或调整风格。必须明确目标图片及修改要求，保留源文件；通过本机官方 Codex 执行。' },
  { mode: 'vision', name: 'chatgpt_view_image', description: '查看和分析工作区图片或当前会话附件。识别图片内容、读取截图文字、比较参考图时使用；通过本机官方 Codex 执行。' },
  { mode: 'ask', name: 'chatgpt_ask', description: '让 ChatGPT 对提供的文本作独立分析、推理、翻译或写作。需要 GPT 观点或复杂文本分析时使用；只处理提供的文本，不执行命令或修改项目。' },
]
export function registerTools(host: ToolHost, run: Run, lifetime?: AbortSignal): void {
  for (const spec of DEFINITIONS) host.tools.register(defineTool({
    name: spec.name, description: spec.description,
    parameters: {
      prompt: { type: 'string', required: true, description: '任务内容。生图和编辑时说明画面、文字、风格及需要保留的内容。' },
      images: { type: 'array', items: { type: 'string' }, description: '当前工作区内的图片路径，最多五张。' },
      attachmentIds: { type: 'array', items: { type: 'string' }, description: '当前会话中图片附件的标识；只能使用会话已有的真实标识。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_args, value) {
        const result = value as unknown as PublishedResult
        const text = [result.answer, ...result.images.map(image => `图片已保存：${image.path}`), ...result.sources.map(source => `${source.title ?? source.url}: ${source.url}`)].filter(Boolean).join('\n')
        return [{ type: 'text' as const, text }, ...result.attachments.map(attachment => ({ type: 'image' as const, attachment }))]
      },
    },
    timeoutMs: 1_800_000,
    isConcurrencySafe() { return true },
    execute: (args, exec) => executeCapability(host, run, spec.mode, args, lifetime ? { ...exec, signal: AbortSignal.any([exec.signal, lifetime]) } : exec) as Promise<any>,
  }))
}
