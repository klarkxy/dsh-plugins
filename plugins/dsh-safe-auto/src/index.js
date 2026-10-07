import { AsyncLocalStorage } from 'node:async_hooks';
import { isAbsolute } from 'node:path';
import { isSubagentSession } from '@klarkxy/dsh-plugin-kit/contracts';
import { parseConfig } from './config.js';
import { hardRisk, containsSecret } from './policy.js';
import { analyzeShell, isReadonly } from './shell-command.js';
import { assessApproval, bindingOf, escalationReason } from './approval-review.js';
import { createGate } from './gate.js';
import { resolveReviewRoute, sameRoute } from './model-route.js';
import { authority } from './review-context.js';
import { collectExecutionEvidence } from './execution-evidence.js';
import { createHumanApprovals } from './human-approval.js';
export { Config } from './config.js';
export { authority } from './review-context.js';

export const name = 'dsh-safe-auto';
export const inject = ['tools', 'sandboxPolicy'];

const REVIEW_TOOLS = new Set(['write', 'edit', 'pwsh', 'bash']);
const ESCALATION = new Set(['workspace-write', 'danger-full-access']);
/** Freshness window for one reviewed grant; not process lifetime, revocation or rollback. */
const APPROVAL_TTL_MS = 30000;

/** Public DSH seams only. Standing sandbox policy is NEVER written or temporarily switched. */
export function apply(ctx, raw = {}) {
  const config = parseConfig(raw);
  let control;
  let controlEpoch = 0;
  const humanApprovals = createHumanApprovals();
  ctx.provide?.('safeAutoRuntime', { base: config, attach(next) {
    if (control) throw new Error('Safe Auto controls already attached');
    control = next; controlEpoch++;
    return () => { if (control === next) { control = undefined; controlEpoch++; humanApprovals.cancelAll(); } };
  }, invalidateApprovals() { humanApprovals.invalidate(); },
  listApprovals(sessionId) {
    const session = control?.getSession(sessionId);
    if (!session) throw new Error('Approval controls unavailable');
    return humanApprovals.list(session);
  },
  answerApproval({ sessionId, requestId, outcome } = {}) {
    const session = control?.getSession(sessionId);
    if (!session || !control.config(session).enabled) throw new Error('Approval controls unavailable');
    return humanApprovals.answer(session, requestId, outcome);
  } });
  const inactiveConfig = parseConfig({ ...config, enabled: false });
  // UI activation owns review, independently of the native preset identity.
  // Never register official Auto: its fixed FullAccess bundle is not our policy.
  const configFor = exec => control?.config(exec.agent?.session) ?? (controlEpoch ? inactiveConfig : config);
  const controlBinding = exec => JSON.stringify({ epoch: controlEpoch, state: control?.state(exec.agent?.session) });
  if (!config.enabled) return;
  if (typeof ctx.tools?.guard !== 'function' || typeof ctx.sandboxPolicy?.resolve !== 'function') throw new Error('DSH Safe Auto requires tools.guard and sandboxPolicy.resolve');
  const decisions = new Map();
  const execution = new AsyncLocalStorage();
  const lifetime = new AbortController();
  let llm;
  // Optional dependency: losing the model service must NOT unload the safety guards.
  if (typeof ctx.inject === 'function') ctx.inject(['llm'], scope => {
    const active = scope.llm;
    llm = active;
    scope.effect(() => () => { if (llm === active) llm = undefined; });
  });
  const gate = createGate(config, { getLlm: () => llm, audit: row => ctx.logger.info('safe-auto %s', JSON.stringify(row)) });
  ctx.effect(() => () => { lifetime.abort(); humanApprovals.dispose(); gate.dispose(); decisions.clear(); execution.disable(); });

  const reviewable = exec => REVIEW_TOOLS.has(exec.name) && ESCALATION.has(exec.arguments?.sandbox_permissions);

  function callOf(exec, includeAuthority = false) {
    const session = exec.agent?.session;
    const sandbox = ctx.sandboxPolicy.resolve({ session });
    const info = includeAuthority ? authority(session) : {};
    const call = { tool: exec.name, args: exec.arguments, callId: String(exec.callId), session, agent: exec.agent,
      cwd: session?.header?.cwd, sandbox, signal: exec.signal,
      subagent: isSubagentSession(session),
      nested: exec.parent !== undefined, ...info };
    if (reviewable(exec)) {
      // These are optional capability reads, not model assertions about its environment.
      const fs = ctx.get?.('fs');
      const shell = ctx.get?.('shell');
      const paths = [call.cwd, ...(['bash', 'pwsh'].includes(call.tool)
        ? (call.args.workdir === undefined ? [] : [call.args.workdir]) : [call.args.file_path])];
      call.localExecution = paths.every(p => typeof p === 'string' && isAbsolute(p) && fs?.processPathFromHostPath?.(p) === p);
      call.jobsAvailable = typeof ctx.get !== 'function' || ctx.get('jobs') !== undefined;
      call.shellConfined = ['read-only', 'workspace-write', 'danger-full-access'].includes(shell?.sandboxMode);
    }
    return call;
  }

  function sameReviewer(exec, decision) {
    if (!decision.reviewRoute) return true;
    try {
      return sameRoute(decision.reviewRoute, resolveReviewRoute(configFor(exec), callOf(exec))) && decision.reviewLlm === llm;
    } catch { return false; }
  }

  ctx.tools.guard(exec => {
    const config = configFor(exec);
    const pending = decisions.get(exec.token);
    if (pending?.controlBinding !== undefined && pending.controlBinding !== controlBinding(exec)) return 'safe-auto: SETTINGS_CHANGED';
    if (!config.enabled) return undefined;
    if (exec.signal.aborted || lifetime.signal.aborted) return 'safe-auto: CANCELLED';
    try {
      const hard = hardRisk(callOf(exec));
      return hard ? `safe-auto: ${hard.code}` : undefined;
    } catch { return 'safe-auto: POLICY_UNAVAILABLE'; }
  });

  ctx.on('tools/pre-execute', async (exec, next) => {
    const config = configFor(exec);
    if (!config.enabled) return next();
    if (exec.signal.aborted || lifetime.signal.aborted) return { kind: 'cancel' };
    const hard = hardRisk(callOf(exec));
    if (hard) return { kind: 'deny', reason: `safe-auto: ${hard.code}` };
    // Native policy remains authoritative; this plugin never manufactures asks.
    return next();
  }, { prepend: true });

  // Bind the approval to the active execution, never a process-wide visible callId cache.
  ctx.on('tools/execute', async (exec, next) => {
    const config = configFor(exec);
    if (!config.enabled || !reviewable(exec)) return next();
    const call = callOf(exec, true);
    const saved = { kind: 'approval', binding: bindingOf(call, assessApproval(call, config)), signal: exec.signal, controlBinding: controlBinding(exec) };
    if (decisions.size >= 1024) return next();
    decisions.set(exec.token, saved);
    const store = { exec, saved, active: true, claimed: false };
    try {
      const result = await execution.run(store, next);
      // Around-dispatch may return result content; tools/result is a read-only
      // observer in the pinned host. Expose recovery through the actual result.
      if (result?.isError && saved.feedback) return { ...result,
        content: [...(result.content ?? []), { type: 'text', text: saved.feedback }] };
      return result;
    }
    finally { store.active = false; }
  }, { prepend: true });

  ctx.on('tools/result', (exec, result) => {
    decisions.delete(exec.token);
    ctx.logger.info('safe-auto %s', JSON.stringify({ phase: 'result', tool: exec.name,
      callId: String(exec.callId), isError: result?.isError }));
  });

  ctx.on('approval/request', async (req, next) => {
    const store = execution.getStore();
    const config = configFor(store?.exec ?? { agent: req.agent });
    if (store?.saved.controlBinding !== undefined && store.saved.controlBinding !== controlBinding(store.exec)) return 'rejected';
    if (req.signal?.aborted || lifetime.signal.aborted) return 'cancelled';
    if (!config.enabled) return store?.saved.kind === 'approval' ? 'rejected' : next();
    // A foreign tool's native ask is not ours. An owned execution context,
    // including an inactive or mismatched one, must never escape to another
    // answerer. Likewise an unbound ask impersonating one of our tools fails
    // closed. Human takeover for owned asks uses only the UI queue below.
    if (!store) return REVIEW_TOOLS.has(req.toolName) ? 'rejected' : next();
    if (store.saved.kind !== 'approval') return 'rejected';
    const { exec, saved } = store;
    const matches = () => req.agent === exec.agent && req.toolName === exec.name && req.callId === exec.callId &&
      req.signal === exec.signal && req.reason === escalationReason(callOf(exec));
    if (!matches()) return 'rejected';
    if (!store.active || store.claimed) return 'rejected';
    store.claimed = true;
    const signal = AbortSignal.any([saved.signal, exec.signal, req.signal, lifetime.signal]);
    const started = performance.now();
    let reviewed;
    const bound = () => {
      if (signal.aborted || !store.active || decisions.get(exec.token) !== saved || saved.controlBinding !== controlBinding(exec) || !matches()) return false;
      try {
        const current = configFor(exec), call = callOf(exec, true);
        return current.enabled && bindingOf(call, assessApproval(call, current)) === saved.binding && (!reviewed || sameReviewer(exec, reviewed));
      } catch { return false; }
    };
    const finish = (outcome, source, decision) => {
      if (signal.aborted) outcome = 'cancelled';
      else if (!bound()) outcome = 'rejected';
      if (outcome !== 'allowed-once') {
        const code = !bound() ? 'GRANT_INVALIDATED' : decision?.code ?? 'APPROVAL_BINDING_INVALID';
        const recovery = code === 'HUMAN_APPROVAL_EXPIRED'
          ? 'The human confirmation window expired. No permission was granted; a fresh execution requires a new review and confirmation.'
          : code === 'HUMAN_REJECTED'
            ? 'The user rejected this operation. Do not retry it through another execution path.'
            : code === 'MODEL_NOT_ALLOWED'
          ? 'The reviewer denied this action. Do not retry it through wrappers or alternate execution; choose a materially safer action or ask the user with the concrete risk.'
          : code === 'AUTHORITY_CONTEXT_INCOMPLETE'
            ? 'Human authorization history is incomplete, sensitive or over its limit. No permission was granted; use a fresh conversation with the full task scope and restrictions.'
            : code === 'REVIEW_NEEDS_CONFIRMATION'
              ? 'The reviewer needs more evidence or explicit human authorization. No permission was granted; ask the user about the actual target and side effects, or supply a safer, verifiable action.'
              : 'No permission was granted. This review failure is not proof that the action is unsafe. Resolve the reported evidence, service or budget problem before requesting review again; do not bypass the approval boundary.';
        const rationale = typeof decision?.reason === 'string' && !containsSecret(decision.reason)
          ? ` Reviewer rationale (untrusted): ${decision.reason.slice(0, 512)}` : '';
        saved.feedback = `safe-auto: ${code}. ${recovery}${rationale}`;
      }
      try { ctx.logger.info('safe-auto %s', JSON.stringify({ phase: 'approval', tool: exec.name, callId: String(exec.callId),
        decision: outcome, source, code: decision?.code, scope: 'this-call-only', durationMs: Math.round(performance.now() - started) })); }
      catch { return 'rejected'; }
      return outcome;
    };
    if (!bound()) return finish('rejected', 'binding');
    let decision;
    let evidence;
    const assessment = assessApproval(callOf(exec, true), config);
    // A fresh exact-call UI answer supplies authority when historical text is
    // incomplete. Waive only this review-input limitation, then revalidate all
    // structural, secret and host constraints under the original live binding.
    const manualAssessment = assessment.code === 'AUTHORITY_CONTEXT_INCOMPLETE'
      ? assessApproval({ ...callOf(exec, true), authorityIncomplete: false }, config) : assessment;
    // Static proof, no model: a fully literal bash parse where every invocation
    // is provably read-only skips evidence and review entirely. pwsh and
    // unparseable commands always fall through to the reviewer.
    let staticAllow = false;
    if (assessment.kind === 'review' && config.staticReadonly && exec.name === 'bash') {
      try { staticAllow = isReadonly(analyzeShell(exec.arguments?.command)); } catch { staticAllow = false; }
    }
    try {
      const call = callOf(exec, true);
      if (staticAllow) decision = { kind: 'allow', code: 'STATIC_READONLY' };
      else {
        // Do not read files or ask a model for an ineligible execution.
        if (assessment.kind === 'review') {
          const evidenceSignal = AbortSignal.any([signal, AbortSignal.timeout(Math.min(config.timeoutMs, 30000))]);
          evidence = await collectExecutionEvidence(call, ctx.get?.('fs'), evidenceSignal);
        }
        if (!bound()) return finish('unavailable', 'binding', { code: 'GRANT_INVALIDATED' });
        decision = await gate.decide({ ...call, signal, executionEvidence: evidence?.data }, config);
        if (decision.kind === 'allow' && evidence && !await evidence.verify(signal)) decision = { kind: 'ask', code: 'EVIDENCE_CHANGED' };
      }
    }
    catch (error) { decision = { kind: 'ask', code: ['EVIDENCE_CHANGED', 'EVIDENCE_PROVIDER_UNBOUNDED'].includes(error.message)
      ? error.message : signal.aborted ? 'REVIEW_CANCELLED' : 'EVIDENCE_UNAVAILABLE' }; }
    if (decision.kind === 'allow') reviewed = decision;
    if (!bound()) return finish('rejected', 'binding', decision);
    if (decision.kind === 'allow' && performance.now() - started > APPROVAL_TTL_MS) decision = { kind: 'ask', code: 'APPROVAL_LEASE_EXPIRED' };
    if (decision.kind === 'allow') return finish('allowed-once', decision.code === 'STATIC_READONLY' ? 'static' : 'reviewer', decision);
    if (decision.kind === 'cancel') return finish('cancelled', 'reviewer', decision);
    // Structural refusals, changed operations and audit failures are terminal.
    // Model refusal (including risk opinions) and review failures may be
    // overridden only by an explicit response to this exact UI request.
    const terminal = new Set(['AUDIT_UNAVAILABLE', 'STALE_REVIEW', 'EVIDENCE_CHANGED', 'EVIDENCE_PROVIDER_UNBOUNDED']);
    if (manualAssessment.kind === 'review' && !terminal.has(decision.code) && config.humanApprovalTimeoutMs > 0 && control) {
      reviewed = undefined; // Human authorization does not inherit a stale model lease.
      const review = { code: decision.code,
        ...(decision.risk ? { risk: decision.risk } : {}),
        ...(decision.authorization ? { authorization: decision.authorization } : {}),
        ...(typeof decision.reason === 'string' && !containsSecret(decision.reason) ? { reason: decision.reason.slice(0, 512) } : {}) };
      const answer = await humanApprovals.request({ session: exec.agent.session, action: manualAssessment.action, review,
        signal, timeoutMs: config.humanApprovalTimeoutMs, valid: bound });
      if (answer.kind === 'allow') {
        try {
          const verificationSignal = AbortSignal.any([signal, AbortSignal.timeout(Math.min(config.timeoutMs, 30000))]);
          if (evidence && !await evidence.verify(verificationSignal)) return finish('rejected', 'human', { code: 'EVIDENCE_CHANGED' });
          if (!humanApprovals.beforeDeadline(answer)) return finish('rejected', 'human', { code: 'HUMAN_APPROVAL_EXPIRED' });
          const outcome = finish('allowed-once', 'human', answer);
          if (outcome === 'allowed-once') gate.humanAllowed(callOf(exec, true));
          return outcome;
        } catch { return finish(signal.aborted ? 'cancelled' : 'rejected', 'human', { code: 'EVIDENCE_UNAVAILABLE' }); }
      }
      return finish(answer.kind === 'cancel' ? 'cancelled' : 'rejected', 'human', answer);
    }
    if (decision.kind === 'deny') return finish('rejected', 'reviewer', decision);
    return finish('unavailable', 'policy', decision);
  }, { prepend: true });
}
