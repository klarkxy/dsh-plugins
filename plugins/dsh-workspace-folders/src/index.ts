import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-host-directory-picker'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { SessionId, type SessionStore } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { registerHostRpc, type HostRpcContext } from '@klarkxy/dsh-plugin-kit/host-rpc'
import { installPluginLogger } from '@klarkxy/dsh-plugin-kit/logger'
import { PLUGIN_NAME, RPC_CHANNEL } from './contracts.ts'
import { foldersDomain } from './storage.ts'
import { WorkspaceFoldersService, handleRpc } from './service.ts'
import { FolderRuntime, installFolderPolicy } from './runtime.ts'

export const name = PLUGIN_NAME
export const inject = ['storageDomain', 'workspaceRegistry', 'sessions', 'sandboxPolicy', 'systemPrompt', 'connection', 'webServer', 'directoryPicker'] as const

export async function apply(ctx: Context): Promise<void> {
  const pickerKind = ctx.directoryPicker.capability().kind
  const logger = installPluginLogger(ctx, PLUGIN_NAME, { loadedContext: { pickerKind } })
  const domain = await ctx.storageDomain.open(foldersDomain).catch(error => {
    logger.fault('storage.open-failed', 'Failed to open workspace folders storage domain.', error)
    throw error
  })
  const service = new WorkspaceFoldersService({
    get: id => ctx.workspaceRegistry.get(WorkspaceId(id)),
    list: () => ctx.workspaceRegistry.list(),
  }, domain.table('workspaces'), pickerKind, logger)
  ctx.effect(() => async () => { await service.dispose(); await domain.close() }, 'workspace-folders.storage')
  // Host and Client declare different sessions services in this combined TS project.
  const sessions = ctx.sessions as unknown as SessionStore
  const runtime = new FolderRuntime(service, id => sessions.get(SessionId(id)), logger)
  ctx.effect(() => installFolderPolicy(ctx.sandboxPolicy, runtime), 'workspace-folders.policy')
  // turn/start precedes prompt assembly. Capturing at pre-step would be too late for that assembly.
  // This read-only snapshot also covers delegated children; no global auto-write occurs per child.
  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start') runtime.begin(session)
    if (event.type === 'turn/end') runtime.end(session)
  })
  ctx.systemPrompt.context({
    name: 'klarkxy:workspace-folders', order: 105, interpolate: false, required: true,
    text: context => context.agent ? runtime.text(context.agent.session) : '',
  })
  ctx.effect(() => registerHostRpc(ctx as Context & HostRpcContext, RPC_CHANNEL,
    (endpoint, payload, signal) => handleRpc(service, endpoint, payload, signal, logger),
    { maxBodyBytes: 256 * 1024, isEndpoint: endpoint => ['get', 'validate', 'save'].includes(endpoint), logger }), 'workspace-folders.rpc')
}
