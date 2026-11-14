import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { registerHostRpc, type HostRpcContext } from '@klarkxy/dsh-plugin-kit/host-rpc'
import { installPluginLogger, type PluginLogger } from '@klarkxy/dsh-plugin-kit/logger'
import { checkShownView, validateViewAnswer, viewSummary } from './core/index.js'
import { answerText } from './answer-text.ts'
import { HOST_SERVICE, PLUGIN_NAME, RPC_CHANNEL, VIEW_OWNER, isRecord, type DeepViewHost, type PendingView, type RpcResult, type ShownView, type ViewNode, type ViewPresentation, type ViewAnswerMetadata } from './contracts.ts'

export const name = 'deep-view'
export const inject = ['tools', 'sessionController', 'sessions', 'agents', 'connection', 'webServer'] as const

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
// The real `agents` service returns the runtime Agent type; our local narrow
// shape cannot feed includes() against it, so compare by id.
const isLiveRoot = (host: Host, agent: AgentLike | undefined) => agent !== undefined && host.agents.roots().some(root => (root as unknown as AgentLike).id === agent.id)
type Host = Context & HostRpcContext & {
  tools: {
    get(name: string, scope?: object): unknown
    register(definition: Record<string, unknown>): () => void
  }
  agents: { get(id: string): AgentLike | undefined; roots(): AgentLike[] }
  sessionController: { resolveAgent(id: string): Promise<{ agent?: AgentLike; error?: { message?: string } }> }
  sessions: { flush(session: unknown): Promise<boolean> }
  logger?: { warn(message: string, ...args: unknown[]): void }
}
const ok = <T,>(value: T): RpcResult<T> => ({ ok: true, value })
const fail = (code: string, message: string): RpcResult<never> => ({ ok: false, error: { code, message } })
const short = (value: unknown, max = 160): value is string => typeof value === 'string' && value.length > 0 && value.length <= max
const checkedShown = (title: unknown, view: unknown) => checkShownView(title, view) as ShownView | { error: string }
const isShown = (value: ShownView | { error: string }): value is ShownView => !('error' in value)

// The host snapshots presentationMeta as JSON on every result, so a result
// without a card reports null; undefined fails the whole call as invalid output.
function presentation(args: unknown, value: unknown): ViewPresentation | null {
  if (!isRecord(value) || value.owner !== VIEW_OWNER || !['shown', 'pending'].includes(String(value.status))) return null
  const shown = checkedShown(isRecord(args) ? args.title : undefined, isRecord(args) ? args.view : undefined)
  if (!isShown(shown)) return null
  return {
    owner: VIEW_OWNER, ...(short(value.viewId, 80) ? { viewId: value.viewId } : {}),
    ...shown, awaitReply: value.awaitReply === true,
  }
}

export function createShowViewTool(
  host: Host,
  pending: Map<string, PendingView>,
  makeId: () => string = randomUUID,
  logger?: PluginLogger,
): Record<string, unknown> {
  return {
    name: 'show_view',
    description: [
      'Attach one card below your final reply when a visual or interactive form beats prose: compared numbers, a trend, a share, progress; an estimate with user-adjustable inputs; or a choice the user answers afterwards (use ask_user_question when you cannot continue without it).',
      'Prefer plain Markdown otherwise. Call once, then finish the reply; the card is not yet visible when this tool returns.',
      'Never end on the call, wait or poll, repeat the card JSON, or claim the user saw it. Answers accept one reply, sent as the next user message. Never collect keys, tokens or passwords.',
    ].join(' '),
    // tools.register() takes raw JSON Schema; the per-field DSL is only for defineTool().
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short heading above the card.' },
        view: { type: 'object', additionalProperties: true, description: [
          'One ViewNode, nodes nest under stack|row(children,let?).',
          'Display: text,metric{label,value},table{columns:[{key,label}],rows:[[cell]]},chart{kind:bar|hbar|line|area|donut,categories,series:[{name?,values}]},progress{percent|value+max},callout{text},sources{items:[{label,url}]}.',
          'Inputs: slider,number,choice,toggle{id,label,value}. A {"=":"expr"} formula replaces a value or cell, reading input ids and let names.',
          'Answers(need await_reply true): options{id,options:[{label,description?}],multi?},confirm{id},form{id,fields:[{id,label,placeholder?}]},submit{id,label}. No html.',
        ].join(' ') },
        await_reply: { type: 'boolean', description: 'Whether this card asks the user for a response.' },
      },
      required: ['view'],
    } satisfies ObjectJsonSchema,
    output: {
      schema: { type: 'object', properties: { owner: { type: 'string', const: VIEW_OWNER }, status: { type: 'string' }, viewId: { type: 'string' }, awaitReply: { type: 'boolean' }, summary: { type: 'string' } }, required: ['owner', 'status', 'awaitReply', 'summary'], additionalProperties: false },
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
      const awaitReply = input.await_reply ?? shown.interactive
      if (awaitReply !== shown.interactive) {
        return { owner: VIEW_OWNER, status: 'invalid', awaitReply: false, summary: shown.interactive ? 'This card has answer controls; omit await_reply or set it true.' : 'A display-only card cannot wait for an answer; omit await_reply or set it false.' }
      }
      const id = exec.agent?.id
      const agent = id === undefined ? undefined : host.agents.get(id)
      if (awaitReply && !isLiveRoot(host, agent)) {
        logger?.debug('view.non-root-rejected', 'Rejected interactive show_view outside a live root session.', {
          sessionId: id ?? null,
        })
        return { owner: VIEW_OWNER, status: 'invalid', awaitReply: false, summary: 'An interactive view only works in a live root session. Put the question or decision in your response instead.' }
      }
      let viewId: string | undefined
      if (awaitReply && agent) {
        viewId = makeId()
        // set() alone replaces an earlier unanswered card: the old card becomes
        // stale and its pending record points at the newest view only.
        pending.set(agent.id, { id: viewId, sessionId: agent.id, ...(exec.callId ? { callId: exec.callId } : {}), ...shown })
      }
      logger?.info('view.prepared', 'Prepared Deep View card.', {
        sessionId: agent?.id ?? id ?? null,
        viewId: viewId ?? null,
        awaitReply,
      })
      return {
        owner: VIEW_OWNER, status: awaitReply ? 'pending' : 'shown', ...(viewId ? { viewId } : {}), awaitReply,
        // A tool result is process data. The completed-turn reply surface owns
        // the card, so the model must still produce its final answer.
        summary: `Card prepared for the final reply. Finish with a concise final answer; do not call this tool again for the same card.${awaitReply ? ' The user can answer the card after your reply finishes; do not wait or poll.' : ''} ${viewSummary(shown.view)}`,
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
    if (!record || !short(payload.viewId, 80) || payload.viewId !== record.id || !short(payload.action, 160) || !isRecord(payload.values)) {
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
      if (!agent || host.agents.get(agent.id) !== agent || !host.agents.roots().some(root => (root as unknown as AgentLike).id === agent.id)) throw new Error(('error' in resolved ? resolved.error?.message : undefined) ?? 'The session is not a live root session')
      if (signal.aborted) return fail('cancelled', 'The request was cancelled')
      // Text and answer facts share one durable message: neither can survive
      // without the other, and fork/history boundaries preserve their pairing.
      const deepView: ViewAnswerMetadata = {
        owner: VIEW_OWNER, version: 1,
        answer: { id: record.id, action: payload.action, values: checked },
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
  ctx.provide(HOST_SERVICE, {
    handoffSession: (fromSessionId, toSessionId) => {
      const moved = handoffPendingSession(pending, redirects, fromSessionId, toSessionId)
      if (moved) logger.debug('session.handoff', 'Moved pending Deep View card across session handoff.', { fromSessionId, toSessionId })
      return moved
    },
  })
  ctx.effect(() => {
    if (host.tools.get('show_view')) {
      logger.warn('tool.already-registered', 'show_view is already registered by another plugin; skipping registration.')
      host.logger?.warn('deep-view: show_view is already registered by another plugin; this bundle stays disabled for its own tool')
      return () => {}
    }
    try {
      return host.tools.register(createShowViewTool(host, pending, randomUUID, logger))
    }
    catch (error) {
      logger.warn('tool.register-failed', 'show_view tool registration failed.', error)
      host.logger?.warn('deep-view: show_view registration skipped: %s', error instanceof Error ? error.message : String(error))
      return () => {}
    }
  }, 'deep-view.tool')
  // Only admission events are observed, never scanned. A new human message closes a stale card.
  ctx.effect(() => ctx.on('session/event', (session: { id: string }, event: { type: string; data?: unknown }) => {
    if (event.type !== 'user/message' || !isRecord(event.data) || !isRecord(event.data.source) || event.data.source.kind !== 'user') return
    pending.delete(resolveSessionId(redirects, session.id))
  }), 'deep-view.close-pending')
  ctx.effect(() => registerHostRpc(host, RPC_CHANNEL, createRpc(host, pending, redirects, logger), { maxBodyBytes: 24 * 1024, logger }), 'deep-view.rpc')
}
