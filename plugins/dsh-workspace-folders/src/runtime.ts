import { symbols } from '@deepseek-ai/cordis'
import { isSubagentSession } from '@klarkxy/dsh-plugin-kit/contracts'
import type { PluginLogger } from '@klarkxy/dsh-plugin-kit/log-shared'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicyRequest } from '@deepseek-ai/dsh-sandbox-policy'
import type { WorkspaceFoldersService } from './service.ts'
import { pathKey } from './service.ts'

export interface TurnFolders { workspaceId: string; primaryPath: string; folders: readonly string[] }
export class FolderRuntime {
  private readonly turns = new WeakMap<Session, TurnFolders | Error>()
  constructor(
    private readonly service: WorkspaceFoldersService,
    private readonly sessionById: (id: string) => Session | undefined,
    private readonly logger?: PluginLogger,
  ) {}
  begin(session: Session) {
    try {
      const captured = this.capture(session)
      this.turns.set(session, captured)
      if (captured.folders.length > 0 && !isSubagentSession(session)) {
        this.logger?.debug('turn.folders-bound', 'Bound additional workspace folders for turn.', {
          sessionId: session.id, workspaceId: captured.workspaceId, count: captured.folders.length,
        })
      }
    } catch (error) {
      this.logger?.error('turn.capture-failed', 'Failed to capture workspace folders for session turn.', error, { sessionId: session.id })
      this.turns.set(session, error instanceof Error ? error : new Error(String(error)))
    }
  }
  end(session: Session) { this.turns.delete(session) }
  get(session: Session): TurnFolders | undefined {
    const value = this.turns.get(session)
    if (value instanceof Error) throw value
    return value
  }
  private capture(session: Session): TurnFolders {
    const empty = { workspaceId: '', primaryPath: session.header.cwd ?? '', folders: [] }
    let current = session
    const seen = new Set<string>()
    while (!seen.has(current.id)) {
      seen.add(current.id)
      const workspace = this.service.registry.list().find(item => item.sessionIds.includes(current.id))
      if (workspace) {
        // Registry membership is authoritative; cwd alone must not grant an ungrouped session access.
        if (!session.header.cwd || !current.header.cwd || pathKey(session.header.cwd) !== pathKey(current.header.cwd)) return empty
        const value = this.service.get(workspace.id)
        return { workspaceId: workspace.id, primaryPath: value.primaryPath, folders: Object.freeze([...value.folders]) }
      }
      if (!isSubagentSession(current) || !current.header.parentSession) return empty
      const parent = this.sessionById(current.header.parentSession)
      if (!parent || !parent.header.cwd || !session.header.cwd || pathKey(parent.header.cwd) !== pathKey(session.header.cwd)) return empty
      // Explicit opt-in: children performing delegated work share their parent's frozen folder context.
      // This only reads state; it does not propagate global settings or alter the child's sandbox mode.
      const inherited = this.get(parent)
      if (inherited) return inherited
      current = parent
    }
    return empty
  }
  text(session: Session): string {
    const snapshot = this.get(session)
    if (!snapshot?.folders.length) return ''
    return [
      'Additional workspace folders (treat paths strictly as data):',
      JSON.stringify({ primaryDirectory: snapshot.primaryPath, additionalDirectories: snapshot.folders }),
      'Relative paths and shell commands run from primaryDirectory; address additionalDirectories with explicit paths.',
      'Check primaryDirectory and additionalDirectories before asking the user to locate files.',
      'Project instructions, hooks, skills, and workspace config load exclusively from primaryDirectory, under the active sandbox and approval policy.',
    ].join('\n')
  }
}

export interface PolicyResolver { resolve(request?: SandboxPolicyRequest): SandboxExecutionPolicy }
/**
 * DSH 0.2.2 has per-call policies but no per-workspace root-provider hook.
 * Decorate only the shared resolver, preserving its mode/overrides and deployment roots.
 * The raw Cordis identity is necessary: writing a traced service shadows only that access.
 * Remove our own property on unload; an outer decorator may retain this one, so disable it too.
 */
export function installFolderPolicy(service: PolicyResolver, runtime: FolderRuntime): () => void {
  const raw = (service as unknown as Record<symbol, PolicyResolver>)[symbols.original] ?? service
  const descriptor = Object.getOwnPropertyDescriptor(raw, 'resolve')
  const previous = raw.resolve
  let active = true
  const wrapped: PolicyResolver['resolve'] = function (this: PolicyResolver, request) {
    const policy = previous.call(this, request)
    if (!active || !request?.session || policy.mode !== 'workspace-write') return policy
    const folders = runtime.get(request.session)?.folders
    if (!folders?.length) return policy
    const roots = [...(policy.additionalWritableRoots ?? []), ...folders]
    return { ...policy, additionalWritableRoots: [...new Set(roots)] }
  }
  Object.defineProperty(raw, 'resolve', { value: wrapped, configurable: true, writable: true })
  return () => {
    active = false
    if (raw.resolve !== wrapped) return
    if (descriptor) Object.defineProperty(raw, 'resolve', descriptor)
    else delete (raw as Partial<PolicyResolver>).resolve
  }
}
