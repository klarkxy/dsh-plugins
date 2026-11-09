/**
 * Agent-initiated write tools behind two independent opt-in switches.
 *
 * Both paths use the host session domain's own admission rules and never the
 * Remote prompt wrapper: `sessionController.prompt`'s Remote entry stamps a
 * `user-rpc` source (`kind: 'user'`), which would make an agent message read
 * as a human prompt. `agent.followup` queues a next turn and wakes the
 * driver, and the recorded source stays the shared `'agent-message'` relay
 * kind — the same attribution the host's own adjacent-agent delivery uses.
 *
 * fork_session cuts at the caller session's CURRENT last event seq rather
 * than the controller default's completed-turn prefix, so the request that
 * triggered the fork lands in the branch. `buildForkSeed` then appends
 * forked-cause synthetic tool results (never retryable-unchecked errors) and
 * step/turn closers for an open tail, so a cut inside a turn cannot leave a
 * dangling tool call or silently re-execute it in the child.
 */
import { isSubagentSession } from '@klarkxy/dsh-plugin-kit/contracts'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { AGENT_MESSAGE_KIND, PLUGIN_NAME } from './contracts.ts'
import type { CallerExecution } from './caller.ts'
import { callerFromExecution } from './caller.ts'
import type { ToolOutcome } from './query.ts'

/**
 * The host's adjacent-agent delivery source, declared identically in
 * `@deepseek-ai/dsh-subagent`'s continuation-messages. Re-declaring the same
 * member here keeps the source typed where it is produced without taking a
 * runtime dependency on the subagent package; identical member types merge.
 */
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'agent-message': {
      kind: 'agent-message'
      form: 'relay'
      senderSessionId: SessionId
    }
  }
}

export interface ActionAgentLike {
  readonly id: string
  readonly session?: {
    readonly id: string
    readonly header?: unknown
    readonly seq?: number
    snapshotEvents?(): readonly { readonly seq: number }[]
  }
  readonly status?: string
  followup?(message: unknown): void
}

export interface ActionSessionController {
  resolveAgent(id: string): Promise<{ agent?: unknown; error?: { code?: unknown; message?: unknown } }>
  fork?(request: { sessionId: string; atSeq?: number }): Promise<{ sessionId?: string }>
}

export interface ActionWorkspaceRegistry {
  readonly archivedSessionIds?: readonly string[]
}

export interface ActionServices {
  readonly sessionController?: ActionSessionController
  readonly workspaceRegistry?: ActionWorkspaceRegistry
}

export interface ActionHost {
  get?(name: string): unknown
}

export function actionServices(host: ActionHost): ActionServices {
  const get = typeof host.get === 'function' ? host.get.bind(host) : undefined
  return {
    sessionController: get?.('sessionController') as ActionSessionController | undefined,
    workspaceRegistry: get?.('workspaceRegistry') as ActionWorkspaceRegistry | undefined,
  }
}

export interface ForkRequest {
  readonly prompt?: string
}

export interface SendRequest {
  readonly sessionId?: string
  readonly message?: string
}

/** Attribution matching the host's own adjacent-agent delivery shape. */
function agentSource(senderSessionId: SessionId): MessageSource {
  return {
    kind: AGENT_MESSAGE_KIND,
    form: 'relay',
    senderSessionId,
  }
}

/** Human-readable attribution prefix, mirroring the host's delivery convention. */
function relayText(senderSessionId: string, text: string): string {
  return `Agent ${senderSessionId} sent a message: ${text}`
}

const UNAVAILABLE = 'SESSION_ACTION_UNAVAILABLE'
const INVALID = 'SESSION_ACTION_INVALID'
const FAILED = 'SESSION_ACTION_FAILED'
const ARCHIVED = 'SESSION_ACTION_ARCHIVED'
const DISABLED = 'SESSION_ACTION_DISABLED'
const ABORTED = 'SESSION_ACTION_ABORTED'

function unavailable(what: string): ToolOutcome {
  return { status: 'failed', code: UNAVAILABLE, message: `${what} is unavailable on this host` }
}

function failed(code: string, message: string, extra?: { readonly sessionId?: string; readonly partial?: boolean }): ToolOutcome {
  return { status: 'failed', code, message, ...extra }
}

function aborted(): ToolOutcome {
  return { status: 'failed', code: ABORTED, message: 'session action cancelled' }
}

function remoteErrorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown })?.code
  return typeof code === 'string' ? code : undefined
}

/** Report a post-creation failure with the branch identity so a retry cannot fork a second one. */
function partial(outcome: ToolOutcome, sessionId: string): ToolOutcome {
  return { ...outcome, sessionId, partial: true } as ToolOutcome
}

function remoteErrorSessionId(error: unknown): string | undefined {
  const details = (error as { details?: unknown })?.details
  const id = (details as { sessionId?: unknown } | undefined)?.sessionId
  return typeof id === 'string' && id !== '' ? id : undefined
}

function actionError(error: unknown, signal: AbortSignal): ToolOutcome {
  if (signal.aborted || error instanceof Error && error.name === 'AbortError') return aborted()
  const code = remoteErrorCode(error)
  if (code !== undefined) {
    return failed(code, error instanceof Error ? error.message : 'session action failed')
  }
  return failed(FAILED, error instanceof Error ? error.message : 'session action failed')
}

/**
 * Whether the archive set exists and is currently readable. A present
 * registry without a usable `archivedSessionIds` array means archive state
 * cannot be verified — callers fail closed rather than guess unarchived.
 */
function archiveRegistryReady(registry: ActionWorkspaceRegistry | undefined): boolean {
  return registry !== undefined && Array.isArray(registry.archivedSessionIds)
}

/**
 * Fresh read of the durable archive set on EVERY call: the list can change
 * while a resolve is in flight, so nothing snapshots it once and reuses the
 * answer across an await boundary.
 */
function isArchived(registry: ActionWorkspaceRegistry | undefined, sessionId: string): boolean {
  const ids = registry?.archivedSessionIds
  return Array.isArray(ids) && ids.includes(sessionId)
}

/**
 * A message whose followup dispatch may wake the target: abort checks and the
 * archive re-check both precede it. The fork seed prompt stays verbatim — it
 * is the branch's task, not an inter-agent note; only send_session_message
 * carries the host-style attribution prefix.
 */
function relay(
  agent: { followup?(message: unknown): void },
  senderSessionId: SessionId,
  text: string,
  targetSessionId: string,
  prefix: boolean,
): ToolOutcome {
  if (typeof agent.followup !== 'function') {
    return unavailable('Agent follow-up delivery')
  }
  try {
    const message = createUserMessage({
      content: [{ type: 'text' as const, text: prefix ? relayText(senderSessionId, text) : text }],
      source: agentSource(senderSessionId),
    })
    agent.followup(message)
    return { status: 'ok', sessionId: targetSessionId, messageId: message.id }
  } catch (error) {
    return failed(FAILED, error instanceof Error ? error.message : 'the message was not accepted')
  }
}

/**
 * Fork the CALLING session into a new independent session and seed the child
 * with `prompt` as its first turn. The cut is the caller log's latest seq
 * (in-flight turn included); the child gets forked-cause closers for any open
 * tail, so a partially recorded tool call appears as an unknown-outcome
 * error, never as something to retry blindly.
 *
 * Once the host returns a child identity, every later failure reports it
 * with `partial: true`: the branch exists, so retrying the tool call would
 * fork a second one.
 */
export async function forkSession(
  services: ActionServices,
  request: ForkRequest,
  exec: CallerExecution,
  signal: AbortSignal,
  enabled: () => boolean,
): Promise<ToolOutcome> {
  try {
    if (!enabled()) return failed(DISABLED, `${PLUGIN_NAME}: fork_session is disabled`)
    const caller = callerFromExecution(exec)
    const callerSession = exec.agent?.session
    if (caller.sessionId === undefined || callerSession === undefined) {
      return failed(INVALID, 'fork_session requires a calling agent session')
    }
    const prompt = request.prompt?.trim() ?? ''
    if (prompt === '') {
      return failed(INVALID, 'prompt must be a non-empty task for the new session branch')
    }
    const controller = services.sessionController
    if (controller === undefined || typeof controller.fork !== 'function') {
      return unavailable('Session forking')
    }
    const last = callerSession.snapshotEvents?.().at(-1)?.seq
    if (last === undefined) {
      return failed(INVALID, 'the calling session has no events to fork from')
    }
    if (!archiveRegistryReady(services.workspaceRegistry)) {
      return unavailable('The workspace archive registry')
    }
    signal.throwIfAborted()
    let forked: { sessionId?: string }
    try {
      forked = await controller.fork({ sessionId: caller.sessionId, atSeq: last })
    } catch (error) {
      // The host reports the already-created child on workspace attach
      // failures; preserve that identity so nothing forks a second branch.
      const childId = remoteErrorSessionId(error)
      const outcome = actionError(error, signal)
      return childId === undefined ? outcome : partial(outcome, childId)
    }
    const childId = typeof forked?.sessionId === 'string' && forked.sessionId !== '' ? forked.sessionId : undefined
    if (childId === undefined) {
      return failed(FAILED, 'the fork returned no session identity')
    }
    try {
      if (!enabled()) return failed(DISABLED, `${PLUGIN_NAME}: fork_session is disabled`, { sessionId: childId, partial: true })
      signal.throwIfAborted()
      // The child is a new session: archive state cannot belong to a fresh id,
      // but the check stays uniform — never message an archived target.
      if (isArchived(services.workspaceRegistry, childId)) {
        return failed(ARCHIVED, 'the forked session is archived', { sessionId: childId, partial: true })
      }
      let resolved: { agent?: unknown; error?: { code?: unknown; message?: unknown } }
      try {
        resolved = await controller.resolveAgent(childId)
      } catch (error) {
        return partial(actionError(error, signal), childId)
      }
      if ('error' in resolved && resolved.error !== undefined) {
        return failed(typeof resolved.error.code === 'string' ? resolved.error.code : FAILED,
          typeof resolved.error.message === 'string' ? resolved.error.message : 'the forked session could not be resolved',
          { sessionId: childId, partial: true })
      }
      const agent = resolved.agent as ActionAgentLike | undefined
      if (agent === undefined) {
        return failed(FAILED, 'the forked session resolved no agent', { sessionId: childId, partial: true })
      }
      // A disable or unload racing the resolve must not deliver the prompt.
      if (!enabled()) return failed(DISABLED, `${PLUGIN_NAME}: fork_session is disabled`, { sessionId: childId, partial: true })
      signal.throwIfAborted()
      // Post-resolve re-check: an archive landing between resolve and delivery
      // must still block the wake. Fresh read, not the earlier snapshot.
      if (isArchived(services.workspaceRegistry, childId)) {
        return failed(ARCHIVED, 'the forked session was archived before the prompt was delivered', { sessionId: childId, partial: true })
      }
      const outcome = relay(agent, caller.sessionId as SessionId, prompt, childId, false)
      return outcome.status === 'ok' ? outcome : partial(outcome, childId)
    } catch (error) {
      if (signal.aborted || error instanceof Error && error.name === 'AbortError') {
        return partial(aborted(), childId)
      }
      return failed(FAILED, error instanceof Error ? error.message : 'session fork failed', { sessionId: childId, partial: true })
    }
  } catch (error) {
    if (signal.aborted || error instanceof Error && error.name === 'AbortError') return aborted()
    return failed(FAILED, error instanceof Error ? error.message : 'session fork failed')
  }
}

/**
 * Queue an agent-attributed message into another session's inbox and wake its
 * driver. Any unarchived ordinary session may be addressed; archived,
 * self-addressed, and subagent-owned targets are refused, and the archive
 * check runs both before and after the async resolve so a concurrent archive
 * cannot leak a wake.
 */
export async function sendSessionMessage(
  services: ActionServices,
  request: SendRequest,
  exec: CallerExecution,
  signal: AbortSignal,
  enabled: () => boolean,
): Promise<ToolOutcome> {
  try {
    if (!enabled()) return failed(DISABLED, `${PLUGIN_NAME}: send_session_message is disabled`)
    const caller = callerFromExecution(exec)
    if (caller.sessionId === undefined) {
      return failed(INVALID, 'send_session_message requires a calling agent session')
    }
    const targetId = request.sessionId?.trim() ?? ''
    if (targetId === '') {
      return failed(INVALID, 'session_id must be a non-empty target session id')
    }
    if (targetId === caller.sessionId) {
      return failed(INVALID, 'session_id must name another session; this session is the sender')
    }
    const text = request.message?.trim() ?? ''
    if (text === '') {
      return failed(INVALID, 'message must be a non-empty text')
    }
    const controller = services.sessionController
    if (controller === undefined || typeof controller.resolveAgent !== 'function') {
      return unavailable('Session messaging')
    }
    if (!archiveRegistryReady(services.workspaceRegistry)) {
      return unavailable('The workspace archive registry')
    }
    if (isArchived(services.workspaceRegistry, targetId)) {
      return failed(ARCHIVED, `session "${targetId}" is archived`)
    }
    signal.throwIfAborted()
    let resolved: { agent?: unknown; error?: { code?: unknown; message?: unknown } }
    try {
      resolved = await controller.resolveAgent(targetId)
    } catch (error) {
      return actionError(error, signal)
    }
    if ('error' in resolved && resolved.error !== undefined) {
      return failed(typeof resolved.error.code === 'string' ? resolved.error.code : FAILED,
        typeof resolved.error.message === 'string' ? resolved.error.message : 'the target session could not be resolved')
    }
    const agent = resolved.agent as ActionAgentLike | undefined
    if (agent === undefined) {
      return failed(FAILED, 'the target session resolved no agent')
    }
    // resolveAgent can resume an addressable child thread. Refuse it before
    // followup: a subagent inbox is not an ordinary session the tool may wake.
    if (isSubagentSession(agent.session)) {
      return failed(INVALID, 'session_id must name an ordinary session; subagent threads cannot be addressed')
    }
    // A disable or unload racing the resolve must not deliver the message.
    if (!enabled()) return failed(DISABLED, `${PLUGIN_NAME}: send_session_message is disabled`)
    signal.throwIfAborted()
    // Archive race: an archived session's pre-step gate would block the step,
    // but the message would still land in its log — refuse the delivery instead.
    // Fresh read, not the pre-resolve snapshot.
    if (isArchived(services.workspaceRegistry, targetId)) {
      return failed(ARCHIVED, `session "${targetId}" was archived before delivery`)
    }
    return relay(agent, caller.sessionId as SessionId, text, targetId, true)
  } catch (error) {
    if (signal.aborted || error instanceof Error && error.name === 'AbortError') return aborted()
    return failed(FAILED, error instanceof Error ? error.message : 'session message failed')
  }
}
