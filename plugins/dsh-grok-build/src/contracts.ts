export const PLUGIN_NAME = '@klarkxy/dsh-grok-build'
export const RPC_CHANNEL = '/dsh-grok-build'
export type Settings = { executable: string; timeoutMs: number; allowNativeMediaFiles: boolean }
export const DEFAULT_SETTINGS: Settings = { executable: '', timeoutMs: 900_000, allowNativeMediaFiles: false }
export const CAPABILITIES = ['search', 'fetch', 'generate_image', 'edit_image', 'image_to_video', 'reference_to_video'] as const
export type Capability = typeof CAPABILITIES[number]
export type Status = {
  available: boolean; executable: string; version: string; authenticated: boolean | null;
  capabilities: { id: Capability; available: boolean; reason?: string }[];
  error?: { code: string; message: string };
}
export type { RpcResult } from '@klarkxy/dsh-plugin-kit/contracts'
export class GrokBuildError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'GrokBuildError' }
}
export function parseSettings(value: unknown): Settings {
  const v = value && typeof value === 'object' ? value as Partial<Settings> : {}
  return {
    executable: typeof v.executable === 'string' ? v.executable.trim() : '',
    allowNativeMediaFiles: v.allowNativeMediaFiles === true,
    timeoutMs: Number.isInteger(v.timeoutMs) && v.timeoutMs! >= 10_000 && v.timeoutMs! <= 1_800_000 ? v.timeoutMs! : DEFAULT_SETTINGS.timeoutMs,
  }
}
