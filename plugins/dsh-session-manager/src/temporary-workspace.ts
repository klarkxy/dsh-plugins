import { TEMP_WORKSPACE_CHANNEL } from './contracts.ts'

export interface TemporaryWorkspaceHost {
  beginNavigation(): AbortSignal
  allocate(requestId: string, signal: AbortSignal): Promise<{ requestId: string; path: string }>
  createWorkspace(path: string): Promise<{ workspaceId: string }>
  renameWorkspace(workspaceId: string, title: string): Promise<unknown>
  openWorkspace(workspaceId: string, beforeOpen: () => void): Promise<void>
}

export interface TemporaryWorkspaceSnapshot {
  readonly creating: boolean
  readonly failure?: string
}

export function createTemporaryWorkspaceModel(host: TemporaryWorkspaceHost, ids = () => crypto.randomUUID(), label = () => 'Temporary Workspace') {
  const lifetime = new AbortController(), listeners = new Set<() => void>()
  let snapshot: TemporaryWorkspaceSnapshot = { creating: false }
  let pending: { requestId: string; title: string; path?: string; workspaceId?: string; named?: boolean } | undefined
  const publish = (next: TemporaryWorkspaceSnapshot) => {
    if (lifetime.signal.aborted) return
    snapshot = next
    for (const listener of listeners) listener()
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    dismissFailure() { publish({ creating: snapshot.creating }) },
    reportFailure(failure: string) { publish({ ...snapshot, failure }) },
    async create() {
      if (snapshot.creating || lifetime.signal.aborted) return
      // Capture before allocation/adoption so late completion cannot steal a newer navigation.
      const signal = AbortSignal.any([host.beginNavigation(), lifetime.signal])
      const action = pending ??= { requestId: ids(), title: label() }
      let opening = false
      publish({ creating: true })
      try {
        signal.throwIfAborted()
        if (action.path === undefined) {
          const allocated = await host.allocate(action.requestId, signal)
          if (allocated.requestId !== action.requestId || !allocated.path) throw new Error('Invalid temporary workspace response')
          action.path = allocated.path
        }
        signal.throwIfAborted()
        if (action.workspaceId === undefined) action.workspaceId = (await host.createWorkspace(action.path)).workspaceId
        signal.throwIfAborted()
        if (!action.named) {
          await host.renameWorkspace(action.workspaceId, `${action.title} ${action.requestId.slice(0, 8)}`)
          action.named = true
        }
        signal.throwIfAborted()
        opening = true
        await host.openWorkspace(action.workspaceId, () => lifetime.signal.throwIfAborted())
        // openWorkspace starts its own fenced navigation, invalidating our earlier signal.
        if (!lifetime.signal.aborted) pending = undefined
      } catch (error) {
        if (!lifetime.signal.aborted && (opening ? !(error instanceof Error && error.name === 'AbortError') : !signal.aborted)) {
          publish({ creating: false, failure: error instanceof Error ? error.message : 'Could not create the temporary workspace' })
        }
      } finally {
        publish({ ...snapshot, creating: false })
      }
    },
    cancel() { lifetime.abort(); listeners.clear() },
  }
}

export type TemporaryWorkspaceModel = ReturnType<typeof createTemporaryWorkspaceModel>

export function bindTemporaryWorkspaceHost(ctx: {
  layout: { beginNavigation(): AbortSignal }
  connection: { rpc: { call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown> } }
  workspaces: { create(input: { path: string }): Promise<{ workspaceId: string }>; rename(workspaceId: string, title: string): Promise<unknown> }
  uiWorkspace: { openWorkspace(workspaceId: string, beforeOpen?: () => void): Promise<void> }
}): TemporaryWorkspaceHost {
  return {
    beginNavigation: () => ctx.layout.beginNavigation(),
    async allocate(requestId, signal) {
      const raw = await ctx.connection.rpc.call(TEMP_WORKSPACE_CHANNEL, 'temporary.allocate', { requestId }, signal)
      const response = raw as { ok?: boolean; value?: { requestId: string; path: string }; error?: { message?: string } }
      if (response?.ok !== true || typeof response.value?.path !== 'string' || typeof response.value.requestId !== 'string') {
        throw new Error(response?.error?.message ?? 'Could not allocate the temporary workspace')
      }
      return response.value
    },
    createWorkspace: path => ctx.workspaces.create({ path }),
    renameWorkspace: (workspaceId, title) => ctx.workspaces.rename(workspaceId, title),
    openWorkspace: (workspaceId, beforeOpen) => ctx.uiWorkspace.openWorkspace(workspaceId, beforeOpen),
  }
}
