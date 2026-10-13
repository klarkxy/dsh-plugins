import type { Capability } from './contracts.ts'

const labels: Record<Capability, readonly [string, string]> = {
  search: ['网页搜索', 'Web search'],
  generate_image: ['图片生成', 'Generate images'],
  search_images: ['图片搜索', 'Image search'],
  reverse_image_search: ['以图搜图', 'Reverse image search'],
  generate_video: ['视频生成', 'Generate videos'],
  video_status: ['视频任务状态', 'Video task status'],
  list_voices: ['音色列表', 'List voices'],
  synthesize_speech: ['语音合成', 'Synthesize speech'],
  batch_speech: ['批量语音合成', 'Batch speech synthesis'],
  transcribe_audio: ['音频转写', 'Transcribe audio'],
  understand_audio: ['音频理解', 'Understand audio'],
  understand_video: ['视频理解', 'Understand video'],
}
export function capabilityLabel(id: Capability, english: boolean): string {
  return labels[id]?.[english ? 1 : 0] ?? id
}
export function clientMessage(error: unknown, english: boolean): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message === 'Timeout must be between 10 and 1800 seconds.') return english ? message : '超时须在 10–1800 秒之间。'
  if (!english) {
    const mcp = /^This MiniMax CLI profile has (\d+) enabled user MCP server/.exec(message)
    if (mcp) return `当前 MiniMax 配置启用了 ${mcp[1]} 个 MCP 服务，搜索调用无法排除这些工具。请选择已通过官方 CLI 登录、没有可执行扩展的独立搜索配置目录。`
    if (message === 'The official MiniMax Code version check failed.') return '无法读取官方 mcode 版本，请检查搜索路径。'
    if (message.startsWith('MiniMax native search requires a separately verified CLI')) return '此 mcode 版本尚未通过搜索适配验证，当前支持 0.6.9。'
    if (message.startsWith('The official mcode CLI was not found.')) return '未找到官方 mcode CLI，请安装或选择其 cli.js 入口以启用网页搜索。'
    if (message.startsWith('This MiniMax CLI profile contains plugin MCP')) return '当前搜索配置包含可执行扩展，请选择已登录且不含这些扩展的独立配置目录。'
    if (message.startsWith('Open the signed-in MiniMax Code host')) return '请启动并登录官方 MiniMax Code，再刷新连接。'
    if (message.startsWith('Sign in through official MiniMax Code')) return '请先在官方 MiniMax Code 中登录，再刷新连接。'
  }
  return message
}
