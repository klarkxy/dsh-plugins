import { randomUUID } from 'node:crypto'
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
import { HOST_SERVICE, PLUGIN_NAME, RPC_CHANNEL, VIEW_OWNER, CANVAS_OWNER, isRecord, type CanvasPresentation, type DeepViewHost, type PendingView, type RpcResult, type ShownView, type ViewNode, type ViewPresentation, type ViewAnswerMetadata, type ViewSnapshot } from './contracts.ts'
import { fileAddressFor } from './file-address.ts'

export const name = 'deep-view'
export const inject = ['tools', 'systemPrompt', 'skills', 'sessionController', 'sessions', 'agents', 'connection', 'webServer'] as const

declare module '@deepseek-ai/cordis' {
  interface Context { [HOST_SERVICE]: DeepViewHost }
}

const MAX_REDIRECTS = 256

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
  const record = pending.get(source)
  if (!record) return false
  pending.delete(source)
  if (pending.has(target)) return false
  pending.set(target, { ...record, sessionId: target })
  return true
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
  if (!isRecord(value) || value.owner !== VIEW_OWNER || !['shown', 'pending'].includes(String(value.status)) || !isRecord(value.snapshot)) return null
  const snapshot = value.snapshot
  const shown = checkedShown(snapshot.title, snapshot.view)
  if (!isShown(shown) || !short(snapshot.id, 80) || !short(snapshot.sessionId, 200)
    || typeof snapshot.revision !== 'number' || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1) return null
  return {
    owner: VIEW_OWNER, viewId: snapshot.id, ...shown, revision: snapshot.revision,
    awaitReply: value.awaitReply === true,
  }
}

export function createShowViewTool(
  host: Host,
  pending: Map<string, PendingView>,
  makeId: () => string = randomUUID,
  logger?: PluginLogger,
  latest: Map<string, ViewSnapshot> = new Map(),
): Record<string, unknown> {
  return {
    name: 'show_view',
    description: 'Display or update a live native progress/status card during multi-step work, or present an interactive card (options, confirm, form, submit) that collects a Host-validated user answer. For charts, architecture flows, tables and local estimates inside the reply text itself, emit a ```deepui block directly.',
    // tools.register() takes raw JSON Schema; the per-field DSL is only for defineTool().
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Optional short card heading; omit when the surrounding text already names the subject.' },
        view: { type: 'object', additionalProperties: true, description: 'One ViewNode object following the Deep View protocol (e.g. steps, progress, options, confirm, form, stack, flow, chart).' },
        await_reply: { type: 'boolean', description: 'Optional boolean; automatically inferred from whether the view contains answer controls (options, confirm, form, submit).' },
        view_id: { type: 'string', description: 'Existing viewId to replace in place within this session. Omit when creating a new view.' },
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
        return { owner: VIEW_OWNER, status: 'invalid', awaitReply: false, summary: 'Changing answer controls requires a new view, not an in-place update' }
      }
      if (current?.interactive && (!pending.has(id ?? '') || pending.get(id ?? '')?.id !== current.id)) {
        return { owner: VIEW_OWNER, status: 'stale', awaitReply: false, summary: 'This answer has already closed; create a new view instead of updating it' }
      }
      if (awaitReply && !isLiveRoot(host, agent)) {
        logger?.debug('view.non-root-rejected', 'Rejected interactive show_view outside a live root session.', {
          sessionId: id ?? null,
        })
        return { owner: VIEW_OWNER, status: 'invalid', awaitReply: false, summary: 'An interactive view only works in a live root session. Put the question or decision in your response instead.' }
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
        summary: `${current ? `Updated interface revision ${revision}` : 'Interface shown to the user'}. viewId=${viewId}; revision=${revision}. Finish with a concise final answer; do not repeat its data or create a duplicate view. ${viewSummary(shown.view)}${awaitReply ? ' The user can answer this revision directly or fill the composer; do not wait or poll.' : ''}`,
      }
    },
    isConcurrencySafe: () => false,
  }
}

/** Host workspace-file service reached through optional injection; absent keeps the tool working. */
export type CanvasServices = {
  workspaceFiles?: {
    stat(scope: { sessionId: string; workspaceRoot: string }, path: string, signal: AbortSignal): Promise<{ absolutePath?: string }>
  }
  sandboxPolicy?: { workspaceRoot?: string }
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
): Record<string, unknown> {
  return {
    name: 'show_canvas',
    description: 'Open a runnable preview of an HTML file in the right Sidebar. Write the .html file with the write tool first, then call this once; later edit tool changes refresh the preview automatically.',
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
      const path = input.path
      if (!/\.html?$/iu.test(path.trim())) return { owner: CANVAS_OWNER, status: 'invalid', summary: 'path: expected an .html or .htm file' }
      const id = exec.agent?.id
      const agent = id === undefined ? undefined : host.agents.get(id)
      if (!isLiveRoot(host, agent)) {
        logger?.debug('canvas.non-root-rejected', 'Rejected show_canvas outside a live root session.', { sessionId: id ?? null })
        return { owner: CANVAS_OWNER, status: 'invalid', summary: 'Canvas preview only works in a live root session. Give the user the file path in your response instead.' }
      }
      const header = isRecord(agent.session) && isRecord(agent.session.header) ? agent.session.header : undefined
      const cwd = typeof header?.cwd === 'string' && header.cwd !== '' ? header.cwd : undefined
      const { workspaceFiles, sandboxPolicy } = services.current
      const workspaceRoot = cwd ?? (typeof sandboxPolicy?.workspaceRoot === 'string' && sandboxPolicy.workspaceRoot !== '' ? sandboxPolicy.workspaceRoot : undefined)
      let absolutePath: string | undefined
      // stat is advisory: no workspaceFiles service, or no resolvable workspace
      // root, skips existence checking; a stat failure tells the model to write first.
      if (workspaceFiles && workspaceRoot !== undefined) {
        const signal = exec.signal ? AbortSignal.any([exec.signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000)
        try {
          const stat = await workspaceFiles.stat({ sessionId: agent.id, workspaceRoot }, path, signal)
          absolutePath = typeof stat?.absolutePath === 'string' ? stat.absolutePath : undefined
        } catch (error) {
          logger?.debug('canvas.missing', 'show_canvas stat failed.', { sessionId: agent.id, path, reason: error instanceof Error ? error.message : String(error) })
          return { owner: CANVAS_OWNER, status: 'missing', path, summary: `No readable file at "${path}". Write the file with the write tool first, then call show_canvas again.` }
        }
      }
      const address = fileAddressFor(agent.id, workspaceRoot, absolutePath ?? path)
      logger?.info('canvas.shown', 'Opened Deep View canvas preview.', { sessionId: agent.id, path })
      return {
        owner: CANVAS_OWNER, status: 'shown', path, address,
        ...(typeof input.title === 'string' ? { title: input.title } : {}),
        summary: `Canvas preview opened in the right Sidebar for ${path}. Later changes with the edit tool refresh the preview automatically; do not call show_canvas again unless the user asks to reopen it. Finish with a short final answer.`,
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
) {
  const claims = new Set<string>()
  return async (endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResult> => {
    if (!isRecord(payload) || !short(payload.sessionId, 200)) return fail('bad-request', 'A bounded sessionId is required')
    const sessionId = resolveSessionId(redirects, payload.sessionId)
    const record = pending.get(sessionId)
    if (endpoint === 'pending') return ok(record?.callId === payload.callId || payload.callId === undefined ? record ?? null : null)
    if (endpoint === 'dismiss') {
      if (record && record.id === payload.viewId) {
        pending.delete(sessionId)
        logger?.debug('view.dismissed', 'Dismissed pending Deep View card.', { sessionId, viewId: record.id })
      }
      return ok(true)
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

export async function apply(ctx: Context): Promise<void> {
  const host = ctx as unknown as Host
  const logger = installPluginLogger(ctx, PLUGIN_NAME, { forwardHostWarnError: false })
  const pending = new Map<string, PendingView>()
  const redirects = new Map<string, string>()
  const latest = new Map<string, ViewSnapshot>()
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
      const moved = handoffPendingSession(pending, redirects, fromSessionId, toSessionId)
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
    try {
      disposeTool = host.tools.register(createShowViewTool(host, pending, randomUUID, logger, latest))
    }
    catch (error) {
      logger.warn('tool.register-failed', 'show_view tool registration failed.', error)
      host.logger?.warn('deep-view: show_view registration skipped: %s', error instanceof Error ? error.message : String(error))
      return () => {}
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
      disposeTool()
      logger.warn('prompt.register-failed', 'Deep View reply context was not registered.', error)
      host.logger?.warn('deep-view: reply context registration skipped: %s', error instanceof Error ? error.message : String(error))
      return () => {}
    }
    return () => {
      disposeContext()
      disposeSection?.()
      disposeTool()
    }
  }, 'deep-view.tool')
  ctx.effect(() => {
    if (host.tools.get('show_canvas')) {
      logger.warn('tool.already-registered', 'show_canvas is already registered by another plugin; skipping registration.')
      host.logger?.warn('deep-view: show_canvas is already registered by another plugin; this bundle stays disabled for the canvas tool')
      return () => {}
    }
    try {
      return host.tools.register(createShowCanvasTool(host, canvasServices, logger))
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
    pending.delete(resolveSessionId(redirects, session.id))
  }), 'deep-view.close-pending')
  ctx.effect(() => registerHostRpc(host, RPC_CHANNEL, createRpc(host, pending, redirects, logger), { maxBodyBytes: 24 * 1024, logger }), 'deep-view.rpc')
}
