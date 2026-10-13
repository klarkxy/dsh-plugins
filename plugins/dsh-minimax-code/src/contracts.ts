export const PLUGIN_NAME = '@klarkxy/dsh-minimax-code'
export const RPC_CHANNEL = '/dsh-minimax-code'
export type Settings = { toolsExecutable: string; codeExecutable: string; searchDataDir: string; region: 'auto' | 'cn' | 'global'; timeoutMs: number }
export const DEFAULT_SETTINGS: Settings = { toolsExecutable: '', codeExecutable: '', searchDataDir: '', region: 'auto', timeoutMs: 900_000 }
export const CAPABILITIES = ['search', 'generate_image', 'search_images', 'reverse_image_search', 'generate_video', 'video_status', 'list_voices', 'synthesize_speech', 'batch_speech', 'transcribe_audio', 'understand_audio', 'understand_video'] as const
export type Capability = typeof CAPABILITIES[number]
export type Status = {
  available: boolean; executable: string; version: string; authenticated: boolean | null;
  capabilities: { id: Capability; available: boolean; reason?: string }[];
  error?: { code: string; message: string };
}
export type { RpcResult } from '@klarkxy/dsh-plugin-kit/contracts'
export class MiniMaxCodeError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'MiniMaxCodeError' }
}
export function parseSettings(value: unknown): Settings {
  const v = value && typeof value === 'object' ? value as Partial<Settings> : {}
  return {
    toolsExecutable: typeof v.toolsExecutable === 'string' ? v.toolsExecutable.trim() : '',
    codeExecutable: typeof v.codeExecutable === 'string' ? v.codeExecutable.trim() : '',
    searchDataDir: typeof v.searchDataDir === 'string' ? v.searchDataDir.trim() : '',
    region: v.region === 'cn' || v.region === 'global' ? v.region : 'auto',
    timeoutMs: Number.isInteger(v.timeoutMs) && v.timeoutMs! >= 10_000 && v.timeoutMs! <= 1_800_000 ? v.timeoutMs! : DEFAULT_SETTINGS.timeoutMs,
  }
}
