export const PLUGIN_NAME = '@klarkxy/dsh-workspace-folders'
export const RPC_CHANNEL = '/dsh-workspace-folders'
export interface WorkspaceFoldersSnapshot {
  workspaceId: string
  title: string
  primaryPath: string
  folders: string[]
  revision: number
  pickerKind?: 'native' | 'browse'
}
export interface FolderRecord { folders: string[]; revision: number }
export type RpcResult<T = unknown> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
