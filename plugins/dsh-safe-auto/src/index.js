import { isSubagentSession } from '@klarkxy/dsh-plugin-kit/contracts';
import { parseConfig } from './config.js';
import { isPermissionEvent } from './control.js';
import { dangerousCommand } from './dangerous.js';
import { buildTranscript } from './transcript.js';
import { review, reviewInput } from './reviewer.js';
import { resolveReviewRoute } from './model-route.js';
export { Config } from './config.js';

export const name = 'dsh-safe-auto';
export const inject = ['sandboxPolicy'];

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
  ctx.provide?.('safeAutoRuntime', { base, attach(next) {
    if (control) throw new Error('Safe Auto controls already attached');
    control = next; attachedOnce = true;
    const epoch = ++controlEpoch;
    return () => { if (control === next && controlEpoch === epoch) { control = undefined; ++controlEpoch; } };
  } });
  if (!base.enabled) return;

  let llm;
  // Optional dependency: losing the model service fails reviews closed instead of unloading the plugin.
  if (typeof ctx.inject === 'function') ctx.inject(['llm'], scope => {
    const active = scope.llm;
    llm = active;
    scope.effect(() => () => { if (llm === active) llm = undefined; });
  });
  const lifetime = new AbortController();
  const breaker = createBreaker();
  // agent -> callId -> live execution. Approval requests carry only agent and
  // callId, so the action's arguments are looked up here.
  const executions = new WeakMap();
  // execution token -> model-facing explanation for a non-granted review.
  const feedback = new Map();
  ctx.effect(() => () => { lifetime.abort(); feedback.clear(); });

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

  ctx.on('tools/result', exec => {
    feedback.delete(exec.token);
    const calls = exec.agent && executions.get(exec.agent);
    if (calls?.get(String(exec.callId)) === exec) calls.delete(String(exec.callId));
  });

  ctx.on('approval/request', async (req, next) => {
    const session = req.agent?.session;
    const config = active(session);
    if (!config) return next();
    const exec = req.callId === undefined ? undefined : executions.get(req.agent)?.get(String(req.callId));
    // Without the concrete action there is nothing to review; keep the native flow.
    if (!exec) return next();
    const owner = control;
    const epoch = controlEpoch;
    const permissions = permissionRevision(session);
    const signal = AbortSignal.any([req.signal, exec.signal, lifetime.signal, owner?.signal].filter(Boolean));
    const turn = humanTurn(session);
    const started = Date.now();
    const finish = (outcome, row, text) => {
      if (text !== undefined && outcome !== 'allowed-once') feedback.set(exec.token, text);
      audit({ tool: exec.name, callId: String(exec.callId), outcome, durationMs: Date.now() - started, ...row });
      return outcome;
    };
    if (breaker.open(session, turn)) return finish('rejected', { code: 'CIRCUIT_OPEN' }, MESSAGES.breaker);
    let route;
    try { route = resolveReviewRoute(config, { agent: req.agent, session }); }
    catch (error) { return finish('rejected', { code: error.message }, MESSAGES.failed('reviewer model unavailable')); }
    const agent = req.agent, callId = String(req.callId), token = exec.token;
    const environment = () => {
      const sandbox = ctx.sandboxPolicy.resolve({ session });
      return JSON.stringify({ platform: process.platform, cwd: session.header?.cwd,
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
    let verdict;
    try { verdict = await review({ llm, route, input, config, signal }); }
    catch (error) {
      if (!current()) return finish('cancelled', { code: 'REVIEW_CANCELLED' });
      const detail = error.message === 'REVIEW_TIMEOUT' ? 'the reviewer timed out' : error.message === 'NATIVE_REVIEWER_UNAVAILABLE'
        ? 'no reviewer model service' : error.message === 'INVALID_REVIEW_RESPONSE' ? 'the reviewer returned an invalid verdict'
          : error.message === 'REVIEW_INPUT_TOO_LARGE' ? 'the complete input exceeds the review input limit' : 'the reviewer request failed';
      return finish('rejected', { code: error.message }, MESSAGES.failed(detail));
    }
    if (!current()) return finish('cancelled', { code: 'REVIEW_CANCELLED' });
    const row = { code: verdict.outcome === 'allow' ? 'ALLOWED' : 'DENIED', risk: verdict.risk, authorization: verdict.authorization };
    breaker.record(session, turn, verdict.outcome === 'deny');
    return verdict.outcome === 'allow' ? finish('allowed-once', row) : finish('rejected', row, MESSAGES.denied(verdict.rationale));
  }, { prepend: true });
}
