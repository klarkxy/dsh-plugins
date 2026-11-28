import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { posix } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { registerHostRpc, type HostRpcContext } from '@klarkxy/dsh-plugin-kit/host-rpc'
import { isSubagentSession } from '@klarkxy/dsh-plugin-kit/contracts'
import { installPluginLogger, type PluginLogger } from '@klarkxy/dsh-plugin-kit/logger'
import { checkShownView, validateViewAnswer, viewSummary } from './core/index.js'
import { answerText } from './answer-text.ts'
import { DEEP_VIEW_POLICY, DEEP_VIEW_PROMPT } from './prompt.ts'
import { DEEP_VIEW_SKILL, DEEP_VIEW_SKILL_DESCRIPTION } from './skill.ts'
import {
  HOST_SERVICE,
  PLUGIN_NAME,
  RPC_CHANNEL,
  VIEW_OWNER,
  CANVAS_OWNER,
  isRecord,
  type CanvasHealthReport,
  type CanvasPresentation,
  type CanvasProbeDescriptor,
  type DeepViewConfig,
  type DeepViewHost,
  type PendingView,
  type RpcResult,
  type ShownView,
  type ViewNode,
  type ViewPresentation,
  type ViewAnswerMetadata,
  type ViewSnapshot,
} from './contracts.ts'
import { fileAddressFor, isAbsoluteWorkspacePath, sessionFileAddress, sessionFileOf } from './file-address.ts'
import { precheckCanvasHtml, type CanvasPrecheckFinding } from './canvas/precheck.ts'

export const name = 'deep-view'
export const inject = ['tools', 'systemPrompt', 'skills', 'sessionController', 'sessions', 'agents', 'connection', 'webServer'] as const

declare module '@deepseek-ai/cordis' {
  interface Context { [HOST_SERVICE]: DeepViewHost }
}

const MAX_REDIRECTS = 256
const MAX_PRECHECK_BYTES = 4 * 1024 * 1024
export const CANVAS_PROBE_TIMEOUT_MS = 1200

export type PendingWaiter = {
  id: string
  sessionId: string
  callId?: string
  snapshot: ViewSnapshot
  resolve(result: Record<string, unknown>): void
  cleanup(): void
}

export type CanvasProbeWaiter = {
  probeId: string
  sessionId: string
  callId?: string
  path: string
  address: string
  title?: string
  resolve(report: CanvasHealthReport | undefined): void
  cleanup(): void
}

export function resolveSessionId(redirects: ReadonlyMap<string, string>, sessionId: string): string {
  let current = sessionId
  const seen = new Set<string>()
  while (!seen.has(current)) {
    seen.add(current)
    const next = redirects.get(current)
    if (!next) break
    current = next
  }
  return current
}

export function handoffPendingSession(
  pending: Map<string, PendingView>,
  redirects: Map<string, string>,
  fromSessionId: string,
  toSessionId: string,
  waiters?: Map<string, PendingWaiter>,
  canvasProbes?: Map<string, CanvasProbeWaiter>,
): boolean {
  if (!short(fromSessionId, 200) || !short(toSessionId, 200) || fromSessionId === toSessionId) return false
  const source = resolveSessionId(redirects, fromSessionId)
  const target = resolveSessionId(redirects, toSessionId)
  if (source === target) return false
  redirects.set(source, target)
  if (fromSessionId !== source) redirects.set(fromSessionId, target)
  while (redirects.size > MAX_REDIRECTS) {
    const oldest = redirects.keys().next().value
    if (oldest === undefined) break
    redirects.delete(oldest)
  }
  if (canvasProbes) {
    for (const probe of canvasProbes.values()) {
      if (probe.sessionId === source) {
        probe.sessionId = target
        const parsed = sessionFileOf(probe.address)
        if (parsed && parsed.sessionId === source) {
          probe.address = sessionFileAddress(target, parsed.path)
        }
      }
    }
  }
  const record = pending.get(source)
  if (!record) return false
  pending.delete(source)
  if (pending.has(target)) return false
  const nextRecord: PendingView = { ...record, sessionId: target }
  pending.set(target, nextRecord)
  const waiter = waiters?.get(record.id)
  if (waiter) {
    waiter.sessionId = target
    waiter.snapshot = nextRecord
  }
  return true
}

function supersedeSessionWaiters(waiters: Map<string, PendingWaiter> | undefined, sessionId: string, summary: string): void {
  if (!waiters) return
  for (const [viewId, waiter] of [...waiters]) {
    if (waiter.sessionId !== sessionId) continue
    waiters.delete(viewId)
    waiter.cleanup()
    waiter.resolve({
      owner: VIEW_OWNER,
      status: 'superseded',
      viewId,
      revision: waiter.snapshot.revision,
      awaitReply: false,
      summary,
    })
  }
}

type AgentLike = {
  id: string
  session: unknown
  followup(message: ReturnType<typeof createUserMessage>): void
}
// list() includes delegated agents in rc.3; it cannot replace roots(). Older
// hosts can explicitly attest plugin-owned roots. Without that API, use the
// shared persisted-header guard, which admits ordinary human forks too.
const isLiveRoot = (host: Host, agent: AgentLike | undefined): agent is AgentLike => {
  if (!agent || host.agents.get(agent.id) !== agent) return false
  if (typeof host.agents.roots === 'function') return host.agents.roots().some(root => root === agent)
  return isRecord(agent.session) && isRecord(agent.session.header) && !isSubagentSession(agent.session)
}
type Host = Context & HostRpcContext & {
  tools: {
    get(name: string, scope?: object): unknown
    register(definition: Record<string, unknown>): () => void
    restrict?(rule: { deny?: string[]; allow?: string[] }): () => void
  }
  systemPrompt: {
    section?(contribution: {
      name: string
      order: number
      complete?: boolean
      interpolate?: boolean
      text: string | ((context: { agent?: { session?: unknown } }) => string)
    }): () => void
    context(contribution: {
      name: string
      order: number
      required?: boolean
      interpolate?: boolean
      text: string | ((context: { agent?: { session?: unknown } }) => string)
    }): () => void
  }
  skills: {
    register(skill: {
      name: string
      description: string
      whenToUse: string
      content: string
      source: string
      invocation: { modelInvocable: boolean; userInvocable: boolean }
    }): () => void
  }
  agents: { get(id: string): AgentLike | undefined; list?(): AgentLike[]; roots?(): AgentLike[] }
  sessionController: { resolveAgent(id: string): Promise<{ agent?: AgentLike; error?: { message?: string } }> }
  sessions: { flush(session: unknown): Promise<boolean> }
  logger?: { warn(message: string, ...args: unknown[]): void }
}
const ok = <T,>(value: T): RpcResult<T> => ({ ok: true, value })
const fail = (code: string, message: string): RpcResult<never> => ({ ok: false, error: { code, message } })
const short = (value: unknown, max = 160): value is string => typeof value === 'string' && value.length > 0 && value.length <= max
const checkedShown = (title: unknown, view: unknown) => checkShownView(title, view) as ShownView | { error: string }
const isShown = (value: ShownView | { error: string }): value is ShownView => !('error' in value)

// Keep system-prompt policy and runtime-context protocol after core operational
// instructions while staying gated to user-facing root/fork sessions.
const REPLY_INTERFACE_ORDER = 850

function isUserFacingSession(context: { agent?: { session?: unknown } }): boolean {
  const session = context.agent?.session
  return isRecord(session) && isRecord(session.header) && !isSubagentSession(session)
}

function replyInterfacePolicyText(context: { agent?: { session?: unknown } }): string {
  return isUserFacingSession(context) ? DEEP_VIEW_POLICY : ''
}

function replyInterfaceContextText(context: { agent?: { session?: unknown } }): string {
  return isUserFacingSession(context) ? DEEP_VIEW_PROMPT : ''
}

// The host snapshots presentationMeta as JSON on every result, so a result
// without a card reports null; undefined fails the whole call as invalid output.
function presentation(_args: unknown, value: unknown): ViewPresentation | null {
  if (!isRecord(value) || value.owner !== VIEW_OWNER || !['shown', 'pending', 'answered'].includes(String(value.status)) || !isRecord(value.snapshot)) return null
  const snapshot = value.snapshot
  const shown = checkedShown(snapshot.title, snapshot.view)
  if (!isShown(shown) || !short(snapshot.id, 80) || !short(snapshot.sessionId, 200)
    || typeof snapshot.revision !== 'number' || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1) return null
  const answer = value.status === 'answered' && short(value.action, 160) && isRecord(value.values)
    ? { id: snapshot.id, action: value.action, values: value.values, revision: snapshot.revision }
    : undefined
  return {
    owner: VIEW_OWNER, viewId: snapshot.id, ...shown, revision: snapshot.revision,
    awaitReply: value.awaitReply === true,
    ...(snapshot.blocking === true && value.status === 'pending' ? { blocking: true } : {}),
    ...(answer ? { answer } : {}),
  }
}

export function createShowViewTool(
  host: Host,
  pending: Map<string, PendingView>,
  makeId: () => string = randomUUID,
  logger?: PluginLogger,
  latest: Map<string, ViewSnapshot> = new Map(),
  waiters?: Map<string, PendingWaiter>,
): Record<string, unknown> {
  return {
    name: 'show_view',
    description: 'Display or update a live native progress/status card during multi-step work, or present a non-blocking interactive card (options, confirm, form, submit) left open for an optional user answer after the turn ends. Use ask_view instead when execution must pause for the user\'s answer first; for charts, architecture flows, tables and local estimates inside the reply text itself, emit a ```deepui block directly.',
    // tools.register() takes raw JSON Schema; the per-field DSL is only for defineTool().
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Optional short card heading; include when the surrounding prose leaves the subject unnamed.' },
        view: { type: 'object', additionalProperties: true, description: 'One ViewNode object following the Deep View protocol (e.g. steps, progress, options, confirm, form, stack, flow, chart).' },
        await_reply: { type: 'boolean', description: 'Optional boolean; automatically inferred from whether the view contains answer controls (options, confirm, form, submit).' },
        view_id: { type: 'string', description: 'Existing viewId to update in place within this session; omit to create a new card.' },
        base_revision: { type: 'integer', description: 'Latest positive revision being replaced; required when view_id is set.' },
      },
      required: ['view'],
    } satisfies ObjectJsonSchema,
    output: {
      schema: { type: 'object', properties: { owner: { type: 'string', const: VIEW_OWNER }, status: { type: 'string' }, viewId: { type: 'string' }, revision: { type: 'integer', description: 'Positive immutable snapshot revision' }, awaitReply: { type: 'boolean' }, snapshot: { type: 'object', additionalProperties: true }, summary: { type: 'string' } }, required: ['owner', 'status', 'awaitReply', 'summary'], additionalProperties: false },
      render: (_args: unknown, value: { summary?: string }) => [{ type: 'text', text: String(value.summary ?? '') }],
      presentationMeta: presentation,
    },
    async execute(args: unknown, exec: { agent?: AgentLike; callId?: string; concludeTurn(): void }) {
      const input = isRecord(args) ? args : {}
      const shown = checkedShown(input.title, input.view)
      if (!isShown(shown)) {
        logger?.debug('view.invalid', 'Rejected invalid show_view arguments.', {
          sessionId: exec.agent?.id ?? null,
          reason: shown.error,
        })
        return { owner: VIEW_OWNER, status: 'invalid', awaitReply: false, summary: shown.error }
      }
      if (typeof input.await_reply !== 'undefined' && typeof input.await_reply !== 'boolean') {
        return { owner: VIEW_OWNER, status: 'invalid', awaitReply: false, summary: 'await_reply: expected true or false' }
      }
      // Align awaitReply automatically with the card's actual answer controls so
      // models passing await_reply:true on local sliders never fail a valid view.
      const awaitReply = shown.interactive
      const id = exec.agent?.id
      const agent = id === undefined ? undefined : host.agents.get(id)
      const requestedId = input.view_id === undefined ? undefined : input.view_id
      if (requestedId !== undefined && !short(requestedId, 80)) return { owner: VIEW_OWNER, status: 'invalid', awaitReply: false, summary: 'view_id: expected a bounded view id' }
      const current = requestedId === undefined ? undefined : latest.get(requestedId)
      if (requestedId !== undefined && (!current || current.sessionId !== id || !isLiveRoot(host, agent))) {
        return { owner: VIEW_OWNER, status: 'stale', awaitReply: false, summary: 'view_id: no updateable view with this id in the current root session' }
      }
      if (current && input.base_revision !== current.revision) {
        return { owner: VIEW_OWNER, status: 'stale', awaitReply: false, summary: `base_revision: expected ${current.revision}; reload the current view before updating` }
      }
      if (!current && input.base_revision !== undefined) return { owner: VIEW_OWNER, status: 'invalid', awaitReply: false, summary: 'base_revision is only valid when updating an existing view' }
      if (current && current.interactive !== shown.interactive) {
        return { owner: VIEW_OWNER, status: 'invalid', awaitReply: false, summary: 'Create a new view (omit view_id) when switching between display-only and interactive answer controls' }
      }
      if (current?.interactive && (!pending.has(id ?? '') || pending.get(id ?? '')?.id !== current.id)) {
        return { owner: VIEW_OWNER, status: 'stale', awaitReply: false, summary: 'This answer card is already closed; omit view_id to create a new view' }
      }
      if (awaitReply && !isLiveRoot(host, agent)) {
        logger?.debug('view.non-root-rejected', 'Rejected interactive show_view outside a live root session.', {
          sessionId: id ?? null,
        })
        return { owner: VIEW_OWNER, status: 'invalid', awaitReply: false, summary: 'Interactive views require a live root session; state the question or options directly in your reply.' }
      }
      const revision = current ? current.revision + 1 : 1
      const snapshot: ViewSnapshot = {
        ...shown, revision, id: requestedId ?? makeId(), sessionId: id ?? '',
        ...(exec.callId ? { callId: exec.callId } : {}),
      }
      const viewId = snapshot.id
      // Every canonical result owns its complete immutable snapshot. Later
      // updates never mutate this value, so replay remains exact.
      latest.delete(viewId)
      latest.set(viewId, snapshot)
      while (latest.size > 256) latest.delete(latest.keys().next().value!)
      if (awaitReply && agent) {
        supersedeSessionWaiters(waiters, agent.id, 'The previous blocking question card was superseded by a newer interactive view.')
        // set() alone replaces an earlier unanswered card: the old card becomes
        // stale and its pending record points at the newest revision only.
        pending.set(agent.id, snapshot)
      }
      logger?.info('view.prepared', 'Prepared Deep View card.', {
        sessionId: agent?.id ?? id ?? null,
        viewId: viewId ?? null,
        awaitReply,
      })
      return {
        owner: VIEW_OWNER, status: awaitReply ? 'pending' : 'shown', viewId, revision, snapshot, awaitReply,
        // A tool result is process data. The interface may already be visible
        // while the turn runs; the model must still produce its final answer.
        summary: `${current ? `Updated interface revision ${revision}` : 'Interface shown to the user'}. viewId=${viewId}; revision=${revision}. Finish with a concise final answer that complements the card rather than repeating its data. ${viewSummary(shown.view)}${awaitReply ? ' End the turn normally so the user can answer on the card or in the composer.' : ''}`,
      }
    },
    isConcurrencySafe: () => false,
  }
}

export function createAskViewTool(
  host: Host,
  pending: Map<string, PendingView>,
  waiters: Map<string, PendingWaiter> = new Map(),
  makeId: () => string = randomUUID,
  logger?: PluginLogger,
  latest: Map<string, ViewSnapshot> = new Map(),
): Record<string, unknown> {
  return {
    name: 'ask_view',
    description: 'Present a blocking interactive Deep View card (single/multi-select options, custom text input, confirm, form, or multi-question stack of choice/slider/number/toggle inputs + submit/form) and wait for the user\'s validated answer inside the current turn. Prefer ask_view over ask_user_question whenever execution depends on user choices or parameters.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Optional short card heading summarizing the question or form.' },
        view: { type: 'object', additionalProperties: true, description: 'Interactive ViewNode containing at least one answer control (options, confirm, form, or submit).' },
      },
      required: ['view'],
    } satisfies ObjectJsonSchema,
    output: {
      schema: {
        type: 'object',
        properties: {
          owner: { type: 'string', const: VIEW_OWNER },
          status: { type: 'string' },
          viewId: { type: 'string' },
          revision: { type: 'integer' },
          awaitReply: { type: 'boolean' },
          action: { type: 'string' },
          values: { type: 'object', additionalProperties: true },
          answer: { type: 'string' },
          snapshot: { type: 'object', additionalProperties: true },
          summary: { type: 'string' },
        },
        required: ['owner', 'status', 'awaitReply', 'summary'],
        additionalProperties: false,
      },
      render: (_args: unknown, value: { summary?: string }) => [{ type: 'text', text: String(value.summary ?? '') }],
      presentationMeta: presentation,
    },
    async execute(args: unknown, exec: { agent?: AgentLike; callId?: string; signal?: AbortSignal; concludeTurn(): void }) {
      const input = isRecord(args) ? args : {}
      const shown = checkedShown(input.title, input.view)
      if (!isShown(shown)) {
        logger?.debug('ask.invalid', 'Rejected invalid ask_view arguments.', {
          sessionId: exec.agent?.id ?? null,
          reason: shown.error,
        })
        return { owner: VIEW_OWNER, status: 'invalid', awaitReply: false, summary: shown.error }
      }
      if (!shown.interactive) {
        return {
          owner: VIEW_OWNER,
          status: 'invalid',
          awaitReply: false,
          summary: 'ask_view requires at least one interactive answer control (options, confirm, form, or submit). Use show_view or a ```deepui fence for display-only cards.',
        }
      }
      const id = exec.agent?.id
      const agent = id === undefined ? undefined : host.agents.get(id)
      if (!isLiveRoot(host, agent)) {
        logger?.debug('ask.non-root-rejected', 'Rejected ask_view outside a live root session.', { sessionId: id ?? null })
        return {
          owner: VIEW_OWNER,
          status: 'invalid',
          awaitReply: false,
          summary: 'ask_view requires a live root session; state the question or options directly in your reply.',
        }
      }
      if (exec.signal?.aborted) {
        return { owner: VIEW_OWNER, status: 'cancelled', awaitReply: false, summary: 'The question card was cancelled before it could be shown.' }
      }
      const revision = 1
      const snapshot: ViewSnapshot = {
        ...shown,
        revision,
        id: makeId(),
        sessionId: agent.id,
        blocking: true,
        ...(exec.callId ? { callId: exec.callId } : {}),
      }
      const viewId = snapshot.id
      supersedeSessionWaiters(waiters, agent.id, 'The previous blocking question card was superseded by a newer ask_view call.')
      latest.delete(viewId)
      latest.set(viewId, snapshot)
      while (latest.size > 256) latest.delete(latest.keys().next().value!)
      pending.set(agent.id, snapshot)
      logger?.info('ask.waiting', 'Presented blocking Deep View question card.', {
        sessionId: agent.id,
        viewId,
      })
      return await new Promise<Record<string, unknown>>(resolve => {
        const onAbort = () => {
          const waiter = waiters.get(viewId)
          if (!waiter) return
          waiters.delete(viewId)
          if (pending.get(waiter.sessionId)?.id === viewId) pending.delete(waiter.sessionId)
          resolve({
            owner: VIEW_OWNER,
            status: 'cancelled',
            viewId,
            revision,
            awaitReply: false,
            summary: 'The question card was cancelled because the turn was aborted.',
          })
        }
        const cleanup = () => {
          exec.signal?.removeEventListener('abort', onAbort)
        }
        exec.signal?.addEventListener('abort', onAbort, { once: true })
        waiters.set(viewId, {
          id: viewId,
          sessionId: agent.id,
          ...(exec.callId ? { callId: exec.callId } : {}),
          snapshot,
          resolve,
          cleanup,
        })
      })
    },
    isConcurrencySafe: () => false,
  }
}

/** Host workspace-file service reached through optional injection; absent keeps the tool working. */
export type CanvasServices = {
  workspaceFiles?: {
    stat(scope: { sessionId: string; workspaceRoot: string }, path: string, signal: AbortSignal): Promise<{ absolutePath?: string }>
    readBytes?(scope: { sessionId: string; workspaceRoot: string }, path: string, signal: AbortSignal): Promise<{ data?: Uint8Array } | Uint8Array>
  }
  sandboxPolicy?: { workspaceRoot?: string }
}

export type ShowCanvasToolOptions = {
  makeId?: () => string
  probeTimeoutMs?: number
}

function toWorkspaceRelativePath(workspaceRoot: string | undefined, targetPath: string): string | undefined {
  const normalized = targetPath.replace(/\\/gu, '/')
  if (!isAbsoluteWorkspacePath(normalized)) {
    const stripped = normalized.replace(/^(?:\.\/)+/u, '')
    if (stripped === '' || stripped === '.' || stripped === '..' || stripped.startsWith('../')) return undefined
    return stripped
  }
  if (workspaceRoot === undefined || workspaceRoot === '') return undefined
  const root = workspaceRoot.replace(/\\/gu, '/').replace(/\/+$/u, '')
  if (root === '') return undefined
  const withinRoot = /^[A-Za-z]:/u.test(root)
    ? normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)
    : normalized.startsWith(`${root}/`)
  if (!withinRoot) return undefined
  const rel = normalized.slice(root.length + 1).replace(/^(?:\.\/)+/u, '')
  if (rel === '' || rel === '.' || rel === '..' || rel.startsWith('../')) return undefined
  return rel
}

function resolveRelativeWorkspacePath(
  baseFilePath: string,
  relativeDepPath: string,
  workspaceRoot?: string,
): string | undefined {
  if (relativeDepPath === '' || relativeDepPath.includes('\\') || relativeDepPath.includes('\0') || posix.isAbsolute(relativeDepPath)) {
    return undefined
  }
  const normalizedBase = toWorkspaceRelativePath(workspaceRoot, baseFilePath)
  if (normalizedBase === undefined) return undefined
  const baseDir = posix.dirname(normalizedBase)
  const joined = baseDir === '.' ? posix.normalize(relativeDepPath) : posix.normalize(posix.join(baseDir, relativeDepPath))
  if (joined === '' || joined === '.' || joined === '..' || joined.startsWith('../') || posix.isAbsolute(joined)) {
    return undefined
  }
  return joined
}

async function readWorkspaceUtf8(
  workspaceFiles: CanvasServices['workspaceFiles'],
  scope: { sessionId: string; workspaceRoot: string },
  relativePath: string,
  absolutePath: string | undefined,
  signal: AbortSignal,
): Promise<string | undefined> {
  if (typeof workspaceFiles?.readBytes === 'function') {
    try {
      const result = await workspaceFiles.readBytes(scope, relativePath, signal)
      const bytes = result instanceof Uint8Array
        ? result
        : isRecord(result) && result.data instanceof Uint8Array
          ? result.data
          : undefined
      if (bytes && bytes.byteLength <= MAX_PRECHECK_BYTES) {
        return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
      }
    } catch {
      return undefined
    }
  }
  if (typeof absolutePath === 'string' && absolutePath !== '') {
    try {
      const buf = await readFile(absolutePath, { signal })
      if (buf.byteLength <= MAX_PRECHECK_BYTES) return buf.toString('utf8')
    } catch {
      // Unmocked or virtual paths after a passing `stat` skip content precheck gracefully.
      return undefined
    }
  }
  return undefined
}

/** presentationMeta only for a shown canvas: the client card keys on `owner`. */
function canvasPresentation(_args: unknown, value: unknown): CanvasPresentation | null {
  if (!isRecord(value) || value.owner !== CANVAS_OWNER || value.status !== 'shown') return null
  if (!short(value.path, 1024) || !short(value.address, 4096)) return null
  return {
    owner: CANVAS_OWNER, path: value.path, address: value.address,
    ...(short(value.title, 120) ? { title: value.title } : {}),
  }
}

export function createShowCanvasTool(
  host: Host,
  services: { current: CanvasServices },
  logger?: PluginLogger,
  probes?: Map<string, CanvasProbeWaiter>,
  options?: ShowCanvasToolOptions,
): Record<string, unknown> {
  const makeId = options?.makeId ?? randomUUID
  const rawProbeTimeout = options?.probeTimeoutMs
  const probeTimeoutMs = typeof rawProbeTimeout === 'number' && Number.isFinite(rawProbeTimeout)
    ? Math.max(0, Math.trunc(rawProbeTimeout))
    : CANVAS_PROBE_TIMEOUT_MS
  return {
    name: 'show_canvas',
    description: 'Open a runnable preview of an HTML file in the right Sidebar with static syntax/asset prechecks and a bounded first-paint health check. Write the .html file with the write tool first, then call this once; later edit tool changes refresh the preview automatically.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace path of the .html/.htm file to preview.' },
        title: { type: 'string', description: 'Optional short label for the preview card.' },
      },
      required: ['path'],
    } satisfies ObjectJsonSchema,
    output: {
      schema: { type: 'object', properties: { owner: { type: 'string', const: CANVAS_OWNER }, status: { type: 'string' }, path: { type: 'string' }, address: { type: 'string' }, title: { type: 'string' }, summary: { type: 'string' } }, required: ['owner', 'status', 'summary'], additionalProperties: false },
      render: (_args: unknown, value: { summary?: string }) => [{ type: 'text', text: String(value.summary ?? '') }],
      presentationMeta: canvasPresentation,
    },
    async execute(args: unknown, exec: { agent?: AgentLike; callId?: string; signal?: AbortSignal; concludeTurn(): void }) {
      const input = isRecord(args) ? args : {}
      if (!short(input.path, 1024)) return { owner: CANVAS_OWNER, status: 'invalid', summary: 'path: expected a file path of at most 1024 characters' }
      if (input.title !== undefined && !short(input.title, 120)) return { owner: CANVAS_OWNER, status: 'invalid', summary: 'title: expected a string of at most 120 characters' }
      const path = input.path.trim()
      if (path === '' || !/\.html?$/iu.test(path)) return { owner: CANVAS_OWNER, status: 'invalid', summary: 'path: expected an .html or .htm file' }
      const id = exec.agent?.id
      const agent = id === undefined ? undefined : host.agents.get(id)
      if (!isLiveRoot(host, agent)) {
        logger?.debug('canvas.non-root-rejected', 'Rejected show_canvas outside a live root session.', { sessionId: id ?? null })
        return { owner: CANVAS_OWNER, status: 'invalid', summary: 'Canvas preview requires a live root session; share the file path directly in your reply.' }
      }
      if (exec.signal?.aborted) {
        return { owner: CANVAS_OWNER, status: 'cancelled', path, summary: 'Canvas preview was cancelled before it could be opened.' }
      }
      const header = isRecord(agent.session) && isRecord(agent.session.header) ? agent.session.header : undefined
      const cwd = typeof header?.cwd === 'string' && header.cwd !== '' ? header.cwd : undefined
      const { workspaceFiles, sandboxPolicy } = services.current
      const workspaceRoot = cwd ?? (typeof sandboxPolicy?.workspaceRoot === 'string' && sandboxPolicy.workspaceRoot !== '' ? sandboxPolicy.workspaceRoot : undefined)
      let absolutePath: string | undefined
      const signal = exec.signal ? AbortSignal.any([exec.signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000)
      if (workspaceFiles && workspaceRoot !== undefined) {
        const scope = { sessionId: agent.id, workspaceRoot }
        try {
          const stat = await workspaceFiles.stat(scope, path, signal)
          absolutePath = typeof stat?.absolutePath === 'string' ? stat.absolutePath : undefined
        } catch (error) {
          logger?.debug('canvas.missing', 'show_canvas stat failed.', { sessionId: agent.id, path, reason: error instanceof Error ? error.message : String(error) })
          return { owner: CANVAS_OWNER, status: 'missing', path, summary: `File "${path}" is missing or unreadable; create it with the write tool first, then call show_canvas.` }
        }
      }
      const address = fileAddressFor(agent.id, workspaceRoot, absolutePath ?? path)
      const title = typeof input.title === 'string' ? input.title : undefined
      // Register the first-paint probe immediately after root stat — before multi-asset
      // static precheck I/O — so live clients polling `canvas.probe` or hot-reloading an
      // already-open tab never race ahead of probe registration.
      let probePromise: Promise<{ kind: 'settled'; report: CanvasHealthReport | undefined } | { kind: 'aborted' }> | undefined
      let activeProbeId: string | undefined
      if (probes !== undefined && probeTimeoutMs > 0) {
        if (exec.signal?.aborted) {
          return { owner: CANVAS_OWNER, status: 'cancelled', path, summary: 'Canvas preview was cancelled because the turn was aborted.' }
        }
        const probeId = makeId()
        activeProbeId = probeId
        probePromise = new Promise(resolve => {
          let timer: ReturnType<typeof setTimeout> | undefined
          const cleanup = () => {
            if (timer !== undefined) clearTimeout(timer)
            exec.signal?.removeEventListener('abort', onAbort)
          }
          const onAbort = () => {
            if (!probes.has(probeId)) return
            probes.delete(probeId)
            cleanup()
            resolve({ kind: 'aborted' })
          }
          exec.signal?.addEventListener('abort', onAbort, { once: true })
          timer = setTimeout(() => {
            if (!probes.has(probeId)) return
            probes.delete(probeId)
            cleanup()
            resolve({ kind: 'settled', report: undefined })
          }, probeTimeoutMs)
          timer.unref?.()
          probes.set(probeId, {
            probeId,
            sessionId: agent.id,
            ...(exec.callId !== undefined ? { callId: exec.callId } : {}),
            path,
            address,
            ...(title !== undefined ? { title } : {}),
            cleanup,
            resolve: report => resolve({ kind: 'settled', report }),
          })
        })
      }

      let staticFindings: CanvasPrecheckFinding[] = []
      if (workspaceFiles && workspaceRoot !== undefined) {
        const scope = { sessionId: agent.id, workspaceRoot }
        const readKey = toWorkspaceRelativePath(workspaceRoot, absolutePath ?? path) ?? path
        const htmlText = await readWorkspaceUtf8(workspaceFiles, scope, readKey, absolutePath, signal)
        if (htmlText !== undefined) {
          staticFindings = await precheckCanvasHtml(htmlText, path, async relativeDep => {
            const depWorkspacePath = resolveRelativeWorkspacePath(absolutePath ?? path, relativeDep, workspaceRoot)
            if (depWorkspacePath === undefined) return { exists: false }
            try {
              const depStat = await workspaceFiles.stat(scope, depWorkspacePath, signal)
              const depAbs = typeof depStat?.absolutePath === 'string' ? depStat.absolutePath : undefined
              const depText = await readWorkspaceUtf8(workspaceFiles, scope, depWorkspacePath, depAbs, signal)
              return { exists: true, ...(depText !== undefined ? { text: depText } : {}) }
            } catch {
              return { exists: false }
            }
          })
        }
      }

      let probeReport: CanvasHealthReport | undefined
      if (probePromise !== undefined) {
        const outcome = await probePromise
        if (outcome.kind === 'aborted') {
          if (activeProbeId !== undefined) probes?.delete(activeProbeId)
          return { owner: CANVAS_OWNER, status: 'cancelled', path, summary: 'Canvas preview was cancelled because the turn was aborted.' }
        }
        probeReport = outcome.report
      }

      const runtimeDiagnostics: string[] = []
      if (probeReport !== undefined) {
        for (const err of probeReport.errors) runtimeDiagnostics.push(err)
        if (probeReport.collapsed) {
          runtimeDiagnostics.push('Document body rendered with 0px height (document.body.scrollHeight === 0); check missing height/content or early script failure.')
        }
      }

      const hasErrors = staticFindings.some(item => item.severity === 'error') || runtimeDiagnostics.length > 0
      const hasWarnings = staticFindings.some(item => item.severity === 'warn')
      const sections: string[] = [
        `Canvas preview opened in the right Sidebar for ${path}. Subsequent edits with the edit tool refresh the preview automatically; call show_canvas again only if the user asks to reopen it.`,
      ]
      if (staticFindings.length > 0) {
        sections.push(`Static precheck diagnostics:\n${staticFindings.map((item, idx) => `${idx + 1}. [${item.severity}] ${item.message}`).join('\n')}`)
      }
      if (runtimeDiagnostics.length > 0) {
        sections.push(`First-paint runtime diagnostics:\n${runtimeDiagnostics.map((line, idx) => `${idx + 1}. ${line}`).join('\n')}`)
      }
      sections.push(
        hasErrors
          ? 'Fix the errors above in this turn with the edit tool (the open preview refreshes automatically), then finish with a concise final answer.'
          : hasWarnings
            ? 'Review the warnings above and update the file with the edit tool if unintended, then finish with a concise final answer.'
            : 'Finish with a concise final answer.',
      )

      logger?.info('canvas.shown', 'Opened Deep View canvas preview.', {
        sessionId: agent.id,
        path,
        staticIssues: staticFindings.length,
        runtimeIssues: runtimeDiagnostics.length,
      })
      return {
        owner: CANVAS_OWNER,
        status: 'shown',
        path,
        address,
        ...(title !== undefined ? { title } : {}),
        summary: sections.join('\n\n').replace('.\n\nFinish with a concise final answer.', '. Finish with a concise final answer.'),
      }
    },
    isConcurrencySafe: () => false,
  }
}

export function createRpc(
  host: Host,
  pending: Map<string, PendingView>,
  redirects: ReadonlyMap<string, string> = new Map(),
  logger?: PluginLogger,
  waiters: Map<string, PendingWaiter> = new Map(),
  latest: Map<string, ViewSnapshot> = new Map(),
  canvasProbes: Map<string, CanvasProbeWaiter> = new Map(),
) {
  const claims = new Set<string>()
  return async (endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResult> => {
    if (!isRecord(payload) || !short(payload.sessionId, 200)) return fail('bad-request', 'A bounded sessionId is required')
    const sessionId = resolveSessionId(redirects, payload.sessionId)
    if (endpoint === 'canvas.probe') {
      const callId = short(payload.callId, 200) ? payload.callId : undefined
      const address = short(payload.address, 4096) ? payload.address : undefined
      let matched: CanvasProbeWaiter | undefined
      const targetFile = address !== undefined ? sessionFileOf(address) : undefined
      for (const probe of canvasProbes.values()) {
        if (probe.sessionId !== sessionId) continue
        if (callId !== undefined && probe.callId === callId) { matched = probe; break }
        if (callId === undefined && address !== undefined) {
          if (probe.address === address) { matched = probe; break }
          if (targetFile !== undefined && sessionFileOf(probe.address)?.path === targetFile.path) { matched = probe; break }
        }
      }
      const descriptor: CanvasProbeDescriptor | null = matched
        ? {
            probeId: matched.probeId,
            path: matched.path,
            address: matched.address,
            ...(matched.title !== undefined ? { title: matched.title } : {}),
          }
        : null
      return ok(descriptor)
    }
    if (endpoint === 'canvas.report') {
      if (!short(payload.probeId, 120)) return fail('bad-request', 'A bounded probeId is required')
      const waiter = canvasProbes.get(payload.probeId)
      // Single-consumer idempotency: only the first matching client report settles the probe;
      // duplicate reports from extra tabs or late arrivals after timeout become safe no-ops.
      if (!waiter || waiter.sessionId !== sessionId) return ok({ accepted: false })
      canvasProbes.delete(waiter.probeId)
      waiter.cleanup()
      const rawErrors = Array.isArray(payload.errors) ? payload.errors : []
      const errors = rawErrors
        .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
        .slice(0, 20)
        .map(item => item.slice(0, 1000))
      waiter.resolve({ collapsed: payload.collapsed === true, errors })
      logger?.debug('canvas.probe-settled', 'Settled first-paint canvas health probe.', {
        sessionId,
        probeId: waiter.probeId,
        collapsed: payload.collapsed === true,
        errorCount: errors.length,
      })
      return ok({ accepted: true })
    }
    const record = pending.get(sessionId)
    if (endpoint === 'pending') return ok(record?.callId === payload.callId || payload.callId === undefined ? record ?? null : null)
    if (endpoint === 'dismiss') {
      if (record && record.id === payload.viewId) {
        pending.delete(sessionId)
        const waiter = waiters.get(record.id)
        if (waiter) {
          waiters.delete(record.id)
          waiter.cleanup()
          waiter.resolve({
            owner: VIEW_OWNER,
            status: 'dismissed',
            viewId: record.id,
            revision: record.revision,
            snapshot: record,
            awaitReply: false,
            summary: 'The user dismissed the question card without answering. Proceed with sensible defaults or ask briefly in text if blocked.',
          })
        }
        logger?.debug('view.dismissed', 'Dismissed pending Deep View card.', { sessionId, viewId: record.id })
      }
      return ok(true)
    }
    if (endpoint === 'defer') {
      if (!record || !short(payload.viewId, 80) || payload.viewId !== record.id) {
        return fail('stale', 'This view is no longer open')
      }
      const asyncRecord: PendingView = { ...record, blocking: false }
      pending.set(sessionId, asyncRecord)
      latest.set(record.id, asyncRecord)
      const waiter = waiters.get(record.id)
      if (waiter) {
        waiters.delete(record.id)
        waiter.cleanup()
        waiter.resolve({
          owner: VIEW_OWNER,
          status: 'pending',
          viewId: record.id,
          revision: record.revision,
          snapshot: asyncRecord,
          awaitReply: true,
          summary: `The user clicked "Continue first" to let you proceed now while keeping the card open for an asynchronous answer (viewId=${record.id}; revision=${record.revision}). Proceed with sensible provisional defaults and finish with a concise reply so the user can answer on the card when ready.`,
        })
      }
      logger?.info('view.deferred', 'Downgraded blocking ask_view card to asynchronous pending card.', { sessionId, viewId: record.id })
      return ok({ deferred: true, value: asyncRecord })
    }
    if (endpoint !== 'reply') return fail('not-found', 'Unknown Deep View endpoint')
    if (!record || !short(payload.viewId, 80) || payload.viewId !== record.id || !short(payload.action, 160) || !isRecord(payload.values)
      || !(payload.revision === record.revision || payload.revision === undefined && record.revision === 1)) {
      logger?.debug('reply.stale', 'Rejected reply for stale or closed Deep View card.', { sessionId })
      return fail('stale', 'This view is no longer open')
    }
    if (claims.has(record.id)) return fail('busy', 'This view is already being answered')
    const checked = validateViewAnswer(record.view as ViewNode, payload.action, payload.values) as { error?: string } & Record<string, unknown>
    if (checked.error !== undefined) {
      logger?.debug('reply.invalid', 'Rejected invalid Deep View reply.', {
        sessionId,
        viewId: record.id,
        action: payload.action,
        reason: checked.error,
      })
      return fail('invalid', checked.error)
    }
    const waiter = waiters.get(record.id)
    if (waiter) {
      if (signal.aborted) return fail('cancelled', 'The request was cancelled')
      const live = host.agents.get(sessionId)
      if (!isLiveRoot(host, live)) return fail('stale', 'The session is no longer a live root session')
      pending.delete(sessionId)
      waiters.delete(record.id)
      waiter.cleanup()
      const text = answerText(record, payload.action, checked)
      waiter.resolve({
        owner: VIEW_OWNER,
        status: 'answered',
        viewId: record.id,
        revision: record.revision,
        snapshot: record,
        awaitReply: true,
        action: payload.action,
        values: checked,
        answer: text,
        summary: `User answered Deep View card (viewId=${record.id}):\n${text}`,
      })
      logger?.info('reply.resumed', 'Resolved blocking ask_view call with validated user answer.', {
        sessionId,
        viewId: record.id,
        action: payload.action,
      })
      return ok({ answered: true, resumed: true })
    }
    claims.add(record.id)
    pending.delete(sessionId)
    // Exact-once: the record is restored only when followup never appended a
    // user message. Once appended, a failed checkpoint may lose the card from
    // disk, but re-adding the record would let a retry send the same user
    // answer a second time. Restoration lives in the finally so cancellation
    // returns, resolve failures and append failures share one path.
    let appended = false
    try {
      if (signal.aborted) return fail('cancelled', 'The request was cancelled')
      // A live root answers directly. Plugin-owned root sessions (for example a
      // chat drawn by its own plugin under the subagent origin) are refused by the
      // session controller, so it is only asked to resume sessions that are not live.
      const live = host.agents.get(sessionId)
      const resolved = isLiveRoot(host, live) ? { agent: live } : await host.sessionController.resolveAgent(sessionId)
      const agent = resolved.agent
      if (!agent || host.agents.get(agent.id) !== agent || !isLiveRoot(host, agent)) throw new Error(('error' in resolved ? resolved.error?.message : undefined) ?? 'The session is not a live root session')
      if (signal.aborted) return fail('cancelled', 'The request was cancelled')
      // Text and answer facts share one durable message: neither can survive
      // without the other, and fork/history boundaries preserve their pairing.
      const deepView: ViewAnswerMetadata = {
        owner: VIEW_OWNER, version: 1,
        answer: { id: record.id, action: payload.action, values: checked, revision: record.revision },
      }
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: answerText(record, payload.action, checked) }],
        source: { kind: 'user', deepView },
      }))
      appended = true
      await host.sessions.flush(agent.session)
      logger?.info('reply.submitted', 'Submitted Deep View reply to live session.', {
        sessionId: agent.id,
        viewId: record.id,
        action: payload.action,
      })
      return ok({ answered: true })
    } catch (error) {
      logger?.error('reply.failed', 'Failed to deliver Deep View reply.', error, {
        sessionId,
        viewId: record.id,
        action: payload.action,
        appended,
      })
      return fail('internal', error instanceof Error ? error.message : String(error))
    } finally {
      if (!appended && !pending.has(sessionId)) pending.set(sessionId, record)
      claims.delete(record.id)
    }
  }
}

export async function apply(ctx: Context, config?: DeepViewConfig): Promise<void> {
  const host = ctx as unknown as Host
  const logger = installPluginLogger(ctx, PLUGIN_NAME, { forwardHostWarnError: false })
  const pending = new Map<string, PendingView>()
  const redirects = new Map<string, string>()
  const latest = new Map<string, ViewSnapshot>()
  const waiters = new Map<string, PendingWaiter>()
  const canvasProbes = new Map<string, CanvasProbeWaiter>()
  const canvasServices: { current: CanvasServices } = { current: {} }
  // Optional host services arrive through their own inject scopes so a missing
  // workspace file service or sandbox policy never blocks this bundle loading.
  ctx.inject?.(['workspaceFiles'], injected => {
    const scope = injected as Context & CanvasServices
    canvasServices.current.workspaceFiles = scope.workspaceFiles
    scope.effect(() => () => { canvasServices.current.workspaceFiles = undefined })
  })
  ctx.inject?.(['sandboxPolicy'], injected => {
    const scope = injected as Context & CanvasServices
    canvasServices.current.sandboxPolicy = scope.sandboxPolicy
    scope.effect(() => () => { canvasServices.current.sandboxPolicy = undefined })
  })
  ctx.effect(() => host.skills.register({
    name: 'deep-view',
    description: DEEP_VIEW_SKILL_DESCRIPTION,
    whenToUse: DEEP_VIEW_SKILL_DESCRIPTION,
    content: DEEP_VIEW_SKILL,
    source: 'runtime',
    invocation: { modelInvocable: true, userInvocable: true },
  }), 'deep-view.skill')
  ctx.provide(HOST_SERVICE, {
    handoffSession: (fromSessionId, toSessionId) => {
      const moved = handoffPendingSession(pending, redirects, fromSessionId, toSessionId, waiters, canvasProbes)
      if (moved) {
        const current = pending.get(toSessionId)
        if (current) latest.set(current.id, current)
        logger.debug('session.handoff', 'Moved pending Deep View card across session handoff.', { fromSessionId, toSessionId })
      }
      return moved
    },
  })
  // Pair a concise system-prompt policy section (active in standard presets)
  // with one required runtime context (carrying the full protocol across all
  // presets, including complete custom prompts or suppressed optional contexts).
  ctx.effect(() => {
    if (host.tools.get('show_view')) {
      logger.warn('tool.already-registered', 'show_view is already registered by another plugin; skipping registration.')
      host.logger?.warn('deep-view: show_view is already registered by another plugin; this bundle stays disabled for its own tool')
      return () => {}
    }
    let disposeTool: () => void
    let disposeAskTool: (() => void) | undefined
    try {
      disposeTool = host.tools.register(createShowViewTool(host, pending, randomUUID, logger, latest, waiters))
    }
    catch (error) {
      logger.warn('tool.register-failed', 'show_view tool registration failed.', error)
      host.logger?.warn('deep-view: show_view registration skipped: %s', error instanceof Error ? error.message : String(error))
      return () => {}
    }
    if (!host.tools.get('ask_view')) {
      try {
        disposeAskTool = host.tools.register(createAskViewTool(host, pending, waiters, randomUUID, logger, latest))
      } catch (error) {
        logger.warn('tool.register-failed', 'ask_view tool registration failed.', error)
        host.logger?.warn('deep-view: ask_view registration skipped: %s', error instanceof Error ? error.message : String(error))
      }
    }
    let disposeSection: (() => void) | undefined
    let disposeContext: () => void
    try {
      disposeSection = host.systemPrompt.section?.({
        name: 'deep-view:policy',
        order: REPLY_INTERFACE_ORDER,
        interpolate: false,
        text: replyInterfacePolicyText,
      })
      disposeContext = host.systemPrompt.context({
        name: 'deep-view:reply-interface',
        order: REPLY_INTERFACE_ORDER,
        required: true,
        interpolate: false,
        text: replyInterfaceContextText,
      })
    }
    catch (error) {
      disposeSection?.()
      disposeAskTool?.()
      disposeTool()
      logger.warn('prompt.register-failed', 'Deep View reply context was not registered.', error)
      host.logger?.warn('deep-view: reply context registration skipped: %s', error instanceof Error ? error.message : String(error))
      return () => {}
    }
    return () => {
      for (const [viewId, waiter] of [...waiters]) {
        waiters.delete(viewId)
        waiter.cleanup()
        waiter.resolve({ owner: VIEW_OWNER, status: 'cancelled', viewId, revision: waiter.snapshot.revision, awaitReply: false, summary: 'Deep View plugin was unloaded while waiting for an answer.' })
      }
      disposeContext()
      disposeSection?.()
      disposeAskTool?.()
      disposeTool()
    }
  }, 'deep-view.tool')
  if (config?.replaceNativeAskUser === true && typeof host.tools.restrict === 'function') {
    ctx.effect(() => {
      try {
        return host.tools.restrict!({ deny: ['ask_user_question'] })
      } catch (error) {
        logger.warn('tool.restrict-failed', 'Could not restrict native ask_user_question.', error)
        return () => {}
      }
    }, 'deep-view.restrict-native-ask')
  }
  ctx.effect(() => {
    if (host.tools.get('show_canvas')) {
      logger.warn('tool.already-registered', 'show_canvas is already registered by another plugin; skipping registration.')
      host.logger?.warn('deep-view: show_canvas is already registered by another plugin; this bundle stays disabled for the canvas tool')
      return () => {}
    }
    try {
      const disposeCanvas = host.tools.register(createShowCanvasTool(host, canvasServices, logger, canvasProbes))
      return () => {
        for (const [probeId, probe] of [...canvasProbes]) {
          canvasProbes.delete(probeId)
          probe.cleanup()
          probe.resolve(undefined)
        }
        disposeCanvas()
      }
    }
    catch (error) {
      logger.warn('tool.register-failed', 'show_canvas tool registration failed.', error)
      host.logger?.warn('deep-view: show_canvas registration skipped: %s', error instanceof Error ? error.message : String(error))
      return () => {}
    }
  }, 'deep-view.canvas')
  // Only admission events are observed, never scanned. A new human message closes a stale card.
  ctx.effect(() => ctx.on('session/event', (session: { id: string }, event: { type: string; data?: unknown }) => {
    if (event.type !== 'user/message' || !isRecord(event.data) || !isRecord(event.data.source) || event.data.source.kind !== 'user') return
    const resolvedId = resolveSessionId(redirects, session.id)
    pending.delete(resolvedId)
    supersedeSessionWaiters(waiters, resolvedId, 'The question card was superseded by a new user message.')
  }), 'deep-view.close-pending')
  ctx.effect(() => registerHostRpc(host, RPC_CHANNEL, createRpc(host, pending, redirects, logger, waiters, latest, canvasProbes), { maxBodyBytes: 24 * 1024, logger }), 'deep-view.rpc')
}
