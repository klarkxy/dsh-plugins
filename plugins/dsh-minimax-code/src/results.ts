import { MiniMaxCodeError } from './contracts.ts'
import type { JobAsset } from './jobs.ts'
import type { MediaKind } from '@klarkxy/dsh-plugin-kit/cli-media'

export function assertBusinessSuccess(value: any): void {
  if (!value || typeof value !== 'object') throw new MiniMaxCodeError('invalid-output', 'MiniMax returned an invalid tool result.')
  const code = typeof value.code === 'number' ? value.code : value.base_resp?.status_code
  if (code !== undefined && code !== 0 && !value.success_items?.length) throw new MiniMaxCodeError('provider-failed', `MiniMax rejected the operation (code ${code}). No generation was retried.`)
}
export function generationAssets(value: any, expected: number, kind: MediaKind): { assets: JobAsset[]; failures: { index: number; error: string }[] } {
  assertBusinessSuccess(value)
  if (value.node_id && expected === 1) return { assets: [asset(value, 0, kind)], failures: [] }
  if (!Array.isArray(value.success_items)) throw new MiniMaxCodeError('invalid-output', 'MiniMax did not return generated asset identifiers.')
  const failures = Array.isArray(value.failed_items) ? value.failed_items.map((item: any) => {
    if (!Number.isInteger(item.index) || item.index < 0 || item.index >= expected) throw new MiniMaxCodeError('invalid-output', 'MiniMax returned an invalid batch item index.')
    return { index: item.index, error: `MiniMax generation failed (code ${typeof item.err_code === 'number' ? item.err_code : 'unknown'}).` }
  }) : []
  const used = new Set<number>(failures.map((item: any) => item.index))
  const assets: JobAsset[] = value.success_items.map((item: any, order: number) => {
    const match = typeof item.file_name === 'string' ? /^item-(\d+)(?:\.|$)/.exec(item.file_name) : null
    const index = match ? Number(match[1]) : expected === 1 ? 0 : -1
    if (index < 0 || index >= expected || used.has(index)) throw new MiniMaxCodeError('unmatched-batch', 'MiniMax generated assets but did not preserve their requested item names. Do not repeat generation; inspect the saved receipt.')
    used.add(index)
    return asset(item, index, kind)
  })
  if (used.size !== expected) throw new MiniMaxCodeError('invalid-output', 'MiniMax returned an incomplete batch result. Do not repeat generation.')
  return { assets, failures }
}
export function asset(item: any, index: number, kind: MediaKind): JobAsset {
  if (typeof item.node_id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(item.node_id)) throw new MiniMaxCodeError('invalid-output', 'MiniMax returned an invalid asset ID.')
  const name = typeof item.file_name === 'string' && /^[^/\\\x00-\x1f]{1,200}$/.test(item.file_name) ? item.file_name : `item-${index}.${kind === 'image' ? 'png' : kind === 'audio' ? 'mp3' : 'mp4'}`
  return { index, kind, name, nodeId: item.node_id }
}
export function voiceCatalogue(value: any): { available_voices: { voice_id: string; voice_name: string }[]; total: number; truncated: boolean } {
  assertBusinessSuccess(value)
  if (!Array.isArray(value.available_voices)) throw new MiniMaxCodeError('invalid-output', 'MiniMax did not return its voice catalogue.')
  const voices = value.available_voices.slice(0, 1000).map((voice: any) => {
    if (typeof voice?.voice_id !== 'string' || !voice.voice_id || voice.voice_id.length > 200 || typeof voice.voice_name !== 'string') throw new MiniMaxCodeError('invalid-output', 'MiniMax returned an invalid voice entry.')
    return { voice_id: voice.voice_id, voice_name: voice.voice_name.slice(0, 300) }
  })
  return { available_voices: voices, total: value.available_voices.length, truncated: value.available_voices.length > voices.length }
}
/** Return public content without upload/download bearer URLs, auth fields or unbounded server data. */
export function businessData(value: unknown, depth = 0): any {
  if (depth > 10) return '[truncated]'
  if (typeof value === 'string') return /[?&](?:x-amz-|x-oss-|signature|security-token|token=|ossaccesskeyid)/i.test(value) ? '[temporary media URL]' : value.slice(0, 40_000)
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (Array.isArray(value)) return value.slice(0, 100).map(item => businessData(item, depth + 1))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !/token|secret|password|authorization|headers|download_url|temp_url/i.test(key)).slice(0, 100).map(([key, item]) => [key, businessData(item, depth + 1)]))
  return null
}
export function videoTaskId(value: any): string | undefined {
  const data = value?.data && typeof value.data === 'object' ? value.data : value
  return typeof data?.task_id === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(data.task_id) ? data.task_id : undefined
}
export function videoResult(value: any): { taskId?: string; status: 'pending' | 'complete' | 'failed'; url?: string } {
  assertBusinessSuccess(value)
  const data = value.data && typeof value.data === 'object' ? value.data : value
  const taskId = videoTaskId(value)
  const status = String(data.status ?? 'queued').toLowerCase()
  if (['failed', 'cancelled'].includes(status)) return { taskId, status: 'failed' }
  if (status === 'succeeded' || status === 'success' || status === 'done') {
    if (typeof data.video_url !== 'string') throw new MiniMaxCodeError('invalid-output', 'A completed MiniMax video has no download URL.')
    return { taskId, status: 'complete', url: data.video_url }
  }
  if (!['submitted', 'queued', 'running', 'processing', 'pending', 'preparing'].includes(status)) throw new MiniMaxCodeError('invalid-output', 'MiniMax returned an unknown video status.')
  return { taskId, status: 'pending' }
}
