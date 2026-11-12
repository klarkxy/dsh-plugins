/**
 * dsh-dot: an always-on coordinator. The entry provides the `dot` service,
 * registers the dot preset (persona + dot's own tools, no file or shell tools,
 * compaction as a fallback), keeps dot's own sessions out of the sidebar and
 * serves their chat to the plugin's panel, feeds host events into the ledger,
 * moves dot's conversation to a new session segment when one is due, starts
 * the clock of dot's own reminders, and routes the approvals and questions of
 * other top-level sessions to dot first.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions'
import Schema from '@deepseek-ai/schemastery'
import { isSubagentSession } from '@klarkxy/dsh-plugin-kit/contracts'
import { openCompatibleDomain } from '@klarkxy/dsh-plugin-kit/domain'
import { registerHostRpc, type HostRpcContext } from '@klarkxy/dsh-plugin-kit/host-rpc'
import { approvalAuditId, raceApproval } from './approval-relay.ts'
import type { RawEvent } from './chat.ts'
import { COMPACTION_POLICY, PLUGIN_NAME, PRESET_ID, RPC_CHANNEL, SERVICE_NAME, type PendingQuestionItem } from './contracts.ts'
import { ChatFeed } from './feed.ts'
import { bindHost } from './host.ts'
import { clip } from './ledger.ts'
import { detachNative } from './native.ts'
import { DOT_INSTRUCTIONS } from './prompt.ts'
import { APPROVAL_GRACE_MS, DotService, messageOf } from './service.ts'
import { patchSettings } from './settings.ts'
import { dotDomain } from './storage.ts'
import { DotStore, type DotDomainHandle } from './store.ts'

export const name = PLUGIN_NAME
export const inject = ['storageDomain', 'sessions', 'sessionController', 'workspaceRegistry', 'sessionQuery', 'agentPresets', 'agents', 'agentDefaultModel', 'webServer', 'connection'] as const
export { DotService } from './service.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { [SERVICE_NAME]: DotService }
}

/** A long-poll answers after this long without changes; the client asks again. */
const WAIT_MS = 15_000
/** A finished turn is read this long after it stops, once its boundary has committed. */
const TURN_SETTLE_MS = 300
/** Events scanned back for the tool call an approval is about. */
const CALL_SCAN = 400

/** Conversation settings stay in Dorothy's panel; delivery timing is profile configuration. */
export interface Config {
  homeDir?: string
  approvalGraceMs?: number
}

export const Config: Schema<Config> = Schema.object({
  homeDir: Schema.string().default(''),
  approvalGraceMs: Schema.number().min(0).max(60_000).default(APPROVAL_GRACE_MS),
}).i18n({
  zh: { homeDir: '桃乐丝自己的工作区所在的目录，她自己的会话也在这里；留空使用 DSH 主目录下的 dot 文件夹。其余设置在桃乐丝面板右上角的齿轮里', approvalGraceMs: '审批通知宽限期（毫秒），默认 10000；期间在原会话结算的审批不会唤醒桃乐丝' },
  en: { homeDir: "Folder of Dorothy's own workspace, which also holds her own session; empty uses a dot folder in the DSH home. Other settings live behind the gear in Dorothy's panel", approvalGraceMs: 'Approval notice grace period in milliseconds (default 10000); approvals settled in the original session during this time do not wake Dorothy' },
})

interface SessionLike {
  readonly id?: string
  readonly header?: { readonly parentSession?: string; readonly cwd?: string; readonly origin?: string }
  readonly seq?: number
  eventAt?(seq: number): RawEvent | undefined
}
interface AgentLike { readonly id?: string; readonly session?: SessionLike }

/** Ledger events come from top-level sessions only; subagents report to their parent session. */
function sessionIdOf(agent: AgentLike | undefined): string | undefined {
  const session = agent?.session
  if (!session?.id || isSubagentSession(session)) return undefined
  return session.id
}

export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const log = (message: string) => ctx.logger?.info?.(message)
  const domain = await openCompatibleDomain(spec => (ctx.storageDomain as unknown as { open(s: typeof spec): Promise<DotDomainHandle> }).open(spec), dotDomain)
  const store = new DotStore(domain)
  const host = bindHost(serviceName => ctx.get(serviceName as never), log, () => store.settings.model)
  const service = new DotService({
    host,
    store,
    homeDir: config.homeDir?.trim() || join(process.env.DSH_HOME?.trim() || join(homedir(), '.dsh'), 'dot'),
    log,
    approvalGraceMs: Number.isFinite(config.approvalGraceMs) ? Math.max(0, Math.min(60_000, config.approvalGraceMs!)) : APPROVAL_GRACE_MS,
  })
  const feed = new ChatFeed(host, store)
  // The chat follows dot into every new segment and keeps the earlier ones above it.
  const follow = () => { if (store.dotSessionId) feed.attach(store.dotSessionId, store.pastSegments); feed.cardsChanged() }
  follow()
  const unfollow = store.onChange(follow)
  const ensureDot = async () => {
    const sessionId = await service.ensureDot()
    follow()
    return sessionId
  }
  ctx.provide(SERVICE_NAME, service)
  ctx.effect(() => () => {
    unfollow()
    service.dispose()
    feed.dispose()
    void host.dispose()
    void store.flush().then(() => domain.close())
  }, 'dot.lifecycle')

  // The dot preset: conversation, dot's tools, and in-place compaction for the
  // one turn that outgrows the window before a segment change. Choices go through
  // deep-view's show_view cards, which every session gets when it is installed.
  ctx.effect(() => {
    let release: (() => Promise<void>) | undefined
    let disposed = false
    void ctx.agentPresets.register({
      id: PRESET_ID,
      name: 'Dorothy',
      description: 'Dorothy (dot): talks to you, starts and checks other sessions; no file or shell tools.',
      order: 90,
      plugins: [
        { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: DOT_INSTRUCTIONS } },
        { id: 'time-context', name: '@deepseek-ai/dsh-time-context' },
        {
          id: 'compaction', name: 'cordis:group', group: true, isolate: { compaction: true },
          config: [
            // Spelled out so the context page draws the compaction line from the same numbers.
            { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic', config: { ...COMPACTION_POLICY } },
            { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
          ],
        },
        { id: 'dot-tools', name: '@klarkxy/dsh-dot/tools' },
      ] as never,
    }).then((dispose: () => Promise<void>) => {
      if (disposed) { void dispose(); return }
      release = dispose
      // Reminders wake dot's session, which only opens once its preset exists.
      service.startReminders()
    }, (error: unknown) => ctx.logger?.warn?.('dsh-dot: preset registration failed: %s', messageOf(error)))
    return () => { disposed = true; void release?.() }
  }, 'dot.preset')

  // Correlate the host audit id (not callId) with its in-memory dot request.
  const approvalWithdrawals = new Map<string, { sessionId: string; withdraw: () => void }>()
  ctx.effect(() => () => approvalWithdrawals.clear(), 'dot.approval-links')

  // Ledger and chat feed. Handlers never throw back into the agent loop.
  const guard = (work: () => unknown) => { try { void Promise.resolve(work()).catch(() => {}) } catch { /* observer only */ } }
  ctx.effect(() => ctx.on('agent/status', ({ agent, status }: { agent: AgentLike; status: string }) => guard(() => {
    const own = agent.session?.id
    if (own) feed.onStatus(own)
    // dot's own session is left out of the ledger; its finished turn is where a segment change is checked.
    // The check waits for the turn boundary to commit, like the reply read below.
    if (own && status === 'idle' && service.isDot(own)) setTimeout(() => guard(() => service.onDotIdle(own)), TURN_SETTLE_MS)
    const id = sessionIdOf(agent)
    if (id && (status === 'running' || status === 'idle')) service.onStatus(id, status)
  })), 'dot.status')
  ctx.effect(() => ctx.on('agent/turn-stopping', ({ agent }: { agent: AgentLike }) => {
    const id = sessionIdOf(agent)
    // Read the reply after the boundary commits; the stopping hook must not wait on it.
    if (id) setTimeout(() => guard(() => service.onTurnEnd(id)), TURN_SETTLE_MS)
  }), 'dot.turn')
  ctx.effect(() => ctx.on('agent/error', ({ agent, error }: { agent: AgentLike; error: unknown }) => guard(() => {
    const id = sessionIdOf(agent)
    if (id) service.onError(id, error)
  })), 'dot.error')
  ctx.effect(() => (ctx as unknown as { on(name: string, listener: (...args: never[]) => void): () => void }).on('session/event', ((session: { id?: string }, event: RawEvent) => {
    if (session?.id && feed.isDot(session.id)) guard(() => feed.onEvent(session.id!, event))
    if (event.type === 'approval/decided') {
      const id = (event.data as { id?: unknown } | undefined)?.id
      const linked = typeof id === 'string' ? approvalWithdrawals.get(id) : undefined
      if (linked && linked.sessionId === session?.id) {
        approvalWithdrawals.delete(id as string)
        linked.withdraw()
      }
    }
  }) as never), 'dot.chat-events')
  ctx.effect(() => (ctx as unknown as { on(name: string, listener: (...args: never[]) => void): () => void }).on('agent/assistant-stream', ((payload: { agent?: AgentLike; frame?: { type?: string; chunk?: { type?: string; text?: string } } }) => {
    const id = payload?.agent?.session?.id
    if (id && payload.frame && feed.isDot(id)) guard(() => feed.onStream(id, payload.frame!))
  }) as never), 'dot.chat-stream')

  /** Top-level session a request belongs to: a subagent's popups show in its root session. */
  const agents = () => ctx.get('agents' as never) as unknown as { get(id: string): AgentLike | undefined } | undefined
  const topLevelOf = (agent: AgentLike | undefined): { id: string; via?: string; cwd?: string } | undefined => {
    let session = agent?.session
    const own = session?.id
    if (!own) return undefined
    for (let hop = 0; hop < 8 && session?.header?.parentSession; hop++) {
      const parentId: string = session.header.parentSession
      const parent = agents()?.get(parentId)?.session
      if (!parent) return { id: parentId, via: own, ...session.header.cwd ? { cwd: session.header.cwd } : {} }
      session = parent
    }
    const id = session?.id ?? own
    return { id, ...id === own ? {} : { via: own }, ...session?.header?.cwd ? { cwd: session.header.cwd } : {} }
  }
  /** Raw arguments of the call an approval is about, so dot can judge what would run. */
  const callArguments = (agent: AgentLike | undefined, callId: string | undefined): string | undefined => {
    const session = agent?.session
    if (!callId || !session || typeof session.seq !== 'number' || typeof session.eventAt !== 'function') return undefined
    for (let seq = session.seq - 1; seq >= Math.max(0, session.seq - CALL_SCAN); seq--) {
      const event = session.eventAt(seq)
      const data = event?.type === 'tool/call' ? event.data as { callId?: unknown; arguments?: unknown } | undefined : undefined
      if (data?.callId === callId) return typeof data.arguments === 'string' ? data.arguments : JSON.stringify(data.arguments)
    }
    return undefined
  }

  // Approvals: dot's chat and the original session's own card race; the first
  // answer wins.
  ctx.effect(() => ctx.on('approval/request', async (req, next): Promise<ApprovalOutcome> => {
    const origin = topLevelOf(req.agent as AgentLike)
    if (!origin) return next()
    const args = callArguments(req.agent as AgentLike, req.callId)
    const detail = [
      origin.via ? `asked by subagent ${origin.via}` : '',
      req.reason ? `reason: ${req.reason}` : '',
      args ? `arguments: ${clip(args, 1200)}` : '',
    ].filter(Boolean).join('\n  ')
    const routed = service.relayRequest({ kind: 'approval', sessionId: origin.id, subject: req.toolName, ...detail ? { detail } : {}, ...origin.cwd ? { cwd: origin.cwd } : {}, ...req.signal ? { signal: req.signal } : {} })
    if (routed.decided === 'skip') return next()
    if (routed.decided === 'deny') return 'rejected'
    const callerSignal = req.signal
    const lease = detachNative(req as { signal?: AbortSignal })
    // The host appends approval/asked before dispatch and does not expose its id on req.
    // Only link an unambiguous, still-open audit pair. Calls without unique ids
    // still withdraw through their own native-result promise, never another request's event.
    const session = (req.agent as AgentLike).session
    const found = approvalAuditId(session, req.toolName, req.callId)
    const auditId = found && !approvalWithdrawals.has(found) ? found : undefined
    if (auditId && session?.id) approvalWithdrawals.set(auditId, { sessionId: session.id, withdraw: routed.withdraw })
    try { return await raceApproval(routed, next, lease, callerSignal) } finally {
      if (auditId) approvalWithdrawals.delete(auditId)
    }
  }, { prepend: true }), 'dot.approval')

  ctx.effect(() => ctx.on('user-questions/request', async (req, next): Promise<AskUserQuestionAnswer> => {
    const origin = topLevelOf(req.agent as AgentLike)
    if (!origin || req.questions.length === 0) return next()
    const questions: PendingQuestionItem[] = req.questions.map(item => ({
      id: item.id,
      question: item.question,
      ...item.detail ? { detail: item.detail } : {},
      ...item.options ? { options: item.options.map(option => ({ label: option.label, ...option.description ? { description: option.description } : {} })) } : {},
      ...item.multiSelect ? { multiSelect: true } : {},
    }))
    const routed = service.relayRequest({ kind: 'question', sessionId: origin.id, subject: questions[0]!.question, questions, ...origin.via ? { detail: `asked by subagent ${origin.via}` } : {}, ...origin.cwd ? { cwd: origin.cwd } : {}, ...req.signal ? { signal: req.signal } : {} })
    if (routed.decided !== 'pending') return next()
    const lease = detachNative(req)
    const native = next()
    const winner = await Promise.race([
      native.then(answer => ({ from: 'native' as const, ok: true as const, answer }), () => ({ from: 'native' as const, ok: false as const })),
      routed.settled.then(answer => ({ from: 'dot' as const, answer })),
    ])
    if (winner.from === 'native' && winner.ok) { lease?.release(); routed.withdraw(); return winner.answer }
    if (winner.from === 'dot') lease?.close()
    // A timed card that ran out rejects on purpose: the host turns it into a
    // continued question, so keep its semantics instead of holding the call.
    if (winner.from === 'native' && req.wait?.timed) { routed.withdraw(); return native }
    const answer = winner.from === 'dot' ? winner.answer : await routed.settled
    if (answer?.kind === 'question') return { answers: answer.answers.map(item => ({ id: item.id, selected: [...item.selected], ...item.custom ? { custom: item.custom } : {} })) }
    return native
  }, { prepend: true }), 'dot.question')

  const field = (payload: unknown, key: string): unknown => payload !== null && typeof payload === 'object' ? (payload as Record<string, unknown>)[key] : undefined
  const num = (payload: unknown, key: string): number => { const value = field(payload, key); return typeof value === 'number' && Number.isFinite(value) ? value : 0 }
  ctx.effect(() => registerHostRpc(ctx as unknown as HostRpcContext, RPC_CHANNEL, async (endpoint, payload, signal) => {
    try {
      switch (endpoint) {
        case 'board': return { ok: true, value: service.board() }
        case 'ensure': return { ok: true, value: { sessionId: await ensureDot() } }
        case 'chat': {
          await ensureDot()
          return { ok: true, value: feed.snapshot(num(payload, 'itemsRev')) }
        }
        case 'wait': {
          await ensureDot()
          await feed.wait(num(payload, 'rev'), signal, WAIT_MS)
          return { ok: true, value: feed.snapshot(num(payload, 'itemsRev')) }
        }
        case 'say': {
          const text = field(payload, 'text')
          await service.say(typeof text === 'string' ? text.slice(0, 20_000) : '')
          return { ok: true, value: true }
        }
        case 'card.pending': {
          const callId = field(payload, 'callId')
          return { ok: true, value: typeof callId === 'string' ? service.cards.pending(callId) : null }
        }
        case 'card.answer': {
          const id = field(payload, 'viewId')
          const action = field(payload, 'action')
          await service.answerCard(typeof id === 'string' ? id : '', typeof action === 'string' ? action : '', field(payload, 'values'))
          return { ok: true, value: true }
        }
        case 'stop': { await service.stop(); return { ok: true, value: true } }
        case 'settings': return { ok: true, value: store.settings }
        case 'settings.proposals': return { ok: true, value: store.settingProposals }
        case 'settings.decide': {
          const id = field(payload, 'id')
          return { ok: true, value: await service.selfSettings.decide(typeof id === 'string' ? id : '', field(payload, 'allow') === true) }
        }
        case 'segment.new': return { ok: true, value: await service.newSegment() }
        case 'trajectory': {
          const id = await ensureDot()
          return { ok: true, value: host.dotTrajectory(id) }
        }
        case 'context': {
          await ensureDot()
          return { ok: true, value: await service.contextView() }
        }
        case 'context.clearUsage': {
          await ensureDot()
          return { ok: true, value: await service.clearUsage() }
        }
        case 'schedule.remove': {
          const id = field(payload, 'id')
          return { ok: true, value: typeof id === 'string' ? await service.removeSchedule(id) : false }
        }
        case 'knowledge': return { ok: true, value: await service.knowledgeView() }
        // Panel edits of the agreements/cognition do not switch segments at once: the change is
        // picked up before the next message (prompt-changed), or folded in while the segment is untouched.
        case 'agreements.set': {
          const text = field(payload, 'text')
          return { ok: true, value: await service.setAgreements(typeof text === 'string' ? text : '') }
        }
        case 'agreements.undo': return { ok: true, value: await service.undoAgreements() }
        case 'cognition.set': {
          const text = field(payload, 'text')
          return { ok: true, value: await service.setCognition(typeof text === 'string' ? text : '') }
        }
        case 'cognition.restore': {
          const at = field(payload, 'at')
          return { ok: true, value: await service.restoreCognition(typeof at === 'number' ? at : Number.NaN) }
        }
        case 'settings.set': {
          const next = patchSettings(store.settings, field(payload, 'patch'))
          await store.setSettings(next)
          await service.settingsChanged()
          return { ok: true, value: next }
        }
        default: return { ok: false, error: { code: 'not-found', message: `unknown endpoint: ${endpoint}` } }
      }
    } catch (error) {
      return { ok: false, error: { code: 'dot/failed', message: messageOf(error) } }
    }
  }), 'dot.rpc')
}
