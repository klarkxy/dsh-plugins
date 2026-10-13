import { z } from 'zod'
import type { MediaInput, MediaKind } from '@klarkxy/dsh-plugin-kit/cli-media'
import { MiniMaxCodeError } from './contracts.ts'

const text = z.string().trim().min(1).max(20_000)
export const inputSchema = z.object({ path: z.string().min(1).max(4096).optional(), attachmentId: z.string().min(1).max(200).optional() }).strict().refine(v => Boolean(v.path) !== Boolean(v.attachmentId), 'Provide a path or an attachment ID, not both.')
const imageRequest = z.object({ prompt: text, images: z.array(inputSchema).max(4).optional(), aspectRatio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4', '21:9']).optional(), resolution: z.enum(['1K', '2K', '4K']).optional() }).strict()
export const speechRequest = z.object({ text, voiceId: z.string().trim().min(1).max(200).optional(), speed: z.number().min(0.5).max(2).optional(), volume: z.number().min(0).max(10).optional(), pitch: z.number().int().min(-12).max(12).optional(), emotion: z.enum(['happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'neutral']).optional() }).strict()
const videoRequest = z.object({
  prompt: text.max(7000), model: z.enum(['MiniMax-H3', 'MiniMax-H3-Max', 'MiniMax-Hailuo-2.3']), duration: z.number().int().min(4).max(15),
  resolution: z.enum(['480P', '768P', '1080P', '2K']).optional(), aspectRatio: z.enum(['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16']).optional(),
  inputImage: inputSchema.optional(), lastFrame: inputSchema.optional(), referenceType: z.enum(['first_frame', 'last_frame', 'subject']).optional(),
  referenceImages: z.array(inputSchema).min(1).max(9).optional(), referenceVideos: z.array(inputSchema).min(1).max(3).optional(), referenceAudios: z.array(inputSchema).min(1).max(3).optional(),
}).strict()
export const requestSchemas = {
  generate_image: z.object({ requests: z.array(imageRequest).min(1).max(10) }).strict(),
  search_images: z.object({ queries: z.array(z.object({ query: text.max(1000), prompt: text.max(2000).optional() }).strict()).min(1).max(10), download: z.boolean().default(true), limit: z.number().int().min(1).max(10).default(5) }).strict(),
  reverse_image_search: z.object({ image: inputSchema }).strict(),
  generate_video: videoRequest,
  video_status: z.object({ jobId: z.string().uuid() }).strict(),
  recover_media: z.object({ jobId: z.string().uuid() }).strict(),
  media_jobs: z.object({}).strict(),
  list_voices: z.object({}).strict(),
  synthesize_speech: speechRequest,
  batch_speech: z.object({ requests: z.array(speechRequest).min(1).max(10) }).strict(),
  transcribe_audio: z.object({ audio: inputSchema, prompt: text.optional() }).strict(),
  understand_audio: z.object({ files: z.array(inputSchema).min(1).max(10), prompt: text }).strict(),
  understand_video: z.object({ files: z.array(inputSchema).min(1).max(10), prompt: text }).strict(),
}
export type MediaOperation = keyof typeof requestSchemas
export function parseRequest(operation: MediaOperation, args: unknown): any {
  const parsed = requestSchemas[operation].safeParse(args)
  if (!parsed.success) throw new MiniMaxCodeError('bad-request', parsed.error.issues.map(issue => `${issue.path.join('.') || 'request'}: ${issue.message}`).join('; ').slice(0, 1000))
  if (operation === 'generate_video') validateVideo(parsed.data as z.infer<typeof videoRequest>)
  return parsed.data
}
export function validateVideo(v: z.infer<typeof videoRequest>): void {
  const fail = (message: string): never => { throw new MiniMaxCodeError('bad-request', message) }
  const references = (v.referenceImages?.length ?? 0) + (v.referenceVideos?.length ?? 0) + (v.referenceAudios?.length ?? 0)
  if (references > 12) fail('At most 12 combined video reference files are allowed.')
  if (references && (v.inputImage || v.lastFrame || v.referenceType)) fail('Reference collections cannot be combined with keyframes.')
  if (v.lastFrame && !v.inputImage) fail('A last frame requires an input first frame.')
  if (v.referenceType && !v.inputImage) fail('A reference type requires an input image.')
  if (v.lastFrame && v.referenceType && v.referenceType !== 'first_frame') fail('First+last-frame mode requires first_frame.')
  if (v.referenceAudios?.length && !v.referenceImages?.length && !v.referenceVideos?.length) fail('Reference audio must accompany reference images or videos.')
  if (v.model === 'MiniMax-Hailuo-2.3') {
    if (references || v.lastFrame || v.aspectRatio || v.referenceType === 'last_frame') fail('Hailuo 2.3 supports text-to-video and a first frame or legacy subject image, without H3 references or aspect-ratio options.')
    if (![6, 10].includes(v.duration) || (v.referenceType === 'subject' && v.duration !== 6)) fail('Hailuo 2.3 requires 6 or 10 seconds; subject mode requires 6.')
    if (v.resolution && !['768P', '1080P'].includes(v.resolution)) fail('Hailuo 2.3 supports 768P or 1080P.')
    if (v.resolution === '1080P' && v.duration !== 6) fail('Hailuo 2.3 at 1080P requires 6 seconds.')
  } else {
    if (v.referenceType === 'subject') fail('H3 models do not support legacy subject mode.')
    if (v.model === 'MiniMax-H3-Max' && (references || v.duration < 5 || (v.resolution && !['480P', '768P'].includes(v.resolution)))) fail('H3-Max supports 5–15 seconds at 480P/768P, with text or keyframes only.')
    if (v.model === 'MiniMax-H3' && v.resolution && !['768P', '2K'].includes(v.resolution)) fail('H3 supports 768P or 2K.')
    if (!references && !v.inputImage && v.aspectRatio === 'adaptive') fail('Text-to-video needs a concrete aspect ratio.')
    if (v.inputImage && v.aspectRatio && v.aspectRatio !== 'adaptive') fail('Keyframe mode uses adaptive aspect ratio.')
  }
}
export function speechArguments(v: z.infer<typeof speechRequest>, index: number): Record<string, unknown> {
  return { text: v.text, output_file: `item-${index}.mp3`, ...(v.voiceId ? { voice_id: v.voiceId } : {}),
    ...(v.speed !== undefined ? { speed: v.speed } : {}), ...(v.volume !== undefined ? { volume: v.volume } : {}),
    ...(v.pitch !== undefined ? { pitch: v.pitch } : {}), ...(v.emotion ? { emotion: v.emotion } : {}) }
}
export type InputLocation = { input: MediaInput; assign(url: string, mimeType: string, durationSeconds?: number): void; videoReference?: boolean }
export function mapMediaRequest(operation: MediaOperation, args: any): { wire: Record<string, any>; inputs: InputLocation[] } {
  const inputs: InputLocation[] = []
  const media = (v: { path?: string; attachmentId?: string }, kind: MediaKind, assign: InputLocation['assign'], videoReference = false) => inputs.push({ input: { ...v, kind }, assign, videoReference })
  let wire: Record<string, any> = {}
  if (operation === 'generate_image') {
    wire.requests = args.requests.map((v: any, index: number) => {
      const row: Record<string, any> = { prompt: v.prompt, output_file: `item-${index}.png`, ...(v.aspectRatio ? { aspect_ratio: v.aspectRatio } : {}), ...(v.resolution ? { resolution: v.resolution } : {}) }
      if (v.images?.length) {
        row.input_urls = Array(v.images.length)
        v.images.forEach((input: any, at: number) => media(input, 'image', url => { row.input_urls[at] = url }))
      }
      return row
    })
  } else if (operation === 'synthesize_speech') wire = speechArguments(args, 0)
  else if (operation === 'batch_speech') wire.requests = args.requests.map(speechArguments)
  else if (operation === 'search_images') wire.queries = args.queries.map((v: any, i: number) => ({ query: v.query, prompt: v.prompt || v.query, task_name: `search-${i}` }))
  else if (operation === 'reverse_image_search') media(args.image, 'image', url => { wire.image_url = url })
  else if (operation === 'transcribe_audio') {
    wire.audio_info = { ...(args.prompt ? { prompt: args.prompt } : {}) }
    media(args.audio, 'audio', (url, mime_type) => Object.assign(wire.audio_info, { url, mime_type }))
  } else if (operation === 'understand_audio' || operation === 'understand_video') {
    const key = operation === 'understand_audio' ? 'audio_info' : 'video_info', kind = operation === 'understand_audio' ? 'audio' : 'video'
    wire[key] = args.files.map((v: any, i: number) => {
      const row = { prompt: args.prompt }
      media(v, kind, (url, mime_type) => Object.assign(wire[key][i], { url, mime_type }))
      return row
    })
  } else if (operation === 'generate_video') {
    wire = { prompt: args.prompt, model: args.model, duration: args.duration,
      ...(args.resolution ? { resolution: args.resolution } : {}), ...(args.aspectRatio ? { ratio: args.aspectRatio } : {}), ...(args.referenceType ? { reference_type: args.referenceType } : {}) }
    if (args.inputImage) media(args.inputImage, 'image', (url, mime_type) => { wire.input_image = { url, mime_type } })
    if (args.lastFrame) media(args.lastFrame, 'image', (url, mime_type) => { wire.last_frame_image = { url, mime_type } })
    for (const [key, source, kind] of [['reference_images', 'referenceImages', 'image'], ['reference_videos', 'referenceVideos', 'video'], ['reference_audios', 'referenceAudios', 'audio']] as const) {
      if (!args[source]?.length) continue
      wire[key] = Array(args[source].length)
      args[source].forEach((v: any, i: number) => media(v, kind, (url, mime_type, duration_seconds) => { wire[key][i] = { url, mime_type, ...(duration_seconds !== undefined ? { duration_seconds } : {}) } }, kind === 'video'))
    }
  }
  return { wire, inputs }
}
