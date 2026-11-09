import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { registerHostRpc, type HostRpcContext } from '@klarkxy/dsh-plugin-kit/host-rpc'
import { checkShownView, validateViewAnswer, viewSummary } from './core/index.js'
import { answerText } from './answer-text.ts'
import { RPC_CHANNEL, VIEW_OWNER, isRecord, type PendingView, type RpcResult, type ShownView, type ViewNode, type ViewPresentation, type ViewAnswerMetadata } from './contracts.ts'

export const name = 'deep-view'
export const inject = ['tools', 'sessionController', 'sessions', 'agents', 'connection', 'webServer'] as const

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

function presentation(args: unknown, value: unknown): ViewPresentation | undefined {
  if (!isRecord(value) || value.owner !== VIEW_OWNER || !['shown', 'pending'].includes(String(value.status))) return undefined
  const shown = checkedShown(isRecord(args) ? args.title : undefined, isRecord(args) ? args.view : undefined)
  if (!isShown(shown)) return undefined
  return {
    owner: VIEW_OWNER, ...(short(value.viewId, 80) ? { viewId: value.viewId } : {}),
    ...shown, awaitReply: value.awaitReply === true,
  }
}

export function createShowViewTool(host: Host, pending: Map<string, PendingView>, makeId: () => string = randomUUID): Record<string, unknown> {
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
          'Answers(need await_reply true): options{id,options,multi?},confirm{id},form{id,fields},submit{id,label}. No html.',
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
      if (!isShown(shown)) return { owner: VIEW_OWNER, status: 'invalid', awaitReply: false, summary: shown.error }
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
        return { owner: VIEW_OWNER, status: 'invalid', awaitReply: false, summary: 'An interactive view only works in a live root session. Put the question or decision in your response instead.' }
      }
      let viewId: string | undefined
      if (awaitReply && agent) {
        viewId = makeId()
        // set() alone replaces an earlier unanswered card: the old card becomes
        // stale and its pending record points at the newest view only.
        pending.set(agent.id, { id: viewId, sessionId: agent.id, ...(exec.callId ? { callId: exec.callId } : {}), ...shown })
      }
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

export function createRpc(host: Host, pending: Map<string, PendingView>) {
  const claims = new Set<string>()
  return async (endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResult> => {
    if (!isRecord(payload) || !short(payload.sessionId, 200)) return fail('bad-request', 'A bounded sessionId is required')
    const sessionId = payload.sessionId
    const record = pending.get(sessionId)
    if (endpoint === 'pending') return ok(record?.callId === payload.callId || payload.callId === undefined ? record ?? null : null)
    if (endpoint === 'dismiss') {
      if (record?.id === payload.viewId) pending.delete(sessionId)
      return ok(true)
    }
    if (endpoint !== 'reply') return fail('not-found', 'Unknown Deep View endpoint')
    if (!record || !short(payload.viewId, 80) || payload.viewId !== record.id || !short(payload.action, 160) || !isRecord(payload.values)) {
      return fail('stale', 'This view is no longer open')
    }
    if (claims.has(record.id)) return fail('busy', 'This view is already being answered')
    const checked = validateViewAnswer(record.view as ViewNode, payload.action, payload.values) as { error?: string } & Record<string, unknown>
    if (checked.error !== undefined) return fail('invalid', checked.error)
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
      const resolved = await host.sessionController.resolveAgent(sessionId)
      const agent = resolved.agent
      if (!agent || host.agents.get(agent.id) !== agent || !host.agents.roots().some(root => (root as unknown as AgentLike).id === agent.id)) throw new Error(resolved.error?.message ?? 'The session is not a live root session')
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
      return ok({ answered: true })
    } catch (error) {
      return fail('internal', error instanceof Error ? error.message : String(error))
    } finally {
      if (!appended && !pending.has(sessionId)) pending.set(sessionId, record)
      claims.delete(record.id)
    }
  }
}

export async function apply(ctx: Context): Promise<void> {
  const host = ctx as unknown as Host
  const pending = new Map<string, PendingView>()
  ctx.effect(() => {
    if (host.tools.get('show_view')) {
      host.logger?.warn('deep-view: show_view is already registered by another plugin; this bundle stays disabled for its own tool')
      return () => {}
    }
    try {
      return host.tools.register(createShowViewTool(host, pending))
    }
    catch (error) {
      host.logger?.warn('deep-view: show_view registration skipped: %s', error instanceof Error ? error.message : String(error))
      return () => {}
    }
  }, 'deep-view.tool')
  // Only admission events are observed, never scanned. A new human message closes a stale card.
  ctx.effect(() => ctx.on('session/event', (session: { id: string }, event: { type: string; data?: unknown }) => {
    if (event.type !== 'user/message' || !isRecord(event.data) || !isRecord(event.data.source) || event.data.source.kind !== 'user') return
    pending.delete(session.id)
  }), 'deep-view.close-pending')
  ctx.effect(() => registerHostRpc(host, RPC_CHANNEL, createRpc(host, pending), { maxBodyBytes: 24 * 1024 }), 'deep-view.rpc')
}
