export const PLUGIN_NAME = '@klarkxy/dsh-chatgpt'
export const RPC_CHANNEL = '/dsh-chatgpt'
export const MODES = ['search', 'image', 'edit', 'vision', 'ask'] as const
export type Capability = typeof MODES[number]
export type Settings = { executable: string; model: string; effort: string; timeoutMs: number }
export const DEFAULT_SETTINGS: Settings = { executable: '', model: '', effort: '', timeoutMs: 900_000 }
export type ModelOption = { id: string; label: string; isDefault: boolean; efforts: string[] }
export type Login = { id: string; kind: 'browser' | 'device'; url: string; code?: string }
export type Status = {
  available: boolean; executable: string; version: string; signedIn: boolean;
  authMode: string | null; accountLabel?: string; plan?: string; login?: Login;
  error?: string; models: ModelOption[];
}
export type Request = { mode: Capability; prompt: string; images?: string[] }
export type Source = { url: string; title?: string }
export type ImageResult = { path: string; mediaType: string }
export type Result = { id: string; mode: Capability; answer: string; images: ImageResult[]; sources: Source[]; searchCount: number; elapsedMs: number }
export type RpcResult<T = unknown> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
export class ChatGptError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'ChatGptError' }
}
export function parseSettings(value: unknown): Settings {
  const v = value && typeof value === 'object' ? value as Partial<Settings> : {}
  return {
    executable: typeof v.executable === 'string' ? v.executable.trim() : '',
    model: typeof v.model === 'string' ? v.model.trim() : '',
    effort: typeof v.effort === 'string' ? v.effort.trim() : '',
    timeoutMs: Number.isInteger(v.timeoutMs) && v.timeoutMs! >= 10_000 && v.timeoutMs! <= 1_800_000 ? v.timeoutMs! : DEFAULT_SETTINGS.timeoutMs,
  }
}
