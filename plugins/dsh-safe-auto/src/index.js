import { isSubagentSession } from '@klarkxy/dsh-plugin-kit/contracts';
import { parseConfig } from './config.js';
import { isPermissionEvent } from './control.js';
import { dangerousCommand } from './dangerous.js';
import { buildTranscript } from './transcript.js';
import { review, reviewInput, SYSTEM_PROMPT } from './reviewer.js';
import { openAudit, auditedCapture } from './audit.js';
import { resolveReviewRoute } from './model-route.js';
export { Config } from './config.js';

export const name = 'dsh-safe-auto';
export const inject = ['sandboxPolicy', 'workingDirectory', 'storageDomain'];

/*
 * Safe Auto routes native approval requests to a reviewer model, following
 * the Codex `approvals_reviewer = "auto_review"` design (openai/codex,
 * Apache-2.0):
 * - Ordinary tool calls are never touched; the native sandbox constrains them.
 * - Shell commands on a small dangerous list are sent to review before they run.
 * - Every approval request of an active session (sandbox escalations,
 *   dangerous commands, other tools' asks) is answered by the reviewer:
 *   allow -> allowed-once, deny or review failure -> rejected with guidance.
 * - Repeated denials within one user turn open a circuit breaker.
 */

const SHELL_TOOLS = new Set(['bash', 'pwsh']);
export const MAX_ACTION_BYTES = 64 * 1024;
const WIDER_MODES = {
  'read-only': ['workspace-write', 'danger-full-access'],
  'workspace-write': ['danger-full-access'],
};
const BREAKER_CONSECUTIVE = 3;
const BREAKER_WINDOW = 50;
const BREAKER_WINDOW_DENIALS = 10;

export const MESSAGES = Object.freeze({
  denied: rationale => 'safe-auto: This action was rejected due to unacceptable risk.\n'
    + `Reason: ${rationale || 'The reviewer denied the action without a specific rationale.'}\n`
    + 'The agent must not attempt to achieve the same outcome via workaround, indirect execution, or policy circumvention. '
    + 'Proceed only with a materially safer alternative, or if the user explicitly approves the action after being informed of the risk. '
    + 'Otherwise, stop and request user input.',
  failed: detail => `safe-auto: Automatic approval review failed (${detail}). `
    + 'This is a review failure, not a determination that the action is unsafe. '
    + 'You may retry once, or ask the user for guidance or explicit approval. Do not bypass the approval boundary.',
  breaker: 'safe-auto: Automatic approval is paused for this turn after repeated denials. '
    + 'Stop and ask the user how to proceed; a new user message resumes automatic review.',
});

function serializeAction(exec, req) {
  let serialized;
  try {
    serialized = JSON.stringify({ tool: exec.name, arguments: exec.arguments, approvalReason: req.reason ?? '' }, (_key, value) => {
      if (['undefined', 'function', 'symbol', 'bigint'].includes(typeof value)
        || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('INVALID_REVIEW_ACTION');
      return value;
    });
  } catch { throw new Error('INVALID_REVIEW_ACTION'); }
  if (Buffer.byteLength(serialized) > MAX_ACTION_BYTES) throw new Error('REVIEW_INPUT_TOO_LARGE');
  return serialized;
}

function permissionRevision(session) {
  const events = session.snapshotEvents?.() ?? [];
  for (let index = events.length - 1; index >= 0; index--) {
    if (isPermissionEvent(events[index])) return events[index].seq ?? index;
  }
  return -1;
}

/** Latest direct human message position; one user turn shares a breaker window. */
function humanTurn(session) {
  const events = session?.snapshotEvents?.() ?? [];
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event?.type === 'user/message' && event.data?.source?.kind === 'user') return event.seq ?? index;
  }
  return undefined;
}

export function createBreaker() {
  const sessions = new WeakMap();
  const state = (session, turn) => {
    let s = sessions.get(session);
    if (!s || s.turn !== turn) { s = { turn, consecutive: 0, window: [] }; sessions.set(session, s); }
    return s;
  };
  return {
    open(session, turn) {
      const s = state(session, turn);
      return s.consecutive >= BREAKER_CONSECUTIVE || s.window.filter(Boolean).length >= BREAKER_WINDOW_DENIALS;
    },
    record(session, turn, denied) {
      const s = state(session, turn);
      s.consecutive = denied ? s.consecutive + 1 : 0;
      s.window.push(denied);
      if (s.window.length > BREAKER_WINDOW) s.window.shift();
    },
  };
}

export function apply(ctx, raw = {}) {
  const base = parseConfig(raw);
  let control;
  let controlEpoch = 0;
  // With the UI row loaded, only sessions that selected Safe Auto are reviewed.
  // A headless profile without that row applies the profile config to every
  // top-level session; once the row has attached and gone, review stops.
  let attachedOnce = false;
  const pendingWrites = new Set();
  const lifetime = new AbortController();
  const ready = openAudit(ctx.storageDomain);
  // Keep an unavailable store observable without an unhandled rejection at mount.
  void ready.catch(() => { try { ctx.logger?.warn?.('safe-auto audit store could not be opened; automatic approvals will be rejected'); } catch {} });
  const history = {
    async list(payload) { return (await ready).list(payload); },
    async get(payload) { return (await ready).get(payload); },
  };
  ctx.provide?.('safeAutoRuntime', { base, history, attach(next) {
    if (control) throw new Error('Safe Auto controls already attached');
    control = next; attachedOnce = true;
    const epoch = ++controlEpoch;
    return () => { if (control === next && controlEpoch === epoch) { control = undefined; ++controlEpoch; } };
  } });
  ctx.effect(() => async () => {
    lifetime.abort();
    await Promise.allSettled([...pendingWrites]);
    try { await (await ready).close(); } catch { /* mount failure remains visible to history callers */ }
  });
  // The query tool and the page share the same read-only store operations.
  ctx.inject?.(['tools'], scope => scope.effect(() => scope.tools.register({
    name: 'safe_auto_history',
    description: 'Query persisted Safe Auto reviews for the current session. List returns summaries and a pagination cursor; get returns the full redacted audit record, including review input and rationale. The Plugins page provides profile-wide audit history.',
    parameters: { type: 'object', properties: {
      action: { type: 'string', enum: ['list', 'get'] },
      id: { type: 'string', description: 'Review ID, required for get.' },
      sessionId: { type: 'string' }, tool: { type: 'string' },
      outcome: { type: 'string', enum: ['pending', 'interrupted', 'allowed-once', 'rejected', 'cancelled'] },
      risk: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
      from: { type: 'string', description: 'Inclusive start time in ISO 8601 with offset.' },
      to: { type: 'string', description: 'Inclusive end time in ISO 8601 with offset.' },
      query: { type: 'string', description: 'Search review contents.' },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
      cursor: { type: 'string', description: 'nextCursor from the preceding list page with the same filters.' },
    }, required: ['action'], additionalProperties: false },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      if (!args || !['list', 'get'].includes(args.action)) throw new Error('Invalid history request');
      const sessionId = exec?.agent?.session?.id;
      if (typeof sessionId !== 'string' || !sessionId) throw new Error('History queries require an agent-bound session');
      exec.signal?.throwIfAborted();
      const { action, ...payload } = args;
      if (payload.sessionId !== undefined && payload.sessionId !== sessionId) throw new Error('History queries are limited to the current session');
      if (action === 'get') {
        const record = await history.get({ id: payload.id });
        exec.signal?.throwIfAborted();
        if (record.sessionId !== sessionId) throw new Error('Audit record is unavailable in this session');
        return record;
      }
      const { id: _id, ...filters } = payload;
      const page = await history.list({ ...filters, sessionId });
      exec.signal?.throwIfAborted();
      return page;
    },
  })));
  if (!base.enabled) return;

  let llm;
  // Optional dependency: losing the model service fails reviews closed instead of unloading the plugin.
  if (typeof ctx.inject === 'function') ctx.inject(['llm'], scope => {
    const active = scope.llm;
    llm = active;
    scope.effect(() => () => { if (llm === active) llm = undefined; });
  });
  const breaker = createBreaker();
  // agent -> callId -> live execution. Approval requests carry only agent and
  // callId, so the action's arguments are looked up here.
  const executions = new WeakMap();
  // execution token -> model-facing explanation for a non-granted review.
  const feedback = new Map();
  const approvalPending = new Map(); // approvalId -> { auditId, store, session }; entries below
  ctx.effect(() => () => { lifetime.abort(); feedback.clear(); approvalPending.clear(); });

  const active = session => {
    if (!session || isSubagentSession(session)) return undefined;
    if (!control) return attachedOnce ? undefined : base;
    try {
      const config = control.config(session);
      return config.enabled ? config : undefined;
    } catch { return undefined; }
  };
  const audit = row => { try { ctx.logger?.info?.('safe-auto %s', JSON.stringify(row)); } catch { /* audit is best-effort */ } };

  ctx.on('tools/pre-execute', async (exec, next) => {
    const agent = exec.agent;
    if (agent && typeof agent === 'object') {
      let calls = executions.get(agent);
      if (!calls) executions.set(agent, calls = new Map());
      calls.set(String(exec.callId), exec);
    }
    const decision = await next();
    if (decision.kind !== 'allow' || !SHELL_TOOLS.has(exec.name) || !active(agent?.session)) return decision;
    // Only a strictly wider mode is guaranteed to ask through the native helper.
    // A same-mode request returns immediately there and still needs this guard.
    let mode;
    try { mode = ctx.sandboxPolicy.resolve({ session: agent.session }).mode; } catch {}
    if (WIDER_MODES[mode]?.includes(exec.arguments?.sandbox_permissions)) return decision;
    const rule = dangerousCommand(exec.arguments?.command, exec.name);
    if (!rule) return decision;
    return { kind: 'ask', reason: `safe-auto: dangerous command (${rule}) requires review`,
      displayReason: { en: `Safe Auto review: dangerous command (${rule})`, zh: `安全自动审核：危险命令（${rule}）` } };
  }, { prepend: true });

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next();
    const text = feedback.get(exec.token);
    if (text === undefined) return decision;
    feedback.delete(exec.token);
    if (!result.isError || decision.kind !== 'accept' || Object.hasOwn(decision, 'value')) return decision;
    return { ...decision, content: [{ type: 'text', text }] };
  });

  const auditCalls = new Map();
  const track = promise => {
    pendingWrites.add(promise);
    void promise.then(() => pendingWrites.delete(promise), () => pendingWrites.delete(promise));
    return promise;
  };
  ctx.on('tools/result', (exec, result) => {
    const records = auditCalls.get(exec.token);
    auditCalls.delete(exec.token);
    if (records && typeof result?.isError === 'boolean') {
      track(Promise.all(records.map(({ store, id }) => store.execution(id, {
        state: result.isError ? 'failed' : 'succeeded', completedAt: new Date().toISOString(),
        ...(result.isError ? { error: result.error?.message || 'Tool execution failed' } : {}),
      }))).catch(() => { try { ctx.logger?.warn?.('safe-auto execution audit write failed'); } catch {} }));
    }
    feedback.delete(exec.token);
    const calls = exec.agent && executions.get(exec.agent);
    if (calls?.get(String(exec.callId)) === exec) calls.delete(String(exec.callId));
    // A finished call whose decided never committed (append failure) can no
    // longer be confirmed — drop its pending link so the map does not leak.
    for (const [id, entry] of approvalPending) {
      if (entry.session === exec.agent?.session && String(entry.callId) === String(exec.callId)) approvalPending.delete(id);
    }
  });

  // approvalId -> { auditId, store, session } (declared above with feedback):
  // granted reviews still awaiting the native approval/decided that mirrors
  // this handler's returned verdict. The durable record keeps reviewer
  // outcome and the OBSERVED native grant (approvalState) as separate facts:
  // a persisted 'allowed-once' whose decided was never seen — process exit, a
  // failed corrective write, a crashed handler — reopens as interrupted,
  // never as an actual grant.
  const writeApproval = (store, auditId, outcome) => {
    if (!['allowed-once', 'rejected', 'cancelled', 'unavailable'].includes(outcome)) return;
    void track(store.approval(auditId, { outcome })).catch(
      () => { try { ctx.logger?.warn?.('safe-auto native approval record failed'); } catch {} });
  };
  // Live feed: session/event fires synchronously after the decided append's
  // commit, so a decided can arrive while the verdict's durable write is still
  // queued — the store write, not wall-clock order, records it. Matching is
  // by the exact asked request id captured when this review began: an
  // unlabelled decided is never inferred, so an unknown decision stays
  // 'not-observed' truthfully.
  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'approval/decided') return;
    const id = event.data?.id === undefined || event.data?.id === null ? undefined : String(event.data.id);
    const entry = id === undefined ? undefined : approvalPending.get(id);
    if (!entry || entry.session !== session) return;
    approvalPending.delete(id);
    writeApproval(entry.store, entry.auditId, event.data?.outcome);
  });

  ctx.on('approval/request', (req, next) => track((async () => {
    const session = req.agent?.session;
    const config = active(session);
    if (!config) return next();
    if (lifetime.signal.aborted) return 'cancelled';
    const exec = req.callId === undefined ? undefined : executions.get(req.agent)?.get(String(req.callId));
    // Without the concrete action there is nothing to review; keep the native flow.
    if (!exec) return next();
    const owner = control;
    const epoch = controlEpoch;
    let permissions, turn;
    try { permissions = permissionRevision(session); turn = humanTurn(session); } catch { return 'cancelled'; }
    const signal = AbortSignal.any([req.signal, exec.signal, lifetime.signal, owner?.signal].filter(Boolean));
    const started = Date.now();
    let store, auditId;
    const storageFailure = async () => {
      // A transient failure may still permit recording the rejection. If the
      // medium remains unavailable, the pending/not-observed evidence stays
      // explicitly inconclusive rather than claiming execution succeeded.
      if (auditId) {
        try {
          const saved = store.get({ id: auditId });
          await store.finish(auditId, { outcome: saved?.outcome === 'allowed-once' ? 'cancelled' : 'rejected',
            code: 'AUDIT_WRITE_FAILED', durationMs: Date.now() - started });
        } catch { /* the original write failure already prevents approval */ }
      }
      feedback.set(exec.token, MESSAGES.failed('the audit record could not be saved'));
      audit({ tool: exec.name, callId: String(exec.callId), outcome: 'rejected', code: 'AUDIT_WRITE_FAILED', durationMs: Date.now() - started });
      return 'rejected';
    };
    // The native asked/decided pair is captured before the first durable
    // await: the host appends approval/asked before dispatching the request
    // and approval/decided once the outcome is known, so the request id this
    // review answers for is already in the log. An aborted request settles
    // 'cancelled' while the review is in flight and its decided may commit
    // before this verdict lands — both are re-read here so a late verdict
    // never marks a cancelled grant confirmed.
    let approvalId;
    {
      try {
        const events = session.snapshotEvents?.() ?? [];
        for (let index = events.length - 1; index >= 0; index--) {
          const event = events[index];
          if (event?.type !== 'approval/asked') continue;
          const data = event.data ?? {};
          if (String(data.callId ?? '') === String(exec.callId)
            && (data.toolName === undefined || data.toolName === exec.name)) {
            approvalId = data.id === undefined || data.id === null ? undefined : String(data.id);
            break;
          }
        }
      } catch { /* an unreadable log keeps approvalId undefined: not-observed */ }
    }
    try {
      store = await ready;
      // Snapshot immediately, including early failures and breaker rejections.
      // Invalid/oversized actions are labelled rather than silently omitted.
      let action, capture;
      try {
        action = auditedCapture({ tool: exec.name, arguments: exec.arguments, approvalReason: req.reason ?? '' });
        if (action.includes('[audit capture truncated:')) capture = 'Action exceeds the audit capture budget; stored snapshot is explicitly truncated. Review was not approved.';
      } catch { action = '[unserializable action]'; capture = 'Action could not be serialized; review was not approved.'; }
      const rule = SHELL_TOOLS.has(exec.name) ? dangerousCommand(exec.arguments?.command, exec.name) : undefined;
      let mode;
      try { mode = ctx.sandboxPolicy.resolve({ session }).mode; } catch {}
      const escalates = WIDER_MODES[mode]?.includes(exec.arguments?.sandbox_permissions);
      auditId = await store.begin({ sessionId: String(session.id), agentId: String(req.agent.id ?? session.id),
        callId: String(exec.callId), tool: exec.name, turn: turn ?? null,
        trigger: { kind: escalates ? 'sandbox-escalation' : rule ? 'dangerous-command' : 'approval',
          ...(rule ? { rule } : {}), reason: req.reason ?? '' },
        action, policy: SYSTEM_PROMPT,
        settings: { timeoutMs: config.timeoutMs, outputTokens: config.outputTokens, maxTranscriptBytes: config.maxTranscriptBytes, reviewerPrompt: config.reviewerPrompt },
        ...(capture ? { capture } : {}),
      });
    } catch { return storageFailure(); }
    const finish = async (outcome, row, text, stillCurrent) => {
      try {
        await store.finish(auditId, { outcome, durationMs: Date.now() - started, ...row });
        // Storage introduces an await: recheck authority after the durable write,
        // immediately before returning the one-call permission grant.
        if (outcome === 'allowed-once' && !stillCurrent?.()) {
          outcome = 'cancelled'; row = { ...row, code: 'REVIEW_CANCELLED' };
          await store.finish(auditId, { outcome, durationMs: Date.now() - started, ...row });
        }
      } catch { return storageFailure(); }
      if (outcome === 'allowed-once') {
        const records = auditCalls.get(exec.token) ?? [];
        records.push({ store, id: auditId }); auditCalls.set(exec.token, records);
      }
      if (text !== undefined && outcome !== 'allowed-once') feedback.set(exec.token, text);
      audit({ id: auditId, tool: exec.name, callId: String(exec.callId), outcome, durationMs: Date.now() - started, ...row, rationale: undefined });
      return outcome;
    };
    // A grant is durable-but-provisional until the native approval/decided
    // for this request arrives. Two honest endings: the decided commits while
    // the review is still in flight (abort settles 'cancelled'; the late
    // verdict is discarded natively) — re-read the log and record that decided
    // outcome; or the decided is still pending — queue on approvalId so the
    // post-commit observer writes it. With no captured asked id nothing can
    // be inferred and the row truthfully stays 'not-observed'. Non-grants
    // need no link: approvalState already reports that no grant was confirmed.
    const linkApproval = () => {
      if (approvalId === undefined) return;
      try {
        const events = session.snapshotEvents?.() ?? [];
        for (let index = events.length - 1; index >= 0; index--) {
          const event = events[index];
          if (event?.type !== 'approval/decided') continue;
          const data = event.data ?? {};
          if ((data.id === undefined || data.id === null ? undefined : String(data.id)) === approvalId) {
            writeApproval(store, auditId, data.outcome); // decided already committed; never wait on session/event
            return;
          }
        }
      } catch { /* fall through: queue on session/event */ }
      approvalPending.set(approvalId, { auditId, store, session, callId: String(exec.callId) });
    };
    if (breaker.open(session, turn)) return finish('rejected', { code: 'CIRCUIT_OPEN' }, MESSAGES.breaker);
    let route;
    try { route = resolveReviewRoute(config, { agent: req.agent, session }); }
    catch (error) { return finish('rejected', { code: error.message }, MESSAGES.failed('reviewer model unavailable')); }
    const agent = req.agent, callId = String(req.callId), token = exec.token;
    const environment = () => {
      const sandbox = ctx.sandboxPolicy.resolve({ session });
      return JSON.stringify({ platform: process.platform, cwd: ctx.workingDirectory.get(session),
        workspaceRoot: sandbox?.workspaceRoot, sandbox: sandbox?.mode });
    };
    let rawAction, rawEnvironment, revision, input;
    try {
      const state = owner?.state(session);
      if (owner && state?.active !== true) return finish('cancelled', { code: 'REVIEW_INVALIDATED' });
      revision = state?.revision;
      rawAction = serializeAction(exec, req);
      rawEnvironment = environment();
      input = reviewInput({
        transcript: buildTranscript(session.snapshotEvents?.() ?? [], config.maxTranscriptBytes),
        environment: JSON.parse(rawEnvironment),
        action: JSON.parse(rawAction),
        reviewerPrompt: config.reviewerPrompt,
      });
    } catch (error) {
      return finish('rejected', { code: error.message }, MESSAGES.failed(
        error.message === 'REVIEW_INPUT_TOO_LARGE' ? 'the complete action exceeds the review input limit' : 'the complete action could not be captured'));
    }
    // Raw identity stays local: redacted secrets must not make different actions equal.
    const current = () => {
      try {
        if (signal.aborted || control !== owner || controlEpoch !== epoch || req.agent !== agent
          || agent.session !== session || exec.agent !== agent || exec.token !== token
          || String(exec.callId) !== callId || String(req.callId) !== callId
          || permissionRevision(session) !== permissions
          || executions.get(agent)?.get(callId) !== exec) return false;
        const configNow = active(session);
        if (!configNow || JSON.stringify(configNow) !== JSON.stringify(config)) return false;
        const state = owner?.state(session);
        return (!owner || (state.active === true && state.revision === revision))
          && environment() === rawEnvironment && serializeAction(exec, req) === rawAction;
      } catch { return false; }
    };
    if (!current()) return finish('cancelled', { code: 'REVIEW_INVALIDATED' });
    try {
      await store.prepare(auditId, { action: rawAction, input, environment: rawEnvironment, reviewer: route });
    } catch { return storageFailure(); }
    if (!current()) return finish('cancelled', { code: 'REVIEW_INVALIDATED' });
    let verdict;
    const attempts = [];
    try { verdict = await review({ llm, route, input, config, signal, onAttempt: async attempt => {
      attempts.push(attempt);
      try { await store.prepare(auditId, { attempts }); } catch { throw new Error('AUDIT_WRITE_FAILED'); }
    } }); }
    catch (error) {
      if (error.message === 'AUDIT_WRITE_FAILED') return storageFailure();
      if (!current()) return finish('cancelled', { code: 'REVIEW_CANCELLED' });
      const detail = error.message === 'REVIEW_TIMEOUT' ? 'the reviewer timed out' : error.message === 'NATIVE_REVIEWER_UNAVAILABLE'
        ? 'no reviewer model service' : error.message === 'INVALID_REVIEW_RESPONSE' ? 'the reviewer returned an invalid verdict'
          : error.message === 'REVIEW_INPUT_TOO_LARGE' ? 'the complete input exceeds the review input limit' : 'the reviewer request failed';
      return finish('rejected', { code: error.message }, MESSAGES.failed(detail));
    }
    if (!current()) return finish('cancelled', { code: 'REVIEW_CANCELLED' });
    const row = { code: verdict.outcome === 'allow' ? 'ALLOWED' : 'DENIED', risk: verdict.risk, authorization: verdict.authorization, rationale: verdict.rationale };
    breaker.record(session, turn, verdict.outcome === 'deny');
    if (verdict.outcome !== 'allow') return finish('rejected', row, MESSAGES.denied(verdict.rationale));
    // Register the pending native-approval observation before the durable
    // verdict lands: a decided that commits between the verdict write and this
    // link is caught by the next session/event pass, and the snapshotEvents
    // scan above re-anchors on a decided already in the log.
    linkApproval();
    const granted = await finish('allowed-once', row, undefined, current);
    if (granted !== 'allowed-once') approvalPending.delete(approvalId); // corrected verdict: nothing to confirm
    return granted;
  })()), { prepend: true });
}
