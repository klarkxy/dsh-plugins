import type { Capability } from './contracts.ts'

const labels: Record<Capability, readonly [string, string]> = {
  search: ['网页搜索', 'Web search'],
  fetch: ['网页读取', 'Read web pages'],
  generate_image: ['图片生成', 'Generate images'],
  edit_image: ['图片编辑', 'Edit images'],
  image_to_video: ['图生视频', 'Image to video'],
  reference_to_video: ['参考图视频', 'Reference images to video'],
}
export function capabilityLabel(id: Capability, english: boolean): string {
  return labels[id]?.[english ? 1 : 0] ?? id
}
export function clientMessage(error: unknown, english: boolean): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message === 'Timeout must be between 10 and 1800 seconds.') return english ? message : '超时须在 10–1800 秒之间。'
  return message
}
