import { defineTool, type ParameterSchemaSpec, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { MediaHost } from '@klarkxy/dsh-plugin-kit/cli-media'
import type { MiniMaxRuntime, CapabilityResult } from './runtime.ts'
import type { MediaOperation } from './media-requests.ts'

export type ToolHost = MediaHost & { tools: { register(tool: ToolDefinition): unknown } }
const input = { type: 'object', additionalProperties: false, properties: {
  path: { type: 'string', description: '当前工作区中的媒体文件路径。' },
  attachmentId: { type: 'string', description: '当前会话已有的附件标识；与 path 二选一。' },
} } as const
const speech = { type: 'object', additionalProperties: false, properties: {
  text: { type: 'string', required: true, description: '要朗读的文本。' }, voiceId: { type: 'string', description: '音色标识；省略使用官方默认。' },
  speed: { type: 'number', description: '语速 0.5–2。' }, volume: { type: 'number', description: '音量 0–10。' }, pitch: { type: 'integer', description: '音调 -12–12。' },
  emotion: { type: 'string', enum: ['happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'neutral'] },
} } as const
const job = { jobId: { type: 'string', required: true, description: '生成工具或 minimax_media_jobs 返回的真实 jobId，不是远程 task_id。' } } as const
type Spec = { operation: MediaOperation | 'search'; name: string; description: string; parameters: ParameterSchemaSpec }
export const TOOL_SPECS: Spec[] = [
  { operation: 'search', name: 'minimax_search', description: '使用本机官方 MiniMax Code 搜索最新公开网页资料，返回搜索内容及来源链接。需要联网查证或找资料时使用。', parameters: { query: { type: 'string', required: true, description: '搜索词或研究问题。' }, count: { type: 'integer', description: '返回1–10个来源，默认5。' } } },
  { operation: 'generate_image', name: 'minimax_generate_image', description: '用 MiniMax Code 实际生成图片或按参考图修改画面，返回已保存的图片附件。可批量生成；每项最多四张工作区图片或当前会话附件。', parameters: { requests: { type: 'array', required: true, description: '1–10 个生成请求。', items: { type: 'object', additionalProperties: false, properties: {
    prompt: { type: 'string', required: true }, images: { type: 'array', items: input }, aspectRatio: { type: 'string', enum: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'] }, resolution: { type: 'string', enum: ['1K', '2K', '4K'] },
  } } } } },
  { operation: 'search_images', name: 'minimax_search_images', description: '搜索网上已有图片素材，并可下载搜索结果。需要找图片或参考素材时使用；不是生图，也不判断图片使用许可。', parameters: {
    queries: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { query: { type: 'string', required: true }, prompt: { type: 'string', description: '筛选图片的相关性要求，省略时使用搜索词。' } } } },
    download: { type: 'boolean', description: '是否保存可用图片，默认 true。' }, limit: { type: 'integer', description: '最多保存 1–10 张，默认 5。' },
  } },
  { operation: 'reverse_image_search', name: 'minimax_reverse_image_search', description: '根据指定图片寻找网上相似图片及相关页面。只做反向搜图，不提供图片理解工具。', parameters: { image: { ...input, required: true } } },
  { operation: 'generate_video', name: 'minimax_generate_video', description: '使用 MiniMax Code 提交一个视频生成任务。模型需由用户明确选择：H3 为质量优先，H3-Max 为快速生成，两者使用账号点数并可生成声音；Hailuo 2.3 为套餐可用的低成本无声视频。返回 jobId 后用 minimax_video_status 查询；超时、取消或结果不确定时不要重复提交。', parameters: {
    prompt: { type: 'string', required: true, description: '视频画面；H3 系列可同时描述对白、环境声和音效。最多 7000 字符。' },
    model: { type: 'string', required: true, enum: ['MiniMax-H3', 'MiniMax-H3-Max', 'MiniMax-Hailuo-2.3'] }, duration: { type: 'integer', required: true, description: 'H3：4–15 秒；H3-Max：5–15 秒；Hailuo 2.3：6 或 10 秒。' },
    resolution: { type: 'string', enum: ['480P', '768P', '1080P', '2K'], description: 'H3：768P/2K；H3-Max：480P/768P；Hailuo：768P 或仅6秒1080P。' },
    aspectRatio: { type: 'string', enum: ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], description: 'H3 系列可用。关键帧模式只能 adaptive；纯文生不能 adaptive。' },
    inputImage: input, lastFrame: { ...input, description: 'H3 系列末帧，必须同时提供 inputImage 首帧。' }, referenceType: { type: 'string', enum: ['first_frame', 'last_frame', 'subject'] },
    referenceImages: { type: 'array', items: input, description: '仅 H3：最多9张参考图。不能与首尾帧混用。' },
    referenceVideos: { type: 'array', items: input, description: '仅 H3：最多3段 MP4/MOV，每段2–15秒且合计不超过15秒；由官方CLI读取实际时长。' },
    referenceAudios: { type: 'array', items: input, description: '仅 H3：最多3段 WAV/MP3，须配合参考图或视频。全部参考文件合计最多12份。' },
  } },
  { operation: 'video_status', name: 'minimax_video_status', description: '查询已提交的 MiniMax 视频任务。成功后下载并返回视频附件；重复查询不会再次生成或再次提交任务。', parameters: job },
  { operation: 'list_voices', name: 'minimax_list_voices', description: '列出 MiniMax Code 可用的配音音色名称和标识。用户需要挑选音色时使用。', parameters: {} },
  { operation: 'synthesize_speech', name: 'minimax_synthesize_speech', description: '将文本合成为配音，返回已保存的音频文件附件。可选择音色、语速、音调、音量和情绪。', parameters: speech.properties },
  { operation: 'batch_speech', name: 'minimax_batch_speech', description: '批量合成1–10段配音，每项可选择不同音色和参数。返回逐项结果，保留成功项；部分失败时只重新请求失败项，不重做整批。', parameters: { requests: { type: 'array', required: true, items: speech } } },
  { operation: 'transcribe_audio', name: 'minimax_transcribe_audio', description: '将工作区或当前会话中的录音转写为文字。提供一个音频文件，可附带语言或格式要求。', parameters: { audio: { ...input, required: true }, prompt: { type: 'string' } } },
  { operation: 'understand_audio', name: 'minimax_understand_audio', description: '分析指定音频的内容并回答问题，可处理最多10份录音；需要逐字稿时使用 minimax_transcribe_audio。', parameters: { files: { type: 'array', required: true, items: input }, prompt: { type: 'string', required: true } } },
  { operation: 'understand_video', name: 'minimax_understand_video', description: '分析工作区或当前会话中指定的视频，描述内容、总结片段或回答视频问题，最多10份。', parameters: { files: { type: 'array', required: true, items: input }, prompt: { type: 'string', required: true } } },
  { operation: 'recover_media', name: 'minimax_recover_media', description: '取回已有生成任务的图片、音频或视频。仅查询或重新下载已生成内容，不再次生成。生成后下载失败或插件重启时使用。', parameters: job },
  { operation: 'media_jobs', name: 'minimax_media_jobs', description: '列出当前工作区最近的 MiniMax 媒体任务及 jobId。取消等待或重启后用它找到可恢复任务。只读取本插件的任务记录。', parameters: {} },
]
export function renderResult(result: CapabilityResult): any[] {
  const text = [result.answer, result.jobId ? `jobId: ${result.jobId}; status: ${result.status}` : '', ...result.files.map(file => `${file.kind}: ${file.path}`), result.items?.length ? JSON.stringify(result.items) : '', result.data !== undefined ? JSON.stringify(result.data) : ''].filter(Boolean).join('\n')
  return [{ type: 'text', text }, ...result.files.map(file => file.attachment)]
}
export function registerTools(host: ToolHost, runtime: Pick<MiniMaxRuntime, 'execute'>, ready: Promise<unknown>, lifetime: AbortSignal): void {
  for (const spec of TOOL_SPECS) host.tools.register(defineTool({
    name: spec.name, description: spec.description, parameters: spec.parameters,
    output: { schema: { type: 'object', additionalProperties: true }, render(_args, value) { return renderResult(value as unknown as CapabilityResult) } },
    timeoutMs: 1_800_000,
    isConcurrencySafe: () => true,
    async execute(args, exec: ToolRunContext) {
      const signal = AbortSignal.any([exec.signal, lifetime]); signal.throwIfAborted(); await ready; signal.throwIfAborted()
      return runtime.execute(spec.operation, args, { ...exec, signal }) as Promise<any>
    },
  }))
}
